# PROJ-3 Wave 2 Implementation Plan

**Goal:** Route workspace preflight and registration through capability-shaped Git, GitHub, Sonar, and CodeRabbit results while preserving API/UI compatibility.
**Architecture Reference:** `6_plan/PROJ-3-architecture.md`
**PRDs involved:** PROJ-3-PRD-1, PROJ-3-PRD-2

---

## Wave Position

- **Previous waves:** Wave 1 - completed before this wave starts.
- **Next waves:** Wave 3 and Wave 4 consume the workspace capability context; Wave 5 exposes it in CLI/update readiness.

## User Stories in this Wave

| US ID | Scope | Agent Type | Complexity | Can start when |
|---|---|---|---|---|
| PROJ-3-PRD-2-US-1 | backend | backend-implementer | opus (API compatibility and orchestration) | Wave 1 complete |
| PROJ-3-PRD-2-US-2 | backend | backend-implementer | opus (Git/GitHub context boundary) | Wave 1 complete |
| PROJ-3-PRD-2-US-3 | backend | backend-implementer | sonnet | Wave 1 complete |
| PROJ-3-PRD-2-US-4 | backend | backend-implementer | opus (frozen API contract) | Wave 1 complete |
| PROJ-3-PRD-2-US-5 | backend | backend-implementer | opus (registration ownership boundary) | Wave 1 complete |
| PROJ-3-PRD-1-US-6 | backend | backend-implementer | sonnet | Wave 1 complete |

All user stories in a wave run in parallel (unless otherwise noted). Coordinate edits to `apps/engine/src/core/workspaces/sonar.ts`, `apps/engine/src/core/workspaces/registration.ts`, and `apps/engine/src/types/workspace.ts`.

---

## PROJ-3-PRD-2-US-1: Als Operator moechte ich beim Workspace-Onboarding klare Capability-Checks sehen um Integrationsstatus zu verstehen
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-1: Workspace preflight reports capability-oriented status for `git`, `github`, `sonar`, and `coderabbit`.
- [ ] AC-2: Each capability result includes a stable `capabilityId`.
- [ ] AC-3: Each non-ready capability result includes a human-readable reason.
- [ ] AC-4: Existing setup/settings UI flows continue to receive API-compatible behavior based on `apps/engine/src/api/openapi.json`, `docs/api-contract.md`, and current UI consumers.

### Task 1.1: Capability Preflight Projection
**Fulfills:** AC-1, AC-2, AC-3, AC-4

**Files:**
- Create: `apps/engine/src/core/capabilities/workspacePreflight.ts`
- Modify: `apps/engine/src/core/workspaces/sonar.ts`
- Modify: `apps/engine/src/types/workspace.ts`
- Modify: `apps/engine/src/api/openapi.json`
- Modify: `docs/api-contract.md`
- Test: `apps/engine/test/workspaceCapabilities.test.ts`
- Test: `apps/engine/test/apiIntegration.test.ts`

**What to build:** Add a `capabilities` array to `WorkspacePreflightReport` while keeping existing `git`, `github`, `gh`, `sonar`, and `coderabbit` fields intact. Every capability entry uses `capabilityId`, status/outcome, summary, and reason for non-ready states.

**TDD cycle:**
- RED: test `runWorkspacePreflight()` returns capability entries for all four IDs and old fields still exist.
- GREEN: implement the projection and update OpenAPI/prose only for additive response fields.
- REFACTOR: keep `gh` as GitHub tool context, not a separate capability ID.
- COMMIT: `feat(PROJ-3-PRD-2): implement capability preflight projection`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-3-PRD-2-US-2: Als Maintainer moechte ich Git und GitHub getrennt sehen um lokale Pflichtlogik nicht mit Provider-Logik zu vermischen
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-5: Local Git readiness is treated as mandatory for normal workspace and story flows.
- [ ] AC-6: GitHub/`gh` readiness is mandatory only for GitHub-dependent actions.
- [ ] AC-7: Sonar and CodeRabbit do not inspect Git remotes or `gh` state directly.
- [ ] AC-8: GitHub provider context is passed to optional capabilities through capability context, not re-derived by them.

### Task 2.1: Workspace Capability Context
**Fulfills:** AC-5, AC-6, AC-7, AC-8

**Files:**
- Create: `apps/engine/src/core/capabilities/workspaceContext.ts`
- Modify: `apps/engine/src/core/workspaces/sonar.ts`
- Modify: `apps/engine/src/core/workspaces/registration.ts`
- Test: `apps/engine/test/workspaceCapabilities.test.ts`

**What to build:** Build a single workspace capability context from Git, GitHub remote, and `gh` checks. Pass that context into Sonar and CodeRabbit readiness/registration helpers so optional capabilities consume provider facts instead of re-reading remotes or `gh`.

**TDD cycle:**
- RED: test Sonar/CodeRabbit helpers receive provider context and do not call remote parsing helpers directly.
- GREEN: implement context construction and wire it through preflight/registration.
- REFACTOR: keep Git mandatory failures separate from GitHub-dependent action failures.
- COMMIT: `feat(PROJ-3-PRD-2): implement workspace capability context`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-3-PRD-2-US-3: Als Operator moechte ich Workspace-Registration trotz optionaler Tool-Probleme abschliessen koennen um nicht durch Sonar/CodeRabbit blockiert zu werden
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-9: Missing or not-configured Sonar does not roll back an otherwise valid workspace registration.
- [ ] AC-10: Missing or not-configured CodeRabbit does not roll back an otherwise valid workspace registration.
- [ ] AC-11: Optional capability failures are visible in the registration result.
- [ ] AC-12: Required Git failures prevent the relevant workspace flow from presenting a successful state.

### Task 3.1: Optional Capability Registration Outcomes
**Fulfills:** AC-9, AC-10, AC-11, AC-12

**Files:**
- Modify: `apps/engine/src/core/workspaces/registration.ts`
- Modify: `apps/engine/src/types/workspace.ts`
- Test: `apps/engine/test/workspaceCapabilities.test.ts`

**What to build:** Ensure registration results include optional capability outcomes and next actions when Sonar or CodeRabbit is missing/not configured/failed, while Git failures still return unsuccessful registration results.

**TDD cycle:**
- RED: test a valid Git workspace registers with Sonar/CodeRabbit missing and includes visible optional capability outcomes; test failed Git init returns failure.
- GREEN: implement outcome collection in registration.
- REFACTOR: avoid duplicating warning text between registration and preflight projection.
- COMMIT: `feat(PROJ-3-PRD-2): implement optional registration outcomes`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-3-PRD-2-US-4: Als UI-Consumer moechte ich bestehende Setup- und Settings-Flows weiter nutzen koennen um keinen UI-Ausfall durch den Refactor zu bekommen
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-13: Existing documented setup/settings API contracts are treated as frozen by default.
- [ ] AC-14: A contract-breaking API update is allowed only with an explicit architecture or wave-plan decision and the corresponding UI compatibility adjustment.
- [ ] AC-15: Existing setup/settings flows do not require new UI surfaces to remain functional.

### Task 4.1: API Compatibility Regression Net
**Fulfills:** AC-13, AC-14, AC-15

**Files:**
- Modify: `apps/engine/test/apiIntegration.test.ts`
- Modify: `apps/engine/test/setupApi.test.ts`
- Modify: `apps/engine/src/api/openapi.json`
- Modify: `docs/api-contract.md`

**What to build:** Add regression coverage proving existing setup/settings/workspace preflight shapes still parse for UI consumers. The wave makes only additive API contract updates; any discovered breaking need must stop and create an explicit plan amendment before implementation.

**TDD cycle:**
- RED: test existing documented response fields and new additive capability fields together.
- GREEN: update OpenAPI/prose for additive fields and keep route handlers compatible.
- REFACTOR: standard cleanup.
- COMMIT: `feat(PROJ-3-PRD-2): preserve workspace api compatibility`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-3-PRD-2-US-5: Als Maintainer moechte ich Workspace-Registration als Orchestrierung sehen um Tool-Spezialfaelle leichter entfernen zu koennen
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-16: Workspace registration delegates Git, GitHub, Sonar, and CodeRabbit behavior to capability-owned ports.
- [ ] AC-17: Git writes only local Git state required by the workspace flow.
- [ ] AC-18: GitHub writes only GitHub/remote state and related metadata.
- [ ] AC-19: Sonar writes only Sonar-owned artifacts and metadata.
- [ ] AC-20: CodeRabbit writes only CodeRabbit-owned configuration artifacts.

### Task 5.1: Registration Capability Delegation
**Fulfills:** AC-16, AC-17, AC-18, AC-19, AC-20

**Files:**
- Create: `apps/engine/src/core/capabilities/gitCapability.ts`
- Create: `apps/engine/src/core/capabilities/githubCapability.ts`
- Create: `apps/engine/src/core/capabilities/sonarCapability.ts`
- Create: `apps/engine/src/core/capabilities/coderabbitCapability.ts`
- Modify: `apps/engine/src/core/workspaces/registration.ts`
- Modify: `apps/engine/src/core/capabilities/index.ts`
- Test: `apps/engine/test/workspaceCapabilities.test.ts`

**What to build:** Move registration-specific Git, GitHub, Sonar, and CodeRabbit behavior behind explicit capability-owned functions while keeping `registerWorkspace()` as the orchestrator.

**TDD cycle:**
- RED: test registration calls capability delegates and each delegate writes only its owned artifacts.
- GREEN: extract existing behavior into capability modules without changing output.
- REFACTOR: remove duplicate special-case logic from registration.
- COMMIT: `feat(PROJ-3-PRD-2): implement registration capability delegation`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-3-PRD-1-US-6: Als Update-Mode-Betreiber moechte ich gemeinsame Readiness-Begriffe nutzen um GitHub/Sonar-Checks nicht doppelt unterschiedlich zu pflegen
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-19: Shared readiness terminology covers Git, GitHub, and Sonar as needed by workspace and update-mode flows.
- [ ] AC-20: Update-mode remains separate from workspace capability orchestration.
- [ ] AC-21: Update-mode GitHub/Sonar readiness uses shared helper behavior where workspace and update-mode meanings overlap.
- [ ] AC-22: If a shared helper cannot be used because update-mode has different inputs, the architecture documents the difference while preserving the shared readiness meaning.

### Task 6.1: Shared Readiness Terminology For Update Mode
**Fulfills:** AC-19, AC-20, AC-21, AC-22

**Files:**
- Create: `apps/engine/src/core/capabilities/readiness.ts`
- Modify: `apps/engine/src/core/updateMode/readiness.ts`
- Test: `apps/engine/test/updateMode.test.ts`
- Test: `apps/engine/test/workspaceCapabilities.test.ts`

**What to build:** Introduce shared readiness labels/helpers used by both workspace capability preflight and update-mode checks where semantics overlap. Keep update-mode inputs local to `core/updateMode` and document any helper that cannot be shared in code comments near the decision.

**TDD cycle:**
- RED: test update-mode GitHub/Sonar readiness uses the same shared labels but does not call workspace preflight orchestration.
- GREEN: implement shared helpers and refactor update readiness to use them.
- REFACTOR: standard cleanup.
- COMMIT: `feat(PROJ-3-PRD-1): align update readiness terms`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -
