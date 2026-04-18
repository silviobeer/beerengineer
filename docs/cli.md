# CLI

Wichtige MVP-Kommandos:

```bash
npm run cli -- item:create --title "My Item" --description "..."
npm run cli -- brainstorm:start --item-id <itemId>
npm run cli -- concept:approve --concept-id <conceptId>
npm run cli -- project:import --item-id <itemId>
npm run cli -- requirements:start --item-id <itemId> --project-id <projectId>
npm run cli -- stories:approve --project-id <projectId>
npm run cli -- architecture:start --item-id <itemId> --project-id <projectId>
npm run cli -- architecture:approve --project-id <projectId>
npm run cli -- planning:start --item-id <itemId> --project-id <projectId>
npm run cli -- planning:approve --project-id <projectId>
npm run cli -- execution:start --project-id <projectId>
npm run cli -- execution:tick --project-id <projectId>
npm run cli -- execution:show --project-id <projectId>
npm run cli -- execution:retry --wave-story-execution-id <waveStoryExecutionId>
```

Optional:

```bash
npm run cli -- item:show --item-id <itemId>
npm run cli -- runs:list --item-id <itemId>
npm run cli -- run:show --run-id <runId>
npm run cli -- run:retry --run-id <runId>
npm run cli -- artifacts:list --item-id <itemId>
npm run cli -- sessions:list --run-id <runId>
```

Fehler werden als JSON auf `stderr` mit `error.code` und `error.message` ausgegeben.

## Stable Codes

- `item:create` vergibt automatisch einen stabilen Item-Code wie `ITEM-0001`
- importierte Projekte erhalten abgeleitete Codes wie `ITEM-0001-P01`
- importierte User Stories erhalten abgeleitete Codes wie `ITEM-0001-P01-US01`
- importierte Acceptance Criteria erhalten abgeleitete Codes wie `ITEM-0001-P01-US01-AC01`
- importierte Waves erhalten stabile Wave-Codes innerhalb des Projekts wie `W01`, `W02`

Die Codes werden von der Engine vergeben und bleiben stabil, auch wenn Titel spaeter angepasst werden.

## Requirements Import

Beim `requirements:start`-Pfad werden heute zwei fachliche Ebenen persistiert:

- `UserStory`
- `AcceptanceCriterion`

Acceptance Criteria werden nicht mehr nur als Story-JSON mitgefuehrt, sondern als eigene Records gespeichert und koennen spaeter direkt fuer QA oder Verifikation verwendet werden.

## Planning Import

Beim `planning:start`-Pfad werden heute vier fachliche Ebenen persistiert:

- `ImplementationPlan`
- `Wave`
- `WaveStory`
- `WaveStoryDependency`

Die Planning-Stage ordnet jede Story genau einer Wave zu und speichert explizite Story-Abhaengigkeiten fuer spaetere parallele Execution.

## Execution Runtime

Beim `execution:start`- und `execution:tick`-Pfad werden heute zusaetzlich diese Runtime-Ebenen genutzt:

- `ProjectExecutionContext`
- `WaveExecution`
- `WaveStoryTestRun`
- `TestAgentSession`
- `WaveStoryExecution`
- `ExecutionAgentSession`
- `VerificationRun`

Die Engine entscheidet dabei deterministisch:

- welche Wave aktiv ist
- welche Stories ausfuehrbar sind
- dass jede Story zuerst einen `test-writer`-Lauf durchlaeuft
- welche Worker-Rolle verwendet wird
- wann Retry oder Review erforderlich ist

Der Worker selbst bekommt nur den bounded Story-Kontext plus gespeicherte Business- und Repo-Snapshots.

Im aktuellen TDD-Schnitt gilt:

- `execution:start` und `execution:tick` erzwingen zuerst `test_preparation`, dann `implementation`
- `execution:show` zeigt den neuesten `WaveStoryTestRun` und die zugehoerigen `TestAgentSession`-Records pro Story
- Implementierung startet nur, wenn der neueste Test-Run fuer die Story `completed` ist
- der Implementer bekommt den gespeicherten Test-Run-Output als Eingabe und arbeitet gegen diese vorab erzeugten Testziele
- jede `WaveStoryExecution` referenziert den konkret verwendeten Test-Run direkt ueber `testPreparationRunId`
