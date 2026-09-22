import { randomUUID } from "node:crypto";
import { LIMITS, OPS, type ClientCommand, type Command, type Op, type Snapshot } from "../../shared/protocol";

export type Validated = { ok: true; cmd: Command } | { ok: false; error: string };

// eslint-disable-next-line no-control-regex
const CONTROL = new RegExp("[\u0000-\u001f\u007f-\u009f\u2028\u2029]");
const OP_SET = new Set<string>(OPS);
const NO_ARG_OPS = new Set<Op>([
  "follow",
  "stay",
  "flee",
  "grind",
  "attack",
  "summon",
  "release",
  "revive",
  "repair",
  "maintenance",
  "loot-all",
]);
const ENTRY_OPS = new Set<Op>(["item.destroy", "item.equip", "item.unequip", "item.use", "item.sell"]);
const QUEST_OPS = new Set<Op>(["quest.accept", "quest.abandon", "quest.share"]);
// "+dps,-passive" - each part: sign + strategy name (letters, digits, space, underscore, dash)
const STRATEGY_CHANGES = /^[+\-~][A-Za-z0-9 _-]{1,40}(,[+\-~][A-Za-z0-9 _-]{1,40}){0,15}$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isPosInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

function cleanString(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  if (CONTROL.test(v)) return null;
  const t = v.trim();
  if (t.length === 0 || t.length > max) return null;
  return t;
}

/** Validate a browser command and produce a normalised `Command` (with id). Never throws. */
export function validateCommand(input: unknown): Validated {
  if (!isObj(input)) return { ok: false, error: "Ungültiger Befehl" };
  const c = input as Partial<ClientCommand> & Record<string, unknown>;

  const bot = cleanString(c.bot, 64);
  if (!bot) return { ok: false, error: "Bot fehlt oder ungültig" };
  if (typeof c.op !== "string" || !OP_SET.has(c.op)) return { ok: false, error: "Unbekannte Operation" };
  const op = c.op as Op;

  let id: string;
  if (c.id === undefined || c.id === null || c.id === "") id = randomUUID();
  else {
    const s = cleanString(c.id, 64);
    if (!s) return { ok: false, error: "Ungültige Befehls-ID" };
    id = s;
  }

  if (c.args !== undefined && !isObj(c.args)) return { ok: false, error: "args muss ein Objekt sein" };
  const a = (c.args ?? {}) as Record<string, unknown>;

  let args: Record<string, unknown> | undefined;

  if (op === "chat") {
    if (typeof a.text !== "string") return { ok: false, error: "Text fehlt" };
    if (CONTROL.test(a.text)) return { ok: false, error: "Steuerzeichen sind nicht erlaubt" };
    const text = a.text.trim();
    if (!text) return { ok: false, error: "Text ist leer" };
    if (text.length > LIMITS.chatMaxLength) return { ok: false, error: `Text ist länger als ${LIMITS.chatMaxLength} Zeichen` };
    if (text.startsWith(".")) return { ok: false, error: "GM-Befehle (Punkt-Präfix) sind nicht erlaubt" };
    args = { text };
  } else if (NO_ARG_OPS.has(op)) {
    args = undefined;
  } else if (QUEST_OPS.has(op)) {
    if (!isPosInt(a.questId)) return { ok: false, error: "questId muss eine positive Ganzzahl sein" };
    args = { questId: a.questId };
  } else if (op === "quest.offer.accept" || op === "quest.offer.decline") {
    const offerId = cleanString(a.offerId, 64);
    if (!offerId) return { ok: false, error: "offerId fehlt oder ungültig" };
    args = { offerId };
  } else if (ENTRY_OPS.has(op)) {
    if (!isPosInt(a.entry)) return { ok: false, error: "entry muss eine positive Ganzzahl sein" };
    args = { entry: a.entry };
  } else if (op === "item.trade") {
    if (!Array.isArray(a.items) || a.items.length === 0) return { ok: false, error: "Keine Items ausgewählt" };
    if (a.items.length > LIMITS.tradeMaxItems)
      return { ok: false, error: `Ein Handelsfenster fasst maximal ${LIMITS.tradeMaxItems} Items` };
    const items: { entry: number }[] = [];
    for (const it of a.items) {
      if (!isObj(it) || !isPosInt(it.entry)) return { ok: false, error: "Ungültiges Item in der Liste" };
      items.push({ entry: it.entry });
    }
    args = { items };
  } else if (op === "strategy") {
    if (a.scope !== "co" && a.scope !== "nc") return { ok: false, error: 'scope muss "co" oder "nc" sein' };
    const changes = cleanString(a.changes, 400);
    if (!changes || !STRATEGY_CHANGES.test(changes)) return { ok: false, error: 'changes hat kein gültiges Format (z. B. "+dps,-passive")' };
    args = { scope: a.scope, changes };
  }

  return { ok: true, cmd: args ? { id, bot, op, args } : { id, bot, op } };
}

/** Token-window rate limiter (per socket). */
export class RateLimiter {
  private stamps: number[] = [];
  constructor(private readonly perSecond: number) {}
  take(now = Date.now()): boolean {
    const cutoff = now - 1000;
    while (this.stamps.length && this.stamps[0]! <= cutoff) this.stamps.shift();
    if (this.stamps.length >= this.perSecond) return false;
    this.stamps.push(now);
    return true;
  }
}

/** Parse + minimally normalise a snapshot coming from Redis. Returns null when it is not usable. */
export function parseSnapshot(raw: string | null | undefined): Snapshot | null {
  if (!raw) return null;
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(o) || o.v !== 1 || typeof o.ts !== "number" || !isObj(o.master) || !Array.isArray(o.members)) return null;
  const s = o as unknown as Snapshot;
  for (const m of s.members) {
    if (!isObj(m) || typeof m.name !== "string") return null;
    // Tolerate modules that omit empty arrays.
    m.equipment ??= [];
    m.bags ??= [];
    m.quests ??= [];
    m.pendingQuestOffers ??= [];
    m.queuedActions ??= [];
    m.recentActions ??= m.lastAction ? [m.lastAction] : [];
    m.questCompare ??= { missingOnBot: [], missingOnMaster: [], differing: [], inSync: 0, botLogFull: false };
    m.strategies ??= { co: [], nc: [] };
    m.strategies.co ??= [];
    m.strategies.nc ??= [];
  }
  s.goldTotal ??= 0;
  return s;
}

export function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
