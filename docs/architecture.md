# Architecture

Der MVP ist engine-first aufgebaut:

- `domain/` enthaelt Entitaeten, Statuswerte und Gate-Regeln
- `persistence/` kapselt SQLite, Migrationen, Drizzle-Schema und Repositories
- `workflow/` steuert `StageRun`-Lifecycle, Imports und Statuswechsel
- `services/` kapseln dateibasierte Resolver und Artefaktablage
- `adapters/` entkoppeln die technische Agent-Ausfuehrung vom Workflow
- `cli/` bleibt duenn und delegiert in Services

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
