import { useMemo, useState } from "react";
import type { Character, Member, Quest, QuestBlocker, QuestDiffEntry, QuestObjective, QuestState } from "@shared/protocol";
import { useNow } from "../lib/context";
import { fmtCountdown } from "../lib/format";
import { ActionButton, MiniBar } from "./ui";

// ------------------------------------------------------------------ labels

export const STATE_DE: Record<QuestState, string> = {
  incomplete: "Offen",
  complete: "Abgeschlossen",
  failed: "Fehlgeschlagen",
  rewarded: "Abgegeben",
  none: "Nicht im Log",
};

const STATE_CLS: Record<QuestState, string> = {
  incomplete: "q-open",
  complete: "q-done",
  failed: "q-fail",
  rewarded: "q-rew",
  none: "q-none",
};

export const BLOCKER_DE: Record<QuestBlocker, string> = {
  level: "Level zu niedrig / zu hoch",
  race: "Volk passt nicht",
  class: "Klasse passt nicht",
  skill: "Fertigkeit fehlt",
  reputation: "Ruf fehlt",
  prerequisite: "Vorquest fehlt",
  exclusive: "Exklusive Alternative schon gewählt",
  chain: "Folgequest der Kette schon erledigt oder aktiv",
  repeat: "Täglich/wöchentlich schon erledigt",
  log_full: "Questlog des Bots ist voll",
  conditions: "Sonstige Bedingungen nicht erfüllt",
  has_it: "Ist bereits im Log",
};

export function QuestStateBadge({ state }: { state: QuestState }) {
  return <span className={`badge qstate ${STATE_CLS[state]}`}>{STATE_DE[state]}</span>;
}

// ------------------------------------------------------------------ objectives

function Objectives({ list, label }: { list: QuestObjective[]; label: string }) {
  if (!list.length) return null;
  return (
    <ul className="objs">
      {list.map((o, i) => (
        <li key={i}>
          <span className="obj-text">{o.text}</span>
          <MiniBar pct={o.req > 0 ? (o.cur / o.req) * 100 : 0} color={o.cur >= o.req ? "#2fa84f" : "#f0c14b"} label={`${label}: ${o.text}`} />
          <span className="obj-num">{o.cur}/{o.req}</span>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ bot's own quest log

export function QuestsTab({ ch, bot }: { ch: Character; bot?: string }) {
  const [idText, setIdText] = useState("");
  const id = /^\d{1,7}$/.test(idText.trim()) ? Number(idText.trim()) : null;
  return (
    <div>
      <p className="muted small">{ch.quests.length} von 25 Questlog-Plätzen belegt.</p>
      {ch.quests.length === 0 ? (
        <p className="empty-note">Keine aktiven Quests.</p>
      ) : (
        <ul className="quest-list">
          {ch.quests.map((q: Quest) => (
            <li key={q.id} className="quest">
              <div className="quest-head">
                <div>
                  <strong>{q.title}</strong> <span className="muted small">(Stufe {q.level}, ID {q.id})</span>
                </div>
                <QuestStateBadge state={q.status} />
              </div>
              <Objectives list={q.objectives} label={q.title} />
              {bot && (
                <div className="actions">
                  <ActionButton
                    bot={bot} op="quest.share" args={{ questId: q.id }} label="Teilen"
                    disabledReason={q.shareable ? undefined : "Diese Quest kann nicht geteilt werden."}
                  />
                  <ActionButton
                    bot={bot} op="quest.abandon" args={{ questId: q.id }} label="Abbrechen" variant="danger"
                    confirm={{
                      title: "Quest abbrechen?",
                      body: <p>{bot} bricht <strong>{q.title}</strong> ab. Der Fortschritt geht verloren.</p>,
                      confirmLabel: "Quest abbrechen",
                    }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {bot && (
        <form className="accept-form" onSubmit={(e) => e.preventDefault()}>
          <h4>Quest annehmen</h4>
          <div className="row">
            <label className="field">
              <span>Quest-ID</span>
              <input type="text" inputMode="numeric" value={idText} placeholder="z. B. 13232" onChange={(e) => setIdText(e.target.value)} />
            </label>
            <ActionButton
              bot={bot} op="quest.accept" args={id ? { questId: id } : undefined} label="Annehmen" variant="primary" size="md"
              disabledReason={id ? undefined : "Bitte eine gültige Quest-ID eingeben."}
            />
          </div>
          <p className="hint">Funktioniert nur, wenn der Bot beim Questgeber steht oder ein Angebot offen ist (Playerbots-Regel).</p>
        </form>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ comparison with the master

function Pair({ e, selfName, botName }: { e: QuestDiffEntry; selfName: string; botName: string }) {
  const n = Math.max(e.master.objectives.length, e.bot.objectives.length);
  if (n === 0) return null;
  return (
    <ul className="objs pair">
      {Array.from({ length: n }, (_, i) => {
        const a = e.master.objectives[i];
        const b = e.bot.objectives[i];
        const text = a?.text ?? b?.text ?? "";
        return (
          <li key={i}>
            <span className="obj-text">{text}</span>
            <div className="pair-bars">
              <span className="who-l">{selfName}</span>
              {a ? <MiniBar pct={a.req ? (a.cur / a.req) * 100 : 0} color="#60a5fa" label={`${selfName}: ${text}`} /> : <span className="muted small pair-none">-</span>}
              <span className="obj-num">{a ? `${a.cur}/${a.req}` : ""}</span>
              <span className="who-l">{botName}</span>
              {b ? <MiniBar pct={b.req ? (b.cur / b.req) * 100 : 0} color="#f0c14b" label={`${botName}: ${text}`} /> : <span className="muted small pair-none">-</span>}
              <span className="obj-num">{b ? `${b.cur}/${b.req}` : ""}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Entry({ e, self, bot, kind }: { e: QuestDiffEntry; self: Character; bot: Member; kind: "missingBot" | "missingMaster" | "diff" }) {
  const blocker = e.bot.blocker;
  return (
    <li className="quest cmp-entry">
      <div className="quest-head">
        <div>
          <strong>{e.title}</strong> <span className="muted small">(Stufe {e.level}, ID {e.id})</span>
        </div>
      </div>
      <div className="sides">
        <div className="side">
          <span className="side-l">{self.name}</span> <QuestStateBadge state={e.master.state} />
        </div>
        <div className="side">
          <span className="side-l">{bot.name}</span> <QuestStateBadge state={e.bot.state} />
        </div>
      </div>
      <Pair e={e} selfName={self.name} botName={bot.name} />
      {kind === "missingBot" && (
        <div className="actions">
          {blocker ? (
            <span className="blocker" role="note">
              <span aria-hidden="true">✕</span> {BLOCKER_DE[blocker]}
            </span>
          ) : (
            <span className="ok-note">Bot könnte die Quest annehmen</span>
          )}
          <ActionButton
            bot={bot.name} op="quest.accept" args={{ questId: e.id }} label="Bot soll annehmen" variant="primary"
            disabledReason={blocker ? `Nicht möglich: ${BLOCKER_DE[blocker]}` : undefined}
          />
        </div>
      )}
      {kind === "missingMaster" && (
        <div className="actions">
          <ActionButton
            bot={bot.name} op="quest.abandon" args={{ questId: e.id }} label="Bot abbrechen" variant="danger"
            confirm={{
              title: "Quest beim Bot abbrechen?",
              body: <p>{bot.name} bricht <strong>{e.title}</strong> ab. Du selbst hast diese Quest nicht im Log.</p>,
              confirmLabel: "Quest abbrechen",
            }}
          />
        </div>
      )}
    </li>
  );
}

export function QuestCompareTab({ bot, self }: { bot: Member; self: Character }) {
  const [onlyDiff, setOnlyDiff] = useState(true);
  const qc = bot.questCompare;
  const inSyncList = useMemo(() => {
    const mine = new Map(self.quests.map((q) => [q.id, q]));
    return bot.quests.filter((b) => {
      const a = mine.get(b.id);
      return a && a.status === b.status && a.objectives.length === b.objectives.length && a.objectives.every((o, i) => o.cur === b.objectives[i]!.cur);
    });
  }, [bot.quests, self.quests]);
  const deviations = qc.missingOnBot.length + qc.missingOnMaster.length + qc.differing.length;

  const group = (id: string, title: string, hint: string, list: QuestDiffEntry[], kind: "missingBot" | "missingMaster" | "diff") => (
    <section className="cmp-group" aria-labelledby={id}>
      <h4 id={id}>
        {title} <span className="badge mute">{list.length}</span>
      </h4>
      <p className="hint">{hint}</p>
      {list.length === 0 ? <p className="empty-note small">Keine.</p> : (
        <ul className="quest-list">
          {list.map((e) => (
            <Entry key={e.id} e={e} self={self} bot={bot} kind={kind} />
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <div>
      <div className="toolbar">
        <p className="grow" style={{ margin: 0 }}>
          <strong>{deviations}</strong> Abweichung{deviations === 1 ? "" : "en"} · <strong>{qc.inSync}</strong> gleich
          {qc.botLogFull && <span className="badge warn" style={{ marginLeft: 8 }}>Questlog des Bots voll</span>}
        </p>
        <label className="check">
          <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> Nur Abweichungen
        </label>
      </div>
      {group("g-mb", `Fehlt bei ${bot.name}`, `Im Questlog von ${self.name}, aber nicht bei ${bot.name}.`, qc.missingOnBot, "missingBot")}
      {group("g-mm", `Fehlt bei dir (${self.name})`, `Im Questlog von ${bot.name}, aber nicht bei ${self.name}.`, qc.missingOnMaster, "missingMaster")}
      {group("g-df", "Abweichend", "In beiden Logs, aber mit anderem Status oder Fortschritt.", qc.differing, "diff")}
      {!onlyDiff && (
        <section className="cmp-group" aria-labelledby="g-eq">
          <h4 id="g-eq">Gleich <span className="badge mute">{qc.inSync}</span></h4>
          {inSyncList.length === 0 ? <p className="empty-note small">Keine.</p> : (
            <ul className="quest-list">
              {inSyncList.map((q) => (
                <li key={q.id} className="quest">
                  <div className="quest-head">
                    <div><strong>{q.title}</strong> <span className="muted small">(Stufe {q.level})</span></div>
                    <QuestStateBadge state={q.status} />
                  </div>
                  <Objectives list={q.objectives} label={q.title} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <p className="hint">„Bot soll annehmen“ klappt nur, wenn der Bot beim Questgeber steht oder ein Angebot offen ist (Playerbots-Regel). <code>CommandResult.ok</code> heißt nur „zugestellt“ - das Ergebnis siehst du im nächsten Snapshot.</p>
    </div>
  );
}

// ------------------------------------------------------------------ open quest offers (phase 2)

function OfferRow({ bot, o }: { bot: string; o: Member["pendingQuestOffers"][number] }) {
  const now = useNow(1000);
  return (
    <li className="offer">
      <div className="grow">
        <strong>{o.title}</strong> <span className="muted small">(ID {o.questId})</span>
        <p className="muted small" style={{ margin: 0 }}>
          {bot} · von {o.from} · läuft ab in <span className="mono">{fmtCountdown(o.expiresTs, now)}</span>
        </p>
      </div>
      <div className="actions">
        <ActionButton bot={bot} op="quest.offer.accept" args={{ offerId: o.offerId }} label="Annehmen" variant="primary" />
        <ActionButton bot={bot} op="quest.offer.decline" args={{ offerId: o.offerId }} label="Ablehnen" />
      </div>
    </li>
  );
}

export function QuestOffers({ members }: { members: Member[] }) {
  const rows = members.flatMap((m) => m.pendingQuestOffers.map((o) => ({ bot: m.name, o })));
  if (!rows.length) return null;
  return (
    <section className="panel offers" aria-labelledby="offers-h">
      <h2 id="offers-h" className="panel-h">Offene Quest-Angebote <span className="badge info">{rows.length}</span></h2>
      <ul className="offer-list">
        {rows.map(({ bot, o }) => (
          <OfferRow key={o.offerId} bot={bot} o={o} />
        ))}
      </ul>
    </section>
  );
}
