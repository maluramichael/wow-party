# wow-party

Live-Dashboard für die Playerbots-Party auf dem WoW-3.3.5a-Server (AzerothCore + mod-playerbots).
Zeigt alles **im Vergleich zu deinem aktiven Charakter** ("Du"), damit man beim Spielen Abweichungen
(Quests, Ausrüstung, Level, Zone) sofort sieht, und erlaubt Befehle an die Bots.

Der Vertrag zwischen Modul, Server und Browser steht in **[PROTOCOL.md](PROTOCOL.md)** (Datentypen, Redis-Schlüssel,
Socket.IO-Events). Die TypeScript-Typen dazu liegen in `shared/protocol.ts`.

## Architektur

```
 worldserver                     Node (server/)                    Browser (web/)
┌────────────────────┐  Redis  ┌──────────────────────┐ Socket.IO ┌───────────────┐
│ mod-party-bridge   │ ──────▶ │ ioredis subscribe    │ ────────▶ │ React + Vite  │
│ (C++, Welt-Thread) │ ◀────── │ socket.io  :4400     │ ◀──────── │ :5173         │
└────────────────────┘         └──────────────────────┘           └───────────────┘
        wow-redis 127.0.0.1:6379            (alternativ: Mock-Modus ohne Redis / Worldserver)
```

- `server/` - Node 22 + TypeScript (`tsx`). Abonniert `wowparty:snap|evt|res`, legt Befehle per `LPUSH wowparty:cmd` ab,
  validiert jeden Befehl (Op-Whitelist, Argumenttypen, max. 200 Zeichen, kein `.`-Präfix, keine Steuerzeichen,
  ~20 Befehle/s pro Socket), drosselt Snapshots auf max. 1 Hz und meldet alle 2 s einen `status`.
  Redis-Ausfall crasht nichts (Backoff-Reconnect, `redis:false`, Befehle werden sofort mit Fehler quittiert).
- `web/` - Vite + React 18 + TypeScript, reines CSS, keine Tracking-Skripte. Icons kommen (optional) von
  `wow.zamimg.com`; bei Fehler gibt es einen Platzhalter.
- `shared/protocol.ts` - gemeinsame Typen (werden von beiden Seiten importiert).

## Start

```powershell
npm install

# Mock-Modus: realistische Fake-Party, kein Redis / Worldserver nötig
npm run dev:mock

# Live-Modus: braucht Redis (Container wow-redis) und das Modul mod-party-bridge im Worldserver
npm run dev
```

Dann <http://127.0.0.1:5173> öffnen. Einzeln: `npm run dev -w server` / `npm run dev -w web`.

Weitere Skripte: `npm run typecheck`, `npm run build` (Typecheck + `vite build`), `npm run smoke`
(Server-Selbsttest gegen den Mock, startet seinen eigenen Server), `npm run live-check -w server`
(Live-Modus gegen echtes Redis inkl. Verbindungsabbruch; schreibt nur unter `wowparty:`),
`node scripts/screenshots.mjs` (UI-Smoke-Test + Screenshots nach `docs/screenshots/`, braucht Chrome/Edge und einen
laufenden `npm run dev:mock`).

## Ports und Umgebungsvariablen

| Was | Wert |
|---|---|
| Node/Socket.IO | `127.0.0.1:4400` |
| Vite (Web) | `127.0.0.1:5173` |
| Redis | `127.0.0.1:6379` |

| Variable | Wirkung | Standard |
|---|---|---|
| `PORT` | Port des Socket.IO-Servers | `4400` |
| `MOCK=1` (oder `--mock`) | Mock-Modus statt Redis | aus |
| `REDIS_URL` | Redis-Adresse (Live) | `redis://127.0.0.1:6379` |
| `MASTER_ACCOUNT_ID` | nur Snapshots dieses Master-Accounts annehmen | alle |
| `MOCK_FAIL_RATE` | Anteil fehlschlagender Mock-Befehle (0..1) | `0.1` |
| `VITE_SOCKET_URL` (Web) | Adresse des Servers, falls nicht `<hostname>:4400` | - |
| `BROWSER_PATH` | Chrome/Edge für `scripts/screenshots.mjs` | automatisch |

## Sicherheit

Es gibt **keine Authentifizierung**. Server und Vite binden nur an `127.0.0.1`, CORS erlaubt nur
`http://localhost:5173` und `http://127.0.0.1:5173`. Nicht ohne Auth/Reverse-Proxy ins Netz stellen: wer den
Socket erreicht, kann den Bots Befehle geben. GM-Befehle (Präfix `.`) werden serverseitig abgelehnt.

## Hinweise zur Bedienung

- `ok` in einer Rückmeldung heißt **zugestellt**, nicht erledigt (PROTOCOL.md, Abschnitt 4). Das Ergebnis sieht man
  im nächsten Snapshot; die UI schreibt deshalb "Zugestellt: ...".
- "Zu mir handeln": mehrere Items auswählbar (max. 6, so viele passen ins WoW-Handelsfenster). Das Handelsfenster
  danach im Spiel bestätigen.
- "Bot soll annehmen" (Quest) klappt nur, wenn der Bot beim Questgeber steht oder ein Angebot offen ist.
- Esc schließt die Detailansicht bzw. zuerst den Bestätigungsdialog.

## Struktur

```
shared/protocol.ts        Typen + Op-Liste + Limits
server/src/app.ts         Socket.IO, Throttle, Status, Befehlsannahme
server/src/redis.ts       ioredis (2 Verbindungen), Startzustand aus wowparty:last:*
server/src/validate.ts    Befehlsvalidierung, Rate-Limit, Snapshot-Parser
server/src/mock/          Mock-Party (Simulation + Befehlsausführung)
server/scripts/           smoke.ts, live-check.ts
web/src/lib/              useParty (Socket, Toasts, Pending), Formatierung, WoW-Daten
web/src/components/       Karten, Detail-Drawer, Taschen/Ausrüstung/Werte/Quests, Log, Aktionen
scripts/screenshots.mjs   UI-Smoke-Test + Screenshots
```
