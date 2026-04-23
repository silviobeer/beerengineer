# Known Issues

As of commit `0cb5873` (Apr 2026).

## Execution workflow

- **No wave-boundary resume.** A hard failure in the execution stage after some waves have already merged leaves the run in `failed` with `recovery_status = null`. The run cannot be resumed from the first unfinished wave; the only option is a fresh run (which re-executes completed waves). See `specs/wave-boundary-resume.md` for the proposed fix.
- **Empty-wave plans are accepted.** The planning validator checks wave-id shape and story-id correctness but does not reject waves with zero stories. The execution stage silently walks past them (`Wave N complete — merged: 0, blocked: 0`). Only a planning quality issue, not a crash.

## Provider / hosted CLI

- **Claude `--bare` is not default yet.** Anthropic documents it as the main startup-time lever for scripted use, but the validated local CLI (`Claude Code 2.1.118`) returned `Not logged in · Please run /login` under `--bare` when subscription auth was otherwise working. The engine therefore leaves bare mode opt-in via `CLAUDE_BARE=1`.

## Observability

- **UI transcript shows every `presentation` event** but severity metadata is only partially propagated. Critical/high review findings are styled, but medium/low rely on data-kind class mappings that vary between event sources.

## Setup / preflight

- **Parallel engine runs share a single SQLite database** (`.beerengineer/state.sqlite`). Concurrent writes can interleave; we have not seen corruption but concurrency is not formally tested. Prefer serial runs per workspace.

## Testing gaps

- **Claude stream parsing is fixture-backed, not CLI-version-locked.** We validated the envelope against the installed CLI and captured a fixture, but upstream may still add or rename event shapes in later Claude Code releases. Unknown events are ignored intentionally.
