# Prompts And Skills

- System-Prompts liegen unter `prompts/system/`
- Skills liegen unter `skills/`
- `runProfiles` referenzieren Dateien relativ zum Repo
- beim Start eines `StageRun` wird der aufgeloeste Prompt direkt in `stage_runs.system_prompt_snapshot` gespeichert
- aufgeloeste Skills werden unveraenderlich als JSON-Snapshot in `stage_runs.skills_snapshot_json` gespeichert

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

## Planned Next Stage Files

- `planning`
  Prompt: `prompts/system/planning.md`
  Skill: `skills/writing-plans.md`

## Current Intent

- `brainstorm` beschreibt ein Item und leitet daraus ein oder mehrere Projekte ab
- `requirements` arbeitet auf genau einem Projekt und erzeugt Stories plus Acceptance Criteria
- `architecture` arbeitet auf genau einem Projekt und erzeugt eine kurze repo-geerdete Architekturentscheidung
- `planning` ist als naechster Ausbau fuer genau ein Projekt vorbereitet und soll aus Architektur plus Stories einen kompakten `ImplementationPlan` mit 1..n Waves ableiten
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
