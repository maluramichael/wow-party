export type Money = { g: number; s: number; c: number };

export function splitMoney(copper: number): Money {
  const v = Math.max(0, Math.floor(copper));
  return { g: Math.floor(v / 10000), s: Math.floor((v % 10000) / 100), c: v % 100 };
}

const nf = new Intl.NumberFormat("de-DE");
export const fmtNum = (n: number) => nf.format(Math.round(n));
export const fmtDec = (n: number, d = 1) => n.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });

/** Compact number: 12.3k */
export function fmtCompact(n: number) {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${fmtDec(n / 1_000_000, 1)} Mio`;
  if (a >= 10_000) return `${fmtDec(n / 1000, 1)}k`;
  return fmtNum(n);
}

export function fmtAge(ms: number | null): string {
  if (ms === null) return "nie";
  const s = Math.floor(ms / 1000);
  if (s < 2) return "gerade eben";
  if (s < 60) return `vor ${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `vor ${m} min`;
  return `vor ${Math.floor(m / 60)} h`;
}

export const fmtTime = (tsSec: number) =>
  new Date(tsSec * 1000).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Countdown "1:23" until a unix-second timestamp. */
export function fmtCountdown(untilSec: number, nowMs: number) {
  const left = Math.max(0, Math.round(untilSec - nowMs / 1000));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

/** Rage / runic power are often raw x10 in the core (max 1000); show the familiar 0-100 scale then. */
export function powerDisplay(type: number, cur: number, max: number): { cur: number; max: number } {
  if ((type === 1 || type === 6) && max >= 500) return { cur: Math.round(cur / 10), max: Math.round(max / 10) };
  return { cur, max };
}

export const clampPct = (v: number) => Math.max(0, Math.min(100, v));
export const ratio = (cur: number, max: number) => (max > 0 ? clampPct((cur / max) * 100) : 0);
