# Workspace Runtime Profiles

Diese Dateien sind vordefinierte Workspace-Profile fuer die spaetere
workspace-spezifische Harness- und Modellwahl.

Wichtig:

- Sie sind bewusst **keine** vollstaendigen `agent-runtime.json`-Dateien.
- Sie enthalten nur die Selektions-Overrides, die auf die globale Runtime-Basis
  gemerged werden sollen.
- `providers`, `command`, `env`, `timeoutMs` und die globale YOLO-Policy bleiben
  in `config/agent-runtime.json` bzw. im globalen User-Override.

Aktuelle Presets:

- `codex-primary.json`
  - Codex ist der primaere High-Usage-Harness fuer code-intensive Schritte
  - Claude uebernimmt guenstigere Review-, Brainstorm- und Doku-Rollen
- `claude-primary.json`
  - Claude ist der primaere High-Usage-Harness fuer text- und reviewlastige Arbeit
  - Codex wird gezielt fuer code-intensive Worker eingesetzt

Gedachte Nutzung im spaeteren Workspace-Profil:

```json
{
  "profileKey": "codex_primary",
  "label": "Codex Primary",
  "defaults": {
    "interactive": { "provider": "codex", "model": "gpt-5.4" },
    "autonomous": { "provider": "codex", "model": "gpt-5.4" }
  },
  "interactive": {},
  "stages": {},
  "workers": {}
}
```
