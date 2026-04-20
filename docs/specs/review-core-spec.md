# Review Core Spec

## Ziel

Der Review Core stellt die gemeinsame Infrastruktur fuer alle Review-Arten
bereit:

- Planning Review
- Interactive Story Review
- Implementation Review
- QA Review

Er kapselt die wiederkehrenden Review-Muster:

- Run-Anlage
- Finding-Persistenz
- Synthesis
- Questions / Assumptions
- `new/open/resolved`
- Vergleich mit dem Vorlaeufer-Run
- Gate-Entscheidungen

## Zentrale Entitaeten

- `review_runs`
- `review_findings`
- `review_syntheses`
- `review_questions`
- `review_assumptions`

Wichtige Felder auf `review_runs`:

- `reviewKind`
- `subjectType`
- `subjectId`
- `subjectStep`
- `status`
- `readiness`
- `automationLevel`
- `requestedMode`
- `actualMode`
- `confidence`
- `gateEligibility`
- `sourceSummaryJson`
- `providersUsedJson`
- `missingCapabilitiesJson`

## Gate-Semantik

Der Core benutzt ein einheitliches Gate-Vokabular:

- `pass`
- `advisory`
- `blocked`
- `needs_human_review`

Ein Run kann als Workflow-Gate wirken, wenn:

- `automationLevel = auto_gate`
- `gateEligibility = advisory`
- der Run nicht als gate-ready gilt

Gate-ready bedeutet aktuell:

- `status = complete`
- `readiness = ready|ready_with_assumptions`

Der Core stellt dafuer `getLatestBlockingRunForGate(...)` bereit.

## Review-Kinds

Aktuell produktiv genutzt:

- `planning`
- `interactive_story`
- `implementation`
- `qa`

## Trigger

Aktuell angebunden:

- Planning Review
  - nach Brainstorm-Promote
  - nach erfolgreichem Architecture-/Planning-Stage-Run
  - vor Story-/Architecture-/Planning-Approval
- Implementation Review
  - automatisch nach abgeschlossenem Story Review
  - manuell ueber CLI
  - als Gate vor `qa:start`
- Interactive Story Review
  - schreibt direkt in den Core
- QA Review
  - schreibt direkt in den Core

## Nicht-Zustaendigkeiten

Der Review Core uebernimmt nicht:

- Planning-Artefakt-Normalisierung
- Story-/Code-Kontextaufbau
- Sonar-/CodeRabbit-spezifische Parsing-Logik
- Remediation-Ausfuehrung selbst

Die geschlossene Remediation-Orchestrierung fuer `implementation` sitzt jetzt im
`ReviewRemediationService`, nutzt aber die Core-Runs als Fuehrungswahrheit.

Diese Logik bleibt in den fachlichen Services oder Provider-Adaptern.
