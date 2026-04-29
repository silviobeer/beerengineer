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
across code comments and side comments in
[`docs/engine-architecture.md`](./engine-architecture.md):

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
## References                   ← injected only when PROMPT_BUNDLES wires bundles
<reference bundle markdown>     ← from apps/engine/prompts/references/<bundle>.md
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

Reference composition is static and engine-side. The model never "fetches"
bundle files later; `loadComposedPrompt(...)` resolves them before the
provider call. Reviewer `_default.md` fallback applies only when the
reviewer prompt file itself is missing, not when a referenced bundle fails
to load.

### The three prompt kinds

`HostedPromptKind = "stage" | "review" | "execution"` —
`promptEnvelope.ts:6,45-83` ships one `SCHEMAS` table that fixes:

| Kind        | Prompt dir       | Output contract                                                                                       | Default fallback |
|-------------|------------------|-------------------------------------------------------------------------------------------------------|------------------|
| `stage`     | `prompts/system/`| `{ kind: "artifact", artifact }` or `{ kind: "message", message }`                                    | no               |
| `review`    | `prompts/reviewers/`| `{ kind: "pass" }` \| `{ kind: "revise", feedback }` \| `{ kind: "block", reason }`                | yes (`_default.md`) |
| `execution` | `prompts/workers/`| `{ summary, testsRun[], implementationNotes[], blockers[] }`                                          | no               |

`promptEnvelope.ts` also owns a `PROMPT_BUNDLES` table that maps selected
prompt ids to reusable `prompts/references/...` bundle files. Today:

- `system/frontend-design` gets the anti-pattern bank plus all design-domain references
- `system/qa` gets the anti-pattern bank only
- `reviewers/frontend-design` gets the anti-pattern bank only
- `workers/execution` gets the implementation-relevant subset

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
**every LLM-using stage** so they don't grep their way to the api
contract on every call. Loaded once per item by `runWorkflow`, then
threaded into design-prep (`brainstorm` / `visual-companion` /
`frontend-design`), engineering stages, and the execution coder.

- Top-level files: `README.md`, `AGENTS.md`, `package.json`,
  `tsconfig.json` (each bounded to **32 KB**, larger files are
  truncated with a marker). `AGENTS.md` carries the workspace's house
  rules for AI coding agents per the [agents.md](https://agents.md)
  convention; pre-loading it means stages follow those rules on turn 1
  instead of discovering them via tool calls. Nested `AGENTS.md` files
  (one per subtree) are intentionally not walked — the convention's
  "nearest wins" rule is left to the live filesystem, since engineering
  stage agents have at least `safe-readonly` tool access and can read a
  closer file when working in a subtree.
- Workspace docs (when present): `docs/AGENTS.md`,
  `docs/architecture.md`, `docs/api-contract.md`,
  `docs/technical-doc.md`, `docs/features-doc.md`,
  `docs/README.compact.md`. These are typically produced by the
  documentation stage of a previous run, so a brownfield brainstorm /
  requirements / architecture pass sees what the project already
  claims to be (shipped features, stated tech choices, house style)
  instead of starting from a tree listing alone.
- Tree summary: 2 levels deep, sorted, with these directories skipped:
  `.git`, `node_modules`, `.next`, `.turbo`, `.bg-shell`,
  `.beerengineer`, `dist`, `build`, `coverage`, `.cache`, `.vscode`.
- OpenAPI spec, if present at one of:
  `apps/engine/src/api/openapi.json`, `spec/api-contract.md`,
  `specs/api-contract.md` (the legacy `spec/`/`specs/` paths remain in
  the snapshot loader for backwards compatibility with workspaces that
  still use them; the canonical engine doc is now `docs/api-contract.md`).

The snapshot is a *warm-up*, not a substitute for tools. Engineering
stages still use Read/Grep when they need deeper inspection (gated by
the runtime policy — see Part B). Design-prep stages stay on
`no-tools` for first-token latency, so the snapshot is their **only**
view of the existing codebase; they treat documented claims as
hypotheses to reconcile against the artifact they're producing, not as
ground truth.

### Frontend fingerprint — `core/frontendSnapshot.ts`

A **lazily-loaded sub-snapshot** that fills the gap between "package.json
says it's React" and "what does the existing UI actually look like?".
Attached to `CodebaseSnapshot.frontend` only when **`itemHasUi === true`**
(determined post-brainstorm from the `hasUi` flag on the project split).
Items that produce no UI never pay for it.

The fingerprint carries four things:

- **`detectedRoots`** — workspace-relative paths whose `package.json`
  declares a known frontend framework dep. The workspace root counts if
  it has the deps directly; we also probe direct subdirs of `apps/` and
  `packages/` (covers monorepo layouts like `apps/ui/`), and the
  conventional non-monorepo `frontend/` and `web/` paths.
- **`framework`** — best-effort detection from deps:
  `next` (preferred over `react`), `angular`, `vue`, `svelte`,
  or plain `react`. `undefined` if none match.
- **`stylingSystem`** — best-effort detection: `tailwind` (`tailwindcss`
  dep), `styled-components`, `emotion`, or a structural fallback to
  `css-modules` if any `*.module.css` is found in the first detected
  root.
- **`configFiles`** — content of probed FE config / theme / layout
  files when present, each capped at 32 KB. Probe list (per detected
  root): `tailwind.config.{ts,js,mjs,cjs}`, `postcss.config.*`,
  `next.config.*`, `vite.config.*`, `app/globals.css`,
  `src/app/globals.css`, `styles/globals.css`,
  `app/layout.{tsx,jsx}`, `src/app/layout.{tsx,jsx}`, `theme.{ts,js}`,
  `tokens.{ts,js}`, `design-tokens.css`. Missing files are silently
  skipped.
- **`componentTree`** — workspace-relative shallow listing (depth 3,
  capped at ~200 entries total) under `components/`, `src/components/`,
  `app/`, `src/app/`, `pages/`, `src/pages/` for each detected root.
  Names only, no content. Lets a designer see "there's a
  `apps/ui/components/Button.tsx` and `apps/ui/app/page.tsx`" without
  paying for content.

**Curation principle.** Same as the main snapshot: probe a fixed list of
known paths, skip silently when absent, never walk arbitrary trees.
Adding a new file to the probe list is a one-line edit; nothing parses
ASTs or interprets the code semantically. If a project uses an
unconventional layout (e.g. `unocss` instead of Tailwind, or a custom
build system), the probes miss; the agent then falls back to the
deps-derived `framework` field and the regular `treeSummary`.

**What it deliberately does not do:**

- Walk arbitrary frontend trees (would explode on large repos).
- Parse component ASTs or extract prop types (fragile, expensive).
- Render screenshots (out of scope; happens in mockup-rendering).
- Resolve nested `AGENTS.md` files (handled by the live filesystem when
  agents have tool access).

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
- Resume uses the persisted recovery scope as the authority for where to
  re-enter the workflow (`core/resume.ts` `buildWorkflowResumeInput`).
  For example, a recovery record scoped to `execution` resumes execution
  even if the board projection still says `visual-companion`. Prepared
  imports are detected by their copied `imports/prepared-source` snapshot
  (`core/preparedImport.ts` `preparedImportSourceSnapshotDir`) and keep
  `skipDesignPrep: true` on resume, so brainstorm / visual-companion /
  frontend-design are not regenerated after an imported run blocks.
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

`HarnessProfile` (`apps/engine/src/types/workspace.ts`) selects the
per-role agent stack. Roles are `coder`, `reviewer`, `merge-resolver`.

```ts
type HarnessProfile =
  | { mode: "claude-first" | "claude-only" | "codex-first" | "codex-only"
      | "fast" | "claude-sdk-first"
      | "opencode-china" | "opencode-euro" }
  | { mode: "opencode"; roles: { coder: RoleModelRef; reviewer: RoleModelRef } }
  | {
      mode: "self"
      roles: {
        coder: SelfHarnessRoleRef
        reviewer: SelfHarnessRoleRef
        "merge-resolver"?: SelfHarnessRoleRef
      }
    }

type SelfHarnessRoleRef = RoleModelRef & {
  harness: KnownHarness          // "claude" | "codex" | "opencode"
  runtime?: InvocationRuntime    // "cli" | "sdk", defaults to "cli"
}
```

Three orthogonal axes flow from this:

- **harness** — agent runtime brand (claude, codex, opencode)
- **provider** — API vendor (anthropic, openai, openrouter, …)
- **runtime** — invocation mechanism (`cli` shells out to the local
  agent CLI; `sdk` runs the agent loop in-process via the vendor SDK)

Modes that name a preset key (`claude-first`, `codex-first`,
`claude-sdk-first`, …) resolve through `presets.json`. `self` mode is
the power-user escape hatch and supports per-role runtime mixing,
including an explicit `merge-resolver` slot:

```json
{
  "harnessProfile": {
    "mode": "self",
    "roles": {
      "coder":          { "harness": "claude", "provider": "anthropic", "model": "claude-opus-4-7",  "runtime": "sdk" },
      "reviewer":       { "harness": "codex",  "provider": "openai",    "model": "gpt-5.4",          "runtime": "cli" },
      "merge-resolver": { "harness": "claude", "provider": "anthropic", "model": "claude-sonnet-4-6","runtime": "cli" }
    }
  }
}
```

When `merge-resolver` is omitted, the registry falls back to the
`coder` entry (`resolveFromPreset` in `llm/registry.ts`).

> **Status, as of this writing:**
> - `mode = "opencode" / "opencode-china" / "opencode-euro"` resolve to
>   providers that are not yet implemented in `llm/hosted/providers/`;
>   `resolveHarness` throws for them. The presets exist so the schema is stable.
> - `claude:sdk` runs on `@anthropic-ai/claude-agent-sdk`; `codex:sdk`
>   runs on `@openai/codex-sdk`. Both are real adapters — operators
>   pick them via the `claude-sdk-first` / `codex-sdk-first` presets
>   (or per-role `runtime: "sdk"` in `self` mode).
> - `opencode:sdk` is rejected at validation time — there's no
>   comparable opencode agent SDK to wrap.

#### CLI vs SDK runtime — what the operator picks up

Choosing the SDK runtime for a role buys:

- programmatic control over tool execution (gate writes per call, not per process)
- richer streaming events (token-level deltas, structured tool-call objects)
  without parsing CLI stdout
- faster cold-start in long-running engine processes (no subprocess spawn per turn)
- direct billing visibility per call via API usage data
- foundation for later features (custom tools, MCP wiring, multi-region routing)
  that the CLI does not expose

The tradeoff:

- API key management instead of relying on a local CLI auth session
- direct per-token billing instead of subscription-bundled CLI usage
- more code surface owned by this engine (tool execution loop, history replay)
  instead of the CLI

**Auth & billing — read this before flipping a role to `sdk`:**

| Runtime | Auth source                                            | Billing                                  |
| ------- | ------------------------------------------------------ | ---------------------------------------- |
| `cli`   | Local CLI session (`claude login`, `codex login`)      | Subscription bundled with the CLI        |
| `sdk`   | API key in the **process env**: `ANTHROPIC_API_KEY` for `claude:sdk`, `OPENAI_API_KEY` for `codex:sdk` | Per-token, billed against your API key |

> The engine reads SDK keys from `process.env` only. Workspace
> `.env.local` discovery is **not yet implemented** for LLM API keys
> (it does work for `SONAR_TOKEN`). Export the key before invoking the
> engine, or wait for the loader to land.

`resolveHarness` does **not** silently fall back to CLI when an SDK
profile is selected without the right key — it throws with
`profile_references_unavailable_runtime` so the operator sees the
mismatch up front. Defaults stay CLI everywhere; SDK profiles are
opt-in via preset choice or a `runtime: "sdk"` field in `self` mode.

### Available presets

From `apps/engine/src/core/harness/presets.json`:

| Preset          | Coder                       | Reviewer                  | Merge-resolver              |
|-----------------|-----------------------------|---------------------------|-----------------------------|
| `claude-first`  | claude / claude-sonnet-4-6  | codex / gpt-5.4           | claude / claude-sonnet-4-6  |
| `claude-only`   | claude / claude-opus-4-7    | claude / claude-sonnet-4-6| claude / claude-sonnet-4-6  |
| `codex-first`   | codex / gpt-5.4             | claude / claude-sonnet-4-6| codex / gpt-5.4             |
| `codex-only`    | codex / gpt-5.4             | codex / gpt-4o            | codex / gpt-5.4             |
| `fast`              | codex / gpt-4o              | claude / claude-haiku-4-5 | claude / claude-haiku-4-5   |
| `claude-sdk-first`  | claude:sdk / claude-sonnet-4-6 | codex / gpt-5.4         | claude:sdk / claude-sonnet-4-6 |
| `codex-sdk-first`   | codex:sdk / gpt-5.4         | claude / claude-sonnet-4-6 | codex:sdk / gpt-5.4        |
| `opencode-china`    | opencode / qwen3.5-coder    | opencode / deepseek-v3.2  | opencode / qwen3.5-coder    |
| `opencode-euro`     | opencode / codestral-2501   | opencode / mistral-large  | opencode / codestral-2501   |

Both SDK-backed presets keep the **reviewer** on the opposite vendor's
CLI on purpose: the runtime axis gets exercised on the heavier coder
role without doubling per-token cost on review. To use them:

```json
{ "harnessProfile": { "mode": "claude-sdk-first" } }   // needs ANTHROPIC_API_KEY
{ "harnessProfile": { "mode": "codex-sdk-first"  } }   // needs OPENAI_API_KEY
```

**Special case** in `resolveFromPreset` (`llm/registry.ts:118-121`): the
`execution` stage on a Claude-family preset is auto-upgraded from
Sonnet to Opus when role = `coder`, because writing real code is more
expensive than text generation. Other stages keep the preset's Sonnet.

### Runtime policy

`WorkspaceRuntimePolicy` (`types/workspace.ts:10-20`) is **separate from
the harness profile**. It governs *what tools each role can use*, not
*which model runs*. The baseline default is:

```json
{
  "stageAuthoring":  "safe-readonly",
  "reviewer":        "safe-readonly",
  "coderExecution":  "safe-workspace-write"
}
```

The persisted default is profile-aware (`types/workspace.ts`
`defaultRuntimePolicyForHarnessProfile`, surfaced through
`core/workspaces/configFile.ts`). Workspaces whose execution coder is
Codex CLI (`codex-first`, `codex-only`, `fast`, or `self` with a Codex
CLI coder) default `coderExecution` to `unsafe-autonomous-write`. This
avoids Codex CLI's OS sandbox on hosts where `workspace-write` cannot run
shell/file tools reliably. Claude and SDK-based execution coders keep
`safe-workspace-write`.

Modes (`RuntimePolicyMode`):

| Mode                          | Means                                                                  |
|-------------------------------|------------------------------------------------------------------------|
| `no-tools`                    | Single JSON envelope per turn, no tool access. Lowest first-token latency. |
| `safe-readonly`               | Read / Grep / etc. — can inspect the codebase, cannot mutate it.        |
| `safe-workspace-write`        | Can write inside the workspace root. Baseline execution-coder default; used for Claude / SDK execution coders. |
| `unsafe-autonomous-write`     | Bypass provider sandbox / permission prompts. Default for Codex CLI execution coders so they can write reliably on hosts where Codex's OS sandbox fails. |

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
  declares.

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

Lives in `llm/hosted/providers/`. The dispatch boundary in
`llm/hosted/hostedCliAdapter.ts` keys off `(harness, runtime)` and
routes to one of:

- `claude.ts` — claude CLI subprocess, `--print --verbose
  --output-format stream-json`, `--model <id>` if set. Server-side
  session reuse via `--resume <id>`; a session-unknown message
  triggers one fresh-session retry.
- `claudeSdk.ts` — `@anthropic-ai/claude-agent-sdk` in-process. Maps
  engine `RuntimePolicy` modes to Agent SDK permission modes (table
  inside the file). When the SDK does not expose a clean equivalent
  for a policy, it picks the **stricter** option, never broader. Falls
  back to local message-history replay (`_sdkSession.ts`) when no
  server-side session handle is returned. Lazily imports the SDK
  package so CLI-only workspaces never need the dep.
- `codex.ts` — codex CLI subprocess, `--json`, `--model <id>`. For
  `unsafe-autonomous-write` it emits
  `--dangerously-bypass-approvals-and-sandbox`; for `safe-readonly` /
  `safe-workspace-write` it normally emits Codex's `--sandbox` mode
  unless `BEERENGINEER_CODEX_SANDBOX_BYPASS=1` is set.
- `codexSdk.ts` — `@openai/codex-sdk` in-process. Wraps the same
  `codex` CLI surface (sandboxed exec, JSONL events, session resume
  via `~/.codex/sessions`). Maps engine `RuntimePolicy` modes to
  `sandboxMode` (`read-only` / `workspace-write` / `danger-full-access`)
  and pins `approvalPolicy: "never"` so non-interactive runs don't
  block. Lazily imports the SDK package so CLI-only workspaces never
  need the dep.
- `opencode.ts` — wired but throws `not implemented yet`.

Cross-cutting helpers:

- `_invoke.ts` owns the retry + unknown-session shell for CLI runtimes.
  Per-provider `ProviderDriver` plug-ins customise argv, stream parsing
  and finalize behavior; the shell owns discipline.
- `_retry.ts` classifies failures as transient (SIGTERM/SIGKILL exit
  codes 137/143, empty stdout+stderr on non-zero exit, `ECONNRESET`,
  `ETIMEDOUT`, "network error"…) and supplies the retry delay schedule
  from `BEERENGINEER_HOSTED_RETRY_DELAYS_MS` (default `[2000, 8000]`).
- `_stream.ts` emits live progress events (`emitHostedThinking`,
  `emitHostedTokens`, `emitHostedToolCalled`, `emitHostedToolResult`,
  retry markers) — both CLI and SDK adapters feed this.
- `_sdkSession.ts` is the local-history replay helper used by SDK
  adapters when the SDK does not expose a server-side conversation
  handle. The cost is bandwidth, not correctness — payload context
  (`stageContext` / `reviewContext` / `iterationContext`) remains
  authoritative.

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

## Part C — Per-stage LLM call sheet

For every LLM-using stage, this table captures the inputs the engine
hands the agent, the artifact shape the agent must return, the prompt
template the call uses, and any review-side constraints. Source of truth:
the `<Stage>Artifact` types in `apps/engine/src/stages/<stage>/types.ts`
and the markdown files in `apps/engine/prompts/{system,reviewers,workers}/`.

| Stage | Inputs (beyond the global context) | Output artifact | Stage prompt | Reviewer prompt | Notes |
|---|---|---|---|---|---|
| `brainstorm` | item title + description + codebase snapshot | Concept (summary, problem, users, constraints) + `Project[]` split | `prompts/system/brainstorm.md` — Senior Product Strategist scoping the item | `prompts/reviewers/brainstorm.md` — checks concept clarity, success criteria, `hasUi` flag | Item-level; produces the per-project split. Snapshot is the only code-awareness on `no-tools`. |
| `visual-companion` | concept + projects + design references + codebase snapshot **incl. frontend fingerprint** | `WireframeArtifact` (screens, navigation, `wireframeHtmlPerScreen`) | `prompts/system/visual-companion.md` — Senior UX Designer producing low-fi wireframes | `prompts/reviewers/visual-companion.md` — coverage, region mapping, lo-fi compliance | Design-prep, `no-tools`; only runs when projects have UI; sees `codebase.frontend` (detected framework, configs, component tree) |
| `frontend-design` | wireframes + design references + codebase snapshot **incl. frontend fingerprint** | `DesignArtifact` (tokens, typography, spacing, mockups, anti-patterns) | `prompts/system/frontend-design.md` — Senior Visual Designer building the item-wide language | `prompts/reviewers/frontend-design.md` — token completeness, contrast, CSS-var usage | Design-prep, `no-tools`; sees existing tokens/globals.css/layouts via `codebase.frontend.configFiles` |
| `requirements` | concept + (optional) wireframes/design + codebase snapshot | `RequirementsArtifact` (PRD with `UserStory[]` + ACs) | `prompts/system/requirements.md` — Senior PM eliciting testable PRD | `prompts/reviewers/requirements.md` — story independence, AC testability | Tool-using → `safe-readonly`; carries snapshot |
| `architecture` | PRD + (optional) wireframes/design + codebase snapshot | `ArchitectureArtifact` (components, decisions, risks, AC→component map) | `prompts/system/architecture.md` — Staff Solution Architect grounded in repo | `prompts/reviewers/architecture.md` — boundary clarity, decision consistency | Tool-using → `safe-readonly`; emits decision binding |
| `planning` | PRD + architecture + codebase snapshot | `ImplementationPlanArtifact` (waves, story groups, dependencies, exit criteria) | `prompts/system/planning.md` — TPM sequencing waves with explicit deps | `prompts/reviewers/planning.md` — forward-flow deps, parallel safety, story coverage | Tool-using → `safe-readonly` |
| `test-writer` | wave + story + ACs + architecture summary | `StoryTestPlanArtifact` (testCases, fixtures, edge cases) | `prompts/system/test-writer.md` — Staff Test Engineer authoring per-story test plans | `prompts/reviewers/test-writer.md` — AC coverage, falsifiability | Per-story; spawned by `execution` |
| `execution` (coder) | story + test plan + architecture + iterationContext + codebase | `CoderHarnessOutput` (`{ summary, testsRun[], implementationNotes[], blockers[] }`) | `prompts/workers/execution.md` — implementation worker with file-write access | n/a (Ralph reviewer is the test-writer review feeding back as `feedback` field) | Tool-using → profile-aware `coderExecution`: Claude/SDK normally `safe-workspace-write`, Codex CLI normally `unsafe-autonomous-write`; runs inside Ralph loop with `iterationContext` |
| `project-review` | concept + PRD + architecture + plan + execution summaries | `ProjectReviewArtifact` (overallStatus, findings, recommendations) | `prompts/system/project-review.md` — Engineering Manager checking cross-artifact consistency | `prompts/reviewers/project-review.md` (falls back to `_default.md` if absent) | Tool-using → `safe-readonly` |
| `qa` | merged project branch + PRD digest + project-review findings | `QaArtifact` (`accepted`, `loops`, `findings[]`) | `prompts/system/qa.md` — QA Lead doing adversarial verification | `prompts/reviewers/qa.md` (falls back to `_default.md`) | Tool-using → `safe-readonly`; runs against the post-merge branch |
| `documentation` | all upstream artifacts + execution summaries + repo evidence | `DocumentationArtifact` (`technicalDoc`, `featuresDoc`, compact README) | `prompts/system/documentation.md` — Senior Technical Writer | `prompts/reviewers/documentation.md` (falls back to `_default.md`) | Tool-using → `safe-readonly` |

**Global rules every row implicitly assumes:**

- Every call also receives the matching `*Context` envelope from § *Payload context fields*: stage calls get `stageContext`, review calls get `reviewContext`, execution calls get `iterationContext`. The agent must trust these over its own session memory.
- Every LLM-using stage receives the **codebase snapshot** assembled by `core/codebaseSnapshot.ts` so brownfield context is visible from turn 1. Engineering stages use it as a *warm-up* (they still hold tools); design-prep stages (`brainstorm`, `visual-companion`, `frontend-design`) use it as their *only* view of the existing code, since they run on `no-tools`.
- For UI items, the snapshot additionally carries a **frontend fingerprint** (`codebase.frontend`) — detected framework, styling system, FE config files, and a shallow component tree. Loaded lazily after brainstorm produces the `hasUi` flag; non-UI items never pay for it. See § *Frontend fingerprint* above.
- The **prompt envelope** wrapping every call (prompt file + canonical instructions + payload JSON) is built by `buildHostedPrompt(...)` in `llm/hosted/promptEnvelope.ts`. Stage rows above describe the *body*; the envelope shape is identical across stages and documented in § *Mental model*.
- `execution` is the only stage that owns its own runtime (Ralph). The "stage prompt" for `execution` is the worker prompt (`prompts/workers/execution.md`); the per-story `test-writer` provides the test plan and feedback for the inner review cycle.

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
