# BeerEngineer2 — Features

## Workflow engine

Staged pipeline driven by hosted LLM CLIs (Claude Code, Codex, OpenCode). Each stage runs a stage-agent + reviewer pair with session resume, review-cycle budgets, and loop-awareness.

Stages:

1. **brainstorm** — promote free-form idea into project concepts
2. **requirements** — derive PRD (stories + acceptance criteria)
3. **architecture** — solution architecture grounded in the repo
4. **planning** — wave-based implementation plan with validated wave ids + dependencies
5. **execution** — per-wave per-story TDD loop: test-writer → Ralph → parallel review gate
6. **project-review** — cross-story assessment before delivery
7. **qa** — final quality check
8. **documentation** — generate README.compact, features-doc, technical-doc, known-issues

## Real git branching

Enabled automatically when the workspace is a clean git repo with a resolvable base branch. Branch layout:

```
<base> → item/<slug> → proj/<project-slug>__<item-slug>
                    → wave/<project-slug>__<item-slug>__w<n>
                    → story/<project-slug>__<item-slug>__w<n>__<story-id>
```

Merges are `--no-ff` and bubble up from story → wave → project → item.

## Review gates

Per-story parallel review during execution:

- **CodeRabbit** local CLI (`coderabbit` / `cr`) runs when available; emits findings with severity (critical / high / medium / low)
- **SonarCloud** scanner runs when a project key + token are configured

Ralph enters a fix cycle while critical/high findings are present. Lower-severity findings pass-partial and bubble up as warnings in the transcript.

## Session resume

Stage agents and reviewers persist their provider session id across review cycles (`stage_runs.stage_agent_session_id`, `stage_runs.reviewer_session_id`). Each resumed call supplies the prior conversation context deterministically; cache-read token counts reflect this.

## Provider resilience

- Claude CLI: retry on transient SIGTERM (`exit 143`), SIGKILL (`137`), empty-output failures, and common network-error signatures. Two backoffs at 2s and 8s.
- Claude CLI: `--print --verbose --output-format stream-json` now streams live `system`, `assistant`, and `result` events; the adapter forwards session start, tool use, turn completion, provider retry notices, and local retry markers to the workflow bus while preserving the active `stageRunId`.
- Codex CLI: same retry logic; additionally streams `thread.started`, `turn.started`, `turn.completed`, and `item.*` events live to the workflow bus while the agent is running.
- Prompt delivery uses stdin for Claude (avoids E2BIG on large late-stage prompts) and has always used stdin for Codex.
- `CLAUDE_BARE=1` is available as an opt-in startup experiment, but it is not the default because local validation against Claude Code `2.1.118` broke subscription-auth.

## Workspace setup

Automated via `beerengineer workspace add`:

- Optional GitHub repo creation (`gh repo create`) when none is detected
- SonarCloud project provisioning + quality-gate selection + auto-scan disable
- CodeRabbit wiring gated on local CLI presence
- Preflight report written to `workspace.json`

## UI

Next.js live console with SSE subscription to engine events:

- Conversation transcript with per-event-kind and severity-aware styling
- Stage inspector showing wave/story state
- Branch + merge panels for real-git mode
- Preview tab with proxied-URL fallback when the engine host is not reachable from the browser
