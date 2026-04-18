# Beerengineer

CLI-first Workflow-Engine fuer einen modularen, agentengetriebenen Entwicklungsprozess. Der aktuelle MVP bildet den fachlichen Flow von `Item` bis in die projektweite QA-Schicht lokal und reproduzierbar ab.

## Status

Der dokumentierte MVP-Schnitt bis zur projektweiten QA-Schicht ist umgesetzt:

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
- dateibasiertes Artefakt- und Output-Contract-System
- StageRuns mit Prompt- und Skill-Snapshots
- ausformulierte Skills und System-Prompts fuer `brainstorm`, `requirements`, `architecture` und `planning`
- lokaler CLI-Adapter
- CLI-Happy-Path von `item:create` bis `qa:start` mit vorgeschalteter TDD-Testvorbereitung, Ralph-AC-Verifikation, Story-Review und projektweiter QA

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
npm run db:migrate -- ./var/data/beerengineer.sqlite
npm run db:check -- ./var/data/beerengineer.sqlite
```

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
test/
  e2e/
  fixtures/
  integration/
  unit/
```

## Dokumentation

- [Teststrategie](docs/testing-strategy.md)

Weitere Details:

- [Architektur](docs/architecture.md)
- [CLI](docs/cli.md)
- [Prompts und Skills](docs/prompts-and-skills.md)
- [MVP Scope](docs/mvp-scope.md)
- [Verification](docs/verification.md)

## Code Review

CodeRabbit ist lokal verfuegbar und dieses Repo bringt eine Projekt-Instruktionsdatei mit:

```bash
npm run review
npm run review:agent
```

Die zusaetzlichen Review-Instruktionen liegen in [coderabbit.md](coderabbit.md).
