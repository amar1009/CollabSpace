# Verification — 5 November 2026

Executed locally on Windows with Node 20.19.6, npm 10.8.2, Docker Desktop's Linux engine, PostgreSQL 17, Redis 7, and installed Google Chrome.

| Check                                                              | Result                                                                                             |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `npm ci` from the regenerated dependency lock                      | Passed                                                                                             |
| `npm run db:generate` with Prisma 6.19.3 and patched merge utility | Passed                                                                                             |
| `npm run db:migrate`                                               | Initial migration applied; subsequent run reports no pending migrations                            |
| `npm run build`                                                    | Server and client TypeScript compilation and Vite build passed                                     |
| `npm test`                                                         | 3 tests passed with Vitest 4.1.12                                                                  |
| `npm run test:integration`                                         | 11 tests passed against real PostgreSQL, Redis, HTTP and WebSocket services                        |
| `npm audit --audit-level=moderate`                                 | Zero reported vulnerabilities                                                                      |
| `npm run format:check`                                             | Passed                                                                                             |
| `docker compose up -d --build`                                     | Both images built; frontend, backend, PostgreSQL and Redis running; backend/database/Redis healthy |
| `npm run test:browser` against Docker                              | Passed: one complete workflow with three isolated Chrome contexts, approximately 1.1 minutes       |

## Integration coverage

1. Register, hash passwords, validate inputs, reject invalid credentials, rotate session cookies, logout and revoke a session.
2. Enforce document access and owner-only sharing; return shared roles correctly; reject viewer metadata changes.
3. Reject unauthenticated, cross-origin, and unauthorized WebSocket upgrades.
4. Merge simultaneous edits from two independent y-websocket clients; verify committed state in PostgreSQL and a durable acknowledgment.
5. Synchronize a viewer, then reject a malicious binary viewer write without changing durable content.
6. Compact update rows into a snapshot and restore into a distinct document while preserving the original.
7. Reconnect an offline editor and merge concurrent insertions and deletions.
8. Race dependent update writes against two concurrent compactions and verify all content survives.
9. Close and recreate the collaboration hub and HTTP server, then recover the persisted content in a fresh client.
10. Connect clients to two separate backend instances and verify convergence through the Redis/PostgreSQL path.
11. Downgrade an already connected editor to viewer and reject their next write.

## Live browser inspection

The local UI was opened in the in-app browser. Registration, document creation, text editing in two editor tabs, remote content synchronization, online presence, durable saved status, and the version-history panel were observed directly.

The repeatable browser test passed against the final Docker application through Nginx. It verified registration, sharing, concurrent rich-text convergence, two-user presence, offline edits and reconnection, reload persistence, read-only viewer behavior, saving and previewing a specific snapshot, restoration into a new document without changing the original, and a 390-pixel mobile dashboard with no horizontal overflow. Its snapshot assertion selects the ID returned by the manual save request rather than racing a refreshing list.

Screenshots are available in `.local/screenshots/dashboard.png`, `.local/screenshots/editor.png`, and `.local/screenshots/mobile.png`. The application containers remain running at **http://localhost:5173**. Register your own account to use the app; browser-test accounts were removed after verification.

## Limits of verification

- Vite reports a size advisory for the lazy-loaded editor chunk (about 571 kB before gzip, 182 kB gzip). Build succeeds; no bundle-size guarantee is claimed.
- Restart recovery tests recreate the server/hub in-process. They do not simulate PostgreSQL power loss, filesystem corruption, or primary failover.
- No sustained-load benchmark, production TLS deployment, security audit, or browser-storage exhaustion test was performed.
- Tests use disposable generated accounts and remove their data afterward. The interactive preview account/document are actual local database records, not mocked application data.
