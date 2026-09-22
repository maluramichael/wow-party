import { memo, type MouseEvent } from "react";
import type { Character, Member } from "@shared/protocol";
import { FAR_YARDS, CLASS_DE, RACE_DE, POWER, classColor, classText } from "../lib/wow";
import { fmtDec, fmtNum, powerDisplay } from "../lib/format";
import { Bar, MiniBar, Money, StateBadge } from "./ui";
import { BotActions } from "./actions";

export type DrawerTab = "equip" | "bags" | "stats" | "quests" | "compare" | "control";
export type OpenFn = (who: string | "self", tab?: DrawerTab) => void;

// ------------------------------------------------------------------ delta vs. self

export function Delta({ value, base: refValue, refName, unit = "", lowerIsBad = true, digits = 0 }: {
  value: number; base: number; refName: string; unit?: string; lowerIsBad?: boolean; digits?: number;
}) {
  const d = value - refValue;
  if (Math.abs(d) < Math.pow(10, -digits) / 2) return <span className="delta eq" title={`Gleich wie ${refName}`}>=</span>;
  const worse = lowerIsBad ? d < 0 : d > 0;
  const txt = `${d > 0 ? "+" : "−"}${digits ? fmtDec(Math.abs(d), digits) : fmtNum(Math.abs(d))}${unit}`;
  return (
    <span className={`delta ${worse ? "neg" : "pos"}`} title={`Δ zu ${refName}: ${txt}`}>
      {txt}
    </span>
  );
}

// ------------------------------------------------------------------ location line

function Location({ pos, distance, self, selfName }: { pos: Member["pos"]; distance?: number | null; self?: Character; selfName: string }) {
  const otherMap = self ? pos.map !== self.pos.map : distance === null;
  const otherZone = self ? !otherMap && pos.zone !== self.pos.zone : false;
  const far = distance != null && distance > FAR_YARDS;
  return (
    <div className="loc">
      <div className="loc-line">
        <span className="lbl">Ort</span>
        <strong>{pos.zoneName || "?"}</strong>
        {pos.areaName && <span className="muted"> · {pos.areaName}</span>}
      </div>
      <div className="loc-line muted small">
        <span title="Koordinaten (x, y)">
          {fmtDec(pos.x, 0)}, {fmtDec(pos.y, 0)}
        </span>
        {distance !== undefined && (
          <span title="Entfernung zum Master">
            {" · "}
            {distance === null ? "andere Map" : `${fmtDec(distance, 0)} y zu dir`}
          </span>
        )}
      </div>
      {(otherMap || otherZone || far) && (
        <div className="warn-line" role="note">
          <span aria-hidden="true">⚠</span>{" "}
          {otherMap
            ? `Andere Map (${pos.zoneName || pos.map}) - du bist in ${self?.pos.zoneName ?? "?"}`
            : otherZone
              ? `Andere Zone (${pos.zoneName}) - ${selfName} ist in ${self?.pos.zoneName}`
              : "Weit vom Master entfernt"}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ bot card

function interactive(e: MouseEvent) {
  return (e.target as HTMLElement).closest("button, a, input, select, textarea, label, details, summary, dialog");
}

export const BotCard = memo(function BotCard({ m, self, onOpen }: { m: Member; self: Character | undefined; onOpen: OpenFn }) {
  const power = powerDisplay(m.powerType, m.power, m.powerMax);
  const powerInfo = POWER[m.powerType] ?? { name: "Kraft", color: "#888" };
  const selfName = self?.name ?? "Master";
  const qc = m.questCompare;
  const missingBot = qc?.missingOnBot.length ?? 0;
  const missingMaster = qc?.missingOnMaster.length ?? 0;
  const differing = qc?.differing.length ?? 0;
  const durLow = m.durabilityPct < 25;
  const bagsLow = m.freeSlots <= 3;
  const color = classColor(m.cls);
  const hpLow = m.hpMax > 0 && m.hp / m.hpMax < 0.25;

  return (
    <article
      className={`card bot-card st-${m.state}`}
      style={{ ["--cls" as string]: color }}
      aria-label={`${m.name}, ${CLASS_DE[m.cls] ?? m.clsName}, Stufe ${m.level}`}
      onClick={(e) => {
        if (!interactive(e)) onOpen(m.name);
      }}
    >
      <header className="card-head">
        <div className="who">
          <h3>
            <button type="button" className="name-btn" style={{ color: classText(m.cls) }} onClick={() => onOpen(m.name)} title="Details öffnen">
              {m.name}
            </button>
          </h3>
          <p className="sub">
            Stufe {m.level}
            {self && <Delta value={m.level} base={self.level} refName={selfName} />} {RACE_DE[m.race] ?? m.raceName} {CLASS_DE[m.cls] ?? m.clsName}
            {m.spec && <span className="muted"> · {m.spec}</span>}
          </p>
        </div>
        <div className="head-badges">
          <StateBadge state={m.state} />
          {m.following && <span className="badge mute" title="Folgt dem Master (Strategie follow)">folgt</span>}
        </div>
      </header>

      <div className="bars">
        <Bar label={`${m.name} Lebenspunkte`} cur={m.hp} max={m.hpMax} color={hpLow ? "#e5484d" : "#2fa84f"} warn={hpLow} />
        <Bar label={`${m.name} ${powerInfo.name}`} cur={power.cur} max={power.max} color={powerInfo.color} />
        {m.xpMax > 0 && (
          <Bar label={`${m.name} Erfahrung`} cur={m.xp} max={m.xpMax} text={`XP ${Math.round((m.xp / m.xpMax) * 100)} %`} color="#8b5cf6" className="bar-thin" />
        )}
      </div>

      <div className="doing">
        {m.queuedActions.length > 0 && (
          <div className="doing-row">
            <span className="lbl">Als Nächstes</span>
            <ul className="trail next" aria-label="Als Nächstes geplant (Heuristik)">
              {m.queuedActions.map((a, i) => (
                <li key={`${i}-${a}`}>{a}</li>
              ))}
            </ul>
          </div>
        )}
        {m.target && (
          <div className="target">
            <span className="lbl">Ziel</span>
            <span className="target-name">{m.target.name}</span>
            <MiniBar pct={m.target.hpPct} color="#e5484d" label={`Ziel ${m.target.name} Lebenspunkte`} />
            <span className="small muted">{Math.round(m.target.hpPct)} %</span>
          </div>
        )}
      </div>

      <Location pos={m.pos} distance={m.distanceToMaster} self={self} selfName={selfName} />

      <dl className="facts">
        <div>
          <dt>Gold</dt>
          <dd><Money copper={m.gold} /></dd>
        </div>
        <div>
          <dt>GearScore</dt>
          <dd>
            {fmtNum(m.gearScore)}
            {self && <Delta value={m.gearScore} base={self.gearScore} refName={selfName} />}
          </dd>
        </div>
        <div>
          <dt>Ø iLvl</dt>
          <dd>
            {fmtNum(m.avgItemLevel)}
            {self && <Delta value={m.avgItemLevel} base={self.avgItemLevel} refName={selfName} />}
          </dd>
        </div>
        <div>
          <dt>Haltbarkeit</dt>
          <dd className={durLow ? "bad" : ""}>
            {fmtDec(m.durabilityPct, 0)} %{durLow && <span title="Reparatur nötig"> ⚠</span>}
          </dd>
        </div>
        <div>
          <dt>Freie Plätze</dt>
          <dd className={bagsLow ? "bad" : ""}>
            {m.freeSlots}/{m.totalSlots}
          </dd>
        </div>
      </dl>

      <div className="cmp-row">
        <button
          type="button"
          className={`badge cmp ${missingBot + missingMaster + differing > 0 ? "has-diff" : "ok"}`}
          onClick={() => onOpen(m.name, "compare")}
          title={`Quests im Vergleich zu ${selfName}: ${missingBot} fehlen beim Bot, ${missingMaster} fehlen bei dir, ${differing} abweichend, ${qc?.inSync ?? 0} gleich`}
        >
          <span className="cmp-label">Quests vs. {selfName}</span>
          {missingBot + missingMaster + differing === 0 ? (
            <span>gleich ({qc?.inSync ?? 0})</span>
          ) : (
            <>
              {missingBot > 0 && <span aria-label={`${missingBot} fehlen beim Bot`}><b>−{missingBot}</b> fehlt</span>}
              {missingMaster > 0 && <span aria-label={`${missingMaster} fehlen bei dir`}><b>+{missingMaster}</b> extra</span>}
              {differing > 0 && <span aria-label={`${differing} abweichend`}><b>≠{differing}</b> abw.</span>}
            </>
          )}
        </button>
        {m.pendingQuestOffers.length > 0 && <span className="badge info">{m.pendingQuestOffers.length} Angebot</span>}
      </div>

      <BotActions bot={m.name} />
    </article>
  );
});

// ------------------------------------------------------------------ self ("Du") card

export const SelfCard = memo(function SelfCard({ ch, onOpen }: { ch: Character; onOpen: OpenFn }) {
  const power = powerDisplay(ch.powerType, ch.power, ch.powerMax);
  const powerInfo = POWER[ch.powerType] ?? { name: "Kraft", color: "#888" };
  const durLow = ch.durabilityPct < 25;
  return (
    <article
      className="card self-card"
      style={{ ["--cls" as string]: classColor(ch.cls) }}
      aria-label={`Du: ${ch.name}`}
      onClick={(e) => {
        if (!interactive(e)) onOpen("self");
      }}
    >
      <header className="card-head">
        <div className="who">
          <p className="eyebrow">Du (aktiver Charakter)</p>
          <h3>
            <button type="button" className="name-btn" style={{ color: classText(ch.cls) }} onClick={() => onOpen("self")} title="Details öffnen">
              {ch.name}
            </button>
          </h3>
          <p className="sub">
            Stufe {ch.level} {RACE_DE[ch.race] ?? ch.raceName} {CLASS_DE[ch.cls] ?? ch.clsName}
            {ch.spec && <span className="muted"> · {ch.spec}</span>}
          </p>
        </div>
        <span className="badge mute">Referenz</span>
      </header>
      <div className="bars">
        <Bar label="Deine Lebenspunkte" cur={ch.hp} max={ch.hpMax} color="#2fa84f" />
        <Bar label={`Deine ${powerInfo.name}`} cur={power.cur} max={power.max} color={powerInfo.color} />
        {ch.xpMax > 0 && <Bar label="Deine Erfahrung" cur={ch.xp} max={ch.xpMax} text={`XP ${Math.round((ch.xp / ch.xpMax) * 100)} %`} color="#8b5cf6" className="bar-thin" />}
      </div>
      <Location pos={ch.pos} selfName={ch.name} />
      <dl className="facts">
        <div><dt>Gold</dt><dd><Money copper={ch.gold} /></dd></div>
        <div><dt>GearScore</dt><dd>{fmtNum(ch.gearScore)}</dd></div>
        <div><dt>Ø iLvl</dt><dd>{fmtNum(ch.avgItemLevel)}</dd></div>
        <div><dt>Haltbarkeit</dt><dd className={durLow ? "bad" : ""}>{fmtDec(ch.durabilityPct, 0)} %</dd></div>
        <div><dt>Freie Plätze</dt><dd>{ch.freeSlots}/{ch.totalSlots}</dd></div>
        <div><dt>Quests</dt><dd>{ch.quests.length}/25</dd></div>
      </dl>
    </article>
  );
});
