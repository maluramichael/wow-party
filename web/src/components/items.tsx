import { memo, useEffect, useMemo, useState } from "react";
import type { Character, Item } from "@shared/protocol";
import { LIMITS } from "@shared/protocol";
import { DOLL_BOTTOM, DOLL_LEFT, DOLL_RIGHT, QUALITY_COLOR, QUALITY_DE, SLOT_NAMES } from "../lib/wow";
import { fmtDec, fmtNum } from "../lib/format";
import { cmdKey } from "../lib/useParty";
import { useActions } from "../lib/context";
import { ActionButton, ItemIcon, Money } from "./ui";
import { Delta } from "./cards";

const itemKey = (i: Item) => `${i.bag}:${i.slot}`;
const qColor = (q: number) => QUALITY_COLOR[q] ?? "#fff";

function Lock() {
  return (
    <svg className="lock" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M8 1a3.5 3.5 0 0 0-3.5 3.5V6H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-.5V4.5A3.5 3.5 0 0 0 8 1zm-2 3.5a2 2 0 1 1 4 0V6H6V4.5z" />
    </svg>
  );
}

// ------------------------------------------------------------------ item detail panel

export function ItemDetail({ item, bot, where, selfItem }: { item: Item; bot?: string; where: "equipment" | "bag"; selfItem?: Item | null }) {
  const stack = item.sellPrice * item.count;
  const tradeReason = item.tradeable ? undefined : "Seelengebunden - dieses Item kann nicht an den Master gehandelt werden.";
  return (
    <div className="item-detail" role="region" aria-label={`Details zu ${item.name}`}>
      <div className="item-detail-head">
        <ItemIcon icon={item.icon} quality={item.quality} name={item.name} size={48} />
        <div>
          <h4 style={{ color: qColor(item.quality) }}>
            {item.name}
            {item.count > 1 && <span className="muted"> x{item.count}</span>}
          </h4>
          <p className="muted small">
            {QUALITY_DE[item.quality] ?? "?"} · Itemlevel {item.itemLevel}
            {item.requiredLevel > 0 && <> · benötigt Stufe {item.requiredLevel}</>}
          </p>
        </div>
      </div>
      <dl className="facts wide">
        <div><dt>Verkaufswert</dt><dd>{item.sellPrice > 0 ? <><Money copper={item.sellPrice} />{item.count > 1 && <span className="muted small"> (Stapel: <Money copper={stack} />)</span>}</> : <span className="muted">unverkäuflich</span>}</dd></div>
        <div><dt>Bindung</dt><dd>{item.soulbound ? <span className="bound"><Lock /> seelengebunden</span> : "ungebunden"}</dd></div>
        {item.durability && <div><dt>Haltbarkeit</dt><dd className={item.durability.cur / item.durability.max < 0.25 ? "bad" : ""}>{item.durability.cur}/{item.durability.max}</dd></div>}
        <div><dt>ID</dt><dd>{item.entry}</dd></div>
        {where === "bag" && <div><dt>Platz</dt><dd>{item.bag === 0 ? "Rucksack" : `Tasche ${item.bag}`}, Slot {item.slot + 1}</dd></div>}
        {where === "equipment" && <div><dt>Slot</dt><dd>{SLOT_NAMES[item.slot] ?? item.slot}</dd></div>}
        {selfItem !== undefined && (
          <div>
            <dt>Du (gleicher Slot)</dt>
            <dd>{selfItem ? <>{selfItem.name} (iLvl {selfItem.itemLevel}) <Delta value={item.itemLevel} base={selfItem.itemLevel} refName="dir" /></> : <span className="muted">leer</span>}</dd>
          </div>
        )}
      </dl>
      <details className="link-debug">
        <summary>WoW-Item-Link</summary>
        <code>{item.link}</code>
      </details>
      {bot && where === "equipment" && (
        <div className="actions">
          <ActionButton bot={bot} op="item.unequip" args={{ entry: item.entry }} label="Ablegen" title={`${item.name} ablegen`} />
        </div>
      )}
      {bot && where === "bag" && (
        <div className="actions">
          <ActionButton bot={bot} op="item.equip" args={{ entry: item.entry }} label="Anlegen" title={`${item.name} anlegen`} />
          <ActionButton bot={bot} op="item.use" args={{ entry: item.entry }} label="Benutzen" title={`${item.name} benutzen`} />
          <ActionButton
            bot={bot} op="item.sell" args={{ entry: item.entry }} label="Verkaufen"
            disabledReason={item.sellPrice <= 0 ? "Dieses Item hat keinen Verkaufswert." : undefined}
            confirm={item.quality >= 3 ? {
              title: "Item verkaufen?",
              body: <p><strong style={{ color: qColor(item.quality) }}>{item.name}</strong>{item.count > 1 && ` x${item.count}`} wird beim Händler für <Money copper={stack} /> verkauft.</p>,
              confirmLabel: "Verkaufen",
            } : undefined}
          />
          <ActionButton
            bot={bot} op="item.trade" args={{ items: [{ entry: item.entry }] }} label="Zu mir handeln"
            disabledReason={tradeReason} title="Bot öffnet ein Handelsfenster mit dir"
          />
          <ActionButton
            bot={bot} op="item.destroy" args={{ entry: item.entry }} label="Wegwerfen" variant="danger"
            confirm={{
              title: "Item wegwerfen?",
              body: <p><strong style={{ color: qColor(item.quality) }}>{item.name}</strong>{item.count > 1 ? ` x${item.count}` : ""} wird unwiderruflich vernichtet ({item.count > 1 ? "der ganze Stapel" : "1 Stück"}).</p>,
              confirmLabel: "Vernichten",
            }}
          />
          <p className="hint" style={{ flexBasis: "100%" }}>{tradeReason ?? "Nach „Zu mir handeln“ das Handelsfenster im Spiel bestätigen."}</p>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ equipment tab

const SlotButton = memo(function SlotButton({
  slot, item, selfItem, showDelta, selected, onSelect,
}: { slot: number; item: Item | undefined; selfItem: Item | undefined; showDelta: boolean; selected: boolean; onSelect: (slot: number) => void }) {
  return (
    <li>
      <button
        type="button"
        className={`slot ${item ? "" : "empty"} ${selected ? "sel" : ""}`}
        aria-pressed={selected}
        onClick={() => onSelect(slot)}
        aria-label={item ? `${SLOT_NAMES[slot]}: ${item.name}, Itemlevel ${item.itemLevel}` : `${SLOT_NAMES[slot]}: leer`}
      >
        {item ? <ItemIcon icon={item.icon} quality={item.quality} name={item.name} size={40} /> : <span className="icon icon-empty" style={{ width: 40, height: 40 }} aria-hidden="true" />}
        <span className="slot-text">
          <span className="slot-name">{SLOT_NAMES[slot]}</span>
          {item ? (
            <>
              <span className="slot-item" style={{ color: qColor(item.quality) }}>{item.name}</span>
              <span className="small muted">
                iLvl {item.itemLevel}
                {showDelta && (selfItem ? <Delta value={item.itemLevel} base={selfItem.itemLevel} refName="dir" /> : <span className="delta eq" title="Du hast hier nichts angelegt">Du: leer</span>)}
                {item.durability && <span className={item.durability.cur / item.durability.max < 0.25 ? "bad" : ""}> · {Math.round((item.durability.cur / item.durability.max) * 100)} %</span>}
              </span>
            </>
          ) : (
            <span className="small muted">leer{showDelta && selfItem ? ` (du: iLvl ${selfItem.itemLevel})` : ""}</span>
          )}
        </span>
      </button>
    </li>
  );
});

export function EquipmentTab({ ch, self, bot }: { ch: Character; self?: Character; bot?: string }) {
  const [sel, setSel] = useState<number | null>(null);
  const bySlot = useMemo(() => new Map(ch.equipment.map((i) => [i.slot, i])), [ch.equipment]);
  const selfBySlot = useMemo(() => new Map((self?.equipment ?? []).map((i) => [i.slot, i])), [self?.equipment]);
  const compare = !!self && ch !== self;
  const list = (slots: number[]) => (
    <ul className="doll-col">
      {slots.map((s) => (
        <SlotButton key={s} slot={s} item={bySlot.get(s)} selfItem={selfBySlot.get(s)} showDelta={compare} selected={sel === s} onSelect={setSel} />
      ))}
    </ul>
  );
  const selected = sel !== null ? bySlot.get(sel) : undefined;
  const extra = ch.equipment.filter((i) => ![...DOLL_LEFT, ...DOLL_RIGHT, ...DOLL_BOTTOM].includes(i.slot));
  return (
    <div>
      <p className="muted small">
        {ch.equipment.length} Slots belegt · Ø iLvl {fmtNum(ch.avgItemLevel)} · GearScore {fmtNum(ch.gearScore)} · Haltbarkeit {fmtDec(ch.durabilityPct, 0)} %
        {compare && self && <> (Δ jeweils gegenüber {self.name})</>}
      </p>
      <div className="doll">
        {list(DOLL_LEFT)}
        {list(DOLL_RIGHT)}
        <div className="doll-bottom">{list(DOLL_BOTTOM)}</div>
      </div>
      {extra.length > 0 && <p className="hint">Weitere Slots: {extra.map((i) => `${i.slot}: ${i.name}`).join(", ")}</p>}
      {selected ? (
        <ItemDetail item={selected} bot={bot} where="equipment" selfItem={compare ? (selfBySlot.get(selected.slot) ?? null) : undefined} />
      ) : (
        <p className="hint">Slot anklicken für Details{bot ? " und Aktionen" : ""}.</p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ bags tab

type SortKey = "slot" | "name" | "quality" | "value" | "count";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "slot", label: "Platz" },
  { key: "name", label: "Name" },
  { key: "quality", label: "Qualität (hoch zuerst)" },
  { key: "value", label: "Wert (hoch zuerst)" },
  { key: "count", label: "Stapel (groß zuerst)" },
];

/** Which containers the character carries (backpack + up to 4 bags) and how full each one is. */
function BagStrip({ ch }: { ch: Character }) {
  const used = useMemo(() => {
    const m = new Map<number, number>();
    for (const i of ch.bags) m.set(i.bag, (m.get(i.bag) ?? 0) + 1);
    return m;
  }, [ch.bags]);
  const byIdx = new Map((ch.bagSlots ?? []).map((b) => [b.bag, b]));
  if (byIdx.size === 0) return null;
  return (
    <ul className="bag-strip" aria-label="Ausgerüstete Taschen">
      {[0, 1, 2, 3, 4].map((idx) => {
        const b = byIdx.get(idx);
        if (!b)
          return (
            <li key={idx} className="bag-chip empty" title={`Taschenplatz ${idx} ist leer`}>
              <span className="bag-empty-box" aria-hidden="true" />
              <span className="bag-txt"><span className="bag-name muted">Platz {idx} leer</span></span>
            </li>
          );
        const u = used.get(idx) ?? 0;
        return (
          <li key={idx} className={`bag-chip${u >= b.size ? " full" : ""}`} title={`${b.name}: ${u} von ${b.size} Plätzen belegt`}>
            <ItemIcon icon={b.icon} quality={b.quality} name={b.name} size={28} />
            <span className="bag-txt">
              <span className="bag-name" style={{ color: qColor(b.quality) }}>{b.name}</span>
              <span className="bag-fill">{u}/{b.size}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function BagsTab({ ch, bot }: { ch: Character; bot?: string }) {
  const { send, isPending } = useActions();
  const [q, setQ] = useState("");
  const [minQ, setMinQ] = useState(0);
  const [sort, setSort] = useState<SortKey>("slot");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<string | null>(null);

  // Drop selections whose item disappeared.
  useEffect(() => {
    const keys = new Set(ch.bags.map(itemKey));
    setChecked((c) => (c.size && [...c].some((k) => !keys.has(k)) ? new Set([...c].filter((k) => keys.has(k))) : c));
    setFocus((f) => (f && !keys.has(f) ? null : f));
  }, [ch.bags]);

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = ch.bags.filter((i) => i.quality >= minQ && (!needle || i.name.toLowerCase().includes(needle)));
    const cmp: Record<SortKey, (a: Item, b: Item) => number> = {
      slot: (a, b) => a.bag - b.bag || a.slot - b.slot,
      name: (a, b) => a.name.localeCompare(b.name, "de"),
      quality: (a, b) => b.quality - a.quality || a.name.localeCompare(b.name, "de"),
      value: (a, b) => b.sellPrice * b.count - a.sellPrice * a.count,
      count: (a, b) => b.count - a.count,
    };
    return [...list].sort(cmp[sort]);
  }, [ch.bags, q, minQ, sort]);

  const totalValue = useMemo(() => ch.bags.reduce((a, i) => a + i.sellPrice * i.count, 0), [ch.bags]);
  const byKey = useMemo(() => new Map(ch.bags.map((i) => [itemKey(i), i])), [ch.bags]);
  const focused = focus ? byKey.get(focus) : undefined;
  const selectedItems = [...checked].map((k) => byKey.get(k)).filter((i): i is Item => !!i);
  const tradeArgs = { items: selectedItems.map((i) => ({ entry: i.entry })) };
  const tradePending = bot ? isPending(cmdKey(bot, "item.trade", tradeArgs)) : false;

  const toggle = (i: Item) => {
    if (!i.tradeable) return;
    setChecked((c) => {
      const n = new Set(c);
      const k = itemKey(i);
      if (n.has(k)) n.delete(k);
      else if (n.size < LIMITS.tradeMaxItems) n.add(k);
      return n;
    });
  };
  const full = checked.size >= LIMITS.tradeMaxItems;

  const checkbox = (i: Item) =>
    bot ? (
      <input
        type="checkbox"
        className="pick"
        checked={checked.has(itemKey(i))}
        disabled={!i.tradeable || (full && !checked.has(itemKey(i)))}
        onChange={() => toggle(i)}
        aria-label={`${i.name} zum Handel auswählen`}
        title={i.tradeable ? (full && !checked.has(itemKey(i)) ? `Maximal ${LIMITS.tradeMaxItems} Items pro Handel` : "Für „Zu mir handeln“ auswählen") : "Seelengebunden - nicht handelbar"}
      />
    ) : null;

  return (
    <div>
      <div className="toolbar">
        <label className="field grow">
          <span>Suche</span>
          <input type="search" value={q} placeholder="Name …" onChange={(e) => setQ(e.target.value)} />
        </label>
        <label className="field">
          <span>Qualität ab</span>
          <select value={minQ} onChange={(e) => setMinQ(Number(e.target.value))}>
            {QUALITY_DE.slice(0, 6).map((n, i) => (
              <option key={n} value={i}>{n}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Sortierung</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </label>
        <div className="seg" role="group" aria-label="Ansicht">
          <button type="button" className={view === "grid" ? "on" : ""} aria-pressed={view === "grid"} onClick={() => setView("grid")}>Raster</button>
          <button type="button" className={view === "list" ? "on" : ""} aria-pressed={view === "list"} onClick={() => setView("list")}>Liste</button>
        </div>
      </div>

      <BagStrip ch={ch} />

      <p className="muted small" aria-live="polite">
        {items.length === ch.bags.length ? `${ch.bags.length} Items` : `${items.length} von ${ch.bags.length} Items`} · {ch.freeSlots} von {ch.totalSlots} Plätzen frei · Gesamtwert <Money copper={totalValue} />
      </p>

      {bot && checked.size > 0 && (
        <div className="trade-bar" role="region" aria-label="Handelsauswahl">
          <span>
            <strong>{checked.size}</strong> Item{checked.size === 1 ? "" : "s"} ausgewählt{full && ` (Maximum ${LIMITS.tradeMaxItems})`}
          </span>
          <button
            type="button"
            className={`btn primary sm ${tradePending ? "is-pending" : ""}`}
            disabled={tradePending}
            onClick={() => void send({ bot, op: "item.trade", args: tradeArgs })}
          >
            {tradePending && <span className="spinner" aria-hidden="true" />}Zu mir handeln
          </button>
          <button type="button" className="btn ghost sm" onClick={() => setChecked(new Set())}>Auswahl leeren</button>
          <span className="hint">Handelsfenster im Spiel bestätigen.</span>
        </div>
      )}

      {items.length === 0 ? (
        <p className="empty-note">Keine Items{q || minQ ? " für diesen Filter" : ""}.</p>
      ) : view === "grid" ? (
        <ul className="grid">
          {items.map((i) => {
            const k = itemKey(i);
            return (
              <li key={k} className={`tile ${focus === k ? "sel" : ""}`}>
                <button
                  type="button"
                  className="tile-btn"
                  aria-pressed={focus === k}
                  aria-label={`${i.name}${i.count > 1 ? `, ${i.count} Stück` : ""}, ${QUALITY_DE[i.quality]}${i.soulbound ? ", seelengebunden" : ""}`}
                  title={`${i.name}${i.count > 1 ? ` x${i.count}` : ""}\n${QUALITY_DE[i.quality]} · iLvl ${i.itemLevel}${i.sellPrice ? `\nWert: ${fmtNum(i.sellPrice * i.count)} Kupfer` : ""}${i.soulbound ? "\nSeelengebunden" : ""}`}
                  onClick={() => setFocus(focus === k ? null : k)}
                >
                  <ItemIcon icon={i.icon} quality={i.quality} name={i.name} size={44} />
                  {i.count > 1 && <span className="count">{i.count}</span>}
                  {i.soulbound && <span className="sb" aria-hidden="true"><Lock /></span>}
                </button>
                {checkbox(i)}
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="rows">
          {items.map((i) => {
            const k = itemKey(i);
            return (
              <li key={k} className={`row-item ${focus === k ? "sel" : ""}`}>
                {checkbox(i)}
                <button type="button" className="row-btn" aria-pressed={focus === k} onClick={() => setFocus(focus === k ? null : k)}>
                  <ItemIcon icon={i.icon} quality={i.quality} name={i.name} size={32} />
                  <span className="row-name" style={{ color: qColor(i.quality) }}>{i.name}</span>
                  <span className="row-meta">
                    {i.count > 1 && <span className="badge mute">x{i.count}</span>}
                    {i.soulbound && <span className="bound" title="Seelengebunden"><Lock /> gebunden</span>}
                    <span className="muted small">iLvl {i.itemLevel}</span>
                    <span className="row-val">{i.sellPrice > 0 ? <Money copper={i.sellPrice * i.count} /> : <span className="muted">-</span>}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {focused ? <ItemDetail item={focused} bot={bot} where="bag" /> : <p className="hint">Item anklicken für Details{bot ? ", Aktionen und Handel" : ""}.</p>}
    </div>
  );
}
