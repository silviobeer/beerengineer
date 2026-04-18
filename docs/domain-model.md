# Domain Model

Kernentitaeten des MVP:

- `Item`: Board-Container und fachlicher Einstiegspunkt
- `Concept`: Ergebnis des Brainstormings pro Item-Version
- `Project`: importierter Arbeitsstrang aus dem Concept
- `UserStory`: strukturierte Requirements pro Project
- `ArchitecturePlan`: freizugebender Architekturstand pro Project

Die Entitaeten leben im Domain-Layer und werden nicht aus CLI-Kommandos heraus modelliert.
