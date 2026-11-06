import type { Server, IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as sync from "y-protocols/sync";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import { Redis } from "ioredis";
import { config } from "../config/index.js";
import { getSession } from "../services/auth.js";
import { access } from "../services/documents.js";
import {
  loadState,
  persistUpdate,
  snapshotDocument,
} from "../services/persistence.js";
import { logger } from "../utils/logger.js";
import { AppError } from "../utils/errors.js";

type User = { id: string; name: string; email: string };
type Peer = {
  ws: WebSocket;
  user: User;
  cookie: string;
  awarenessId?: number;
  alive: boolean;
  window: number;
  messages: number;
};
type Room = {
  id: string;
  doc: Y.Doc;
  awareness: Awareness;
  peers: Set<Peer>;
  queue: Promise<void>;
  touched: number;
};
const frame = (type: number, value: Uint8Array) => {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, type);
  encoding.writeVarUint8Array(e, value);
  return encoding.toUint8Array(e);
};
export const userColor = (id: string) =>
  ["#5378cf", "#a55a96", "#2d947b", "#be7736", "#8264c5", "#be5f65"][
    Array.from(id).reduce((n, c) => n + c.charCodeAt(0), 0) % 6
  ]!;
export class CollaborationHub {
  private wss = new WebSocketServer({
    noServer: true,
    maxPayload: 1024 * 1024,
    perMessageDeflate: false,
  });
  private rooms = new Map<string, Promise<Room>>();
  private instance = randomUUID();
  private pub = new Redis(config.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  private sub = new Redis(config.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  private timers: NodeJS.Timeout[] = [];
  private closing = false;
  constructor(server: Server) {
    for (const redis of [this.pub, this.sub])
      redis.on("error", () =>
        logger.warn("Redis unavailable; durable polling remains active"),
      );
    void this.pub.connect().catch(() => {});
    void this.sub
      .connect()
      .then(() => this.sub.subscribe("collabspace:events"))
      .catch(() => {});
    this.sub.on("message", (_channel, raw: string) => {
      try {
        const event = JSON.parse(raw) as {
          source: string;
          documentId: string;
          awareness?: string;
        };
        if (event.source === this.instance) return;
        const pending = this.rooms.get(event.documentId);
        if (pending)
          void pending.then((room) =>
            this.enqueue(room, async () => {
              if (event.awareness)
                applyAwarenessUpdate(
                  room.awareness,
                  Buffer.from(event.awareness, "base64"),
                  "redis",
                );
              else await this.refresh(room);
            }),
          );
      } catch {
        logger.warn("Invalid Redis event");
      }
    });
    server.on("upgrade", (req, socket, head) => {
      const reject = (status: number) => {
        socket.write(
          `HTTP/1.1 ${status} Rejected\r\nConnection: close\r\n\r\n`,
        );
        socket.destroy();
      };
      if (this.closing || req.headers.origin !== config.APP_ORIGIN)
        return reject(403);
      void this.authenticate(req)
        .then(async ({ id, user }) => {
          // Load before upgrade: providers send sync immediately on open, so no
          // asynchronous database work may precede attaching message listeners.
          const room = await this.room(id);
          if (this.closing || socket.destroyed) return reject(503);
          this.wss.handleUpgrade(req, socket, head, (ws) => {
            void this.connect(room, user, req.headers.cookie ?? "", ws);
          });
        })
        .catch(() => reject(401));
    });
    this.timers.push(
      setInterval(() => {
        for (const pending of this.rooms.values())
          void pending.then((room) =>
            this.enqueue(room, async () => {
              if (!room.peers.size && Date.now() - room.touched > 30000) {
                this.rooms.delete(room.id);
                room.awareness.destroy();
                room.doc.destroy();
                return;
              }
              await this.refresh(room);
              for (const peer of room.peers) {
                const session = await getSession(peer.cookie);
                if (!session) {
                  peer.ws.close(4401, "Session expired");
                  continue;
                }
                try {
                  await access(room.id, peer.user.id);
                } catch {
                  peer.ws.close(4403, "Access removed");
                }
              }
            }),
          );
      }, 2000),
    );
    this.timers.push(
      setInterval(() => {
        for (const pending of this.rooms.values())
          void pending.then((room) =>
            this.enqueue(room, async () => {
              await snapshotDocument(room.id);
            }),
          );
      }, config.SNAPSHOT_INTERVAL_MS),
    );
    this.timers.push(
      setInterval(() => {
        for (const ws of this.wss.clients) {
          const peer = this.peerBySocket.get(ws);
          if (!peer) continue;
          if (!peer.alive) ws.terminate();
          else {
            peer.alive = false;
            ws.ping();
          }
        }
      }, 30000),
    );
  }
  private peerBySocket = new Map<WebSocket, Peer>();
  private async authenticate(req: IncomingMessage) {
    const match = /^\/collab\/([0-9a-f-]{36})$/.exec(
      new URL(req.url ?? "", config.APP_ORIGIN).pathname,
    );
    if (!match) throw new Error("Invalid room");
    const session = await getSession(req.headers.cookie);
    if (!session) throw new Error("Unauthenticated");
    await access(match[1]!, session.user.id);
    return { id: match[1]!, user: session.user };
  }
  private async room(id: string): Promise<Room> {
    let pending = this.rooms.get(id);
    if (!pending) {
      pending = loadState(id).then(({ doc }) => {
        const awareness = new Awareness(doc);
        awareness.setLocalState(null);
        const room: Room = {
          id,
          doc,
          awareness,
          peers: new Set(),
          queue: Promise.resolve(),
          touched: Date.now(),
        };
        doc.on("update", (update: Uint8Array) => {
          const e = encoding.createEncoder();
          encoding.writeVarUint(e, 0);
          sync.writeUpdate(e, update);
          this.broadcast(room, encoding.toUint8Array(e));
        });
        awareness.on(
          "update",
          (
            {
              added,
              updated,
              removed,
            }: { added: number[]; updated: number[]; removed: number[] },
            origin: unknown,
          ) => {
            const update = encodeAwarenessUpdate(awareness, [
              ...added,
              ...updated,
              ...removed,
            ]);
            this.broadcast(room, frame(1, update));
            if (origin !== "redis") void this.publish(id, update);
          },
        );
        return room;
      });
      this.rooms.set(id, pending);
      void pending.catch(() => this.rooms.delete(id));
    }
    return pending;
  }
  private syncUpdate(update: Uint8Array) {
    const e = encoding.createEncoder();
    sync.writeUpdate(e, update);
    return encoding.toUint8Array(e);
  }
  private broadcast(room: Room, data: Uint8Array) {
    for (const peer of room.peers) this.send(peer.ws, data);
  }
  private send(ws: WebSocket, data: Uint8Array) {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 4 * 1024 * 1024) {
      ws.close(1013, "Slow consumer; reconnect");
      return;
    }
    ws.send(data);
  }
  private enqueue(room: Room, job: () => Promise<void>) {
    room.queue = room.queue.then(job).catch((err) => {
      logger.error(
        {
          err: err instanceof Error ? err.message : "unknown",
          documentId: room.id,
        },
        "Room operation failed",
      );
    });
    return room.queue;
  }
  private async refresh(room: Room) {
    const { doc } = await loadState(room.id);
    try {
      Y.applyUpdate(room.doc, Y.encodeStateAsUpdate(doc), "database");
    } finally {
      doc.destroy();
    }
  }
  private async publish(documentId: string, awareness?: Uint8Array) {
    try {
      await this.pub.publish(
        "collabspace:events",
        JSON.stringify({
          source: this.instance,
          documentId,
          awareness: awareness
            ? Buffer.from(awareness).toString("base64")
            : undefined,
        }),
      );
    } catch {
      /* PostgreSQL catch-up is authoritative. */
    }
  }
  private async connect(room: Room, user: User, cookie: string, ws: WebSocket) {
    try {
      const id = room.id;
      const peer: Peer = {
        ws,
        user,
        cookie,
        alive: true,
        window: Date.now(),
        messages: 0,
      };
      this.peerBySocket.set(ws, peer);
      ws.on("pong", () => {
        peer.alive = true;
      });
      ws.on("error", () => ws.terminate());
      ws.on("close", () => {
        this.peerBySocket.delete(ws);
        void this.enqueue(room, async () => {
          room.peers.delete(peer);
          room.touched = Date.now();
          if (peer.awarenessId !== undefined)
            removeAwarenessStates(
              room.awareness,
              [peer.awarenessId],
              "disconnect",
            );
        });
      });
      ws.on("message", (raw, binary) => {
        if (!binary || !Buffer.isBuffer(raw))
          return ws.close(1003, "Binary protocol required");
        if (Date.now() - peer.window > 10000) {
          peer.window = Date.now();
          peer.messages = 0;
        }
        if (++peer.messages > 500) return ws.close(1008, "Rate limit exceeded");
        void this.enqueue(room, async () => {
          if (ws.readyState !== WebSocket.OPEN) return;
          try {
            await this.message(room, peer, raw);
          } catch (err) {
            logger.warn(
              {
                documentId: id,
                reason: err instanceof Error ? err.message : "Invalid message",
              },
              "Collaboration message rejected",
            );
            // Database/network failures are transient; clients must retry their
            // locally retained changes. Access failures require a fresh login.
            if (err instanceof AppError)
              ws.close(
                err.status === 401 ? 4401 : 4403,
                "Update rejected; verify access",
              );
            else ws.close(1011, "Unable to save; reconnecting");
          }
        });
      });
      await this.enqueue(room, async () => {
        if (ws.readyState !== WebSocket.OPEN) return;
        await access(id, user.id);
        await this.refresh(room);
        room.peers.add(peer);
        const e = encoding.createEncoder();
        encoding.writeVarUint(e, 0);
        sync.writeSyncStep1(e, room.doc);
        this.send(ws, encoding.toUint8Array(e));
        this.send(
          ws,
          frame(
            1,
            encodeAwarenessUpdate(room.awareness, [
              ...room.awareness.getStates().keys(),
            ]),
          ),
        );
      });
    } catch {
      ws.close(1011, "Unable to load document");
    }
  }
  private async message(room: Room, peer: Peer, raw: Uint8Array) {
    if (!(await getSession(peer.cookie)))
      throw new AppError(401, "Session expired");
    const { role } = await access(room.id, peer.user.id);
    const decoder = decoding.createDecoder(raw);
    const type = decoding.readVarUint(decoder);
    if (type === 0) {
      const subtype = decoding.readVarUint(decoder);
      const payload = decoding.readVarUint8Array(decoder);
      if (subtype === sync.messageYjsSyncStep1) {
        await this.refresh(room);
        const e = encoding.createEncoder();
        encoding.writeVarUint(e, 0);
        sync.writeSyncStep2(e, room.doc, payload);
        this.send(peer.ws, encoding.toUint8Array(e));
      } else if (
        subtype === sync.messageYjsSyncStep2 ||
        subtype === sync.messageYjsUpdate
      ) {
        if (role === "VIEWER") {
          if (subtype === sync.messageYjsUpdate)
            throw new AppError(403, "Viewer cannot write");
          return;
        }
        // Validate binary structure before allowing an update into durable storage.
        Y.decodeUpdate(payload);
        await persistUpdate(room.id, peer.user.id, payload);
        Y.applyUpdate(room.doc, payload, peer.ws);
        // Extension to y-websocket: acknowledge the exact committed update, after commit.
        const ack = encoding.createEncoder();
        encoding.writeVarUint(ack, 4);
        encoding.writeVarUint(ack, subtype);
        encoding.writeVarUint8Array(ack, payload);
        this.send(peer.ws, encoding.toUint8Array(ack));
        void this.publish(room.id);
      } else throw new Error("Unknown sync message");
    } else if (type === 1) {
      const update = decoding.readVarUint8Array(decoder);
      const d = decoding.createDecoder(update);
      const count = decoding.readVarUint(d);
      if (count > 128) throw new Error("Presence batch too large");
      for (let i = 0; i < count; i++) {
        const clientId = decoding.readVarUint(d);
        const clock = decoding.readVarUint(d);
        const state = JSON.parse(decoding.readVarString(d)) as Record<
          string,
          unknown
        > | null;
        // The stock provider relays remote awareness updates. Ignore these;
        // a connection may only mutate the identity it claimed on opening.
        if (peer.awarenessId !== undefined && peer.awarenessId !== clientId)
          continue;
        if (
          peer.awarenessId === undefined &&
          room.awareness.getStates().has(clientId)
        )
          continue;
        peer.awarenessId = clientId;
        if (state)
          state.user = { name: peer.user.name, color: userColor(peer.user.id) };
        const e = encoding.createEncoder();
        encoding.writeVarUint(e, 1);
        encoding.writeVarUint(e, clientId);
        encoding.writeVarUint(e, clock);
        encoding.writeVarString(e, JSON.stringify(state));
        applyAwarenessUpdate(room.awareness, encoding.toUint8Array(e), peer.ws);
      }
    } else if (type === 3)
      this.send(
        peer.ws,
        frame(
          1,
          encodeAwarenessUpdate(room.awareness, [
            ...room.awareness.getStates().keys(),
          ]),
        ),
      );
    else throw new Error("Unknown message");
  }
  async close() {
    this.closing = true;
    this.timers.forEach(clearInterval);
    for (const ws of this.wss.clients) ws.close(1001, "Server restarting");
    for (const pending of this.rooms.values()) {
      const room = await pending;
      await room.queue;
      await snapshotDocument(room.id);
      room.awareness.destroy();
      room.doc.destroy();
    }
    this.rooms.clear();
    this.pub.disconnect();
    this.sub.disconnect();
    this.wss.close();
  }
}
