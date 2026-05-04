# PROJ-3-PRD-2: Workspace Capability Orchestration

## Status: Planned

## User Stories

### US-1: Als Operator moechte ich beim Workspace-Onboarding klare Capability-Checks sehen um Integrationsstatus zu verstehen
**Given** I register or inspect a workspace  
**When** workspace preflight runs  
**Then** Git, GitHub, Sonar, and CodeRabbit are reported as capability results  
**And** each result explains whether the capability is ready, unavailable, disabled, not configured, or only warning-level

**Acceptance Criteria:**
- [ ] AC-1: Workspace preflight reports capability-oriented status for `git`, `github`, `sonar`, and `coderabbit`.
- [ ] AC-2: Each capability result includes a stable `capabilityId`.
- [ ] AC-3: Each non-ready capability result includes a human-readable reason.
- [ ] AC-4: Existing setup/settings UI flows continue to receive API-compatible behavior based on `apps/engine/src/api/openapi.json`, `docs/api-contract.md`, and current UI consumers.

### US-2: Als Maintainer moechte ich Git und GitHub getrennt sehen um lokale Pflichtlogik nicht mit Provider-Logik zu vermischen
**Given** a workspace flow needs local repository state  
**When** the flow checks Git state  
**Then** local Git readiness is evaluated through the Git capability  
**And** GitHub remote/`gh` readiness is evaluated through the GitHub capability

**Acceptance Criteria:**
- [ ] AC-5: Local Git readiness is treated as mandatory for normal workspace and story flows.
- [ ] AC-6: GitHub/`gh` readiness is mandatory only for GitHub-dependent actions.
- [ ] AC-7: Sonar and CodeRabbit do not inspect Git remotes or `gh` state directly.
- [ ] AC-8: GitHub provider context is passed to optional capabilities through capability context, not re-derived by them.

### US-3: Als Operator moechte ich Workspace-Registration trotz optionaler Tool-Probleme abschliessen koennen um nicht durch Sonar/CodeRabbit blockiert zu werden
**Given** Git and required workspace preconditions are satisfied  
**When** Sonar or CodeRabbit is disabled, missing, or not configured during workspace registration  
**Then** workspace registration still succeeds  
**And** the optional capability problem is documented with a next action

**Acceptance Criteria:**
- [ ] AC-9: Missing or not-configured Sonar does not roll back an otherwise valid workspace registration.
- [ ] AC-10: Missing or not-configured CodeRabbit does not roll back an otherwise valid workspace registration.
- [ ] AC-11: Optional capability failures are visible in the registration result.
- [ ] AC-12: Required Git failures prevent the relevant workspace flow from presenting a successful state.

### US-4: Als UI-Consumer moechte ich bestehende Setup- und Settings-Flows weiter nutzen koennen um keinen UI-Ausfall durch den Refactor zu bekommen
**Given** the UI consumes workspace/setup/settings API responses  
**When** workspace preflight and registration become capability-oriented  
**Then** existing endpoints, response field names, and documented OpenAPI shapes remain valid by default
**And** any contract-breaking change requires an explicit architecture or wave-plan decision and ships with the UI compatibility update in the same wave

**Acceptance Criteria:**
- [ ] AC-13: Existing documented setup/settings API contracts are treated as frozen by default.
- [ ] AC-14: A contract-breaking API update is allowed only with an explicit architecture or wave-plan decision and the corresponding UI compatibility adjustment.
- [ ] AC-15: Existing setup/settings flows do not require new UI surfaces to remain functional.

### US-5: Als Maintainer moechte ich Workspace-Registration als Orchestrierung sehen um Tool-Spezialfaelle leichter entfernen zu koennen
**Given** workspace registration needs integration data  
**When** registration invokes integration checks or setup work  
**Then** it calls capability ports rather than owning tool-specific behavior  
**And** tool-owned writes stay within each capability's write boundary

**Acceptance Criteria:**
- [ ] AC-16: Workspace registration delegates Git, GitHub, Sonar, and CodeRabbit behavior to capability-owned ports.
- [ ] AC-17: Git writes only local Git state required by the workspace flow.
- [ ] AC-18: GitHub writes only GitHub/remote state and related metadata.
- [ ] AC-19: Sonar writes only Sonar-owned artifacts and metadata.
- [ ] AC-20: CodeRabbit writes only CodeRabbit-owned configuration artifacts.

## Edge Cases
- Git is missing or the path is not a repo: mandatory workspace flows fail clearly.
- GitHub remote is missing: local workspace flows continue, GitHub-dependent flows report the missing provider context.
- `gh` is unavailable: GitHub actions that need `gh` fail clearly while local detection continues where possible.
- Sonar enablement fails during registration: registration succeeds if required preconditions pass and records the Sonar issue.
- Existing UI expects old readiness fields: compatibility is preserved; if a break is unavoidable, the API contract and UI consumer are updated in the same wave by explicit decision.

## Abhaengigkeiten
- Benoetigt: PROJ-3-PRD-1.
- Ermoeglicht: PROJ-3-PRD-3, PROJ-3-PRD-5.

## Technische Anforderungen
- Workspace orchestration must preserve existing setup/settings API compatibility unless deliberately changed with matching UI compatibility work.
- Mandatory and optional capability failures must be distinguishable in user-facing output and tests.

## QA Test Results

Date: 2026-05-04

Result: PASS. QA verified additive workspace capability projection, Git/GitHub boundary handling, optional Sonar/CodeRabbit registration behavior, existing API compatibility, and capability-owned write boundaries.

Evidence:
- `npm test --workspace=@beerengineer/engine`: PASS (795 tests; 793 passed, 2 skipped, 0 failed).
- Focused capability tests: PASS (73 tests, 0 failures).
- Security/regression checks in the full suite covered CSRF, setup/settings compatibility, allowedRoots purge safety, and API contract preservation.

AC status: AC-1 through AC-20 PASS.

Browser/UI note: no new setup/settings UI surface was added; compatibility was tested through API contract and integration tests.

### QA Rerun — 2026-05-04

Result: PASS. Rerun verified AC-1 through AC-20 remain green, including optional capability registration behavior and API compatibility.

Evidence:
- `npm run typecheck --workspace=@beerengineer/engine`: PASS.
- `npm run test:file --workspace=@beerengineer/engine -- test/capabilityCli.test.ts test/sonarCapability.test.ts test/reviewCapabilities.test.ts test/workspaceCapabilities.test.ts`: PASS (75 tests, 0 failures).
- `npm test --workspace=@beerengineer/engine`: PASS (798 tests; 796 passed, 2 skipped, 0 failed).

Browser/UI note: no new setup/settings UI surface was added.
