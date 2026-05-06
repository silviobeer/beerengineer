# PROJ-7-PRD-1: Worker Lease Lifecycle

## Status: Planned

## User Stories

### US-1: As a CLI operator, I want CLI-started workflows to claim durable worker ownership so long-running terminal runs are visibly owned
**Given** a CLI operator starts or resumes a workflow
**When** the workflow begins running
**Then** the run records active worker ownership before workflow side effects proceed
**And** the run records the worker as CLI-owned
**And** the worker heartbeat is refreshed every 30 seconds while work is active

**Acceptance Criteria:**
- [ ] AC-1: CLI workflow start records worker ownership before the workflow enters its first executable stage.
- [ ] AC-2: CLI workflow resume records a new worker claim on the same run row before resumed workflow side effects proceed.
- [ ] AC-3: CLI-owned runs record `worker_owner_kind = cli`.
- [ ] AC-4: CLI-owned active runs refresh `worker_heartbeat_at` every 30 seconds during normal long-running work.
- [ ] AC-5: A public CLI acceptance test verifies the documented CLI command changes run ownership and heartbeat state end to end.

### US-2: As a browser operator, I want API-started workflows to claim worker ownership before 202 is returned so accepted work is never silently ownerless
**Given** a browser operator starts a workflow through the Engine API
**When** the API accepts the run
**Then** the run already has active API worker ownership
**And** the API returns success only after the worker claim is durable
**And** the worker heartbeat is refreshed every 30 seconds while work is active

**Acceptance Criteria:**
- [ ] AC-6: API-created workflow runs record worker ownership before the create/start endpoint returns an accepted response.
- [ ] AC-7: API-created workflow runs record `worker_owner_kind = api`.
- [ ] AC-8: API-created workflow runs record the current API engine instance id in `worker_instance_id`.
- [ ] AC-9: API-owned active runs refresh `worker_heartbeat_at` every 30 seconds during normal long-running work.
- [ ] AC-10: An API acceptance test verifies that a successful start response always corresponds to a run row with active worker ownership.

### US-3: As an operator, I want worker ownership fields to support future queue migration without introducing a queue now
**Given** the engine persists worker ownership on a running run
**When** the run is inspected through DB-backed run state
**Then** ownership includes a worker instance id, owner kind, started timestamp, and heartbeat timestamp
**And** no durable workflow queue or job table is required for PROJ-7

**Acceptance Criteria:**
- [ ] AC-11: Running workflow runs persist `worker_instance_id`.
- [ ] AC-12: Running workflow runs persist `worker_owner_kind`.
- [ ] AC-13: Running workflow runs persist `worker_started_at`.
- [ ] AC-14: Running workflow runs persist `worker_heartbeat_at`.
- [ ] AC-15: PROJ-7 does not require a workflow job table, worker queue table, or automatic job reclaimer.

### US-4: As an operator, I want heartbeat write failures to stop unsafe work only after retry so transient DB contention does not kill healthy long runs
**Given** a worker is running a workflow and periodically writing heartbeats
**When** a heartbeat write fails transiently
**Then** the worker retries on the next heartbeat cadence
**And** the worker does not fail the run after a single missed heartbeat write
**And** the worker fails its own run as recoverable after three consecutive heartbeat write failures or an explicit lost-ownership response

**Acceptance Criteria:**
- [ ] AC-16: A single heartbeat write failure is retried on the next 30-second cadence.
- [ ] AC-17: A run remains active after one or two consecutive heartbeat write failures when the worker still owns the lease.
- [ ] AC-18: After three consecutive heartbeat write failures, the worker marks its own run failed/recoverable if it can.
- [ ] AC-19: If heartbeat refresh reports that ownership no longer belongs to the worker, the worker marks the run failed/recoverable and stops workflow execution if it can.
- [ ] AC-20: Heartbeat failure behavior is covered for at least one CLI path and one API-owned path.

### US-5: As a maintainer, I want the worker lease abstraction wired into production callers immediately so the feature cannot ship as test-only plumbing
**Given** worker lease primitives are introduced
**When** PROJ-7-PRD-1 is marked complete
**Then** both CLI and API workflow start/resume paths use the production lease behavior
**And** the lease module is not only exercised by tests

**Acceptance Criteria:**
- [ ] AC-21: Worker lease registration has a production caller in CLI workflow start.
- [ ] AC-22: Worker lease registration has a production caller in CLI workflow resume.
- [ ] AC-23: Worker lease registration has a production caller in API workflow start.
- [ ] AC-24: Worker lease registration has a production caller in API workflow resume.
- [ ] AC-25: Code review can identify production call sites for every new worker lease lifecycle primitive introduced by this PRD.

## Edge Cases

- The workflow runs for multiple hours; the heartbeat continues without causing timeout.
- The local machine sleeps and later wakes; PROJ-7 does not add an in-session stale scanner that fails the run solely because time passed during sleep.
- SQLite briefly rejects or delays a heartbeat write; the worker retries before failing itself.
- A worker discovers ownership has changed or disappeared while it is still running; it stops and records recoverable failure if possible.
- A run row exists but the first lease claim cannot be written; the caller-facing behavior is covered by PROJ-7-PRD-2.

## Dependencies

- Requires: PROJ-7 concept approval.
- Enables: PROJ-7-PRD-2 lost-worker recovery and PROJ-7-PRD-3 readiness/resume contract.

## Technical Requirements

- The heartbeat cadence is 30 seconds.
- The stale threshold for startup recovery is 2 minutes.
- The product remains in the local single-engine-process model; multiple API engine processes sharing one SQLite DB are out of scope.
- Worker ownership is stored directly on `runs` for this project.
