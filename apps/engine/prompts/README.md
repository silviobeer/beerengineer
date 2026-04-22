# Engine Prompts

Prompt files for hosted LLM stages live here.

Layout:
- `system/<stage-id>.md` for hosted stage prompts
- `reviewers/<stage-id>.md` for hosted reviewer prompts
- `workers/<worker-id>.md` for execution and adjacent worker prompts

Rules:
- The leading `# Title` heading is stripped by the loader before the prompt reaches the model.
- Prompt files define stage-specific behavior and the inner artifact contract.
- `apps/engine/src/llm/hosted/promptEnvelope.ts` defines the outer JSON envelope and runtime protocol.

Runtime override:
- Set `BEERENGINEER_PROMPTS_DIR` to an absolute path, or a path relative to the current working directory, to load prompts from a different directory.

Adding a new prompt:
- Add a markdown file in the matching subdirectory keyed by the runtime stage or worker id.
- Keep provider/runtime metadata out of the markdown file.
- Put the artifact shape expected by this repo in an `## Output Contract` section.
