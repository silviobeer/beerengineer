# Context Management & LLM Configuration

> Reference for how the engine assembles **context** for each LLM call and how
> operators **configure the LLM stack** (harness, models, runtime policy,
> prompts, env vars).
>
> Source of truth is the code; this doc explains the *shape* and the
> *contracts*. If something below disagrees with the code, the code wins.

---

## Why this doc exists

Two concerns are load-bearing for every run but used to live scattered
across code comments, [`docs/NOTES.de.md`](./NOTES.de.md) (German), and
side comments in [`docs/engine-architecture.md`](./engine-architecture.md):

1. **Context management** — what gets sent to the LLM on every turn, where
   it comes from, and how it survives recovery / resume / review cycles.
2. **LLM configuration** — how operators choose providers, models, tool
   policy, and prompt files, and which env vars tune retries / loops.

This file consolidates both. Other docs link here instead of duplicating.

---

## Part A — Context management

### Mental model

Every hosted LLM call is a single string built by `buildHostedPrompt(...)`
in `apps/engine/src/llm/hosted/promptEnvelope.ts`. The string has one
shape regardless of stage:

```
<prompt-file markdown>           ← from apps/engine/prompts/<kind>/<id>.md
<canonical instruction lines>    ← per-kind (stage / review / execution)
<action line>                    ← e.g. "Revise the stage output ..."
<identity lines>                 ← Stage: …, Story: …, Action: …
Provider: <id>
Model: <id|default>
Runtime policy: <json>
Payload:
<json blob>
```

The **payload** is the structured carrier of all turn-specific context.
The prompt file owns *behavior*; the payload owns *facts*.

### The three prompt kinds

`HostedPromptKind = "stage" | "review" | "execution"` —
`promptEnvelope.ts:6,45-83` ships one `SCHEMAS` table that fixes:

| Kind        | Prompt dir       | Output contract                                                                                       | Default fallback |
|-------------|------------------|-------------------------------------------------------------------------------------------------------|------------------|
| `stage`     | `prompts/system/`| `{ kind: "artifact", artifact }` or `{ kind: "message", message }`                                    | no               |
| `review`    | `prompts/reviewers/`| `{ kind: "pass" }` \| `{ kind: "revise", feedback }` \| `{ kind: "block", reason }`                | yes (`_default.md`) |
| `execution` | `prompts/workers/`| `{ summary, testsRun[], implementationNotes[], blockers[] }`                                          | no               |

The instruction block is **canonical**: single JSON object, no markdown
fences, prior turns may exist in the provider's native session, the
`*Context` field on the payload is the authoritative source for counters
and feedback history.

### Payload context fields

The payload always carries one of three context envelopes — code-named
the *deterministic source of truth* for recovery:

#### `stageContext` — `core/adapters.ts`

Carried on every stage prompt. Tells the agent which turn it is on, how
many it has, and what reviewers said in earlier cycles. The agent must
trust this over its own session memory.

#### `reviewContext` — `core/adapters.ts`

Carried on every review prompt. Includes the cycle counter, the
final-cycle flag (so the reviewer knows this is its last chance to block
or accept), and the prior feedback thread.

#### `iterationContext` — `llm/hosted/promptEnvelope.ts:8-18`

Carried on every Ralph execution prompt:

```ts
type IterationContext = {
  iteration: number
  maxIterations: number
  reviewCycle: number
  maxReviewCycles: number
  priorAttempts: Array<{
    iteration: number
    summary: string
    outcome: "passed" | "failed" | "blocked"
  }>
}
```

The coder reads this to know whether the previous attempt failed and
why, even after a process restart.

### Codebase snapshot — `core/codebaseSnapshot.ts`

A pre-loaded compact view of the workspace, attached to the payload of
engineering stages so they don't grep their way to the api contract on
every call:

- Top-level files: `README.md`, `package.json`, `tsconfig.json` (each
  bounded to **32 KB**, larger files are truncated with a marker).
- Tree summary: 2 levels deep, sorted, with these directories skipped:
  `.git`, `node_modules`, `.next`, `.turbo`, `.bg-shell`,
  `.beerengineer`, `dist`, `build`, `coverage`, `.cache`, `.vscode`.
- OpenAPI spec, if present at one of:
  `apps/engine/src/api/openapi.json`, `spec/api-contract.md`,
  `specs/api-contract.md` (the legacy `spec/`/`specs/` paths remain in
  the snapshot loader for backwards compatibility with workspaces that
  still use them; the canonical engine doc is now `docs/api-contract.md`).

The snapshot is a *warm-up*, not a substitute for tools — stage agents
that need deeper inspection still use Read/Grep, gated by the runtime
policy (see Part B).

### References store — `core/referencesStore.ts`

Resolves design-prep input references (wireframes, figma links, local
files) declared on the item. Validates that every local path stays
inside the workspace root before the path is rendered into the payload.

### Conversation log — `core/conversation.ts`

Persistent record of prompt / answer / chat events stored in
`stage_logs`. Projected to a `ConversationEntry[]` by `buildConversation`
with three documented behaviors:

1. **Placeholder folding** — when `prompt_requested.message` is the
   stage-runtime placeholder `you >`, the immediately preceding
   `chat_message` supplies the displayed question and the chat row is
   suppressed. Prevents the agent's message from showing twice.
2. **Actor derivation** — `system | agent | user` is derived from the
   chat source (`stage-agent` / `reviewer` / other) so clients don't
   reconstruct it from `role`.
3. **Empty drop** — whitespace-only text never produces an entry.

The projection also derives an `openPrompt`: the last `question` whose
`promptId` has no answer.

This is what `GET /runs/:id/conversation` returns and what the CLI / UI
boards render.

### Run context — `core/runContext.ts`

`AsyncLocalStorage` carrying `{ runId, itemId, stageRunId }` for the
currently active run. Lets stages emit `log` / event entries via
`emitEvent(...)` without threading the run id through every call site.

### Iteration loop — `core/iterationLoop.ts` + `core/loopConfig.ts`

Generic iterate-then-review helper used by Ralph:

```ts
runCycledLoop<R>({
  maxCycles, startCycle?, initialFeedback?,
  runCycle: (args) => Promise<CycleOutcome<R>>,
  onAllCyclesExhausted: () => Promise<R>,
})
```

`CycleOutcome` is `done | continue (with optional nextFeedback) | exhausted`.
Feedback collected at cycle *n* is threaded into the prompt of cycle
*n+1* via the payload's `iterationContext`.

The inner per-iteration loop inside `runCoderCycleUntilGreen` is *not*
routed through `runCycledLoop` — its semantics (no review, no feedback)
differ deliberately. See `engine-architecture.md` § *Modularity scorecard*
for the rationale.

### Recovery & resume

When a run resumes, it does not replay LLM calls. Instead:

- The `*Context` envelopes (`stageContext` / `reviewContext` /
  `iterationContext`) are reconstructed from `stage_logs` and persisted
  artifacts before the next call. They are designed so the next turn
  can be answered correctly **without** a warm provider session.
- The native provider session id (Claude / Codex) is reused if still
  alive; an "unknown session" message from the CLI triggers one fresh
  retry with a brand-new session, with the structured context
  unchanged. See `llm/hosted/providers/_invoke.ts` (`unknownSession`).
- `BEERENGINEER_FORCE_FAKE_LLM=1` bypasses everything and runs
  per-stage fake adapters from `llm/fake/`.

---

## Part B — LLM configuration

### Configuration surfaces

| Surface                          | Where it lives                                                | How to set it                                              |
|----------------------------------|---------------------------------------------------------------|------------------------------------------------------------|
| Harness profile                  | `WorkspaceConfigFile.harnessProfile`                          | `.beerengineer/workspace.json` (or `setup` flow)           |
| Per-role models (presets)        | `apps/engine/src/core/harness/presets.json`                   | Compiled into engine; see *Available presets* below        |
| Per-role models (custom)         | `harnessProfile.mode = "self"` + `roles`                      | `workspace.json`                                           |
| Runtime policy (tool access)     | `WorkspaceConfigFile.runtimePolicy`                           | `workspace.json`                                           |
| Prompt overrides                 | env `BEERENGINEER_PROMPTS_DIR`                                | export at run-time                                         |
| Force-fake mode                  | env `BEERENGINEER_FORCE_FAKE_LLM=1` *or* `RunLlmConfig.testingOverride = "fake"` | export / test setup                          |
| Ralph loop bounds                | env `BEERENGINEER_MAX_ITERATIONS_PER_CYCLE` (default 4) / `BEERENGINEER_MAX_REVIEW_CYCLES` (default 3) | export                                |
| Hosted retry delays              | env `BEERENGINEER_HOSTED_RETRY_DELAYS_MS` (default `2000,8000`) | export                                                  |
| Disable LLM merge resolver       | env `BEERENGINEER_DISABLE_LLM_MERGE_RESOLVER=1`               | export                                                     |
| Merge-resolver timeouts          | env `BEERENGINEER_MERGE_RESOLVER_BASE_MS` / `_PER_FILE_MS` / `_CAP_MS` | export                                              |

> Convention: every operator-tunable env var is prefixed `BEERENGINEER_`.

### Harness profile

`HarnessProfile` (`apps/engine/src/types/workspace.ts:31-52`) selects
the per-role agent stack. Roles are `coder`, `reviewer`,
`merge-resolver`.

```ts
type HarnessProfile =
  | { mode: "claude-first" | "claude-only" | "codex-first" | "codex-only"
      | "fast" | "opencode-china" | "opencode-euro" }
  | { mode: "opencode"; roles: { coder: RoleModelRef; reviewer: RoleModelRef } }
  | { mode: "self";     roles: { coder: SelfHarnessRoleRef; reviewer: SelfHarnessRoleRef } }
```

Modes that name a preset key (`claude-first`, `codex-first`, …) resolve
through `presets.json`. `self` mode is the power-user escape hatch:

```json
{
  "harnessProfile": {
    "mode": "self",
    "roles": {
      "coder":    { "harness": "claude", "provider": "anthropic", "model": "claude-opus-4-7" },
      "reviewer": { "harness": "codex",  "provider": "openai",    "model": "gpt-5.4" }
    }
  }
}
```

The merge-resolver role falls back to the `coder` entry when no
`merge-resolver` is declared (see `resolveFromPreset` in
`llm/registry.ts:108-109`).

> **Status, as of this writing:** `mode = "opencode" / "opencode-china" / "opencode-euro"`
> resolve to providers that are not yet implemented in
> `llm/hosted/providers/`; `resolveHarness` throws for them. The presets
> exist so the schema is stable.

### Available presets

From `apps/engine/src/core/harness/presets.json`:

| Preset          | Coder                       | Reviewer                  | Merge-resolver              |
|-----------------|-----------------------------|---------------------------|-----------------------------|
| `claude-first`  | claude / claude-sonnet-4-6  | codex / gpt-5.4           | claude / claude-sonnet-4-6  |
| `claude-only`   | claude / claude-opus-4-7    | claude / claude-sonnet-4-6| claude / claude-sonnet-4-6  |
| `codex-first`   | codex / gpt-5.4             | claude / claude-sonnet-4-6| codex / gpt-5.4             |
| `codex-only`    | codex / gpt-5.4             | codex / gpt-4o            | codex / gpt-5.4             |
| `fast`          | codex / gpt-4o              | claude / claude-haiku-4-5 | claude / claude-haiku-4-5   |
| `opencode-china`| opencode / qwen3.5-coder    | opencode / deepseek-v3.2  | opencode / qwen3.5-coder    |
| `opencode-euro` | opencode / codestral-2501   | opencode / mistral-large  | opencode / codestral-2501   |

**Special case** in `resolveFromPreset` (`llm/registry.ts:118-121`): the
`execution` stage on a Claude-family preset is auto-upgraded from
Sonnet to Opus when role = `coder`, because writing real code is more
expensive than text generation. Other stages keep the preset's Sonnet.

### Runtime policy

`WorkspaceRuntimePolicy` (`types/workspace.ts:10-20`) is **separate from
the harness profile**. It governs *what tools each role can use*, not
*which model runs*. The default:

```json
{
  "stageAuthoring":  "safe-readonly",
  "reviewer":        "safe-readonly",
  "coderExecution":  "safe-workspace-write"
}
```

Modes (`RuntimePolicyMode`):

| Mode                          | Means                                                                  |
|-------------------------------|------------------------------------------------------------------------|
| `no-tools`                    | Single JSON envelope per turn, no tool access. Lowest first-token latency. |
| `safe-readonly`               | Read / Grep / etc. — can inspect the codebase, cannot mutate it.        |
| `safe-workspace-write`        | Can write inside the workspace root. Default for execution coder.       |
| `unsafe-autonomous-write`     | Free rein. Only enable for sandboxed runs.                              |

The mapping is **stage-aware**, not just policy-aware
(`llm/runtimePolicy.ts:20-41`):

- `TOOL_USING_STAGES = { requirements, architecture, planning, project-review, qa, documentation }` →
  stage authoring + reviewer get `safe-readonly`. Engineering stages
  need to see the existing code.
- All other stages (the design-prep family: brainstorm,
  visual-companion, frontend-design) → `no-tools`. They design from the
  concept and only emit one JSON envelope per turn.
- `executionCoderPolicy` is the only one that respects the workspace
  policy directly — it returns whatever `policy.coderExecution`
  declares. Operators who want a sandbox can set it to
  `unsafe-autonomous-write`.

### Prompt files

Layout (under `apps/engine/prompts/`):

```
system/<stage-id>.md          ← stage prompts; one per stage id; no fallback
reviewers/<stage-id>.md       ← reviewer prompts; missing → reviewers/_default.md
workers/<worker-id>.md        ← worker prompts; today only `execution`
```

Loader behavior (`llm/prompts/loader.ts`):

- The leading `# Title` heading is stripped before the prompt reaches
  the model — title is for humans only.
- Loaded prompts are **cached in-process for the engine's lifetime**.
  Edits require an engine restart.
- `BEERENGINEER_PROMPTS_DIR` (absolute, or relative to `cwd`)
  overrides the default location. Useful for A/B-testing prompt
  variants without touching the repo.

When adding a new prompt, also wire its `loadPrompt(...)` call —
unreferenced files rot. See `apps/engine/prompts/README.md`.

### Provider runtime: retry, streaming, sessions

Lives in `llm/hosted/providers/`:

- `_invoke.ts` owns the retry + unknown-session shell. Per-provider
  `ProviderDriver` plug-ins customise argv, stream parsing and finalize
  behavior; the shell owns discipline.
- `_retry.ts` classifies failures as transient (SIGTERM/SIGKILL exit
  codes 137/143, empty stdout+stderr on non-zero exit, `ECONNRESET`,
  `ETIMEDOUT`, "network error"…) and supplies the retry delay schedule
  from `BEERENGINEER_HOSTED_RETRY_DELAYS_MS` (default `[2000, 8000]`).
- `_stream.ts` emits live progress events (`emitHostedThinking`,
  `emitHostedTokens`, `emitHostedToolCalled`, `emitHostedToolResult`,
  retry markers) so the CLI / UI can render the agent's progress in
  real time.
- `claude.ts` invokes the `claude` CLI with `--print --verbose
  --output-format stream-json` and `--model <id>` when a model is set.
  Sessions are reused across calls; a session-unknown message triggers
  one fresh-session retry.
- `codex.ts` invokes the `codex` CLI with `--json` and `--model <id>`.
- `opencode.ts` is wired but most preset modes that resolve to it
  currently throw `not implemented yet`.

### Fake mode

`testingOverride = "fake"` on `RunLlmConfig`, or
`BEERENGINEER_FORCE_FAKE_LLM=1`, makes `resolveHarness` short-circuit to
the fake provider. The per-stage fake adapters live in
`apps/engine/src/llm/fake/` — one pair (`<stage>Stage.ts` /
`<stage>Review.ts`) per LLM-using stage. Used by:

- The CI test suite (deterministic, offline).
- Local development without a real CLI installed.
- The "demo run" path when an operator wants to walk the pipeline
  without burning tokens.

### `RunLlmConfig` — the bundle a stage sees

```ts
type RunLlmConfig = {
  workspaceRoot: string
  harnessProfile: HarnessProfile
  runtimePolicy: WorkspaceRuntimePolicy
  testingOverride?: "fake"
}
```

Built once per run from the `WorkspaceConfigFile`, threaded through
`StageDeps.llm.stage` (see `engine-architecture.md` § *StageDeps*) into
every `createStageAdapter(...)` / `createReviewAdapter(...)` call.

---

## Cross-references

- High-level architecture, stage registry, `StageDeps`, `runCycledLoop`:
  [`engine-architecture.md`](./engine-architecture.md).
- User-facing setup walkthrough (harness picker etc.):
  [`setup-for-dummies.md`](./setup-for-dummies.md).
- Prompt-file conventions and the outer envelope:
  [`apps/engine/prompts/README.md`](../apps/engine/prompts/README.md).
- Engine env vars (subset of what's listed here, user-facing):
  [`README.md`](../README.md) § *Env vars*.

If you change a context contract or add a new env var, update this file
in the same change.
