/**
 * wow-party protocol v1 - shared types.
 * Mirrors PROTOCOL.md 1:1 (the .md is the source of truth). Do not change types here without changing it.
 * Money = copper, times = unix seconds (`ts`), durations = ms.
 */

export type Snapshot = {
  v: 1;
  ts: number; // unix seconds
  master: {
    accountId: number;
    guid: number;
    name: string;
    level: number;
    gold: number; // copper
    map: number;
    zone: number;
    zoneName: string;
    areaName: string;
  };
  goldTotal: number; // copper, master + all party members
  self: Character; // the master's ACTIVE character - the reference everything is compared against
  members: Member[]; // bots of the master's group (master excluded)
};

export type Member = {
  guid: number;
  name: string;
  isBot: boolean;
  race: number;
  raceName: string;
  cls: number;
  clsName: string;
  spec: string | null;
  level: number;
  xp: number;
  xpMax: number;
  hp: number;
  hpMax: number;
  powerType: number; // 0 mana, 1 rage, 3 energy, 6 runic power
  power: number;
  powerMax: number;
  gold: number; // copper
  gearScore: number;
  avgItemLevel: number;
  durabilityPct: number; // 0..100
  state: "combat" | "non-combat" | "dead" | "unknown";
  lastAction: string;
  recentActions: string[]; // last <=6 executed actions, OLDEST FIRST, last = lastAction
  queuedActions: string[]; // heuristic "next" (often empty)
  target: { name: string; hpPct: number } | null;
  strategies: { co: string[]; nc: string[] };
  following: boolean;
  distanceToMaster: number | null; // yards, null = other map
  pos: {
    map: number;
    zone: number;
    zoneName: string;
    area: number;
    areaName: string;
    x: number;
    y: number;
    z: number;
    o: number;
  };
  stats: {
    str: number;
    agi: number;
    sta: number;
    int: number;
    spi: number;
    armor: number;
    attackPower: number;
    rangedAttackPower: number;
    spellPower: number;
    healingPower: number;
    critPct: number;
    spellCritPct: number;
    rangedCritPct: number;
    hitPct: number;
    spellHitPct: number;
    hastePct: number;
    dodgePct: number;
    parryPct: number;
    blockPct: number;
    resist: { holy: number; fire: number; nature: number; frost: number; shadow: number; arcane: number };
    mp5: number;
  };
  equipment: Item[]; // occupied slots only; slot = 0..18
  bags: Item[]; // all bags incl. backpack; bag 0 = backpack, 1..4 = bags
  bagSlots: BagInfo[]; // the containers themselves: backpack (bag 0) + every equipped bag (bag 1..4), in slot order
  freeSlots: number;
  totalSlots: number;
  quests: Quest[];
  pendingQuestOffers: QuestOffer[];
  questCompare: QuestCompare; // this bot compared to `self`
};

/** The master's active character: the Member fields that also apply to a player. */
export type Character = Pick<
  Member,
  | "guid" | "name" | "race" | "raceName" | "cls" | "clsName" | "spec" | "level" | "xp" | "xpMax"
  | "hp" | "hpMax" | "powerType" | "power" | "powerMax" | "gold" | "gearScore" | "avgItemLevel"
  | "durabilityPct" | "equipment" | "bags" | "bagSlots" | "freeSlots" | "totalSlots" | "quests" | "pos" | "stats"
>;

/** State of a quest for one character. "none" = neither in the log nor rewarded. */
export type QuestState = "incomplete" | "complete" | "failed" | "rewarded" | "none";

/** Why a character cannot accept a quest right now (first matching reason); null = could accept. */
export type QuestBlocker =
  | "level" | "race" | "class" | "skill" | "reputation" | "prerequisite" | "exclusive" | "chain"
  | "repeat" | "log_full" | "conditions" | "has_it";

export type QuestObjective = { text: string; cur: number; req: number };

export type QuestDiffEntry = {
  id: number;
  title: string;
  level: number;
  master: { state: QuestState; objectives: QuestObjective[] };
  bot: { state: QuestState; objectives: QuestObjective[]; blocker: QuestBlocker | null };
};

export type QuestCompare = {
  missingOnBot: QuestDiffEntry[]; // in master's log, NOT in bot's (bot.state "rewarded" = already handed in)
  missingOnMaster: QuestDiffEntry[]; // in bot's log, NOT in master's
  differing: QuestDiffEntry[]; // in both logs, status or progress differ
  inSync: number; // count of quests in both logs with identical status and progress
  botLogFull: boolean;
};

export type Item = {
  entry: number;
  name: string;
  quality: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  itemLevel: number;
  requiredLevel: number;
  count: number;
  icon: string | null;
  slot: number; // slot in bag (bags) / equipment slot (equipment)
  bag: number; // 0 = backpack ...; always 255 for equipment
  durability?: { cur: number; max: number };
  sellPrice: number; // copper per unit
  soulbound: boolean;
  tradeable: boolean;
  link: string;
};

/** One bag container. `bag` matches `Item.bag` of the items inside it. Backpack: bag 0, entry 0, size 16. */
export type BagInfo = {
  bag: number; // 0 = backpack, 1..4 = equipped bags
  entry: number; // item entry of the bag (0 for the backpack)
  name: string;
  quality: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  icon: string | null;
  size: number; // slots in this container
};

export type Quest = {
  id: number;
  title: string;
  level: number;
  status: "incomplete" | "complete" | "failed";
  objectives: { text: string; cur: number; req: number }[];
  shareable: boolean;
};

export type QuestOffer = {
  offerId: string;
  questId: number;
  title: string;
  from: string;
  expiresTs: number;
};

export const OPS = [
  "chat",
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
  "quest.accept",
  "quest.abandon",
  "quest.share",
  "quest.offer.accept",
  "quest.offer.decline",
  "item.destroy",
  "item.trade",
  "item.equip",
  "item.unequip",
  "item.use",
  "item.sell",
  "strategy",
] as const;

export type Op = (typeof OPS)[number];

export type Command = {
  id: string;
  bot: string; // bot character name, or "*" for all bots in the group
  op: Op;
  args?: Record<string, unknown>;
};

/** Command as sent by the browser: `id` optional (server assigns one if empty). */
export type ClientCommand = Omit<Command, "id"> & { id?: string };

export type CommandResult = {
  id: string;
  ok: boolean;
  /** ok = DELIVERED to the bot, not done; the effect shows in the next snapshot. */
  message: string;
  bot: string;
  op: Op;
  ts: number;
};

export type PartyEvent = {
  type: "quest_offer" | "quest_update" | "trade_opened" | "bot_death" | "bot_levelup" | "info";
  bot: string;
  text: string;
  ts: number;
  data?: Record<string, unknown>;
};

export type BridgeState = "live" | "mock" | "stale" | "offline";

export type StatusPayload = {
  bridge: BridgeState;
  lastSnapshotAgeMs: number | null;
  redis: boolean;
};

export type CmdAck = { ok: boolean; id: string; error?: string };

/** Socket.IO event maps (typed on both sides). */
export interface ServerToClientEvents {
  snapshot: (s: Snapshot) => void;
  event: (e: PartyEvent) => void;
  result: (r: CommandResult) => void;
  status: (s: StatusPayload) => void;
}

export interface ClientToServerEvents {
  cmd: (c: ClientCommand, ack?: (a: CmdAck) => void) => void;
}

/** Limits enforced by the node server (and mirrored in the UI). */
export const LIMITS = {
  chatMaxLength: 200,
  /** The WoW trade window holds 6 tradeable slots. */
  tradeMaxItems: 6,
  cmdPerSecondPerSocket: 20,
  staleAfterMs: 5000,
} as const;
