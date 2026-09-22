/**
 * Smoke test: connect, wait for a snapshot, send a command, wait for its result.
 * Starts its own in-process mock server unless SMOKE_URL is set (then it tests that server).
 */
import { io } from "socket.io-client";
import { createApp, type App } from "../src/app";
import type { CmdAck, CommandResult, Snapshot } from "../../shared/protocol";

const TIMEOUT_MS = 10_000;

function waitFor<T>(what: string, register: (resolve: (v: T) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${what}`)), TIMEOUT_MS);
    register((v) => {
      clearTimeout(t);
      resolve(v);
    });
  });
}

async function main() {
  let app: App | null = null;
  let url = process.env.SMOKE_URL;
  if (!url) {
    app = await createApp({ mock: true, port: 0 });
    url = `http://127.0.0.1:${app.port}`;
  }
  const socket = io(url, { transports: ["websocket"] });
  try {
    const snap = await waitFor<Snapshot>("snapshot", (res) => socket.once("snapshot", res));
    if (snap.v !== 1 || !snap.members.length) throw new Error("snapshot has no members");
    console.log(`snapshot ok: master ${snap.master.name}, ${snap.members.length} bots, goldTotal ${snap.goldTotal}`);

    const bot = snap.members[0]!.name;
    const resultP = waitFor<CommandResult>("result", (res) => {
      const on = (r: CommandResult) => {
        if (r.bot === bot) {
          socket.off("result", on);
          res(r);
        }
      };
      socket.on("result", on);
    });
    const ack = await new Promise<CmdAck>((resolve) => socket.emit("cmd", { bot, op: "follow" }, resolve));
    if (!ack.ok || !ack.id) throw new Error(`bad ack: ${JSON.stringify(ack)}`);
    console.log(`ack ok: id ${ack.id}`);

    const result = await resultP;
    if (result.id !== ack.id) throw new Error(`result id mismatch: ${result.id} != ${ack.id}`);
    console.log(`result ok: ${result.ok ? "ok" : "failed"} - ${result.message}`);

    // Validation must reject bad input.
    const bad = await new Promise<CmdAck>((resolve) =>
      socket.emit("cmd", { bot, op: "chat", args: { text: ".server shutdown 1" } }, resolve),
    );
    if (bad.ok) throw new Error("GM command was not rejected");
    console.log(`validation ok: ${bad.error}`);

    console.log("PASS");
    process.exitCode = 0;
  } catch (e) {
    console.error("FAIL:", (e as Error).message);
    process.exitCode = 1;
  } finally {
    socket.close();
    await app?.close();
  }
}

await main();
