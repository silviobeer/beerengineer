# App Setup

BeerEngineer now has a dedicated app-level setup flow for machine readiness.

## Commands

```bash
npm exec --workspace=@beerengineer2/engine beerengineer -- doctor
npm exec --workspace=@beerengineer2/engine beerengineer -- doctor --json
npm exec --workspace=@beerengineer2/engine beerengineer -- setup --no-interactive
```

- `doctor` is read-only. It reports config, data-dir, DB, toolchain, and auth status.
- `setup` provisions the default config, data directory, and SQLite database, then reruns diagnostics.
- `GET /setup/status` returns the same JSON contract as `doctor --json`.

## Config

Default config path is OS-aware via `env-paths` and resolves to `config.json` under the app config directory.

Default config shape:

```json
{
  "schemaVersion": 1,
  "dataDir": "<env-paths user data dir>",
  "allowedRoots": ["~/projects"],
  "enginePort": 4100,
  "llm": {
    "provider": "anthropic",
    "model": "claude-opus-4-7",
    "apiKeyRef": "ANTHROPIC_API_KEY"
  },
  "vcs": {
    "github": {
      "enabled": false
    }
  },
  "browser": {
    "enabled": false
  }
}
```

Supported env overrides:

- `BEERENGINEER_CONFIG_PATH`
- `BEERENGINEER_DATA_DIR`
- `BEERENGINEER_ALLOWED_ROOTS`
- `BEERENGINEER_ENGINE_PORT`
- `BEERENGINEER_LLM_PROVIDER`
- `BEERENGINEER_LLM_MODEL`
- `BEERENGINEER_LLM_API_KEY_REF`
- `BEERENGINEER_GITHUB_ENABLED`
- `BEERENGINEER_BROWSER_ENABLED`

## Report semantics

- `overall = blocked` means at least one required group is unsatisfied and `doctor` exits non-zero.
- `overall = warning` means required groups pass and only recommended tooling is missing.
- `overall = ok` means all active required groups pass and recommended tooling hit its ideal target.
