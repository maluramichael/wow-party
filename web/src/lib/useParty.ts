import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { ClientCommand, CmdAck, CommandResult, PartyEvent, Snapshot, StatusPayload } from "@shared/protocol";
import { share } from "./share";
import { OP_LABEL } from "./wow";

export type Conn = "connecting" | "connected" | "reconnecting";
export type ToastKind = "ok" | "error" | "info";
export type Toast = { id: number; kind: ToastKind; title: string; text: string };
export type LogEntry = {
  key: number;
  kind: "event" | "result";
  ts: number; // unix seconds
  bot: string;
  type: string; // event type or op
  level: "info" | "ok" | "error";
  text: string;
};

export type PartyApi = {
  snapshot: Snapshot | null;
  /** Client time (ms) when the current snapshot arrived. */
  snapshotAt: number | null;
  status: StatusPayload | null;
  statusAt: number | null;
  conn: Conn;
  url: string;
  toasts: Toast[];
  dismissToast: (id: number) => void;
  log: LogEntry[];
  send: (cmd: ClientCommand) => Promise<CmdAck>;
  isPending: (key: string) => boolean;
};

const SOCKET_URL: string = import.meta.env.VITE_SOCKET_URL ?? `${location.protocol}//${location.hostname}:4400`;
const RESULT_TIMEOUT_MS = 12_000;
const ACK_TIMEOUT_MS = 5_000;
const MAX_LOG = 200;
const MAX_TOASTS = 5;

/** Stable identity of "the same action": pending buttons match on this. */
export const cmdKey = (bot: string, op: string, args?: Record<string, unknown>) =>
  `${bot}|${op}|${args ? JSON.stringify(args) : ""}`;

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

type Pending = { key: string; expected: number; timer: number };

export function useParty(): PartyApi {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [snapshotAt, setSnapshotAt] = useState<number | null>(null);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [statusAt, setStatusAt] = useState<number | null>(null);
  const [conn, setConn] = useState<Conn>("connecting");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(new Set());

  const socketRef = useRef<Socket | null>(null);
  const pendingRef = useRef(new Map<string, Pending>());
  const membersRef = useRef(0);
  const seq = useRef(1);

  const syncPending = useCallback(() => {
    setPendingKeys(new Set([...pendingRef.current.values()].map((p) => p.key)));
  }, []);

  const addToast = useCallback((kind: ToastKind, title: string, text: string) => {
    setToasts((t) => [...t.slice(-(MAX_TOASTS - 1)), { id: seq.current++, kind, title, text }]);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const addLog = useCallback((e: Omit<LogEntry, "key">) => {
    setLog((l) => [{ ...e, key: seq.current++ }, ...l].slice(0, MAX_LOG));
  }, []);

  const finish = useCallback(
    (id: string, timedOut: boolean) => {
      const p = pendingRef.current.get(id);
      if (!p) return;
      window.clearTimeout(p.timer);
      pendingRef.current.delete(id);
      syncPending();
      if (timedOut) addToast("error", "Keine Rückmeldung", "Das Modul hat nicht geantwortet (Timeout). Läuft mod-party-bridge?");
    },
    [addToast, syncPending],
  );

  useEffect(() => {
    const socket: Socket = io(SOCKET_URL, { reconnectionDelayMax: 5000 });
    socketRef.current = socket;

    socket.on("connect", () => setConn("connected"));
    socket.on("disconnect", () => {
      setConn("reconnecting");
      for (const id of [...pendingRef.current.keys()]) finish(id, false);
    });
    socket.on("connect_error", () => setConn((c) => (c === "connecting" ? "connecting" : "reconnecting")));

    socket.on("snapshot", (s: Snapshot) => {
      membersRef.current = s.members.length;
      setSnapshot((prev) => share(prev, s));
      setSnapshotAt(Date.now());
    });
    socket.on("status", (s: StatusPayload) => {
      setStatus(s);
      setStatusAt(Date.now());
    });
    socket.on("event", (e: PartyEvent) => {
      addLog({ kind: "event", ts: e.ts, bot: e.bot, type: e.type, level: e.type === "bot_death" ? "error" : "info", text: e.text });
      if (e.type === "quest_offer" || e.type === "trade_opened" || e.type === "bot_death" || e.type === "bot_levelup") {
        addToast(e.type === "bot_death" ? "error" : "info", e.bot, e.text);
      }
    });
    socket.on("result", (r: CommandResult) => {
      const label = OP_LABEL[r.op] ?? r.op;
      addLog({ kind: "result", ts: r.ts, bot: r.bot, type: r.op, level: r.ok ? "ok" : "error", text: `${label}: ${r.message}` });
      // ok = delivered to the bot, not "done" (see PROTOCOL.md section 4): wording reflects that.
      addToast(r.ok ? "ok" : "error", r.ok ? `Zugestellt: ${label} - ${r.bot}` : `Fehlgeschlagen: ${label} - ${r.bot}`, r.message);
      const p = pendingRef.current.get(r.id);
      if (p) {
        p.expected -= 1;
        if (p.expected <= 0) finish(r.id, false);
      }
    });

    const pending = pendingRef.current;
    return () => {
      socket.close();
      socketRef.current = null;
      for (const p of pending.values()) window.clearTimeout(p.timer);
      pending.clear();
    };
  }, [addLog, addToast, finish]);

  const send = useCallback(
    (cmd: ClientCommand): Promise<CmdAck> => {
      const fail = (error: string): CmdAck => {
        addToast("error", "Befehl nicht gesendet", error);
        return { ok: false, id: "", error };
      };
      const socket = socketRef.current;
      if (!socket || !socket.connected) return Promise.resolve(fail("Keine Verbindung zum Dashboard-Server"));
      const key = cmdKey(cmd.bot, cmd.op, cmd.args);
      for (const p of pendingRef.current.values()) {
        if (p.key === key) return Promise.resolve({ ok: false, id: "", error: "Befehl läuft bereits" });
      }

      const id = cmd.id || newId();
      const expected = cmd.bot === "*" ? Math.max(1, membersRef.current) : 1;
      const timer = window.setTimeout(() => finish(id, true), RESULT_TIMEOUT_MS);
      pendingRef.current.set(id, { key, expected, timer });
      syncPending();

      return new Promise<CmdAck>((resolve) => {
        socket.timeout(ACK_TIMEOUT_MS).emit("cmd", { ...cmd, id }, (err: Error | null, ack?: CmdAck) => {
          if (err || !ack) {
            finish(id, false);
            resolve(fail("Der Server antwortet nicht"));
            return;
          }
          if (!ack.ok) {
            finish(id, false);
            addToast("error", "Befehl abgelehnt", ack.error ?? "Unbekannter Fehler");
            addLog({
              kind: "result", ts: Math.floor(Date.now() / 1000), bot: cmd.bot, type: cmd.op, level: "error",
              text: `${OP_LABEL[cmd.op]}: ${ack.error ?? "abgelehnt"}`,
            });
          }
          resolve(ack);
        });
      });
    },
    [addLog, addToast, finish, syncPending],
  );

  const isPending = useCallback((key: string) => pendingKeys.has(key), [pendingKeys]);

  return useMemo(
    () => ({ snapshot, snapshotAt, status, statusAt, conn, url: SOCKET_URL, toasts, dismissToast, log, send, isPending }),
    [snapshot, snapshotAt, status, statusAt, conn, toasts, dismissToast, log, send, isPending],
  );
}
