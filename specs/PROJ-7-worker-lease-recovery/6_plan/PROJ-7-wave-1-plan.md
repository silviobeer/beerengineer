# PROJ-7 Wave 1 Implementation Plan

**Goal:** Add the durable run-level worker lease foundation without changing workflow behavior yet.
**Architecture Reference:** `6_plan/PROJ-7-architecture.md`
**PRDs involved:** PROJ-7-PRD-1

---

## Wave Position

- **Previous waves:** None.
- **Next waves:** Wave 2 depends on the lease schema and repository primitives from this wave.

## Dependency Analysis

- Wave 1 creates the run-level worker lease persistence and deterministic test hooks.
- Wave 2 can then wire CLI/API production workflow start and resume callers to the shared lease lifecycle.
- Wave 3 can recover lost workers because every running run has a comparable owner and heartbeat vocabulary.
- Wave 4 can add `/ready`, same-run resume lease checks, UI recovery projection, and API documentation after recovery state is reliable.

## User Stories in this Wave

| US ID | Scope | Agent Type | Complexity | Can start when |
|---|---|---|---|---|
| PROJ-7-PRD-1-US-3 | backend | backend-implementer | opus (schema and lease foundation) | immediately |

All user stories in a wave run in parallel (unless otherwise noted).

**Complexity column:** `sonnet` is standard feature work; `opus` is for architecture-sensitive work such as state machines, concurrency, DB migrations, and cross-feature contracts.

---

## PROJ-7-PRD-1-US-3: As an operator, I want worker ownership fields to support future queue migration without introducing a queue now
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-11: Running workflow runs persist `worker_instance_id`.
- [ ] AC-12: Running workflow runs persist `worker_owner_kind`.
- [ ] AC-13: Running workflow runs persist `worker_started_at`.
- [ ] AC-14: Running workflow runs persist `worker_heartbeat_at`.
- [ ] AC-15: PROJ-7 does not require a workflow job table, worker queue table, or automatic job reclaimer.

### Task 1.1: Run Lease Schema And Types
**Fulfills:** AC-11, AC-12, AC-13, AC-14, AC-15

**Files:**
- Modify: `apps/engine/src/db/connection.ts`
- Modify: `apps/engine/src/db/schema.sql`
- Modify: `apps/engine/src/db/repositories/types.ts`
- Modify: `apps/engine/src/db/repositories/repos.ts`
- Test: `apps/engine/test/workerLease.test.ts`

**What to build:** Add idempotent run-level lease persistence and repository visibility for worker instance, owner kind, started timestamp, and heartbeat timestamp. Keep the model attached to `runs`; do not introduce a workflow queue or job table.

**TDD cycle:**
- RED: test that fresh and migrated databases expose all worker lease fields on run rows and that no queue/job table is required.
- GREEN: implement idempotent schema migration, fresh schema support, and typed repository row coverage.
- REFACTOR: standard cleanup around run row construction and test fixtures.
- COMMIT: `feat(PROJ-7-PRD-1): implement run lease schema`

### Task 1.2: Lease Repository Primitives
**Fulfills:** AC-11, AC-12, AC-13, AC-14

**Files:**
- Create: `apps/engine/src/core/workerLease.ts`
- Modify: `apps/engine/src/db/repositories/repos.ts`
- Test: `apps/engine/test/workerLease.test.ts`

**What to build:** Define the durable worker lease operations needed by later waves: claim ownership, refresh heartbeat, detect lost ownership, and inspect current ownership using deterministic timestamps in tests.

**TDD cycle:**
- RED: test claim and heartbeat updates for both `cli` and `api` owner kinds with a controlled clock.
- GREEN: implement the minimal lease operations on top of the run repository.
- REFACTOR: keep the lease domain free of workflow-specific branching.
- COMMIT: `feat(PROJ-7-PRD-1): implement worker lease primitives`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -
