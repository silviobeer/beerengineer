# Output Contracts

Strukturierte JSON-Ausgaben werden mit `zod` validiert:

- `projects.json`: Liste importierbarer `Projects`
- `stories.json`: Liste importierbarer `UserStories`
- `architecture-plan.json`: importierbarer `ArchitecturePlan`

Wenn Markdown vorhanden ist, das JSON aber nicht valide ist, wird der Run auf `review_required` gesetzt.
