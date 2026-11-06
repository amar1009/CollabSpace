# Implementation plan and decisions

The initial repository contained only `.git` and no application code.

1. Establish npm workspaces, strict TypeScript, PostgreSQL schema and migration, validated environment, and Docker services.
2. Implement registration, bcrypt verification, hashed database sessions, cookie auth, document access checks, owner-only sharing, and centralized errors.
3. Implement the y-websocket binary protocol with per-message authorization, PostgreSQL-before-broadcast durability, Redis notification/presence fan-out, and periodic durable catch-up.
4. Add repeatable-read recovery, transaction-locked snapshots and update compaction, historical previews, and restoration into a separate document.
5. Build the responsive React dashboard and Tiptap editor, formatting, sharing, live cursors, connection status, IndexedDB recovery, and durable saved acknowledgment.
6. Install dependencies; start PostgreSQL/Redis; generate Prisma and apply the checked-in migration; compile and run the app.
7. Exercise unit, actual service/WebSocket integration, and independent-browser workflows; fix observed failures; format sources and document actual verification.

## Decisions worth defending in an interview

- **CRDT over application-level text replacement:** independent updates and delete sets merge, including offline edits. Yjs supplies conflict resolution; the application supplies identity, durability, and admission control.
- **Commit before broadcast:** no client is told that content was saved before PostgreSQL commits. A retry after a lost acknowledgment is safe because updates are idempotent.
- **PostgreSQL advisory locks plus watermarks:** multi-instance compaction cannot prune updates absent from its snapshot. A repeatable-read loader avoids mixing pre-compaction and post-compaction reads.
- **Redis notification with durable repair:** latency is improved by pub/sub, but content survives a Redis outage. Polling is intentionally simple and has documented scaling costs.
- **Restoration as a fork:** an old snapshot does not silently erase live or disconnected work; users deliberately choose a separate document to continue from.
- **Disable BroadcastChannel:** a browser-local synchronization shortcut must not bypass viewer write enforcement.
- **One deployable backend:** share database-backed sessions and services without introducing unnecessary distributed service ownership. Multiple instances can still communicate through PostgreSQL and Redis.
- **No fake document content:** accounts and documents are created through working routes, and empty-state visuals do not masquerade as stored user data.
