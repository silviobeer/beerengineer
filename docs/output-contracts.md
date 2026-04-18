# Output Contracts

Strukturierte JSON-Ausgaben werden mit `zod` validiert:

- `projects.json`: Liste importierbarer `Projects`
- `stories.json`: Liste importierbarer `UserStories`
- `architecture-plan.json`: importierbarer `ArchitecturePlan`
- `implementation-plan.json`: `ImplementationPlan` mit 1..n Waves, Story-Zuordnung, Story-Abhaengigkeiten und optionalen Parallel-Gruppen pro Project
- `test-preparation.json`: strukturierter Test-Writer-Output fuer genau einen `WaveStoryTestRun` mit Testdateizielen, Testintentionen, Annahmen und Blockern
- `story-execution.json`: strukturierter Worker-Output fuer genau eine `WaveStoryExecution` mit Summary, betroffenen Dateien, Testlaeufen, Notizen und Blockern
- `ralph-verification.json`: strukturierter AC-by-AC-Verifikationsoutput mit Story-Verdict, Evidence und Notes pro `AcceptanceCriterion`
- `story-review.json`: strukturierter technischer Review-Output pro `WaveStoryExecution` mit Severity-basierten Findings und Empfehlungen
- `qa.json`: strukturierter projektweiter QA-Output mit Findings, Evidence und Recommendations

Wenn Markdown vorhanden ist, das JSON aber nicht valide ist, wird der Run auf `review_required` gesetzt.
