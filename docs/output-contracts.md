# Output Contracts

Strukturierte JSON-Ausgaben werden mit `zod` validiert:

- `projects.json`: Liste importierbarer `Projects`
- `stories.json`: Liste importierbarer `UserStories`
- `architecture-plan.json`: importierbarer `ArchitecturePlan`
- `implementation-plan.json`: `ImplementationPlan` mit 1..n Waves, Story-Zuordnung, Story-Abhaengigkeiten und optionalen Parallel-Gruppen pro Project
- `story-execution.json`: strukturierter Worker-Output fuer genau eine `WaveStoryExecution` mit Summary, betroffenen Dateien, Testlaeufen, Notizen und Blockern

Wenn Markdown vorhanden ist, das JSON aber nicht valide ist, wird der Run auf `review_required` gesetzt.
