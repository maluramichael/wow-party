/**
 * Mock source: a small simulated party (master + 4 bots) that produces a realistic 1 Hz snapshot stream and
 * really executes commands. Semantics follow PROTOCOL.md: `CommandResult.ok` = delivered to the bot, the effect
 * shows up in a later snapshot (here: 0.5-1.5 s after the result, like the next AI tick).
 */
import type { BagInfo, Character, Command, CommandResult, Item, Member, Op, PartyEvent, Quest, QuestBlocker, QuestCompare, QuestOffer, Snapshot } from "../../../shared/protocol";
import type { Sink, Source } from "../source";
import {
  CONSUMABLES,
  JUNK,
  MATS,
  MISC,
  NOTABLE,
  QUEST_ITEMS,
  makeGear,
  pick,
  rint,
  rnd,
  shuffle,
  toItem,
  type ArmorType,
  type ItemDef,
  type WeaponSet,
} from "./items";

// ------------------------------------------------------------------ world data

type Loc = {
  map: number;
  zone: number;
  zoneName: string;
  areas: { id: number; name: string }[];
  cx: number;
  cy: number;
  cz: number;
  r: number;
  mobs: string[];
};

const LOCS: Loc[] = [
  {
    map: 571, zone: 210, zoneName: "Icecrown",
    areas: [{ id: 4658, name: "Argent Tournament Grounds" }, { id: 4522, name: "The Shadow Vault" }, { id: 4602, name: "Valhalas" }],
    cx: 8500, cy: 800, cz: 547, r: 140,
    mobs: ["Ymirjar Warrior", "Scourge Necromancer", "Onslaught Footman", "Frostbrood Whelp", "Crystalline Ice Elemental"],
  },
  {
    map: 571, zone: 65, zoneName: "Dragonblight",
    areas: [{ id: 4177, name: "Wyrmrest Temple" }, { id: 4160, name: "Moonrest Gardens" }, { id: 4166, name: "Light's Trust" }],
    cx: 3600, cy: 250, cz: 70, r: 120,
    mobs: ["Nerubian Webweaver", "Azure Drake", "Wyrmrest Defender", "Scourge Ghoul", "Frostbrood Vanquisher"],
  },
  {
    map: 0, zone: 1519, zoneName: "Stormwind City",
    areas: [{ id: 5170, name: "Trade District" }, { id: 5148, name: "Cathedral Square" }, { id: 5152, name: "Old Town" }],
    cx: -8850, cy: 640, cz: 96, r: 90,
    mobs: ["Training Dummy", "Defias Trainee", "Stormwind Rat", "Rogue Training Dummy"],
  },
];

const RACE_NAMES: Record<number, string> = { 1: "Human", 2: "Orc", 3: "Dwarf", 4: "Night Elf", 5: "Undead", 6: "Tauren", 7: "Gnome", 8: "Troll", 10: "Blood Elf", 11: "Draenei" };

type Role = "tank" | "heal" | "dps";
type Tpl = {
  name: string; race: number; cls: number; clsName: string; spec: string; level: number; powerType: number;
  role: Role; armor: ArmorType; weapons: WeaponSet; gold: number; quests: number; guid: number;
};

/** The master's active character (reference for all comparisons). */
const SELF_TPL: Tpl = {
  name: "Michael", race: 1, cls: 2, clsName: "Paladin", spec: "Retribution", level: 80, powerType: 0, role: "dps", armor: "plate",
  weapons: { mh: "Greatsword", mhIcon: "inv_sword", ranged: "Libram", rangedIcon: "inv_relics_libramofgrace" },
  gold: 54_321_000, quests: 0, guid: 1,
};

const TEMPLATES: Tpl[] = [
  {
    name: "Grimjaw", race: 3, cls: 1, clsName: "Warrior", spec: "Protection", level: 80, powerType: 1, role: "tank", armor: "plate",
    weapons: { mh: "Broadsword", mhIcon: "inv_sword", oh: "Bulwark", ohIcon: "inv_shield", ranged: "Throwing Axe", rangedIcon: "inv_throwingaxe" },
    gold: 18_452_310, quests: 3, guid: 4001,
  },
  {
    name: "Lyriel", race: 4, cls: 5, clsName: "Priest", spec: "Holy", level: 78, powerType: 0, role: "heal", armor: "cloth",
    weapons: { mh: "Scepter", mhIcon: "inv_mace", oh: "Orb", ohIcon: "inv_misc_orb", ranged: "Wand", rangedIcon: "inv_wand" },
    gold: 6_120_045, quests: 4, guid: 4002,
  },
  {
    name: "Rokhan", race: 2, cls: 4, clsName: "Rogue", spec: "Combat", level: 66, powerType: 3, role: "dps", armor: "leather",
    weapons: { mh: "Dagger", mhIcon: "inv_weapon_shortblade", oh: "Dirk", ohIcon: "inv_weapon_shortblade", ranged: "Crossbow", rangedIcon: "inv_weapon_crossbow" },
    gold: 2_310_780, quests: 5, guid: 4003,
  },
  {
    name: "Mordrek", race: 1, cls: 6, clsName: "Death Knight", spec: "Unholy", level: 75, powerType: 6, role: "dps", armor: "plate",
    weapons: { mh: "Runeblade", mhIcon: "inv_sword", oh: "Runeblade", ohIcon: "inv_sword", ranged: "Sigil", rangedIcon: "inv_misc_rune" },
    gold: 9_875_500, quests: 2, guid: 4004,
  },
];

const ACTIONS = {
  tank: ["melee", "melee", "taunt", "shield block", "tank assist", "devastate", "thunder clap", "revenge"],
  heal: ["heal", "flash heal", "renew on party", "prayer of mending", "power word: shield on party", "heal", "dispel magic on party"],
  rogue: ["melee", "sinister strike", "eviscerate", "kick", "backstab", "slice and dice", "dps assist", "melee"],
  dk: ["melee", "icy touch", "plague strike", "death coil", "blood strike", "dps assist", "melee"],
  dps: ["melee", "dps assist", "melee"],
  idle: ["follow", "follow", "follow", "check mount state", "loot", "drink", "food", "auto talents", "equip upgrades", "follow"],
} as const;

const STRATS: Record<Role, { co: string[]; nc: string[] }> = {
  tank: { co: ["tank", "tank assist", "aoe", "potions"], nc: ["follow", "loot", "food", "mount"] },
  heal: { co: ["heal", "cast time", "conserve mana"], nc: ["follow", "loot", "food", "drink", "mount"] },
  dps: { co: ["dps", "dps assist", "aoe", "boost"], nc: ["follow", "loot", "food", "mount"] },
};

type QDef = {
  id: number; title: string; level: number; objs: [string, number][]; shareable: boolean;
  /** Blockers used by the compare logic (mock rules). */
  minLevel?: number; cls?: number; prereq?: number; daily?: boolean;
};
const QUESTS: QDef[] = [
  { id: 13232, title: "Into the Breach", level: 80, minLevel: 80, objs: [["Ymirjar Warrior slain", 8]], shareable: true },
  { id: 13285, title: "Fueling the Demolishers", level: 80, minLevel: 80, objs: [["Frostbrood Whelp slain", 6], ["Scourge Necromancer slain", 4]], shareable: true },
  { id: 12610, title: "Scouting the Ruins", level: 77, minLevel: 75, objs: [["Ruins scouted", 3]], shareable: true },
  { id: 12613, title: "Cleansing the Ruins", level: 77, minLevel: 75, prereq: 12610, objs: [["Nerubian Webweaver slain", 10]], shareable: true },
  { id: 12401, title: "Blightbeasts be Damned!", level: 76, minLevel: 74, objs: [["Blightbeast slain", 8]], shareable: true },
  { id: 12190, title: "The Etymidian", level: 79, minLevel: 77, objs: [["Etymidian Fragment collected", 5]], shareable: false },
  { id: 12778, title: "Reclaiming Wyrmrest", level: 78, minLevel: 76, objs: [["Azure Drake slain", 5], ["Wyrmrest Defender rescued", 3]], shareable: true },
  { id: 11543, title: "Trouble at the Docks", level: 68, minLevel: 64, objs: [["Defias Smuggler slain", 6]], shareable: true },
  { id: 10921, title: "Felsteel Foundations", level: 66, minLevel: 62, objs: [["Felsteel Ore gathered", 12]], shareable: true },
  { id: 13420, title: "Tribute to the Argent Crusade", level: 80, minLevel: 80, daily: true, objs: [["Argent Valor Token collected", 10]], shareable: true },
  { id: 12244, title: "Frostbrood Tidings", level: 74, minLevel: 72, objs: [["Frostbrood Scale collected", 7]], shareable: true },
  { id: 12500, title: "A Paladin's Duty", level: 80, minLevel: 80, cls: 2, objs: [["Argent Light retrieved", 3]], shareable: false },
  { id: 12931, title: "Argent Dawn Provisions", level: 72, minLevel: 70, objs: [["Salted Venison delivered", 5]], shareable: true },
];

/** Deterministic starting logs so every blocker / difference type is visible in the UI. */
const INIT_QUESTS: Record<string, { rewarded: number[]; quests: [number, number[]][] }> = {
  Michael: { rewarded: [12610], quests: [[13232, [5]], [13285, [3, 1]], [12613, [7]], [12778, [2, 0]], [13420, [4]], [12190, [2]], [12500, [1]]] },
  Grimjaw: { rewarded: [12610, 13420], quests: [[13232, [8]], [12613, [7]], [12244, [3]]] },
  Lyriel: { rewarded: [], quests: [[12778, [2, 0]], [12401, [2]], [12244, [5]]] },
  Rokhan: { rewarded: [], quests: [[11543, [2]], [10921, [5]]] },
  Mordrek: { rewarded: [12610], quests: [[12190, [2]], [12931, [1]]] },
};

const BLOCKER_TEXT: Record<QuestBlocker, string> = {
  level: "Level passt nicht", race: "Volk passt nicht", class: "Klasse passt nicht", skill: "Fertigkeit fehlt", reputation: "Ruf fehlt",
  prerequisite: "Vorquest fehlt", exclusive: "exklusive Alternative gewählt", chain: "Quest schon erledigt", repeat: "wiederholbare Quest schon erledigt",
  log_full: "Questlog voll", conditions: "Bedingungen nicht erfüllt", has_it: "hat die Quest bereits",
};
const GIVERS = ["Highlord Tirion Fordring", "Crusader Bridenbrad", "Alexstrasza the Life-Binder", "Duchess Mynx", "Marshal Falstad"];
const FAIL_REASONS = ["Bot ist gerade beschäftigt", "Bot antwortet nicht", "Bot ist zu weit vom Master entfernt", "Bot ist im Kampf"];

// ------------------------------------------------------------------ state types

type Sim = {
  m: Member;
  tpl: Tpl;
  loc: number;
  angle: number;
  dist: number;
  phase: number;
  actionAt: number;
  deadAt: number; // ms, 0 = alive
  reviveAt: number;
  fleeUntil: number;
  bagSizes: number[];
  /** Quests already handed in (not in the log any more). */
  rewarded: Set<number>;
};

type Combat = { mob: string; start: number; end: number; dieBot: string | null; dieAt: number } | null;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const EQUIP_SLOTS = [0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];

// ------------------------------------------------------------------ the source

export class MockSource implements Source {
  readonly kind = "mock" as const;
  private bots: Sim[] = [];
  private self!: Sim;
  private defs = new Map<number, ItemDef>();
  private timers = new Set<NodeJS.Timeout>();
  private tickTimer: NodeJS.Timeout | null = null;
  private masterState = { x: 0, y: 0, z: 0, o: 0, moving: true, phaseUntil: 0, loc: 0, gold: 54_321_000, level: 80 };
  private combat: Combat = null;
  private nextCombatAt = 0;
  private nextLocAt = 0;
  private nextOfferAt = 0;
  private offerSeq = 1;
  private readonly failRate = Number(process.env.MOCK_FAIL_RATE ?? 0.1);

  constructor(private readonly sink: Sink) {}

  // ---------------------------------------------------------------- lifecycle

  start() {
    const now = Date.now();
    const loc = LOCS[0]!;
    this.masterState = { ...this.masterState, x: loc.cx, y: loc.cy, z: loc.cz, moving: true, phaseUntil: now + 8000, loc: 0 };
    this.self = this.makeBot(SELF_TPL, true);
    this.bots = TEMPLATES.map((t) => this.makeBot(t));
    this.nextCombatAt = now + 6000;
    this.nextLocAt = now + rnd(150, 210) * 1000;
    this.nextOfferAt = now + 15_000;
    this.tickTimer = setInterval(() => this.tick(), 1000);
    this.tick();
  }

  stop() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  private later(ms: number, fn: () => void) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  // ---------------------------------------------------------------- item helpers

  private mk(def: ItemDef, count: number, slot: number, bag: number, opts?: Parameters<typeof toItem>[4]): Item {
    this.defs.set(def.entry, def);
    return toItem(def, count, slot, bag, opts);
  }

  // ---------------------------------------------------------------- bot factory

  private makeBot(t: Tpl, full = false): Sim {
    const level = t.level;
    const hpMax = Math.round((3000 + level * 250) * (t.role === "tank" ? 1.5 : t.role === "heal" ? 0.9 : 1));
    const powerMax = t.powerType === 0 ? Math.round(2000 + level * 270) : t.powerType === 3 ? 100 : 1000; // rage/runic power raw = x10
    const xpMax = level >= 80 ? 0 : 90_000 + level * level * 100;

    // equipment
    const slots = shuffle([...EQUIP_SLOTS.filter((s) => s !== 15)]).slice(0, full ? 16 : rint(9, 16));
    slots.push(15);
    if (full || Math.random() < 0.3) slots.push(3);
    if (full || Math.random() < 0.3) slots.push(18);
    const equipment: Item[] = [];
    for (const s of slots.sort((a, b) => a - b)) {
      let def: ItemDef;
      const notable = NOTABLE.filter((n) => n.slots?.includes(s) && n.req <= level && !(s === 15));
      if (s === 3) def = { entry: 4335, name: "Black Swashbuckler's Shirt", q: 1, ilvl: 1, req: 0, icon: "inv_shirt_black_01", sell: 100, stack: 1, bind: "boe", kind: "gear", slots: [3] };
      else if (s === 18) def = { entry: 45579, name: "Tabard of the Argent Crusade", q: 3, ilvl: 1, req: 0, icon: "inv_shirt_guildtabard_01", sell: 100, stack: 1, bind: "bop", kind: "gear", slots: [18] };
      else if (notable.length && Math.random() < 0.6) def = pick(notable);
      else def = makeGear(s, level, t.armor, t.weapons);
      equipment.push(this.mk(def, 1, s, 255, { soulbound: true }));
    }

    // bags
    const bagSizes = [16, ...shuffle([12, 14, 16, 18]).slice(0, 4)];
    const totalSlots = bagSizes.reduce((a, b) => a + b, 0);
    const defs: { def: ItemDef; count: number; bound?: boolean }[] = [];
    const add = (pool: ItemDef[], n: number) => shuffle([...pool]).slice(0, n).forEach((d) => defs.push({ def: d, count: d.stack > 1 ? rint(1, d.stack) : 1 }));
    add(CONSUMABLES, rint(3, 6));
    add(MATS, rint(3, 7));
    add(JUNK, rint(2, 5));
    add(QUEST_ITEMS, rint(0, 2));
    defs.push({ def: MISC[0]!, count: 1 });
    if (Math.random() < 0.7) defs.push({ def: pick(MISC.slice(1)), count: rint(1, 40) });
    for (let i = 0; i < rint(2, 4); i++) defs.push({ def: makeGear(pick(EQUIP_SLOTS), level, t.armor, t.weapons, { bind: "boe" }), count: 1 });
    for (let i = 0; i < rint(1, 3); i++) defs.push({ def: makeGear(pick(EQUIP_SLOTS), level, t.armor, t.weapons, { bind: "bop" }), count: 1 });
    if (t.name === "Grimjaw") defs.push({ def: NOTABLE.find((n) => n.entry === 49623)!, count: 1 });
    while (defs.length < 15) add([...CONSUMABLES, ...MATS, ...JUNK], 1);

    const positions: [number, number][] = [];
    bagSizes.forEach((size, bag) => {
      for (let s = 0; s < size; s++) positions.push([bag, s]);
    });
    const free = shuffle(positions.slice(0, Math.min(positions.length, Math.round(defs.length * 1.5)))).slice(0, defs.length);
    const bags = defs.map((d, i) => {
      const [bag, slot] = free[i]!;
      return this.mk(d.def, d.count, slot, bag);
    });

    const init = INIT_QUESTS[t.name] ?? { rewarded: [], quests: [] };
    const quests = init.quests.map(([id, cur]) => {
      const q = this.newQuest(QUESTS.find((d) => d.id === id)!, false);
      q.objectives.forEach((o, i) => (o.cur = Math.min(o.req, cur[i] ?? 0)));
      if (q.objectives.every((o) => o.cur >= o.req)) q.status = "complete";
      return q;
    });

    const m: Member = {
      guid: t.guid, name: t.name, isBot: !full,
      race: t.race, raceName: RACE_NAMES[t.race] ?? "Human", cls: t.cls, clsName: t.clsName, spec: t.spec,
      level, xp: xpMax ? rint(0, Math.floor(xpMax * 0.8)) : 0, xpMax,
      hp: hpMax, hpMax, powerType: t.powerType, power: t.powerType === 0 ? powerMax : t.powerType === 3 ? 100 : 0, powerMax,
      gold: t.gold, gearScore: 0, avgItemLevel: 0, durabilityPct: 100,
      state: "non-combat", lastAction: "follow", recentActions: ["check mount state", "loot", "follow"], queuedActions: [],
      target: null, strategies: JSON.parse(JSON.stringify(STRATS[t.role])), following: true, distanceToMaster: 0,
      pos: { map: 0, zone: 0, zoneName: "", area: 0, areaName: "", x: 0, y: 0, z: 0, o: 0 },
      stats: this.stats(t, level),
      equipment, bags, bagSlots: bagSizes.map((size, bag) => this.mockBag(bag, size)), freeSlots: 0, totalSlots, quests, pendingQuestOffers: [],
      questCompare: { missingOnBot: [], missingOnMaster: [], differing: [], inSync: 0, botLogFull: false },
    };
    const sim: Sim = {
      m, tpl: t, loc: 0, angle: rnd(0, Math.PI * 2), dist: rnd(3, 9), phase: rnd(0, 6.28),
      actionAt: 0, deadAt: 0, reviveAt: 0, fleeUntil: 0, bagSizes, rewarded: new Set(init.rewarded),
    };
    this.placeAtMaster(sim);
    this.derive(sim);
    return sim;
  }

  private mockBag(bag: number, size: number): BagInfo {
    if (bag === 0) return { bag, entry: 0, name: "Rucksack", quality: 1, icon: "inv_misc_bag_08", size };
    const names: Record<number, [string, number, string]> = {
      12: ["Wolltasche", 1, "inv_misc_bag_10"], 14: ["Seidentasche", 2, "inv_misc_bag_11"],
      16: ["Magiestofftasche", 2, "inv_misc_bag_12"], 18: ["Runenstofftasche", 3, "inv_misc_bag_13"],
    };
    const [name, quality, icon] = names[size] ?? ["Tasche", 1, "inv_misc_bag_09"];
    return { bag, entry: 4000 + size, name, quality: quality as BagInfo["quality"], icon, size };
  }

  private stats(t: Tpl, level: number): Member["stats"] {
    const f = level / 80;
    const j = (v: number) => Math.round(v * f * rnd(0.9, 1.1));
    const p = (v: number) => Math.round(v * f * rnd(0.85, 1.15) * 100) / 100;
    const tank = t.role === "tank";
    const heal = t.role === "heal";
    return {
      str: j(tank ? 520 : t.cls === 6 ? 560 : 120), agi: j(t.cls === 4 ? 620 : tank ? 210 : 140), sta: j(tank ? 640 : 380),
      int: j(heal ? 480 : 90), spi: j(heal ? 390 : 80),
      armor: j(t.armor === "plate" ? 14500 : t.armor === "leather" ? 7800 : 3600) + (tank ? 4000 : 0),
      attackPower: j(t.role === "dps" ? 2600 : tank ? 1500 : 200), rangedAttackPower: j(t.cls === 4 ? 1200 : 300),
      spellPower: j(heal ? 2100 : 0), healingPower: j(heal ? 2300 : 0),
      critPct: p(t.role === "dps" ? 26 : 12), spellCritPct: p(heal ? 18 : 4), rangedCritPct: p(t.cls === 4 ? 21 : 8),
      hitPct: p(t.role === "dps" ? 8 : 4), spellHitPct: p(heal ? 6 : 1), hastePct: p(heal ? 14 : 6),
      dodgePct: p(tank ? 18 : t.cls === 4 ? 24 : 6), parryPct: p(tank ? 17 : t.cls === 6 ? 13 : 5), blockPct: p(tank ? 24 : 0),
      resist: { holy: 0, fire: rint(0, 25), nature: rint(0, 25), frost: rint(0, 40), shadow: rint(0, 25), arcane: rint(0, 25) },
      mp5: j(heal ? 480 : t.powerType === 0 ? 120 : 0),
    };
  }

  private newQuest(q: QDef, partial: boolean): Quest {
    const objectives = q.objs.map(([text, req]) => ({ text, cur: partial ? rint(0, req - 1) : 0, req }));
    return { id: q.id, title: q.title, level: q.level, status: "incomplete", objectives, shareable: q.shareable };
  }

  // ---------------------------------------------------------------- derived values

  private areaFor(loc: Loc, x: number, y: number) {
    const a = Math.atan2(y - loc.cy, x - loc.cx) + Math.PI;
    return loc.areas[Math.floor((a / (Math.PI * 2)) * loc.areas.length) % loc.areas.length]!;
  }

  private placeAtMaster(s: Sim) {
    const ms = this.masterState;
    s.loc = ms.loc;
    s.m.pos.x = ms.x + Math.cos(s.angle) * s.dist;
    s.m.pos.y = ms.y + Math.sin(s.angle) * s.dist;
    s.m.pos.z = ms.z;
  }

  private derive(s: Sim) {
    const m = s.m;
    const loc = LOCS[s.loc]!;
    const area = this.areaFor(loc, m.pos.x, m.pos.y);
    m.pos = { ...m.pos, map: loc.map, zone: loc.zone, zoneName: loc.zoneName, area: area.id, areaName: area.name };
    const ms = this.masterState;
    m.distanceToMaster = s.loc === ms.loc ? Math.round(Math.hypot(m.pos.x - ms.x, m.pos.y - ms.y, m.pos.z - ms.z) * 10) / 10 : null;
    m.following = m.strategies.nc.includes("follow");
    const dur = m.equipment.filter((i) => i.durability);
    m.durabilityPct = dur.length ? Math.round((dur.reduce((a, i) => a + (i.durability!.cur / i.durability!.max) * 100, 0) / dur.length) * 10) / 10 : 100;
    m.freeSlots = m.totalSlots - m.bags.length;
    const gear = m.equipment.filter((i) => ![3, 18].includes(i.slot));
    m.avgItemLevel = gear.length ? Math.round(gear.reduce((a, i) => a + i.itemLevel, 0) / gear.length) : 0;
    m.gearScore = Math.round(gear.reduce((a, i) => a + i.itemLevel * (1 + i.quality * 0.18), 0) * 1.4);
  }

  // ---------------------------------------------------------------- simulation

  private emit(type: PartyEvent["type"], bot: string, text: string, data?: Record<string, unknown>) {
    this.sink.event({ type, bot, text, ts: Math.floor(Date.now() / 1000), ...(data ? { data } : {}) });
  }

  private pushAction(s: Sim, a: string, queued: string[] = []) {
    const m = s.m;
    m.lastAction = a;
    m.recentActions = [...m.recentActions.filter((_, i, arr) => i >= arr.length - 5), a];
    m.queuedActions = queued;
  }

  private tick() {
    const now = Date.now();
    const ms = this.masterState;

    // location change: everyone who follows comes along, others stay behind
    if (now >= this.nextLocAt) {
      ms.loc = (ms.loc + 1) % LOCS.length;
      const l = LOCS[ms.loc]!;
      ms.x = l.cx; ms.y = l.cy; ms.z = l.cz;
      this.nextLocAt = now + rnd(150, 210) * 1000;
      this.combat = null;
      for (const s of this.bots) if (s.m.strategies.nc.includes("follow") && !s.deadAt) this.placeAtMaster(s);
      this.emit("info", "Michael", `Gruppe reist nach ${l.zoneName}`);
    }

    // master wandering
    if (now >= ms.phaseUntil) {
      ms.moving = !ms.moving;
      ms.phaseUntil = now + (ms.moving ? rnd(8, 16) : rnd(4, 9)) * 1000;
      ms.o += rnd(-1, 1);
    }
    const loc = LOCS[ms.loc]!;
    if (ms.moving && !this.combat) {
      ms.o += rnd(-0.15, 0.15);
      ms.x += Math.cos(ms.o) * 7;
      ms.y += Math.sin(ms.o) * 7;
      if (Math.hypot(ms.x - loc.cx, ms.y - loc.cy) > loc.r) ms.o = Math.atan2(loc.cy - ms.y, loc.cx - ms.x);
    }
    ms.z = loc.cz + Math.sin(now / 9000) * 4;

    // combat scheduling
    const here = this.bots.filter((s) => s.loc === ms.loc && !s.deadAt);
    if (!this.combat && now >= this.nextCombatAt && here.length) {
      const dur = rnd(9, 16) * 1000;
      const victims = here.filter((s) => s.tpl.role !== "tank");
      const dies = Math.random() < 0.12 && victims.length;
      this.combat = {
        mob: pick(loc.mobs), start: now, end: now + dur,
        dieBot: dies ? pick(victims).m.name : null, dieAt: now + dur * rnd(0.3, 0.7),
      };
      this.emit("info", "Michael", `Kampf gegen ${this.combat.mob} beginnt`);
    } else if (this.combat && now >= this.combat.end) {
      this.endCombat(now);
    }
    const c = this.combat;
    const mobHp = c ? clamp(100 * (1 - (now - c.start) / (c.end - c.start)), 0, 100) : 0;

    // per bot
    for (const s of this.bots) {
      const m = s.m;
      const t = now / 1000;
      const sameLoc = s.loc === ms.loc;

      if (s.deadAt) {
        if (now >= s.reviveAt) {
          s.deadAt = 0;
          m.hp = Math.round(m.hpMax * 0.4);
          m.state = "non-combat";
          this.pushAction(s, "revive from corpse");
        } else {
          m.state = "dead";
          m.hp = 0;
          m.target = null;
          const da = now - s.deadAt < 3000 ? "release" : "revive from corpse";
          if (m.lastAction !== da) this.pushAction(s, da);
          this.derive(s);
          continue;
        }
      }

      const inCombat = !!c && sameLoc && now >= s.fleeUntil;
      if (c && c.dieBot === m.name && now >= c.dieAt && sameLoc) {
        c.dieBot = null;
        s.deadAt = now;
        s.reviveAt = now + rnd(12, 20) * 1000;
        m.state = "dead";
        m.hp = 0;
        m.target = null;
        m.durabilityPct = Math.max(0, m.durabilityPct - 8);
        for (const it of m.equipment) if (it.durability) it.durability.cur = Math.max(0, Math.round(it.durability.cur * 0.92));
        this.emit("bot_death", m.name, `${m.name} ist gestorben (${c.mob})`);
        this.derive(s);
        continue;
      }

      // movement
      if (m.strategies.nc.includes("follow") && sameLoc) {
        const tx = ms.x + Math.cos(s.angle) * s.dist;
        const ty = ms.y + Math.sin(s.angle) * s.dist;
        const d = Math.hypot(tx - m.pos.x, ty - m.pos.y);
        const step = Math.min(d, 9);
        if (d > 150) this.placeAtMaster(s);
        else if (d > 0.5) {
          m.pos.x += ((tx - m.pos.x) / d) * step;
          m.pos.y += ((ty - m.pos.y) / d) * step;
          m.pos.o = Math.atan2(ty - m.pos.y, tx - m.pos.x);
        }
        m.pos.z = ms.z;
      }

      // state, hp, power, target
      m.state = inCombat ? "combat" : "non-combat";
      const wave = Math.sin(t * 0.9 + s.phase);
      let hpFrac = m.hp / m.hpMax;
      if (inCombat) {
        const goal = s.tpl.role === "tank" ? 0.62 + 0.28 * wave : s.tpl.role === "heal" ? 0.93 + 0.05 * wave : 0.84 + 0.14 * wave;
        hpFrac += (clamp(goal, 0.2, 1) - hpFrac) * 0.35;
      } else hpFrac = Math.min(1, hpFrac + 0.06);
      m.hp = Math.round(clamp(hpFrac, 0.02, 1) * m.hpMax);

      const pf = m.power / m.powerMax;
      if (m.powerType === 0) m.power = Math.round(clamp(pf + (inCombat ? -0.007 * (s.tpl.role === "heal" ? 1.6 : 1) : 0.025), 0.04, 1) * m.powerMax);
      else if (m.powerType === 3) m.power = Math.round(clamp(inCombat ? 55 + 45 * Math.sin(t * 2.2 + s.phase) : m.power + 10, 0, 100));
      else if (m.powerType === 1) m.power = Math.round(clamp(inCombat ? 480 + 320 * Math.sin(t * 1.3 + s.phase) : m.power - 25, 0, 1000));
      else m.power = Math.round(clamp(inCombat ? m.power + 60 - (Math.sin(t + s.phase) > 0.85 ? 500 : 0) : m.power - 40, 0, 1000));

      if (inCombat && c) {
        if (s.tpl.role === "heal") {
          const tank = this.bots.find((b) => b.tpl.role === "tank" && !b.deadAt);
          m.target = tank ? { name: tank.m.name, hpPct: Math.round((tank.m.hp / tank.m.hpMax) * 100) } : null;
        } else m.target = { name: c.mob, hpPct: Math.round(clamp(mobHp + rnd(-3, 3), 0, 100)) };
      } else m.target = null;

      // actions
      if (now >= s.actionAt) {
        s.actionAt = now + rnd(900, 2200);
        const pool: readonly string[] = inCombat ? (s.tpl.cls === 4 ? ACTIONS.rogue : s.tpl.cls === 6 ? ACTIONS.dk : ACTIONS[s.tpl.role]) : ACTIONS.idle;
        let a = pick(pool);
        if (a === m.lastAction) a = pick(pool);
        if (inCombat && m.hp / m.hpMax < 0.3) a = "flee";
        const queued = inCombat && m.target && s.tpl.role !== "heal" && Math.random() < 0.4 ? [`Angriff auf ${m.target.name}`] : [];
        this.pushAction(s, a, queued);
      }
      this.derive(s);
    }

    // quest offers
    for (const s of this.bots) {
      const before = s.m.pendingQuestOffers.length;
      s.m.pendingQuestOffers = s.m.pendingQuestOffers.filter((o) => o.expiresTs * 1000 > now);
      if (s.m.pendingQuestOffers.length < before) this.emit("info", s.m.name, `Quest-Angebot an ${s.m.name} ist abgelaufen`);
    }
    if (now >= this.nextOfferAt) {
      this.nextOfferAt = now + rnd(30, 60) * 1000;
      if (!this.bots.some((s) => s.m.pendingQuestOffers.length)) {
        const alive = this.bots.filter((b) => !b.deadAt);
        const s = alive.length ? pick(alive) : null;
        const cands = s ? QUESTS.filter((d) => this.blockerFor(s, d) === null) : [];
        if (s && cands.length) this.offer(s, pick(cands), pick(GIVERS));
      }
    }

    this.updateSelf(now, !!this.combat);
    this.publish();
  }

  private offer(s: Sim, q: QDef, from: string) {
    const o: QuestOffer = { offerId: `offer-${this.offerSeq++}`, questId: q.id, title: q.title, from, expiresTs: Math.floor(Date.now() / 1000) + 120 };
    s.m.pendingQuestOffers.push(o);
    this.emit("quest_offer", s.m.name, `${from} bietet ${s.m.name} die Quest "${q.title}" an`, { offerId: o.offerId, questId: q.id });
  }

  private endCombat(now: number) {
    const c = this.combat!;
    this.combat = null;
    this.nextCombatAt = now + rnd(18, 40) * 1000;
    const ms = this.masterState;
    this.emit("info", "Michael", `${c.mob} besiegt`);
    this.self.m.gold += rint(100, 3000);
    this.progressQuest(this.self);
    for (const s of this.bots) {
      if (s.deadAt || s.loc !== ms.loc) continue;
      const m = s.m;
      m.gold += rint(200, 5000);
      if (m.xpMax) {
        m.xp += rint(300, 900) * Math.max(1, Math.round(m.level / 30));
        if (m.xp >= m.xpMax) {
          m.level += 1;
          m.xp -= m.xpMax;
          m.xpMax = m.level >= 80 ? 0 : 90_000 + m.level * m.level * 100;
          m.hpMax = Math.round(m.hpMax * 1.03);
          this.emit("bot_levelup", m.name, `${m.name} hat Stufe ${m.level} erreicht`, { level: m.level });
        }
      }
      for (const it of m.equipment) if (it.durability && Math.random() < 0.5) it.durability.cur = Math.max(0, it.durability.cur - 1);
      this.progressQuest(s);
      if (Math.random() < 0.4) {
        const def = pick([...CONSUMABLES, ...MATS, ...JUNK]);
        if (this.addToBags(s, def, rint(1, Math.min(3, def.stack)))) this.emit("info", m.name, `${m.name} plündert ${def.name}`);
      }
    }
  }

  private progressQuest(s: Sim) {
    const m = s.m;
    const q = m.quests.find((x) => x.status === "incomplete" && x.objectives.some((o) => o.cur < o.req));
    if (!q || Math.random() > 0.7) return;
    const o = q.objectives.find((x) => x.cur < x.req)!;
    o.cur += 1;
    if (q.objectives.every((x) => x.cur >= x.req)) {
      q.status = "complete";
      this.emit("quest_update", m.name, `${m.name}: Quest "${q.title}" abgeschlossen`, { questId: q.id });
    } else this.emit("quest_update", m.name, `${m.name}: ${o.text} ${o.cur}/${o.req}`, { questId: q.id });
  }

  /** The master's active character: position follows the master, vitals wobble. */
  private updateSelf(now: number, inCombat: boolean) {
    const ms = this.masterState;
    const s = this.self;
    const m = s.m;
    const t = now / 1000;
    s.loc = ms.loc;
    m.pos.x = ms.x; m.pos.y = ms.y; m.pos.z = ms.z; m.pos.o = ms.o;
    const f = m.hp / m.hpMax;
    m.hp = Math.round(Math.min(1, inCombat ? f + (0.86 + 0.1 * Math.sin(t * 0.8) - f) * 0.3 : f + 0.05) * m.hpMax);
    m.power = Math.round(Math.max(0.05, Math.min(1, m.power / m.powerMax + (inCombat ? -0.006 : 0.02))) * m.powerMax);
    this.derive(s);
  }

  private blockerFor(s: Sim, def: QDef): QuestBlocker | null {
    const m = s.m;
    if (m.quests.some((q) => q.id === def.id)) return "has_it";
    if (s.rewarded.has(def.id)) return def.daily ? "repeat" : "chain";
    if (m.level < (def.minLevel ?? 1)) return "level";
    if (def.cls && def.cls !== m.cls) return "class";
    if (def.prereq && !s.rewarded.has(def.prereq)) return "prerequisite";
    if (m.quests.length >= 25) return "log_full";
    return null;
  }

  private compare(s: Sim): QuestCompare {
    const mine = this.self;
    const out: QuestCompare = { missingOnBot: [], missingOnMaster: [], differing: [], inSync: 0, botLogFull: s.m.quests.length >= 25 };
    for (const q of mine.m.quests) {
      const b = s.m.quests.find((x) => x.id === q.id);
      if (!b) {
        const def = QUESTS.find((d) => d.id === q.id);
        out.missingOnBot.push({
          id: q.id, title: q.title, level: q.level,
          master: { state: q.status, objectives: q.objectives },
          bot: { state: s.rewarded.has(q.id) ? "rewarded" : "none", objectives: [], blocker: def ? this.blockerFor(s, def) : "conditions" },
        });
        continue;
      }
      const same = b.status === q.status && b.objectives.length === q.objectives.length && b.objectives.every((o, i) => o.cur === q.objectives[i]!.cur);
      if (same) out.inSync += 1;
      else
        out.differing.push({
          id: q.id, title: q.title, level: q.level,
          master: { state: q.status, objectives: q.objectives },
          bot: { state: b.status, objectives: b.objectives, blocker: "has_it" },
        });
    }
    for (const b of s.m.quests) {
      if (mine.m.quests.some((x) => x.id === b.id)) continue;
      out.missingOnMaster.push({
        id: b.id, title: b.title, level: b.level,
        master: { state: mine.rewarded.has(b.id) ? "rewarded" : "none", objectives: [] },
        bot: { state: b.status, objectives: b.objectives, blocker: "has_it" },
      });
    }
    return out;
  }

  private addToBags(s: Sim, def: ItemDef, count: number): boolean {
    const m = s.m;
    const stack = m.bags.find((i) => i.entry === def.entry && def.stack > 1 && i.count + count <= def.stack);
    if (stack) {
      stack.count += count;
      return true;
    }
    const spot = this.freeSpot(s);
    if (!spot) return false;
    m.bags.push(this.mk(def, count, spot[1], spot[0]));
    return true;
  }

  private freeSpot(s: Sim): [number, number] | null {
    const used = new Set(s.m.bags.map((i) => `${i.bag}:${i.slot}`));
    for (let bag = 0; bag < s.bagSizes.length; bag++)
      for (let slot = 0; slot < s.bagSizes[bag]!; slot++) if (!used.has(`${bag}:${slot}`)) return [bag, slot];
    return null;
  }

  private publish() {
    const ms = this.masterState;
    const loc = LOCS[ms.loc]!;
    const area = this.areaFor(loc, ms.x, ms.y);
    const members = structuredClone(this.bots.map((s) => ({ ...s.m, questCompare: this.compare(s) })));
    const me = structuredClone(this.self.m);
    const self: Character = {
      guid: me.guid, name: me.name, race: me.race, raceName: me.raceName, cls: me.cls, clsName: me.clsName, spec: me.spec,
      level: me.level, xp: me.xp, xpMax: me.xpMax, hp: me.hp, hpMax: me.hpMax, powerType: me.powerType, power: me.power,
      powerMax: me.powerMax, gold: me.gold, gearScore: me.gearScore, avgItemLevel: me.avgItemLevel, durabilityPct: me.durabilityPct,
      equipment: me.equipment, bags: me.bags, bagSlots: me.bagSlots, freeSlots: me.freeSlots, totalSlots: me.totalSlots, quests: me.quests, pos: me.pos, stats: me.stats,
    };
    const snap: Snapshot = {
      v: 1,
      ts: Math.floor(Date.now() / 1000),
      master: {
        accountId: 1, guid: 1, name: me.name, level: me.level, gold: me.gold,
        map: loc.map, zone: loc.zone, zoneName: loc.zoneName, areaName: area.name,
      },
      goldTotal: me.gold + members.reduce((a, m) => a + m.gold, 0),
      self,
      members,
    };
    this.sink.snapshot(snap);
  }

  // ---------------------------------------------------------------- commands

  async submit(cmd: Command): Promise<void> {
    const targets = cmd.bot === "*" ? this.bots.map((b) => b.m.name) : [cmd.bot];
    for (const name of targets) {
      this.later(rint(100, 400), () => this.deliver(cmd, name));
    }
  }

  private result(cmd: Command, bot: string, ok: boolean, message: string) {
    const r: CommandResult = { id: cmd.id, ok, message, bot, op: cmd.op, ts: Math.floor(Date.now() / 1000) };
    this.sink.result(r);
  }

  private deliver(cmd: Command, name: string) {
    const s = this.bots.find((b) => b.m.name.toLowerCase() === name.toLowerCase());
    if (!s) return this.result(cmd, name, false, `Bot "${name}" ist nicht in der Gruppe`);
    if (Math.random() < this.failRate) return this.result(cmd, s.m.name, false, pick(FAIL_REASONS));
    if (s.deadAt && cmd.op !== "release" && cmd.op !== "revive") return this.result(cmd, s.m.name, false, "Bot ist tot");
    const plan = this.plan(s, cmd);
    this.result(cmd, s.m.name, plan.ok, plan.message);
    if (plan.ok && plan.effect) {
      // effect happens on the bot's next AI tick, i.e. after the "delivered" result
      this.later(rint(500, 1500), () => {
        plan.effect!();
        this.derive(s);
        this.publish();
      });
    }
  }

  private plan(s: Sim, cmd: Command): { ok: boolean; message: string; effect?: () => void } {
    const m = s.m;
    const a = (cmd.args ?? {}) as Record<string, any>;
    const fail = (message: string) => ({ ok: false, message });
    const ok = (message: string, effect?: () => void) => ({ ok: true, message, effect });
    const setNc = (add: string[], del: string[]) => {
      m.strategies.nc = m.strategies.nc.filter((x) => !del.includes(x));
      for (const x of add) if (!m.strategies.nc.includes(x)) m.strategies.nc.push(x);
    };
    const op: Op = cmd.op;

    switch (op) {
      case "follow": return ok("Folgt dem Master", () => { setNc(["follow"], ["stay"]); this.pushAction(s, "follow"); });
      case "stay": return ok("Bleibt stehen", () => { setNc(["stay"], ["follow"]); this.pushAction(s, "stay"); });
      case "flee": return ok("Flieht zum Master", () => { s.fleeUntil = Date.now() + 6000; this.pushAction(s, "flee"); });
      case "grind": return ok("Grind-Modus aktiviert", () => { setNc(["grind"], []); this.pushAction(s, "grind"); });
      case "attack": return ok("Greift das Ziel des Masters an", () => {
        if (!this.combat && s.loc === this.masterState.loc) {
          const loc = LOCS[s.loc]!;
          this.combat = { mob: pick(loc.mobs), start: Date.now(), end: Date.now() + rnd(8, 12) * 1000, dieBot: null, dieAt: 0 };
        }
        this.pushAction(s, "attack my target");
      });
      case "summon": return ok("Wird zum Master teleportiert", () => { this.placeAtMaster(s); this.pushAction(s, "summon"); });
      case "release": return m.state === "dead" ? ok("Geist wird freigelassen", () => this.pushAction(s, "release")) : fail("Bot lebt noch");
      case "revive": return m.state === "dead"
        ? ok("Wird wiederbelebt", () => { s.deadAt = 0; m.hp = Math.round(m.hpMax * 0.35); m.state = "non-combat"; this.pushAction(s, "revive from corpse"); })
        : fail("Bot lebt noch");
      case "repair": return ok("Reparatur eingeleitet", () => { for (const i of m.equipment) if (i.durability) i.durability.cur = i.durability.max; this.pushAction(s, "repair"); });
      case "maintenance": return ok("Wartung eingeleitet (Reparatur + Müll verkaufen)", () => {
        for (const i of m.equipment) if (i.durability) i.durability.cur = i.durability.max;
        const junk = m.bags.filter((i) => i.quality === 0);
        m.gold += junk.reduce((g, i) => g + i.sellPrice * i.count, 0);
        m.bags = m.bags.filter((i) => i.quality !== 0);
        this.pushAction(s, "sell");
      });
      case "loot-all": return ok("Plündert alles in Reichweite", () => {
        m.gold += rint(50, 3000);
        if (Math.random() < 0.6) this.addToBags(s, pick([...MATS, ...JUNK]), rint(1, 4));
        this.pushAction(s, "loot");
      });

      case "quest.accept": {
        const id = Number(a.questId);
        const known = QUESTS.find((q) => q.id === id);
        const blocker = known ? this.blockerFor(s, known) : m.quests.some((q) => q.id === id) ? "has_it" : null;
        if (blocker) return fail(`Bot kann die Quest nicht annehmen: ${BLOCKER_TEXT[blocker]}`);
        const def = known ?? { id, title: `Quest #${id}`, level: m.level, objs: [["Ziel erreicht", 3]] as [string, number][], shareable: true };
        return ok(`Quest "${def.title}" wird angenommen`, () => { m.quests.push(this.newQuest(def, false)); this.emit("quest_update", m.name, `${m.name} nimmt "${def.title}" an`, { questId: id }); });
      }
      case "quest.abandon": {
        const q = m.quests.find((x) => x.id === Number(a.questId));
        if (!q) return fail("Bot hat diese Quest nicht");
        return ok(`Quest "${q.title}" wird abgebrochen`, () => { m.quests = m.quests.filter((x) => x.id !== q.id); });
      }
      case "quest.share": {
        const q = m.quests.find((x) => x.id === Number(a.questId));
        if (!q) return fail("Bot hat diese Quest nicht");
        if (!q.shareable) return fail("Diese Quest kann nicht geteilt werden");
        return ok(`Quest "${q.title}" wird geteilt`, () => {
          const def = QUESTS.find((d) => d.id === q.id);
          if (!def) return;
          for (const o of this.bots) if (o !== s && !o.deadAt && !o.m.quests.some((x) => x.id === q.id) && !o.m.pendingQuestOffers.length) this.offer(o, def, m.name);
        });
      }
      case "quest.offer.accept":
      case "quest.offer.decline": {
        const o = m.pendingQuestOffers.find((x) => x.offerId === a.offerId);
        if (!o) return fail("Angebot ist abgelaufen oder existiert nicht");
        const accept = op === "quest.offer.accept";
        return ok(accept ? `Angebot "${o.title}" wird angenommen` : `Angebot "${o.title}" wird abgelehnt`, () => {
          m.pendingQuestOffers = m.pendingQuestOffers.filter((x) => x.offerId !== o.offerId);
          if (accept) {
            const def = QUESTS.find((d) => d.id === o.questId);
            if (def) m.quests.push(this.newQuest(def, false));
          }
        });
      }

      case "item.destroy": {
        const it = m.bags.find((i) => i.entry === Number(a.entry));
        if (!it) return fail("Item ist nicht in den Taschen");
        return ok(`Vernichtet: ${it.name} x${it.count}`, () => { m.bags = m.bags.filter((i) => i !== it && !(i.bag === it.bag && i.slot === it.slot)); });
      }
      case "item.trade": {
        const list = (Array.isArray(a.items) ? a.items : []) as { entry: number }[];
        const found: Item[] = [];
        for (const { entry } of list) {
          const it = m.bags.find((i) => i.entry === entry && !found.includes(i));
          if (!it) return fail(`Item ${entry} ist nicht in den Taschen`);
          if (!it.tradeable) return fail(`${it.name} ist seelengebunden und kann nicht gehandelt werden`);
          found.push(it);
        }
        if (s.m.distanceToMaster === null || s.m.distanceToMaster > 30) return fail("Bot ist nicht in Handelsreichweite des Masters");
        return ok(`Handel geöffnet mit ${found.length} Item(s) - bitte im Spiel bestätigen`, () => {
          const keys = new Set(found.map((i) => `${i.bag}:${i.slot}`));
          m.bags = m.bags.filter((i) => !keys.has(`${i.bag}:${i.slot}`));
          this.emit("trade_opened", m.name, `${m.name} bietet ${found.map((i) => `${i.name}${i.count > 1 ? ` x${i.count}` : ""}`).join(", ")} zum Handel an`);
        });
      }
      case "item.equip": {
        const it = m.bags.find((i) => i.entry === Number(a.entry));
        if (!it) return fail("Item ist nicht in den Taschen");
        const def = this.defs.get(it.entry);
        if (!def?.slots) return fail(`${it.name} ist keine Ausrüstung`);
        if (it.requiredLevel > m.level) return fail(`${it.name} erfordert Stufe ${it.requiredLevel}`);
        return ok(`Legt ${it.name} an`, () => {
          const slot = def.slots!.find((sl) => !m.equipment.some((e) => e.slot === sl)) ?? def.slots![0]!;
          const old = m.equipment.find((e) => e.slot === slot);
          m.bags = m.bags.filter((i) => i !== it);
          m.equipment = m.equipment.filter((e) => e !== old);
          m.equipment.push({ ...it, slot, bag: 255, soulbound: true, tradeable: false });
          if (old) m.bags.push({ ...old, slot: it.slot, bag: it.bag });
          m.equipment.sort((x, y) => x.slot - y.slot);
          this.pushAction(s, "equip upgrades");
        });
      }
      case "item.unequip": {
        const it = m.equipment.find((i) => i.entry === Number(a.entry));
        if (!it) return fail("Item ist nicht angelegt");
        if (!this.freeSpot(s)) return fail("Taschen sind voll");
        return ok(`Legt ${it.name} ab`, () => {
          const spot = this.freeSpot(s);
          if (!spot) return;
          m.equipment = m.equipment.filter((i) => i !== it);
          m.bags.push({ ...it, bag: spot[0], slot: spot[1] });
        });
      }
      case "item.use": {
        const it = m.bags.find((i) => i.entry === Number(a.entry));
        if (!it) return fail("Item ist nicht in den Taschen");
        const def = this.defs.get(it.entry);
        if (!def || def.kind !== "consumable") return fail(`${it.name} kann nicht benutzt werden`);
        return ok(`Benutzt ${it.name}`, () => {
          if (def.use === "heal") m.hp = Math.min(m.hpMax, m.hp + Math.round(m.hpMax * 0.3));
          if (def.use === "mana" && m.powerType === 0) m.power = Math.min(m.powerMax, m.power + Math.round(m.powerMax * 0.3));
          it.count -= 1;
          if (it.count <= 0) m.bags = m.bags.filter((i) => i !== it);
          this.pushAction(s, def.use === "food" ? "food" : def.use === "drink" ? "drink" : "use item");
        });
      }
      case "item.sell": {
        const it = m.bags.find((i) => i.entry === Number(a.entry));
        if (!it) return fail("Item ist nicht in den Taschen");
        if (it.sellPrice <= 0) return fail(`${it.name} kann nicht verkauft werden`);
        return ok(`Verkauft ${it.name} x${it.count}`, () => { m.gold += it.sellPrice * it.count; m.bags = m.bags.filter((i) => i !== it); this.pushAction(s, "sell"); });
      }

      case "strategy": {
        const scope = a.scope === "co" ? "co" : "nc";
        const parts = String(a.changes ?? "").split(",").map((p) => p.trim()).filter(Boolean);
        return ok(`Strategie ${scope}: ${parts.join(" ")}`, () => this.applyStrategy(s, scope, parts));
      }
      case "chat": {
        const text = String(a.text ?? "").trim();
        const mm = /^(co|nc)\s+(.+)$/i.exec(text);
        if (mm) {
          const parts = mm[2]!.split(",").map((p) => p.trim()).filter(Boolean);
          return ok(`Befehl zugestellt: "${text}"`, () => this.applyStrategy(s, mm[1]!.toLowerCase() as "co" | "nc", parts));
        }
        return ok(`Befehl zugestellt: "${text}"`, () => this.pushAction(s, text.split(" ")[0] ?? "chat"));
      }
    }
  }

  private applyStrategy(s: Sim, scope: "co" | "nc", parts: string[]) {
    const list = new Set(s.m.strategies[scope]);
    for (const p of parts) {
      const sign = p[0];
      const name = p.slice(1).trim();
      if (!name) continue;
      if (sign === "+") list.add(name);
      else if (sign === "-") list.delete(name);
      else if (sign === "~") list.has(name) ? list.delete(name) : list.add(name);
    }
    s.m.strategies[scope] = [...list];
    this.derive(s);
  }
}
