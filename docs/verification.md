# Verification

## Wave 1

- `npm run build`
- `npm run lint`
- `npm test`
- `npm run db:migrate -- ./var/data/wave1-check.sqlite`

Ergebnis: erfolgreich. Die technische Basis fuer weitere Waves steht.

## MVP Abschluss

- `npm run build`
- `npm run lint`
- `npm test`

Ergebnis: erfolgreich.

Abgedeckt:

- 11 Testdateien
- 20 Tests
- Unit-, Integrations- und CLI-End-to-End-Abdeckung fuer den MVP-Happy-Path bis `Architecture`

## Stabilisierung

- Diagnose-Kommandos fuer Runs, Artefakte und Sessions
- strukturierte CLI-Fehlerausgaben mit Exit-Code `1`
- Retry-Pfad fuer `review_required` und `failed`
- idempotente Freigaben und Projektimporte
- `npm run build`
- `npm run lint`
- `npm test`

Ergebnis: erfolgreich.

Aktueller Stand:

- 11 Testdateien
- 25 gruene Tests

## Review-Runde

Umgesetzt:

- Adapter-Timeout und Signalbehandlung
- transaktionale Vor- und Nachbloecke rund um `StageRun`-Schreibvorgaenge
- echte Verknuepfung von Input-Artefakten fuer Downstream-Runs
- schlankere Query-Pfade fuer Existenz- und Latest-Lookups
- nachvollziehbare `review_required`-Ursachen in `stage_runs.error_message`
- CWD-unabhaengige Aufloesung von Prompt-/Skill-Pfaden

Zurueckgestellt:

- [Review Follow-Ups](review-follow-ups.md)

## Record Codes

Umgesetzt:

- stabile fachliche Codes fuer `Item`, `Project` und `UserStory`
- hierarchische Ableitung `ITEM-0001`, `ITEM-0001-P01`, `ITEM-0001-P01-US01`
- Engine-seitige Vergabe bei Persistierung statt LLM-seitiger Nummernhoheit
- finales Basisschema ohne Legacy-Baumodus-Migrationspfad
- CLI-, Repository-, Workflow- und E2E-Abdeckung fuer den neuen Codepfad
- Anpassung des lokalen Demo-Adapters und des Brainstorm-Prompts auf das Code-Modell

Verifiziert mit:

- `npm run build`
- `npm run lint`
- `npm test`

## Prompt And Skill Completion

Umgesetzt:

- ausformulierte System-Prompts fuer `brainstorm`, `requirements` und `architecture`
- ausformulierte Skills fuer `brainstorm-facilitation`, `project-extraction`, `requirements-engineer` und `architecture`
- saubere Trennung zwischen Stage-Contract in den Prompts und Arbeitsweise in den Skills
- aktiver Stage-Wiring ueber `runProfiles`

Verifiziert mit:

- `npm run build`
- `npm test`

Aktueller Stand:

- 12 Testdateien
- 28 gruene Tests

## Acceptance Criteria Model

Umgesetzt:

- `AcceptanceCriterion` als eigene persistierte Entity
- eigene Tabelle `acceptance_criteria`
- hierarchische Codes wie `ITEM-0001-P01-US01-AC01`
- keine Legacy-JSON-Ablage mehr an `user_stories`
- Import der Requirements-Ausgabe schreibt Stories und ACs als getrennte Records

Verifiziert mit:

- `npm run build`
- `npm run lint`
- `npm test`

## Execution Core

Umgesetzt:

- deterministischer Execution-Loop fuer den neuesten freigegebenen `ImplementationPlan`
- persistierte Runtime-Entities fuer Kontext, Wave-Execution, Story-Execution, Agent-Session und Verifikation
- CLI-Kommandos `execution:start`, `execution:tick`, `execution:show` und `execution:retry`
- gespeicherte Business- und Repo-Context-Snapshots pro `WaveStoryExecution`
- engine-seitige Worker-Rollenwahl statt LLM-gesteuerter Orchestrierung
- lokaler Demo-Adapter fuer bounded Story-Ausfuehrung
- Workflow-, Repository- und E2E-Abdeckung fuer den neuen Execution-Pfad

Verifiziert mit:

- `npm run build`
- `npm run lint`
- `npm test`

Aktueller Stand:

- 12 Testdateien
- 30 gruene Tests
- Live-CLI-Durchlauf von `item:create` bis `execution:tick` erfolgreich

Live verifiziert:

- beide Waves einer freigegebenen Planung wurden sequentiell auf `completed` gebracht
- pro `WaveStoryExecution` wurden Business- und Repo-Snapshots gespeichert
- pro Story wurde ein `ExecutionAgentSession`-Record angelegt
- pro Story wurde ein `VerificationRun` mit Status `passed` gespeichert

## TDD Slice

Umgesetzt:

- engine-erzwungene Reihenfolge `test_preparation -> implementation -> verification`
- neue Runtime-Entities `WaveStoryTestRun` und `TestAgentSession`
- eigener strukturierter Test-Writer-Output vor jeder Implementierung
- gespeicherte Business- und Repo-Snapshots auch fuer Testvorbereitungslaeufe
- Implementer bekommt den neuesten erfolgreichen Test-Run als Eingabekontext
- `execution:show` surfacet Test-Run- und Test-Session-Informationen pro Story

Verifiziert mit:

- `npm run lint`
- `npm run build`
- `npm test`

Aktueller Stand:

- 12 Testdateien
- 30 gruene Tests

Live verifiziert:

- jede ausgefuehrte Story erzeugt zuerst einen `WaveStoryTestRun`
- pro Test-Run wird ein `TestAgentSession`-Record gespeichert
- die anschliessende Implementierung nutzt den gespeicherten Test-Run-Output als vorab definiertes Ziel
