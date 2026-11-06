import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import WebSocket from "ws";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { createApp } from "../src/app.js";
import { CollaborationHub } from "../src/websocket/hub.js";
import { db } from "../src/models/db.js";
import {
  loadState,
  snapshotDocument,
  persistUpdate,
} from "../src/services/persistence.js";
import { config } from "../src/config/index.js";

const app = createApp();
const origin = config.APP_ORIGIN;
const prefix = `integration-${Date.now()}`;
type Account = { id: string; email: string; cookie: string };
let owner: Account, editor: Account, viewer: Account, outsider: Account;
let documentId: string;
let server: Server, hub: CollaborationHub, url: string;
const clients: { doc: Y.Doc; provider: WebsocketProvider }[] = [];
const accountIds: string[] = [];
async function account(name: string): Promise<Account> {
  const email = `${prefix}-${name}@example.com`;
  const res = await request(app)
    .post("/api/auth/register")
    .set("Origin", origin)
    .send({ name, email, password: "Test-password-123!" })
    .expect(201);
  accountIds.push(res.body.id);
  return {
    id: res.body.id,
    email,
    cookie: res.headers["set-cookie"][0].split(";")[0],
  };
}
async function start() {
  server = createServer(app);
  hub = new CollaborationHub(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/collab`;
}
async function stop() {
  await hub.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
async function until(
  predicate: () => boolean | Promise<boolean>,
  timeout = 10000,
) {
  const deadline = Date.now() + timeout;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("Condition did not become true");
    await new Promise((r) => setTimeout(r, 30));
  }
}
function client(account: Account, docId = documentId, endpoint = url) {
  class AuthSocket extends WebSocket {
    constructor(address: string, protocols?: string | string[]) {
      super(address, protocols, {
        headers: { Cookie: account.cookie, Origin: origin },
      });
    }
  }
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(endpoint, docId, doc, {
    WebSocketPolyfill: AuthSocket as unknown as typeof globalThis.WebSocket,
    disableBc: true,
  });
  provider.messageHandlers[4] = () => {};
  const value = { doc, provider };
  clients.push(value);
  return value;
}
function get(path: string, account = owner) {
  return request(app).get(`/api${path}`).set("Cookie", account.cookie);
}
function post(path: string, body: object, account = owner) {
  return request(app)
    .post(`/api${path}`)
    .set("Cookie", account.cookie)
    .set("Origin", origin)
    .send(body);
}
async function deniedSocket(
  headers: Record<string, string>,
  docId = documentId,
) {
  return new Promise<number>((resolve, reject) => {
    const ws = new WebSocket(`${url}/${docId}`, { headers });
    ws.on("error", () => {});
    ws.on("unexpected-response", (_req, response) => {
      response.resume();
      ws.terminate();
      resolve(response.statusCode!);
    });
    ws.on("open", () => {
      ws.close();
      reject(new Error("Unauthorized connection opened"));
    });
  });
}
beforeAll(async () => {
  owner = await account("Owner");
  editor = await account("Editor");
  viewer = await account("Viewer");
  outsider = await account("Outsider");
  const res = await post("/documents", { title: "Concurrent document" }).expect(
    201,
  );
  documentId = res.body.id;
  await start();
});
afterAll(async () => {
  clients.forEach((c) => {
    c.provider.destroy();
    c.doc.destroy();
  });
  if (hub) await stop();
  await db.user.deleteMany({ where: { id: { in: accountIds } } });
  await db.$disconnect();
});
describe.sequential(
  "real PostgreSQL, Redis, HTTP and WebSocket integration",
  () => {
    it("authenticates, rotates cookies, rejects invalid input and revokes sessions on logout", async () => {
      await request(app).get("/api/documents").expect(401);
      await request(app)
        .post("/api/auth/login")
        .set("Origin", "https://evil.example")
        .send({})
        .expect(403);
      await post("/auth/register", {
        name: "Again",
        email: owner.email,
        password: "Test-password-123!",
      }).expect(409);
      await post("/auth/login", {
        email: owner.email,
        password: "wrong-password",
      }).expect(401);
      await post("/documents", { title: "" }).expect(400);
      const login = await post("/auth/login", {
        email: owner.email,
        password: "Test-password-123!",
      }).expect(200);
      const cookie = login.headers["set-cookie"][0].split(";")[0];
      expect(login.headers["set-cookie"][0]).toContain("HttpOnly");
      expect(login.body.passwordHash).toBeUndefined();
      await request(app)
        .post("/api/auth/logout")
        .set("Origin", origin)
        .set("Cookie", cookie)
        .expect(204);
      await request(app).get("/api/auth/me").set("Cookie", cookie).expect(401);
      const user = await db.user.findUniqueOrThrow({ where: { id: owner.id } });
      expect(user.passwordHash).toMatch(/^\$2/);
      // Login with the existing cookie intentionally rotates the old session.
      const fresh = await post(
        "/auth/login",
        { email: owner.email, password: "Test-password-123!" },
        owner,
      ).expect(200);
      owner.cookie = fresh.headers["set-cookie"][0].split(";")[0];
    });
    it("enforces document and owner-only sharing permissions", async () => {
      await get(`/documents/${documentId}`, outsider).expect(404);
      await post(`/documents/${documentId}/permissions`, {
        email: editor.email,
        role: "EDITOR",
      }).expect(200);
      await post(`/documents/${documentId}/permissions`, {
        email: viewer.email,
        role: "VIEWER",
      }).expect(200);
      await post(`/documents/${documentId}/permissions`, {
        email: outsider.email,
        role: "OWNER",
      }).expect(400);
      await post(
        `/documents/${documentId}/permissions`,
        { email: outsider.email, role: "EDITOR" },
        editor,
      ).expect(403);
      await request(app)
        .patch(`/api/documents/${documentId}`)
        .set("Origin", origin)
        .set("Cookie", viewer.cookie)
        .send({ title: "Attack" })
        .expect(403);
      const shared = await get("/documents", viewer).expect(200);
      expect(shared.body[0].role).toBe("VIEWER");
    });
    it("rejects missing sessions, untrusted origins and unauthorized rooms at upgrade", async () => {
      expect(await deniedSocket({ Origin: origin })).toBe(401);
      expect(
        await deniedSocket({
          Origin: "https://evil.example",
          Cookie: owner.cookie,
        }),
      ).toBe(403);
      expect(
        await deniedSocket({ Origin: origin, Cookie: outsider.cookie }),
      ).toBe(401);
    });
    it("converges two independent clients with simultaneous edits and acknowledges durable writes", async () => {
      const a = client(owner),
        b = client(editor);
      await until(() => a.provider.synced && b.provider.synced);
      let acknowledgments = 0;
      a.provider.messageHandlers[4] = () => {
        acknowledgments++;
      };
      a.doc.getText("body").insert(0, "Owner ");
      b.doc.getText("body").insert(0, "Editor ");
      await until(
        () =>
          a.doc.getText("body").toString() ===
            b.doc.getText("body").toString() &&
          a.doc.getText("body").length === 13 &&
          acknowledgments > 0,
      );
      const loaded = await loadState(documentId);
      expect(loaded.doc.getText("body").toString()).toBe(
        a.doc.getText("body").toString(),
      );
      loaded.doc.destroy();
    });
    it("allows viewer synchronization but rejects a raw viewer write on the server", async () => {
      const v = client(viewer);
      await until(() => v.provider.synced);
      await until(() => v.doc.getText("body").length === 13);
      const closed = new Promise<number>((resolve) =>
        v.provider.on("connection-close", (event: CloseEvent | null) => {
          if (event?.code === 4403) {
            v.provider.disconnect();
            resolve(event.code);
          }
        }),
      );
      v.doc.getText("body").insert(0, "MALICIOUS");
      expect(await closed).toBe(4403);
      const loaded = await loadState(documentId);
      expect(loaded.doc.getText("body").toString()).not.toContain("MALICIOUS");
      loaded.doc.destroy();
    });
    it("compacts transactionally and restores a version without changing the live document", async () => {
      const snapshot = await snapshotDocument(documentId, owner.id);
      expect(snapshot).toBeTruthy();
      expect(await db.documentUpdate.count({ where: { documentId } })).toBe(0);
      const versions = await get(`/documents/${documentId}/versions`).expect(
        200,
      );
      expect(versions.body.length).toBeGreaterThan(0);
      const restored = await post(
        `/documents/${documentId}/versions/${snapshot!.id}/restore`,
        {},
      ).expect(201);
      expect(restored.body.id).not.toBe(documentId);
      const a = await loadState(documentId),
        b = await loadState(restored.body.id);
      expect(a.doc.getText("body").toString()).toBe(
        b.doc.getText("body").toString(),
      );
      a.doc.destroy();
      b.doc.destroy();
      await post(
        `/documents/${documentId}/versions/${snapshot!.id}/restore`,
        {},
        viewer,
      ).expect(403);
    });
    it("merges offline edits on reconnect, including concurrent deletion", async () => {
      const a = clients[0]!,
        b = clients[1]!;
      a.provider.disconnect();
      a.doc.getText("body").insert(0, "Offline ");
      b.doc.getText("body").delete(0, 1);
      b.doc.getText("body").insert(0, "!");
      a.provider.connect();
      await until(
        () =>
          a.provider.synced &&
          a.doc.getText("body").toString() === b.doc.getText("body").toString(),
      );
      expect(a.doc.getText("body").toString()).toContain("Offline");
      await until(async () => {
        const state = await loadState(documentId);
        const equal =
          state.doc.getText("body").toString() ===
          a.doc.getText("body").toString();
        state.doc.destroy();
        return equal;
      });
    });
    it("preserves all dependent updates while compaction races with concurrent writes", async () => {
      const created = await post("/documents", {
        title: "Compaction race",
      }).expect(201);
      const id = created.body.id as string;
      const source = new Y.Doc();
      const updates: Uint8Array[] = [];
      source.on("update", (update) => updates.push(update));
      for (let i = 0; i < 12; i++)
        source.getText("body").insert(i, String.fromCharCode(65 + i));
      await Promise.all([
        ...updates.map((update) => persistUpdate(id, owner.id, update)),
        snapshotDocument(id, owner.id),
        snapshotDocument(id, owner.id),
      ]);
      await snapshotDocument(id, owner.id);
      const recovered = await loadState(id);
      expect(recovered.doc.getText("body").toString()).toBe("ABCDEFGHIJKL");
      expect(await db.documentUpdate.count({ where: { documentId: id } })).toBe(
        0,
      );
      source.destroy();
      recovered.doc.destroy();
    });
    it("recovers persisted content after collaboration server shutdown and restart", async () => {
      const expected = clients[0]!.doc.getText("body").toString();
      clients.forEach((c) => c.provider.disconnect());
      await stop();
      await start();
      const recovered = client(owner);
      await until(() => recovered.provider.synced);
      expect(recovered.doc.getText("body").toString()).toBe(expected);
    });
    it("propagates edits between two separate collaboration instances", async () => {
      const otherServer = createServer(app);
      const otherHub = new CollaborationHub(otherServer);
      await new Promise<void>((r) => otherServer.listen(0, "127.0.0.1", r));
      try {
        const a = client(owner),
          b = client(
            editor,
            documentId,
            `ws://127.0.0.1:${(otherServer.address() as AddressInfo).port}/collab`,
          );
        await until(() => a.provider.synced && b.provider.synced);
        a.doc.getText("body").insert(0, "Instance A ");
        b.doc.getText("body").insert(0, "Instance B ");
        await until(
          () =>
            a.doc.getText("body").toString() ===
              b.doc.getText("body").toString() &&
            a.doc.getText("body").toString().includes("Instance A") &&
            a.doc.getText("body").toString().includes("Instance B"),
        );
        b.provider.destroy();
      } finally {
        await otherHub.close();
        await new Promise<void>((r) => otherServer.close(() => r()));
      }
    });
    it("enforces a role downgrade on an already connected editor", async () => {
      const active = client(editor);
      await until(() => active.provider.synced);
      await post(`/documents/${documentId}/permissions`, {
        email: editor.email,
        role: "VIEWER",
      }).expect(200);
      const denied = new Promise<number>((resolve) =>
        active.provider.on("connection-close", (event: CloseEvent | null) => {
          if (event?.code === 4403) {
            active.provider.disconnect();
            resolve(event.code);
          }
        }),
      );
      active.doc.getText("body").insert(0, "AFTER DOWNGRADE");
      expect(await denied).toBe(4403);
      const recovered = await loadState(documentId);
      expect(recovered.doc.getText("body").toString()).not.toContain(
        "AFTER DOWNGRADE",
      );
      recovered.doc.destroy();
    });
  },
);
