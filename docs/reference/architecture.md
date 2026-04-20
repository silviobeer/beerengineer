# Architecture

Der MVP ist engine-first aufgebaut:

- `domain/` enthaelt Entitaeten, Statuswerte und Gate-Regeln
- `persistence/` kapselt SQLite, Migrationen, Drizzle-Schema und Repositories
- `workflow/` steuert `StageRun`-Lifecycle, Planning-Importe, Execution-Orchestrierung und Statuswechsel
- `review/` kapselt den generischen Review Core, Provider-Normalisierung und
  Review-Execution-Planung
- `services/` kapseln dateibasierte Resolver und Artefaktablage
- `adapters/` entkoppeln die technische Agent-Ausfuehrung vom Workflow
- `cli/` bleibt duenn und delegiert in Services

## Workspace Layer

BeerEngineer besitzt jetzt einen echten Workspace-Layer:

- `Workspace` ist die fachliche Scope-Grenze fuer Daten, Runs und Artefakte
- `WorkspaceSettings` enthaelt workspace-spezifische Defaults
- `Item` ist der direkte Workspace-Anker

Davon getrennt bleibt:

- `workspaceRoot` als technischer Repo-/Git-Pfad fuer einen konkreten Lauf

Im Execution-Pfad bedeutet das jetzt konkret:

- der persistierte Workspace bleibt der stabile Projekt-Root
- Story- und Remediation-Laeufe arbeiten in engine-owned Git-Worktrees unter `.beerengineer/workspaces/<workspaceKey>/worktrees/`
- read-only Reviews und projektweite Documentation bleiben am stabilen Workspace-Root
- pushbare Delivery-Reports werden bewusst nach `docs/delivery-reports/<workspaceKey>/` exportiert und nicht unter `.beerengineer/` versioniert
- Merges werden ueber temporaere Merge-Worktrees oder bestehende Story-Worktrees orchestriert, nicht ueber den Haupt-Checkout

Damit koennen mehrere Apps dieselbe Engine und dieselbe SQLite-Instanz nutzen,
ohne ihre Item-Historien zu vermischen.

## Stable Record Codes

Der MVP fuehrt fachliche Lesecodes fuer die Planungsobjekte:

- `Item.code` als globale Initiative-Kennung, z. B. `ITEM-0001`
- `Project.code` als vom Item abgeleitete Projekt-Kennung, z. B. `ITEM-0001-P01`
- `UserStory.code` als vom Projekt abgeleitete Story-Kennung, z. B. `ITEM-0001-P01-US01`

Die Engine vergibt diese Codes beim Persistieren. Agent-Outputs muessen die finalen Codes nicht selbst zaehlen oder verwalten.

## Acceptance Criteria

Acceptance Criteria sind jetzt eigene fachliche Records:

- `UserStory` bleibt die Anforderungseinheit
- `AcceptanceCriterion` ist die testbare Untereinheit pro Story
- Codes folgen der Hierarchie, z. B. `ITEM-0001-P01-US01-AC01`

Damit koennen Requirements spaeter in QA und Verifikation wiederverwendet werden, ohne ACs erst aus Markdown oder Story-JSON rekonstruieren zu muessen.

## Laufmodell

1. CLI laedt Kontext und migriert die DB
2. `WorkflowService` erstellt einen `StageRun` mit Prompt- und Skill-Snapshot
3. Adapter liefert Markdown- und JSON-Artefakte
4. Artefakte werden auf Disk geschrieben und in SQLite registriert
5. Validierte JSON-Artefakte werden in Domain-Daten importiert

Die erste Adapter-Implementierung ist lokal und deterministisch, damit der MVP reproduzierbar testbar bleibt.

## Execution Runtime

Die erste Execution-Schicht ist bewusst engine-gesteuert:

- Planning beschreibt nur fachliche Reihenfolge und Parallelisierbarkeit
- die Engine entscheidet, welche `WaveStory` wirklich ausfuehrbar ist
- pro ausfuehrbarer Story wird genau ein bounded Worker-Run gestartet
- Worker-Rollen sind Registry, nicht Scheduler

Persistiert werden dafuer:

- `ProjectExecutionContext` als wiederverwendbarer Projektkontext
- `WaveExecution` als Laufzeitversuch fuer eine Wave
- `WaveStoryExecution` als Laufzeitversuch fuer genau eine Story-in-Wave-Zuordnung
- `ExecutionAgentSession` fuer den konkreten Worker-Lauf
- `VerificationRun` fuer das strukturierte Ergebnis der Verifikation
- `ReviewRun`, `ReviewFinding`, `ReviewSynthesis`, `ReviewQuestion` und
  `ReviewAssumption` fuer generische Reviews

Git-Isolation wird dabei engine-seitig mitgefuehrt:

- `proj/{code}` als langlebiger Projekt-Branch
- `story/{project}/{story}` pro Story-Lauf
- `fix/{story}/{reviewRun}` pro bounded Remediation-Lauf
- `GitBranchMetadata.worktreePath` als technischer Ausfuehrungspfad fuer Agent-Runs

Git-Isolation wird dabei engine-seitig mitgefuehrt:

- `proj/{code}` als langlebiger Projekt-Branch
- `story/{project}/{story}` pro Story-Lauf
- `fix/{story}/{reviewRun}` pro bounded Remediation-Lauf
- `GitBranchMetadata.worktreePath` als technischer Ausfuehrungspfad fuer Agent-Runs

Vor jedem Story-Run erzeugt die Engine und speichert:

- einen Business-Context-Snapshot
- einen Repo-Context-Snapshot

Dadurch bleibt der Ausfuehrungspfad nachvollziehbar und reproduzierbar, ohne das Scheduling dem LLM zu ueberlassen.

## Review Architecture

Die Review-Schicht ist jetzt zweigeteilt:

- bounded Runtime-Reviews fuer konkrete Worker-Laeufe
  - `StoryReviewRun`
  - `QaRun`
- generischer Review Core fuer vereinheitlichte Review-Auswertung
  - `planning`
  - `interactive_story`
  - `implementation`
  - `qa`

Wichtig:

- Story Review und QA behalten ihre bounded Runtime-Records fuer Worker-Sessions
  und fachliche Runtime-Historie
- die vereinheitlichte Gate-/Finding-Logik lebt aber im Review Core
- `implementation` ist voll Core-nativ und kombiniert Tool-Signale mit
  LLM-Review
- automatische Remediation fuer `implementation` laeuft ueber einen separaten
  `ReviewRemediationService`, nicht im Core selbst
