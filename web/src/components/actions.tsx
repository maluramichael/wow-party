import { useState, type FormEvent } from "react";
import type { Member, Op } from "@shared/protocol";
import { LIMITS } from "@shared/protocol";
import { cmdKey } from "../lib/useParty";
import { useActions } from "../lib/context";
import { STRATEGY_PRESETS } from "../lib/wow";
import { ActionButton } from "./ui";

// ------------------------------------------------------------------ per-bot actions

const BOT_ACTIONS: { op: Op; label: string; hint: string }[] = [
  { op: "follow", label: "Folgen", hint: "Bot folgt dem Master" },
  { op: "stay", label: "Bleiben", hint: "Bot bleibt stehen" },
  { op: "flee", label: "Fliehen", hint: "Bot flieht zum Master" },
  { op: "grind", label: "Grind", hint: "Bot grindet Mobs" },
  { op: "attack", label: "Angriff", hint: "Bot greift das Ziel des Masters an" },
  { op: "summon", label: "Rufen", hint: "Bot wird zum Master teleportiert" },
  { op: "revive", label: "Beleben", hint: "Bot wird wiederbelebt" },
  { op: "repair", label: "Reparieren", hint: "Bot repariert seine Ausrüstung" },
  { op: "loot-all", label: "Plündern", hint: "Bot plündert alles in Reichweite" },
];

export function BotActions({ bot }: { bot: string }) {
  return (
    <div className="actions" role="group" aria-label={`Aktionen für ${bot}`}>
      {BOT_ACTIONS.map((a) => (
        <ActionButton key={a.op} bot={bot} op={a.op} label={a.label} title={`${a.hint} (${bot})`} />
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ toolbar for all bots

const ALL_ACTIONS: { op: Op; label: string; hint: string }[] = [
  { op: "follow", label: "Alle folgen", hint: "Alle Bots folgen dem Master" },
  { op: "stay", label: "Alle bleiben", hint: "Alle Bots bleiben stehen" },
  { op: "grind", label: "Alle grinden", hint: "Alle Bots grinden" },
  { op: "repair", label: "Alle reparieren", hint: "Alle Bots reparieren" },
  { op: "loot-all", label: "Alle plündern", hint: "Alle Bots plündern alles in Reichweite" },
  { op: "summon", label: "Alle herbeirufen", hint: "Alle Bots zum Master teleportieren" },
];

export function AllBotsToolbar() {
  return (
    <section className="panel" aria-labelledby="all-bots-h">
      <h2 id="all-bots-h" className="panel-h">Alle Bots</h2>
      <div className="actions" role="group" aria-label="Aktionen für alle Bots">
        {ALL_ACTIONS.map((a) => (
          <ActionButton key={a.op} bot="*" op={a.op} label={a.label} title={a.hint} size="md" />
        ))}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ free command box

export function CommandBox({ bots }: { bots: string[] }) {
  const { send, isPending } = useActions();
  const [target, setTarget] = useState("*");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const validate = (v: string): string | null => {
    const t = v.trim();
    if (!t) return "Bitte einen Befehl eingeben.";
    if (t.length > LIMITS.chatMaxLength) return `Maximal ${LIMITS.chatMaxLength} Zeichen.`;
    if (t.startsWith(".")) return "Befehle mit Punkt (GM-Befehle) sind nicht erlaubt.";
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(v)) return "Steuerzeichen sind nicht erlaubt.";
    return null;
  };

  const bot = bots.includes(target) || target === "*" ? target : "*";
  const key = cmdKey(bot, "chat", { text: text.trim() });
  const pending = isPending(key);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const err = validate(text);
    setError(err);
    if (err) return;
    void send({ bot, op: "chat", args: { text: text.trim() } }).then((ack) => {
      if (ack.ok) setText("");
    });
  };

  return (
    <section className="panel" aria-labelledby="cmd-h">
      <h2 id="cmd-h" className="panel-h">Befehl senden</h2>
      <form className="cmd-form" onSubmit={submit} noValidate>
        <label className="field">
          <span>An</span>
          <select value={bot} onChange={(e) => setTarget(e.target.value)}>
            <option value="*">Alle Bots</option>
            {bots.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </label>
        <label className="field grow">
          <span>Playerbots-Befehl</span>
          <input
            type="text"
            value={text}
            maxLength={LIMITS.chatMaxLength}
            placeholder="z. B. co +dps  oder  stats"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby="cmd-help"
            onChange={(e) => {
              setText(e.target.value);
              if (error) setError(null);
            }}
          />
        </label>
        <button type="submit" className={`btn primary md ${pending ? "is-pending" : ""}`} disabled={pending} aria-busy={pending || undefined}>
          {pending && <span className="spinner" aria-hidden="true" />}Senden
        </button>
      </form>
      <p id="cmd-help" className={`hint ${error ? "err" : ""}`} role={error ? "alert" : undefined}>
        {error ?? `Wird als Flüstern des Masters an den Bot gesendet. Max. ${LIMITS.chatMaxLength} Zeichen, kein Punkt-Präfix.`}
      </p>
    </section>
  );
}

// ------------------------------------------------------------------ strategy chips

function StrategyGroup({ bot, scope, active, title }: { bot: string; scope: "co" | "nc"; active: string[]; title: string }) {
  const { send, isPending } = useActions();
  const [custom, setCustom] = useState("");
  const names = [...new Set([...STRATEGY_PRESETS[scope], ...active])];
  const change = (name: string, sign: "+" | "-") => void send({ bot, op: "strategy", args: { scope, changes: `${sign}${name}` } });
  const customOk = /^[A-Za-z0-9 _-]{1,40}$/.test(custom.trim());

  return (
    <fieldset className="strat">
      <legend>{title}</legend>
      <div className="chips">
        {names.map((n) => {
          const on = active.includes(n);
          const pending = isPending(cmdKey(bot, "strategy", { scope, changes: `${on ? "-" : "+"}${n}` }));
          return (
            <button
              key={n}
              type="button"
              className={`chip ${on ? "on" : ""} ${pending ? "is-pending" : ""}`}
              aria-pressed={on}
              disabled={pending}
              title={on ? `${n} ausschalten (-${n})` : `${n} einschalten (+${n})`}
              onClick={() => change(n, on ? "-" : "+")}
            >
              <span aria-hidden="true">{on ? "−" : "+"}</span> {n}
            </button>
          );
        })}
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <label className="field grow">
          <span className="sr-only">Eigene Strategie ({scope})</span>
          <input type="text" value={custom} placeholder="Eigene Strategie …" maxLength={40} onChange={(e) => setCustom(e.target.value)} />
        </label>
        <button type="button" className="btn sm" disabled={!customOk} onClick={() => { change(custom.trim(), "+"); setCustom(""); }}>+ an</button>
        <button type="button" className="btn sm" disabled={!customOk} onClick={() => { change(custom.trim(), "-"); setCustom(""); }}>− aus</button>
      </form>
    </fieldset>
  );
}

export function StrategyPanel({ m }: { m: Member }) {
  return (
    <div className="strat-grid">
      <StrategyGroup bot={m.name} scope="co" active={m.strategies.co} title="Im Kampf (co)" />
      <StrategyGroup bot={m.name} scope="nc" active={m.strategies.nc} title="Außerhalb des Kampfes (nc)" />
    </div>
  );
}
