# PROJ-6 Wave 2 Implementation Plan

**Goal:** Wire the readiness snapshot into workflow execution, blocked-run recovery, and CLI blocked-run output.
**Architecture Reference:** `6_plan/PROJ-6-architecture.md`
**PRDs involved:** PROJ-6-PRD-1, PROJ-6-PRD-2

---

## Wave Position

- **Previous waves:** Wave 1 - shared Supabase readiness snapshot complete.
- **Next waves:** Wave 3 depends on blocked-run retry semantics and CLI production caller.

## User Stories in this Wave

| US ID | Scope | Agent Type | Complexity | Can start when |
|---|---|---|---|---|
| PROJ-6-PRD-1-US-1 | backend | backend-implementer | opus (workflow gate) | after Wave 1 |
| PROJ-6-PRD-1-US-4 | backend | backend-implementer | opus (same-run recovery) | after Wave 1 |
| PROJ-6-PRD-2-US-1 | backend | backend-implementer | sonnet | after Wave 1, parallel to PRD-1-US-4 with coordination |

All user stories in a wave run in parallel (unless otherwise noted). PRD-1-US-1 and PRD-1-US-4 both touch workflow start/retry paths; coordinate ownership of `runService.ts`.

---

## PROJ-6-PRD-1-US-1: Als Workflow Runtime moechte ich DB-relevante Plaene vor Execution erkennen um Supabase-Setup vor Worker-Start zu erzwingen
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-1: The pre-execution readiness check runs after planning artifacts are available and before any execution worker, wave branch, or Supabase wave branch provisioning starts.
- [ ] AC-2: A plan with at least one `dbRelevant: true` story or `dbRelevantWave: true` wave is treated as DB-relevant even if earlier waves are non-DB-relevant.
- [ ] AC-3: A plan where all waves are explicitly non-DB-relevant bypasses Supabase pre-execution readiness and does not call Supabase Management API or adapter operations.
- [ ] AC-4: A validated plan with missing, legacy, or malformed DB relevance metadata is rejected or blocks before execution; it is never silently treated as non-DB-relevant.
- [ ] AC-5: The readiness payload includes DB relevance trigger context when called from execution, such as the first DB-relevant wave/story that caused the gate.
- [ ] AC-6: The new readiness module/function name is distinct from `supabaseWaveGate` and does not publish an exported function with the same name and a different signature.

### Task 2.1: Execution Preflight Gate
**Fulfills:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6

**Files:**
- Modify: `apps/engine/src/core/runService.ts`
- Modify: `apps/engine/src/workflow.ts`
- Modify: `apps/engine/src/stages/execution/waveExecution.ts`
- Test: `apps/engine/test/workflowSupabaseReadinessGate.test.ts`
- Test: `apps/engine/test/stages/execution/supabaseSkip.test.ts`

**What to build:** Insert the Supabase readiness gate after planning artifacts are available and before execution side effects. Detect DB-relevant plans, reject malformed relevance metadata, include trigger context, and bypass all Supabase calls for explicitly non-DB plans.

**TDD cycle:**
- RED: test DB-relevant later waves block before wave one, non-DB waves do not call Supabase, and malformed relevance metadata does not silently pass.
- GREEN: wire the readiness check into workflow execution before worker/wave branch side effects.
- REFACTOR: keep the new readiness name distinct from `supabaseWaveGate`.
- COMMIT: `feat(PROJ-6-PRD-1): implement supabase execution readiness gate`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-6-PRD-1-US-4: Als Operator moechte ich nach behobenem Setup denselben blockierten Run fortsetzen um keine neuen Run-Artefakte zu erzeugen
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-21: A blocked Supabase readiness run is marked `blocked`, not `failed`.
- [ ] AC-22: The blocked `runId` is reused on retry; retry does not create a new run as the normal success path.
- [ ] AC-23: Retry re-reads current workspace rows and re-runs readiness before dispatching workers.
- [ ] AC-24: Retry does not perform automatic Supabase project creation or silent setup mutations.
- [ ] AC-25: If readiness remains blocked after retry, the run remains blocked with an updated readiness payload.

### Task 2.2: Same-Run Supabase Retry
**Fulfills:** AC-21, AC-22, AC-23, AC-24, AC-25

**Files:**
- Modify: `apps/engine/src/core/runService.ts`
- Modify: `apps/engine/src/core/resume.ts`
- Modify: `apps/engine/src/db/repositories/repos.ts`
- Test: `apps/engine/test/workflowSupabaseReadinessGate.test.ts`
- Test: `apps/engine/test/resume.test.ts`

**What to build:** Represent Supabase readiness blockers as run-level blocked recovery state, then retry the same run by re-entering the readiness point and re-reading current workspace Supabase rows.

**TDD cycle:**
- RED: test a blocked run keeps the same run id, retry rechecks fresh workspace state, retry never creates/auto-configures a Supabase project, and repeated blockage updates the payload.
- GREEN: implement same-run retry behavior through the existing recovery/resume flow.
- REFACTOR: standard cleanup around blocked-run status projection.
- COMMIT: `feat(PROJ-6-PRD-1): implement same-run supabase readiness retry`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-6-PRD-2-US-1: Als CLI Operator moechte ich bei einem blockierten DB-relevanten Run klare Supabase-Aktionen sehen um den naechsten Setup-Schritt zu kennen
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-1: CLI output includes the workspace key or name for the blocked run.
- [ ] AC-2: CLI output explains that planned DB-relevant waves require Supabase readiness before execution workers start.
- [ ] AC-3: CLI output groups missing setup actions using exactly the PRD-1 labels: `Store management token`, `Connect Supabase project`, `Create persistent test branch`, `Rotate management token`, and `Re-authorize project access`.
- [ ] AC-4: CLI output provides one primary next command: run the existing setup flow.
- [ ] AC-5: CLI blocked-run output stays concise and does not include the full manual Supabase tutorial every time.
- [ ] AC-6: `Retry run` is shown only as a separate blocked-run affordance or instruction when run context exists, not as a missing setup action.
- [ ] AC-7: At least one non-test production CLI entrypoint invokes the engine readiness model for DB-relevant blocked runs before PRD-2 can be accepted.

### Task 2.3: CLI Supabase Blocker Output
**Fulfills:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7

**Files:**
- Modify: `apps/engine/src/cli/commands/itemActions.ts`
- Modify: `apps/engine/src/core/runService.ts`
- Test: `apps/engine/test/cli-actions.test.ts`
- Test: `apps/engine/test/workflowSupabaseReadinessGate.test.ts`

**What to build:** Render Supabase readiness blocked runs in CLI item-action flows with workspace context, grouped setup actions, setup command guidance, and separate retry wording.

**TDD cycle:**
- RED: public CLI acceptance test starts a DB-relevant blocked workflow and verifies output text plus durable blocked run state.
- GREEN: wire production CLI start/resume entrypoints to the engine readiness model and render concise guidance.
- REFACTOR: standard cleanup.
- COMMIT: `feat(PROJ-6-PRD-2): implement CLI supabase blocker output`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -
