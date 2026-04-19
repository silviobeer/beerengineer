# Agent Adapters

Das Adapter-Interface trennt Workflow und technische Ausfuehrung.

Der erste MVP-Adapter:

- `LocalCliAdapter`
- startet einen lokalen Prozess
- uebergibt den Request als JSON-Datei
- liest Markdown- und JSON-Ausgaben aus `stdout`
- speichert Session-Metadaten in `agent_sessions`

Fuer Tests und lokale Reproduzierbarkeit nutzt der Adapter ein deterministisches Repo-Skript.

Aktuell gibt es zusaetzlich echte Hosted-CLI-Adapter fuer:

- `codex`
- `claude`

Beide laufen ueber dieselben BeerEngineer-Request-Envelopes wie der lokale
Fixture-Adapter:

- interaktive Chats liefern weiter den bestehenden JSON-Contract
- Stage-Runs liefern weiter `markdownArtifacts` plus `structuredArtifacts`
- Worker-Runs liefern weiter `{ output: ... }`

Die Provider-Schicht aendert also nicht den Workflow-Contract, sondern nur die
technische Ausfuehrung.

YOLO ist dabei engine-owned:

- Codex wird mit ungesandboxtem Non-Interactive-`exec` gestartet
- Claude wird mit `--permission-mode bypassPermissions` plus Skip-Permissions gestartet
- der lokale Testadapter bleibt als `local-cli` fuer deterministische Tests erhalten
