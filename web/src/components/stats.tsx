import type { Character } from "@shared/protocol";
import { POWER } from "../lib/wow";
import { fmtDec, fmtNum, powerDisplay } from "../lib/format";
import { Delta } from "./cards";
import { Money } from "./ui";

type Row = { label: string; get: (c: Character) => number; fmt?: (n: number) => string; digits?: number; dot?: string };
type Group = { title: string; rows: Row[] };

const pct = (n: number) => `${fmtDec(n, 2)} %`;
const num = (n: number) => fmtNum(n);

const GROUPS: Group[] = [
  {
    title: "Allgemein",
    rows: [
      { label: "Stufe", get: (c) => c.level },
      { label: "GearScore", get: (c) => c.gearScore },
      { label: "Ø Itemlevel", get: (c) => c.avgItemLevel },
      { label: "Haltbarkeit", get: (c) => c.durabilityPct, fmt: (n) => `${fmtDec(n, 0)} %` },
      { label: "Lebenspunkte (max.)", get: (c) => c.hpMax },
      { label: "Kraft (max.)", get: (c) => powerDisplay(c.powerType, c.powerMax, c.powerMax).max },
      { label: "Gold", get: (c) => c.gold, fmt: () => "" },
    ],
  },
  {
    title: "Attribute",
    rows: [
      { label: "Stärke", get: (c) => c.stats.str },
      { label: "Beweglichkeit", get: (c) => c.stats.agi },
      { label: "Ausdauer", get: (c) => c.stats.sta },
      { label: "Intelligenz", get: (c) => c.stats.int },
      { label: "Willenskraft", get: (c) => c.stats.spi },
      { label: "Rüstung", get: (c) => c.stats.armor },
    ],
  },
  {
    title: "Angriff & Zauber",
    rows: [
      { label: "Angriffskraft", get: (c) => c.stats.attackPower },
      { label: "Fernkampf-Angriffskraft", get: (c) => c.stats.rangedAttackPower },
      { label: "Zaubermacht", get: (c) => c.stats.spellPower },
      { label: "Heilungsmacht", get: (c) => c.stats.healingPower },
      { label: "MP5", get: (c) => c.stats.mp5 },
    ],
  },
  {
    title: "Trefferchancen",
    rows: [
      { label: "Kritisch (Nahkampf)", get: (c) => c.stats.critPct, fmt: pct, digits: 2 },
      { label: "Kritisch (Zauber)", get: (c) => c.stats.spellCritPct, fmt: pct, digits: 2 },
      { label: "Kritisch (Fernkampf)", get: (c) => c.stats.rangedCritPct, fmt: pct, digits: 2 },
      { label: "Trefferwertung", get: (c) => c.stats.hitPct, fmt: pct, digits: 2 },
      { label: "Zaubertreffer", get: (c) => c.stats.spellHitPct, fmt: pct, digits: 2 },
      { label: "Tempo", get: (c) => c.stats.hastePct, fmt: pct, digits: 2 },
    ],
  },
  {
    title: "Verteidigung",
    rows: [
      { label: "Ausweichen", get: (c) => c.stats.dodgePct, fmt: pct, digits: 2 },
      { label: "Parieren", get: (c) => c.stats.parryPct, fmt: pct, digits: 2 },
      { label: "Blocken", get: (c) => c.stats.blockPct, fmt: pct, digits: 2 },
    ],
  },
  {
    title: "Widerstände",
    rows: [
      { label: "Heilig", get: (c) => c.stats.resist.holy, dot: "#f5e6a1" },
      { label: "Feuer", get: (c) => c.stats.resist.fire, dot: "#ff6a3d" },
      { label: "Natur", get: (c) => c.stats.resist.nature, dot: "#4ade80" },
      { label: "Frost", get: (c) => c.stats.resist.frost, dot: "#60c8ff" },
      { label: "Schatten", get: (c) => c.stats.resist.shadow, dot: "#a78bfa" },
      { label: "Arkan", get: (c) => c.stats.resist.arcane, dot: "#f472b6" },
    ],
  },
];

export function StatsTab({ ch, self }: { ch: Character; self?: Character }) {
  const compare = !!self && ch !== self;
  const powerName = POWER[ch.powerType]?.name ?? "Kraft";
  return (
    <div className="stats">
      {GROUPS.map((g) => (
        <table key={g.title} className="stat-table">
          <caption>{g.title}</caption>
          <thead>
            <tr>
              <th scope="col" className="sr-only">Wert</th>
              <th scope="col">{compare ? "Bot" : "Wert"}</th>
              {compare && <th scope="col">Du</th>}
              {compare && <th scope="col">Δ</th>}
            </tr>
          </thead>
          <tbody>
            {g.rows.map((r) => {
              const v = r.get(ch);
              const s = self ? r.get(self) : 0;
              const isGold = r.label === "Gold";
              const fmt = r.fmt ?? num;
              return (
                <tr key={r.label}>
                  <th scope="row">
                    {r.dot && <span className="dot" style={{ background: r.dot }} aria-hidden="true" />}
                    {r.label === "Kraft (max.)" ? `${powerName} (max.)` : r.label}
                  </th>
                  <td>{isGold ? <Money copper={v} /> : fmt(v)}</td>
                  {compare && <td className="muted">{isGold ? <Money copper={s} /> : fmt(s)}</td>}
                  {compare && (
                    <td>
                      {isGold ? null : <Delta value={v} base={s} refName={self!.name} digits={r.digits ?? 0} />}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      ))}
    </div>
  );
}
