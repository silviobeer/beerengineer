# Known Issues

As of commit `0cb5873` (Apr 2026).

## Execution workflow

- **No wave-boundary resume.** A hard failure in the execution stage after some waves have already merged leaves the run in `failed` with `recovery_status = null`. The run cannot be resumed from the first unfinished wave; the only option is a fresh run (which re-executes completed waves). See `specs/wave-boundary-resume.md` for the proposed fix.
- **Empty-wave plans are accepted.** The planning validator checks wave-id shape and story-id correctness but does not reject waves with zero stories. The execution stage silently walks past them (`Wave N complete — merged: 0, blocked: 0`). Only a planning quality issue, not a crash.

## Provider / hosted CLI

- **No live Claude progress stream.** Claude CLI invocations use `--output-format json`, which buffers the entire agent loop until close. A Ralph story can stay "dark" for 3–8 minutes with Haiku 4.5 before emitting its summary. Codex already streams turn/tool events via the `_stream.ts` callback path; Claude streaming is spec'd in `specs/claude-cli-streaming.md` but not yet implemented.
- **Shared retry / transient-failure logic is duplicated** between `providers/claude.ts` and `providers/codex.ts`. Extract to a shared helper when the Claude streaming migration lands.

## Observability

- **UI transcript shows every `presentation` event** but severity metadata is only partially propagated. Critical/high review findings are styled, but medium/low rely on data-kind class mappings that vary between event sources.

## Setup / preflight

- **Parallel engine runs share a single SQLite database** (`.beerengineer/state.sqlite`). Concurrent writes can interleave; we have not seen corruption but concurrency is not formally tested. Prefer serial runs per workspace.

## Testing gaps

- **Hosted-CLI providers have no unit tests** that exercise retry, unknown-session, or stream-callback paths. Regression risk when editing providers is real; relies on integration runs against live CLIs.
