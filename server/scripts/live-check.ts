/**
 * Live-mode check against a real Redis (default redis://127.0.0.1:6379), acting as a fake bridge module:
 *  1. publishes a snapshot (also as wowparty:last:999999) and expects it on Socket.IO, bridge "live"
 *  2. sends a cmd from the browser side and expects the LPUSHed JSON on wowparty:cmd
 *  3. publishes a CommandResult on wowparty:res and expects it as "result"
 *  4. starts a second server pointing at a dead Redis: must not crash, status redis:false, cmd ack ok:false
 * Only touches keys/channels with the wowparty: prefix and cleans up after itself.
 */
import { Redis } from "ioredis";
import net from "node:net";
import { io } from "socket.io-client";
import { createApp } from "../src/app";
import { MockSource } from "../src/mock/mock";
import type { CmdAck, CommandResult, Snapshot, StatusPayload } from "../../shared/protocol";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const MASTER = 999999;
let failed = false;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` - ${extra}` : ""}`);
  if (!ok) failed = true;
};
const waitFor = <T>(what: string, ms: number, reg: (r: (v: T) => void) => void) =>
  new Promise<T>((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout: ${what}`)), ms);
    reg((v) => {
      clearTimeout(t);
      res(v);
    });
  });

async function fakeSnapshot(): Promise<Snapshot> {
  return new Promise<Snapshot>((resolve) => {
    const src = new MockSource({ snapshot: (s) => { src.stop(); resolve(s); }, event() {}, result() {}, redisState() {} });
    src.start();
  });
}

async function admin2Cleanup() {
  const r = new Redis(REDIS_URL, { maxRetriesPerRequest: 1 });
  await r.del("wowparty:cmd");
  r.disconnect();
}

async function main() {
  const admin = new Redis(REDIS_URL, { maxRetriesPerRequest: 1 });
  const existing = await admin.keys("wowparty:last:*");
  if (existing.length) {
    console.log(`SKIP: found live wowparty:last:* keys (${existing.join(", ")}) - a real module seems to be running`);
    admin.disconnect();
    return;
  }

  const snap = await fakeSnapshot();
  snap.master.accountId = MASTER;
  snap.master.name = "LiveCheckMaster";

  // pre-seed the "last" key: a freshly started server must pick it up as start state
  await admin.set(`wowparty:last:${MASTER}`, JSON.stringify(snap), "EX", 10);
  const app = await createApp({ mock: false, port: 0, redisUrl: REDIS_URL });
  const client = io(`http://127.0.0.1:${app.port}`, { transports: ["websocket"] });
  try {
    const first = await waitFor<Snapshot>("initial snapshot from last:*", 5000, (r) => client.once("snapshot", r));
    check("start state from wowparty:last:*", first.master.name === "LiveCheckMaster");

    // live channel
    const nextP = waitFor<Snapshot>("published snapshot", 5000, (r) => {
      const on = (s: Snapshot) => { if (s.ts > first.ts) { client.off("snapshot", on); r(s); } };
      client.on("snapshot", on);
    });
    await new Promise((r) => setTimeout(r, 300));
    await admin.publish("wowparty:snap", JSON.stringify({ ...snap, ts: snap.ts + 1 }));
    const next = await nextP;
    check("snapshot via wowparty:snap", next.ts === snap.ts + 1);

    const st = await waitFor<StatusPayload>("status", 5000, (r) => {
      const on = (s: StatusPayload) => { if (s.bridge === "live") { client.off("status", on); r(s); } };
      client.on("status", on);
    });
    check("status is live with redis:true", st.bridge === "live" && st.redis, JSON.stringify(st));

    // command -> list
    await admin.del("wowparty:cmd");
    const ack = await new Promise<CmdAck>((r) => client.emit("cmd", { bot: "LiveCheckBot", op: "strategy", args: { scope: "co", changes: "+dps,-passive" } }, r));
    check("cmd ack ok", ack.ok && !!ack.id, JSON.stringify(ack));
    const popped = await admin.brpop("wowparty:cmd", 3);
    const cmd = popped ? JSON.parse(popped[1]) : null;
    check("cmd arrives on wowparty:cmd", !!cmd && cmd.id === ack.id && cmd.op === "strategy" && cmd.args.changes === "+dps,-passive", JSON.stringify(cmd));

    const bad = await new Promise<CmdAck>((r) => client.emit("cmd", { bot: "x", op: "chat", args: { text: "hi\u0007there" } }, r));
    check("control characters rejected", !bad.ok, bad.error);
    check("nothing queued for rejected cmd", (await admin.llen("wowparty:cmd")) === 0);

    // result -> browser
    const resP = waitFor<CommandResult>("result", 5000, (r) => client.once("result", r));
    const res: CommandResult = { id: ack.id, ok: true, message: "zugestellt", bot: "LiveCheckBot", op: "strategy", ts: Math.floor(Date.now() / 1000) };
    await admin.publish("wowparty:res", JSON.stringify(res));
    check("result forwarded", (await resP).id === ack.id);

    // garbage on the channels must not break anything
    await admin.publish("wowparty:snap", "{not json");
    await admin.publish("wowparty:evt", "null");
    await new Promise((r) => setTimeout(r, 300));
    check("garbage ignored, server alive", client.connected);
  } catch (e) {
    check("live flow", false, (e as Error).message);
  } finally {
    client.close();
    await app.close();
    await admin.del(`wowparty:last:${MASTER}`, "wowparty:cmd");
    admin.disconnect();
  }

  // connection loss + reconnect through a killable TCP proxy
  {
    const PROXY_PORT = 6391;
    const sockets = new Set<net.Socket>();
    const startProxy = () =>
      new Promise<net.Server>((res) => {
        const srv = net.createServer((c) => {
          const up = net.connect(6379, "127.0.0.1");
          sockets.add(c); sockets.add(up);
          c.pipe(up); up.pipe(c);
          const drop = () => { c.destroy(); up.destroy(); };
          c.on("error", drop); up.on("error", drop); c.on("close", drop); up.on("close", drop);
        });
        srv.listen(PROXY_PORT, "127.0.0.1", () => res(srv));
      });
    let proxy = await startProxy();
    const pa = await createApp({ mock: false, port: 0, redisUrl: `redis://127.0.0.1:${PROXY_PORT}` });
    const pc = io(`http://127.0.0.1:${pa.port}`, { transports: ["websocket"] });
    const pub = new Redis(REDIS_URL, { maxRetriesPerRequest: 1 });
    const statusIs = (want: boolean) =>
      waitFor<StatusPayload>(`redis:${want}`, 15000, (r) => {
        const on = (x: StatusPayload) => { if (x.redis === want) { pc.off("status", on); r(x); } };
        pc.on("status", on);
      });
    try {
      await statusIs(true);
      await new Promise((r) => setTimeout(r, 300));
      const before = waitFor<Snapshot>("snapshot before drop", 5000, (r) => pc.once("snapshot", r));
      await pub.publish("wowparty:snap", JSON.stringify({ ...snap, ts: snap.ts + 10 }));
      await before;
      const down = statusIs(false);
      proxy.close();
      for (const c of sockets) c.destroy();
      sockets.clear();
      check("redis loss detected (redis:false), server alive", (await down).redis === false && pc.connected);
      const ackDown = await new Promise<CmdAck>((r) => pc.emit("cmd", { bot: "x", op: "follow" }, r));
      check("cmd during outage: ack ok:false", !ackDown.ok, ackDown.error);
      const up = statusIs(true);
      proxy = await startProxy();
      await up;
      check("automatic reconnect (redis:true again)", true);
      await new Promise((r) => setTimeout(r, 300));
      const after = waitFor<Snapshot>("snapshot after reconnect", 5000, (r) => pc.once("snapshot", r));
      await pub.publish("wowparty:snap", JSON.stringify({ ...snap, ts: snap.ts + 20 }));
      check("snapshots flow again after reconnect", (await after).ts === snap.ts + 20);
      await admin2Cleanup();
    } catch (e) {
      check("reconnect flow", false, (e as Error).message);
    } finally {
      pc.close();
      await pa.close();
      pub.disconnect();
      proxy.close();
      for (const c of sockets) c.destroy();
    }
  }

  // dead redis
  const dead = await createApp({ mock: false, port: 0, redisUrl: "redis://127.0.0.1:6390" });
  const dc = io(`http://127.0.0.1:${dead.port}`, { transports: ["websocket"] });
  try {
    const s = await waitFor<StatusPayload>("status (dead redis)", 5000, (r) => dc.once("status", r));
    check("dead redis: server up, bridge offline, redis:false", s.bridge === "offline" && !s.redis, JSON.stringify(s));
    const a = await new Promise<CmdAck>((r) => dc.emit("cmd", { bot: "x", op: "follow" }, r));
    check("dead redis: cmd ack ok:false", !a.ok && !!a.error, a.error);
  } catch (e) {
    check("dead redis flow", false, (e as Error).message);
  } finally {
    dc.close();
    await dead.close();
  }
  console.log(failed ? "FAIL" : "PASS");
  process.exitCode = failed ? 1 : 0;
}
await main();
