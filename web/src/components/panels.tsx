import { useMemo, useState } from "react";
import type { Snapshot, StatusPayload } from "@shared/protocol";
import type { Conn, LogEntry } from "../lib/useParty";
import { useNow } from "../lib/context";
import { classText } from "../lib/wow";
import { fmtAge, fmtTime } from "../lib/format";
import { Money } from "./ui";

// ------------------------------------------------------------------ header

function StatusBadge({ conn, status, statusAt, snapshotAt }: { conn: Conn; status: StatusPayload | null; statusAt: number | null; snapshotAt: number | null }) {
  const now = useNow(1000);
  let cls = "off";
  let label = "Offline";
  let age: number | null = null;
  if (conn !== "connected") {
    label = conn === "connecting" ? "Verbinde …" : "Getrennt";
    age = snapshotAt ? now - snapshotAt : null;
  } else if (status) {
    cls = status.bridge;
    label = { live: "Live", mock: "Mock-Daten", stale: "Veraltet", offline: "Offline" }[status.bridge];
    age = status.lastSnapshotAgeMs === null || statusAt === null ? null : status.lastSnapshotAgeMs + (now - statusAt);
  }
  return (
    <div className={`status s-${cls}`} role="status" aria-live="polite">
      <span className="dot" aria-hidden="true" />
      <span className="status-label">{label}</span>
      <span className="status-age">Snapshot {fmtAge(age)}</span>
    </div>
  );
}

export function Header({ snapshot, status, statusAt, snapshotAt, conn }: {
  snapshot: Snapshot | null; status: StatusPayload | null; statusAt: number | null; snapshotAt: number | null; conn: Conn;
}) {
  const self = snapshot?.self;
  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo" aria-hidden="true">★</span>
        <span>wow-party</span>
      </div>

      {snapshot && (
        <>
          <div className="topinfo">
            <span className="lbl">Master</span>
            <strong style={self ? { color: classText(self.cls) } : undefined}>{snapshot.master.name}</strong>
            <span className="muted"> · Stufe {snapshot.master.level}</span>
          </div>
          <div className="topinfo">
            <span className="lbl">Zone</span>
            <strong>{snapshot.master.zoneName || "?"}</strong>
            {snapshot.master.areaName && <span className="muted"> · {snapshot.master.areaName}</span>}
          </div>
          <details className="gold">
            <summary>
              <span className="lbl">Gruppen-Gold</span>
              <span className="gold-total"><Money copper={snapshot.goldTotal} /></span>
              <span className="muted small"> Aufschlüsselung</span>
            </summary>
            <div className="gold-pop">
              <table>
                <caption className="sr-only">Gold pro Charakter</caption>
                <tbody>
                  <tr><th scope="row">{snapshot.master.name} (Master)</th><td><Money copper={snapshot.master.gold} /></td></tr>
                  {snapshot.members.map((m) => (
                    <tr key={m.guid}><th scope="row" style={{ color: classText(m.cls) }}>{m.name}</th><td><Money copper={m.gold} /></td></tr>
                  ))}
                  <tr className="sum"><th scope="row">Summe</th><td><Money copper={snapshot.goldTotal} /></td></tr>
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}

      <div className="spacer" />
      <StatusBadge conn={conn} status={status} statusAt={statusAt} snapshotAt={snapshotAt} />
    </header>
  );
}

// ------------------------------------------------------------------ empty state

export function EmptyState({ conn, status, url }: { conn: Conn; status: StatusPayload | null; url: string }) {
  const serverDown = conn !== "connected";
  return (
    <section className="empty-state" aria-labelledby="empty-h">
      <h2 id="empty-h">{serverDown ? "Keine Verbindung zum Dashboard-Server" : "Noch keine Party-Daten"}</h2>
      <p>
        {serverDown
          ? `Der Browser erreicht ${url} nicht. Es wird automatisch neu verbunden.`
          : "Der Server läuft, hat aber noch keinen Snapshot vom Spiel erhalten."}
      </p>
      <ol className="checklist">
        <li className={serverDown ? "todo" : "done"}>
          <strong>Node-Server läuft?</strong> Im Projektordner <code>npm run dev</code> (Live) oder <code>npm run dev:mock</code> (Testdaten) starten.
        </li>
        <li className={status?.redis ? "done" : "todo"}>
          <strong>Redis erreichbar?</strong> Container <code>wow-redis</code> auf 127.0.0.1:6379.
          {!serverDown && status && !status.redis && status.bridge !== "mock" && <em> Aktuell: nicht verbunden.</em>}
        </li>
        <li className="todo">
          <strong>Worldserver läuft und du bist eingeloggt?</strong> Das Modul sendet nur, solange ein Master online ist.
        </li>
        <li className="todo">
          <strong>Bots in deiner Gruppe?</strong> Ohne Bots in der Gruppe werden keine Snapshots gesendet.
        </li>
        <li className="todo">
          <strong>Modul <code>mod-party-bridge</code> aktiv?</strong> Im Worldserver-Log nach der Bridge suchen.
        </li>
      </ol>
      {status && (
        <p className="muted small">
          Status: Bridge <strong>{status.bridge}</strong> · Redis <strong>{status.redis ? "verbunden" : "nicht verbunden"}</strong>
        </p>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ event log

type TypeFilter = "all" | "event" | "result" | "error";

export function EventLog({ log, bots }: { log: LogEntry[]; bots: string[] }) {
  const [type, setType] = useState<TypeFilter>("all");
  const [bot, setBot] = useState("");
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return log.filter(
      (e) =>
        (type === "all" || (type === "error" ? e.level === "error" : e.kind === type)) &&
        (!bot || e.bot === bot) &&
        (!needle || e.text.toLowerCase().includes(needle) || e.bot.toLowerCase().includes(needle)),
    );
  }, [log, type, bot, q]);

  return (
    <section className="panel log" aria-labelledby="log-h">
      <h2 id="log-h" className="panel-h">Ereignisse <span className="badge mute">{shown.length}{shown.length !== log.length ? ` / ${log.length}` : ""}</span></h2>
      <div className="toolbar tight">
        <label className="field">
          <span>Art</span>
          <select value={type} onChange={(e) => setType(e.target.value as TypeFilter)}>
            <option value="all">Alle</option>
            <option value="event">Ereignisse</option>
            <option value="result">Befehle</option>
            <option value="error">Nur Fehler</option>
          </select>
        </label>
        <label className="field">
          <span>Bot</span>
          <select value={bot} onChange={(e) => setBot(e.target.value)}>
            <option value="">Alle</option>
            {bots.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </label>
        <label className="field grow">
          <span>Suche</span>
          <input type="search" value={q} placeholder="Text …" onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      {shown.length === 0 ? (
        <p className="empty-note">{log.length === 0 ? "Noch keine Ereignisse." : "Nichts für diesen Filter."}</p>
      ) : (
        <ol className="log-list">
          {shown.map((e) => (
            <li key={e.key} className={`log-item l-${e.level}`}>
              <time dateTime={new Date(e.ts * 1000).toISOString()}>{fmtTime(e.ts)}</time>
              <span className="log-kind">{e.kind === "result" ? "Befehl" : "Ereignis"}</span>
              <span className="log-bot">{e.bot}</span>
              <span className="log-text">{e.text}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
