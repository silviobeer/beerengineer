# Engine Architecture

> Reference for `@beerengineer2/engine`'s internal structure. Source of truth
> is the code; this doc explains the *shape*. If something below disagrees
> with the code, the code wins — file an issue or send a PR for the doc.

## TL;DR

The engine is a **registry-driven pipeline** with **injected dependencies**:

- A `PROJECT_STAGE_REGISTRY` lists the project-level stages in execution
  order. The orchestrator iterates that array; adding/removing/reordering
  a stage is a one-line registry edit, not a control-flow rewrite.
- Each stage is a `ProjectStageNode` with `run()` and `resumeFromDisk()`
  methods. State flows through a `ProjectContext` that the loop folds
  per-stage outputs into.
- Side effects (git, LLM dispatch, iteration cadence) are **adapters**,
  not ambient module-level capabilities. Stages get them through a
  `StageDeps` bundle.
- Real git is **mandatory**. There is no simulated mode; preconditions
  that used to fall through to a sim now throw with a precise reason.

## Pipeline

### Per-project flow (`PROJECT_STAGE_REGISTRY`)

| # | Stage id          | Produces                | Notes                         |
|---|-------------------|-------------------------|-------------------------------|
| 1 | `requirements`    | `prd`                   |                               |
| 2 | `architecture`    | `architecture`          | Depends on `prd`              |
| 3 | `planning`        | `plan`                  | Depends on `architecture`     |
| 4 | `execution`       | `executionSummaries`    | Owns the Ralph runtime        |
| 5 | `project-review`  | `projectReview`         |                               |
| 6 | `qa`              | (void)                  | Runs gate; produces no artifact |
| 7 | `documentation`   | `documentation`         |                               |
| 8 | `handoff`         | (void, side-effecting)  | Real-git project→item merge confirmation |

The same data, expressed declaratively for tooling, lives in
`apps/engine/src/core/flowDefinition.ts` (`PROJECT_FLOW`). A small
cross-check test (`apps/engine/test/flowDefinition.test.ts`) prevents
the executable registry and the data descriptor from drifting.

### Per-item flow (design-prep)

```
brainstorm → visual-companion → frontend-design → (per-project pipeline) ×N
```

`brainstorm` is the only mandatory item-level stage. `visual-companion`
and `frontend-design` run only when at least one project has a UI.

The **brainstorm stage owns the item branch + worktree creation**: its
first action is `git.ensureItemBranch()` followed by
`git.assertWorkspaceRootOnBaseBranch(...)`. Stages own their side
effects; `runWorkflow` doesn't perform git operations on its behalf.

The resume-past-brainstorm path (when artifacts already exist) is the
single exception: `runWorkflow` performs an idempotent
`git.ensureItemBranch()` itself, in case the operator nuked
`.beerengineer/` between runs. This is a recovery safety net, not the
fresh-run path.

## Core abstractions

### `ProjectStageNode`

```ts
interface ProjectStageNode {
  readonly id: ProjectStageId
  run(ctx: ProjectContext, deps: StageDeps): Promise<ProjectContext>
  resumeFromDisk(ctx: ProjectContext): Promise<ProjectContext>
}
```

Each node owns the stage-specific logic (LLM dispatch, persistence,
type-narrowing assertions). The orchestrator only knows about the
shape, never the contents. See `apps/engine/src/core/projectStageRegistry.ts`.

### `StageDeps`

```ts
type StageDeps = {
  llm?: { stage?: RunLlmConfig; execution?: ExecutionLlmOptions }
  resume?: ProjectResumePlan
  git: GitAdapter
}
```

The single bundle threaded through the loop. Stages call `deps.git.*`
and `deps.llm?.*` instead of importing module-level singletons.

### `GitAdapter`

```ts
interface GitAdapter {
  readonly mode: GitMode               // captures workspaceRoot, baseBranch, itemWorktreeRoot
  readonly enabled: true                // legacy field; always true now

  ensureItemBranch(): void
  ensureProjectBranch(projectId: string): void
  ensureWaveBranch(projectId: string, waveNumber: number): string
  ensureStoryBranch(projectId: string, waveNumber: number, storyId: string): string
  ensureStoryWorktree(projectId, waveNumber, storyId, worktreeRoot): string
  mergeStoryIntoWave(...)
  mergeWaveIntoProject(...)
  mergeProjectIntoItem(projectId): void
  abandonStoryBranch(...): { abandonedRef: string } | null
  removeStoryWorktree(worktreeRoot): void
  exitRunToItemBranch(): string
  assertWorkspaceRootOnBaseBranch(label: string): void
  gcManagedStoryWorktrees(managedRoot): ManagedWorktreeGcResult
}
```

Built once at run-start by `createGitAdapter(context)`, threaded through
`runProject` into each stage's `deps.git`. The constructor throws if the
workspace can't host real-git (no `workspaceRoot`, not a git repo, dirty
checkout, missing `itemSlug`); `runWorkflow` translates that into the
existing `blockRunForWorkspaceState` recovery path.

Test injection: `createGitAdapterFromMode(context, mode)` accepts a
pre-baked `GitMode` so tests don't need a real filesystem state probe.

### `LLM_STAGE_REGISTRY` and the create helpers

```ts
const LLM_STAGE_REGISTRY: Record<LlmStageId, AnyEntry> = {
  brainstorm:      { fakeStage: () => new FakeBrainstormStageAdapter(), ... },
  ...
}

export function createStageAdapter<S, A>(stageId, llm?, project?): StageAgentAdapter<S, A>
export function createReviewAdapter<S, A>(stageId, llm?): ReviewAgentAdapter<S, A>
```

One table, two helpers. When `llm` is supplied, the hosted (Claude/
Codex/etc.) adapter is used; otherwise the fake constructor registered
for the stage runs. The 18 narrow `createXxxStage` / `createXxxReview`
exports are one-liners over the generics, kept so consumer modules can
import a strongly-typed factory per stage without supplying type
arguments at the call site.

`LlmStageId = Exclude<StageId, "execution">`: the execution stage owns
the Ralph runtime instead of a stage agent — its per-story test plans go
through `test-writer`.

### `runCycledLoop` (the iterate-then-review helper)

```ts
type CycleOutcome<R> =
  | { kind: "done"; result: R }
  | { kind: "continue"; nextFeedback?: string }
  | { kind: "exhausted" }

runCycledLoop<R>({
  maxCycles, startCycle?, initialFeedback?,
  runCycle: (args) => Promise<CycleOutcome<R>>,
  onAllCyclesExhausted: () => Promise<R>,
})
```

Currently used by the Ralph review-cycle loop in
`stages/execution/ralphRuntime.ts`. The inner per-iteration loop in
`runCoderCycleUntilGreen` deliberately stays as a plain `while` because
its semantics differ (no review step, no feedback threading) — folding
it into the same helper would dilute `CycleOutcome`.

### `LoopConfig` (Ralph cadence)

```ts
type LoopConfig = { maxIterationsPerCycle: number; maxReviewCycles: number }
```

Defaults: `4` iterations per cycle, `3` review cycles. Override via env:

- `BEERENGINEER_MAX_ITERATIONS_PER_CYCLE`
- `BEERENGINEER_MAX_REVIEW_CYCLES`

Resolved once at module load in `apps/engine/src/core/loopConfig.ts`.

## Why real-git is mandatory

Earlier versions had a simulated branch graph (`repoSimulation.ts`,
`SimulatedBranch`, `SimulatedRepoState`) that ran in-memory when the
workspace wasn't a clean git repo. It was deleted because:

- It quietly diverged from real-git semantics under stress (concurrent
  story merges, conflicting shared files).
- Tests that "passed" against the sim said nothing about real-repo
  correctness.
- Two state machines for the same operations meant every git change
  had to be implemented twice.

Now `detectGitMode()` throws with a precise reason on every precondition
that used to fall back: missing `workspaceRoot`, not a git repo, dirty
checkout, missing `itemSlug`. The tests that used to lean on simulation
either seed a real-git workspace via `seedCleanGitRepo()` or have been
rewritten to assert that the throw happens.

## Modularity scorecard

How "n8n-like" is the engine? Five axes, each scored against what a node-
graph workflow tool would offer:

| Axis                 | Where it lives                                          | Score |
|----------------------|---------------------------------------------------------|-------|
| Stage pluggability   | `core/projectStageRegistry.ts` — one array, no special cases | 5/5 |
| LLM provider swap    | `llm/registry.ts` — single `LLM_STAGE_REGISTRY`         | 5/5 |
| Loop reuse           | `core/iterationLoop.ts` (`runCycledLoop`)               | 4/5 |
| Boundary typing      | `core/adapters.ts` + per-stage state/artifact types      | 5/5 |
| Side-effect isolation| `GitAdapter`, `StageDeps`, real-git mandatory           | 5/5 |

**Why loop reuse is 4/5, not 5/5**: the inner per-iteration loop in
`runCoderCycleUntilGreen` (`stages/execution/ralphRuntime.ts:723-748`)
isn't routed through `runCycledLoop`. Its semantics differ (no review,
no feedback thread, just budget-bounded retry). Forcing it into the
same helper would either dilute `CycleOutcome` or split into two
near-duplicate helpers — neither is an improvement until a third
consumer exists. This is the honest ceiling for the codebase as it stands.

## File map

```
apps/engine/src/
├── workflow.ts                     ← runWorkflow + per-project loop
├── index.ts                        ← CLI entry point
├── core/
│   ├── projectStageRegistry.ts     ← PROJECT_STAGE_REGISTRY
│   ├── flowDefinition.ts           ← PROJECT_FLOW (data descriptor)
│   ├── gitAdapter.ts               ← GitAdapter + factory
│   ├── git.ts                      ← real-git operations (free funcs)
│   ├── branchNames.ts              ← pure branch-name helpers
│   ├── iterationLoop.ts            ← runCycledLoop
│   ├── loopConfig.ts               ← LoopConfig + env overrides
│   ├── adapters.ts                 ← StageAgentAdapter / ReviewAgentAdapter
│   └── stageRuntime.ts             ← runStage (per-stage shell loop)
├── llm/
│   ├── registry.ts                 ← LLM_STAGE_REGISTRY + create helpers
│   ├── fake/                       ← per-stage offline adapters
│   └── hosted/                     ← Claude/Codex adapters
└── stages/
    ├── brainstorm/                 ← stage modules: each owns its own state/artifact types
    ├── visual-companion/
    ├── frontend-design/
    ├── requirements/
    ├── architecture/
    ├── planning/
    ├── execution/
    │   ├── index.ts                ← per-wave orchestration
    │   └── ralphRuntime.ts         ← per-story iterate-then-review loop
    ├── project-review/
    ├── qa/
    ├── documentation/
    └── handoff/                    ← end-of-run confirmation
```

## Adding a new project-level stage

1. **Define types**: create `stages/<name>/types.ts` with the stage's
   state and artifact shapes.
2. **Implement**: `stages/<name>/index.ts` exports a function that takes
   the appropriate `WithXxx` context type and an optional `RunLlmConfig`,
   uses `runStage(...)` from `core/stageRuntime.ts`, returns the artifact.
3. **Register the LLM adapters**: add an entry to `LLM_STAGE_REGISTRY`
   in `llm/registry.ts` mapping the stage id to its `Fake*` adapter
   constructors. (Optional: add a one-line narrow `createXxxStage` /
   `createXxxReview` export below.)
4. **Register the stage**: add a `ProjectStageNode` entry to
   `PROJECT_STAGE_REGISTRY` in `core/projectStageRegistry.ts`. The
   `run` callback wires the imports together; `resumeFromDisk` loads
   the persisted artifact.
5. **Describe in the flow**: add a matching `FlowNode` to `PROJECT_FLOW`
   in `core/flowDefinition.ts`.
6. **Update the StageId union** in `llm/registry.ts` if the stage name is new.

The orchestrator (`runProject` in `workflow.ts`) needs no changes.
