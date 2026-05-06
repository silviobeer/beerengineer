# PROJ-7 Wave 2 Implementation Plan

**Goal:** Wire worker leases into real CLI/API workflow starts and resumes, including heartbeat retry behavior.
**Architecture Reference:** `6_plan/PROJ-7-architecture.md`
**PRDs involved:** PROJ-7-PRD-1

---

## Wave Position

- **Previous waves:** Wave 1 - run-level worker lease foundation complete.
- **Next waves:** Wave 3 depends on production lease ownership being present on running runs.

## User Stories in this Wave

| US ID | Scope | Agent Type | Complexity | Can start when |
|---|---|---|---|---|
| PROJ-7-PRD-1-US-1 | backend | backend-implementer | opus (CLI runtime ownership) | after Wave 1 |
| PROJ-7-PRD-1-US-2 | backend | backend-implementer | opus (API background ownership) | after Wave 1, parallel to US-1 with file coordination |
| PROJ-7-PRD-1-US-4 | backend | backend-implementer | opus (heartbeat failure state) | after Wave 1, coordinate with US-1/US-2 |
| PROJ-7-PRD-1-US-5 | backend | backend-implementer | sonnet | after US-1 and US-2 wiring in this wave |

US-1 and US-2 both touch `runOrchestrator.ts`, `runService.ts`, and resume paths. Coordinate file ownership before editing. US-5 is a verification/story hardening pass after the production callers exist.

**Complexity column:** `sonnet` is standard feature work; `opus` is for architecture-sensitive work such as state machines, concurrency, DB migrations, and cross-feature contracts.

---

## PROJ-7-PRD-1-US-1: As a CLI operator, I want CLI-started workflows to claim durable worker ownership so long-running terminal runs are visibly owned
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-1: CLI workflow start records worker ownership before the workflow enters its first executable stage.
- [ ] AC-2: CLI workflow resume records a new worker claim on the same run row before resumed workflow side effects proceed.
- [ ] AC-3: CLI-owned runs record `worker_owner_kind = cli`.
- [ ] AC-4: CLI-owned active runs refresh `worker_heartbeat_at` every 30 seconds during normal long-running work.
- [ ] AC-5: A public CLI acceptance test verifies the documented CLI command changes run ownership and heartbeat state end to end.

### Task 2.1: CLI Start And Resume Lease Claim
**Fulfills:** AC-1, AC-2, AC-3

**Files:**
- Modify: `apps/engine/src/cli/commands/itemActions.ts`
- Modify: `apps/engine/src/core/runOrchestrator.ts`
- Modify: `apps/engine/src/core/resume.ts`
- Modify: `apps/engine/src/core/workerLease.ts`
- Test: `apps/engine/test/workerLeaseCli.test.ts`
- Test: `apps/engine/test/cli-actions.test.ts`

**What to build:** Ensure every CLI start and same-run resume claims `cli` ownership before workflow side effects proceed, including prepared imports and item-action starts.

**TDD cycle:**
- RED: public CLI tests prove start and resume record a CLI lease before workflow progress is observable.
- GREEN: wire CLI production callers through the shared lease primitives.
- REFACTOR: keep existing CLI signal cleanup behavior compatible with the new lease lifecycle.
- COMMIT: `feat(PROJ-7-PRD-1): implement CLI worker lease ownership`

### Task 2.2: CLI Heartbeat Loop
**Fulfills:** AC-4, AC-5

**Files:**
- Modify: `apps/engine/src/core/workerLease.ts`
- Modify: `apps/engine/src/core/runOrchestrator.ts`
- Modify: `apps/engine/src/core/resume.ts`
- Test: `apps/engine/test/workerLeaseCli.test.ts`
- Test: `apps/engine/test/cli-actions.test.ts`

**What to build:** Refresh the CLI-owned heartbeat every 30 seconds while a workflow or resume is active, using deterministic clock control in tests rather than real sleeps.

**TDD cycle:**
- RED: test heartbeat timestamps advance on cadence for a long-running CLI workflow and that the documented CLI command produces durable ownership side effects.
- GREEN: implement heartbeat lifecycle around CLI start/resume execution.
- REFACTOR: standard cleanup.
- COMMIT: `feat(PROJ-7-PRD-1): implement CLI worker heartbeat`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-7-PRD-1-US-2: As a browser operator, I want API-started workflows to claim worker ownership before 202 is returned so accepted work is never silently ownerless
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-6: API-created workflow runs record worker ownership before the create/start endpoint returns an accepted response.
- [ ] AC-7: API-created workflow runs record `worker_owner_kind = api`.
- [ ] AC-8: API-created workflow runs record the current API engine instance id in `worker_instance_id`.
- [ ] AC-9: API-owned active runs refresh `worker_heartbeat_at` every 30 seconds during normal long-running work.
- [ ] AC-10: An API acceptance test verifies that a successful start response always corresponds to a run row with active worker ownership.

### Task 2.3: API Engine Instance And Start Claim
**Fulfills:** AC-6, AC-7, AC-8, AC-10

**Files:**
- Modify: `apps/engine/src/api/server.ts`
- Modify: `apps/engine/src/core/runService.ts`
- Modify: `apps/engine/src/core/runOrchestrator.ts`
- Modify: `apps/engine/src/core/workerLease.ts`
- Test: `apps/engine/test/workerLeaseApi.test.ts`
- Test: `apps/engine/test/apiIntegration.test.ts`

**What to build:** Give each API engine boot an opaque instance id and require API workflow starts to claim `api` ownership with that instance before returning success.

**TDD cycle:**
- RED: API start tests fail when a successful response lacks active API worker ownership or the current instance id.
- GREEN: thread the API instance identity through start and resume entrypoints and claim before accepted responses.
- REFACTOR: standard cleanup around API start options.
- COMMIT: `feat(PROJ-7-PRD-1): implement API worker lease ownership`

### Task 2.4: API Heartbeat Loop
**Fulfills:** AC-9, AC-10

**Files:**
- Modify: `apps/engine/src/core/runService.ts`
- Modify: `apps/engine/src/core/workerLease.ts`
- Test: `apps/engine/test/workerLeaseApi.test.ts`
- Test: `apps/engine/test/apiIntegration.test.ts`

**What to build:** Refresh API-owned run heartbeats every 30 seconds while background workflow or API resume work is active.

**TDD cycle:**
- RED: deterministic API tests prove active background work refreshes heartbeat timestamps on cadence.
- GREEN: implement heartbeat lifecycle around `fireInBackground`-owned work and API resume.
- REFACTOR: ensure heartbeat timers are closed with workflow IO cleanup.
- COMMIT: `feat(PROJ-7-PRD-1): implement API worker heartbeat`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-7-PRD-1-US-4: As an operator, I want heartbeat write failures to stop unsafe work only after retry so transient DB contention does not kill healthy long runs
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-16: A single heartbeat write failure is retried on the next 30-second cadence.
- [ ] AC-17: A run remains active after one or two consecutive heartbeat write failures when the worker still owns the lease.
- [ ] AC-18: After three consecutive heartbeat write failures, the worker marks its own run failed/recoverable if it can.
- [ ] AC-19: If heartbeat refresh reports that ownership no longer belongs to the worker, the worker marks the run failed/recoverable and stops workflow execution if it can.
- [ ] AC-20: Heartbeat failure behavior is covered for at least one CLI path and one API-owned path.

### Task 2.5: Heartbeat Failure Policy
**Fulfills:** AC-16, AC-17, AC-18, AC-19, AC-20

**Files:**
- Modify: `apps/engine/src/core/workerLease.ts`
- Modify: `apps/engine/src/core/runOrchestrator.ts`
- Modify: `apps/engine/src/core/runService.ts`
- Test: `apps/engine/test/workerLeaseHeartbeat.test.ts`

**What to build:** Apply the 3-strike heartbeat failure policy for both CLI and API workers, and stop work when ownership is explicitly lost.

**TDD cycle:**
- RED: test one and two failed heartbeat writes keep the run active, three failures mark it failed/recoverable, and lost ownership stops both CLI and API paths.
- GREEN: implement retry counting and self-failure behavior in the shared lease lifecycle.
- REFACTOR: keep failure summaries consistent with recovery wording used later.
- COMMIT: `feat(PROJ-7-PRD-1): implement heartbeat failure policy`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-7-PRD-1-US-5: As a maintainer, I want the worker lease abstraction wired into production callers immediately so the feature cannot ship as test-only plumbing
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-21: Worker lease registration has a production caller in CLI workflow start.
- [ ] AC-22: Worker lease registration has a production caller in CLI workflow resume.
- [ ] AC-23: Worker lease registration has a production caller in API workflow start.
- [ ] AC-24: Worker lease registration has a production caller in API workflow resume.
- [ ] AC-25: Code review can identify production call sites for every new worker lease lifecycle primitive introduced by this PRD.

### Task 2.6: Production Caller Coverage Check
**Fulfills:** AC-21, AC-22, AC-23, AC-24, AC-25

**Files:**
- Modify: `apps/engine/src/cli/commands/itemActions.ts`
- Modify: `apps/engine/src/core/runService.ts`
- Modify: `apps/engine/src/core/resume.ts`
- Test: `apps/engine/test/workerLeaseProductionCallers.test.ts`

**What to build:** Add focused assertions that every lease lifecycle primitive introduced in this wave is exercised by production CLI/API start and resume paths.

**TDD cycle:**
- RED: test or static behavioral checks identify missing production callers for each start/resume path.
- GREEN: close any caller gaps left by earlier tasks.
- REFACTOR: standard cleanup.
- COMMIT: `feat(PROJ-7-PRD-1): verify worker lease production callers`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -
