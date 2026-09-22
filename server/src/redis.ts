import { Redis, type RedisOptions } from "ioredis";
import type { Command, CommandResult, PartyEvent } from "../../shared/protocol";
import { log, type Sink, type Source } from "./source";
import { parseJson, parseSnapshot } from "./validate";

export const KEYS = {
  snap: "wowparty:snap",
  evt: "wowparty:evt",
  res: "wowparty:res",
  cmd: "wowparty:cmd",
  lastPattern: "wowparty:last:*",
} as const;

const backoff = (times: number) => Math.min(250 * 2 ** Math.min(times, 5), 5000);

/** Live source: subscribes to the module's channels and pushes commands onto the list. */
export class RedisSource implements Source {
  readonly kind = "live" as const;
  private sub: Redis;
  private pub: Redis;
  private subReady = false;
  private pubReady = false;
  private lastUp = false;
  private lastErrAt = 0;
  private lastErrMsg = "";
  private stopped = false;

  constructor(
    private readonly url: string,
    private readonly sink: Sink,
  ) {
    const common: RedisOptions = {
      retryStrategy: backoff,
      connectTimeout: 3000,
      // Do not throw away a subscription because of a temporary outage.
      autoResubscribe: true,
    };
    // Subscriber: wait forever (its only command is SUBSCRIBE, replayed on reconnect).
    this.sub = new Redis(url, { ...common, maxRetriesPerRequest: null, lazyConnect: true });
    // Writer: fail fast while Redis is down, so the browser gets an immediate error ack.
    this.pub = new Redis(url, { ...common, maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: true });
    this.wire(this.sub, "sub");
    this.wire(this.pub, "pub");
  }

  private wire(c: Redis, name: "sub" | "pub") {
    c.on("ready", () => {
      if (name === "sub") this.subReady = true;
      else {
        this.pubReady = true;
        void this.loadLast();
      }
      this.reportState();
    });
    const down = () => {
      if (name === "sub") this.subReady = false;
      else this.pubReady = false;
      this.reportState();
    };
    c.on("close", down);
    c.on("end", down);
    // An unhandled "error" event would otherwise be printed for every retry.
    c.on("error", (err: Error) => {
      const now = Date.now();
      const msg = `${(err as NodeJS.ErrnoException).code ?? ""} ${err.message}`.trim();
      if (msg !== this.lastErrMsg || now - this.lastErrAt > 30_000) {
        this.lastErrMsg = msg;
        this.lastErrAt = now;
        log(`[redis:${name}] ${msg} (retrying)`);
      }
    });
  }

  private reportState() {
    const up = this.subReady && this.pubReady;
    if (up !== this.lastUp) {
      this.lastUp = up;
      log(`[redis] ${up ? "connected" : "disconnected"}`);
      this.sink.redisState(up);
    }
  }

  async start() {
    this.sub.on("message", (channel: string, message: string) => {
      if (channel === KEYS.snap) {
        const s = parseSnapshot(message);
        if (s) this.sink.snapshot(s);
      } else if (channel === KEYS.evt) {
        const e = parseJson<PartyEvent>(message);
        if (e && typeof e.text === "string" && typeof e.type === "string") this.sink.event(e);
      } else if (channel === KEYS.res) {
        const r = parseJson<CommandResult>(message);
        if (r && typeof r.id === "string" && typeof r.ok === "boolean") this.sink.result(r);
      }
    });
    // Connect in the background; failures are handled by the retry strategy.
    this.sub.connect().catch(() => undefined);
    this.pub.connect().catch(() => undefined);
    this.sub.subscribe(KEYS.snap, KEYS.evt, KEYS.res).catch((e: Error) => log("[redis] subscribe failed:", e.message));
  }

  /** Startup state: newest of all `wowparty:last:*` keys. */
  private async loadLast() {
    try {
      const keys: string[] = [];
      let cursor = "0";
      do {
        const [next, batch] = await this.pub.scan(cursor, "MATCH", KEYS.lastPattern, "COUNT", 100);
        cursor = next;
        keys.push(...batch);
      } while (cursor !== "0" && !this.stopped);
      if (!keys.length) return;
      const values = await this.pub.mget(keys);
      let best: ReturnType<typeof parseSnapshot> = null;
      for (const v of values) {
        const s = parseSnapshot(v);
        if (s && (!best || s.ts > best.ts)) best = s;
      }
      if (best) {
        log(`[redis] initial snapshot from wowparty:last:* (master ${best.master.name}, ${best.members.length} bots)`);
        this.sink.snapshot(best, { receivedAtMs: Math.min(Date.now(), best.ts * 1000) });
      }
    } catch (e) {
      log("[redis] initial snapshot load failed:", (e as Error).message);
    }
  }

  async submit(cmd: Command): Promise<void> {
    if (!(this.pubReady && this.subReady)) throw new Error("Redis nicht verbunden");
    try {
      await this.pub.lpush(KEYS.cmd, JSON.stringify(cmd));
    } catch (e) {
      throw new Error(`Redis-Fehler: ${(e as Error).message}`);
    }
  }

  async stop() {
    this.stopped = true;
    this.sub.disconnect();
    this.pub.disconnect();
  }
}
