/**
 * Illustrative WotLK-style item data for the mock. Names/IDs/icons are plausible, not a database extract
 * (the icon fallback in the UI handles the odd unknown icon name).
 */
import type { Item } from "../../../shared/protocol";

export type Rng = () => number;
export const rnd = (a: number, b: number) => a + Math.random() * (b - a);
export const rint = (a: number, b: number) => Math.floor(rnd(a, b + 1));
export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]!;
export const shuffle = <T>(arr: T[]): T[] => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
};

const QUALITY_HEX = ["9d9d9d", "ffffff", "1eff00", "0070dd", "a335ee", "ff8000", "e6cc80", "00ccff"];

export const makeLink = (entry: number, name: string, q: number) =>
  `|cff${QUALITY_HEX[q] ?? "ffffff"}|Hitem:${entry}:0:0:0:0:0:0:0:0:0|h[${name}]|h|r`;

export type Kind = "gear" | "consumable" | "mat" | "junk" | "quest" | "misc";
export type Use = "heal" | "mana" | "food" | "drink" | "other";

export type ItemDef = {
  entry: number;
  name: string;
  q: Item["quality"];
  ilvl: number;
  req: number;
  icon: string;
  sell: number; // copper per unit
  stack: number;
  bind: "none" | "boe" | "bop" | "quest";
  kind: Kind;
  slots?: number[]; // equipment slots this can go to
  use?: Use;
  hasDurability?: boolean;
};

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
const two = (n: number) => String(n).padStart(2, "0");

// ---------------------------------------------------------------- gear generator

export type ArmorType = "cloth" | "leather" | "mail" | "plate";
export type WeaponSet = { mh: string; oh?: string; ranged?: string; mhIcon: string; ohIcon?: string; rangedIcon?: string };

const SETS: { minLevel: number; names: string[]; ilvl: [number, number]; q: (Item["quality"])[] }[] = [
  { minLevel: 60, names: ["Felsteel", "Adamantite", "Netherscale", "Terokkar", "Bloodthistle"], ilvl: [100, 125], q: [2, 3, 3] },
  { minLevel: 70, names: ["Borean", "Arctic", "Iceshear", "Nerubian", "Saronite", "Thunderstorm"], ilvl: [150, 187], q: [2, 3, 3, 3] },
  { minLevel: 80, names: ["Saronite War", "Sanctified Scourgelord", "Frostwolf", "Crusader's", "Ymirjar Lord's", "Valorous"], ilvl: [200, 264], q: [3, 4, 4, 4] },
];

type SlotSpec = { slot: number; noun: string; icon: (t: ArmorType, n: number) => string };
const SLOT_SPECS: SlotSpec[] = [
  { slot: 0, noun: "Helm", icon: (_t, n) => `inv_helmet_${two(n % 90 + 1)}` },
  { slot: 1, noun: "Pendant", icon: (_t, n) => `inv_jewelry_necklace_${two(n % 30 + 1)}` },
  { slot: 2, noun: "Pauldrons", icon: (_t, n) => `inv_shoulder_${two(n % 90 + 1)}` },
  { slot: 4, noun: "Breastplate", icon: (t, n) => (t === "plate" ? `inv_chest_plate${two(n % 16 + 1)}` : `inv_chest_${t === "mail" ? "chain" : t}_${two(n % 16 + 1)}`) },
  { slot: 5, noun: "Girdle", icon: (_t, n) => `inv_belt_${two(n % 60 + 1)}` },
  { slot: 6, noun: "Legguards", icon: (t, n) => `inv_pants_${t}_${two(n % 16 + 1)}` },
  { slot: 7, noun: "Treads", icon: (t, n) => `inv_boots_${t === "mail" ? "chain" : t}_${two(n % 16 + 1)}` },
  { slot: 8, noun: "Bracers", icon: (_t, n) => `inv_bracer_${two(n % 40 + 1)}` },
  { slot: 9, noun: "Gauntlets", icon: (_t, n) => `inv_gauntlets_${two(n % 60 + 1)}` },
  { slot: 10, noun: "Band", icon: (_t, n) => `inv_jewelry_ring_${two(n % 60 + 1)}` },
  { slot: 11, noun: "Signet", icon: (_t, n) => `inv_jewelry_ring_${two((n + 7) % 60 + 1)}` },
  { slot: 14, noun: "Cloak", icon: (_t, n) => `inv_misc_cape_${two(n % 20 + 1)}` },
];

const SLOT_BY_ID = new Map(SLOT_SPECS.map((s) => [s.slot, s]));

function tierFor(level: number) {
  let t = SETS[0]!;
  for (const s of SETS) if (level >= s.minLevel) t = s;
  return t;
}

export function makeGear(slot: number, level: number, armor: ArmorType, weapons: WeaponSet, opts: { bind?: "boe" | "bop"; upgrade?: number } = {}): ItemDef {
  const tier = tierFor(level);
  const set = pick(tier.names);
  const q = pick(tier.q);
  const ilvl = Math.round(rnd(tier.ilvl[0], tier.ilvl[1]) + (opts.upgrade ?? 0));
  const req = Math.max(55, Math.min(80, level - rint(0, 4)));
  let name: string;
  let icon: string;
  let hasDur = true;
  const seed = hash(`${slot}${set}${ilvl}`);
  const spec = SLOT_BY_ID.get(slot);
  if (spec) {
    name = `${set} ${spec.noun}`;
    icon = spec.icon(armor, seed);
    hasDur = ![1, 10, 11].includes(slot);
  } else if (slot === 15) {
    name = `${set} ${weapons.mh}`;
    icon = `${weapons.mhIcon}_${two(seed % 60 + 1)}`;
  } else if (slot === 16) {
    name = `${set} ${weapons.oh ?? "Buckler"}`;
    icon = `${weapons.ohIcon ?? "inv_shield"}_${two(seed % 40 + 1)}`;
  } else if (slot === 17) {
    name = `${set} ${weapons.ranged ?? "Relic"}`;
    icon = `${weapons.rangedIcon ?? "inv_misc_relic"}_${two(seed % 20 + 1)}`;
  } else {
    name = `${set} Trinket`;
    icon = `inv_jewelry_trinket_${two(seed % 40 + 1)}`;
    hasDur = false;
  }
  const qMult = q + 1;
  return {
    entry: 30000 + (seed % 20000),
    name,
    q,
    ilvl,
    req,
    icon,
    sell: Math.round(ilvl * ilvl * qMult * 0.12),
    stack: 1,
    bind: opts.bind ?? (q >= 4 ? "bop" : "boe"),
    kind: "gear",
    slots: slot === 10 || slot === 11 ? [10, 11] : slot === 12 || slot === 13 ? [12, 13] : [slot],
    hasDurability: hasDur,
  };
}

/** Well-known trinkets / neck / rings so the paper doll has some recognisable names. */
export const NOTABLE: ItemDef[] = [
  { entry: 40256, name: "Grim Toll", q: 4, ilvl: 213, req: 80, icon: "inv_jewelry_trinket_09", sell: 34820, stack: 1, bind: "bop", kind: "gear", slots: [12, 13] },
  { entry: 40258, name: "Forethought Talisman", q: 4, ilvl: 213, req: 80, icon: "inv_jewelry_trinket_04", sell: 34820, stack: 1, bind: "bop", kind: "gear", slots: [12, 13] },
  { entry: 40432, name: "Illustration of the Dragon Soul", q: 4, ilvl: 226, req: 80, icon: "inv_misc_gem_bloodstone_02", sell: 41000, stack: 1, bind: "bop", kind: "gear", slots: [12, 13] },
  { entry: 42987, name: "Darkmoon Card: Greatness", q: 4, ilvl: 200, req: 80, icon: "inv_misc_ticket_tarot_madness", sell: 30000, stack: 1, bind: "bop", kind: "gear", slots: [12, 13] },
  { entry: 37111, name: "Soul Preserver", q: 4, ilvl: 187, req: 70, icon: "spell_holy_flashheal", sell: 22500, stack: 1, bind: "bop", kind: "gear", slots: [12, 13] },
  { entry: 44284, name: "Band of the Eternal Champion", q: 4, ilvl: 226, req: 80, icon: "inv_jewelry_ring_53", sell: 42000, stack: 1, bind: "bop", kind: "gear", slots: [10, 11] },
  { entry: 49623, name: "Shadowmourne", q: 5, ilvl: 284, req: 80, icon: "inv_axe_113", sell: 1200000, stack: 1, bind: "bop", kind: "gear", slots: [15], hasDurability: true },
  { entry: 41616, name: "Titansteel Bulwark", q: 4, ilvl: 200, req: 80, icon: "inv_shield_43", sell: 46000, stack: 1, bind: "bop", kind: "gear", slots: [16], hasDurability: true },
];

// ---------------------------------------------------------------- non-gear

const c = (
  entry: number,
  name: string,
  q: Item["quality"],
  icon: string,
  sell: number,
  stack: number,
  kind: Kind,
  extra: Partial<ItemDef> = {},
): ItemDef => ({ entry, name, q, ilvl: extra.ilvl ?? (kind === "consumable" ? 70 : 1), req: extra.req ?? 0, icon, sell, stack, bind: "none", kind, ...extra });

export const CONSUMABLES: ItemDef[] = [
  c(33447, "Runic Healing Potion", 1, "inv_potion_168", 1750, 20, "consumable", { use: "heal", ilvl: 80, req: 65 }),
  c(33448, "Runic Mana Potion", 1, "inv_potion_137", 1750, 20, "consumable", { use: "mana", ilvl: 80, req: 65 }),
  c(35953, "Mead Basted Caribou", 1, "inv_misc_food_49", 500, 20, "consumable", { use: "food", req: 65 }),
  c(33454, "Salted Venison", 1, "inv_misc_food_49", 250, 20, "consumable", { use: "food", req: 65 }),
  c(33449, "Crusty Flatbread", 1, "inv_misc_food_37", 100, 20, "consumable", { use: "food", req: 55 }),
  c(33444, "Pungent Seal Whey", 1, "inv_drink_milk_05", 250, 20, "consumable", { use: "drink", req: 65 }),
  c(33445, "Honeymint Tea", 1, "inv_drink_milk_05", 250, 20, "consumable", { use: "drink", req: 65 }),
  c(44114, "Old Spices", 1, "inv_misc_food_07", 200, 20, "consumable", { use: "other", req: 65 }),
  c(40077, "Crazy Alchemist's Potion", 1, "inv_potion_27", 1200, 20, "consumable", { use: "other", req: 65 }),
  c(43575, "Reinforced Bandage", 1, "inv_misc_bandage_15", 400, 20, "consumable", { use: "heal", req: 65 }),
];

export const MATS: ItemDef[] = [
  c(36912, "Saronite Ore", 1, "inv_ore_saronite_01", 1250, 20, "mat"),
  c(36913, "Saronite Bar", 1, "inv_ingot_saronite", 3500, 20, "mat"),
  c(36910, "Titanium Ore", 2, "inv_ore_titanium_01", 3000, 20, "mat"),
  c(36909, "Cobalt Ore", 1, "inv_ore_cobalt_01", 500, 20, "mat"),
  c(33470, "Frostweave Cloth", 1, "inv_fabric_frostweave", 1200, 20, "mat"),
  c(33568, "Borean Leather", 1, "inv_misc_leatherscrap_17", 800, 20, "mat"),
  c(44128, "Arctic Fur", 2, "inv_misc_pelt_wolf_ruin_02", 5000, 20, "mat"),
  c(36906, "Icethorn", 1, "inv_misc_herb_icethorn", 900, 20, "mat"),
  c(36901, "Goldclover", 1, "inv_misc_herb_goldclover", 700, 20, "mat"),
  c(36903, "Adder's Tongue", 1, "inv_misc_herb_adderstongue", 800, 20, "mat"),
  c(34054, "Infinite Dust", 2, "inv_enchant_dustillusion", 450, 100, "mat"),
  c(34057, "Abyss Crystal", 4, "inv_enchant_abysscrystal", 5000, 10, "mat"),
  c(34052, "Dream Shard", 3, "inv_enchant_shardprismaticlarge", 2000, 10, "mat"),
  c(43102, "Frozen Orb", 3, "inv_misc_gem_azure_01", 17000, 20, "mat"),
  c(35623, "Eternal Air", 3, "inv_elemental_primal_air", 25000, 10, "mat"),
];

export const JUNK: ItemDef[] = [
  c(43299, "Damaged Necklace", 0, "inv_jewelry_necklace_08", 250, 1, "junk"),
  c(43196, "Bloodstained Rag", 0, "inv_misc_cloth_01", 40, 20, "junk"),
  c(43205, "Cracked Vrykul Tusk", 0, "inv_misc_bone_01", 180, 20, "junk"),
  c(43214, "Nerubian Chitin Shard", 0, "inv_misc_bone_04", 210, 20, "junk"),
  c(43228, "Rusted Vrykul Dagger", 0, "inv_weapon_shortblade_03", 1400, 1, "junk"),
  c(43239, "Broken Frostwyrm Tooth", 0, "inv_misc_bone_02", 500, 5, "junk"),
  c(43251, "Chipped Frostbite Pendant", 0, "inv_jewelry_necklace_06", 900, 1, "junk"),
];

export const QUEST_ITEMS: ItemDef[] = [
  c(42780, "Scourge Rune Fragment", 1, "inv_misc_rune_05", 0, 20, "quest", { bind: "quest" }),
  c(42781, "Frostbrood Scale", 1, "inv_misc_scales_02", 0, 20, "quest", { bind: "quest" }),
  c(42792, "Nerubian Tablet", 1, "inv_misc_note_03", 0, 1, "quest", { bind: "quest" }),
];

export const MISC: ItemDef[] = [
  c(6948, "Hearthstone", 1, "inv_misc_rune_01", 0, 1, "misc", { bind: "bop" }),
  c(41599, "Frostweave Bag", 2, "inv_misc_bag_enchantedmageweave", 5000, 1, "misc", { ilvl: 70 }),
  c(49426, "Emblem of Frost", 2, "spell_holy_summonchampion", 0, 100, "misc", { bind: "bop", ilvl: 80 }),
  c(47241, "Emblem of Triumph", 2, "spell_holy_summonchampion", 0, 100, "misc", { bind: "bop", ilvl: 80 }),
];

export function toItem(def: ItemDef, count: number, slot: number, bag: number, opts: { soulbound?: boolean; durFrac?: number } = {}): Item {
  const soulbound = opts.soulbound ?? (def.bind === "bop" || def.bind === "quest");
  const item: Item = {
    entry: def.entry,
    name: def.name,
    quality: def.q,
    itemLevel: def.ilvl,
    requiredLevel: def.req,
    count,
    icon: def.icon,
    slot,
    bag,
    sellPrice: def.sell,
    soulbound,
    tradeable: !soulbound && def.bind !== "quest",
    link: makeLink(def.entry, def.name, def.q),
  };
  if (def.hasDurability) {
    const max = 40 + Math.round(def.ilvl / 4) * 5;
    item.durability = { cur: Math.round(max * (opts.durFrac ?? rnd(0.55, 1))), max };
  }
  return item;
}
