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
  "version": 1,
  "profileKey": "codex_primary",
  "label": "Codex Primary",
  "defaultProvider": "codex",
  "defaults": {
    "interactive": { "provider": "codex", "model": "gpt-5.4" },
    "autonomous": { "provider": "codex", "model": "gpt-5.4" }
  },
  "interactive": {},
  "stages": {},
  "workers": {},
  "meta": {
    "source": "builtin",
    "description": "Codex handles the code-heavy path."
  }
}
```

Die Profil-Keys fuer CLI, DB und JSON-Inhalt sind:

- `codex_primary`
- `claude_primary`

Die Dateien werden explizit gemappt:

- `codex_primary` -> `config/runtime-profiles/codex-primary.json`
- `claude_primary` -> `config/runtime-profiles/claude-primary.json`
