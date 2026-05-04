# PROJ-3 Wave 1 Implementation Plan

**Goal:** Establish the typed capability foundation and shared review/readiness vocabulary without changing public behavior.
**Architecture Reference:** `6_plan/PROJ-3-architecture.md`
**PRDs involved:** PROJ-3-PRD-1

---

## Wave Position

- **Previous waves:** None.
- **Next waves:** Wave 2, Wave 3, Wave 4, Wave 5 depend on these shared contracts.

## Dependency Analysis Reference

The PROJ-wide dependency graph is:

- Wave 1: PROJ-3-PRD-1-US-1, US-2, US-3, US-4, US-5. These define IDs, ports, preflight terminology, review envelope shape, and outcome meanings.
- Wave 2: PROJ-3-PRD-2-US-1, US-2, US-3, US-4, US-5 and PROJ-3-PRD-1-US-6. These depend on Wave 1 contracts and move workspace orchestration/context/readiness onto capability-shaped results.
- Wave 3: PROJ-3-PRD-3-US-1, US-2, US-3, US-4, US-5, US-6. These depend on Wave 1 contracts and Wave 2 workspace context.
- Wave 4: PROJ-3-PRD-4-US-1, US-2, US-3, US-4, US-5. These depend on Wave 1 review envelopes, Wave 2 context, and Wave 3 Sonar lifecycle ownership.
- Wave 5: PROJ-3-PRD-5-US-1, US-2, US-3, US-4, US-5. These depend on all previous waves because CLI/update readiness must expose the final capability behavior.

## User Stories in this Wave

| US ID | Scope | Agent Type | Complexity | Can start when |
|---|---|---|---|---|
| PROJ-3-PRD-1-US-1 | backend | backend-implementer | sonnet | immediately |
| PROJ-3-PRD-1-US-2 | backend | backend-implementer | opus (shared architecture contracts) | immediately |
| PROJ-3-PRD-1-US-3 | backend | backend-implementer | sonnet | immediately |
| PROJ-3-PRD-1-US-4 | backend | backend-implementer | opus (review envelope contract) | immediately |
| PROJ-3-PRD-1-US-5 | backend | backend-implementer | sonnet | immediately |

All user stories in a wave run in parallel (unless otherwise noted). Coordinate changes to `apps/engine/src/core/capabilities/types.ts`; whoever lands first should keep the exports additive and the other stories should rebase.

---

## PROJ-3-PRD-1-US-1: Als Maintainer moechte ich stabile Capability-IDs haben um Integrationen konsistent zu erkennen
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-1: The capability IDs are a closed set for this PROJ: `git`, `github`, `sonar`, and `coderabbit`.
- [ ] AC-2: Capability-aware JSON output includes `capabilityId` using one of the closed-set IDs.
- [ ] AC-3: No separate alias is introduced for the same capability in CLI, review, or workspace preflight output.

### Task 1.1: Capability Identity Contract
**Fulfills:** AC-1, AC-2, AC-3

**Files:**
- Create: `apps/engine/src/core/capabilities/types.ts`
- Create: `apps/engine/src/core/capabilities/index.ts`
- Modify: `apps/engine/src/core/workspaces.ts`
- Test: `apps/engine/test/capabilitiesFoundation.test.ts`

**What to build:** Define `CapabilityId` as the closed set `git | github | sonar | coderabbit`, export a runtime `CAPABILITY_IDS` list and an `isCapabilityId` guard, and add tests that reject aliases such as `sonarcloud`, `gh`, and `cr` for capability-aware JSON contracts.

**TDD cycle:**
- RED: test that the exported closed set has exactly four IDs and that invalid aliases fail the guard.
- GREEN: implement the shared identity module and export it through the existing engine workspace/core barrel.
- REFACTOR: standard cleanup.
- COMMIT: `feat(PROJ-3-PRD-1): implement capability identity contract`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-3-PRD-1-US-2: Als Maintainer moechte ich explizite Ports statt eines Plugin-Frameworks haben um die Architektur schnell zu verstehen
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-4: The foundation defines the allowed port categories: availability, preflight, enable, connect, audit, repair, and review.
- [ ] AC-5: A capability can omit ports that do not apply to its role.
- [ ] AC-6: The architecture does not require a dynamic plugin lifecycle or generic plugin registration flow.

### Task 2.1: Explicit Port Types
**Fulfills:** AC-4, AC-5, AC-6

**Files:**
- Modify: `apps/engine/src/core/capabilities/types.ts`
- Create: `apps/engine/src/core/capabilities/registry.ts`
- Modify: `apps/engine/src/core/capabilities/index.ts`
- Test: `apps/engine/test/capabilitiesFoundation.test.ts`

**What to build:** Add typed optional port categories for availability, preflight, enable, connect, audit, repair, and review. Provide a static registry helper that accepts explicit capability definitions and rejects unknown IDs/ports at compile time without runtime plugin discovery.

**TDD cycle:**
- RED: test with static capability definitions where Git implements availability/preflight, Sonar implements enable/audit/repair/review, and CodeRabbit omits audit/repair.
- GREEN: implement explicit types and a no-discovery registry builder.
- REFACTOR: keep the registry free of dynamic filesystem/package scanning.
- COMMIT: `feat(PROJ-3-PRD-1): implement explicit capability ports`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-3-PRD-1-US-3: Als Maintainer moechte ich Availability und Preflight unterscheiden um billige Verfuegbarkeit nicht mit detaillierter Readiness zu vermischen
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-7: Availability is defined as a cheap local capability participation check.
- [ ] AC-8: Preflight is defined as detailed readiness/context reporting.
- [ ] AC-9: Normal missing, disabled, and not-configured states are returned as data from preflight, not treated as exceptional control flow.

### Task 3.1: Availability And Preflight Result Types
**Fulfills:** AC-7, AC-8, AC-9

**Files:**
- Modify: `apps/engine/src/core/capabilities/types.ts`
- Test: `apps/engine/test/capabilitiesFoundation.test.ts`

**What to build:** Add shared availability and preflight result types that represent cheap participation and detailed readiness separately. Include data states for `ready`, `missing`, `disabled`, `not_configured`, `warning`, and `failed` with user-facing reasons where required.

**TDD cycle:**
- RED: test that a missing optional capability can be represented as preflight data with a reason and no thrown exception.
- GREEN: implement the typed result unions and helper constructors.
- REFACTOR: standard cleanup.
- COMMIT: `feat(PROJ-3-PRD-1): implement availability preflight types`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-3-PRD-1-US-4: Als Review-Orchestrator moechte ich eine gemeinsame Review-Huelle haben um Tools parallel darstellen zu koennen ohne Tool-Semantik zu verlieren
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-10: The review envelope includes capability identity, lifecycle/phase, outcome, blocking indicator, summary, and artifact references.
- [ ] AC-11: The review outcome states are exactly `ran`, `skipped`, `failed`, `not_configured`, and `not_meaningful`.
- [ ] AC-12: Sonar-specific gate/scope/coverage data is not forced into CodeRabbit's result shape.
- [ ] AC-13: CodeRabbit-specific diff/finding data is not forced into Sonar's result shape.

### Task 4.1: Review Capability Envelope
**Fulfills:** AC-10, AC-11, AC-12, AC-13

**Files:**
- Modify: `apps/engine/src/core/capabilities/types.ts`
- Modify: `apps/engine/src/review/types.ts`
- Test: `apps/engine/test/capabilitiesFoundation.test.ts`

**What to build:** Define a shared `ReviewCapabilityEnvelope` with `capabilityId`, phase/lifecycle, closed-set outcome, `blocking`, `summary`, `reason` for non-ran outcomes, artifact references, and an optional typed tool result. Preserve Sonar and CodeRabbit result payloads as separate domain types.

**TDD cycle:**
- RED: test the envelope requires capability identity/outcome/blocking/summary/artifacts and rejects outcomes outside the closed set.
- GREEN: implement the envelope and adapt review type exports without changing runtime adapters yet.
- REFACTOR: keep existing `CodeRabbitResult` and `SonarCloudResult` domain fields intact.
- COMMIT: `feat(PROJ-3-PRD-1): implement review capability envelope`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-3-PRD-1-US-5: Als Review-Orchestrator moechte ich Review-Outcomes eindeutig unterscheiden um skipped, failed und not meaningful nicht zu vermischen
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-14: `ran` means the capability completed and produced a meaningful tool-specific result.
- [ ] AC-15: `skipped` means the capability was intentionally not attempted because the flow or policy said not to run it.
- [ ] AC-16: `not_configured` means required local configuration, credentials, CLI setup, or project metadata is absent.
- [ ] AC-17: `failed` means the capability was attempted and encountered an execution or service failure.
- [ ] AC-18: `not_meaningful` means the capability could be reached but the available input or produced artifacts cannot support a meaningful assessment for this run.

### Task 5.1: Review Outcome Classifiers
**Fulfills:** AC-14, AC-15, AC-16, AC-17, AC-18

**Files:**
- Modify: `apps/engine/src/core/capabilities/types.ts`
- Create: `apps/engine/src/core/capabilities/reviewOutcome.ts`
- Modify: `apps/engine/src/core/capabilities/index.ts`
- Test: `apps/engine/test/capabilitiesFoundation.test.ts`

**What to build:** Add named helper constructors or classifiers for each review outcome meaning so adapters in later waves can map disabled, missing configuration, command failures, and no-diff cases consistently.

**TDD cycle:**
- RED: test each outcome helper produces the expected outcome and requires a reason for non-ran states.
- GREEN: implement the classifiers and export them.
- REFACTOR: standard cleanup.
- COMMIT: `feat(PROJ-3-PRD-1): implement review outcome classifiers`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -
