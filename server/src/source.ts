import type { Command, CommandResult, PartyEvent, Snapshot } from "../../shared/protocol";

/** Where data flows in (module via Redis, or the mock). */
export interface Sink {
  snapshot(s: Snapshot, opts?: { receivedAtMs?: number }): void;
  event(e: PartyEvent): void;
  result(r: CommandResult): void;
  /** Redis connectivity changed (live mode only). */
  redisState(up: boolean): void;
}

export interface Source {
  readonly kind: "live" | "mock";
  start(): void | Promise<void>;
  stop(): Promise<void> | void;
  /** Queue a validated command for the module. Rejects with a human-readable Error. */
  submit(cmd: Command): Promise<void>;
}

export const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
