# MVP Scope

Enthalten:

- lokaler CLI-Happy-Path bis in die projektweite QA-Schicht
- dateibasierte Prompts und Skills
- StageRun-Snapshotting
- SQLite-Persistenz
- strukturierter Artefakt-Import
- stabile Codes fuer `Item`, `Project`, `UserStory` und `AcceptanceCriterion`
- eigene `AcceptanceCriterion`-Records als Grundlage fuer spaetere QA
- schlanke projektbezogene Requirements-, Architektur- und Planning-Stages
- persistierte Planning-Schicht mit `ImplementationPlan`, `Wave`, `WaveStory` und `WaveStoryDependency`
- persistierte Runtime-Schicht mit `ProjectExecutionContext`, `WaveExecution`, `WaveStoryTestRun`, `TestAgentSession`, `WaveStoryExecution`, `ExecutionAgentSession` und `VerificationRun`
- zweistufige Story-Verifikation mit `basic`- und `ralph`-Runs nach jeder Implementierung
- bounded Story-Review-Schicht innerhalb der Execution-Pipeline
- projektweite QA-Schicht mit `QaRun`, `QaFinding` und `QaAgentSession`
- CLI-Kommandos fuer `execution:start`, `execution:tick`, `execution:show` und `execution:retry`
- CLI-Kommandos fuer `qa:start`, `qa:show` und `qa:retry`
- engine-erzwungene Reihenfolge `test_preparation -> implementation -> verification_basic -> verification_ralph -> story_review -> qa`

Bewusst nicht enthalten:

- UI
- Multi-Provider-Adapter
- freie LLM-Orchestrierung oder agentenseitige Scheduling-Entscheidungen
- Dokumentations-Schritt
- Session-Recovery ueber Prozessneustarts hinaus
- Legacy-Kompatibilitaet fuer wegwerfbare Baumodus-Datenbanken
