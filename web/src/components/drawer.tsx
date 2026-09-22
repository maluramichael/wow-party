import { useEffect, useRef, type KeyboardEvent } from "react";
import type { Character, Member, Snapshot } from "@shared/protocol";
import { CLASS_DE, RACE_DE, classText } from "../lib/wow";
import { StateBadge } from "./ui";
import { BotActions, StrategyPanel } from "./actions";
import { BagsTab, EquipmentTab } from "./items";
import { QuestCompareTab, QuestsTab } from "./quests";
import { StatsTab } from "./stats";
import type { DrawerTab } from "./cards";

export type OpenState = { who: string | "self"; tab: DrawerTab } | null;

const BOT_TABS: { id: DrawerTab; label: string }[] = [
  { id: "equip", label: "Ausrüstung" },
  { id: "bags", label: "Taschen" },
  { id: "stats", label: "Werte" },
  { id: "quests", label: "Quests" },
  { id: "compare", label: "Quests vs. Du" },
  { id: "control", label: "Steuerung" },
];
const SELF_TABS = BOT_TABS.filter((t) => ["equip", "bags", "stats", "quests"].includes(t.id));

const tabId = (t: string) => `tab-${t}`;
const panelId = (t: string) => `panel-${t}`;

export function Drawer({ snapshot, open, onTab, onClose }: { snapshot: Snapshot; open: OpenState; onTab: (t: DrawerTab) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const isSelf = open?.who === "self";
  const bot: Member | undefined = open && !isSelf ? snapshot.members.find((m) => m.name === open.who) : undefined;
  const ch: Character | undefined = isSelf ? snapshot.self : bot;
  const gone = !!open && !ch;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  // The bot left the group while its drawer was open.
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);

  const tabs = isSelf ? SELF_TABS : BOT_TABS;
  const active = open && tabs.some((t) => t.id === open.tab) ? open.tab : "equip";

  const onKeys = (e: KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === active);
    let n = i;
    if (e.key === "ArrowRight") n = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") n = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = tabs.length - 1;
    else return;
    e.preventDefault();
    const next = tabs[n]!.id;
    onTab(next);
    requestAnimationFrame(() => document.getElementById(tabId(next))?.focus());
  };

  return (
    <dialog
      ref={ref}
      className="drawer"
      aria-labelledby="drawer-title"
      // React bubbles `close` from portalled child dialogs (confirm) through the tree - only react to our own.
      onClose={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {ch && open && (
        <div className="drawer-inner">
          <header className="drawer-head">
            <div>
              {isSelf && <p className="eyebrow">Du (aktiver Charakter)</p>}
              <h2 id="drawer-title" style={{ color: classText(ch.cls) }}>{ch.name}</h2>
              <p className="muted">
                Stufe {ch.level} {RACE_DE[ch.race] ?? ch.raceName} {CLASS_DE[ch.cls] ?? ch.clsName}
                {ch.spec ? ` · ${ch.spec}` : ""}
              </p>
            </div>
            <div className="drawer-head-r">
              {bot && <StateBadge state={bot.state} />}
              <button type="button" className="btn ghost md" onClick={onClose} aria-label="Detailansicht schließen (Esc)">
                Schließen <kbd>Esc</kbd>
              </button>
            </div>
          </header>

          <div role="tablist" aria-label={`Details zu ${ch.name}`} className="tabs" onKeyDown={onKeys}>
            {tabs.map((t) => (
              <button
                key={t.id}
                id={tabId(t.id)}
                role="tab"
                type="button"
                aria-selected={active === t.id}
                aria-controls={panelId(t.id)}
                tabIndex={active === t.id ? 0 : -1}
                className={active === t.id ? "on" : ""}
                onClick={() => onTab(t.id)}
              >
                {t.label}
                {t.id === "compare" && bot && bot.questCompare.missingOnBot.length + bot.questCompare.missingOnMaster.length + bot.questCompare.differing.length > 0 && (
                  <span className="tab-count">{bot.questCompare.missingOnBot.length + bot.questCompare.missingOnMaster.length + bot.questCompare.differing.length}</span>
                )}
              </button>
            ))}
          </div>

          <div id={panelId(active)} role="tabpanel" aria-labelledby={tabId(active)} tabIndex={0} className="tabpanel">
            {active === "equip" && <EquipmentTab ch={ch} self={snapshot.self} bot={bot?.name} />}
            {active === "bags" && <BagsTab ch={ch} bot={bot?.name} />}
            {active === "stats" && <StatsTab ch={ch} self={snapshot.self} />}
            {active === "quests" && <QuestsTab ch={ch} bot={bot?.name} />}
            {active === "compare" && bot && snapshot.self && <QuestCompareTab bot={bot} self={snapshot.self} />}
            {active === "control" && bot && (
              <div>
                <h3 className="panel-h">Aktionen</h3>
                <BotActions bot={bot.name} />
                <h3 className="panel-h" style={{ marginTop: 18 }}>Strategien</h3>
                <p className="muted small">Chips schalten Strategien per <code>+name</code> / <code>-name</code> um. Der Zustand wird mit dem nächsten Snapshot aktualisiert.</p>
                <StrategyPanel m={bot} />
              </div>
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}
