import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { hashToken } from "../src/services/auth.js";
describe("CRDT invariants", () => {
  it("merges concurrent insertions and deletions regardless of update order", () => {
    const original = new Y.Doc();
    original.getText("body").insert(0, "Hello world");
    const a = new Y.Doc();
    const b = new Y.Doc();
    Y.applyUpdate(a, Y.encodeStateAsUpdate(original));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(original));
    a.getText("body").delete(6, 5);
    a.getText("body").insert(6, "team");
    b.getText("body").insert(0, "Welcome! ");
    const ua = Y.encodeStateAsUpdate(a),
      ub = Y.encodeStateAsUpdate(b);
    Y.applyUpdate(a, ub);
    Y.applyUpdate(b, ua);
    Y.applyUpdate(b, ua);
    expect(a.getText("body").toString()).toBe("Welcome! Hello team");
    expect(b.getText("body").toString()).toBe(a.getText("body").toString());
    [original, a, b].forEach((d) => d.destroy());
  });
  it("retains an out-of-order dependent update until its dependency arrives", () => {
    const a = new Y.Doc();
    const updates: Uint8Array[] = [];
    a.on("update", (u) => updates.push(u));
    a.getText("body").insert(0, "A");
    a.getText("body").insert(1, "B");
    const b = new Y.Doc();
    Y.applyUpdate(b, updates[1]!);
    expect(b.getText("body").toString()).toBe("");
    const snapshot = Y.encodeStateAsUpdate(b);
    const restarted = new Y.Doc();
    Y.applyUpdate(restarted, snapshot);
    Y.applyUpdate(restarted, updates[0]!);
    expect(restarted.getText("body").toString()).toBe("AB");
    [a, b, restarted].forEach((d) => d.destroy());
  });
});
it("stores opaque session token digests rather than bearer tokens", () => {
  const token = "an-opaque-random-bearer";
  expect(hashToken(token)).toMatch(/^[a-f0-9]{64}$/);
  expect(hashToken(token)).not.toContain(token);
});
