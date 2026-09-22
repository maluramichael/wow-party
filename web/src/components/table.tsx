import { memo, useMemo, type CSSProperties } from "react";
import type { Character, Item, Member } from "@shared/protocol";
import { CLASS_DE, FAR_YARDS, POWER, QUALITY_COLOR, RACE_DE, SLOT_NAMES, classColor, classText } from "../lib/wow";
import { fmtDec, fmtNum, powerDisplay } from "../lib/format";
import { Bar, ItemIcon, Money, StateBadge } from "./ui";
import { BotActions } from "./actions";
import { Delta, type OpenFn } from "./cards";

/** Equipment columns in paper-doll order (left column, right column, weapons). */
const EQ_ORDER = [0, 1, 2, 14, 4, 3, 18, 8, 9, 5, 6, 7, 10, 11, 12, 13, 15, 16, 17];
const EQ_SHORT: Record<number, string> = {
  0: "Kopf", 1: "Hals", 2: "Schulter", 3: "Hemd", 4: "Brust", 5: "Taille", 6: "Beine", 7: "Füße", 8: "Handgelenk", 9: "Hände",
  10: "Ring 1", 11: "Ring 2", 12: "Schmuck 1", 13: "Schmuck 2", 14: "Rücken", 15: "Waffe", 16: "Nebenhand", 17: "Fernkampf", 18: "Wappenrock",
};

/**
 * Fixed column widths (px) in header order: 16 data columns, one per equipment slot, actions.
 * The table uses `table-layout: fixed`, so content can never change a column's width or a row's height
 * (long text is cut with an ellipsis instead).
 */
const COL_WIDTHS: number[] = [
  150, // Name
  86, // Stufe
  200, // Volk / Klasse
  150, // Leben
  150, // Kraft
  150, // XP
  170, // Ziel
  210, // Als Nächstes
  220, // Ort
  120, // Gold
  110, // GearScore
  110, // Ø iLvl
  110, // Haltbarkeit
  100, // Freie Plätze
  260, // Taschen
  260, // Quests
  ...EQ_ORDER.map(() => 72), // Ausrüstung
  390, // Aktionen
];
const TABLE_WIDTH = COL_WIDTHS.reduce((a, b) => a + b, 0);

function isMember(c: Character | Member): c is Member {
  return "state" in c;
}

// ------------------------------------------------------------------ cells

function LocationCell({ pos, distance, self }: { pos: Member["pos"]; distance?: number | null; self?: Character }) {
  const otherMap = self ? pos.map !== self.pos.map : distance === null;
  const otherZone = self ? !otherMap && pos.zone !== self.pos.zone : false;
  const far = distance != null && distance > FAR_YARDS;
  const warn = otherMap ? "Andere Map" : otherZone ? "Andere Zone" : far ? "Weit vom Master entfernt" : null;
  return (
    <div className="pt-loc">
      <div>
        <strong>{pos.zoneName || "?"}</strong>
        {pos.areaName && <span className="muted"> · {pos.areaName}</span>}
        {warn && <span className="pt-warn" title={warn}> ⚠</span>}
      </div>
      <div className="muted small">
        {fmtDec(pos.x, 0)}, {fmtDec(pos.y, 0)}
        {distance !== undefined && <> · {distance === null ? "andere Map" : `${fmtDec(distance, 0)} y zu dir`}</>}
      </div>
    </div>
  );
}

function EquipCell({ item, onOpen, who, first }: { item: Item | undefined; onOpen: OpenFn; who: string; first: boolean }) {
  const edge = first ? " eq-first" : "";
  if (!item) return <td className={`eq-cell eq-empty${edge}`} title="Leer">·</td>;
  const dur = item.durability && item.durability.max > 0 ? ` · Haltbarkeit ${item.durability.cur}/${item.durability.max}` : "";
  const broken = !!item.durability && item.durability.max > 0 && item.durability.cur / item.durability.max < 0.25;
  return (
    <td className={`eq-cell${edge}`}>
      <button
        type="button"
        className="eq-btn"
        onClick={() => onOpen(who, "equip")}
        title={`${item.name}\n${SLOT_NAMES[item.slot] ?? "Slot"} · Item-Level ${item.itemLevel}${dur}`}
        aria-label={`${SLOT_NAMES[item.slot] ?? "Slot"}: ${item.name}, Item-Level ${item.itemLevel}`}
      >
        <ItemIcon icon={item.icon} quality={item.quality} name={item.name} size={28} />
        <span className={`eq-ilvl${broken ? " bad" : ""}`} style={broken ? undefined : { color: QUALITY_COLOR[item.quality] ?? "#fff" }}>{item.itemLevel}</span>
      </button>
    </td>
  );
}

function BagCell({ c }: { c: Character }) {
  const used = useMemo(() => {
    const m = new Map<number, number>();
    for (const i of c.bags) m.set(i.bag, (m.get(i.bag) ?? 0) + 1);
    return m;
  }, [c.bags]);
  const list = c.bagSlots ?? [];
  if (list.length === 0) return <span className="muted small">-</span>;
  return (
    <div className="pt-bags">
      {list.map((b) => {
        const u = used.get(b.bag) ?? 0;
        return (
          <span key={b.bag} className={`bag-mini${u >= b.size ? " full" : ""}`} title={`${b.name}: ${u} von ${b.size} Plätzen belegt`}>
            <ItemIcon icon={b.icon} quality={b.quality} name={b.name} size={20} />
            <span>{u}/{b.size}</span>
          </span>
        );
      })}
    </div>
  );
}

function QuestCell({ c, onOpen }: { c: Character | Member; onOpen: OpenFn }) {
  if (!isMember(c)) return <>{c.quests.length}/25</>;
  const qc = c.questCompare;
  const missingBot = qc?.missingOnBot.length ?? 0;
  const missingMaster = qc?.missingOnMaster.length ?? 0;
  const differing = qc?.differing.length ?? 0;
  const diff = missingBot + missingMaster + differing;
  return (
    <div className="pt-quests">
      <span>{c.quests.length}/25</span>
      <button
        type="button"
        className={`badge cmp ${diff > 0 ? "has-diff" : "ok"}`}
        onClick={() => onOpen(c.name, "compare")}
        title={`Quests im Vergleich zu dir: ${missingBot} fehlen beim Bot, ${missingMaster} fehlen bei dir, ${differing} abweichend, ${qc?.inSync ?? 0} gleich`}
      >
        {diff === 0 ? (
          <span>gleich ({qc?.inSync ?? 0})</span>
        ) : (
          <>
            {missingBot > 0 && <span><b>−{missingBot}</b> fehlt</span>}
            {missingMaster > 0 && <span><b>+{missingMaster}</b> extra</span>}
            {differing > 0 && <span><b>≠{differing}</b> abw.</span>}
          </>
        )}
      </button>
      {c.pendingQuestOffers.length > 0 && <span className="badge info">{c.pendingQuestOffers.length} Angebot</span>}
    </div>
  );
}

// ------------------------------------------------------------------ one row

const PartyRow = memo(function PartyRow({ c, self, onOpen }: { c: Character | Member; self: Character | undefined; onOpen: OpenFn }) {
  const m = isMember(c) ? c : null;
  const isSelf = !m;
  const who = isSelf ? "self" : c.name;
  const cmp = m ? self : undefined; // deltas only for bots
  const selfName = self?.name ?? "Master";
  const power = powerDisplay(c.powerType, c.power, c.powerMax);
  const powerInfo = POWER[c.powerType] ?? { name: "Kraft", color: "#888" };
  const hpLow = c.hpMax > 0 && c.hp / c.hpMax < 0.25;
  const durLow = c.durabilityPct < 25;
  const bagsLow = c.freeSlots <= 3;
  const bySlot = useMemo(() => new Map(c.equipment.map((i) => [i.slot, i])), [c.equipment]);

  return (
    <tr className={isSelf ? "self-row" : `bot-row${m && m.state === "dead" ? " dead" : ""}`} style={{ ["--cls" as string]: classColor(c.cls) } as CSSProperties}>
      <th scope="row" className="sticky-l pt-name">
        <button type="button" className="name-btn" style={{ color: classText(c.cls) }} onClick={() => onOpen(who)} title="Details öffnen">
          {c.name}
        </button>
        <div className="pt-name-badges">
          {isSelf ? <span className="badge mute">Du</span> : <StateBadge state={m!.state} />}
          {m?.following && <span className="badge mute" title="Folgt dem Master (Strategie follow)">folgt</span>}
        </div>
      </th>
      <td className="num">
        {c.level}
        {cmp && <Delta value={c.level} base={cmp.level} refName={selfName} />}
      </td>
      <td>
        {RACE_DE[c.race] ?? c.raceName} {CLASS_DE[c.cls] ?? c.clsName}
        {c.spec && <span className="muted"> · {c.spec}</span>}
      </td>
      <td className="pt-bar"><Bar label={`${c.name} Lebenspunkte`} cur={c.hp} max={c.hpMax} color={hpLow ? "#e5484d" : "#2fa84f"} warn={hpLow} /></td>
      <td className="pt-bar"><Bar label={`${c.name} ${powerInfo.name}`} cur={power.cur} max={power.max} color={powerInfo.color} /></td>
      <td className="pt-bar">
        {c.xpMax > 0 ? <Bar label={`${c.name} Erfahrung`} cur={c.xp} max={c.xpMax} text={`XP ${Math.round((c.xp / c.xpMax) * 100)} %`} color="#8b5cf6" /> : <span className="muted">-</span>}
      </td>
      <td>{m?.target ? <><strong>{m.target.name}</strong> <span className="muted small">{Math.round(m.target.hpPct)} %</span></> : <span className="muted">-</span>}</td>
      <td className="pt-next" title={m?.queuedActions.join(", ") || undefined}>
        {m && m.queuedActions.length > 0 ? <span className="muted small">{m.queuedActions.join(", ")}</span> : <span className="muted">-</span>}
      </td>
      <td><LocationCell pos={c.pos} distance={m ? m.distanceToMaster : undefined} self={m ? self : undefined} /></td>
      <td><Money copper={c.gold} /></td>
      <td className="num">
        {fmtNum(c.gearScore)}
        {cmp && <Delta value={c.gearScore} base={cmp.gearScore} refName={selfName} />}
      </td>
      <td className="num">
        {fmtNum(c.avgItemLevel)}
        {cmp && <Delta value={c.avgItemLevel} base={cmp.avgItemLevel} refName={selfName} />}
      </td>
      <td className={`num${durLow ? " bad" : ""}`}>{fmtDec(c.durabilityPct, 0)} %{durLow && <span title="Reparatur nötig"> ⚠</span>}</td>
      <td className={`num${bagsLow ? " bad" : ""}`}>{c.freeSlots}/{c.totalSlots}</td>
      <td><BagCell c={c} /></td>
      <td><QuestCell c={c} onOpen={onOpen} /></td>
      {EQ_ORDER.map((slot, i) => (
        <EquipCell key={slot} item={bySlot.get(slot)} onOpen={onOpen} who={who} first={i === 0} />
      ))}
      <td className="sticky-r pt-actions">{m ? <BotActions bot={m.name} /> : <span className="muted small">-</span>}</td>
    </tr>
  );
});

// ------------------------------------------------------------------ table

export function PartyTable({ self, members, onOpen }: { self: Character | undefined; members: Member[]; onOpen: OpenFn }) {
  return (
    <div className="party-table-wrap" role="region" aria-label="Party als Tabelle" tabIndex={0}>
      <table className="party-table" style={{ width: TABLE_WIDTH }}>
        <colgroup>
          {COL_WIDTHS.map((w, i) => (
            <col key={i} style={{ width: w }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="sticky-l pt-name">Name</th>
            <th scope="col">Stufe</th>
            <th scope="col">Volk / Klasse</th>
            <th scope="col">Leben</th>
            <th scope="col">Kraft</th>
            <th scope="col">XP</th>
            <th scope="col">Ziel</th>
            <th scope="col">Als Nächstes</th>
            <th scope="col">Ort</th>
            <th scope="col">Gold</th>
            <th scope="col">GearScore</th>
            <th scope="col">Ø iLvl</th>
            <th scope="col">Haltbarkeit</th>
            <th scope="col">Freie Plätze</th>
            <th scope="col">Taschen</th>
            <th scope="col">Quests</th>
            {EQ_ORDER.map((slot, i) => (
              <th key={slot} scope="col" className={`eq-h${i === 0 ? " eq-first" : ""}`} title={SLOT_NAMES[slot]}>{EQ_SHORT[slot]}</th>
            ))}
            <th scope="col" className="sticky-r pt-actions">Aktionen</th>
          </tr>
        </thead>
        <tbody>
          {self && <PartyRow c={self} self={self} onOpen={onOpen} />}
          {members.map((m) => (
            <PartyRow key={m.guid} c={m} self={self} onOpen={onOpen} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
