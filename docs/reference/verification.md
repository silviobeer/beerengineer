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

- persistierte Pre-Execution-Readiness-Gate mit `ExecutionReadinessRun`, `ExecutionReadinessFinding` und `ExecutionReadinessAction`
- deterministischer Execution-Loop fuer den neuesten freigegebenen `ImplementationPlan`
- persistierte Runtime-Entities fuer Kontext, Wave-Execution, Story-Execution, Agent-Session und Verifikation
- CLI-Kommandos `execution:readiness:start`, `execution:readiness:show`, `execution:start`, `execution:tick`, `execution:show` und `execution:retry`
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

- `execution:start` blockiert jetzt vor `test_preparation`, wenn Workspace oder Story-Worktree nicht lauffaehig sind
- deterministic readiness remediation versucht aktuell sichere UI-Dependency-Reparaturen ueber `npm --prefix apps/ui install`
- beide Waves einer freigegebenen Planung wurden sequentiell auf `completed` gebracht
- pro `WaveStoryExecution` wurden Business- und Repo-Snapshots gespeichert
- pro Story wurde ein `ExecutionAgentSession`-Record angelegt
- pro Story wurde ein `VerificationRun` mit Status `passed` gespeichert

Noch nicht enthalten:

- bounded LLM-Remediation fuer nichttriviale Readiness-Probleme wie Build-/Config-Fehler
- optionaler LLM-Remediator ist insgesamt noch nicht implementiert; produktiv aktiv ist derzeit nur die deterministische Readiness-Remediation

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

## Ralph Verification Slice

Umgesetzt:

- `VerificationRun.mode` mit `basic` und `ralph`
- engine-erzwungene Reihenfolge `test_preparation -> implementation -> verification_basic -> verification_ralph`
- AC-by-AC-Ralph-Output mit strukturierten Verdicts, Evidence und Notes
- `execution:show` surfacet den neuesten `basic`- und `ralph`-Run pro Story
- eine Story wird erst `completed`, wenn der neueste Ralph-Run `passed` ist

Verifiziert mit:

- `npm run lint`
- `npm run build`
- `npm test`

Aktueller Stand:

- 12 Testdateien
- 33 gruene Tests

## UI Browser Setup

Umgesetzt:

- `apps/ui` besitzt jetzt eine eigene Playwright-Konfiguration
- E2E-Skripte leben direkt in `apps/ui/package.json`
- die UI-E2E-Tests starten ihren Next-Webserver reproduzierbar selbst
- die projektlokale Browser-Konfiguration spiegelt jetzt denselben zentralen
  Workspace-Contract wie die Engine
- fuer den `default`-Workspace ist das bewusst `127.0.0.1:3100`, damit lokale
  Entwicklungsserver auf `3000` nicht den Setup-Nachweis stoeren

Verifiziert mit:

- `npm --prefix apps/ui run build`
- `npm --prefix apps/ui run test:e2e`

Live zu verifizieren:

- pro erfolgreicher Story liegen jetzt zwei `VerificationRun`-Records vor: `basic` und `ralph`
- Wave-Abschluss haengt explizit am Ralph-Status jeder Story

## Story Review Slice

Umgesetzt:

- neue Runtime-Entities `StoryReviewRun`, `StoryReviewFinding` und `StoryReviewAgentSession`
- engine-erzwungene Reihenfolge `test_preparation -> implementation -> verification_basic -> verification_ralph -> story_review`
- bounded technischer Review pro Story mit Severity-basierten Findings
- `execution:show` surfacet den neuesten Story-Review-Run, dessen Findings und die zugehoerige Review-Session pro Story
- eine Story wird erst `completed`, wenn auch der neueste Story-Review-Run `passed` ist

Verifiziert mit:

- `npm run build`
- `npm test`

Aktueller Stand:

- 12 Testdateien
- 37 gruene Tests

Live zu verifizieren:

- pro erfolgreicher Story liegt jetzt zusaetzlich ein `StoryReviewRun` vor
- Story-Review-Findings werden als eigene Records gespeichert und in `execution:show` sichtbar
- Wave-Abschluss haengt explizit auch am Story-Review-Status jeder Story

## QA Slice

Umgesetzt:

- projektweiter QA-Lauf mit `QaRun`, `QaFinding` und `QaAgentSession`
- paralleler Core-nativer QA-Review-Run mit `reviewKind = qa`
- CLI-Kommandos `qa:start`, `qa:show` und `qa:retry`
- engine-seitige Guards: QA startet nur nach vollstaendig abgeschlossener Execution
- strukturierter `qa.json`-Output mit Summary, Findings, Evidence und Recommendations
- engine-seitige Statusableitung:
  - keine Findings -> `passed`
  - mindestens ein `critical` oder `high` -> `failed`
  - nur `medium` / `low` -> `review_required`
- Retry-Pfad fuer `review_required` und `failed` auf `QaRun`-Ebene

Verifiziert mit:

- `npm run build`
- `npm test`

Aktueller Stand:

- 12 Testdateien
- 50 gruene Tests

Live verifiziert:

- kompletter CLI-Durchlauf bis `qa:start` und `qa:show` erfolgreich
- pro Project wird ein `QaRun` mit gespeichertem Input-Snapshot und strukturierter Summary angelegt
- Findings und QA-Agent-Sessions werden pro Run persistiert
- QA schreibt zusaetzlich Gate-/Finding-Synthese in den generischen Review Core
- erfolgreicher Live-Run gegen `/tmp/beerengineer-live-qa.sqlite`:
  - Item `ITEM-0002`
  - Project `ITEM-0002-P01`
  - `QaRun.status = passed`
  - beide Waves `completed`
  - Item-Endzustand nach zusaetzlicher Documentation: `currentColumn = done`, `phaseStatus = completed`

## Review Core Follow-Up

Umgesetzt:

- `implementation` ist jetzt ein nativer Review-Core-Typ mit Tool-Signalen und
  LLM-Review
- neue LLM-Rollen fuer `implementation`:
  - `implementation_reviewer`
  - `regression_reviewer`
- `implementation-review:start` unterstuetzt jetzt `interactionMode`
  - Default: `auto`
  - optional: `assisted`, `interactive`
- im `auto`-Mode kann `implementation` sichere Story-Review-Remediation direkt
  ausloesen und danach den neuesten Re-Review-Run auswerten
- Story Review schreibt nativ in den Review Core als
  `reviewKind = interactive_story`
- QA schreibt nativ in den Review Core als `reviewKind = qa`
- die alten Mirror-Hooks fuer Story Review und QA wurden entfernt

Verifiziert mit:

- `npm run build`
- `npm test -- --run test/unit/hosted-cli-adapters.test.ts`
- gezielten Integrations-Tests fuer:
  - `implementation`-Review
  - Story-Review-Remediation
  - Core-native QA-Reviews
  - Core-native Planning-Gates

## Documentation Slice

Umgesetzt:

- projektweiter Dokumentationslauf mit `DocumentationRun` und `DocumentationAgentSession`
- CLI-Kommandos `documentation:start`, `documentation:show` und `documentation:retry`
- finale Artefakte `delivery-report` und `delivery-report-data`
- engine-seitige Guards: Dokumentation startet nur nach `QaRun.status = passed | review_required`
- item-phase wird nach erfolgreicher Dokumentation erneut auf `completed` oder `review_required` aufgeloest

Verifiziert mit:

- `npm run build`
- `npm run lint`
- `npm test`

Aktueller Stand:

- 12 Testdateien
- 50 gruene Tests

Autorun und Live-Runs zusaetzlich verifiziert:

- `concept:approve --autorun` laeuft in einem frischen CLI-Live-Run bis `item_completed`
- Endzustand danach: `currentColumn = done`, `phaseStatus = completed`
- QA endet auf `passed`
- Documentation endet auf `completed`
- `hasStaleDocumentation = false`
- reproduzierbarer CLI-Live-Run mit
  `--adapter-script-path` und `--workspace-root` bestaetigt den Auto-Remediation-Pfad
- dabei wurden automatische `story_review`-Remediations ausgefuehrt, offene Findings auf `0` reduziert
  und anschliessend wieder in `story/*` bzw. `proj/*` gemergt und bereinigt

## Migration Hardening

Umgesetzt:

- eigene inkrementelle Migration `0001_add_verification_run_mode`
- bestehende Datenbanken erhalten `verification_runs.mode` nachtraeglich statt nur ueber frische Basisschemata
- Testhaertung: Ralph-Integrationstests mutieren nicht mehr `scripts/local-agent.mjs`, sondern verwenden temporaere Adapter-Skripte

Verifiziert mit:

- `npm run build`
- `npm test`
