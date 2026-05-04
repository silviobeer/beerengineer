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
**And** optional Sonar failure does not roll back otherwise valid workspace registration

**Acceptance Criteria:**
- [ ] AC-5: `workspace add --sonar` and `workspace sonar enable` share the same Sonar enablement behavior.
- [ ] AC-6: If Sonar enablement fails but required workspace preconditions pass, workspace registration succeeds.
- [ ] AC-7: The registration result records Sonar as failed, not configured, or not meaningful with a reason.
- [ ] AC-8: Sonar-owned partial writes are avoided up front or recoverable through Sonar enable/audit/repair.

### US-3: Als Operator moechte ich Sonar-Scope-Audit ausfuehren um Drift in Source-, Test- und Coverage-Konfiguration sichtbar zu machen
**Given** a workspace has or should have Sonar configuration  
**When** I run `workspace sonar audit`  
**Then** the command reports current Sonar scope, drift findings, and risk classification  
**And** it does not rewrite files

**Acceptance Criteria:**
- [ ] AC-9: `workspace sonar audit` reports Sonar source roots, test roots, coverage reports, and relevant readiness.
- [ ] AC-10: Audit returns drift as structured data, not by throwing for normal drift.
- [ ] AC-11: Audit classifies findings by risk or repairability.
- [ ] AC-12: Audit is read-only.

### US-4: Als Operator moechte ich Sonar-Reparaturen vorab sehen um Quality-Scope-Aenderungen bewusst zu bestaetigen
**Given** Sonar audit finds repairable drift  
**When** I run `workspace sonar repair`  
**Then** the command prints a repair plan  
**And** no files are changed

**Acceptance Criteria:**
- [ ] AC-13: `workspace sonar repair` produces a dry-run plan by default.
- [ ] AC-14: The plan distinguishes safe deterministic repairs from risky or ambiguous suggestions.
- [ ] AC-15: The plan explains why each suggested change exists.
- [ ] AC-16: Dry-run repair does not modify `sonar-project.properties` or workspace metadata.

### US-5: Als Operator moechte ich sichere Sonar-Reparaturen anwenden koennen um deterministische Drift ohne manuelle Dateiedits zu beheben
**Given** a Sonar repair plan contains safe deterministic repairs  
**When** I run `workspace sonar repair --apply`  
**Then** only safe repairs are written  
**And** risky or ambiguous suggestions remain visible and unapplied

**Acceptance Criteria:**
- [ ] AC-17: `repair --apply` writes only safe deterministic repairs.
- [ ] AC-18: Risky or ambiguous repairs are not applied.
- [ ] AC-19: `repair --apply` updates Sonar-owned config and Sonar workspace metadata together when both are part of the safe repair.
- [ ] AC-20: Re-running `repair --apply` is idempotent for safe repairs.

### US-6: Als Maintainer moechte ich den Sonar-Lifecycle als Capability sehen um Sonar aus Workspace- und Review-Spezialfaellen herauszuschneiden
**Given** Sonar participates in onboarding, audit, repair, readiness, and review  
**When** Sonar behavior is invoked  
**Then** it is owned by the Sonar capability  
**And** workspace and review modules only orchestrate Sonar through capability ports

**Acceptance Criteria:**
- [ ] AC-21: Sonar enablement, config generation, audit, repair, readiness, and review adapter behavior are owned by the Sonar capability.
- [ ] AC-22: Workspace registration does not own Sonar-specific business logic.
- [ ] AC-23: Story review does not own Sonar-specific scanner or gate logic.
- [ ] AC-24: Sonar lifecycle behavior covers the intent of `specs/sonar-workspace-quality-lifecycle.md`.

## Edge Cases
- `sonar-project.properties` is missing: audit reports missing configuration and possible setup actions.
- Source or test paths no longer exist: audit reports drift with risk classification.
- Coverage reports are configured but missing: audit reports not meaningful or artifact missing as appropriate.
- LCOV paths refer outside configured source scope: audit reports high-risk drift.
- `repair --apply` is interrupted: a rerun recomputes state and applies only remaining safe repairs.
- Sonar token or scanner is missing: Sonar is reported as not configured or not meaningful without blocking story flows.

## Abhaengigkeiten
- Benoetigt: PROJ-3-PRD-1, PROJ-3-PRD-2.
- Unterstuetzt: PROJ-3-PRD-4, PROJ-3-PRD-5.

## Technische Anforderungen
- Sonar repair must be conservative and explicit.
- Sonar lifecycle state must be observable through text and JSON CLI output.
- Sonar behavior must stay within Sonar-owned write boundaries.
