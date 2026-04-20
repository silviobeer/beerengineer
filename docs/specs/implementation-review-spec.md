# Implementation Review Spec

## Ziel

Implementation Review aggregiert Qualitaetssignale fuer einen
`wave_story_execution`-Schritt und schreibt das Ergebnis als generischen
`implementation`-Review-Run in den Review Core.

## Inputs

Der Review bezieht aktuell Signale aus:

- Story Review Findings
- Verification-Signalen
  - basic verification
  - Ralph verification
  - app verification
- `CodeRabbit`-Knowledge ueber den Quality-Knowledge-Pfad
- `SonarCloud`

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

## Trigger

Aktuell existieren zwei Trigger-Arten:

- manuell:
  - `implementation-review:start --wave-story-execution-id ...`
- automatisch:
  - nach abgeschlossenem Story Review als advisory Run mit
    `automationLevel = auto_comment`

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

Implementation Review ist derzeit bewusst schlank:

- advisory und gate-fokussierte Aggregation
- keine automatische Remediation
- keine eigene LLM-Review-Orchestrierung
- keine externe Refresh-Automation fuer Sonar/CodeRabbit

Diese Schritte bleiben moegliche Ausbaupunkte auf Basis des Review Cores.
