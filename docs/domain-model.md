# Domain Model

Kernentitaeten des MVP:

- `Item`: Board-Container und fachlicher Einstiegspunkt
- `Concept`: Ergebnis des Brainstormings pro Item-Version
- `Project`: importierter Arbeitsstrang aus dem Concept
- `UserStory`: strukturierte Requirements pro Project
- `ArchitecturePlan`: freizugebender Architekturstand pro Project

Die Entitaeten leben im Domain-Layer und werden nicht aus CLI-Kommandos heraus modelliert.

Geplanter naechster Ausbau nach dem aktuellen MVP-Schnitt:

- `ImplementationPlan`: reviewbares Umsetzungsartefakt pro Project
- `Wave`: geordneter Ausfuehrungsslice innerhalb eines `ImplementationPlan`
- `WaveStory`: Zuordnung einer `UserStory` zu genau einer `Wave`
- `WaveStoryDependency`: explizite Story-zu-Story-Abhaengigkeit innerhalb eines Project-Plans
- optional spaeter `WaveParallelGroup`: fachliche Kennzeichnung fuer sicher parallel ausfuehrbare Story-Gruppen innerhalb einer Wave

Wichtig:

- Die Planning-Schicht soll Parallelisierbarkeit fachlich beschreiben.
- Die Execution-Schicht soll erst spaeter die konkrete Subagent-Zuteilung und Laufzeitorchestrierung entscheiden.
