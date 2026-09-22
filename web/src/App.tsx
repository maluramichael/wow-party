import { useCallback, useMemo, useState } from "react";
import { useParty } from "./lib/useParty";
import { ActionsContext } from "./lib/context";
import { Header, EmptyState, EventLog } from "./components/panels";
import { AllBotsToolbar, CommandBox } from "./components/actions";
import { BotCard, SelfCard, type DrawerTab, type OpenFn } from "./components/cards";
import { PartyTable } from "./components/table";
import { Drawer, type OpenState } from "./components/drawer";
import { QuestOffers } from "./components/quests";
import { Toasts } from "./components/ui";

export function App() {
  const api = useParty();
  const { snapshot, status, statusAt, snapshotAt, conn } = api;
  const [open, setOpen] = useState<OpenState>(null);
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [view, setViewState] = useState<"table" | "cards">(() => {
    try {
      return localStorage.getItem("wow-party.view") === "cards" ? "cards" : "table";
    } catch {
      return "table";
    }
  });
  const setView = useCallback((v: "table" | "cards") => {
    setViewState(v);
    try {
      localStorage.setItem("wow-party.view", v);
    } catch {
      /* storage unavailable: the choice just isn't remembered */
    }
  }, []);
  const wide = view === "table";

  const actions = useMemo(() => ({ send: api.send, isPending: api.isPending }), [api.send, api.isPending]);
  const onOpen = useCallback<OpenFn>((who, tab: DrawerTab = "equip") => setOpen({ who, tab }), []);
  const onClose = useCallback(() => setOpen(null), []);
  const onTab = useCallback((tab: DrawerTab) => setOpen((o) => (o ? { ...o, tab } : o)), []);

  const members = snapshot?.members ?? [];
  const names = useMemo(() => members.map((m) => m.name), [members]);
  const shown = onlyDiff
    ? members.filter((m) => m.questCompare.missingOnBot.length + m.questCompare.missingOnMaster.length + m.questCompare.differing.length > 0)
    : members;
  const stale = conn !== "connected" || status?.bridge === "stale" || status?.bridge === "offline";

  return (
    <ActionsContext.Provider value={actions}>
      <a className="skip" href="#main">Zum Inhalt springen</a>
      <Header snapshot={snapshot} status={status} statusAt={statusAt} snapshotAt={snapshotAt} conn={conn} />

      {snapshot && conn !== "connected" && (
        <div className="banner err" role="status">
          Verbindung zum Dashboard-Server verloren - es wird automatisch neu verbunden. Angezeigt sind die letzten bekannten Daten.
        </div>
      )}
      {snapshot && conn === "connected" && status?.bridge === "stale" && (
        <div className="banner warn" role="status">
          Die Daten sind veraltet (älter als 5 s). Ist der Master online und sind Bots in der Gruppe?
        </div>
      )}
      {snapshot && conn === "connected" && status?.bridge === "offline" && (
        <div className="banner err" role="status">
          Bridge offline (Redis nicht erreichbar). Angezeigt sind die letzten bekannten Daten.
        </div>
      )}

      <main id="main" className={`${stale && snapshot ? "is-stale" : ""}${wide ? " wide" : ""}`}>
        {!snapshot ? (
          <EmptyState conn={conn} status={status} url={api.url} />
        ) : (
          <div className={`layout${wide ? " one" : ""}`}>
            <div className="col-main">
              <div className="tools">
                <AllBotsToolbar />
                <CommandBox bots={names} />
              </div>
              <QuestOffers members={members} />
              <section aria-labelledby="party-h">
                <div className="section-head">
                  <h2 id="party-h">
                    Party <span className="badge mute">{members.length} Bot{members.length === 1 ? "" : "s"}</span>
                  </h2>
                  <div className="section-tools">
                    <label className="check">
                      <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> Nur Bots mit Quest-Abweichungen
                    </label>
                    <div className="seg" role="group" aria-label="Ansicht der Party">
                      <button type="button" className={view === "table" ? "on" : ""} aria-pressed={view === "table"} onClick={() => setView("table")}>Tabelle</button>
                      <button type="button" className={view === "cards" ? "on" : ""} aria-pressed={view === "cards"} onClick={() => setView("cards")}>Karten</button>
                    </div>
                  </div>
                </div>
                {view === "table" ? (
                  <PartyTable self={snapshot.self} members={shown} onOpen={onOpen} />
                ) : (
                  <div className="cards">
                    {snapshot.self && <SelfCard ch={snapshot.self} onOpen={onOpen} />}
                    {shown.map((m) => (
                      <BotCard key={m.guid} m={m} self={snapshot.self} onOpen={onOpen} />
                    ))}
                  </div>
                )}
                {members.length === 0 && <p className="empty-note">Keine Bots in der Gruppe.</p>}
                {members.length > 0 && shown.length === 0 && <p className="empty-note">Alle Bots haben dieselben Quests wie du.</p>}
              </section>
            </div>
            <aside className="col-side">
              <EventLog log={api.log} bots={names} />
            </aside>
          </div>
        )}
      </main>

      {snapshot && <Drawer snapshot={snapshot} open={open} onTab={onTab} onClose={onClose} />}
      <Toasts toasts={api.toasts} onClose={api.dismissToast} />
    </ActionsContext.Provider>
  );
}
