# Codex And Claude Implementation Plan

## Goal

Add first-class `codex` and `claude` support to BeerEngineer for both:

- interactive CLI flows
- autonomous stage and worker runs

Both providers must run in engine-controlled YOLO mode at all times.

That means:

- no provider-side approval prompts
- no provider-side permission escalation pauses
- no hidden interactive confirmation loops
- engine-owned stop/go decisions stay in BeerEngineer

The provider is allowed to think, edit, test, and return structured output, but
it is not allowed to negotiate control flow with the user during a BeerEngineer
run.

## Current Baseline

The current architecture already has the right core split:

- `WorkflowService` owns workflow decisions
- `AutorunOrchestrator` owns autonomous progression
- `AgentAdapter` abstracts model execution
- interactive chat already uses provider-agnostic structured contracts
- the local deterministic adapter proves the contracts without coupling engine
  logic to one specific model runtime

What is still missing is a real hosted-provider layer for:

- Codex
- Claude

and a hard runtime policy that guarantees YOLO execution for both interactive
and autonomous paths.

## Confirmed Design Decisions

### YOLO Is A Runtime Policy, Not A Prompt Convention

Do not rely on prompt text like "work autonomously" as the safety mechanism.

BeerEngineer should introduce an engine-level execution policy:

- `autonomyMode: "yolo"`
- `approvalMode: "never"`
- `filesystemMode: "danger-full-access"`
- `networkMode: "enabled"`
- `interactionMode: "non_blocking"`

The engine should always build adapter requests under that policy, and adapters
must either honor it or fail fast before the run starts.

This must apply equally to:

- `brainstorm:chat`
- `review:chat`
- stage runs
- worker runs
- `autorun`
- retry/remediation runs

### Provider Differences Stay Inside The Adapter

BeerEngineer should not fork workflow logic into "Codex flow" and "Claude flow".

Instead:

- the engine defines one normalized request/response contract
- each provider adapter maps that contract to its own CLI or API
- provider-specific flags, environment variables, and transcript formats stay
  behind the adapter boundary

This is the only way to keep Claude easy to attach after Codex.

### Interactive And Autonomous Execution Need The Same Provider Core

Do not build one adapter path for chat and another unrelated path for autonomous
workers.

Both should share:

- provider selection
- model resolution
- YOLO policy enforcement
- prompt assembly
- transcript capture
- structured output parsing
- error normalization

The difference should only be the contract:

- interactive contracts return assistant messages plus structured patches
- autonomous contracts return bounded stage/worker artifacts

### BeerEngineer Remains Engine-Owned

Codex and Claude are execution backends, not workflow orchestrators.

They must not:

- decide whether `autorun` continues
- invent new engine states
- trigger approvals implicitly from chat
- open ad-hoc subloops outside persisted runtime entities

They may:

- propose updates
- execute bounded work
- emit structured results
- explain blockers

## Target Architecture

### 1. Add A Hosted Adapter Family

Introduce a small provider stack instead of adding two ad-hoc classes.

Recommended structure:

- `src/adapters/hosted/hosted-agent-adapter.ts`
- `src/adapters/hosted/provider-runtime.ts`
- `src/adapters/hosted/providers/codex-adapter.ts`
- `src/adapters/hosted/providers/claude-adapter.ts`
- `src/adapters/hosted/provider-types.ts`

Responsibilities:

- `HostedAgentAdapter`
  - shared orchestration for all remote/CLI-backed providers
  - normalized logging, temp files, timeout handling, transcript capture
  - schema validation handoff
- `CodexAdapter`
  - maps normalized request into Codex invocation
  - enforces Codex-specific YOLO flags
- `ClaudeAdapter`
  - maps normalized request into Claude invocation
  - enforces Claude-specific YOLO flags

The current `LocalCliAdapter` should remain as:

- deterministic test adapter
- local fixture adapter
- contract reference implementation

### 2. Add A File-Based Runtime Config

The current workspace settings only expose:

- `defaultAdapterKey`
- `defaultModel`

That is too small for two real providers plus hard execution policy, and it is
not precise enough to choose different models per interactive flow, stage, or
worker.

For the next slice, BeerEngineer should use a file-based runtime config as the
source of truth.

Recommended file:

- `config/agent-runtime.json`

Why file first:

- easy to version and review
- easy to reproduce locally
- no migration or UI dependency to get started
- gives us a stable schema before we build UI editing on top

This config should already be shaped so the UI can later read and edit the same
structure.

Recommended normalized shape:

```json
{
  "defaultProvider": "codex",
  "policy": {
    "autonomyMode": "yolo",
    "approvalMode": "never",
    "filesystemMode": "danger-full-access",
    "networkMode": "enabled",
    "interactionMode": "non_blocking"
  },
  "defaults": {
    "interactive": {
      "provider": "codex",
      "model": "gpt-5.5"
    },
    "autonomous": {
      "provider": "codex",
      "model": "gpt-5.5"
    }
  },
  "interactive": {
    "brainstorm_chat": {
      "provider": "claude",
      "model": "claude-sonnet"
    },
    "story_review_chat": {
      "provider": "codex",
      "model": "gpt-5.5"
    }
  },
  "stages": {
    "brainstorm": {
      "provider": "claude",
      "model": "claude-sonnet"
    },
    "requirements": {
      "provider": "codex",
      "model": "gpt-5.5"
    },
    "architecture": {
      "provider": "codex",
      "model": "gpt-5.5"
    },
    "planning": {
      "provider": "codex",
      "model": "gpt-5.5"
    }
  },
  "workers": {
    "test_preparation": {
      "provider": "codex",
      "model": "gpt-5.5"
    },
    "execution": {
      "provider": "codex",
      "model": "gpt-5.5"
    },
    "ralph": {
      "provider": "claude",
      "model": "claude-sonnet"
    },
    "app_verification": {
      "provider": "codex",
      "model": "gpt-5.5"
    },
    "story_review": {
      "provider": "claude",
      "model": "claude-sonnet"
    },
    "qa": {
      "provider": "claude",
      "model": "claude-sonnet"
    },
    "documentation": {
      "provider": "claude",
      "model": "claude-sonnet"
    }
  },
  "providers": {
    "codex": {
      "adapterKey": "codex",
      "model": "gpt-5.5",
      "command": ["codex"],
      "env": {},
      "timeoutMs": 1800000
    },
    "claude": {
      "adapterKey": "claude",
      "model": "claude-sonnet",
      "command": ["claude"],
      "env": {},
      "timeoutMs": 1800000
    }
  }
}
```

Notes:

- the engine-level policy must not be overridable to a weaker mode
- the config must support exact model choice per:
  - interactive flow
  - stage
  - worker type
- `defaults.interactive` and `defaults.autonomous` are fallback layers, not the
  only selection points
- provider-specific command/env settings stay under `providers.*`
- this same JSON shape should later become UI-editable

### 3. Define Resolver Precedence Clearly

The resolver should pick provider and model using a deterministic precedence
order.

Recommended order:

1. exact interactive flow override
2. exact stage override
3. exact worker override
4. `defaults.interactive` or `defaults.autonomous`
5. provider-level fallback model
6. fail if still unresolved

Examples:

- `brainstorm:chat` uses `interactive.brainstorm_chat`
- `review:chat` uses `interactive.story_review_chat`
- `requirements:start` uses `stages.requirements`
- `runStoryExecution(...)` uses `workers.execution`
- `runProjectQa(...)` uses `workers.qa`

The engine should not guess from prompt names or adapter keys.

### 4. Add A Provider Resolver

Create one resolver in the app context layer that decides which adapter to use
for each run type.

Recommended behavior:

- load and validate `config/agent-runtime.json`
- resolve provider and model for the concrete interactive flow, stage, or
  worker role
- instantiate the correct provider adapter
- inject the same normalized YOLO policy into every request
- fail fast if the requested provider cannot satisfy the policy

This keeps `WorkflowService` free of provider conditionals.

### 5. UI Compatibility From Day One

Even though the first source of truth is a file, the config shape should be
designed as if the UI will edit it later.

That means:

- no implicit defaults hidden in code if they can be stored explicitly
- no provider-specific blobs at the top level
- stable keys for:
  - interactive flows
  - stages
  - worker types
- schema validation strict enough that a future UI can rely on it

Later migration path:

1. UI reads the same shape from backend
2. backend may still persist to file internally
3. optional later step: persist the same structure in DB
4. file can remain as bootstrap/export format

Do not put the first implementation directly into the database. That would slow
down iteration before we know the final operator-facing model.

### 6. Persist Provider Runtime Metadata

Interactive sessions and autonomous runs should store enough metadata to answer:

- which provider ran
- which model ran
- under which autonomy policy the run was started
- which provider command/API invocation was used

Recommended additions:

- enrich existing agent session payloads with:
  - `provider`
  - `model`
  - `autonomyMode`
  - `approvalMode`
  - `filesystemMode`
  - `networkMode`
  - `interactionMode`

This is important because "always YOLO" should be auditable, not implicit.

## Interactive Path

### Scope

Interactive support applies to:

- `brainstorm:chat`
- `review:chat`

The current contracts are already close to the right abstraction. The next step
is to run them against real providers instead of the deterministic stub.

### Required Work

#### Context Builders

Move interactive context assembly into dedicated builders:

- `buildInteractiveBrainstormContext(...)`
- `buildInteractiveStoryReviewContext(...)`

Each builder should return:

- normalized business context
- recent transcript slice
- latest persisted draft/review state
- explicit allowed actions
- required output contract name

This makes provider switching easier and avoids leaking workflow internals into
provider-specific code.

#### Interactive Prompt Envelopes

Introduce provider-agnostic prompt envelopes that state:

- the user-visible task
- the exact structured output schema
- the rule that no side effects happen from chat alone
- the rule that the session is YOLO/non-blocking

Keep these prompts file-based, similar to other system prompts.

Recommended new prompt files:

- `prompts/interactive/brainstorm-chat.md`
- `prompts/interactive/story-review-chat.md`

#### Interactive Adapter Calls

Implement:

- `CodexAdapter.runInteractiveBrainstorm(...)`
- `CodexAdapter.runInteractiveStoryReview(...)`
- `ClaudeAdapter.runInteractiveBrainstorm(...)`
- `ClaudeAdapter.runInteractiveStoryReview(...)`

All four methods should use the same normalized helper for:

- input serialization
- command/API execution
- stdout/JSON extraction
- retry on malformed but recoverable output
- final schema validation

#### Reask Strategy

Interactive chat needs one bounded repair loop.

Recommended policy:

1. first invalid structured output: automatic reask with validation error summary
2. second invalid output: fail with `INTERACTIVE_AGENT_OUTPUT_INVALID`

Do not allow unlimited retries. That would hide provider drift.

### Interactive Acceptance Criteria

The interactive layer is in a good first production state when:

- the same session can be continued with Codex or Claude
- `brainstorm:chat` produces valid patches on both providers
- `review:chat` produces valid entry updates on both providers
- malformed provider output is retried once and then fails cleanly
- the persisted session metadata shows provider, model, and YOLO policy

## Autonomous Path

### Scope

Autonomous support applies to:

- stage runs via `AgentAdapter.run(...)`
- worker runs:
  - test preparation
  - execution
  - ralph verification
  - app verification
  - story review
  - qa
  - documentation
- all `--autorun` and retry-driven flows

### Required Work

#### Split Generic Stage/Worker Execution From Provider Execution

Right now the adapter interface is already broad enough, but the concrete
implementation is still one local runner.

Add a shared execution base for hosted providers:

- `executeStageContract(...)`
- `executeWorkerContract(...)`

Shared behavior:

- build prompt package
- attach skills
- attach structured output schema name
- attach runtime policy
- execute provider in YOLO mode
- normalize stdout/stderr/session metadata

#### Provider-Specific Worker Packaging

Codex and Claude will likely differ in how they accept:

- system prompt
- user prompt
- tools/filesystem permissions
- working directory
- structured response instructions

That translation belongs in each provider adapter, but the upstream payload must
stay the same.

#### Hard Autorun Guardrail

`AutorunOrchestrator` should assume YOLO, not request it opportunistically.

Recommended change:

- before any autonomous provider run starts, assert:
  - resolved provider exists
  - resolved provider policy is `yolo`
  - provider adapter confirms non-blocking mode

If not, stop with an infrastructure error.

That prevents a misconfigured workspace from silently running "semi-manual"
autorun.

#### Long-Running Session Support

Autonomous runs need stronger runtime handling than interactive chat:

- longer timeouts
- heartbeat or periodic log flushing
- larger stdout capture
- provider interruption normalization

Add one shared run record shape for:

- start metadata
- live progress metadata if available
- final result metadata

This can still be stored inside the existing agent session tables in the first
slice.

### Autonomous Acceptance Criteria

The autonomous path is in a good first production state when:

- `concept:approve --autorun` runs with Codex in YOLO mode end-to-end
- the same path can be switched to Claude only by workspace config
- worker runs keep returning the same JSON output contracts
- provider refusal to honor YOLO mode stops the run immediately
- agent session metadata is sufficient to audit provider/model/policy

## Provider-Specific Notes

### Codex

Codex should be the first real provider implementation because the current
development environment already aligns closely with:

- non-interactive approval policy
- full filesystem access
- command execution
- structured output handling

Implementation focus:

- make the Codex adapter the first hosted reference backend
- keep provider-specific flags isolated in one runtime translator
- do not let Codex-specific request fields leak into `WorkflowService`

### Claude

Claude should be attached immediately after the Codex path works, but not via a
copy-paste fork.

Implementation focus:

- reuse the same hosted adapter base
- reuse the same prompt envelopes and output schemas
- map the same normalized YOLO policy into Claude's own invocation mechanism
- keep any provider-specific transcript parsing inside the Claude adapter

The key success criterion is that enabling Claude should mostly be a config and
adapter exercise, not a workflow rewrite.

## Phased Delivery

### Phase 1: Runtime Policy And Config

Implement:

- `config/agent-runtime.json`
- schema validation for the runtime config
- engine-owned YOLO policy object
- resolver precedence for:
  - interactive flows
  - stages
  - workers
- provider resolver in app context
- metadata persistence for provider/model/policy

Deliverable:

- the engine can resolve `local-cli`, `codex`, or `claude`
- the engine can choose different models per interactive flow, stage, and
  worker
- all runs fail fast if the resolved provider is not YOLO-capable

### Phase 2: Codex Interactive

Implement:

- Codex provider adapter
- interactive context builders
- interactive prompt envelope files
- one-retry reask logic

Verify:

- `brainstorm:chat`
- `review:chat`

### Phase 3: Codex Autonomous

Implement:

- stage and worker execution through Codex
- autorun guardrails
- longer-running session handling

Verify:

- `concept:approve --autorun`
- `review:resolve --action approve_and_autorun`
- one retry path such as `execution:retry --autorun`

### Phase 4: Claude Interactive

Implement:

- Claude provider adapter for the existing interactive contracts

Verify:

- same interactive tests and live runs as Codex

### Phase 5: Claude Autonomous

Implement:

- Claude autonomous stage and worker execution

Verify:

- same autorun and retry flows as Codex

### Phase 6: Hardening

Implement:

- better infrastructure errors for provider launch failures
- clearer malformed-output diagnostics
- provider health checks
- workspace-level verification docs

## Testing Plan

### Unit And Integration

Add tests for:

- provider config parsing
- YOLO policy resolution
- provider/model selection from `config/agent-runtime.json`
- resolver precedence across interactive/stage/worker scopes
- fail-fast when provider cannot satisfy YOLO mode
- interactive reask after invalid output
- persisted agent metadata includes provider/model/policy

### End-To-End

Add e2e slices for:

- Codex interactive brainstorm
- Codex interactive story review
- Codex autorun from concept approval
- Claude interactive brainstorm
- Claude interactive story review
- Claude autorun from concept approval

### Live Runs

Minimum live runs before calling the feature usable:

1. Codex:
   - `brainstorm:show`
   - `brainstorm:chat`
   - `brainstorm:promote --autorun`
2. Codex:
   - `review:start`
   - `review:chat`
   - `review:resolve --action approve_and_autorun`
3. Claude:
   - same two flows

## Risks And Non-Goals

### Risks

- provider CLIs may drift in flags or transcript shape
- YOLO semantics may not map 1:1 across providers
- long autonomous runs may require stronger process management than the local
  stub needed
- prompt envelopes may need small provider-specific tuning even with shared
  contracts

### Non-Goals For The First Slice

- multi-provider voting or ensemble runs
- dynamic fallback from one provider to another mid-run
- provider-specific workflow branches
- letting providers bypass BeerEngineer workflow rules
- weakening YOLO mode for "safer" interactive sessions

## Recommended First Implementation Order

Build in this order:

1. provider runtime config plus hard YOLO policy
2. hosted adapter base
3. Codex interactive
4. Codex autonomous
5. Claude interactive
6. Claude autonomous
7. hardening and docs

This order keeps the highest-value path first while preserving the core design
constraint: Claude must plug into the same engine boundary instead of becoming a
parallel second system.
