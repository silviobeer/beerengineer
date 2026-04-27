# Engine Prompts

Prompt files for hosted LLM stages live here.

> See [`context-and-llm-config.md`](../docs/context-and-llm-config.md)
> for the full picture (prompt envelope, payload contracts, runtime
> policy, env-var overrides). This file covers the prompt-folder rules.

Layout:
- `system/<stage-id>.md` — hosted stage prompts, one per stage id.
- `reviewers/<stage-id>.md` — hosted reviewer prompts, one per stage id. Missing files fall back to `reviewers/_default.md`.
- `workers/<worker-id>.md` — worker prompts loaded by `promptEnvelope.ts`. Only wired worker ids belong here; today that's `execution`.

Rules:
- The leading `# Title` heading is stripped by the loader before the prompt reaches the model.
- Prompt files define stage-specific behavior and the inner artifact contract.
- `apps/engine/src/llm/hosted/promptEnvelope.ts` defines the outer JSON envelope and runtime protocol.

Runtime override:
- Set `BEERENGINEER_PROMPTS_DIR` to an absolute path, or a path relative to the current working directory, to load prompts from a different directory.

Caching:
- Loaded prompts are cached in-process for the lifetime of the engine. Edits to these files require an engine restart to take effect.

Adding a new prompt:
- Add a markdown file in the matching subdirectory keyed by the runtime stage or worker id.
- For a new worker id, wire the `loadPrompt("workers", "<id>")` call in `promptEnvelope.ts` in the same change — unreferenced files rot.
- Keep provider/runtime metadata out of the markdown file.
- Put the artifact shape expected by this repo in an `## Output Contract` section.
