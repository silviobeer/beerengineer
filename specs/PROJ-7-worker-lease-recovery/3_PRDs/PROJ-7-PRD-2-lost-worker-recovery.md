# PROJ-7-PRD-2: Lost Worker Recovery And Item Projection

## Status: Planned

## User Stories

### US-1: As a browser operator, I want startup to recover API runs from previous engine instances so fresh but ownerless runs do not remain active forever
**Given** an API-owned run is still marked running in SQLite
**And** its `worker_instance_id` does not match the current API engine instance
**When** the engine starts
**Then** the run is marked failed/recoverable even if its heartbeat is younger than 2 minutes
**And** the recovery summary explains that the worker was lost and resume is required

**Acceptance Criteria:**
- [ ] AC-1: API engine startup creates a fresh process-scoped engine instance id.
- [ ] AC-2: Startup recovery detects running API-owned runs whose `worker_instance_id` differs from the current engine instance id.
- [ ] AC-3: A detected previous-instance API run is marked `status = failed`.
- [ ] AC-4: A detected previous-instance API run is marked `recovery_status = failed`, `recovery_scope = run`, and `recovery_scope_ref = null`.
- [ ] AC-5: Previous-instance API recovery does not wait for the 2-minute heartbeat threshold.

### US-2: As a CLI operator, I want startup to recover stale CLI runs based on heartbeat age so dead terminal workers become resumable
**Given** a CLI-owned run is still marked running in SQLite
**When** the engine starts
**Then** the run is recovered only if its `worker_heartbeat_at` is older than 2 minutes
**And** a fresh CLI heartbeat is not failed solely because the API engine restarted

**Acceptance Criteria:**
- [ ] AC-6: Startup recovery detects CLI-owned running runs whose heartbeat is older than 2 minutes.
- [ ] AC-7: A stale CLI-owned run is marked `status = failed`.
- [ ] AC-8: A stale CLI-owned run is marked `recovery_status = failed`, `recovery_scope = run`, and `recovery_scope_ref = null`.
- [ ] AC-9: A CLI-owned run with a non-stale heartbeat is not failed solely because the API engine started.
- [ ] AC-10: Startup recovery logs or exposes enough detail to identify recovered CLI run ids.

### US-3: As an operator, I want startup recovery to update item state so a lost worker cannot leave an item stuck in running
**Given** startup recovery marks a run failed/recoverable
**And** that run is still authoritative for its item
**When** recovery completes
**Then** the item is projected to the column implied by the run's current stage
**And** the item has `phase_status = failed`
**And** `items.current_stage` is cleared when no live authoritative run remains

**Acceptance Criteria:**
- [ ] AC-11: Recovering an authoritative lost-worker run updates the item out of `*/running`.
- [ ] AC-12: The recovered item keeps the column implied by the run's current stage.
- [ ] AC-13: The recovered item has `phase_status = failed`.
- [ ] AC-14: `items.current_stage` is cleared when no live authoritative run remains.
- [ ] AC-15: An end-to-end startup recovery test verifies both `runs` and `items` side effects.

### US-4: As a maintainer, I want recovery to honor authoritative-run rules so stale side runs cannot clobber newer active work
**Given** an item has a newer live authoritative run
**And** an older side run is recovered as lost
**When** startup recovery updates the older run
**Then** the item projection remains owned by the newer live run
**And** the stale side run does not overwrite the item column, phase, or current stage

**Acceptance Criteria:**
- [ ] AC-16: Recovery checks whether the lost run is authoritative before updating item projection.
- [ ] AC-17: Recovering a stale side run does not overwrite a newer live run's item column.
- [ ] AC-18: Recovering a stale side run does not overwrite a newer live run's item phase status.
- [ ] AC-19: Recovering a stale side run does not clear a newer live run's `items.current_stage`.
- [ ] AC-20: Tests cover side-run recovery while a newer authoritative run remains active.

### US-5: As an API operator, I want graceful shutdown to make in-process API runs recoverable when possible so clean exits do not leave confusing active leases
**Given** graceful shutdown begins while API-owned in-process runs are active
**When** the engine can still write recovery state
**Then** active API-owned in-process runs are best-effort marked failed/recoverable with a shutdown summary
**And** CLI-owned runs are not failed just because the API engine is exiting

**Acceptance Criteria:**
- [ ] AC-21: `/ready` becomes unavailable immediately when graceful shutdown starts.
- [ ] AC-22: Graceful shutdown best-effort marks active API-owned in-process runs failed/recoverable.
- [ ] AC-23: Shutdown recovery summaries distinguish graceful shutdown from generic lost-worker startup recovery.
- [ ] AC-24: Abrupt shutdown is still recoverable on next startup through previous-instance detection.
- [ ] AC-25: Graceful API shutdown does not mark CLI-owned active runs failed/recoverable solely because the API process exits.

### US-6: As an operator, I want worker start failure after run creation to leave visible recoverable evidence instead of a silent orphan
**Given** a workflow start path has already created a run row
**When** initial lease registration, first heartbeat, or worker start fails
**Then** the run is marked failed/recoverable immediately
**And** the item is not left in `running`
**And** the caller receives an error or accepted-failed state that identifies the recoverable run

**Acceptance Criteria:**
- [ ] AC-26: Initial lease registration failure after run creation marks the run failed/recoverable.
- [ ] AC-27: Worker start failure after run creation marks the run failed/recoverable.
- [ ] AC-28: First-heartbeat durability failure after run creation marks the run failed/recoverable when the worker cannot safely continue.
- [ ] AC-29: The item projection is updated out of `running` for authoritative failed-start runs.
- [ ] AC-30: CLI and API tests both cover a failed-start path after run creation.

## Edge Cases

- An API run's heartbeat is fresh but the engine instance id is from a previous process; it is still recovered as lost.
- A CLI run's heartbeat is fresh while the API engine restarts; it is not failed by previous-instance recovery.
- The run has no current stage; recovery still produces a stable failed item projection.
- Recovery finds several stale runs on startup; all eligible runs are handled without one failure aborting the scan.
- A stale side run belongs to an item with a newer active run; item state remains with the newer run.
- Shutdown begins while DB writes are already unavailable; next startup performs recovery.

## Dependencies

- Requires: PROJ-7-PRD-1 worker lease lifecycle.
- Enables: PROJ-7-PRD-3 readiness and resume contract.

## Technical Requirements

- Automatic stale recovery is startup-only for PROJ-7.
- A wedged worker in an otherwise alive API process is an accepted out-of-scope case until engine restart.
- Recovered runs use existing run-level recovery fields: `recovery_status = failed`, `recovery_scope = run`, and `recovery_scope_ref = null`.
- Item recoverability is represented as `phase_status = failed` plus run recovery metadata; no new item phase is introduced.

## QA Test Results

**Tested:** 2026-05-06
**Tester:** QA Engineer (AI)

### Acceptance Criteria Status

- [x] Startup previous-instance API recovery, stale CLI recovery, item projection, authoritative-run guard, graceful shutdown recovery, and failed-start recovery targeted tests passed.
- [x] Live API probe confirmed `/ready` remains available after startup and repeated `/ready` calls did not grow run history.
- [ ] BUG: Shared worker-lease fatal behavior from PROJ-7-PRD-1 can still leave a workflow body executing after a recoverable lease failure.

### Edge Cases Status

- [x] Previous API instance recovery does not wait for the stale heartbeat threshold.
- [x] Fresh CLI heartbeat remains active across API startup.
- [x] Shutdown recovery preserves CLI-owned active runs.

### Security Audit Results

- [x] Recovery messages are projected from known recovery summaries and rendered as React text, not HTML.
- [x] Browser console/network review found no recovery-message request failures; only an unrelated missing favicon 404 appeared.

### Bugs Found

- See BUG-PROJ7-QA-001 in PROJ-7-PRD-1.

### Summary

- **Acceptance Criteria:** Blocked by BUG-PROJ7-QA-001
- **Bugs Found:** 1 total (0 critical, 1 high, 0 medium, 0 low)
- **Security:** Pass
- **Production Ready:** NO
- **Recommendation:** Fix high bug first

### AGENTS.md Candidates (for Skill 7 review)

- [ ] Lease-fatal tests must prove the workflow body stops, not only that the heartbeat interval stops. — **why:** BUG-PROJ7-QA-001 shows interval-only assertions can miss duplicate worker side effects.
