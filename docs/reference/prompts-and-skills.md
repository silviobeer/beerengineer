# Prompts And Skills

- System-Prompts liegen unter `prompts/system/`
- Skills liegen unter `skills/`
- `runProfiles` referenzieren Dateien relativ zum Repo
- beim Start eines `StageRun` wird der aufgeloeste Prompt direkt in `stage_runs.system_prompt_snapshot` gespeichert
- aufgeloeste Skills werden unveraenderlich als JSON-Snapshot in `stage_runs.skills_snapshot_json` gespeichert
- Worker-Runs in `execution` und `qa` laden ihre Prompts und Skills ebenfalls dateibasiert
- Worker-Prompt- und Skill-Snapshots werden direkt in den zugehoerigen Runtime-Records gespeichert

Damit bleiben alte Runs nachvollziehbar, auch wenn Prompt- oder Skill-Dateien spaeter geaendert werden.

## Current Stage Files

- `brainstorm`
  Prompt: `prompts/system/brainstorm.md`
  Skills: `skills/brainstorm-facilitation.md`, `skills/project-extraction.md`
- `requirements`
  Prompt: `prompts/system/requirements.md`
  Skill: `skills/requirements-engineer.md`
- `architecture`
  Prompt: `prompts/system/architecture.md`
  Skill: `skills/architecture.md`
- `planning`
  Prompt: `prompts/system/planning.md`
  Skill: `skills/writing-plans.md`

## Current Worker Files

- `test_preparation`
  Prompt: `prompts/workers/test-preparation.md`
  Skill: `skills/test-writer.md`
- `execution`
  Prompt: `prompts/workers/execution.md`
  Skill: `skills/execution-implementer.md`
- `ralph`
  Prompt: `prompts/workers/ralph.md`
  Skill: `skills/ralph-verifier.md`
- `story_review`
  Prompt: `prompts/workers/story-review.md`
  Skill: `skills/story-reviewer.md`
- `app_verification`
  Prompt: `prompts/workers/app-verification.md`
  Skill: `skills/app-verifier.md`
- `implementation_review`
  Prompt: `prompts/workers/implementation-review.md`
  Skills: none
- `qa`
  Prompt: `prompts/workers/qa.md`
  Skill: `skills/qa-verifier.md`
- `documentation`
  Prompt: `prompts/workers/documentation.md`
  Skill: `skills/documentation-writer.md`

## Current Intent

- `brainstorm` beschreibt ein Item und leitet daraus ein oder mehrere Projekte ab
- `requirements` arbeitet auf genau einem Projekt und erzeugt Stories plus Acceptance Criteria
- `architecture` arbeitet auf genau einem Projekt und erzeugt eine kurze repo-geerdete Architekturentscheidung
- `planning` arbeitet auf genau einem Projekt und leitet aus Architektur plus Stories einen kompakten `ImplementationPlan` mit 1..n Waves ab
- `planning` soll dabei fachliche Parallelisierbarkeit auf Story-Ebene sichtbar machen, aber noch keine konkrete Subagent-Zuteilung festschreiben

## Responsibility Split

- System-Prompts tragen den harten Stage-Contract:
  Scope, Verbote, Output-Artefakte, JSON-Form und Abschlussregeln
- Skills tragen die Arbeitsweise:
  Heuristiken, Qualitaetsmassstab, Denkprozess und sinnvolle Zerlegung

Dieser Schnitt ist fuer `requirements` und `architecture` bereits bewusst entdoppelt.
`brainstorm` ist ebenfalls aufgeteilt in:

- `brainstorm-facilitation` fuer die Konzeptarbeit
- `project-extraction` fuer die Ableitung von 1..n Projekten

Fuer Worker-Runs gilt derselbe Grundsatz:

- Worker-Prompts tragen den harten bounded Contract des einzelnen Runtime-Schritts
- Worker-Skills tragen die Arbeitsweise und den Qualitaetsmassstab des jeweiligen Workers

Das gilt heute fuer:

- `test_preparation`
- `execution`
- `ralph`
- `story_review`
- `qa`
- `documentation`

Die Stage-Prompts sind bewusst enger geschnitten als allgemeine Agent-Skills:

- keine UI-first-Verzerrung
- keine unnötige Scope-Expansion
- keine verfruehte Wave- oder Implementierungsplanung
- klare Trennung zwischen Requirements, Architektur und spaeterer Umsetzung

## Why The Planning Skill Is Narrower

Die abgelegte `writing-plans`-Variante ist bewusst nicht als generischer PROJ-/PRD-Wave-Planer uebernommen worden.

Fuer BeerEngineer gilt stattdessen:

- Planung arbeitet auf genau einem `Project`, nicht auf einer ganzen Initiative
- Quelle sind persistierte `ArchitecturePlan`, `UserStory` und `AcceptanceCriterion`-Daten, nicht manuell gepflegte PRD-Dateibaeume
- Ergebnis ist ein kompakter `ImplementationPlan` mit 1..n Waves, nicht eine Sammlung ausfuehrungsnaher Wave-Dateien plus externer Gate-Skripte
- UI-Registries, Browser-Smoke-Flows, Ralph-Loops und externe Review-Toolchains gehoeren in spaetere Execution-/QA-Stufen, nicht in die Planning-Stage
