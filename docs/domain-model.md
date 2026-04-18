# Domain Model

Kernentitaeten des aktuellen MVP:

- `Item`: Board-Container und fachlicher Einstiegspunkt
- `Concept`: Ergebnis des Brainstormings pro Item-Version
- `Project`: importierter Arbeitsstrang aus dem Concept
- `UserStory`: strukturierte Requirements pro Project
- `ArchitecturePlan`: freizugebender Architekturstand pro Project
- `ImplementationPlan`: reviewbares Umsetzungsartefakt pro Project
- `Wave`: geordneter Ausfuehrungsslice innerhalb eines `ImplementationPlan`
- `WaveStory`: Zuordnung einer `UserStory` zu genau einer `Wave`
- `WaveStoryDependency`: explizite Story-zu-Story-Abhaengigkeit innerhalb eines Project-Plans
- `ProjectExecutionContext`: persistierter, wiederverwendbarer Ausfuehrungskontext pro Project
- `WaveExecution`: Laufzeitversuch fuer genau eine `Wave`
- `WaveStoryTestRun`: vorgeschalteter TDD-Testvorbereitungsversuch fuer genau eine `WaveStory`
- `TestAgentSession`: Session-Metadaten eines konkreten Test-Writer-Laufs
- `WaveStoryExecution`: Laufzeitversuch fuer genau eine `WaveStory`
  mit direkter Referenz auf den konkret verwendeten `WaveStoryTestRun`
- `ExecutionAgentSession`: Session-Metadaten eines konkreten Worker-Laufs
- `VerificationRun`: strukturierter Verifikationsstand fuer Story- oder Wave-Ausfuehrung
  mit explizitem `mode` (`basic` oder `ralph`)
- `StoryReviewRun`: bounded technischer Reviewversuch fuer genau eine `WaveStoryExecution`
- `StoryReviewFinding`: strukturierter technischer Finding-Record eines Story-Reviews
- `StoryReviewAgentSession`: Session-Metadaten des konkreten Story-Review-Workers
- `QaRun`: projektweiter QA-Versuch nach komplett abgeschlossener Execution
- `QaFinding`: strukturierter projektweiter QA-Finding-Record mit Severity, Evidence und Repro-Schritten
- `QaAgentSession`: Session-Metadaten des konkreten QA-Workers
- `DocumentationRun`: projektweiter Dokumentationsversuch nach QA
- `DocumentationAgentSession`: Session-Metadaten des konkreten Dokumentations-Workers
- optional spaeter `WaveParallelGroup`: fachliche Kennzeichnung fuer sicher parallel ausfuehrbare Story-Gruppen innerhalb einer Wave

Die Entitaeten leben im Domain-Layer und werden nicht aus CLI-Kommandos heraus modelliert.

Wichtig:

- Die Planning-Schicht soll Parallelisierbarkeit fachlich beschreiben.
- Die Execution-Schicht entscheidet die konkrete Laufzeitorchestrierung engine-seitig.
- Die TDD-Schicht erzwingt `test_preparation` vor `implementation`.
- Die Ralph-Schicht erzwingt AC-by-AC-Verifikation nach der Implementierung.
- Die Story-Review-Schicht erzwingt einen bounded technischen Review nach Ralph und vor finaler Story-Completion.
- Die QA-Schicht erzwingt einen projektweiten integrierten Check nach vollstaendig abgeschlossener Story-Execution.
- Die Dokumentations-Schicht erzeugt danach den finalen lesbaren Project-Report aus persistierter Wahrheit.
- Worker-Rollen sind Registry und Ausfuehrungsprofil, aber nicht der Scheduler.
