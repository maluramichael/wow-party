# wow-party – Protokoll v1

Live-Party-Dashboard für Playerbots. Drei Teile, ein Vertrag:

```
 worldserver                       Node (server/)                     Browser (web/)
┌──────────────────────┐  Redis  ┌────────────────────────┐ Socket.IO ┌────────────────┐
│ mod-party-bridge     │ ──────▶ │ ioredis subscribe      │ ────────▶ │ React + Vite   │
│  (C++, Welt-Thread)  │ ◀────── │ socket.io  :4400       │ ◀──────── │ :5173          │
└──────────────────────┘  wow-redis (127.0.0.1:6379)                    └────────────────┘
```

* Das Modul liest Bot-Zustand **nur auf dem Welt-Thread** und führt Befehle **nur auf dem Welt-Thread** aus
  (Redis-I/O läuft auf einem eigenen Worker-Thread, wie `mod-telemetry-redis`).
* Befehle werden als **Chat-Befehl des Masters an den Bot** eingespeist (`PlayerbotAI::HandleCommand`) – also exakt
  so, als hätte Michael dem Bot geflüstert. Playerbots' eigene Security/Validierung bleibt aktiv.
* Node bindet nur an `127.0.0.1`. Keine Auth in v1 (lokaler Single-User-Betrieb).
* Alle Geldwerte in **Kupfer**. Alle Zeiten in **Unix-Sekunden** (`ts`), Dauer in **ms**.
* Der Node-Server hat einen **Mock-Modus** (`MOCK=1`), der realistische Fake-Snapshots erzeugt, damit das Frontend
  ohne laufenden Worldserver entwickelt werden kann.

## 1. Redis-Schlüssel (Modul ↔ Node)

| Schlüssel | Typ | Richtung | Inhalt |
|---|---|---|---|
| `wowparty:snap` | Pub/Sub-Channel | Modul → Node | ein `Snapshot` (JSON) pro Master, ~1 Hz |
| `wowparty:last:<masterAccountId>` | String, `EX 10` | Modul → Node | letzter `Snapshot` (für späte Clients / Neustart von Node) |
| `wowparty:evt` | Pub/Sub-Channel | Modul → Node | ein `PartyEvent` (JSON) |
| `wowparty:cmd` | Liste | Node → Modul | `LPUSH` eines `Command` (JSON); Modul `BRPOP`t (1 s Timeout) |
| `wowparty:res` | Pub/Sub-Channel | Modul → Node | ein `CommandResult` (JSON) |

## 2. Socket.IO (Node ↔ Browser)

Server → Client:

| Event | Payload |
|---|---|
| `snapshot` | `Snapshot` – der jeweils neueste, sofort nach Connect und dann bei jeder Änderung (max. 1 Hz) |
| `event` | `PartyEvent` |
| `result` | `CommandResult` |
| `status` | `{ bridge: "live" \| "mock" \| "stale" \| "offline", lastSnapshotAgeMs: number \| null, redis: boolean }` alle 2 s |

Client → Server:

| Event | Payload | Ack |
|---|---|---|
| `cmd` | `Command` (ohne `id`; der Server setzt sie, falls leer) | `{ ok: boolean, id: string, error?: string }` – nur „in die Queue gelegt", das echte Ergebnis kommt als `result` |

## 3. Datentypen (TypeScript)

```ts
type Snapshot = {
  v: 1;
  ts: number;                      // Unix-Sekunden
  master: {
    accountId: number;
    guid: number;
    name: string;
    level: number;
    gold: number;                  // Kupfer
    map: number; zone: number; zoneName: string; areaName: string;
  };
  goldTotal: number;               // Kupfer, Master + alle Party-Mitglieder
  self: Character;                 // der AKTIVE Char des Masters – die Referenz, mit der alles verglichen wird
  members: Member[];               // Bots der Gruppe des Masters (Master selbst NICHT enthalten)
};

type Member = {
  guid: number;
  name: string;
  isBot: boolean;                  // immer true in v1; Feld für spätere echte Mitspieler
  race: number; raceName: string;
  cls: number;  clsName: string;   // WoW-Klassen-IDs (1 Warrior … 11 Druid)
  spec: string | null;             // z.B. "Protection" – null, wenn nicht ermittelbar
  level: number;
  xp: number; xpMax: number;
  hp: number; hpMax: number;
  powerType: number;               // 0 mana, 1 rage, 3 energy, 6 runic power
  power: number; powerMax: number;
  gold: number;                    // Kupfer
  gearScore: number;
  avgItemLevel: number;
  durabilityPct: number;           // niedrigster/gemittelter Wert 0..100
  state: "combat" | "non-combat" | "dead" | "unknown";
  lastAction: string;              // zuletzt ausgeführte Playerbots-Action, "" wenn keine
  recentActions: string[];         // die letzten ≤6 ausgeführten Actions, ÄLTESTE ZUERST, letzte = lastAction
  queuedActions: string[];         // Heuristik "als Nächstes" (z.B. "Angriff auf <Ziel>"), oft leer – siehe Hinweis unten
  target: { name: string; hpPct: number } | null;
  strategies: { co: string[]; nc: string[] };
  following: boolean;              // hat "follow"-Strategie
  distanceToMaster: number | null; // Yards, null wenn andere Map
  pos: {
    map: number; zone: number; zoneName: string;
    area: number; areaName: string;
    x: number; y: number; z: number; o: number;
  };
  stats: {
    str: number; agi: number; sta: number; int: number; spi: number;
    armor: number;
    attackPower: number; rangedAttackPower: number;
    spellPower: number; healingPower: number;
    critPct: number; spellCritPct: number; rangedCritPct: number;
    hitPct: number; spellHitPct: number; hastePct: number;
    dodgePct: number; parryPct: number; blockPct: number;
    resist: { holy: number; fire: number; nature: number; frost: number; shadow: number; arcane: number };
    mp5: number;
  };
  equipment: Item[];               // nur belegte Slots; slot = EquipmentSlots 0..18
  bags: Item[];                    // Inhalt aller Taschen inkl. Rucksack; bag 0 = Rucksack, 1..4 = Taschen
  bagSlots: BagInfo[];             // die Taschen selbst: Rucksack (bag 0, entry 0, size 16) + jede angelegte Tasche
                                   // BagInfo = { bag, entry, name, quality, icon, size }; fehlende bag-Nummern = leerer Taschenplatz
  freeSlots: number; totalSlots: number;
  quests: Quest[];
  pendingQuestOffers: QuestOffer[]; // v1: immer [] (Phase 2)
  questCompare: QuestCompare;      // dieser Bot im Vergleich zu `self` (siehe unten)
};

type Item = {
  entry: number;                   // Item-ID
  name: string;
  quality: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;  // grau … Erbstück
  itemLevel: number;
  requiredLevel: number;
  count: number;
  icon: string | null;             // Icon-Name ohne Endung (z.B. "inv_sword_04"), sonst null
  slot: number;                    // Slot in Bag (bei bags) bzw. Ausrüstungs-Slot (bei equipment)
  bag: number;                     // 0 = Rucksack … ; bei equipment immer 255
  durability?: { cur: number; max: number };
  sellPrice: number;               // Kupfer pro Stück
  soulbound: boolean;
  tradeable: boolean;              // false = seelengebunden ⇒ Trade-Button im UI deaktivieren
  link: string;                    // WoW-Item-Link (|cff…|Hitem:…|h[Name]|h|r), nur zur Anzeige/Debug
};

// Der aktive Char des Masters: dieselben Felder wie ein Member, die auch für ihn gelten.
// `spec` und `gearScore` sind wie beim Member befüllt. Bot-spezifische Felder (state, lastAction, …) fehlen.
type Character = Pick<Member,
  "guid" | "name" | "race" | "raceName" | "cls" | "clsName" | "spec" | "level" | "xp" | "xpMax" |
  "hp" | "hpMax" | "powerType" | "power" | "powerMax" | "gold" | "gearScore" | "avgItemLevel" |
  "durabilityPct" | "equipment" | "bags" | "bagSlots" | "freeSlots" | "totalSlots" | "quests" | "pos" | "stats">;

// Zustand einer Quest bei einem Char. "none" = weder im Log noch abgegeben.
type QuestState = "incomplete" | "complete" | "failed" | "rewarded" | "none";

// Warum ein Char eine Quest gerade NICHT annehmen kann (erster zutreffender Grund) – null = könnte sie annehmen.
type QuestBlocker =
  | "level"          // Level zu niedrig/zu hoch
  | "race" | "class" | "skill" | "reputation"
  | "prerequisite"   // Vorquest fehlt
  | "exclusive"      // eine exklusive Alternative wurde schon gewählt/erledigt
  | "chain"          // Folgequest der Kette schon erledigt/aktiv
  | "repeat"         // täglich/wöchentlich/… schon erledigt
  | "log_full"       // Questlog voll (25)
  | "conditions"     // sonstige Conditions
  | "has_it";        // ist bereits im Log

type QuestDiffEntry = {
  id: number; title: string; level: number;
  master: { state: QuestState; objectives: { text: string; cur: number; req: number }[] };
  bot:    { state: QuestState; objectives: { text: string; cur: number; req: number }[]; blocker: QuestBlocker | null };
};

type QuestCompare = {
  missingOnBot: QuestDiffEntry[];    // im Log des Masters, NICHT im Log des Bots (bot.state "rewarded" = schon abgegeben)
  missingOnMaster: QuestDiffEntry[]; // im Log des Bots, NICHT im Log des Masters
  differing: QuestDiffEntry[];       // in beiden Logs, aber Status oder Fortschritt weichen ab
  inSync: number;                    // Anzahl Quests in beiden Logs mit identischem Status und Fortschritt
  botLogFull: boolean;               // Questlog des Bots ist voll
};

type Quest = {
  id: number;
  title: string;
  level: number;
  status: "incomplete" | "complete" | "failed";
  objectives: { text: string; cur: number; req: number }[];
  shareable: boolean;
};

type QuestOffer = {                // Phase 2
  offerId: string;
  questId: number;
  title: string;
  from: string;                    // NPC- oder Spielername
  expiresTs: number;
};

type Command = {
  id: string;
  bot: string;                     // Charaktername des Bots, oder "*" für alle Bots der Gruppe
  op: Op;
  args?: Record<string, unknown>;
};

type Op =
  | "chat"            // args: { text: string }  – beliebiger Playerbots-Befehl, z.B. "co +dps". Max. 200 Zeichen, darf nicht mit "." beginnen
  | "follow" | "stay" | "flee" | "grind" | "attack" | "summon" | "release" | "revive" | "repair" | "maintenance" | "loot-all"
  | "quest.accept"    // args: { questId: number }
  | "quest.abandon"   // args: { questId: number }
  | "quest.share"     // args: { questId: number }
  | "quest.offer.accept"   // Phase 2, args: { offerId: string }
  | "quest.offer.decline"  // Phase 2, args: { offerId: string }
  | "item.destroy"    // args: { entry: number }           (Bot vernichtet den Stack)
  | "item.trade"      // args: { items: { entry: number }[] }  (Bot öffnet Handel mit dem Master und legt die Items rein)
  | "item.equip" | "item.unequip" | "item.use" | "item.sell"   // args: { entry: number }
  | "strategy";       // args: { scope: "co" | "nc"; changes: string }  z.B. "+dps,-passive"

type CommandResult = {
  id: string;
  ok: boolean;
  message: string;                 // kurze, menschenlesbare Erklärung (bei Fehler der Grund)
  bot: string;
  op: Op;
  ts: number;
};

type PartyEvent = {
  type: "quest_offer" | "quest_update" | "trade_opened" | "bot_death" | "bot_levelup" | "info";
  bot: string;
  text: string;
  ts: number;
  data?: Record<string, unknown>;
};
```

## 4. Semantik / Fehlerfälle

* **„Als Nächstes" ist begrenzt:** Playerbots hat keinen persistenten Plan. Seine Aktions-Queue wird innerhalb *eines*
  AI-Ticks gefüllt und wieder geleert. Das Modul liefert deshalb `lastAction` + `recentActions` (Verlauf, echt) und
  `queuedActions` als Heuristik aus dem, was gerade beobachtbar ist (aktuelles Ziel, Kampfzustand). Das UI soll
  „Zuletzt" (recentActions) prominent zeigen und `queuedActions` nur anzeigen, wenn es nicht leer ist.
* **`CommandResult.ok` = zugestellt, nicht erledigt.** Befehle laufen als Flüstern des Masters an den Bot und werden
  beim nächsten AI-Tick des Bots ausgeführt. Das Ergebnis der Aktion selbst sieht man am nächsten Snapshot
  (Quest weg, Item weg, Handelsfenster offen, …).
* `quest.accept` funktioniert nur, wenn der Bot beim Questgeber steht bzw. das Angebot offen ist (Playerbots-Regel).

* Kein Master online oder keine Bots in der Gruppe ⇒ Modul sendet **keine** Snapshots; Node meldet `bridge: "stale"`
  (Snapshot > 5 s alt) bzw. `"offline"` (nie einen erhalten / Redis weg).
* `bot: "*"` ⇒ Befehl an jeden Bot der Gruppe des Masters, ein `CommandResult` pro Bot.
* Unbekannter Bot / Bot nicht in der Gruppe des Masters / unbekannte Op ⇒ `ok: false` mit Grund.
* `item.trade`: Bot muss in Handelsreichweite des Masters sein; der Master muss das Handelsfenster dann selbst
  bestätigen (das ist Playerbots-Verhalten, kein Fehler).
* Snapshot-Größe: Inventare können groß werden (~100 Items/Bot). Modul sendet komplette Snapshots, das Frontend
  darf `bags` als Quelle der Wahrheit nutzen; kein Delta-Protokoll in v1.
