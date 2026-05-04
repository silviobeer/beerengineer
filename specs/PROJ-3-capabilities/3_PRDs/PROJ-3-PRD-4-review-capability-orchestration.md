# PROJ-3-PRD-4: Review Capability Orchestration

## Status: Planned

## User Stories

### US-1: Als Operator moechte ich pro Review-Capability sehen was gelaufen ist um Review-Ergebnisse zu verstehen
**Given** a story reaches review  
**When** review tools are evaluated  
**Then** Sonar and CodeRabbit return review capability envelopes  
**And** each envelope explains whether the capability outcome is `ran`, `skipped`, `failed`, `not_configured`, or `not_meaningful`

**Acceptance Criteria:**
- [ ] AC-1: Sonar review output includes a review capability envelope with `capabilityId=sonar`.
- [ ] AC-2: CodeRabbit review output includes a review capability envelope with `capabilityId=coderabbit`.
- [ ] AC-3: The outcome uses the closed review outcome set from PROJ-3-PRD-1.
- [ ] AC-4: Each non-ran or non-meaningful outcome includes a reason and artifact reference where available.

### US-2: Als Maintainer moechte ich Tool-Ergebnisse spezifisch behalten um keine Sonar- oder CodeRabbit-Semantik zu verlieren
**Given** Sonar and CodeRabbit produce different result types  
**When** the review orchestrator stores or presents results  
**Then** it uses a common envelope only for orchestration  
**And** the underlying domain result remains tool-specific

**Acceptance Criteria:**
- [ ] AC-5: Sonar scanner, quality gate, condition, coverage, and scope details remain Sonar-specific.
- [ ] AC-6: CodeRabbit diff and finding details remain CodeRabbit-specific.
- [ ] AC-7: The common envelope does not replace domain-specific result structures.
- [ ] AC-8: Review artifacts preserve enough detail for tool-specific debugging.

### US-3: Als Story-Runner moechte ich nicht durch optionale Review-Tools blockiert werden um produktive Runs trotz fehlender Integrationen fortzusetzen
**Given** Sonar or CodeRabbit is disabled, missing, not configured, or not meaningful  
**When** a story review runs  
**Then** the story flow does not block solely because of that optional capability state  
**And** the review result documents the skipped or degraded capability

**Acceptance Criteria:**
- [ ] AC-9: Missing Sonar scanner/token/config does not block the story flow by itself.
- [ ] AC-10: Missing CodeRabbit CLI or no diff basis does not block the story flow by itself.
- [ ] AC-11: Optional capability issues are recorded in review artifacts.
- [ ] AC-12: Required non-review failures can still block according to their own flow rules.

### US-4: Als Maintainer moechte ich Review-Orchestrierung von Tool-Adaptern trennen um weitere Review-Tools spaeter sauber hinzufuegen zu koennen
**Given** review orchestration runs multiple review capabilities  
**When** a review capability is invoked  
**Then** the orchestrator handles scheduling, common envelope collection, and artifact summary  
**And** each capability adapter owns its own tool-specific execution and result mapping

**Acceptance Criteria:**
- [ ] AC-13: Review orchestration invokes Sonar and CodeRabbit through review capability ports.
- [ ] AC-14: Tool adapters own tool-specific command, remote, scan, or parsing behavior.
- [ ] AC-15: The review summary can list all review capability outcomes without knowing tool internals.
- [ ] AC-16: Fake review capabilities can be used to test orchestration independently from real tools.

### US-5: Als UI/API-Consumer moechte ich Review-Ergebnisdaten kompatibel lesen koennen um bestehende Oberflaechen nicht zu brechen
**Given** existing UI/API consumers read review status and artifacts  
**When** review output becomes capability-oriented  
**Then** existing consumers keep working or are minimally adjusted with the API change  
**And** capability outcome data is exposed consistently in JSON

**Acceptance Criteria:**
- [ ] AC-17: Existing review API/OpenAPI behavior is treated as frozen by default.
- [ ] AC-18: Any contract-breaking API update needed for capability envelopes requires an explicit architecture or wave-plan decision and is paired with UI compatibility work in the same wave.
- [ ] AC-19: JSON output includes stable `capabilityId` and outcome values.
- [ ] AC-20: Human-readable review summaries identify skipped or not-meaningful capabilities clearly.

## Edge Cases
- Sonar scanner is installed but config is invalid and scan execution fails: Sonar outcome is `failed` with details, not a generic tool failure.
- Sonar quality gate fails after a successful scan: Sonar domain result preserves gate details.
- CodeRabbit CLI is missing: CodeRabbit outcome is `not_configured` with a remedy.
- CodeRabbit has no diff basis after review was selected for the story: CodeRabbit outcome is `not_meaningful`.
- CodeRabbit is disabled by policy: CodeRabbit outcome is `skipped`.
- One review capability fails unexpectedly while another runs: each envelope records its own outcome.

## Abhaengigkeiten
- Benoetigt: PROJ-3-PRD-1.
- Benoetigt fuer Sonar adapter: PROJ-3-PRD-3.
- Related to workspace context: PROJ-3-PRD-2.

## Technische Anforderungen
- Review outcome states must be a closed set before implementation.
- Review artifacts must preserve tool-specific detail.
- Optional review capability states must be visible without blocking story flow.

## QA Test Results

Date: 2026-05-04

Result: PASS. QA verified Sonar and CodeRabbit review envelopes, preservation of domain-specific results, optional non-blocking semantics, review capability port orchestration, and API compatibility.

Evidence:
- `npm test --workspace=@beerengineer/engine`: PASS (795 tests; 793 passed, 2 skipped, 0 failed).
- Focused review/capability tests: PASS (73 tests, 0 failures).
- Manual security review found no token leakage in review artifacts; missing Sonar token writes only a redacted reason.

AC status: AC-1 through AC-20 PASS.

Browser/UI note: review API/OpenAPI compatibility was tested through integration and contract tests; no new browser UI was introduced.
