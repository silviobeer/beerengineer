# Output Contracts

Strukturierte JSON-Ausgaben werden mit `zod` validiert:

- `projects.json`: Liste importierbarer `Projects`
- `stories.json`: Liste importierbarer `UserStories`
- `architecture-plan.json`: importierbarer `ArchitecturePlan`

Vorbereiteter naechster Ausbau:

- `implementation-plan.json`: `ImplementationPlan` mit 1..n Waves, Story-Zuordnung pro Project und optionalen Parallel-Gruppen pro Wave

Wenn Markdown vorhanden ist, das JSON aber nicht valide ist, wird der Run auf `review_required` gesetzt.
