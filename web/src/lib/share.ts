/**
 * Structural sharing: returns `prev` (same reference) for every subtree that is deeply equal to `next`.
 * Lets React.memo skip unchanged bots / item lists although a whole new snapshot object arrives every second.
 */
export function share<T>(prev: unknown, next: T): T {
  if (prev === next) return next;
  if (Array.isArray(next) && Array.isArray(prev)) {
    let same = prev.length === next.length;
    const out = next.map((n, i) => {
      const v = share(prev[i], n);
      if (v !== prev[i]) same = false;
      return v;
    });
    return (same ? prev : out) as T;
  }
  if (next && prev && typeof next === "object" && typeof prev === "object" && !Array.isArray(prev) && !Array.isArray(next)) {
    const p = prev as Record<string, unknown>;
    const n = next as Record<string, unknown>;
    const keys = Object.keys(n);
    let same = Object.keys(p).length === keys.length;
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      const v = share(p[k], n[k]);
      out[k] = v;
      if (v !== p[k]) same = false;
    }
    return (same ? prev : out) as T;
  }
  return next;
}
