# PROJ-7 Wave 4 Implementation Plan

**Goal:** Add workflow readiness, graceful shutdown recovery, same-run resume lease behavior, recovery messaging, and public API documentation.
**Architecture Reference:** `6_plan/PROJ-7-architecture.md`
**PRDs involved:** PROJ-7-PRD-2, PROJ-7-PRD-3

---

## Wave Position

- **Previous waves:** Wave 3 - lost-worker recovery, item projection, and failed-start recovery complete.
- **Next waves:** None.

## User Stories in this Wave

| US ID | Scope | Agent Type | Complexity | Can start when |
|---|---|---|---|---|
| PROJ-7-PRD-3-US-1 | backend | backend-implementer | sonnet | after Wave 3 |
| PROJ-7-PRD-3-US-2 | backend | backend-implementer | opus (readiness contract) | after Wave 3 |
| PROJ-7-PRD-2-US-5 | backend | backend-implementer | opus (shutdown behavior) | after Wave 3, coordinate with PRD-3-US-2 |
| PROJ-7-PRD-3-US-3 | backend | backend-implementer | sonnet | after Wave 3, parallel to US-2 with file coordination |
| PROJ-7-PRD-3-US-4 | backend | backend-implementer | opus (same-run resume ownership) | after Wave 3 |
| PROJ-7-PRD-3-US-5 | full-stack | full-stack-implementer | sonnet | after Wave 3 |
| PROJ-7-PRD-3-US-6 | backend | backend-implementer | sonnet | after US-2 and US-5 contract shape is stable |

PRD-3-US-2, PRD-2-US-5, and PRD-3-US-3 share readiness internals. PRD-3-US-5 touches existing board/run UI surfaces and must use the component registry below.

**Complexity column:** `sonnet` is standard feature work; `opus` is for architecture-sensitive work such as state machines, concurrency, DB migrations, and cross-feature contracts.

---

## PROJ-7-PRD-3-US-1: As an operator, I want `/health` to remain a small liveness check so monitoring can distinguish process health from workflow readiness
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-1: `GET /health` returns process/service identity and uptime.
- [ ] AC-2: `GET /health` reports basic DB probe status.
- [ ] AC-3: `GET /health` does not check worker lease registration.
- [ ] AC-4: `GET /health` does not check Git, LLM, workspace, setup, or Supabase readiness.
- [ ] AC-5: Existing health endpoint behavior remains backward compatible except for documentation updates required by PROJ-7.

### Task 4.1: Health Contract Guard
**Fulfills:** AC-1, AC-2, AC-3, AC-4, AC-5

**Files:**
- Modify: `apps/engine/src/api/health.ts`
- Test: `apps/engine/test/api/health.test.ts`
- Test: `apps/engine/test/apiIntegration.test.ts`

**What to build:** Preserve `/health` as process/DB liveness while `/ready` is added separately.

**TDD cycle:**
- RED: test `/health` output remains limited to service, uptime, ok, and DB status and does not invoke lease readiness checks.
- GREEN: keep or adjust health behavior to preserve the contract.
- REFACTOR: standard cleanup.
- COMMIT: `feat(PROJ-7-PRD-3): preserve health liveness contract`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-7-PRD-3-US-2: As a browser or CLI operator, I want `/ready` to report whether the engine can safely accept workflow work
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-6: `GET /ready` reports unavailable before startup recovery completes.
- [ ] AC-7: `GET /ready` reports unavailable while graceful shutdown is in flight.
- [ ] AC-8: `GET /ready` reports unavailable when the DB probe fails.
- [ ] AC-9: `GET /ready` reports unavailable when the worker lease write path cannot be exercised.
- [ ] AC-10: `GET /ready` reports available when DB is reachable, startup recovery completed, shutdown is not in flight, and the lease write path succeeds.

### Task 4.2: Workflow Readiness Endpoint
**Fulfills:** AC-6, AC-7, AC-8, AC-9, AC-10

**Files:**
- Modify: `apps/engine/src/api/health.ts`
- Modify: `apps/engine/src/api/server.ts`
- Modify: `apps/engine/src/core/workerLease.ts`
- Test: `apps/engine/test/api/ready.test.ts`
- Test: `apps/engine/test/apiIntegration.test.ts`

**What to build:** Add `/ready` as workflow readiness that reflects startup recovery completion, shutdown state, DB reachability, and worker lease write availability.

**TDD cycle:**
- RED: test unavailable-before-recovery, unavailable-during-shutdown, DB failure, lease write failure, and available healthy state.
- GREEN: implement the readiness projection and route.
- REFACTOR: keep `/health` and `/ready` responsibilities separate.
- COMMIT: `feat(PROJ-7-PRD-3): implement workflow readiness endpoint`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-7-PRD-2-US-5: As an API operator, I want graceful shutdown to make in-process API runs recoverable when possible so clean exits do not leave confusing active leases
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-21: `/ready` becomes unavailable immediately when graceful shutdown starts.
- [ ] AC-22: Graceful shutdown best-effort marks active API-owned in-process runs failed/recoverable.
- [ ] AC-23: Shutdown recovery summaries distinguish graceful shutdown from generic lost-worker startup recovery.
- [ ] AC-24: Abrupt shutdown is still recoverable on next startup through previous-instance detection.
- [ ] AC-25: Graceful API shutdown does not mark CLI-owned active runs failed/recoverable solely because the API process exits.

### Task 4.3: Graceful Shutdown Recovery
**Fulfills:** AC-21, AC-22, AC-23, AC-24, AC-25

**Files:**
- Modify: `apps/engine/src/api/server.ts`
- Modify: `apps/engine/src/core/orphanRecovery.ts`
- Modify: `apps/engine/src/api/health.ts`
- Test: `apps/engine/test/workerLeaseShutdown.test.ts`
- Test: `apps/engine/test/apiIntegration.test.ts`

**What to build:** Mark readiness unavailable as soon as shutdown starts, best-effort recover active API-owned in-process runs with shutdown-specific summaries, and leave CLI-owned runs alone.

**TDD cycle:**
- RED: test graceful shutdown flips readiness, recovers API runs, distinguishes summaries, preserves CLI runs, and abrupt shutdown remains covered by previous-instance recovery.
- GREEN: implement shutdown recovery behavior against the Wave 4 readiness route/state.
- REFACTOR: keep shutdown recovery reusable by update-mode shutdown.
- COMMIT: `feat(PROJ-7-PRD-2): implement shutdown worker recovery`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-7-PRD-3-US-3: As a maintainer, I want `/ready` to exercise a lightweight lease write probe so readiness does not pollute run history
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-11: `/ready` exercises a DB write path suitable for validating worker lease writes.
- [ ] AC-12: `/ready` does not create a run row.
- [ ] AC-13: `/ready` does not create an item row.
- [ ] AC-14: Repeated `/ready` calls do not grow workflow history.
- [ ] AC-15: Readiness tests cover unavailable-before-recovery and available-after-recovery states.

### Task 4.4: Readiness Sentinel Probe
**Fulfills:** AC-11, AC-12, AC-13, AC-14, AC-15

**Files:**
- Modify: `apps/engine/src/db/connection.ts`
- Modify: `apps/engine/src/db/schema.sql`
- Modify: `apps/engine/src/db/repositories/repos.ts`
- Modify: `apps/engine/src/api/health.ts`
- Test: `apps/engine/test/api/ready.test.ts`

**What to build:** Exercise a lightweight readiness sentinel write path for `/ready` without creating fake runs, fake items, or growing workflow history.

**TDD cycle:**
- RED: repeated `/ready` calls prove no run/item/history growth while still failing when the sentinel write path fails.
- GREEN: implement the sentinel probe.
- REFACTOR: standard cleanup.
- COMMIT: `feat(PROJ-7-PRD-3): implement readiness sentinel probe`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-7-PRD-3-US-4: As an operator, I want resuming a lost-worker run to reuse the same run row so recovery history stays coherent
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-16: Resume does not create a replacement run solely for lost-worker recovery.
- [ ] AC-17: Resume records remediation using the existing run recovery flow.
- [ ] AC-18: Resume claims a new worker lease on the same run row.
- [ ] AC-19: Recovery state is cleared or updated when the resumed workflow re-enters according to existing resume semantics.
- [ ] AC-20: The authoritative item moves from `*/failed` to `*/running` through normal stage/run projection after resumed work becomes active.

### Task 4.5: Same-Run Resume Lease
**Fulfills:** AC-16, AC-17, AC-18, AC-19, AC-20

**Files:**
- Modify: `apps/engine/src/core/resume.ts`
- Modify: `apps/engine/src/core/runService.ts`
- Modify: `apps/engine/src/cli/commands/itemActions.ts`
- Modify: `apps/engine/src/core/workerLease.ts`
- Test: `apps/engine/test/workerLeaseResume.test.ts`
- Test: `apps/engine/test/resume.test.ts`

**What to build:** Ensure lost-worker resume reuses the existing run row, records remediation through the current flow, claims a fresh lease, and returns the authoritative item to normal running projection.

**TDD cycle:**
- RED: test same-run resume, concurrent resume ownership, remediation preservation, recovery clearing/update, and item re-entry to running.
- GREEN: wire resume through the worker lease lifecycle.
- REFACTOR: standard cleanup.
- COMMIT: `feat(PROJ-7-PRD-3): implement same run resume lease`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-7-PRD-3-US-5: As a browser operator, I want existing board and run surfaces to show a lost-worker message so I understand why resume is required
**Scope:** full-stack -> full-stack-implementer

**Acceptance Criteria:**
- [ ] AC-21: Board/item/run DTOs expose a projected `recovery_user_message` when lost-worker recovery exists.
- [ ] AC-22: `recovery_user_message` is derived from recovery status, cause, and summary without requiring a new DB column.
- [ ] AC-23: Existing board card or item modal surfaces can render the user-facing recovery message.
- [ ] AC-24: Existing run recovery surfaces can render the user-facing recovery message.
- [ ] AC-25: No new worker/recovery dashboard is required for PROJ-7.

**Smoke Test:**
- Route: `/w/test`
- Verify: "A board item with lost-worker recovery shows the engine-provided recovery message in existing board/item surfaces without navigating to a new dashboard."

**UI Implementation Notes:**
- Project mode: Brownfield.
- Mockup reference: None; no new mockup because PROJ-7 reuses existing surfaces.
- Selected direction: Existing board card, item modal, run detail, and run recovery containers.
- Reuse: `BoardCard`, `BoardItemModal`, `AttentionDot`, existing run recovery view, `StatusChip`/status-chip language where already present.
- Create new: None expected; add a small helper only if needed to avoid duplicated message formatting.
- Design tokens: Preserve dense operator-console styling from `docs/components.md`.
- Interaction contract: Prefer engine-provided `recovery_user_message` before generic fallback copy.
- Implementation tolerance: Existing React components and design tokens take precedence; do not add a new recovery dashboard.

### Task 4.6: Recovery User Message Projection
**Fulfills:** AC-21, AC-22

**Files:**
- Modify: `apps/engine/src/api/board.ts`
- Modify: `apps/engine/src/api/routes/runs.ts`
- Modify: `apps/ui/lib/types.ts`
- Test: `apps/engine/test/workerRecoverySurface.test.ts`

**What to build:** Project `recovery_user_message` into board/item/run DTOs for lost-worker recovery using existing recovery fields, without adding a new DB column.

**Components:**
- Reuse: Existing DTO-to-component flow for `BoardCardDTO` and run recovery data.
- Create new: None expected.

**UI handoff constraints:**
- Follow: Engine owns lost-worker classification and message text.
- May approximate: Exact copy can vary if it clearly states worker loss and resume requirement.
- Must not change without user approval: No new recovery dashboard or new top-level surface.

**TDD cycle:**
- RED: backend DTO tests prove lost-worker runs expose `recovery_user_message` and ordinary recovery states fall back safely.
- GREEN: implement recovery message projection.
- REFACTOR: keep message derivation centralized.
- COMMIT: `feat(PROJ-7-PRD-3): project recovery user message`

### Task 4.7: Existing UI Surface Rendering
**Fulfills:** AC-23, AC-24, AC-25

**Files:**
- Modify: `apps/ui/components/BoardCard.tsx`
- Modify: `apps/ui/components/BoardItemModal.tsx`
- Modify: `apps/ui/components/run/RunOverviewBanners.tsx`
- Test: `apps/ui/tests/workerRecoveryMessage.test.tsx`

**What to build:** Render the engine-provided recovery message in existing board/item/run surfaces and avoid introducing a new dashboard.

**Components:**
- Reuse: `BoardCard`, `BoardItemModal`, `AttentionDot`, `RunOverviewBanners`, existing status-chip language.
- Create new: None expected.

**UI handoff constraints:**
- Follow: Brownfield dense board/modal styling from `docs/components.md`.
- May approximate: Whether message appears as inline text or existing banner-like treatment, as long as it is visible and accessible.
- Must not change without user approval: Existing board/item modal container model.

**TDD cycle:**
- RED: UI tests prove board/item/run surfaces show `recovery_user_message` and no new dashboard route is required.
- GREEN: render the projected message in existing components.
- REFACTOR: standard cleanup.
- COMMIT: `feat(PROJ-7-PRD-3): render worker recovery message`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-7-PRD-3-US-6: As a maintainer, I want API contracts documented so UI and CLI callers do not invent incompatible readiness or recovery shapes
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-26: `GET /ready` is documented in OpenAPI.
- [ ] AC-27: `GET /ready` is documented in `docs/api-contract.md`.
- [ ] AC-28: `recovery_user_message` is documented for every board/item/run DTO where it is exposed.
- [ ] AC-29: `/health` documentation remains limited to process/DB liveness.
- [ ] AC-30: UI callers prefer engine-provided `recovery_user_message` before generic fallback copy.

### Task 4.8: API Contract And Docs
**Fulfills:** AC-26, AC-27, AC-28, AC-29, AC-30

**Files:**
- Modify: `apps/engine/src/api/openapi.json`
- Modify: `docs/api-contract.md`
- Modify: `apps/ui/lib/types.ts`
- Test: `apps/engine/test/apiIntegration.test.ts`
- Test: `apps/ui/tests/workerRecoveryMessage.test.tsx`

**What to build:** Document `/ready`, keep `/health` docs liveness-only, document every exposed `recovery_user_message` DTO field, and ensure UI callers prefer the engine-provided message.

**TDD cycle:**
- RED: contract tests fail until OpenAPI/prose docs include `/ready` and recovery message fields.
- GREEN: update contracts and UI type expectations.
- REFACTOR: standard cleanup.
- COMMIT: `feat(PROJ-7-PRD-3): document readiness recovery contract`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -
