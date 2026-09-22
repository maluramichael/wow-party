import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "socket.io";
import {
  LIMITS,
  type BridgeState,
  type ClientToServerEvents,
  type CommandResult,
  type PartyEvent,
  type ServerToClientEvents,
  type Snapshot,
  type StatusPayload,
} from "../../shared/protocol";
import { MockSource } from "./mock/mock";
import { RedisSource } from "./redis";
import { log, type Sink, type Source } from "./source";
import { RateLimiter, validateCommand } from "./validate";

export type AppOptions = {
  port: number;
  host: string;
  mock: boolean;
  redisUrl: string;
  /** Only accept snapshots of this master account (optional). */
  masterAccountId?: number;
  origins: string[];
};

export const defaultOptions = (): AppOptions => ({
  port: Number(process.env.PORT ?? 4400),
  host: "127.0.0.1", // loopback only, no auth in v1
  mock: process.env.MOCK === "1" || process.argv.includes("--mock"),
  redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  masterAccountId: process.env.MASTER_ACCOUNT_ID ? Number(process.env.MASTER_ACCOUNT_ID) : undefined,
  origins: ["http://localhost:5173", "http://127.0.0.1:5173"],
});

export type App = {
  io: Server<ClientToServerEvents, ServerToClientEvents>;
  http: HttpServer;
  port: number;
  close(): Promise<void>;
};

const SNAPSHOT_MIN_INTERVAL_MS = 1000;
const STATUS_INTERVAL_MS = 2000;

export async function createApp(overrides: Partial<AppOptions> = {}): Promise<App> {
  const opts: AppOptions = { ...defaultOptions(), ...overrides };

  let latest: Snapshot | null = null;
  let latestAtMs: number | null = null;
  let redisUp = false;
  let lastEmitMs = 0;
  let pendingEmit: NodeJS.Timeout | null = null;

  const bridgeStatus = (): StatusPayload => {
    const age = latestAtMs === null ? null : Math.max(0, Date.now() - latestAtMs);
    let bridge: BridgeState;
    if (opts.mock) bridge = "mock";
    else if (!redisUp || age === null) bridge = "offline";
    else bridge = age > LIMITS.staleAfterMs ? "stale" : "live";
    return { bridge, lastSnapshotAgeMs: age, redis: redisUp };
  };

  const http = createServer((req, res) => {
    // Small health endpoint for scripts; everything else is Socket.IO.
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, ...bridgeStatus() }));
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("wow-party socket server - connect with socket.io\n");
  });

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(http, {
    cors: { origin: opts.origins, methods: ["GET", "POST"] },
    // Snapshots with ~100 items/bot stay well below this.
    maxHttpBufferSize: 1e6,
  });

  const emitLatest = () => {
    if (!latest) return;
    lastEmitMs = Date.now();
    io.emit("snapshot", latest);
  };

  // Leading + trailing throttle: at most one snapshot per second, always the newest one.
  const sink: Sink = {
    snapshot(s, o) {
      if (opts.masterAccountId !== undefined && s.master.accountId !== opts.masterAccountId) return;
      // Ignore out-of-order older snapshots (e.g. the startup `last:*` key racing the live channel).
      if (latest && s.ts < latest.ts) return;
      latest = s;
      latestAtMs = o?.receivedAtMs ?? Date.now();
      if (pendingEmit) return;
      const wait = SNAPSHOT_MIN_INTERVAL_MS - (Date.now() - lastEmitMs);
      if (wait <= 0) emitLatest();
      else
        pendingEmit = setTimeout(() => {
          pendingEmit = null;
          emitLatest();
        }, wait);
    },
    event: (e: PartyEvent) => void io.emit("event", e),
    result: (r: CommandResult) => void io.emit("result", r),
    redisState(up) {
      redisUp = up;
      io.emit("status", bridgeStatus());
    },
  };

  const source: Source = opts.mock ? new MockSource(sink) : new RedisSource(opts.redisUrl, sink);

  io.on("connection", (socket) => {
    const limiter = new RateLimiter(LIMITS.cmdPerSecondPerSocket);
    if (latest) socket.emit("snapshot", latest);
    socket.emit("status", bridgeStatus());

    socket.on("cmd", async (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => undefined;
      if (!limiter.take()) return reply({ ok: false, id: "", error: "Zu viele Befehle - bitte kurz warten" });
      const v = validateCommand(payload);
      if (!v.ok) return reply({ ok: false, id: "", error: v.error });
      try {
        await source.submit(v.cmd);
        reply({ ok: true, id: v.cmd.id });
      } catch (e) {
        reply({ ok: false, id: v.cmd.id, error: (e as Error).message });
      }
    });
  });

  const statusTimer = setInterval(() => io.emit("status", bridgeStatus()), STATUS_INTERVAL_MS);

  await source.start();
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(opts.port, opts.host, resolve);
  });
  const port = (http.address() as AddressInfo).port;
  log(`wow-party server on http://${opts.host}:${port} (${opts.mock ? "MOCK" : `live, redis ${opts.redisUrl}`})`);

  return {
    io,
    http,
    port,
    async close() {
      clearInterval(statusTimer);
      if (pendingEmit) clearTimeout(pendingEmit);
      await source.stop();
      await io.close();
    },
  };
}
