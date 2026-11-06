# CollabSpace

A working collaborative document editor built with React, Tiptap, Yjs, Express, PostgreSQL, Prisma, and Redis. The interface includes an account flow, document dashboard, rich text editor, sharing, live cursors, offline editing, and version history. This is an interview-sized modular monolith with explicit durability and authorization boundaries.

## Quick start

Requires Node.js **20.19+** (Node 22 recommended), npm, and Docker Desktop with its Linux engine running.

```powershell
Copy-Item .env.example .env
npm ci
docker compose up -d postgres redis
npm run db:generate
npm run db:migrate
npm run dev
```

Open **http://localhost:5173**. Use `localhost` consistently: cookie scope and origin validation are intentional. Register an account; no seed data or demo mode is required. Register a second account in an incognito window, then invite that email from the owner's Share dialog. The document appears under **Shared with me** for that user.

The database maps to **127.0.0.1:55432**, Redis to **127.0.0.1:6379**, and the API to **3001**. The nonstandard database port avoids conflicts with installed PostgreSQL instances and Windows reserved port ranges. Change the Compose mapping and `.env` together if needed.

### Run everything in Docker

```powershell
docker compose up --build -d
```

Open the same localhost URL. The backend applies the checked-in migration on startup. Nginx serves the compiled frontend and proxies REST and WebSocket traffic. Stop a running `npm run dev` before using these same ports. `docker compose down` keeps the PostgreSQL volume; do not remove the volume unless you intend to erase the database.

### Build and check

```powershell
npm run build
npm test
npm run test:integration
# With npm run dev already running, and Google Chrome installed:
npm run test:browser
npm run format:check
```

The browser configuration uses the installed `chrome` channel. If Chrome is unavailable, install a Playwright Chromium browser (`npx playwright install chromium`) and change `channel` in `playwright.config.ts` accordingly. Integration and browser tests need PostgreSQL and Redis. They create uniquely named test users and remove only those users and their cascading data. Use a separate test database for CI; apply migrations to it first. Do not point tests at a production database.

## Features and roles

| Capability                                           | Owner | Editor | Viewer |
| ---------------------------------------------------- | ----- | ------ | ------ |
| Read content, presence, version previews             | Yes   | Yes    | Yes    |
| Edit rich text, rename                               | Yes   | Yes    | No     |
| Create a snapshot, restore into a new document       | Yes   | Yes    | No     |
| Invite, change roles, remove access, delete original | Yes   | No     | No     |

Rich text supports headings, paragraphs, bold, italic, underline, ordered and unordered lists, blockquotes, links, and per-user collaborative undo/redo. Shared cursors and selections use Yjs awareness. Titles are metadata saved on blur; concurrent title changes use last-write-wins, whereas rich text merges through the CRDT.

History lists up to 100 recent periodic/manual snapshots and lets authorized users preview them. **Restore creates a new privately owned document** containing that version. It does not overwrite the live room, discard offline work, copy the original permissions, or reconnect collaborators to a different history. The UI explains this before restoring.

## Architecture

```mermaid
flowchart LR
  A[React + Tiptap client] <-->|Yjs binary sync and awareness| W[Authenticated WebSocket hub]
  A <-->|Same-origin REST + HTTP-only cookie| E[Express routes]
  A <-->|Offline Yjs updates| I[(IndexedDB per account/document)]
  E --> S[Auth / document / persistence services]
  W --> S
  S <-->|Prisma transactions| P[(PostgreSQL)]
  W <-->|Notifications + ephemeral presence| R[(Redis pub/sub)]
  R <--> W2[Another API / hub instance]
  W2 <--> P
```

REST owns identities, metadata, sharing, and history. The hub owns connections and serialized room operations. Yjs owns document conflict resolution. PostgreSQL is the permanent source of truth. Redis carries notifications and awareness, not durable content. API and collaboration share one process and port for a straightforward deployment; the hub is a separate module that could later be moved behind a dedicated endpoint.

The client uses the standard **y-websocket** provider with `disableBc: true`: browser BroadcastChannel synchronization is deliberately disabled, so a viewer cannot bypass the server's authorization through a same-origin tab. Tiptap's Collaboration extension binds the `default` Y.XmlFragment to ProseMirror. Its ordinary history extension is disabled in favor of Yjs undo.

### WebSocket flow

1. `GET /collab/:documentId` upgrades only after checking the exact configured Origin, a live cookie session, and database-backed document access.
2. Load the room **before upgrade** and attach listeners synchronously so the provider's initial messages cannot be lost during asynchronous database reads.
3. Exchange standard Yjs sync step 1 (state vector), sync step 2 (missing structs/deletions), update, and awareness messages. No HTML/text replacement broadcasts are used.
4. Validate each content update's binary structure. Revalidate the session and role on every message. Viewers may request state but their sync step 2 is ignored and update frames are rejected.
5. Under a PostgreSQL advisory transaction lock, recheck write permission, append the binary update, and update document activity. Only **after commit** apply it to the room and broadcast the incremental Yjs update.
6. Send a small protocol extension: message type **4**, sync subtype, and the exact committed update bytes. The client tracks pending updates and sync batches; this acknowledgment drives its saved indicator. Stock providers can use a no-op handler for type 4, as in the integration suite.
7. Publish a Redis notification. Other instances reload persisted state and let Yjs generate the missing incremental update for their connected clients. A two-second PostgreSQL catch-up also repairs notifications lost during a Redis outage.
8. Awareness contains cursor/selection state and the server-provided display name and deterministic color. Provider awareness relays are ignored; a socket can update only its own claimed awareness identity. Redis forwards ephemeral awareness between instances. Heartbeats and awareness expiry remove stale clients.

No uncommitted update is broadcast. If PostgreSQL is unavailable, writes are not acknowledged, the connection closes with a transient code, and the provider retries with locally retained updates. Redis failure increases cross-instance latency but does not change durability.

## Persistence and concurrency

Each content change is a compact Yjs **incremental binary update** in PostgreSQL `BYTEA`, rather than a full snapshot or JSON string. Sync handshakes can append redundant updates; Yjs application is idempotent. A room serializes incoming work, but correctness does not depend on one process owning the room.

Every append, snapshot, document deletion, and permission mutation takes the same document-scoped `pg_advisory_xact_lock(hashtextextended(documentId, 0))`. This coordinates multiple instances and prevents a snapshot from deleting an update that it failed to incorporate. Role checks inside the write transaction serialize with permission changes.

Every minute while a room is active (configurable), or on a manual snapshot/shutdown:

1. Acquire the document transaction lock.
2. Reconstruct a fresh Y.Doc from the latest snapshot and subsequent update rows.
3. Store a full binary snapshot with a monotonically increasing update-ID **watermark**.
4. Delete incremental rows at or below that watermark in the **same transaction**. Preserve historical snapshots for version previews.

If no new watermark exists, reuse the latest snapshot. Snapshot failures roll back both insert and deletion. Loading state uses a **repeatable-read transaction** so it cannot observe an old snapshot followed by an update log already pruned by a concurrent compaction. Yjs snapshots retain unresolved dependencies, and offline edits with older state vectors remain mergeable.

The trade-off is simplicity over maximum throughput: commits are per incoming update, advisory locks serialize writes to each document, and cross-instance refresh currently reconstructs a full persisted state. Large documents or thousands of rooms need incremental catch-up, bounded document quotas, batching of _incremental_ updates before acknowledgments, snapshot retention policies, and connection admission limits. Redis alone cannot recover durable data.

### Offline behavior and saved status

`y-indexeddb` keeps document state under `collabspace:<userId>:<documentId>`. The provider starts after the local store loads. Temporary WebSocket/network outages do not disable an existing editor. Reconnection exchanges missing structs and delete sets, then acknowledges the durable upload. Unacknowledged edits display as pending/local rather than saved.

This is **offline editing of an already open document**, not a full offline application. There is no service worker, cached dashboard, or offline authentication. Opening the app or fetching metadata needs the server. Local caches are account scoped but remain on that device after logout; they are not encrypted. Browser storage clearing/quota loss can remove unacknowledged local edits. The UI's online count counts active connections, including multiple tabs for one person.

## Database schema

| Model              | Purpose and constraints                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| User               | UUID identity, unique normalized email, display name, bcrypt hash, creation time                                 |
| Session            | SHA-256 digest of a random 256-bit bearer token, user foreign key, expiry; indexed by user and expiry            |
| Document           | Owner foreign key, bounded API title, timestamps; indexed by owner/activity                                      |
| DocumentPermission | Unique `(documentId, userId)`, role enum, user lookup index; ownership comes exclusively from `Document.ownerId` |
| DocumentUpdate     | Globally increasing BigInt ID, binary incremental update, timestamp; `(documentId, id)` index                    |
| DocumentSnapshot   | UUID, full binary Yjs state, update watermark, timestamp; `(documentId, createdAt)` index                        |

All dependent data cascades on document/user deletion. BigInt watermarks are serialized as strings in API responses. Sharing accepts only `EDITOR`/`VIEWER`; ownership transfer is intentionally unsupported.

## API

JSON under `/api`. Errors have `{ "error": "message" }`. UUIDs, emails, role values, title lengths, and credentials are validated. Mutating requests must send `Origin: <APP_ORIGIN>`; use the browser or include that header in curl/tests. No bearer token is exposed to application JavaScript.

| Method               | Path                                         | Behavior                                                          |
| -------------------- | -------------------------------------------- | ----------------------------------------------------------------- |
| GET                  | `/health`                                    | PostgreSQL readiness check                                        |
| POST                 | `/auth/register`                             | `{ name, email, password }`, create session                       |
| POST                 | `/auth/login`                                | `{ email, password }`, rotate current session                     |
| POST                 | `/auth/logout`                               | Revoke session, clear cookie                                      |
| GET                  | `/auth/me`                                   | Current public user                                               |
| GET                  | `/documents`                                 | Owned and explicitly shared documents, effective roles            |
| POST                 | `/documents`                                 | `{ title }`, create empty document                                |
| GET / PATCH / DELETE | `/documents/:id`                             | Read metadata / rename / owner-only permanent deletion            |
| GET                  | `/documents/:id/permissions`                 | Owner-only access list                                            |
| POST                 | `/documents/:id/permissions`                 | Owner-only `{ email, role }`, invite existing user or change role |
| DELETE               | `/documents/:id/permissions/:userId`         | Owner-only revoke                                                 |
| GET                  | `/documents/:id/versions`                    | Most recent 100 snapshot metadata records                         |
| POST                 | `/documents/:id/versions`                    | Owner/editor manual snapshot                                      |
| GET                  | `/documents/:id/versions/:versionId`         | Authorized binary version for preview                             |
| POST                 | `/documents/:id/versions/:versionId/restore` | Owner/editor fork a version into a new private document           |

Passwords require at least 10 characters and at most 72 UTF-8 bytes (the UI also constrains character length to 72), with bcrypt cost 12. Duplicate registration returns 409; invalid credentials return a generic 401. Missing or inaccessible documents return 404, and forbidden operations by existing members return 403.

## Configuration

Copy `.env.example` to the repository root. The frontend contains no database/session secrets and uses relative same-origin URLs.

| Variable               | Default/example                                                                  | Purpose                                                                        |
| ---------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `DATABASE_URL`         | `postgresql://collabspace:collabspace@localhost:55432/collabspace?schema=public` | Required PostgreSQL connection                                                 |
| `REDIS_URL`            | `redis://localhost:6379`                                                         | Required Redis endpoint; content remains usable during temporary Redis outages |
| `APP_ORIGIN`           | `http://localhost:5173`                                                          | Exact allowed browser origin, including scheme and port                        |
| `PORT`                 | `3001`                                                                           | API + WebSocket listener                                                       |
| `NODE_ENV`             | `development`                                                                    | `production` enables Secure `__Host-collabspace` cookie                        |
| `SESSION_DAYS`         | `7`                                                                              | Session lifetime, 1–30 days                                                    |
| `SNAPSHOT_INTERVAL_MS` | `60000`                                                                          | Periodic compaction interval, minimum 1000                                     |
| `LOG_LEVEL`            | `info`                                                                           | Pino log verbosity                                                             |

Server configuration fails fast if required values are missing or invalid. Sessions use random opaque tokens whose hashes live in PostgreSQL, so there is no signing secret to share across instances. For a real deployment supply private PostgreSQL/Redis credentials, use HTTPS/WSS through a TLS reverse proxy, configure the exact public origin, and set production mode. Compose credentials are for local development. Trust proxy is not enabled; configure only explicitly trusted proxy hops before relying on real-client-IP limits in a different deployment topology.

## Reliability and security boundaries

- HTTP-only, SameSite=Lax cookies; production-only Secure cookie and `__Host-` prefix. Logout invalidates the database session. Existing sockets check session validity before messages and at two-second intervals.
- Exact Origin checks on mutations and WebSocket upgrades provide same-origin CSRF protection. API responses are not cached. Helmet sets security headers; Tiptap escapes content and links restrict unsafe schemes.
- Backend authorization checks all document operations and socket frames. ACL changes take effect on the next inbound message; access removal closes idle sockets on the next periodic check (up to roughly two seconds). The UI asks users to reopen if editing permission changed.
- Authentication rate limit: 30 attempts per 15 minutes per IP. API limit: 300/minute. WebSocket limit: 500 messages per 10 seconds per socket, 1 MiB frames, 4 MiB outgoing buffer, and ping/pong liveness checks.
- Structured logs exclude request bodies, cookies, bearer tokens, passwords, and secrets. Graceful SIGINT/SIGTERM stops upgrades, closes sockets, drains queues, snapshots, and closes database/Redis connections with a deadline.

## Tests and demonstrated behavior

- **Unit:** concurrent insertion/deletion convergence, out-of-order dependency recovery across a binary snapshot, and hashed opaque session tokens.
- **Integration:** real PostgreSQL/Redis with Express and actual y-websocket clients: registration/login/logout, validation, sharing and roles, upgrade rejection, simultaneous client edits and durable acknowledgment, malicious viewer write rejection, transactional compaction, safe restoration, offline edits/deletions and reconnect, hub shutdown/restart recovery, and convergence across two separate server instances.
- **Browser:** isolated Chrome contexts for owner/editor/viewer; register, dashboard, create, invite, concurrent Tiptap edits, presence, offline edit/reconnect/reload, server-backed read-only viewer, version preview, restore fork, and responsive layout. Screenshots go to ignored `.local/screenshots/`; failure traces go to `test-results/`.

See [verification notes](docs/VERIFICATION.md) for the checks actually executed in this workspace. Tests are intentionally about observable contracts and recovery, rather than mirroring controllers.

## Project structure

```text
client/
  src/
    components/    Brand, modal, sharing, version history
    context/       Session-aware React auth context
    editor/        Formatting toolbar
    hooks/         Yjs / IndexedDB / provider lifecycle and durable acknowledgments
    pages/         Login/register, dashboard/shared list, document editor
    services/      Typed HTTP client
    types/         Frontend domain types
    main.tsx       Routing and lazy editor loading
    styles.css     Responsive interface
  Dockerfile, nginx.conf, vite.config.ts
server/
  prisma/          Schema and initial SQL migration
  src/
    config/        Validated environment
    middleware/    Authentication
    models/        Prisma access
    routes/        HTTP input/response adapters
    services/      Auth, authorization, sharing, persistence, snapshots
    utils/         Errors and structured logging
    websocket/     Authenticated, durable Yjs hub and Redis notifications
    app.ts         Express composition
    server.ts      Process startup/shutdown
  test/            Unit and service integration tests
  Dockerfile, vitest.config.ts
server/e2e/        Independent-browser integration test
docs/              Implementation and verification notes
docker-compose.yml
```

## Known limitations and next steps

This is a functional engineering demonstration, **not an audited production service**. No email verification, password reset, MFA, ownership transfer, public links, organization billing, full-text search, attachments, or comments. Invitations target already registered emails; no email is sent. Document list search is local title filtering.

There is no in-place historical rollback: restoration forks by design. Snapshot retention and expired-session cleanup need an operational retention job. Binary frames are size limited, but total document size, account storage, connections per user, and server-side queue memory need deployment quotas. Valid but deliberately pathological Yjs updates are not sandboxed; editor schemas are not a content firewall.

Redis pub/sub is transient; PostgreSQL polling repairs content, while presence can disappear until its next heartbeat after an outage. Rate limits are process-local, so a load-balanced deployment needs shared counters at the edge or Redis. Presence client IDs are advisory identities, not cryptographic identities. Full-room reload polling and unbounded retained historical snapshots are scaling limits, not claims of unlimited scalability.

The lockfile uses Prisma 6.19.3 and Vitest 4.1.12. A root override selects `deepmerge-ts` 8.0.2 for Prisma's configuration tooling to address the recursive-merge advisory while retaining the compatible Prisma 6 API. Client generation and migrations are verified with this override. Recheck the override when upgrading Prisma.

Tests cover hub recreation in-process; abrupt machine power loss, failover of PostgreSQL itself, Redis restart chaos, browser storage exhaustion, and sustained load have not been certified. PostgreSQL durability depends on its storage and backup configuration. A production operator must add monitoring, backups/restore drills, TLS, retention, distributed rate limits, and resource budgets.

### Primary references

- [Yjs WebSocket provider](https://docs.yjs.dev/ecosystem/connection-provider/y-websocket) and [provider source](https://github.com/yjs/y-websocket)
- [Tiptap collaboration installation](https://tiptap.dev/docs/collaboration/getting-started/install)
- [PostgreSQL advisory locks](https://www.postgresql.org/docs/17/explicit-locking.html#ADVISORY-LOCKS)
