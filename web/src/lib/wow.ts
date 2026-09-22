/** Static WoW 3.3.5a display data (German UI labels). */
import type { Op } from "@shared/protocol";

export const CLASS_COLOR: Record<number, string> = {
  1: "#C79C6E", 2: "#F58CBA", 3: "#ABD473", 4: "#FFF569", 5: "#FFFFFF",
  6: "#C41F3B", 7: "#0070DE", 8: "#40C7EB", 9: "#8788EE", 11: "#FF7D0A",
};
/** Text variant with enough contrast on the dark surface (DK/Shaman are too dark as text). */
export const CLASS_TEXT: Record<number, string> = { ...CLASS_COLOR, 6: "#e8506a", 7: "#3d97ff" };
export const classColor = (cls: number) => CLASS_COLOR[cls] ?? "#9aa4b8";
export const classText = (cls: number) => CLASS_TEXT[cls] ?? "#e6e9f0";

export const CLASS_DE: Record<number, string> = {
  1: "Krieger", 2: "Paladin", 3: "Jäger", 4: "Schurke", 5: "Priester", 6: "Todesritter", 7: "Schamane", 8: "Magier", 9: "Hexenmeister", 11: "Druide",
};
export const RACE_DE: Record<number, string> = {
  1: "Mensch", 2: "Orc", 3: "Zwerg", 4: "Nachtelf", 5: "Untoter", 6: "Tauren", 7: "Gnom", 8: "Troll", 10: "Blutelf", 11: "Draenei",
};

export const POWER: Record<number, { name: string; color: string }> = {
  0: { name: "Mana", color: "#3b82f6" },
  1: { name: "Wut", color: "#dc2626" },
  2: { name: "Fokus", color: "#f59e0b" },
  3: { name: "Energie", color: "#eab308" },
  4: { name: "Zufriedenheit", color: "#a3a3a3" },
  5: { name: "Runen", color: "#a3a3a3" },
  6: { name: "Runenmacht", color: "#22d3ee" },
};

export const QUALITY_COLOR = ["#9d9d9d", "#ffffff", "#1eff00", "#4a9eff", "#c069ff", "#ff8000", "#e6cc80", "#00ccff"];
export const QUALITY_BORDER = ["#9d9d9d", "#d8d8d8", "#1eff00", "#0070dd", "#a335ee", "#ff8000", "#e6cc80", "#00ccff"];
export const QUALITY_DE = ["Schlecht", "Gewöhnlich", "Ungewöhnlich", "Selten", "Episch", "Legendär", "Artefakt", "Erbstück"];

export const SLOT_NAMES: Record<number, string> = {
  0: "Kopf", 1: "Hals", 2: "Schultern", 3: "Hemd", 4: "Brust", 5: "Taille", 6: "Beine", 7: "Füße", 8: "Handgelenke", 9: "Hände",
  10: "Finger 1", 11: "Finger 2", 12: "Schmuck 1", 13: "Schmuck 2", 14: "Rücken", 15: "Waffenhand", 16: "Nebenhand", 17: "Fernkampf", 18: "Wappenrock",
};

/** Paper-doll layout: left column, right column, bottom row. */
export const DOLL_LEFT = [0, 1, 2, 14, 4, 3, 18, 8];
export const DOLL_RIGHT = [9, 5, 6, 7, 10, 11, 12, 13];
export const DOLL_BOTTOM = [15, 16, 17];

export const OP_LABEL: Record<Op, string> = {
  chat: "Befehl", follow: "Folgen", stay: "Bleiben", flee: "Fliehen", grind: "Grinden", attack: "Angreifen", summon: "Herbeirufen",
  release: "Geist freilassen", revive: "Wiederbeleben", repair: "Reparieren", maintenance: "Wartung", "loot-all": "Alles plündern",
  "quest.accept": "Quest annehmen", "quest.abandon": "Quest abbrechen", "quest.share": "Quest teilen",
  "quest.offer.accept": "Angebot annehmen", "quest.offer.decline": "Angebot ablehnen",
  "item.destroy": "Wegwerfen", "item.trade": "Handeln", "item.equip": "Anlegen", "item.unequip": "Ablegen", "item.use": "Benutzen", "item.sell": "Verkaufen",
  strategy: "Strategie",
};

export const iconUrl = (icon: string) => `https://wow.zamimg.com/images/wow/icons/medium/${encodeURIComponent(icon)}.jpg`;

/** Distance in yards beyond which a follower is considered "too far". */
export const FAR_YARDS = 60;

export const STRATEGY_PRESETS = {
  co: ["dps", "tank", "heal", "passive", "aoe", "dps assist", "tank assist", "boost", "flee", "potions"],
  nc: ["follow", "stay", "passive", "grind", "loot", "food", "drink", "mount", "gather"],
} as const;
