# PROJ-7 Wave 3 Implementation Plan

**Goal:** Recover lost workers, project item state correctly, and fail visible when starts cannot establish ownership.
**Architecture Reference:** `6_plan/PROJ-7-architecture.md`
**PRDs involved:** PROJ-7-PRD-2

---

## Wave Position

- **Previous waves:** Wave 2 - production CLI/API worker leases complete.
- **Next waves:** Wave 4 depends on reliable recovery state for `/ready`, graceful shutdown, resume, and UI messaging.

## User Stories in this Wave

| US ID | Scope | Agent Type | Complexity | Can start when |
|---|---|---|---|---|
| PROJ-7-PRD-2-US-1 | backend | backend-implementer | opus (startup recovery) | after Wave 2 |
| PROJ-7-PRD-2-US-2 | backend | backend-implementer | sonnet | after Wave 2, parallel to US-1 with recovery module coordination |
| PROJ-7-PRD-2-US-3 | backend | backend-implementer | opus (authoritative item projection) | after Wave 2 |
| PROJ-7-PRD-2-US-4 | backend | backend-implementer | opus (concurrency/authority) | after Wave 2, coordinate with US-3 |
| PROJ-7-PRD-2-US-6 | backend | backend-implementer | opus (start failure invariant) | after Wave 2 |

US-1 through US-4 share lost-worker recovery code; coordinate ownership of `orphanRecovery.ts`, `workerLease.ts`, and item projection helpers before editing. PRD-2-US-5 is intentionally deferred to Wave 4 because its `/ready` behavior depends on the readiness endpoint.

**Complexity column:** `sonnet` is standard feature work; `opus` is for architecture-sensitive work such as state machines, concurrency, DB migrations, and cross-feature contracts.

---

## PROJ-7-PRD-2-US-1: As a browser operator, I want startup to recover API runs from previous engine instances so fresh but ownerless runs do not remain active forever
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-1: API engine startup creates a fresh process-scoped engine instance id.
- [ ] AC-2: Startup recovery detects running API-owned runs whose `worker_instance_id` differs from the current engine instance id.
- [ ] AC-3: A detected previous-instance API run is marked `status = failed`.
- [ ] AC-4: A detected previous-instance API run is marked `recovery_status = failed`, `recovery_scope = run`, and `recovery_scope_ref = null`.
- [ ] AC-5: Previous-instance API recovery does not wait for the 2-minute heartbeat threshold.

### Task 3.1: Previous-Instance API Recovery
**Fulfills:** AC-1, AC-2, AC-3, AC-4, AC-5

**Files:**
- Modify: `apps/engine/src/api/server.ts`
- Modify: `apps/engine/src/core/orphanRecovery.ts`
- Modify: `apps/engine/src/core/workerLease.ts`
- Test: `apps/engine/test/workerLeaseRecovery.test.ts`
- Test: `apps/engine/test/orphanRecovery.test.ts`

**What to build:** Replace the current coarse API orphan scan with instance-aware startup recovery that fails previous-instance API runs immediately, regardless of fresh heartbeat age.

**TDD cycle:**
- RED: test a previous-instance API run with a fresh heartbeat is recovered as failed/recoverable on startup.
- GREEN: implement instance-aware API recovery and retain resume-compatible recovery projection.
- REFACTOR: preserve operator-facing recovery logging.
- COMMIT: `feat(PROJ-7-PRD-2): implement previous instance recovery`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-7-PRD-2-US-2: As a CLI operator, I want startup to recover stale CLI runs based on heartbeat age so dead terminal workers become resumable
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-6: Startup recovery detects CLI-owned running runs whose heartbeat is older than 2 minutes.
- [ ] AC-7: A stale CLI-owned run is marked `status = failed`.
- [ ] AC-8: A stale CLI-owned run is marked `recovery_status = failed`, `recovery_scope = run`, and `recovery_scope_ref = null`.
- [ ] AC-9: A CLI-owned run with a non-stale heartbeat is not failed solely because the API engine started.
- [ ] AC-10: Startup recovery logs or exposes enough detail to identify recovered CLI run ids.

### Task 3.2: Stale CLI Startup Recovery
**Fulfills:** AC-6, AC-7, AC-8, AC-9, AC-10

**Files:**
- Modify: `apps/engine/src/core/orphanRecovery.ts`
- Modify: `apps/engine/src/core/workerLease.ts`
- Test: `apps/engine/test/workerLeaseRecovery.test.ts`
- Test: `apps/engine/test/orphanRecovery.test.ts`

**What to build:** Recover only stale CLI-owned running runs on API startup, leave fresh CLI-owned runs active, and log recovered CLI run ids.

**TDD cycle:**
- RED: test stale CLI runs recover, fresh CLI runs survive, and recovered ids are visible in startup diagnostics.
- GREEN: implement heartbeat-age CLI recovery.
- REFACTOR: standard cleanup.
- COMMIT: `feat(PROJ-7-PRD-2): implement stale CLI recovery`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-7-PRD-2-US-3: As an operator, I want startup recovery to update item state so a lost worker cannot leave an item stuck in running
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-11: Recovering an authoritative lost-worker run updates the item out of `*/running`.
- [ ] AC-12: The recovered item keeps the column implied by the run's current stage.
- [ ] AC-13: The recovered item has `phase_status = failed`.
- [ ] AC-14: `items.current_stage` is cleared when no live authoritative run remains.
- [ ] AC-15: An end-to-end startup recovery test verifies both `runs` and `items` side effects.

### Task 3.3: Recovery Item Projection
**Fulfills:** AC-11, AC-12, AC-13, AC-14, AC-15

**Files:**
- Modify: `apps/engine/src/core/orphanRecovery.ts`
- Modify: `apps/engine/src/core/boardColumns.ts`
- Modify: `apps/engine/src/db/repositories/repos.ts`
- Test: `apps/engine/test/workerLeaseRecovery.test.ts`
- Test: `apps/engine/test/itemAggregation.test.ts`

**What to build:** Project recovered authoritative runs onto item state using the current stage's board column and `phase_status = failed`, clearing current stage when no live authoritative run remains.

**TDD cycle:**
- RED: end-to-end recovery test proves an item moves from `*/running` to `*/failed` alongside run recovery.
- GREEN: implement authoritative recovery item projection.
- REFACTOR: reuse existing stage-to-column vocabulary.
- COMMIT: `feat(PROJ-7-PRD-2): project lost worker item state`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-7-PRD-2-US-4: As a maintainer, I want recovery to honor authoritative-run rules so stale side runs cannot clobber newer active work
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-16: Recovery checks whether the lost run is authoritative before updating item projection.
- [ ] AC-17: Recovering a stale side run does not overwrite a newer live run's item column.
- [ ] AC-18: Recovering a stale side run does not overwrite a newer live run's item phase status.
- [ ] AC-19: Recovering a stale side run does not clear a newer live run's `items.current_stage`.
- [ ] AC-20: Tests cover side-run recovery while a newer authoritative run remains active.

### Task 3.4: Authoritative Recovery Guard
**Fulfills:** AC-16, AC-17, AC-18, AC-19, AC-20

**Files:**
- Modify: `apps/engine/src/core/orphanRecovery.ts`
- Modify: `apps/engine/src/core/dbSync.ts`
- Test: `apps/engine/test/itemAggregation.test.ts`
- Test: `apps/engine/test/workerLeaseRecovery.test.ts`

**What to build:** Apply the same authoritative-run protection used by live DB sync to startup recovery so stale side runs cannot regress item state.

**TDD cycle:**
- RED: test stale side-run recovery while a newer live run owns the item.
- GREEN: implement the authoritative recovery guard.
- REFACTOR: standard cleanup.
- COMMIT: `feat(PROJ-7-PRD-2): guard recovery item projection`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-7-PRD-2-US-6: As an operator, I want worker start failure after run creation to leave visible recoverable evidence instead of a silent orphan
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-26: Initial lease registration failure after run creation marks the run failed/recoverable.
- [ ] AC-27: Worker start failure after run creation marks the run failed/recoverable.
- [ ] AC-28: First-heartbeat durability failure after run creation marks the run failed/recoverable when the worker cannot safely continue.
- [ ] AC-29: The item projection is updated out of `running` for authoritative failed-start runs.
- [ ] AC-30: CLI and API tests both cover a failed-start path after run creation.

### Task 3.5: Failed Start Recovery Invariant
**Fulfills:** AC-26, AC-27, AC-28, AC-29, AC-30

**Files:**
- Modify: `apps/engine/src/core/runOrchestrator.ts`
- Modify: `apps/engine/src/core/runService.ts`
- Modify: `apps/engine/src/cli/commands/itemActions.ts`
- Modify: `apps/engine/src/core/orphanRecovery.ts`
- Test: `apps/engine/test/workerLeaseStartFailure.test.ts`
- Test: `apps/engine/test/cli-actions.test.ts`
- Test: `apps/engine/test/apiIntegration.test.ts`

**What to build:** Once a run row exists, any lease registration, worker start, or first heartbeat durability failure produces a failed/recoverable run and moves the authoritative item out of running before CLI/API control returns.

**TDD cycle:**
- RED: simulate failed initial claim, failed worker start, and failed first heartbeat for CLI and API paths.
- GREEN: implement the visible failed/recoverable invariant.
- REFACTOR: standard cleanup around shared failure summaries.
- COMMIT: `feat(PROJ-7-PRD-2): implement failed start recovery`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -
