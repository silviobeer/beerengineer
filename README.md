# Beerengineer

CLI-first Workflow-Engine fuer einen modularen, agentengetriebenen Entwicklungsprozess. Der aktuelle MVP bildet den fachlichen Flow von `Item` bis in die projektweite Dokumentationsschicht lokal und reproduzierbar ab.

## Status

Der dokumentierte MVP-Schnitt bis zur projektweiten Dokumentationsschicht ist umgesetzt:

- TypeScript/Vitest/SQLite/Drizzle-Basis
- Domainmodell und Gate-Logik
- Persistenzschema und Repositories
- stabile Codes fuer `Item`, `Project`, `UserStory` und `AcceptanceCriterion`
- `AcceptanceCriterion` als eigene persistierte Entity fuer spaetere QA-Verwendung
- `ImplementationPlan`, `Wave`, `WaveStory` und `WaveStoryDependency` als persistierte Planungsschicht
- `ProjectExecutionContext`, `WaveExecution`, `WaveStoryTestRun`, `TestAgentSession`, `WaveStoryExecution`, `ExecutionAgentSession` und `VerificationRun` als persistierte Runtime-Schicht
- zweistufige Verifikation pro Story mit `basic`- und `ralph`-Verification-Runs
- bounded Story-Review pro Story-Ausfuehrung mit eigenen Findings und Sessions
- projektweiter QA-Lauf mit `QaRun`, `QaFinding` und `QaAgentSession`
- projektweiter Dokumentationslauf mit `DocumentationRun`, `DocumentationAgentSession` und den Artefakten `delivery-report` / `delivery-report-data`
- dateibasiertes Artefakt- und Output-Contract-System
- StageRuns mit Prompt- und Skill-Snapshots
- ausformulierte Skills und System-Prompts fuer `brainstorm`, `requirements`, `architecture` und `planning`
- lokaler CLI-Adapter
- CLI-Happy-Path von `item:create` bis `documentation:start` mit vorgeschalteter TDD-Testvorbereitung, Ralph-AC-Verifikation, Story-Review, projektweiter QA und finaler Dokumentation

## Voraussetzungen

- Node.js `>= 22`
- npm `>= 10`

## Setup

```bash
npm install
npm test
```

## Wichtige Kommandos

```bash
npm run build
npm run lint
npm run review
npm run test
npm run db:migrate
npm run db:check
```

Standardmaessig liegt die SQLite-DB jetzt in einem update-sicheren
User-Data-Verzeichnis des Betriebssystems. Ein expliziter `--db`-Pfad
ueberschreibt diesen Default weiterhin.

Im Projekt-Workspace gilt jetzt:

- `.beerengineer/` ist reiner Runtime-Zustand und sollte gitignoriert bleiben
- pushbare Delivery-Reports werden unter `docs/delivery-reports/<workspace-key>/` materialisiert

Workspace-spezifische Agent-Strategien lassen sich ueber Runtime-Profile steuern:

- `codex_primary` fuer Codex als primaeren code-lastigen Pfad
- `claude_primary` fuer Claude als primaeren text- und reviewlastigen Pfad

Fuer Browser-/Tooling-Harnesses kann BeerEngineer ausserdem `agent-browser` als MCP-Server fuer `claude`, `cursor`, `opencode` und `codex` materialisieren.

Die effektive Runtime wird aus globalem Default, optionalem User-Override und optionalem Workspace-Profil aufgeloest. Inkompatible gespeicherte Workspace-Profile bleiben dabei sichtbar, blockieren aber die CLI nicht mehr; Recovery laeuft ueber `workspace:runtime:show` und `workspace:runtime:clear-profile`. Details und CLI-Kommandos stehen in [docs/reference/cli.md](docs/reference/cli.md).

## Projektstruktur

```text
src/
  adapters/
  artifacts/
  cli/
  domain/
  persistence/
  schemas/
  services/
  workflow/
prompts/
  system/
skills/
docs/
artifacts/  # generierte app-nahe Ausgaben
.beerengineer/  # engine-interne Laufzeitdaten im App-Workspace
test/
  e2e/
  fixtures/
  integration/
  unit/
```

## Dokumentation

- [Docs Index](docs/README.md)
- [Teststrategie](docs/reference/testing-strategy.md)

Weitere Details:

- [Architektur](docs/reference/architecture.md)
- [CLI](docs/reference/cli.md)
- [Prompts und Skills](docs/reference/prompts-and-skills.md)
- [MVP Scope](docs/reference/mvp-scope.md)
- [Verification](docs/reference/verification.md)

## Code Review

CodeRabbit ist lokal verfuegbar und dieses Repo bringt eine Projekt-Instruktionsdatei mit:

```bash
npm run review
npm run review:agent
```

Die zusaetzlichen Review-Instruktionen liegen in [coderabbit.md](coderabbit.md).
