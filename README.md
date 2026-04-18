# Beerengineer

CLI-first Workflow-Engine fuer einen modularen, agentengetriebenen Entwicklungsprozess. Der erste MVP bildet den fachlichen Flow von `Item` bis `ArchitecturePlan` lokal und reproduzierbar ab.

## Status

Der dokumentierte MVP-Schnitt bis zur Architekturphase ist umgesetzt:

- TypeScript/Vitest/SQLite/Drizzle-Basis
- Domainmodell und Gate-Logik
- Persistenzschema und Repositories
- dateibasiertes Artefakt- und Output-Contract-System
- StageRuns mit Prompt- und Skill-Snapshots
- lokaler CLI-Adapter
- CLI-Happy-Path von `item:create` bis `architecture:approve`

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
- [Verification](docs/verification.md)
