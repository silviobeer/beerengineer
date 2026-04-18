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
- `WaveStoryExecution`: Laufzeitversuch fuer genau eine `WaveStory`
- `ExecutionAgentSession`: Session-Metadaten eines konkreten Worker-Laufs
- `VerificationRun`: strukturierter Verifikationsstand fuer Story- oder Wave-Ausfuehrung
- optional spaeter `WaveParallelGroup`: fachliche Kennzeichnung fuer sicher parallel ausfuehrbare Story-Gruppen innerhalb einer Wave

Die Entitaeten leben im Domain-Layer und werden nicht aus CLI-Kommandos heraus modelliert.

Wichtig:

- Die Planning-Schicht soll Parallelisierbarkeit fachlich beschreiben.
- Die Execution-Schicht entscheidet die konkrete Laufzeitorchestrierung engine-seitig.
- Worker-Rollen sind Registry und Ausfuehrungsprofil, aber nicht der Scheduler.
