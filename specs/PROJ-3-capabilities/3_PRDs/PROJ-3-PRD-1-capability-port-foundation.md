# PROJ-3-PRD-1: Capability Port Foundation

## Status: Planned

## User Stories

### US-1: Als Maintainer moechte ich stabile Capability-IDs haben um Integrationen konsistent zu erkennen
**Given** the engine references workspace and review integrations  
**When** Git, GitHub, Sonar, or CodeRabbit is reported through capability-aware flows  
**Then** each integration is identified by one stable capability ID  
**And** JSON-facing outputs use the same IDs as the internal capability model

**Acceptance Criteria:**
- [ ] AC-1: The capability IDs are a closed set for this PROJ: `git`, `github`, `sonar`, and `coderabbit`.
- [ ] AC-2: Capability-aware JSON output includes `capabilityId` using one of the closed-set IDs.
- [ ] AC-3: No separate alias is introduced for the same capability in CLI, review, or workspace preflight output.

### US-2: Als Maintainer moechte ich explizite Ports statt eines Plugin-Frameworks haben um die Architektur schnell zu verstehen
**Given** a capability participates in workspace, CLI, or review flows  
**When** the capability exposes behavior to other engine modules  
**Then** it does so through typed explicit ports  
**And** it implements only ports that are meaningful for that capability

**Acceptance Criteria:**
- [ ] AC-4: The foundation defines the allowed port categories: availability, preflight, enable, connect, audit, repair, and review.
- [ ] AC-5: A capability can omit ports that do not apply to its role.
- [ ] AC-6: The architecture does not require a dynamic plugin lifecycle or generic plugin registration flow.

### US-3: Als Maintainer moechte ich Availability und Preflight unterscheiden um billige Verfuegbarkeit nicht mit detaillierter Readiness zu vermischen
**Given** a caller needs to know whether a capability can participate  
**When** the caller needs only a cheap local answer  
**Then** it uses capability availability  
**And** detailed diagnostics are reserved for capability preflight

**Acceptance Criteria:**
- [ ] AC-7: Availability is defined as a cheap local capability participation check.
- [ ] AC-8: Preflight is defined as detailed readiness/context reporting.
- [ ] AC-9: Normal missing, disabled, and not-configured states are returned as data from preflight, not treated as exceptional control flow.

### US-4: Als Review-Orchestrator moechte ich eine gemeinsame Review-Huelle haben um Tools parallel darstellen zu koennen ohne Tool-Semantik zu verlieren
**Given** Sonar and CodeRabbit return different domain results  
**When** review results are collected  
**Then** each review capability returns a common orchestration envelope  
**And** the domain-specific result remains tool-specific

**Acceptance Criteria:**
- [ ] AC-10: The review envelope includes capability identity, lifecycle/phase, outcome, blocking indicator, summary, and artifact references.
- [ ] AC-11: The review outcome states are a closed set that includes at least ran, skipped, failed, not configured, and not meaningful.
- [ ] AC-12: Sonar-specific gate/scope/coverage data is not forced into CodeRabbit's result shape.
- [ ] AC-13: CodeRabbit-specific diff/finding data is not forced into Sonar's result shape.

### US-5: Als Update-Mode-Betreiber moechte ich gemeinsame Readiness-Begriffe nutzen um GitHub/Sonar-Checks nicht doppelt unterschiedlich zu pflegen
**Given** update-mode checks beerengineer self-update readiness  
**When** it reports GitHub or Sonar readiness  
**Then** it uses shared readiness terminology and helper behavior  
**And** it does not become a workspace-capability orchestration consumer

**Acceptance Criteria:**
- [ ] AC-14: Shared readiness terminology covers Git, GitHub, and Sonar as needed by workspace and update-mode flows.
- [ ] AC-15: Update-mode remains separate from workspace capability orchestration.
- [ ] AC-16: Update-mode GitHub/Sonar readiness cannot drift into contradictory status meanings compared with workspace capability readiness.

## Edge Cases
- A capability is disabled: preflight reports a disabled state as data.
- A capability is not configured: preflight reports not configured with a user-facing reason.
- A capability's input workspace is unreadable: the caller receives a failure appropriate to the flow rather than a false ready state.
- A review tool returns a domain result that has no matching field in the shared envelope: the tool-specific result preserves it.
- Update-mode needs GitHub/Sonar readiness but no workspace is selected: shared readiness helpers still work without workspace orchestration.

## Abhaengigkeiten
- Benoetigt: PROJ-3 concept approval.
- Enables: PROJ-3-PRD-2, PROJ-3-PRD-3, PROJ-3-PRD-4, PROJ-3-PRD-5.

## Technische Anforderungen
- The port foundation must avoid dynamic plugin-framework semantics.
- Capability states and outcome labels must be stable enough for CLI, API, UI compatibility, and test assertions.
