# BeerEngineer2 — real review tooling implementation plan

Plan for wiring real CodeRabbit and SonarCloud into the execution-stage
review loop in `beerengineer2`.

This plan follows the process chain already present in the repo:

- item action / run start
- workflow orchestration
- execution stage
- Ralph story implementation loop
- parallel story review
- remediation loop
- pass or block

The key point: CodeRabbit and SonarCloud are **not** stage LLMs and should
not be wired into the hosted LLM provider layer. They belong in the Ralph
story review loop as deterministic review-tool integrations.

## Current process chain

The current path is:

1. item/UI action starts or resumes a run
2. run orchestrator prepares workflow context
3. workflow enters execution
4. execution runs stories
5. Ralph implements a story
6. review tools run in parallel
7. merged findings feed back into Ralph
8. loop repeats until pass or stop condition

Relevant code:

- `apps/engine/src/core/itemActions.ts`
- `apps/engine/src/core/runOrchestrator.ts`
- `apps/engine/src/workflow.ts`
- `apps/engine/src/stages/execution/index.ts`
- `apps/engine/src/stages/execution/ralphRuntime.ts`
- `apps/engine/src/core/parallelReview.ts`

Current state:

- Ralph execution is partly real now for coder harness wiring.
- CodeRabbit and Sonar review are still fake simulations in
  `apps/engine/src/sim/llm.ts`.
- Review fanout happens in `runStoryReview()` inside
  `apps/engine/src/stages/execution/ralphRuntime.ts`.
- Sonar workspace metadata already exists in workspace config and setup.
- Doctor already probes `coderabbit`, `sonar-scanner`, and `sonarqube-cli`.

## Goal

Replace fake `crReview()` and `sonarReview()` with real integrations while
keeping the existing Ralph review contract:

- CodeRabbit and Sonar run in parallel
- both return findings for the current story
- BeerEngineer merges the findings
- blocking findings are fed back to the worker
- the remediation loop is bounded
- unresolved critical/high issues or repeated quality gate failures block the
  story

## Non-goals

- Moving CodeRabbit or Sonar into the LLM provider registry
- Replacing the project-review or QA stages with these tools
- Making Sonar MCP the engine’s only source of truth for gating
- Introducing unbounded “keep fixing until green” autonomy

## Intended review loop

Per story:

1. Ralph implements or applies remediation.
2. Engine computes story diff relative to the stable baseline SHA.
3. CodeRabbit review and Sonar review start in parallel.
4. Engine normalizes both outputs into BeerEngineer findings.
5. Engine decides:
   - pass
   - revise
   - block
6. On `revise`, feedback summary is sent into the next Ralph remediation
   iteration.
7. Loop stops when:
   - both gates are acceptable, or
   - maximum review cycles is reached, or
   - maximum implementation iterations for the cycle is reached, or
   - blocking critical/high issues remain at the limit

Low-severity findings may still be recorded on a passing story. They are not
necessarily gating.

## Architecture

### 1. Add a dedicated review-tool integration layer

Create:

```text
apps/engine/src/review/
├── registry.ts
├── types.ts
├── coderabbit.ts
├── sonarcloud.ts
├── commandRunner.ts
└── artifacts.ts
```

Responsibilities:

- resolve fake vs real review-tool execution
- run CodeRabbit and SonarCloud in parallel
- parse and normalize tool outputs
- produce one BeerEngineer-owned `StoryReviewRun`
- persist raw evidence artifacts

This layer sits below Ralph, not below the LLM provider registry.

### 2. Keep BeerEngineer-owned review output shapes

Do not change the Ralph-facing contract.

Keep:

- `Finding`
- `StoryReviewArtifact`
- `StoryReviewArtifact["gate"]["sonar"]`
- `feedbackSummary`

The tool adapters must map their native outputs into these existing shapes.

That keeps the rest of Ralph unchanged:

- `buildReviewArtifact()`
- `buildFeedbackSummary()`
- `recordStoryBlocked()`

### 3. Use baseline-aware story scoping

Review must be scoped to the current story, not the whole dirty repo.

Use the existing Ralph baseline discipline:

- capture story baseline SHA once before iteration 1
- compute changed files relative to that baseline
- pass changed files and baseline SHA into CodeRabbit and Sonar adapters

Required behavior:

- tracked diff from `git diff --name-only <baseline>`
- untracked files via `git ls-files --others --exclude-standard`
- adapter receives:
  - `workspaceRoot`
  - `baselineSha`
  - `changedFiles`
  - `storyId`
  - `reviewCycle`

### 4. CodeRabbit: one-shot adapter

Implementation:

- run `coderabbit` once per review cycle
- scope review to the story diff if the CLI supports file filtering or diff
  input
- prefer machine-readable output if supported
- otherwise persist raw output and parse only the stable subset required for
  findings

Adapter output:

```ts
type CodeRabbitResult = {
  findings: Finding<"coderabbit">[]
  rawPath: string
  command: string[]
  exitCode: number
}
```

Gating rule:

- any `critical` or `high` finding blocks the story gate

Medium/low findings are still included in feedback and artifacts.

### 5. SonarCloud: scan + gate fetch

Implementation should be engine-owned and deterministic.

Recommended primary path:

1. run `sonar-scanner` in the workspace root
2. wait/poll for analysis completion
3. fetch quality gate result and issues through Sonar API or `sonarqube-cli`

Adapter output:

```ts
type SonarCloudResult = {
  passed: boolean
  conditions: Array<{
    metric: "reliability" | "security" | "maintainability"
    status: "ok" | "error"
    actual: string
    threshold: string
  }>
  findings: Finding<"sonarqube">[]
  rawScanPath: string
  rawGatePath: string
  command: string[]
  exitCode: number
}
```

Gating rule:

- failed quality gate blocks the story gate

### 6. Sonar MCP: optional assist, not primary gate backend

Sonar MCP may be used, but not as the engine’s only source of truth.

Use Sonar MCP for:

- feeding Sonar findings into Claude/Codex prompts
- allowing the worker/reviewer harness to inspect project issues
- augmenting remediation context

Do not use Sonar MCP as the only gate backend for Ralph because:

- the execution gate should be engine-owned and deterministic
- scanner + API/CLI polling is more direct and auditable
- MCP is a better fit for harness-side context than for hard gating

So the preferred model is:

- primary: `sonar-scanner` + API / `sonarqube-cli`
- optional: Sonar MCP as extra context for hosted harnesses

### 7. Replace fake review calls in Ralph

In `apps/engine/src/stages/execution/ralphRuntime.ts`:

- replace direct imports from `apps/engine/src/sim/llm.ts`
  - `crReview`
  - `sonarReview`
- replace `runStoryReview()` internals with a call into the new review
  registry

Target shape:

```ts
const reviewResult = await runStoryReviewTools({
  workspaceRoot,
  storyContext,
  implementation,
  baselineSha,
  changedFiles,
  reviewCycle,
})
```

The rest of Ralph should stay mostly unchanged:

- merged findings
- `failedBecause`
- `feedbackSummary`
- pass/revise/block transitions

### 8. Make fake review an explicit override

Do not silently keep using fake review in live runs.

Rules:

- tests may force fake review
- `BEERENGINEER_FORCE_FAKE_REVIEW=1` may force fake review
- otherwise, enabled real review tools must resolve or the story should fail
  with a clear configuration/runtime error

This should mirror the new real LLM provider behavior.

### 9. Add review-tool config to workspace config

Current workspace config already contains Sonar project metadata, but the
runtime shape should become explicit.

Add:

```ts
type WorkspaceReviewPolicy = {
  coderabbit: {
    enabled: boolean
  }
  sonarcloud: {
    enabled: boolean
    projectKey?: string
    organization?: string
    hostUrl?: string
  }
}
```

Recommended migration defaults:

- old workspaces:
  - `coderabbit.enabled = true`
  - `sonarcloud.enabled = sonar.enabled`
  - `projectKey/organization/hostUrl` copied from existing Sonar config

Keep upgrade-on-write semantics.

### 10. Persist raw review evidence

Per story review cycle, write artifacts such as:

- `coderabbit-cycle-<n>.raw.txt` or `.json`
- `sonar-scan-cycle-<n>.raw.txt`
- `sonar-gate-cycle-<n>.json`
- `review-tools-cycle-<n>.json`

This is required for:

- debugging parse failures
- operator inspection
- recovery evidence
- auditing why a story was blocked

### 11. Extend doctor checks

Doctor already probes binaries. Extend it to validate runtime readiness.

Add checks such as:

- `review.coderabbit.auth`
- `review.sonar.token`
- `review.sonar.workspace-config`
- `review.sonar.project-binding`

Doctor output should separate:

- binary missing
- auth missing
- workspace Sonar config missing
- project key / organization missing
- scanner config mismatch

### 12. Logging and observability

Emit facts into logs per review cycle:

- CodeRabbit selected and started
- Sonar scan started
- Sonar gate fetch started
- changed files count
- baseline SHA
- command exit code
- parsed findings count
- gating reasons

Do not log tokens or secrets.

## File changes

### New

- `apps/engine/src/review/types.ts`
- `apps/engine/src/review/registry.ts`
- `apps/engine/src/review/coderabbit.ts`
- `apps/engine/src/review/sonarcloud.ts`
- `apps/engine/src/review/commandRunner.ts`
- `apps/engine/src/review/artifacts.ts`

### Update

- `apps/engine/src/stages/execution/ralphRuntime.ts`
- `apps/engine/src/types/workspace.ts`
- `apps/engine/src/core/workspaces.ts`
- `apps/engine/src/setup/doctor.ts`
- `apps/engine/src/index.ts`
- `apps/engine/src/api/server.ts`

## Rollout order

### Phase 1

- add `review/` abstraction
- move fake review resolution behind registry
- replace direct `sim/llm.ts` imports in Ralph
- keep fake adapters as default in tests

### Phase 2

- implement real SonarCloud adapter
- wire scanner + gate polling
- persist raw Sonar artifacts
- add doctor/runtime config validation

### Phase 3

- implement real CodeRabbit adapter
- wire structured output or conservative parser
- add raw CodeRabbit artifacts
- tighten gating and error handling

### Phase 4

- optional Sonar MCP augmentation for hosted harness prompts
- pass Sonar context into remediation prompts for Codex/Claude
- keep engine-owned scanner/gate path as primary truth

## Test plan

### Unit

- severity mapping
- CodeRabbit parsing
- Sonar gate parsing
- finding deduplication
- fake vs real resolution

### Integration

- Ralph review loop receives merged findings from both tools
- critical/high CodeRabbit issues block
- failed Sonar gate blocks
- passing gate with low findings still passes
- missing real tool when enabled fails clearly

### Hermetic runtime tests

- inject command runners instead of shelling out in CI
- simulate:
  - scan success + gate fail
  - scan success + gate pass
  - CodeRabbit high finding
  - CodeRabbit medium/low only
  - malformed tool output

## Risks

- CodeRabbit CLI may not offer a stable machine-readable output format.
- SonarCloud analysis is asynchronous and requires polling.
- Whole-repo review instead of story-diff review will create noisy blockers.
- Silent fallback to fake review would undermine trust.

## Decision summary

The correct process placement is:

- inside Ralph
- per story
- after code implementation
- before story pass/merge
- with CodeRabbit and Sonar run in parallel
- with merged findings fed back into the worker
- with explicit bounded loops and explicit block conditions

That matches the current execution model and keeps the architecture clean.
