# BeerEngineer2 — real LLM provider implementation plan

Replacement plan for wiring Codex, Claude Code, and OpenCode into
`beerengineer2`, based on what was already proven in the prototype repo at
`/home/silvio/projects/beerengineer`.

The key correction: do **not** start from speculative long-lived chat session
protocols like `claude ... stream-json`, `codex proto`, or “OpenCode over
stdio chat” unless they are directly verified and required.

The prototype worked well with a simpler contract:

- one process invocation per stage interaction
- prompt sent through `stdin`
- exactly one final JSON result returned through `stdout` or an explicit output file

That is the v1 architecture in this plan.

## Architectural invariants (read first)

- Stage boundary = artifact/state boundary.
- Provider boundary = one-shot process boundary.
- BeerEngineer owns the JSON contract.
- Reviewer is always read-only.
- Fake is only reachable by explicit override (`BEERENGINEER_FORCE_FAKE_LLM=1`
  or a test hook).
- Unsafe autonomy is an explicit `RuntimePolicy` choice, never a silent
  default — and is a **deviation from the prototype**, which defaulted to
  unsafe flags.

## Context

Current `beerengineer2` state:

- Stage + review execution is still backed by fake adapters in
  `apps/engine/src/llm/fake/*.ts`.
- Execution-stage code generation still uses fake helpers in
  `apps/engine/src/sim/llm.ts` (`llm6bImplement`, `llm6bFix`), invoked from
  `apps/engine/src/stages/execution/ralphRuntime.ts`.
- `apps/engine/src/llm/types.ts` exports `ProviderId = "fake" | "codex" |
  "claude-code"`. The registry (`registry.ts`) throws
  `"Provider … is not yet implemented"` for both non-fake ids.
- `apps/engine/src/types/workspace.ts` stores a `HarnessProfile` with modes
  `codex-first | claude-first | codex-only | claude-only | fast | opencode |
  self`. Only `opencode` and `self` carry per-role `{ coder, reviewer }`
  entries; the other modes are shorthand presets.
- The workspace DB row stores the profile as a JSON blob
  (`workspaces.harness_profile_json`, `db/schema.sql:11`), defaulted to
  `{"mode":"claude-first"}`.
- The runtime does not yet resolve that profile when constructing stage or
  execution providers.
- The workspace config does **not** yet store a separate autonomy /
  execution-policy setting, so provider choice and permission posture are
  currently conflated if we try to encode both into `HarnessProfile`.

Prototype evidence from `/home/silvio/projects/beerengineer`:

- Claude was invoked via `--print` mode
  (`src/adapters/hosted/providers/claude-adapter.ts`), not streaming chat
  protocol.
- Codex was invoked via `codex exec --skip-git-repo-check … --output-last-message`
  (`src/adapters/hosted/providers/codex-adapter.ts`), with prompt on `stdin`
  and final answer collected from the output-last-message file.
- The adapter boundary stayed BeerEngineer-owned: the engine sent one request
  envelope and expected one JSON response envelope.
- **Caveat:** the prototype defaulted to unsafe flags
  (`--dangerously-skip-permissions` for Claude,
  `--dangerously-bypass-approvals-and-sandbox` for Codex). This plan
  **deliberately deviates** from that default — see §3 and §4. Readers
  modelling this as "port the prototype" should not inherit those flags.
- The prototype shipped Claude and Codex adapters only. OpenCode was never
  implemented there; its contract is unverified.

## Goals

1. Real `codex`, `claude-code`, and `opencode` providers implement the
   existing `StageAgentAdapter` / `ReviewAgentAdapter` contracts.
2. Runtime provider selection is driven by each workspace’s
   `HarnessProfile`, not by global defaults.
3. The execution stage uses the workspace’s **coder** harness for real repo
   mutation.
4. Tests remain hermetic and continue to use the fake provider by default.

## Non-goals

- Replacing CodeRabbit or Sonar integrations.
- Changing artifact shapes or the event bus contract.
- Introducing long-lived multi-turn provider sessions as a baseline design.
- Defaulting real providers to unsafe permission-bypass modes.

## Architecture

### 1. Use one-shot hosted CLI adapters, not provider-native chat sessions

Add a new layer under `apps/engine/src/llm/hosted/`:

```text
llm/hosted/
├── hostedCliAdapter.ts
├── providers/
│   ├── claude.ts
│   ├── codex.ts
│   └── opencode.ts
├── promptEnvelope.ts
├── outputEnvelope.ts
└── execution/
    └── coderHarness.ts
```

Core contract:

```ts
type HostedCliRequest = {
  kind: string
  runtime: {
    provider: "claude-code" | "codex" | "opencode"
    model?: string
    workspaceRoot: string
    policy: RuntimePolicy
  }
  prompt: string
  payload: unknown
}

type HostedCliExecutionResult = {
  stdout: string          // raw captured stdout
  stderr: string          // raw captured stderr
  exitCode: number
  command: string[]       // resolved argv for logging
  outputText: string      // the provider-specific "final answer" text:
                          //   - Codex: contents of --output-last-message file
                          //   - Claude: stdout with any leading prose/fences stripped
                          //   - OpenCode: TBD after contract verification
}
```

`provider` values match the existing `ProviderId` in
`apps/engine/src/llm/types.ts` (`"claude-code"`, not `"claude"`). v1 drops
the prototype's `skills?` field — no current stage has skill content to pass;
reintroduce only when a concrete caller needs it.

Behavior:

- spawn provider CLI once per adapter call
- send the full request envelope to `stdin`
- read final structured output from `stdout`, or from a provider-specific
  output file if supported
- parse a single BeerEngineer-owned JSON envelope

This keeps the provider boundary narrow and deterministic.

### 2. Keep the BeerEngineer JSON envelope as the stable contract

Like the prototype, the engine should own the response contract.

The engine's internal adapter contract
(`apps/engine/src/core/adapters.ts`) is:

```ts
type StageAgentResponse<A> =
  | { kind: "message"; message: string }
  | { kind: "artifact"; artifact: A }

type ReviewAgentResponse =
  | { kind: "pass" }
  | { kind: "revise"; feedback: string }
  | { kind: "block"; reason: string }
```

The hosted CLI envelope is chosen as a **strict superset** of those shapes
so mapping is mechanical and validation-only.

For stage runs:

```json
{
  "kind": "artifact",                 // or "message"
  "artifact": { /* stage-specific */ },
  "message": null,
  "needsUserInput": false,
  "userInputQuestion": null,
  "followUpHint": null
}
```

For review calls:

```json
{
  "kind": "pass"                      // or "revise" with "feedback",
                                      // or "block" with "reason"
}
```

Rules:

- provider must return exactly one JSON object
- no markdown fences
- no prose outside the JSON
- shape validation stays inside BeerEngineer; the parser rejects envelopes
  whose `kind` or payload does not map cleanly to the adapter response types

This is cleaner than asking every provider to implement a custom artifact tag
or a streaming tool protocol.

### 3. Provider adapters

#### Claude Code (`provider: "claude-code"`)

Port the prototype shape but **without** unsafe defaults:

- base command: `claude`
- `--print` mode
- prompt via `stdin`
- require a final JSON object in plain text output

Default launch policy:

- **deviation from prototype:** do **not** pass `--dangerously-skip-permissions`
- use a configurable permission mode driven by `RuntimePolicy`
- unsafe bypass is opt-in only via `mode: "unsafe-autonomous-write"`

#### Codex (`provider: "codex"`)

Port the prototype shape but **without** unsafe defaults:

- base command: `codex exec`
- prompt via `stdin`
- use `--output-last-message <file>` for final-answer capture (same as prototype)
- model passed explicitly when configured (`--model …`)

Default launch policy:

- **deviation from prototype:** do **not** pass
  `--dangerously-bypass-approvals-and-sandbox`
- prefer explicit sandbox + approval settings under
  `safe-workspace-write`
- `--full-auto` / bypass flags only under
  `mode: "unsafe-autonomous-write"`

#### OpenCode (`provider: "opencode"`) — deferred

Implemented in a later rollout step. Required before implementation:

- confirm whether `opencode run --format json` is sufficient
- confirm whether final JSON can be consumed reliably from `stdout`
- confirm safe/non-interactive permission configuration

Do not assert a chat-over-stdio protocol unless verified. Until verified, a
workspace with `HarnessProfile.mode = "opencode"` fails resolution with a
clear error (see §5).

### 4. Introduce an explicit runtime execution policy

Add a small infrastructure-level type:

```ts
type RuntimePolicy =
  | { mode: "safe-readonly" }
  | { mode: "safe-workspace-write" }
  | { mode: "unsafe-autonomous-write" }
```

Rules:

- stage reviewer adapters always run as `safe-readonly`
- stage authoring adapters usually run as `safe-readonly` or
  `safe-workspace-write` depending on actual needs
- execution coder adapter may run as `safe-workspace-write`
  or `unsafe-autonomous-write`
- unsafe mode must be opt-in and visible in logs

This is cleaner than baking provider-specific dangerous flags directly into
every adapter.

### 4.1 Workspace config: keep routing and autonomy separate

The workspace config is the right place for runtime selection, but the shape
must stay clean.

Keep `HarnessProfile` for:

- harness identity per role
- model selection per role

Do **not** overload `HarnessProfile` with:

- dangerous permission flags
- sandbox bypass semantics
- autonomy level

Add a separate workspace-owned policy field:

```ts
type WorkspaceRuntimePolicy = {
  stageAuthoring: "safe-readonly" | "safe-workspace-write"
  reviewer: "safe-readonly"
  coderExecution: "safe-workspace-write" | "unsafe-autonomous-write"
}
```

Updated workspace config shape:

```ts
type WorkspaceConfigFile = {
  schemaVersion: 2
  key: string
  name: string
  harnessProfile: HarnessProfile
  runtimePolicy: WorkspaceRuntimePolicy
  sonar: SonarConfig
  createdAt: number
}
```

Rules:

- `HarnessProfile` answers “which harness/model should run?”
- `runtimePolicy` answers “with what level of autonomy may it run?”
- reviewer policy remains fixed to read-only
- coder execution policy is the only place where unsafe autonomy may be enabled

Migration guidance:

- existing `schemaVersion: 1` workspace configs should be read as:
  - `stageAuthoring = "safe-readonly"`
  - `reviewer = "safe-readonly"`
  - `coderExecution = "safe-workspace-write"`
- upgrade on write, not by destructive eager rewrite

This keeps the workspace config aligned with clean architecture:

- routing state and permission posture are separate concerns
- provider selection stays stable even if execution policy changes
- dangerous behavior becomes explicit and auditable

### 4.2 `HarnessProfile` → `ResolvedHarness` mapping

This is the resolver spec. Given a `HarnessProfile` and a `HarnessRole`, the
registry returns exactly one `ResolvedHarness`:

```ts
type ResolvedHarness = {
  harness: "claude-code" | "codex" | "opencode" | "fake"
  provider: ProviderId     // same id — "harness" and "provider" coincide in v1
  model?: string
}
```

Mapping table:

| `HarnessProfile.mode` | role `coder`                         | role `reviewer`                      |
|-----------------------|--------------------------------------|--------------------------------------|
| `claude-only`         | `claude-code` (default model)        | `claude-code` (default model)        |
| `codex-only`          | `codex` (default model)              | `codex` (default model)              |
| `claude-first`        | `claude-code` (default model)        | `claude-code` (default model)        |
| `codex-first`         | `codex` (default model)              | `codex` (default model)              |
| `fast`                | `claude-code` (fast model tier)      | `claude-code` (fast model tier)      |
| `opencode`            | `opencode`, model from `roles.coder` | `opencode`, model from `roles.reviewer` |
| `self`                | `roles.coder.harness` + model        | `roles.reviewer.harness` + model     |

Notes:

- `*-first` modes currently resolve like `*-only`. "First" semantics (fallback
  to the other harness on error) are **out of scope for v1** — a follow-up
  can layer a retry-with-fallback wrapper around the registry without
  changing the resolver shape.
- "default model" means the provider CLI's own default. No model flag is
  passed; the model is whatever the CLI resolves.
- "fast model tier" for `fast` mode: pass `--model` with the Haiku-class
  default documented at runtime (resolver configuration, not hard-coded here).
- For `opencode`: until the provider is implemented (§3), resolver returns a
  fatal configuration error.
- `fake` is **never** a resolver output for a live workspace. It is only
  produced via the explicit override path in §5.

### 5. Fail hard on invalid provider resolution

Do **not** silently fall back to fake during real runs.

Rules:

- test override or `BEERENGINEER_FORCE_FAKE_LLM=1` may force `fake`
- otherwise, unresolved harnesses (e.g. `mode: "opencode"` before the
  OpenCode provider ships), missing CLIs on `$PATH`, or invalid runtime
  policies are fatal configuration errors
- report them clearly and let existing recovery/error plumbing surface them

The resolver never returns `harness: "fake"` except on the explicit override
path; production code paths that receive a `ResolvedHarness` may assume
`harness !== "fake"` unless they came through the override.

This preserves trust in run behavior.

### 6. Keep provider selection in orchestration, not in stage context

Do not put `harnessProfile` and provider mechanics directly into the stage
domain context.

Instead:

- `runOrchestrator` loads the workspace row once
- it resolves stage agent + reviewer selections once
- it constructs concrete adapters before stage execution
- stages receive adapters, not harness configuration

Add only what execution truly needs to runtime context:

- `workspaceRootPath`
- possibly a narrow `ResolvedExecutionHarness`

This keeps domain state and infrastructure state separate.

### 7. Stage integration path

Refactor `apps/engine/src/llm/registry.ts` into a real composition root.

New responsibilities:

- resolve workspace `HarnessProfile` per §4.2
- instantiate either fake or hosted CLI adapter based on `ResolvedHarness`
- log the resolution outcome (§10)

Factory shape:

```ts
type StageId =
  | "brainstorm" | "requirements" | "architecture" | "planning"
  | "documentation" | "project-review" | "test-writer" | "qa"

type AdapterFactoryInput = {
  workspaceRoot: string
  harnessProfile: HarnessProfile
  role: HarnessRole            // "coder" | "reviewer"
  stage: StageId
  testingOverride?: "fake"
}
```

Role is required because §4.2 resolves per role; stage is required so that
fake-fallback selection and future per-stage overrides (e.g. always use
`codex` for `qa`) can be expressed without widening the surface again.

Prefer this over changing every stage constructor to accept raw profile data.

### 8. Execution-stage integration

Replace `llm6bImplement` / `llm6bFix` through a new helper:

`apps/engine/src/llm/hosted/execution/coderHarness.ts`

Behavior:

- resolve the workspace’s coder harness
- invoke provider CLI against the real workspace root
- instruct it to modify files in place
- after completion, compute changed files relative to a stable baseline

Critical requirement — git baseline discipline:

- capture the workspace git HEAD SHA **once, before iteration 1** of each
  story, and stash it on the Ralph runtime state
- each iteration's "changed files" set is computed as `git diff --name-only
  <baseline-SHA>` against the working tree (tracked) plus
  `git ls-files --others --exclude-standard` (untracked)
- intermediate commits created by the coder harness during iterations stay
  on top of the baseline but do not move it
- at story completion, the diff used for review, tests, and artifacts is
  still relative to the original baseline

This avoids attributing unrelated existing edits to the current story and
stays stable across `llm6bFix` / `llm6bImplement` replay in
`ralphRuntime.ts`.

### 9. Review adapters stay one-shot and read-only

Reviewer behavior:

- one-shot invocation
- artifact + state serialized into prompt
- provider returns one JSON review result
- reviewer process must not mutate the repo

This preserves clean role separation:

- coder writes
- reviewer evaluates

### 9.1 Doctor checks

`apps/engine/src/setup/doctor.ts` gains per-provider checks:

- `claude` on `$PATH`, `claude --version` runs and returns zero
- `codex` on `$PATH`, `codex --version` runs and returns zero
- (later) `opencode` on `$PATH` and version probe
- for each harness referenced by any registered workspace's `HarnessProfile`,
  report whether the corresponding CLI resolves; surface failures as doctor
  warnings, not fatal errors (workspaces may be registered for later use)

Version floors are **not** enforced in v1; record observed version in the
doctor output so we can add floors once we see real drift.

### 10. Logging and observability

Emit provider-selection facts into run logs:

- selected harness
- selected model
- runtime policy
- command mode class (`safe-readonly`, `safe-workspace-write`, `unsafe-autonomous-write`)

Do not log secrets or raw auth config.

## Files

### New (v1)

- `apps/engine/src/llm/hosted/hostedCliAdapter.ts`
- `apps/engine/src/llm/hosted/promptEnvelope.ts`
- `apps/engine/src/llm/hosted/outputEnvelope.ts`
- `apps/engine/src/llm/hosted/providers/claudeCode.ts`
- `apps/engine/src/llm/hosted/providers/codex.ts`
- `apps/engine/src/llm/hosted/execution/coderHarness.ts`
- `apps/engine/test/hostedCliAdapter.test.ts`
- `apps/engine/test/hostedProviderAdapters.test.ts`
- `apps/engine/test/coderHarness.test.ts`

### New (deferred — follow-up rollout step)

- `apps/engine/src/llm/hosted/providers/opencode.ts`
  (created only after OpenCode CLI contract is verified per §3)

### Modified

- `apps/engine/src/llm/types.ts` — add `"opencode"` to `ProviderId` (once
  its provider ships); add `HarnessRole`, `StageId` re-exports
- `apps/engine/src/llm/registry.ts` — composition root (§7)
- `apps/engine/src/core/runOrchestrator.ts` — resolve adapters once, hand
  instances to stages (§6)
- `apps/engine/src/stages/*/index.ts` — accept adapter instances, not
  `ProviderId`
- `apps/engine/src/stages/execution/ralphRuntime.ts` — replace
  `llm6bImplement` / `llm6bFix` with coder harness (§8)
- `apps/engine/src/setup/doctor.ts` — per-harness CLI probes (§9.1)
- `apps/engine/src/core/workspaces.ts` — read/write new `runtimePolicy`
  field; schemaVersion migration (§4.1)
- `apps/engine/src/types/workspace.ts` — add `WorkspaceRuntimePolicy`,
  bump `WorkspaceConfigFile.schemaVersion` to `2`
- `apps/engine/src/db/schema.sql` — DB storage policy below
- `apps/engine/src/db/repositories.ts` — same

### DB storage policy

The workspace row already stores `harness_profile_json` as a JSON blob
(`schema.sql:11`). Same approach for policy: add a sibling column
`runtime_policy_json TEXT` with a `NULL` default. `NULL` is interpreted as
the legacy default in §4.1 migration guidance. No ALTER-MIGRATION churn for
existing rows — reads upgrade on demand, writes persist the new shape.

## Verification

1. Unit tests
   - existing fake-provider tests still pass with forced fake mode
   - new hosted adapter tests use stub child processes

2. Typecheck
   - `npm run typecheck`

3. Manual smoke
   - Claude stage run
   - Codex stage run
   - OpenCode stage run after invocation contract verification

4. Execution smoke
   - run coder harness in disposable git repo
   - verify changed files are computed from explicit baseline

5. Force-fake regression
   - `BEERENGINEER_FORCE_FAKE_LLM=1` keeps current tests and live UI flow stable

## Rollout order

1. Add workspace config schema/policy migration (§4.1) — new field in
   config file + DB column, default-on-read for legacy rows. Nothing reads
   it yet.
2. Add hosted adapter base, JSON envelope parser, and tests (§1, §2).
3. Implement Claude Code provider using one-shot `--print` invocation (§3).
4. Implement Codex provider using one-shot `exec` invocation (§3).
5. Refactor registry to resolve adapters from workspace harness profile
   using the §4.2 mapping (§7). First step where the schema change from
   step 1 is actually consumed.
6. Migrate non-execution stages to accept adapter instances (§6).
7. Add coder harness for Ralph with explicit git baseline handling (§8).
8. Add OpenCode provider after protocol verification (§3).
9. Add doctor checks (§9.1) and logging polish (§10).

Step 1 is first so that later steps never need a schema-vs-code skew
window. Steps 3 and 4 can land in parallel.

## Architectural decisions

See the "Architectural invariants (read first)" block at the top of the
document — the summary is promoted there so it is the first thing a reader
sees.
