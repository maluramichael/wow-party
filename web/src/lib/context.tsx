import { createContext, useContext, useEffect, useState } from "react";
import type { PartyApi } from "./useParty";

/** Only what deep components need to trigger commands. */
export type ActionsApi = Pick<PartyApi, "send" | "isPending">;

export const ActionsContext = createContext<ActionsApi>({
  send: async () => ({ ok: false, id: "", error: "no provider" }),
  isPending: () => false,
});

export const useActions = () => useContext(ActionsContext);

/** Re-renders every `ms` and returns the current time (for ages / countdowns). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}
