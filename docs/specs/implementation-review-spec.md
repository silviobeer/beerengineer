# Implementation Review Spec

## Ziel

Implementation Review aggregiert Qualitaetssignale und LLM-Review fuer einen
`wave_story_execution`-Schritt und schreibt das Ergebnis als generischen
`implementation`-Review-Run in den Review Core.

## Inputs

Der Review bezieht aktuell Signale aus:

- LLM-Review-Rollen
  - `implementation_reviewer`
  - `regression_reviewer`
- Story Review Findings
- Verification-Signalen
  - basic verification
  - Ralph verification
  - app verification
- `CodeRabbit`-Knowledge ueber den Quality-Knowledge-Pfad
- `SonarCloud`

Der `interactionMode` fuer `implementation` ist jetzt konfigurierbar:

- `auto` (Default)
- `assisted`
- `interactive`

## Persistenz

Implementation Review nutzt den generischen Review Core als primaeren
Persistenzpfad:

- `review_runs`
- `review_findings`
- `review_syntheses`

Die `sourceSummary` eines Runs enthaelt u. a.:

- `waveStoryExecutionId`
- `storyId`
- `storyCode`
- `projectId`
- `projectCode`
- `waveId`
- `providerIds`
- `filePaths`
- `modules`

## Trigger Und Loop

Aktuell existieren zwei Trigger-Arten:

- manuell:
  - `implementation-review:start --wave-story-execution-id ...`
- automatisch:
  - nach abgeschlossenem Story Review als advisory Run mit
    `automationLevel = auto_comment`

Im `auto`-Mode ist der Step ein geschlossener Review-/Remediation-Loop:

1. Review ausfuehren
2. sichere Story-Review-Findings erkennen
3. bestehende Story-Review-Remediation anstossen
4. Re-Review fuer die Remediation-Execution lesen
5. Gate-Entscheidung auf dem neuesten Core-Run treffen

## Gate-Verhalten

Implementation Review kann mit allen Automation-Levels gestartet werden:

- `manual`
- `auto_suggest`
- `auto_comment`
- `auto_gate`

Workflow-Wirkung aktuell:

- `qa:start` prueft fuer die Story-Executions des Projekts den jeweils neuesten
  `implementation`-Run
- nur Runs mit
  - `automationLevel = auto_gate`
  - `gateEligibility = advisory`
  - und nicht gate-ready
    blockieren QA

## Provider-Normalisierung

Alle Quellen werden auf ein gemeinsames Finding-Schema gemappt:

- `sourceSystem`
- `reviewerRole`
- `findingType`
- `normalizedSeverity`
- `sourceSeverity`
- `title`
- `detail`
- `evidence`
- optional:
  - `filePath`
  - `line`
  - `fieldPath`

## Aktueller Scope

Implementation Review ist jetzt ein nativer Review-Core-Nutzer mit:

- Tool-Signalen plus LLM-Review
- konfigurierbarem `interactionMode`
- sicherem Auto-Loop ueber bestehende Story-Review-Remediation

Nicht enthalten bleiben weiterhin:

- externe Refresh-Automation fuer Sonar/CodeRabbit
- allgemeine Code-Fix-Strategien jenseits der bestehenden bounded Story-Remediation
