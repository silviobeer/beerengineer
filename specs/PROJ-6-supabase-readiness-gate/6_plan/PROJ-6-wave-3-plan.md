# PROJ-6 Wave 3 Implementation Plan

**Goal:** Add CLI setup repair flows for manual Supabase project connection, token storage, persistent branch setup, and same-run retry guidance.
**Architecture Reference:** `6_plan/PROJ-6-architecture.md`
**PRDs involved:** PROJ-6-PRD-2

---

## Wave Position

- **Previous waves:** Wave 2 - execution blocker and CLI blocked-run output complete.
- **Next waves:** Wave 4 depends on these engine setup primitives for workspace settings.

## User Stories in this Wave

| US ID | Scope | Agent Type | Complexity | Can start when |
|---|---|---|---|---|
| PROJ-6-PRD-2-US-2 | backend | backend-implementer | sonnet | after Wave 2 |
| PROJ-6-PRD-2-US-3 | backend | backend-implementer | opus (privileged token path) | after Wave 2 |
| PROJ-6-PRD-2-US-4 | backend | backend-implementer | opus (branch lifecycle) | after PRD-2-US-3 |
| PROJ-6-PRD-2-US-5 | backend | backend-implementer | sonnet | after PRD-2-US-4 |

PRD-2-US-4 depends on project/token validation from PRD-2-US-3. PRD-2-US-5 depends on readiness completion semantics from PRD-2-US-4.

---

## PROJ-6-PRD-2-US-2: Als CLI Operator moechte ich im Setup erfahren was ich manuell in Supabase erledigen muss um Projektregion und Provider-Optionen selbst zu waehlen
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-8: CLI setup explicitly says the user must create or select the Supabase Cloud project manually.
- [ ] AC-9: CLI setup guidance mentions choosing region/location and provider-side project settings in Supabase.
- [ ] AC-10: CLI setup guidance mentions enabling/checking Supabase branching support for the project or plan.
- [ ] AC-11: CLI setup guidance tells the user to copy the project ref and create a Management API token with project access.
- [ ] AC-12: CLI setup can include useful Supabase links or references without making external browsing mandatory for automated tests.

### Task 3.1: Manual Supabase Guidance In CLI Setup
**Fulfills:** AC-8, AC-9, AC-10, AC-11, AC-12

**Files:**
- Modify: `apps/engine/src/setup/setupFlow.ts`
- Modify: `apps/engine/src/setup/doctorOutput.ts`
- Test: `apps/engine/test/setup/setupFlow.supabase.test.ts`
- Test: `apps/engine/test/setupInteractiveEntry.test.ts`

**What to build:** Add concise CLI setup guidance that tells the user to manually create/select a Supabase Cloud project, choose provider options, enable/check branching, copy the ref, and create a Management API token.

**TDD cycle:**
- RED: test setup output includes manual project guidance without requiring external browsing.
- GREEN: implement guidance in the existing setup flow.
- REFACTOR: standard cleanup.
- COMMIT: `feat(PROJ-6-PRD-2): implement CLI supabase setup guidance`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-6-PRD-2-US-3: Als CLI Operator moechte ich Project Ref und Management Token im Setup eingeben um die Workspace-Verbindung zu validieren
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-13: CLI setup writes `supabase.management_token` only through dedicated Supabase connect/rotate logic, not the generic secret mutation handler.
- [ ] AC-14: The privileged Supabase token ref remains deny-listed from generic `/setup/secrets/<ref>` style mutation.
- [ ] AC-15: CLI setup validates that the token can access the entered project ref before marking the workspace connected.
- [ ] AC-16: The project ref is stored on the selected workspace, not globally and not on a current-workspace guess.
- [ ] AC-17: If validation fails, the previous active token/project metadata remains safe and the redacted provider message is shown before generic fallback copy.
- [ ] AC-18: CLI setup maps invalid/revoked/HTTP 401 token failures to `Rotate management token` and HTTP 403 permission-denied failures to `Re-authorize project access`.

### Task 3.2: Dedicated CLI Connect And Rotate Path
**Fulfills:** AC-13, AC-14, AC-15, AC-16, AC-17, AC-18

**Files:**
- Modify: `apps/engine/src/setup/supabaseSetup.ts`
- Modify: `apps/engine/src/setup/secretActions.ts`
- Modify: `apps/engine/src/setup/secretActions.supabaseRotate.ts`
- Modify: `apps/engine/src/setup/setupFlow.ts`
- Test: `apps/engine/test/setup/setupFlow.supabase.test.ts`
- Test: `apps/engine/test/setup/secretActions.supabaseRotate.test.ts`
- Test: `apps/engine/test/setup/secretMetadata.test.ts`

**What to build:** Ensure CLI setup stores the management token only through dedicated Supabase connect/rotate behavior, validates project access before connection, preserves prior state on failure, and keeps the privileged token deny-listed from generic secret mutations.

**TDD cycle:**
- RED: test validation success stores workspace project ref, validation failure preserves previous metadata, generic secret writes are denied, and auth failures map to the correct labels.
- GREEN: implement dedicated connect/rotate behavior in setup.
- REFACTOR: standard cleanup.
- COMMIT: `feat(PROJ-6-PRD-2): implement CLI supabase connect path`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-6-PRD-2-US-4: Als CLI Operator moechte ich eine persistent test branch erstellen oder anhaengen um DB-relevante Runs starten zu koennen
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-19: CLI setup offers create or attach behavior for the persistent test branch after token/project validation.
- [ ] AC-20: CLI setup does not create new Supabase projects.
- [ ] AC-21: CLI setup shows `checking` or equivalent progress while branch health is polling interactively.
- [ ] AC-22: CLI setup treats `ACTIVE_HEALTHY` as ready and stores the persistent branch ref/status on the workspace.
- [ ] AC-23: If the interactive branch poll times out or provider state remains transient, CLI setup tells the user to recheck rather than marking execution-ready.

### Task 3.3: Persistent Branch Setup In CLI
**Fulfills:** AC-19, AC-20, AC-21, AC-22, AC-23

**Files:**
- Modify: `apps/engine/src/setup/setupFlow.ts`
- Modify: `apps/engine/src/core/supabase/persistentTestBranch.ts`
- Modify: `apps/engine/src/core/supabase/adapter.ts`
- Test: `apps/engine/test/setup/setupFlow.supabase.test.ts`
- Test: `apps/engine/test/core/supabase/persistentTestBranch.create.test.ts`
- Test: `apps/engine/test/core/supabase/persistentTestBranch.attach.test.ts`

**What to build:** Offer create/attach persistent branch behavior after token/project validation, show checking while branch health polls, store `ACTIVE_HEALTHY`, and ask for recheck when transient states outlast the interactive budget.

**TDD cycle:**
- RED: test create, attach, checking, timeout/recheck, and no project-creation behavior.
- GREEN: implement persistent branch setup through existing PROJ-4 branch primitives.
- REFACTOR: standard cleanup.
- COMMIT: `feat(PROJ-6-PRD-2): implement CLI persistent branch setup`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-6-PRD-2-US-5: Als CLI Operator moechte ich nach Setup denselben Run erneut pruefen um Execution ohne neue Artefakte fortzusetzen
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-24: CLI setup completion displays a clear retry instruction for the blocked run when run context is available.
- [ ] AC-25: Retrying after setup reuses the existing blocked `runId` semantics from PRD-1.
- [ ] AC-26: If readiness is still incomplete on retry, CLI output shows the updated missing setup action list.
- [ ] AC-27: CLI setup can also be run outside a blocked-run context to prepare a workspace ahead of time.

### Task 3.4: CLI Setup Completion And Retry Instruction
**Fulfills:** AC-24, AC-25, AC-26, AC-27

**Files:**
- Modify: `apps/engine/src/setup/setupFlow.ts`
- Modify: `apps/engine/src/cli/commands/itemActions.ts`
- Test: `apps/engine/test/setup/setupFlow.supabase.test.ts`
- Test: `apps/engine/test/cli-actions.test.ts`

**What to build:** After setup succeeds, print retry instructions when a blocked run context exists, keep setup usable without run context, and ensure retry returns the updated readiness action list when still blocked.

**TDD cycle:**
- RED: test setup with and without blocked-run context and retry output after still-blocked readiness.
- GREEN: implement setup completion messaging and retry integration.
- REFACTOR: standard cleanup.
- COMMIT: `feat(PROJ-6-PRD-2): implement CLI supabase retry guidance`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -
