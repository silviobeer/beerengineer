# MVP Scope

Enthalten:

- lokaler CLI-Happy-Path bis in die erste deterministische Execution-Schicht
- dateibasierte Prompts und Skills
- StageRun-Snapshotting
- SQLite-Persistenz
- strukturierter Artefakt-Import
- stabile Codes fuer `Item`, `Project`, `UserStory` und `AcceptanceCriterion`
- eigene `AcceptanceCriterion`-Records als Grundlage fuer spaetere QA
- schlanke projektbezogene Requirements-, Architektur- und Planning-Stages
- persistierte Planning-Schicht mit `ImplementationPlan`, `Wave`, `WaveStory` und `WaveStoryDependency`
- persistierte Runtime-Schicht mit `ProjectExecutionContext`, `WaveExecution`, `WaveStoryTestRun`, `TestAgentSession`, `WaveStoryExecution`, `ExecutionAgentSession` und `VerificationRun`
- CLI-Kommandos fuer `execution:start`, `execution:tick`, `execution:show` und `execution:retry`
- engine-erzwungene TDD-Reihenfolge `test_preparation -> implementation -> verification`

Bewusst nicht enthalten:

- UI
- Multi-Provider-Adapter
- freie LLM-Orchestrierung oder agentenseitige Scheduling-Entscheidungen
- ausformulierte Review-/QA-Pipelines ueber den ersten Execution-Core hinaus
- Session-Recovery ueber Prozessneustarts hinaus
- Legacy-Kompatibilitaet fuer wegwerfbare Baumodus-Datenbanken
