# PROJ-3-PRD-3: Sonar Capability Lifecycle

## Status: Planned

## User Stories

### US-1: Als Operator moechte ich Sonar explizit aktivieren koennen um Quality-Checks nach dem Onboarding nachzurichten
**Given** a workspace is registered and has the required Git/GitHub context for Sonar configuration  
**When** I run the Sonar enable flow  
**Then** Sonar-owned configuration and metadata are created or updated  
**And** the result explains readiness, missing prerequisites, and next actions

**Acceptance Criteria:**
- [ ] AC-1: `workspace sonar enable` exists as the explicit Sonar capability enablement path.
- [ ] AC-2: Sonar enablement writes only Sonar-owned artifacts and metadata.
- [ ] AC-3: Missing prerequisites are reported as capability status with next actions.
- [ ] AC-4: Enablement does not require a generic capability CLI command.

### US-2: Als Operator moechte ich `workspace add --sonar` weiter als Komfortpfad nutzen koennen um neue Workspaces in einem Schritt vorzubereiten
**Given** I register a workspace with the Sonar convenience option  
**When** registration reaches Sonar setup  
**Then** it delegates to the same Sonar enablement core as `workspace sonar enable`  
**And** optional Sonar enablement failure does not roll back otherwise valid workspace registration

**Acceptance Criteria:**
- [ ] AC-5: `workspace add --sonar` and `workspace sonar enable` share the same Sonar enablement behavior.
- [ ] AC-6: If Sonar enablement fails but required workspace preconditions pass, workspace registration succeeds.
- [ ] AC-7: Sonar enablement execution errors during registration are recorded as `failed` with a reason.
- [ ] AC-8: Missing Sonar prerequisites during registration are recorded as `not_configured` with a reason.
- [ ] AC-9: Sonar enablement uses a best-effort write strategy with audit/re-enable recovery for Sonar-owned partial states.
- [ ] AC-10: Sonar audit detects partial enablement states that can result from interrupted or partially failed Sonar-owned writes.

### US-3: Als Operator moechte ich Sonar-Scope-Audit ausfuehren um Drift in Source-, Test- und Coverage-Konfiguration sichtbar zu machen
**Given** a workspace has or should have Sonar configuration  
**When** I run `workspace sonar audit`  
**Then** the command reports current Sonar scope, drift findings, and risk classification  
**And** it does not rewrite files

**Acceptance Criteria:**
- [ ] AC-11: `workspace sonar audit` reports Sonar source roots, test roots, coverage reports, and relevant readiness.
- [ ] AC-12: Audit returns drift as structured data, not by throwing for normal drift.
- [ ] AC-13: Audit classifies findings by risk or repairability.
- [ ] AC-14: Audit is read-only.

### US-4: Als Operator moechte ich Sonar-Reparaturen vorab sehen um Quality-Scope-Aenderungen bewusst zu bestaetigen
**Given** Sonar audit finds repairable drift  
**When** I run `workspace sonar repair`  
**Then** the command prints a repair plan  
**And** no files are changed

**Acceptance Criteria:**
- [ ] AC-15: `workspace sonar repair` produces a dry-run plan by default.
- [ ] AC-16: The plan distinguishes safe deterministic repairs from risky or ambiguous suggestions.
- [ ] AC-17: The plan explains why each suggested change exists.
- [ ] AC-18: Dry-run repair does not modify `sonar-project.properties` or workspace metadata.

### US-5: Als Operator moechte ich sichere Sonar-Reparaturen anwenden koennen um deterministische Drift ohne manuelle Dateiedits zu beheben
**Given** a Sonar repair plan contains safe deterministic repairs  
**When** I run `workspace sonar repair --apply`  
**Then** only safe repairs are written  
**And** risky or ambiguous suggestions remain visible and unapplied

**Acceptance Criteria:**
- [ ] AC-19: `repair --apply` writes only safe deterministic repairs.
- [ ] AC-20: Risky or ambiguous repairs are not applied.
- [ ] AC-21: `repair --apply` updates Sonar-owned config and Sonar workspace metadata as one repair unit when both are part of the safe repair.
- [ ] AC-22: If one write in a Sonar repair unit fails, a subsequent audit detects the partial state and the next `repair --apply` recomputes the remaining safe repair.
- [ ] AC-23: Re-running `repair --apply` is idempotent for safe repairs.

### US-6: Als Maintainer moechte ich den Sonar-Lifecycle als Capability sehen um Sonar aus Workspace- und Review-Spezialfaellen herauszuschneiden
**Given** Sonar participates in onboarding, audit, repair, readiness, and review  
**When** Sonar behavior is invoked  
**Then** it is owned by the Sonar capability  
**And** workspace and review modules only orchestrate Sonar through capability ports

**Acceptance Criteria:**
- [ ] AC-24: Sonar enablement, config generation, audit, repair, readiness, and review adapter behavior are owned by the Sonar capability.
- [ ] AC-25: Workspace registration does not own Sonar-specific business logic.
- [ ] AC-26: Story review does not own Sonar-specific scanner or gate logic.
- [ ] AC-27: Sonar lifecycle behavior covers the intent of `specs/sonar-workspace-quality-lifecycle.md`.

## Edge Cases
- `sonar-project.properties` is missing: audit reports missing configuration and possible setup actions.
- Sonar enablement is interrupted after writing one Sonar-owned artifact: audit reports partial enablement and repair/re-enable can recover safe remaining state.
- Source or test paths no longer exist: audit reports drift with risk classification.
- Coverage reports are configured but missing after the coverage-producing step: audit reports `not_meaningful` for coverage assessment.
- LCOV paths refer outside configured source scope: audit reports high-risk drift.
- `repair --apply` is interrupted: audit reports the partial state and a rerun recomputes state before applying only remaining safe repairs.
- Sonar token or scanner is missing: Sonar is reported as `not_configured` without blocking story flows.

## Abhaengigkeiten
- Benoetigt: PROJ-3-PRD-1, PROJ-3-PRD-2.
- Unterstuetzt: PROJ-3-PRD-4, PROJ-3-PRD-5.

## Technische Anforderungen
- Sonar repair must be conservative and explicit.
- Sonar lifecycle state must be observable through text and JSON CLI output.
- Sonar behavior must stay within Sonar-owned write boundaries.

## QA Test Results

Date: 2026-05-04

Result: PASS after QA rerun. Automated and happy-path Sonar lifecycle tests passed, and the adversarial custom-key failure is fixed and verified.

Evidence:
- `npm test --workspace=@beerengineer/engine`: PASS (795 tests; 793 passed, 2 skipped, 0 failed).
- Focused Sonar/capability tests: PASS (73 tests, 0 failures).
- Fix verification: `npm run test:file --workspace=@beerengineer/engine -- test/sonarCapability.test.ts`: PASS (28 tests, 0 failures).
- Fix verification: `npm run test:file --workspace=@beerengineer/engine -- test/cli.test.ts test/workspaces.test.ts`: PASS (43 tests, 0 failures).
- Fix verification: `npm test --workspace=@beerengineer/engine`: PASS (798 tests; 796 passed, 2 skipped, 0 failed).
- Adversarial repro: `enableWorkspaceSonarCapability(..., { organization: "acme", projectKey: "custom_key" })` now writes `sonar.projectKey=custom_key` to `sonar-project.properties`.

AC status:
- PASS after fix: AC-1, AC-3 through AC-27.
- Fixed: AC-19 for non-default configured project keys; enablement and `repair --apply` now write scanner config for the configured Sonar key.

Linked bug:
- `BUG-PROJ3-QA-001` in `7_progress/PROJ-3-progress.md`.

Browser/UI note: no frontend route or component was added for this PRD; CLI/file side effects were the relevant E2E path.

### QA Rerun — 2026-05-04

Result: PASS. Rerun verified AC-1 through AC-27 after the custom Sonar key fix.

Evidence:
- `npm run typecheck --workspace=@beerengineer/engine`: PASS.
- `npm run test:file --workspace=@beerengineer/engine -- test/capabilityCli.test.ts test/sonarCapability.test.ts test/reviewCapabilities.test.ts test/workspaceCapabilities.test.ts`: PASS (75 tests, 0 failures).
- `npm test --workspace=@beerengineer/engine`: PASS (798 tests; 796 passed, 2 skipped, 0 failed).
- Adversarial custom-key repro: PASS for enablement and `repair --apply`; generated scanner config uses `sonar.projectKey=custom_key`.

Linked bug status:
- `BUG-PROJ3-QA-001`: fixed and verified.
