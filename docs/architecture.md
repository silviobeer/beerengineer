# Architecture

Der MVP ist engine-first aufgebaut:

- `domain/` enthaelt Entitaeten, Statuswerte und Gate-Regeln
- `persistence/` kapselt SQLite, Migrationen, Drizzle-Schema und Repositories
- `workflow/` steuert `StageRun`-Lifecycle, Imports und Statuswechsel
- `services/` kapseln dateibasierte Resolver und Artefaktablage
- `adapters/` entkoppeln die technische Agent-Ausfuehrung vom Workflow
- `cli/` bleibt duenn und delegiert in Services

## Laufmodell

1. CLI laedt Kontext und migriert die DB
2. `WorkflowService` erstellt einen `StageRun` mit Prompt- und Skill-Snapshot
3. Adapter liefert Markdown- und JSON-Artefakte
4. Artefakte werden auf Disk geschrieben und in SQLite registriert
5. Validierte JSON-Artefakte werden in Domain-Daten importiert

Die erste Adapter-Implementierung ist lokal und deterministisch, damit der MVP reproduzierbar testbar bleibt.
