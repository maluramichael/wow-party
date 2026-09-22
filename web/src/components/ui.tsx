import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Op } from "@shared/protocol";
import { cmdKey, type Toast } from "../lib/useParty";
import { useActions } from "../lib/context";
import { clampPct, fmtNum, ratio, splitMoney } from "../lib/format";
import { QUALITY_BORDER, QUALITY_COLOR, iconUrl } from "../lib/wow";

// ------------------------------------------------------------------ money

export function Money({ copper, className = "" }: { copper: number; className?: string }) {
  const { g, s, c } = splitMoney(copper);
  return (
    <span className={`money ${className}`} title={`${fmtNum(copper)} Kupfer`}>
      {g > 0 && (
        <>
          <span className="m-g">{fmtNum(g)}</span>
          <abbr title="Gold" className="m-u m-g">g</abbr>{" "}
        </>
      )}
      {(g > 0 || s > 0) && (
        <>
          <span className="m-s">{s}</span>
          <abbr title="Silber" className="m-u m-s">s</abbr>{" "}
        </>
      )}
      <span className="m-c">{c}</span>
      <abbr title="Kupfer" className="m-u m-c">c</abbr>
    </span>
  );
}

// ------------------------------------------------------------------ bars

export function Bar({
  label, cur, max, text, color, warn, className = "",
}: { label: string; cur: number; max: number; text?: string; color: string; warn?: boolean; className?: string }) {
  const pct = ratio(cur, max);
  const shown = text ?? `${fmtNum(cur)} / ${fmtNum(max)}`;
  return (
    <div
      className={`bar ${warn ? "bar-warn" : ""} ${className}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.max(max, 1)}
      aria-valuenow={Math.min(cur, Math.max(max, 1))}
      aria-valuetext={shown}
    >
      <div className="bar-fill" style={{ width: `${pct}%`, background: color }} />
      <span className="bar-text">{shown}</span>
    </div>
  );
}

/** Thin progress bar without text (quest objectives, target hp). */
export function MiniBar({ pct, color, label }: { pct: number; color: string; label: string }) {
  return (
    <div className="minibar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clampPct(pct))}>
      <div style={{ width: `${clampPct(pct)}%`, background: color }} />
    </div>
  );
}

// ------------------------------------------------------------------ state badge

const STATE: Record<string, { label: string; sym: string; cls: string }> = {
  combat: { label: "Kampf", sym: "⚔", cls: "st-combat" },
  "non-combat": { label: "Ruhig", sym: "●", cls: "st-calm" },
  dead: { label: "Tot", sym: "☠", cls: "st-dead" },
  unknown: { label: "Unbekannt", sym: "?", cls: "st-unknown" },
};

export function StateBadge({ state }: { state: string }) {
  const s = STATE[state] ?? STATE.unknown!;
  return (
    <span className={`badge state ${s.cls}`}>
      <span aria-hidden="true">{s.sym}</span> {s.label}
    </span>
  );
}

// ------------------------------------------------------------------ item icon

export const ItemIcon = memo(function ItemIcon({
  icon, quality, name, size = 40,
}: { icon: string | null; quality: number; name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [icon]);
  const border = QUALITY_BORDER[quality] ?? "#888";
  const style = { width: size, height: size, borderColor: border, boxShadow: quality >= 2 ? `0 0 0 1px ${border}55` : undefined };
  if (!icon || failed) {
    return (
      <span className="icon icon-fallback" style={{ ...style, color: QUALITY_COLOR[quality] ?? "#fff", fontSize: size * 0.45 }} aria-hidden="true">
        {name.trim().charAt(0).toUpperCase() || "?"}
      </span>
    );
  }
  return (
    <img
      className="icon"
      style={style}
      src={iconUrl(icon)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
});

// ------------------------------------------------------------------ confirm dialog

export function ConfirmDialog({
  open, title, children, confirmLabel = "Bestätigen", danger, onConfirm, onCancel,
}: { open: boolean; title: string; children: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return createPortal(
    <dialog
      ref={ref}
      className="confirm"
      aria-labelledby="confirm-title"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      // Keep state in sync when the browser closes the dialog on its own (e.g. a second Esc).
      onClose={() => {
        if (open) onCancel();
      }}
    >
      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm();
          }}
        >
          <h3 id="confirm-title">{title}</h3>
          <div className="confirm-body">{children}</div>
          <div className="row end">
            <button type="button" className="btn" onClick={onCancel}>Abbrechen</button>
            <button type="submit" className={`btn ${danger ? "danger" : "primary"}`}>{confirmLabel}</button>
          </div>
        </form>
      )}
    </dialog>,
    document.body,
  );
}

// ------------------------------------------------------------------ action button

export type ActionProps = {
  bot: string;
  op: Op;
  args?: Record<string, unknown>;
  label: string;
  variant?: "default" | "primary" | "danger" | "ghost";
  size?: "sm" | "md";
  confirm?: { title: string; body: ReactNode; confirmLabel?: string };
  /** When set the button is inert and explains why (tooltip + aria-describedby text). */
  disabledReason?: string;
  title?: string;
  className?: string;
};

export function ActionButton({ bot, op, args, label, variant = "default", size = "sm", confirm, disabledReason, title, className = "" }: ActionProps) {
  const { send, isPending } = useActions();
  const [asking, setAsking] = useState(false);
  const pending = isPending(cmdKey(bot, op, args));
  const blocked = !!disabledReason;
  const run = () => void send({ bot, op, ...(args ? { args } : {}) });

  return (
    <>
      <button
        type="button"
        className={`btn ${variant} ${size} ${pending ? "is-pending" : ""} ${blocked ? "is-blocked" : ""} ${className}`}
        disabled={pending}
        aria-busy={pending || undefined}
        aria-disabled={blocked || undefined}
        title={disabledReason ?? title}
        onClick={() => {
          if (blocked) return;
          if (confirm) setAsking(true);
          else run();
        }}
      >
        {pending && <span className="spinner" aria-hidden="true" />}
        {label}
        {pending && <span className="sr-only"> (läuft)</span>}
      </button>
      {confirm && (
        <ConfirmDialog
          open={asking}
          title={confirm.title}
          confirmLabel={confirm.confirmLabel ?? label}
          danger={variant === "danger"}
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            run();
          }}
        >
          {confirm.body}
        </ConfirmDialog>
      )}
    </>
  );
}

// ------------------------------------------------------------------ toasts

function ToastItem({ toast, onClose }: { toast: Toast; onClose: (id: number) => void }) {
  useEffect(() => {
    const t = window.setTimeout(() => onClose(toast.id), toast.kind === "error" ? 9000 : 5500);
    return () => window.clearTimeout(t);
  }, [toast.id, toast.kind, onClose]);
  return (
    <li className={`toast t-${toast.kind}`}>
      <div>
        <strong>{toast.title}</strong>
        {toast.text && <p>{toast.text}</p>}
      </div>
      <button type="button" className="icon-btn" aria-label="Meldung schließen" onClick={() => onClose(toast.id)}>×</button>
    </li>
  );
}

export function Toasts({ toasts, onClose }: { toasts: Toast[]; onClose: (id: number) => void }) {
  return (
    <ul className="toasts" aria-live="polite" aria-label="Meldungen">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onClose={onClose} />
      ))}
    </ul>
  );
}
