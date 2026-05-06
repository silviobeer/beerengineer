# PROJ-7-PRD-3: Readiness, Resume, And Recovery Surface Contract

## Status: Planned

## User Stories

### US-1: As an operator, I want `/health` to remain a small liveness check so monitoring can distinguish process health from workflow readiness
**Given** the Engine API process is reachable
**When** a client requests `GET /health`
**Then** the response reports process/DB liveness only
**And** the response does not include workflow lease, Git, LLM, workspace, or Supabase capability readiness

**Acceptance Criteria:**
- [ ] AC-1: `GET /health` returns process/service identity and uptime.
- [ ] AC-2: `GET /health` reports basic DB probe status.
- [ ] AC-3: `GET /health` does not check worker lease registration.
- [ ] AC-4: `GET /health` does not check Git, LLM, workspace, setup, or Supabase readiness.
- [ ] AC-5: Existing health endpoint behavior remains backward compatible except for documentation updates required by PROJ-7.

### US-2: As a browser or CLI operator, I want `/ready` to report whether the engine can safely accept workflow work
**Given** a client requests workflow readiness
**When** startup recovery has not completed, shutdown is in flight, DB is unavailable, or the lease write path fails
**Then** `GET /ready` reports unavailable
**And** when all workflow-readiness checks pass, it reports available

**Acceptance Criteria:**
- [ ] AC-6: `GET /ready` reports unavailable before startup recovery completes.
- [ ] AC-7: `GET /ready` reports unavailable while graceful shutdown is in flight.
- [ ] AC-8: `GET /ready` reports unavailable when the DB probe fails.
- [ ] AC-9: `GET /ready` reports unavailable when the worker lease write path cannot be exercised.
- [ ] AC-10: `GET /ready` reports available when DB is reachable, startup recovery completed, shutdown is not in flight, and the lease write path succeeds.

### US-3: As a maintainer, I want `/ready` to exercise a lightweight lease write probe so readiness does not pollute run history
**Given** `/ready` checks worker lease availability
**When** it validates the write path
**Then** it uses a sentinel or equivalent lightweight write probe
**And** it does not create fake workflow runs or fake items

**Acceptance Criteria:**
- [ ] AC-11: `/ready` exercises a DB write path suitable for validating worker lease writes.
- [ ] AC-12: `/ready` does not create a run row.
- [ ] AC-13: `/ready` does not create an item row.
- [ ] AC-14: Repeated `/ready` calls do not grow workflow history.
- [ ] AC-15: Readiness tests cover unavailable-before-recovery and available-after-recovery states.

### US-4: As an operator, I want resuming a lost-worker run to reuse the same run row so recovery history stays coherent
**Given** a lost-worker run is failed/recoverable
**When** the operator resumes it through CLI or API/UI
**Then** the same run row is reused
**And** a new worker lease is claimed on that run
**And** the authoritative item moves back through normal running projection

**Acceptance Criteria:**
- [ ] AC-16: Resume does not create a replacement run solely for lost-worker recovery.
- [ ] AC-17: Resume records remediation using the existing run recovery flow.
- [ ] AC-18: Resume claims a new worker lease on the same run row.
- [ ] AC-19: Recovery state is cleared or updated when the resumed workflow re-enters according to existing resume semantics.
- [ ] AC-20: The authoritative item moves from `*/failed` to `*/running` through normal stage/run projection after resumed work becomes active.

### US-5: As a browser operator, I want existing board and run surfaces to show a lost-worker message so I understand why resume is required
**Given** the latest run for an item was recovered as a lost worker
**When** the board card, item modal, run detail, or run recovery view renders that run
**Then** the UI can display a safe user-facing message such as "worker lost, resume required"
**And** it does not need a new recovery dashboard

**Acceptance Criteria:**
- [ ] AC-21: Board/item/run DTOs expose a projected `recovery_user_message` when lost-worker recovery exists.
- [ ] AC-22: `recovery_user_message` is derived from recovery status, cause, and summary without requiring a new DB column.
- [ ] AC-23: Existing board card or item modal surfaces can render the user-facing recovery message.
- [ ] AC-24: Existing run recovery surfaces can render the user-facing recovery message.
- [ ] AC-25: No new worker/recovery dashboard is required for PROJ-7.

### US-6: As a maintainer, I want API contracts documented so UI and CLI callers do not invent incompatible readiness or recovery shapes
**Given** PROJ-7 adds `/ready`, worker recovery messaging, and lease-backed resume behavior
**When** the PRD is implemented
**Then** the OpenAPI contract and prose API docs describe the new response fields and readiness semantics
**And** clients rely on engine-provided state rather than computing worker loss themselves

**Acceptance Criteria:**
- [ ] AC-26: `GET /ready` is documented in OpenAPI.
- [ ] AC-27: `GET /ready` is documented in `docs/api-contract.md`.
- [ ] AC-28: `recovery_user_message` is documented for every board/item/run DTO where it is exposed.
- [ ] AC-29: `/health` documentation remains limited to process/DB liveness.
- [ ] AC-30: UI callers prefer engine-provided `recovery_user_message` before generic fallback copy.

## Edge Cases

- `/ready` is called during startup recovery; it reports unavailable until recovery completion is recorded.
- `/ready` is called repeatedly by a poller; no run, item, or history rows accumulate.
- DB read succeeds but sentinel write fails; `/ready` reports unavailable.
- A lost-worker run is resumed twice concurrently; only one resumed worker should own the run lease.
- A run has recovery metadata but no projected lost-worker cause; UI falls back safely without inventing misleading copy.
- `/health` succeeds while `/ready` fails during shutdown or recovery; clients can distinguish liveness from workflow readiness.

## Dependencies

- Requires: PROJ-7-PRD-1 worker lease lifecycle.
- Requires: PROJ-7-PRD-2 lost-worker recovery and item projection.

## Technical Requirements

- `/ready` does not include Git identity, LLM configuration, workspace readiness, Supabase readiness, or other per-run capability gates.
- `recovery_summary` remains the durable recovery detail field.
- `recovery_user_message` is a projected API/UI field, not a new DB field in PROJ-7.
- Resume reuses the same run row and claims a new lease.

## UI Implementation Notes

- Project mode: Brownfield.
- Reuse: Existing board card, item modal, run detail, and run recovery surfaces.
- New component candidates: None required.
- Design tokens: Existing status and recovery visual treatment.
- Interaction contract: Show engine-provided `recovery_user_message` before generic fallback copy when available.
- Implementation tolerance: Copy may vary, but it must clearly communicate that the worker was lost and resume is required.
