# Stage 09 — Offline / Sync rules

Mobile must function fully without network. SQLite mirror + mutation queue
+ conflict resolution. Web does **not** get full offline mode.

## Required reading

- `PROJECT.md` § 15 (Offline Mode)
- `context/data-model.md`
- `context/conventions.md`

## Hard rules

- **Reads never block on network.** Local SQLite is the source of
  truth at read time. A background refresher updates from the server.
- **Writes optimistic and queued.** UI updates immediately, the
  mutation goes to a durable queue, replayed on reconnect.
- **Last-write-wins per `updated_at`.** No CRDTs in v1. Conflicts are
  logged in a local `sync_conflict` table for debug; user-visible only
  on demand.
- **Quantity edits are special.** Two clients each adding +1 to a
  collection_item should converge to +2, not +1. Quantity changes
  serialize as deltas, not absolute values, in the queue.
- **Card catalog mirror.** Mobile carries a compressed snapshot of the
  catalog (sets/cards/printings + small image URLs); refreshed on app
  update or via a manual "refresh data" action. ANN index loaded via
  the scanner stage.
- **Sync engine has tests.** Mock network, simulate offline → online
  transitions, prove the queue replays correctly and idempotently.

## Conventions specific to this stage

- Local DB: `expo-sqlite` (or `op-sqlite` if perf demands; raise as Q
  if so). Schema mirrors server tables for user data; uses a local-only
  `sync_state` table for queue and metadata.
- Repositories in `apps/mobile/src/repositories/` provide a typed
  facade. Screens never query SQLite directly.
- Queue worker runs on app-foreground transition and on network
  reconnect (via NetInfo).
- Idempotency keys generated client-side (`uuid v4`) on every mutation;
  server uses them to deduplicate replays.

## Common pitfalls

- Storage migrations on app update: schema versioning required from day
  one.
- A long-offline user with thousands of mutations needs throttled
  replay to avoid hammering the server. Backoff + batching.
- Auth token refresh while offline: store refresh token securely; on
  reconnect, refresh before flushing the queue.

## Done when

- Mobile launches and navigates fully offline after first online run.
- Adding/removing cards offline replays correctly when back online.
- Conflict log populated in tests; UI surface for it deferred.
- Data mirror refresh works.
