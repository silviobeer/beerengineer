# PROJ-3 Wave 3 Implementation Plan

**Goal:** Make Sonar a full explicit capability for enablement, audit, dry-run repair, safe apply, readiness, and review ownership.
**Architecture Reference:** `6_plan/PROJ-3-architecture.md`
**PRDs involved:** PROJ-3-PRD-3

---

## Wave Position

- **Previous waves:** Wave 2 - completed before this wave starts.
- **Next waves:** Wave 4 consumes the Sonar review adapter; Wave 5 exposes Sonar commands and CLI acceptance coverage.

## User Stories in this Wave

| US ID | Scope | Agent Type | Complexity | Can start when |
|---|---|---|---|---|
| PROJ-3-PRD-3-US-1 | backend | backend-implementer | opus (Sonar writes and prerequisites) | Wave 2 complete |
| PROJ-3-PRD-3-US-2 | backend | backend-implementer | opus (registration recovery semantics) | Wave 2 complete |
| PROJ-3-PRD-3-US-3 | backend | backend-implementer | sonnet | Wave 2 complete |
| PROJ-3-PRD-3-US-4 | backend | backend-implementer | sonnet | Wave 2 complete |
| PROJ-3-PRD-3-US-5 | backend | backend-implementer | opus (repair unit idempotency) | Wave 2 complete |
| PROJ-3-PRD-3-US-6 | backend | backend-implementer | opus (ownership migration) | Wave 2 complete |

All user stories in a wave run in parallel (unless otherwise noted). The Sonar audit/repair stories share `apps/engine/src/core/capabilities/sonarCapability.ts`; coordinate function boundaries before editing.

---

## PROJ-3-PRD-3-US-1: Als Operator moechte ich Sonar explizit aktivieren koennen um Quality-Checks nach dem Onboarding nachzurichten
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-1: `workspace sonar enable` exists as the explicit Sonar capability enablement path.
- [ ] AC-2: Sonar enablement writes only Sonar-owned artifacts and metadata.
- [ ] AC-3: Missing prerequisites are reported as capability status with next actions.
- [ ] AC-4: Enablement does not require a generic capability CLI command.

### Task 1.1: Sonar Enable Port And CLI Handler
**Fulfills:** AC-1, AC-2, AC-3, AC-4

**Files:**
- Modify: `apps/engine/src/core/capabilities/sonarCapability.ts`
- Modify: `apps/engine/src/core/workspaces.ts`
- Modify: `apps/engine/src/cli/types.ts`
- Modify: `apps/engine/src/cli/parse.ts`
- Modify: `apps/engine/src/cli/commands/workspaces.ts`
- Modify: `apps/engine/src/index.ts`
- Test: `apps/engine/test/sonarCapability.test.ts`
- Test: `apps/engine/test/cli.test.ts`

**What to build:** Implement `workspace sonar enable <workspace>` using the explicit Sonar enable port. It writes `sonar-project.properties`, Sonar workflow/config metadata, and workspace metadata only when prerequisites are available; missing prerequisites return capability status and next actions.

**TDD cycle:**
- RED: CLI parse and command tests expect `workspace sonar enable demo --json` to exist without `workspace capability`.
- GREEN: implement the command path and Sonar enable behavior.
- REFACTOR: reuse existing Sonar generation/provision helpers through the Sonar capability module.
- COMMIT: `feat(PROJ-3-PRD-3): implement sonar enable command`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-3-PRD-3-US-2: Als Operator moechte ich `workspace add --sonar` weiter als Komfortpfad nutzen koennen um neue Workspaces in einem Schritt vorzubereiten
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-5: `workspace add --sonar` and `workspace sonar enable` share the same Sonar enablement behavior.
- [ ] AC-6: If Sonar enablement fails but required workspace preconditions pass, workspace registration succeeds.
- [ ] AC-7: Sonar enablement execution errors during registration are recorded as `failed` with a reason.
- [ ] AC-8: Missing Sonar prerequisites during registration are recorded as `not_configured` with a reason.
- [ ] AC-9: Sonar enablement uses a best-effort write strategy with audit/re-enable recovery for Sonar-owned partial states.
- [ ] AC-10: Sonar audit detects partial enablement states that can result from interrupted or partially failed Sonar-owned writes.

### Task 2.1: Shared Enablement Core For Registration
**Fulfills:** AC-5, AC-6, AC-7, AC-8, AC-9, AC-10

**Files:**
- Modify: `apps/engine/src/core/workspaces/registration.ts`
- Modify: `apps/engine/src/core/capabilities/sonarCapability.ts`
- Test: `apps/engine/test/sonarCapability.test.ts`
- Test: `apps/engine/test/workspaceCapabilities.test.ts`

**What to build:** Replace `workspace add --sonar` special-case setup with the same Sonar enablement core used by `workspace sonar enable`. Record `failed` and `not_configured` capability outcomes without rolling back valid workspace registration.

**TDD cycle:**
- RED: test both command paths produce matching Sonar-owned files and matching missing-prerequisite outcomes.
- GREEN: route registration through the Sonar enable port.
- REFACTOR: ensure interrupted writes are detectable by audit.
- COMMIT: `feat(PROJ-3-PRD-3): share sonar enablement core`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-3-PRD-3-US-3: Als Operator moechte ich Sonar-Scope-Audit ausfuehren um Drift in Source-, Test- und Coverage-Konfiguration sichtbar zu machen
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-11: `workspace sonar audit` reports Sonar source roots, test roots, coverage reports, and relevant readiness.
- [ ] AC-12: Audit returns drift as structured data, not by throwing for normal drift.
- [ ] AC-13: Audit classifies findings by risk or repairability.
- [ ] AC-14: Audit is read-only.

### Task 3.1: Sonar Scope Audit
**Fulfills:** AC-11, AC-12, AC-13, AC-14

**Files:**
- Modify: `apps/engine/src/core/capabilities/sonarCapability.ts`
- Modify: `apps/engine/src/cli/commands/workspaces.ts`
- Test: `apps/engine/test/sonarCapability.test.ts`

**What to build:** Implement `workspace sonar audit <workspace>` with text and JSON output that reports source roots, test roots, coverage report paths, readiness, drift findings, and risk/repairability classification without writing files.

**TDD cycle:**
- RED: test audit reports missing/deleted roots and leaves file mtimes/content unchanged.
- GREEN: implement audit analysis and CLI rendering.
- REFACTOR: share parsing helpers with existing `sonar.ts` functions.
- COMMIT: `feat(PROJ-3-PRD-3): implement sonar audit`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-3-PRD-3-US-4: Als Operator moechte ich Sonar-Reparaturen vorab sehen um Quality-Scope-Aenderungen bewusst zu bestaetigen
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-15: `workspace sonar repair` produces a dry-run plan by default.
- [ ] AC-16: The plan distinguishes safe deterministic repairs from risky or ambiguous suggestions.
- [ ] AC-17: The plan explains why each suggested change exists.
- [ ] AC-18: Dry-run repair does not modify `sonar-project.properties` or workspace metadata.

### Task 4.1: Sonar Repair Dry Run
**Fulfills:** AC-15, AC-16, AC-17, AC-18

**Files:**
- Modify: `apps/engine/src/core/capabilities/sonarCapability.ts`
- Modify: `apps/engine/src/cli/commands/workspaces.ts`
- Test: `apps/engine/test/sonarCapability.test.ts`

**What to build:** Implement dry-run repair planning that converts audit findings into safe deterministic repairs and risky/ambiguous suggestions with reasons, without writing tracked config or workspace metadata.

**TDD cycle:**
- RED: test dry-run output includes safe/risky buckets and leaves files unchanged.
- GREEN: implement repair planning and rendering.
- REFACTOR: standard cleanup.
- COMMIT: `feat(PROJ-3-PRD-3): implement sonar repair dry run`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-3-PRD-3-US-5: Als Operator moechte ich sichere Sonar-Reparaturen anwenden koennen um deterministische Drift ohne manuelle Dateiedits zu beheben
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-19: `repair --apply` writes only safe deterministic repairs.
- [ ] AC-20: Risky or ambiguous repairs are not applied.
- [ ] AC-21: `repair --apply` updates Sonar-owned config and Sonar workspace metadata as one repair unit when both are part of the safe repair.
- [ ] AC-22: If one write in a Sonar repair unit fails, a subsequent audit detects the partial state and the next `repair --apply` recomputes the remaining safe repair.
- [ ] AC-23: Re-running `repair --apply` is idempotent for safe repairs.

### Task 5.1: Sonar Safe Repair Apply
**Fulfills:** AC-19, AC-20, AC-21, AC-22, AC-23

**Files:**
- Modify: `apps/engine/src/core/capabilities/sonarCapability.ts`
- Modify: `apps/engine/src/cli/commands/workspaces.ts`
- Test: `apps/engine/test/sonarCapability.test.ts`
- Test: `apps/engine/test/cli.test.ts`

**What to build:** Implement `workspace sonar repair <workspace> --apply` so only safe deterministic repairs are written. Config and workspace metadata updates that belong together are applied as one recomputable repair unit, and repeated apply runs are idempotent.

**TDD cycle:**
- RED: public CLI test verifies real `repair --apply` file side effects and idempotency.
- GREEN: implement safe apply and partial-state recomputation.
- REFACTOR: keep risky/ambiguous suggestions visible and unapplied.
- COMMIT: `feat(PROJ-3-PRD-3): implement sonar repair apply`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-3-PRD-3-US-6: Als Maintainer moechte ich den Sonar-Lifecycle als Capability sehen um Sonar aus Workspace- und Review-Spezialfaellen herauszuschneiden
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-24: Sonar enablement, config generation, audit, repair, readiness, and review adapter behavior are owned by the Sonar capability.
- [ ] AC-25: Workspace registration does not own Sonar-specific business logic.
- [ ] AC-26: Story review does not own Sonar-specific scanner or gate logic.
- [ ] AC-27: Sonar lifecycle behavior covers the intent of `specs/sonar-workspace-quality-lifecycle.md`.

### Task 6.1: Sonar Ownership Migration
**Fulfills:** AC-24, AC-25, AC-26, AC-27

**Files:**
- Modify: `apps/engine/src/core/capabilities/sonarCapability.ts`
- Modify: `apps/engine/src/core/workspaces/sonar.ts`
- Modify: `apps/engine/src/core/workspaces/registration.ts`
- Modify: `apps/engine/src/review/sonarcloud.ts`
- Test: `apps/engine/test/sonarCapability.test.ts`
- Test: `apps/engine/test/ralphRuntime.test.ts`

**What to build:** Consolidate Sonar enablement, generation, audit, repair, readiness, and review adapter ownership under the Sonar capability while leaving workspace registration and story review as orchestrators.

**TDD cycle:**
- RED: test registration/review call Sonar capability behavior rather than owning scanner/gate/config decisions.
- GREEN: move ownership boundaries and preserve existing review behavior.
- REFACTOR: verify lifecycle behavior covers `specs/sonar-workspace-quality-lifecycle.md` scenarios listed in tests.
- COMMIT: `feat(PROJ-3-PRD-3): migrate sonar lifecycle ownership`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -
