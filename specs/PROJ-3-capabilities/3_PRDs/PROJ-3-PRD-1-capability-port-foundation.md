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
- [ ] AC-11: The review outcome states are exactly `ran`, `skipped`, `failed`, `not_configured`, and `not_meaningful`.
- [ ] AC-12: Sonar-specific gate/scope/coverage data is not forced into CodeRabbit's result shape.
- [ ] AC-13: CodeRabbit-specific diff/finding data is not forced into Sonar's result shape.

### US-5: Als Review-Orchestrator moechte ich Review-Outcomes eindeutig unterscheiden um skipped, failed und not meaningful nicht zu vermischen
**Given** a review capability cannot produce a normal useful result
**When** the orchestrator records its outcome
**Then** the outcome uses the closed set consistently
**And** each non-ran state has a distinct meaning

**Acceptance Criteria:**
- [ ] AC-14: `ran` means the capability completed and produced a meaningful tool-specific result.
- [ ] AC-15: `skipped` means the capability was intentionally not attempted because the flow or policy said not to run it.
- [ ] AC-16: `not_configured` means required local configuration, credentials, CLI setup, or project metadata is absent.
- [ ] AC-17: `failed` means the capability was attempted and encountered an execution or service failure.
- [ ] AC-18: `not_meaningful` means the capability could be reached but the available input or produced artifacts cannot support a meaningful assessment for this run.

### US-6: Als Update-Mode-Betreiber moechte ich gemeinsame Readiness-Begriffe nutzen um GitHub/Sonar-Checks nicht doppelt unterschiedlich zu pflegen
**Given** update-mode checks beerengineer self-update readiness  
**When** it reports GitHub or Sonar readiness  
**Then** it uses shared readiness terminology and helper behavior  
**And** it does not become a workspace-capability orchestration consumer

**Acceptance Criteria:**
- [ ] AC-19: Shared readiness terminology covers Git, GitHub, and Sonar as needed by workspace and update-mode flows.
- [ ] AC-20: Update-mode remains separate from workspace capability orchestration.
- [ ] AC-21: Update-mode GitHub/Sonar readiness uses shared helper behavior where workspace and update-mode meanings overlap.
- [ ] AC-22: If a shared helper cannot be used because update-mode has different inputs, the architecture documents the difference while preserving the shared readiness meaning.

## Edge Cases
- A capability is disabled: preflight reports a disabled state as data.
- A capability is not configured: preflight reports not configured with a user-facing reason.
- A capability's input workspace is unreadable: the caller receives a failure appropriate to the flow rather than a false ready state.
- A review tool returns a domain result that has no matching field in the shared envelope: the tool-specific result preserves it.
- A tool has input but no meaningful assessment can be made: the outcome is `not_meaningful`, not `ran`.
- Update-mode needs GitHub/Sonar readiness but no workspace is selected: shared readiness helpers still work without workspace orchestration.

## Abhaengigkeiten
- Benoetigt: PROJ-3 concept approval.
- Enables: PROJ-3-PRD-2, PROJ-3-PRD-3, PROJ-3-PRD-4, PROJ-3-PRD-5.

## Technische Anforderungen
- The port foundation must avoid dynamic plugin-framework semantics.
- Capability states and outcome labels must be stable enough for CLI, API, UI compatibility, and test assertions.

## QA Test Results

Date: 2026-05-04

Result: PASS. QA verified the closed capability IDs, explicit non-plugin port model, availability/preflight distinction, review outcome vocabulary, and update-readiness separation through the full engine suite plus focused capability tests.

Evidence:
- `npm test --workspace=@beerengineer/engine`: PASS (795 tests; 793 passed, 2 skipped, 0 failed).
- `npm run test:file --workspace=@beerengineer/engine -- test/capabilityCli.test.ts test/sonarCapability.test.ts test/reviewCapabilities.test.ts test/workspaceCapabilities.test.ts`: PASS (73 tests, 0 failures).

AC status: AC-1 through AC-22 PASS.

Browser/UI note: no frontend route or component was added for this PRD; browser E2E is not applicable.
