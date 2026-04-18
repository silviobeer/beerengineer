# Agent Adapters

Das Adapter-Interface trennt Workflow und technische Ausfuehrung.

Der erste MVP-Adapter:

- `LocalCliAdapter`
- startet einen lokalen Prozess
- uebergibt den Request als JSON-Datei
- liest Markdown- und JSON-Ausgaben aus `stdout`
- speichert Session-Metadaten in `agent_sessions`

Fuer Tests und lokale Reproduzierbarkeit nutzt der Adapter ein deterministisches Repo-Skript.
