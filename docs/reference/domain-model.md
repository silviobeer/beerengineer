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
- `PlanningReviewRun`: persistierter advisory Review-Lauf fuer fruehe
  Planungsartefakte
- `PlanningReviewFinding`: strukturierter Finding-Record eines Planning Reviews
- `PlanningReviewSynthesis`: konsolidiertes Ergebnis eines Planning Reviews
- `PlanningReviewQuestion`: blocker-relevante Rueckfrage eines Planning Reviews
- `PlanningReviewAssumption`: explizite Annahme aus `auto`-Mode oder degrade-
  ten Planning-Review-Laeufen
- optional spaeter `WaveParallelGroup`: fachliche Kennzeichnung fuer sicher parallel ausfuehrbare Story-Gruppen innerhalb einer Wave

Die Entitaeten leben im Domain-Layer und werden nicht aus CLI-Kommandos heraus modelliert.

Wichtig:

- Die Planning-Schicht soll Parallelisierbarkeit fachlich beschreiben.
- Die Planning-Review-Schicht bewertet fruehe Artefakte advisory und bleibt
  getrennt von `InteractiveReviewSession`, obwohl beide auf denselben
  persistierten Artefakten arbeiten koennen.
- Die Execution-Schicht entscheidet die konkrete Laufzeitorchestrierung engine-seitig.
- Die TDD-Schicht erzwingt `test_preparation` vor `implementation`.
- Die Ralph-Schicht erzwingt AC-by-AC-Verifikation nach der Implementierung.
- Die Story-Review-Schicht erzwingt einen bounded technischen Review nach Ralph und vor finaler Story-Completion.
- Die QA-Schicht erzwingt einen projektweiten integrierten Check nach vollstaendig abgeschlossener Story-Execution.
- Die Dokumentations-Schicht erzeugt danach den finalen lesbaren Project-Report aus persistierter Wahrheit.
- Worker-Rollen sind Registry und Ausfuehrungsprofil, aber nicht der Scheduler.

Persistenzseitig haengt `PlanningReviewRun` an einer generischen Quelle ueber:

- `sourceType`
  - z. B. `brainstorm_session`, `brainstorm_draft`,
    `interactive_review_session`, `concept`, `architecture_plan`,
    `implementation_plan`
- `sourceId`

Die eigentliche Laufhistorie liegt in:

- `planning_review_runs`
- `planning_review_findings`
- `planning_review_syntheses`
- `planning_review_questions`
- `planning_review_assumptions`

Wichtige sichtbare Planning-Review-Status im aktuellen Runtime-Verhalten:

- `synthesizing`
- `blocker_present`
  - mindestens ein blocker-level Gap ist offen
- `questions_only`
  - keine Blocker, aber noch gezielte Rueckfragen offen
- `revising`
  - nur fuer `auto`-Mode-Folgearbeit ohne User-Rueckfragen
- `ready`
- `blocked`
- `failed`

Wichtige Run-Metadaten:

- `automationLevel`
  - `manual`
  - `auto_suggest`
  - `auto_comment`
  - `auto_gate`
- `requestedMode`
- `actualMode`
- `confidence`
- `gateEligibility`
  - nur Runs mit `gateEligibility = advisory` duerfen als harte Workflow-Gates
    wirken
  - `advisory_only` reduziert die Gate-Macht bewusst auch dann, wenn
    `automationLevel = auto_gate` gesetzt ist
