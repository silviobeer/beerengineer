# PROJ-3-PRD-5: Capability CLI And Update Readiness

## Status: Planned

## User Stories

### US-1: Als Operator moechte ich dedizierte Capability-Kommandos nutzen um Integrationen direkt zu pruefen und zu steuern
**Given** capabilities are exposed through the CLI  
**When** I inspect Git, GitHub, Sonar, or CodeRabbit  
**Then** I use dedicated command groups named after the stable capability IDs  
**And** I do not need a generic `workspace capability ...` command

**Acceptance Criteria:**
- [ ] AC-1: Public command groups use the names `workspace git`, `workspace github`, `workspace sonar`, and `workspace coderabbit` where commands exist.
- [ ] AC-2: This PROJ does not introduce a generic `workspace capability ...` command.
- [ ] AC-3: Help text describes these command groups as workspace capabilities.
- [ ] AC-4: Commands route to capability behavior rather than duplicating tool-specific logic in generic workspace command code.

### US-2: Als Operator moechte ich konsistente Text- und JSON-Ausgabe erhalten um Ergebnisse manuell und maschinell auswerten zu koennen
**Given** I run a capability CLI command  
**When** I request normal text or JSON output  
**Then** the output includes stable capability identity, status or outcome, summary, and tool-specific details  
**And** non-ready states include actionable reasons

**Acceptance Criteria:**
- [ ] AC-5: JSON output includes `capabilityId`.
- [ ] AC-6: JSON output uses closed status/outcome values where applicable.
- [ ] AC-7: Text output clearly distinguishes ready, disabled, not configured, failed, skipped, and not meaningful states where applicable.
- [ ] AC-8: Non-ready text output includes a reason and next action when available.

### US-3: Als Operator moechte ich Sonar-Audit und Repair ueber die CLI bedienen um Quality-Scope-Drift ohne UI zu verwalten
**Given** Sonar has audit and repair capability ports  
**When** I run Sonar CLI commands  
**Then** I can audit, dry-run repair, and apply safe repairs through `workspace sonar ...`  
**And** these commands have real file side-effect acceptance tests

**Acceptance Criteria:**
- [ ] AC-9: `workspace sonar audit` is available with text and JSON output.
- [ ] AC-10: `workspace sonar repair` is dry-run by default with text and JSON output.
- [ ] AC-11: `workspace sonar repair --apply` writes only safe deterministic repairs.
- [ ] AC-12: Public CLI tests verify end-to-end side effects for `repair --apply`, not only helper behavior.

### US-4: Als Operator moechte ich Exit-Codes interpretieren koennen um Automatisierung rund um Capabilities zu bauen
**Given** a capability CLI command completes  
**When** the result is success, usage error, required capability failure, or optional warning  
**Then** the exit code distinguishes these cases  
**And** optional Sonar/CodeRabbit warnings do not look like required Git failures

**Acceptance Criteria:**
- [ ] AC-13: Exact exit codes are assigned before implementation.
- [ ] AC-14: Usage errors have a distinct exit-code category.
- [ ] AC-15: Required capability failures have a distinct exit-code category.
- [ ] AC-16: Optional capability warning or skipped states do not reuse required capability failure semantics.

### US-5: Als Maintainer moechte ich Update-Mode-Readiness mit gemeinsamen Begriffen angleichen um Drift zwischen Self-Update und Workspace-Checks zu vermeiden
**Given** update-mode reports beerengineer self-update readiness  
**When** it checks GitHub or Sonar readiness  
**Then** it uses shared readiness terminology and helper behavior  
**And** it remains outside workspace capability orchestration

**Acceptance Criteria:**
- [ ] AC-17: Update-mode GitHub/Sonar readiness uses shared terms or helpers where they overlap with workspace capability readiness.
- [ ] AC-18: Update-mode does not consume workspace capability orchestration.
- [ ] AC-19: Existing update status behavior remains compatible unless explicitly updated.
- [ ] AC-20: Update-readiness tests cover GitHub/Sonar warning behavior after the shared readiness alignment.

## Edge Cases
- A command is run without selecting a workspace: it reports a usage or selection error clearly.
- A Git command is run outside a valid repo: it reports a required capability failure.
- A Sonar command is run in a workspace with Sonar disabled: it reports disabled or not configured rather than pretending success.
- `repair --apply` has only risky suggestions: it writes nothing and reports the skipped suggestions.
- Update-mode runs without a selected workspace: it still reports self-update readiness and does not require workspace orchestration.

## Abhaengigkeiten
- Benoetigt: PROJ-3-PRD-1.
- Fuer Sonar commands: PROJ-3-PRD-3.
- Fuer workspace command routing: PROJ-3-PRD-2.
- Fuer review outcome JSON consistency: PROJ-3-PRD-4.

## Technische Anforderungen
- CLI command groups must preserve stable capability IDs in JSON.
- Public CLI acceptance tests must verify documented commands end-to-end.
- Update-mode readiness alignment must not turn update-mode into a workspace capability flow.
