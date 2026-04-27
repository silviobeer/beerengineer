# CLAUDE.md — apps/engine

Durable rules for AI agents editing the engine. Read
[`docs/AGENTS.md`](./docs/AGENTS.md) for navigation.

<!-- ENGINE-BOUNDARY -->
- **No reverse coupling.** The engine never imports from `apps/ui`. The
  UI is one consumer of the HTTP/SSE API; CLI is the other; both are
  symmetric.

<!-- ENGINE-API-CONTRACT -->
- **`src/api/openapi.json` is authoritative** for all request/response
  shapes. When prose and the OpenAPI file disagree, the JSON wins.
  Keep [`docs/api-contract.md`](../../docs/api-contract.md) in sync.

<!-- ENGINE-EVENT-VOCAB -->
- **Canonical event names only.** Use the names listed in
  [`docs/messaging-levels.md`](../../docs/messaging-levels.md) and
  `src/core/messagingProjection.ts`. No shadow naming, no per-consumer
  aliases.

<!-- ENGINE-AUTHORITATIVE -->
- **Authoritative-run rule.** Only the sole live run for an item writes
  item state. New code that touches `items.*` columns must go through
  `runOrchestrator.isAuthoritative` / `wasSoleLiveRun`.

<!-- ENGINE-GIT -->
- **Real git only.** No simulated mode. Every run gets a worktree off
  `master` and a PR to merge back. `src/sim/` is legacy; don't extend it.

<!-- ENGINE-DB -->
- **Idempotent migrations.** Add new columns via `ALTER TABLE … IF NOT
  EXISTS` guards in `src/db/connection.ts`. No separate migration files.
  Recovery on restart depends on this property.

<!-- ENGINE-LLM -->
- **(harness, runtime) is one decision, not two layers.** Don't add a
  new harness without naming both axes. SDK runtimes must refuse to
  start without their API key — no silent CLI fallback.

<!-- ENGINE-CSRF -->
- **API is CSRF-protected by token.** Mutating endpoints require
  `x-beerengineer-token`. Don't add an unauthenticated mutation, even
  for "internal" callers — the CLI uses the token too.

<!-- ENGINE-COMMITS -->
- **Conventional Commits enforced** by a pre-commit hook (`<type>(<scope>):
  <subject>`, ≤72 chars). Valid types: `feat`, `fix`, `docs`, `style`,
  `refactor`, `perf`, `test`, `build`, `ci`, `chore`.
