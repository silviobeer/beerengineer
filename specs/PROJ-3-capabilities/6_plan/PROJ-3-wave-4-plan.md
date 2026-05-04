# PROJ-3 Wave 4 Implementation Plan

**Goal:** Collect Sonar and CodeRabbit review results through shared capability envelopes while preserving tool-specific details and existing review consumers.
**Architecture Reference:** `6_plan/PROJ-3-architecture.md`
**PRDs involved:** PROJ-3-PRD-4

---

## Wave Position

- **Previous waves:** Wave 3 - completed before this wave starts.
- **Next waves:** Wave 5 exposes review capability data consistently in CLI/update-facing JSON.

## User Stories in this Wave

| US ID | Scope | Agent Type | Complexity | Can start when |
|---|---|---|---|---|
| PROJ-3-PRD-4-US-1 | backend | backend-implementer | sonnet | Wave 3 complete |
| PROJ-3-PRD-4-US-2 | backend | backend-implementer | sonnet | Wave 3 complete |
| PROJ-3-PRD-4-US-3 | backend | backend-implementer | opus (story-flow blocking semantics) | Wave 3 complete |
| PROJ-3-PRD-4-US-4 | backend | backend-implementer | opus (orchestrator/adapter split) | Wave 3 complete |
| PROJ-3-PRD-4-US-5 | backend | backend-implementer | opus (API/OpenAPI compatibility) | Wave 3 complete |

All user stories in a wave run in parallel (unless otherwise noted). Coordinate edits to `apps/engine/src/review/types.ts`, `apps/engine/src/review/registry.ts`, and `apps/engine/src/stages/execution/ralphStoryReview.ts`.

---

## PROJ-3-PRD-4-US-1: Als Operator moechte ich pro Review-Capability sehen was gelaufen ist um Review-Ergebnisse zu verstehen
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-1: Sonar review output includes a review capability envelope with `capabilityId=sonar`.
- [ ] AC-2: CodeRabbit review output includes a review capability envelope with `capabilityId=coderabbit`.
- [ ] AC-3: The outcome uses the closed review outcome set from PROJ-3-PRD-1.
- [ ] AC-4: Each non-ran or non-meaningful outcome includes a reason and artifact reference where available.

### Task 1.1: Review Envelope Runtime Output
**Fulfills:** AC-1, AC-2, AC-3, AC-4

**Files:**
- Modify: `apps/engine/src/review/types.ts`
- Modify: `apps/engine/src/review/coderabbit.ts`
- Modify: `apps/engine/src/review/sonarcloud.ts`
- Modify: `apps/engine/src/review/registry.ts`
- Test: `apps/engine/test/reviewCapabilities.test.ts`

**What to build:** Wrap Sonar and CodeRabbit adapter results in review capability envelopes containing stable capability IDs, closed outcomes, blocking intent, summaries, reasons, and artifact references.

**TDD cycle:**
- RED: test disabled/missing/no-diff/failed/running review outputs contain envelope fields and closed outcomes.
- GREEN: implement envelope production in adapters or adapter mappers.
- REFACTOR: keep existing artifact writes unchanged.
- COMMIT: `feat(PROJ-3-PRD-4): implement review capability envelopes`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-3-PRD-4-US-2: Als Maintainer moechte ich Tool-Ergebnisse spezifisch behalten um keine Sonar- oder CodeRabbit-Semantik zu verlieren
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-5: Sonar scanner, quality gate, condition, coverage, and scope details remain Sonar-specific.
- [ ] AC-6: CodeRabbit diff and finding details remain CodeRabbit-specific.
- [ ] AC-7: The common envelope does not replace domain-specific result structures.
- [ ] AC-8: Review artifacts preserve enough detail for tool-specific debugging.

### Task 2.1: Preserve Tool-Specific Results
**Fulfills:** AC-5, AC-6, AC-7, AC-8

**Files:**
- Modify: `apps/engine/src/review/types.ts`
- Modify: `apps/engine/src/review/registry.ts`
- Test: `apps/engine/test/reviewCapabilities.test.ts`

**What to build:** Keep `SonarCloudResult` and `CodeRabbitResult` domain payloads available under tool-specific fields and artifact files while adding envelope metadata for orchestration.

**TDD cycle:**
- RED: test Sonar conditions/coverage/scope fields and CodeRabbit finding/diff fields are still present after envelope wrapping.
- GREEN: update registry summary shape to preserve domain results.
- REFACTOR: standard cleanup.
- COMMIT: `feat(PROJ-3-PRD-4): preserve review domain results`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-3-PRD-4-US-3: Als Story-Runner moechte ich nicht durch optionale Review-Tools blockiert werden um produktive Runs trotz fehlender Integrationen fortzusetzen
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-9: Missing Sonar scanner/token/config does not block the story flow by itself.
- [ ] AC-10: Missing CodeRabbit CLI or no diff basis does not block the story flow by itself.
- [ ] AC-11: Optional capability issues are recorded in review artifacts.
- [ ] AC-12: Required non-review failures can still block according to their own flow rules.

### Task 3.1: Optional Review Non-Blocking Semantics
**Fulfills:** AC-9, AC-10, AC-11, AC-12

**Files:**
- Modify: `apps/engine/src/stages/execution/ralphStoryReview.ts`
- Modify: `apps/engine/src/stages/execution/ralphStoryLoop.ts`
- Modify: `apps/engine/src/review/registry.ts`
- Test: `apps/engine/test/ralphRuntime.test.ts`
- Test: `apps/engine/test/reviewCapabilities.test.ts`

**What to build:** Treat optional Sonar/CodeRabbit `not_configured`, `skipped`, `failed`, and `not_meaningful` as visible review outcomes that do not block story flow solely by being unavailable. Preserve existing blocking for required non-review failures.

**TDD cycle:**
- RED: test missing Sonar token, missing CodeRabbit CLI, and no diff basis produce artifacts and pass/partial flow rather than blocking solely on optional state.
- GREEN: update story review summary and outcome logic.
- REFACTOR: keep required failure logic outside review capability handling.
- COMMIT: `feat(PROJ-3-PRD-4): implement optional review semantics`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-3-PRD-4-US-4: Als Maintainer moechte ich Review-Orchestrierung von Tool-Adaptern trennen um weitere Review-Tools spaeter sauber hinzufuegen zu koennen
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-13: Review orchestration invokes Sonar and CodeRabbit through review capability ports.
- [ ] AC-14: Tool adapters own tool-specific command, remote, scan, or parsing behavior.
- [ ] AC-15: The review summary can list all review capability outcomes without knowing tool internals.
- [ ] AC-16: Fake review capabilities can be used to test orchestration independently from real tools.

### Task 4.1: Review Capability Orchestrator
**Fulfills:** AC-13, AC-14, AC-15, AC-16

**Files:**
- Modify: `apps/engine/src/review/registry.ts`
- Modify: `apps/engine/src/review/types.ts`
- Modify: `apps/engine/src/core/capabilities/sonarCapability.ts`
- Modify: `apps/engine/src/core/capabilities/coderabbitCapability.ts`
- Test: `apps/engine/test/reviewCapabilities.test.ts`
- Test: `apps/engine/test/ralphRuntime.test.ts`

**What to build:** Make review orchestration schedule review capability ports and collect envelopes, while adapters own command execution, scanner/gate calls, parsing, and artifacts. Preserve fake adapter injection for orchestration tests.

**TDD cycle:**
- RED: test fake review capabilities can drive registry behavior without real Sonar/CodeRabbit binaries.
- GREEN: wire registry to review capability ports.
- REFACTOR: remove orchestrator knowledge of tool internals from summaries.
- COMMIT: `feat(PROJ-3-PRD-4): implement review capability orchestrator`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-3-PRD-4-US-5: Als UI/API-Consumer moechte ich Review-Ergebnisdaten kompatibel lesen koennen um bestehende Oberflaechen nicht zu brechen
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-17: Existing review API/OpenAPI behavior is treated as frozen by default.
- [ ] AC-18: Any contract-breaking API update needed for capability envelopes requires an explicit architecture or wave-plan decision and is paired with UI compatibility work in the same wave.
- [ ] AC-19: JSON output includes stable `capabilityId` and outcome values.
- [ ] AC-20: Human-readable review summaries identify skipped or not-meaningful capabilities clearly.

### Task 5.1: Review API Compatibility Projection
**Fulfills:** AC-17, AC-18, AC-19, AC-20

**Files:**
- Modify: `apps/engine/src/stages/execution/ralphStoryReview.ts`
- Modify: `apps/engine/src/types/review.ts`
- Modify: `apps/engine/src/api/openapi.json`
- Modify: `docs/api-contract.md`
- Test: `apps/engine/test/apiIntegration.test.ts`
- Test: `apps/engine/test/reviewCapabilities.test.ts`

**What to build:** Add capability envelope data to review JSON/artifacts in an additive way. Keep existing gate and reviewer fields available for UI/API consumers, and update human-readable summaries for skipped/not-meaningful capabilities.

**TDD cycle:**
- RED: test existing review artifact consumers still find old fields and new JSON includes `capabilityId`/outcome.
- GREEN: implement additive projection and contract docs.
- REFACTOR: standard cleanup.
- COMMIT: `feat(PROJ-3-PRD-4): preserve review api compatibility`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -
