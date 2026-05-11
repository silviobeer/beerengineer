# ADR: Worker Lease Semantics

- Status: Accepted
- Topic: `worker-lease-semantics`
- Last reviewed: 2026-05-10

## Context

Workflow runs may be started from the CLI or from the engine API. Without
durable ownership metadata, a run can look active long after the owning worker
has died, and restart or resume logic cannot distinguish liveness from
recoverable loss of ownership.

## Decision

Runs carry worker lease ownership metadata instead of introducing a durable job
queue. Start and resume paths claim ownership before accepting work, heartbeats
prove continued ownership, lost ownership triggers recoverable run/item state,
and `/health` remains separate from `/ready`.

## Consequences

- CLI and API workers share one lease vocabulary and one recovery model.
- The engine gains recoverable ownership semantics without promising queue-based restart.
- Readiness checks must exercise the lease write path, not only process liveness.

## Evidence

- `docs/PROJECT.md` PROJ-7 section
- `docs/TECHNICAL.md` PROJ-7 section and worker lease bullets
- `specs/PROJ-7-worker-lease-recovery/7_progress/PROJ-7-progress.md`
