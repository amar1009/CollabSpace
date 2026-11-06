import { useEffect, useState } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { IndexeddbPersistence } from "y-indexeddb";
import * as decoding from "lib0/decoding";
import type { User } from "../types";
export const userColor = (id: string) =>
  ["#5378cf", "#a55a96", "#2d947b", "#be7736", "#8264c5", "#be5f65"][
    Array.from(id).reduce((n, c) => n + c.charCodeAt(0), 0) % 6
  ]!;
type Person = { clientId: number; name: string; color: string };
const key = (data: Uint8Array) => Array.from(data).join(",");
export function useCollaboration(id: string, user: User, viewer: boolean) {
  const [session, setSession] = useState<{
    doc: Y.Doc;
    provider: WebsocketProvider;
  } | null>(null);
  const [status, setStatus] = useState("connecting");
  const [pending, setPending] = useState(0);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const doc = new Y.Doc();
    const provider = new WebsocketProvider(
      `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/collab`,
      id,
      doc,
      { connect: false, disableBc: true, maxBackoffTime: 5000 },
    );
    // Scope local caches to the account. Never load another user's offline state.
    const local = new IndexeddbPersistence(`collabspace:${user.id}:${id}`, doc);
    const awaiting = new Set<string>();
    const syncBatches: string[][] = [];
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin !== provider && !viewer) {
        awaiting.add(key(update));
        setPending(awaiting.size);
      }
    };
    doc.on("update", onUpdate);
    const syncHandler = provider.messageHandlers[0]!;
    provider.messageHandlers[0] = (
      encoder,
      decoder,
      p,
      synced,
      messageType,
    ) => {
      const pos = decoder.pos;
      const subtype = decoding.readVarUint(decoder);
      decoder.pos = pos;
      if (subtype === 0 && !viewer) syncBatches.push([...awaiting]);
      syncHandler(encoder, decoder, p, synced, messageType);
    };
    provider.messageHandlers[4] = (_encoder, decoder) => {
      const subtype = decoding.readVarUint(decoder);
      const update = decoding.readVarUint8Array(decoder);
      if (subtype === 1)
        for (const value of syncBatches.shift() ?? []) awaiting.delete(value);
      else awaiting.delete(key(update));
      setPending(awaiting.size);
      setSavedAt(new Date());
    };
    provider.on("status", ({ status }: { status: string }) => {
      setStatus(status);
      if (status === "disconnected") syncBatches.length = 0;
    });
    provider.on("connection-close", (event: CloseEvent | null) => {
      if (event && event.code >= 4400 && event.code < 4500) {
        setBlocked(true);
        provider.disconnect();
      }
    });
    provider.awareness.setLocalStateField("user", {
      name: user.name,
      color: userColor(user.id),
    });
    const presence = () =>
      setPeople(
        [...provider.awareness.getStates()].map(([clientId, state]) => ({
          clientId,
          name: String(state.user?.name ?? "Collaborator"),
          color: String(state.user?.color ?? "#5378cf"),
        })),
      );
    provider.awareness.on("change", presence);
    presence();
    let disposed = false;
    void local.whenSynced.then(() => {
      if (!disposed) {
        setSession({ doc, provider });
        provider.connect();
      }
    });
    return () => {
      disposed = true;
      provider.destroy();
      void local.destroy();
      doc.destroy();
      setSession(null);
    };
  }, [id, user.id, user.name, viewer]);
  return { session, status, pending, savedAt, people, blocked };
}
