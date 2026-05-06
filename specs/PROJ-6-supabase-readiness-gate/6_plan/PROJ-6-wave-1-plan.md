# PROJ-6 Wave 1 Implementation Plan

**Goal:** Build the engine-owned Supabase readiness snapshot before wiring it into workflow execution.
**Architecture Reference:** `6_plan/PROJ-6-architecture.md`
**PRDs involved:** PROJ-6-PRD-1

---

## Wave Position

- **Previous waves:** None.
- **Next waves:** Wave 2 depends on this wave for execution gating and CLI blocker output.

## Dependency Analysis

- Wave 1 creates the shared engine readiness contract and Supabase action vocabulary.
- Wave 2 can then call that contract from workflow start/retry and CLI blocked-run output.
- Wave 3 can add CLI setup mutations because it depends on the same readiness labels and server-side workspace authority.
- Wave 4 can build workspace settings once the engine setup/readiness primitives exist.
- Wave 5 can build the board blocker once workspace settings is available as the repair destination.

## User Stories in this Wave

| US ID | Scope | Agent Type | Complexity | Can start when |
|---|---|---|---|---|
| PROJ-6-PRD-1-US-2 | backend | backend-implementer | opus (shared contract) | immediately |
| PROJ-6-PRD-1-US-3 | backend | backend-implementer | opus (provider polling) | immediately, parallel to US-2 |
| PROJ-6-PRD-1-US-5 | backend | backend-implementer | opus (server-side authority) | immediately, parallel to US-2 |

All user stories in a wave run in parallel (unless otherwise noted). These three stories touch the same new readiness domain; coordinate file ownership before editing.

---

## PROJ-6-PRD-1-US-2: Als Operator moechte ich alle fehlenden Supabase-Voraussetzungen auf einmal sehen um Setup gezielt abzuschliessen
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-7: Missing app-level Management API token returns the action label `Store management token`.
- [ ] AC-8: Missing workspace `supabase_project_ref` returns the action label `Connect Supabase project`.
- [ ] AC-9: Missing workspace persistent test branch ref returns the action label `Create persistent test branch`.
- [ ] AC-10: Invalid, revoked, expired, or HTTP 401 Management API token failures return `Rotate management token`, not `Store management token`.
- [ ] AC-11: HTTP 403 or equivalent permission-denied failures for an otherwise accepted token against the workspace project return `Re-authorize project access`, not `Rotate management token` or `Store management token`.
- [ ] AC-12: `Retry run` is not included in the missing setup action list; retry is represented separately as blocked-run recovery metadata.
- [ ] AC-13: Local prerequisite checks are collected in parallel where possible; network checks short-circuit when token/project/branch prerequisites are absent.

### Task 1.1: Readiness Result And Action Vocabulary
**Fulfills:** AC-7, AC-8, AC-9, AC-12, AC-13

**Files:**
- Create: `apps/engine/src/core/supabase/preExecutionReadiness.ts`
- Modify: `apps/engine/src/core/supabase/types.ts`
- Test: `apps/engine/test/core/supabase/preExecutionReadiness.test.ts`

**What to build:** Define the shared readiness snapshot, missing setup action list, retry metadata separation, and local prerequisite evaluation for token/project/branch presence.

**TDD cycle:**
- RED: test that missing token, project ref, and persistent branch are all reported together while `Retry run` is absent from the setup action list.
- GREEN: implement the readiness snapshot and local prerequisite collection.
- REFACTOR: standard cleanup, keeping exported names distinct from `supabaseWaveGate`.
- COMMIT: `feat(PROJ-6-PRD-1): implement readiness action vocabulary`

### Task 1.2: Auth Failure Action Mapping
**Fulfills:** AC-10, AC-11, AC-13

**Files:**
- Modify: `apps/engine/src/core/supabase/preExecutionReadiness.ts`
- Test: `apps/engine/test/core/supabase/preExecutionReadiness.test.ts`

**What to build:** Map Management API authentication failures to deterministic action labels and short-circuit network checks when local prerequisites are absent.

**TDD cycle:**
- RED: test 401-like failures return `Rotate management token`, 403-like project permission failures return `Re-authorize project access`, and absent prerequisites avoid provider calls.
- GREEN: implement provider error classification using the existing Supabase Management API error shape.
- REFACTOR: standard cleanup.
- COMMIT: `feat(PROJ-6-PRD-1): implement supabase auth action mapping`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-6-PRD-1-US-3: Als Workflow Runtime moechte ich Supabase-Projektzugriff und Branch-Gesundheit live pruefen um nicht mit stale Workspace-Metadaten zu starten
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-14: Project access is validated for the run workspace's project ref, not merely by token presence.
- [ ] AC-15: Persistent branch health is checked through the PROJ-4 branch poller under `SUPABASE_READINESS_BRANCH_POLL_BUDGET_MS`.
- [ ] AC-16: `SUPABASE_READINESS_BRANCH_POLL_BUDGET_MS` defaults to 60 seconds and is overrideable in tests without changing production behavior.
- [ ] AC-17: The bounded poll may treat transient provider states as pending during the poll.
- [ ] AC-18: Only `ACTIVE_HEALTHY` is a passing final persistent branch state for execution readiness.
- [ ] AC-19: Missing, degraded, unknown, provider-error, unauthorized, or timeout branch states produce a blocked readiness result instead of starting execution.
- [ ] AC-20: Setup/settings callers may expose a `checking` or recheck state, but execution converts an exhausted poll budget into a blocked run.

### Task 1.3: Project Access And Branch Health
**Fulfills:** AC-14, AC-15, AC-16, AC-17, AC-18, AC-19, AC-20

**Files:**
- Modify: `apps/engine/src/core/supabase/preExecutionReadiness.ts`
- Modify: `apps/engine/src/core/supabase/branchPoller.ts`
- Test: `apps/engine/test/core/supabase/preExecutionReadiness.test.ts`
- Test: `apps/engine/test/core/supabase/branchPoller.test.ts`

**What to build:** Validate project access for the workspace project and route persistent branch status through the existing branch poller with the engine-owned readiness budget.

**TDD cycle:**
- RED: test access validation, 60-second default budget, test override, transient pending states, `ACTIVE_HEALTHY` pass, and timeout/degraded/unknown failures.
- GREEN: implement live project and branch checks through existing Supabase client/poller primitives.
- REFACTOR: keep caller-facing status wording reusable by setup/settings.
- COMMIT: `feat(PROJ-6-PRD-1): implement supabase readiness health checks`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-6-PRD-1-US-5: Als Maintainer moechte ich Workspace-Refs serverseitig erzwingen um Cross-Workspace-Supabase-Zugriffe zu verhindern
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-26: The pre-execution check resolves the workspace from the run/item server-side state.
- [ ] AC-27: Request bodies cannot override workspace root, project ref, persistent branch ref, or branch name.
- [ ] AC-28: Before any Management API or adapter operation, `projectRef` and `branchRef` are cross-checked against the run/workspace row.
- [ ] AC-29: A token that can access workspace `beta` but not workspace `alpha` does not unblock an `alpha` run.

### Task 1.4: Workspace Authority And Capability Delegation
**Fulfills:** AC-26, AC-27, AC-28, AC-29

**Files:**
- Modify: `apps/engine/src/core/supabase/preExecutionReadiness.ts`
- Modify: `apps/engine/src/core/capabilities/supabaseCapability.ts`
- Test: `apps/engine/test/core/supabase/preExecutionReadiness.test.ts`
- Test: `apps/engine/test/core/capabilities/supabaseCapability.preflight.test.ts`

**What to build:** Ensure readiness reads workspace project/branch refs from run/workspace state, cross-checks provider operations against those refs, and consumes the existing Supabase capability foundation instead of forking it.

**TDD cycle:**
- RED: test that body-supplied project/branch values cannot unblock readiness and beta access does not unblock an alpha run.
- GREEN: implement server-side workspace resolution and capability delegation.
- REFACTOR: standard cleanup.
- COMMIT: `feat(PROJ-6-PRD-1): implement workspace-bound supabase readiness`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -
