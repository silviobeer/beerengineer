# BeerEngineer2 — real review tooling implementation plan

Plan for wiring real CodeRabbit and SonarQube Cloud into the execution-stage
review loop in `beerengineer2`.

This plan follows the process chain already present in the repo:

- item action / run start
- workflow orchestration
- execution stage
- Ralph story implementation loop
- parallel story review
- remediation loop
- pass or block

The key point: CodeRabbit and Sonar are **not** stage LLMs and should not be
wired into the hosted LLM provider layer. They belong in the Ralph story
review loop as deterministic review-tool integrations.

Important runtime policy:

- if CodeRabbit or Sonar are not configured in setup, they are explicitly
  skipped
- if either tool fails at runtime, that failure is documented in logs and
  artifacts, but does not block the process by itself
- only successful review findings may influence the revise/block decision

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
- unconfigured or failing review tools are documented and skipped, not
  treated as blocking failures

## Non-goals

- Moving CodeRabbit or Sonar into the LLM provider registry
- Replacing the project-review or QA stages with these tools
- Making Sonar MCP the engine's only source of truth for gating
- Introducing unbounded "keep fixing until green" autonomy

## Intended review loop

Per story:

1. Ralph implements or applies remediation on the story branch.
2. Engine computes story diff relative to the stable baseline SHA.
3. CodeRabbit review and Sonar review start in parallel.
4. Engine normalizes both outputs into BeerEngineer findings.
5. Engine decides: pass, revise, block, or skip-with-warning (disabled/failed
   tools).
6. On `revise`, feedback summary is sent into the next Ralph remediation
   iteration. The feedback summary must declare per-tool status so the worker
   does not mistake a skipped tool for a green gate.
7. Loop stops when both gates are acceptable, or when a bounded stop
   condition triggers (see exit-criteria table below).

Low-severity findings may still be recorded on a passing story. They are not
necessarily gating.

If a tool is skipped or fails:

- record the skip/failure in artifacts and logs
- continue with any remaining successful review tools
- if both tools are skipped or fail, continue without review-tool gating for
  that cycle

### Exit criteria

Single table of stop conditions so the behavior is unambiguous:

| Condition                                                   | Outcome        | Recorded as                                   |
|-------------------------------------------------------------|----------------|-----------------------------------------------|
| All successful tools pass                                   | `pass`         | `gate.verdict = pass`                         |
| Any successful tool returns blocking finding, cycles left   | `revise`       | `feedbackSummary` + next Ralph iteration      |
| Blocking finding still present at `maxReviewCycles`         | `block`        | `recordStoryBlocked` with cycle-exhausted     |
| Implementation iterations hit `maxImplementationIterations` | `block`        | `recordStoryBlocked` with implementation-exhausted |
| All tools `skipped`                                         | `pass` (warn)  | `gate.verdict = pass-unreviewed`              |
| All tools `failed`                                          | `pass` (warn)  | `gate.verdict = pass-tool-failure`            |
| Mixed: one tool passes, other `skipped` or `failed`         | `pass` (warn)  | `gate.verdict = pass-partial`                 |
| Mixed: one successful tool blocks, other `skipped`/`failed` | `revise`/`block` | Gate is derived from successful tool only    |

Rule: `failedBecause` is only derived from the findings of tools whose
`status === "ran"`. Tools that are `skipped` or `failed` contribute evidence
and warnings but never gate failures.

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
- record per-tool status: `ran`, `skipped`, or `failed`

This layer sits below Ralph, not below the LLM provider registry.

### 2. Keep BeerEngineer-owned review output shapes, extend for skip/fail

Do not change the Ralph-facing contract shape, but extend it so skip/fail
round-trip into `StoryReviewArtifact`.

Keep:

- `Finding`
- `StoryReviewArtifact`
- `feedbackSummary`

Extend `StoryReviewArtifact["gate"]` so each tool's sub-result is three-state:

```ts
type ToolGate =
  | { status: "ran"; passed: boolean; conditions?: GateCondition[] }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string; exitCode?: number }
```

Without this, `skipped` collapses to `passed: true` and the audit trail
promised in §10 disappears. `parallelReview.ts` and any UI that reads
`gate.sonar` must accept the extended shape.

Adapters also expose the same three-state `status` on their result object so
the engine can distinguish:

- no findings because the tool passed cleanly
- no findings because the tool was skipped
- no findings because the tool failed to run

That keeps the rest of Ralph logically unchanged:

- `buildReviewArtifact()`
- `buildFeedbackSummary()` — updated to declare per-tool status in the
  summary text so remediation prompts know what actually ran
- `recordStoryBlocked()`

### 3. Use branch-aware story scoping

Review must be scoped to the current story, not the whole dirty repo.

We create a **branch per story execution**, so Sonar uses native branch
analysis rather than file-level diff filtering. CodeRabbit still uses the
diff against the baseline SHA.

Use the existing Ralph baseline discipline, plus the story branch:

- create/ensure a story branch before iteration 1 (e.g.
  `beerengineer/<runId>/<storyId>`)
- capture story baseline SHA once before iteration 1
- compute changed files relative to that baseline
- pass baseline SHA, branch, and changed files into adapters

Required behavior:

- tracked diff from `git diff --name-only <baselineSha>`
- untracked files via `git ls-files --others --exclude-standard`
- adapter input:
  - `workspaceRoot`
  - `baselineSha`
  - `storyBranch`
  - `baseBranch` (Sonar reference branch, typically `main`)
  - `changedFiles`
  - `storyId`
  - `reviewCycle`

### 4. CodeRabbit: one-shot adapter

⚠ Phase 0 discovery is required first (see Rollout). Adapter shape below is
provisional.

Implementation:

- run `coderabbit` once per review cycle
- scope review to the story diff if the CLI supports file filtering or diff
  input; fall back to repo-root scan otherwise
- prefer machine-readable output if supported
- otherwise persist raw output and parse only the stable subset required for
  findings

Adapter output:

```ts
type CodeRabbitResult = {
  status: "ran" | "skipped" | "failed"
  reason?: string
  findings: Finding<"coderabbit">[]
  summary?: string
  rawPath: string
  command: string[]
  exitCode: number
}
```

Gating rule:

- any `critical` or `high` finding blocks the story gate

Medium/low findings are still included in feedback and artifacts.

Failure/skip rule:

- if CodeRabbit is disabled, unavailable, or fails at runtime, mark it
  `skipped` or `failed`, persist evidence, and continue

### 5. SonarQube Cloud: branch scan + gate fetch

The two official SonarSource CLIs are split: `sonar-scanner` runs analysis,
`sonarqube-cli` queries results. Use both in their native roles.

#### 5.1 Scan (gate source): `sonar-scanner` per story branch

1. run `sonar-scanner` in the workspace root with branch analysis parameters:
   - `sonar.branch.name=${storyBranch}`
   - `sonar.branch.target=${baseBranch}` (only if base isn't the project
     default; newer scanners infer automatically)
   - `sonar.host.url`, `sonar.organization`, `sonar.projectKey` from
     workspace config
   - `sonar.region=us` only when the org is in the US region (see §9.1)
   - `sonar.login` / token via `SONAR_TOKEN` env (never log)
2. capture scanner stdout/stderr to `sonar-scan-cycle-<n>.raw.txt`
3. parse `report-task.txt` to get the `ceTaskUrl` and `ceTaskId`
4. poll the compute-engine task until it finishes (see polling contract
   below)

Polling contract:

- endpoint: `GET ${ceTaskUrl}` (or `api/ce/task?id=${ceTaskId}`)
- cadence: exponential backoff starting at 2s, capped at 15s
- total timeout: 5 minutes per scan (configurable per workspace)
- success: task status `SUCCESS` → proceed to gate fetch
- outcome `CANCELED`, `FAILED`: adapter result `status: "failed"` with the
  server-provided reason
- timeout: adapter result `status: "failed"` with `reason: "ce-task-timeout"`

#### 5.2 Gate fetch (read-back): `sonarqube-cli` or raw API

After the CE task is `SUCCESS`, fetch:

- `api/qualitygates/project_status?analysisId=<id>` (or branch-scoped
  `projectKey + branch=${storyBranch}`)
- `api/issues/search?componentKeys=${projectKey}&branch=${storyBranch}&resolved=false&ps=500`
  (paginate if needed)

Either call via `sonarqube-cli` (preferred for auth/token handling) or raw
HTTP with the workspace token. Both paths should be supported; `sonarqube-cli`
is the default when available.

Adapter output:

```ts
type SonarCloudResult = {
  status: "ran" | "skipped" | "failed"
  reason?: string
  passed: boolean
  conditions: Array<{
    metric: "reliability" | "security" | "maintainability" | string
    status: "ok" | "error"
    actual: string
    threshold: string
  }>
  findings: Finding<"sonarqube">[]
  summary?: string
  rawScanPath: string
  rawGatePath: string
  command: string[]
  exitCode: number
}
```

Gating rule:

- failed quality gate blocks the story gate

Failure/skip rule:

- if Sonar is disabled, unavailable, or fails at runtime, mark it `skipped`
  or `failed`, persist evidence, and continue

#### 5.3 Concurrency

SonarCloud serializes analyses **per project + branch**. Since we use one
branch per story, parallel stories analyze in parallel without contention.
Parallel revise iterations on the **same** story (same branch) do contend —
the registry must serialize scan invocations within a single story branch
until the previous CE task reaches a terminal state.

### 5.4 Plan tier prerequisites

SonarQube Cloud branch analysis is **not available on the Free plan** —
Free limits branch analysis to the main branch, and PR analysis to PRs
targeting main. Because BeerEngineer creates a branch per story, a Free-plan
workspace cannot gate on Sonar without falling back to main-only or
skipping.

Required behavior:

- workspace config stores the detected/declared plan tier
- if Free:
  - adapter marks Sonar `skipped` for non-main stories with
    `reason: "sonarcloud-free-plan"`
  - doctor emits a clear warning with upgrade guidance
  - setup docs explain this explicitly
- if paid/OSS:
  - branch analysis runs normally

OSS plan: unlimited branch analysis for qualifying open-source orgs.

### 6. Sonar MCP is `sonarqube-cli --mcp`

Clarification: `sonarqube-cli` ships an MCP server mode. That is the "Sonar
MCP" referenced in older docs — it is not a separate product. Use it for:

- feeding Sonar findings into Claude/Codex prompts during remediation
- allowing the worker/reviewer harness to inspect project issues
- augmenting remediation context

Do not use Sonar MCP as the engine's gate backend:

- the execution gate must be engine-owned and deterministic
- scanner + API/CLI polling is direct and auditable
- MCP is harness-side context, not a hard-gating source

Preferred model:

- primary (gate): `sonar-scanner` + `sonarqube-cli`/API for gate+issues
- optional (context): `sonarqube-cli --mcp` wired into hosted harnesses

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
  storyBranch,
  baseBranch,
  changedFiles,
  reviewCycle,
})
```

The rest of Ralph should stay mostly unchanged:

- merged findings
- `failedBecause`
- `feedbackSummary`
- pass/revise/block transitions

Semantic rule:

- `failedBecause` must be derived only from tool results with
  `status === "ran"`
- tool runtime errors become warnings/evidence, not gate failures
- `buildFeedbackSummary()` must annotate skipped/failed tools in the text
  passed to the worker so the next iteration doesn't treat silence as green

### 8. Review-tool execution: configuration resolution

Single resolution rule (pick one; this supersedes the earlier two
mechanisms):

```text
fakeRequested = process.env.BEERENGINEER_FORCE_FAKE_REVIEW === "1"
              || registry.hasTestInjection()
```

- `BEERENGINEER_FORCE_FAKE_REVIEW=1` overrides everything (tests, debugging)
- `registry.hasTestInjection()` is the programmatic hook for unit/integration
  tests that want to inject deterministic adapters
- otherwise real adapters run according to workspace config

Real-adapter resolution rules:

- configured + enabled tools attempt to run
- unconfigured/disabled tools → `skipped`
- tool binary/auth missing → `skipped` with explanatory reason
- tool crashes or returns non-zero without structured output → `failed`
- story continues unless a successful tool's findings block

This is intentionally softer than the LLM provider behavior because review
tooling is supportive gate infrastructure, not the core execution path.

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
    hostUrl?: string // defaults to https://sonarcloud.io
    region?: "eu" | "us"
    planTier?: "free" | "team" | "enterprise" | "oss" | "unknown"
    baseBranch?: string // defaults to repo default branch
    scanTimeoutMs?: number // default 5 * 60_000
  }
}
```

`SONAR_TOKEN` sourcing order (first hit wins):

1. `process.env.SONAR_TOKEN`
2. workspace-local `.env` read by the engine at start (never persisted back)
3. OS keychain entry keyed by `projectKey` (optional, behind feature flag)

Token never appears in logs, artifacts, or error messages. Missing token for
an `enabled: true` Sonar config → adapter `status: "failed"` with
`reason: "sonar-token-missing"`, not `skipped`, because the operator did
declare intent.

Recommended migration defaults:

- old workspaces:
  - `coderabbit.enabled = false`
  - `sonarcloud.enabled = sonar.enabled`
  - `projectKey/organization/hostUrl` copied from existing Sonar config
  - `planTier = "unknown"` until discovered by doctor

Keep upgrade-on-write semantics.

Setup semantics:

- tool not enabled during setup → skipped at runtime
- enabled but runtime prerequisites missing later → marked failed, story
  continues

### 9.1 Setup UX must explain SonarCloud and CodeRabbit clearly

The setup and workspace-registration flows must not stop at writing config
files. They should explain to the operator how to set up the external
services.

For SonarQube Cloud, setup should tell the user:

1. Create or import the project in SonarQube Cloud first. Prefer repository
   import/binding when possible.
2. Confirm whether the organization uses the EU default instance or the US
   region.
3. If the project is in the US region, scanner runs must include
   `sonar.region=us`.
4. Confirm the subscription plan tier — **branch analysis requires Team,
   Enterprise, or OSS**. Free plan workspaces will see Sonar skipped for
   story branches.
5. Create an analysis token and store it locally as `SONAR_TOKEN`.
6. Keep durable analysis settings in the SonarQube Cloud UI when possible.
7. Let BeerEngineer generate the local `sonar-project.properties` file and
   workspace config.
8. Optionally add `sonarqube-cli --mcp` to installed harness configs.

For CodeRabbit, setup should tell the user:

1. CodeRabbit is optional.
2. Install the CLI separately (verify the actual install command during
   Phase 0 discovery — do not assume `@coderabbit/cli` is correct until
   confirmed).
3. Authenticate using the vendor-supported login/auth flow.
4. If not configured, BeerEngineer skips CodeRabbit review instead of
   blocking the story.

This guidance appears in:

- CLI `workspace add` success output
- UI workspace-setup help text
- docs for plain-English setup and workspace setup

### 9.2 Documentation update is part of the rollout

Shipping real review tooling requires explicit documentation updates.

At minimum, update:

- `docs/setup-for-dummies.md`
- `docs/workspace-setup-plan.md`
- `docs/app-setup-plan.md`
- any UI/setup copy that mirrors workspace registration guidance

Documentation should cover:

- what CodeRabbit is used for in BeerEngineer
- what SonarQube Cloud is used for in BeerEngineer
- that both tools run during the Ralph story review loop, not during stage
  authoring
- that both tools are optional and may be skipped
- that missing setup or runtime failure is documented but does not block
- how to create/import a SonarQube Cloud project
- how to choose EU vs US region
- when `sonar.region=us` is required
- **plan-tier requirements for branch analysis (not on Free)**
- how to create and export `SONAR_TOKEN`
- that durable Sonar analysis settings should live in the SonarQube Cloud UI
- how to install/auth the CodeRabbit CLI (verified during Phase 0)
- that CodeRabbit review is skipped when not configured
- the role of `sonarqube-cli` vs `sonar-scanner` (query vs scan)

The implementation should not be considered complete until operator-facing
docs and setup copy match the real behavior.

### 10. Persist raw review evidence

Per story review cycle, write artifacts such as:

- `coderabbit-cycle-<n>.raw.txt` or `.json`
- `sonar-scan-cycle-<n>.raw.txt`
- `sonar-ce-task-cycle-<n>.json` (compute-engine poll trace)
- `sonar-gate-cycle-<n>.json`
- `sonar-issues-cycle-<n>.json`
- `review-tools-cycle-<n>.json`

Required for debugging parse failures, operator inspection, recovery
evidence, and auditing why a story was blocked.

`review-tools-cycle-<n>.json` includes three-state status per tool, for
example:

```json
{
  "coderabbit": { "status": "ran", "findings": 2 },
  "sonarcloud": {
    "status": "failed",
    "reason": "sonar-token-missing",
    "exitCode": null
  }
}
```

### 11. Extend doctor checks

Doctor already probes binaries. Extend it to validate runtime readiness.

Add checks:

- `review.coderabbit.auth`
- `review.sonar.token`
- `review.sonar.workspace-config`
- `review.sonar.project-binding`
- `review.sonar.branch-analysis-available` — resolves plan tier and warns if
  Free
- `review.sonar.region-consistency` — warns if `region=us` is set but host
  URL is EU, or vice versa

Doctor output should separate:

- binary missing
- auth missing
- workspace Sonar config missing
- project key / organization missing
- scanner config mismatch
- plan-tier incompatibility

Severity rules:

- Sonar missing binary/token when `enabled: true` → `warn` (story-level
  runtime will escalate to `failed` if hit)
- CodeRabbit missing binary/auth → `info` (optional tool, not a setup
  blocker)
- Sonar Free plan with branch analysis implied → `warn`, setup may continue

Doctor remains advisory. Setup warnings help operators configure tools; they
do not automatically block story execution.

### 12. Logging, observability, telemetry

Per review cycle, emit structured log facts:

- CodeRabbit selected and started
- Sonar scan started (branch, projectKey)
- Sonar CE task polling started / completed / timed out
- Sonar gate fetch started
- tool skipped because disabled/unconfigured (with reason)
- tool failed but process continued (with reason)
- changed files count
- baseline SHA and story branch
- command exit code
- parsed findings count
- gating reasons

Do not log tokens or secrets.

In addition to logs, emit metrics (can land alongside existing engine
counters):

- `review.tool.duration_ms{tool, outcome}`
- `review.tool.skip_count{tool, reason}`
- `review.tool.fail_count{tool, reason}`
- `review.sonar.ce_task_duration_ms`
- `review.sonar.gate_flake_rate`
- `review.cycles_per_story`

These let us decide later whether to tighten or loosen gating without
scraping logs.

### 13. commandRunner contract

`apps/engine/src/review/commandRunner.ts` is the single shell-out path used
by both adapters and by hermetic tests.

Contract:

```ts
type CommandSpec = {
  command: string
  args: string[]
  cwd: string
  env?: Record<string, string> // merged over process.env
  timeoutMs: number           // hard kill after this
  maxBufferBytes?: number     // default 10 MiB; exceeding → fail result
  stdoutFile?: string         // when set, stream stdout to file
  stderrFile?: string
  signal?: AbortSignal
}

type CommandResult = {
  exitCode: number | null    // null when killed by signal/timeout
  stdout: string             // truncated to maxBufferBytes
  stderr: string
  durationMs: number
  timedOut: boolean
}
```

Hermetic-test injection:

- the review registry accepts an optional `commandRunner: CommandRunner`
  when constructed
- in tests, inject a deterministic runner that returns canned
  `CommandResult` objects keyed by `command + args[0]`
- in production, the default runner uses `node:child_process`

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
- `apps/engine/src/core/parallelReview.ts` (accept three-state gate)
- `apps/engine/src/types/workspace.ts`
- `apps/engine/src/core/workspaces.ts`
- `apps/engine/src/setup/doctor.ts`
- `apps/engine/src/index.ts`
- `apps/engine/src/api/server.ts`

## Rollout order

### Phase 0 — Discovery (prerequisite)

Time-boxed investigation (≤ 2 days) to lock adapter contracts before code:

- CodeRabbit CLI: verify actual install command, non-interactive invocation,
  machine-readable output surface, auth persistence model
- SonarCloud branch analysis: confirm `sonar.branch.name` / CE task polling
  contract against a real project
- `sonarqube-cli` vs raw API: pick the default for gate+issues fetch
- Plan-tier detection: which API call exposes the tier cleanly
- Concurrency behavior on a single branch (serialization test)

Deliverables: a short findings doc + finalized adapter signatures.

### Phase 1 — Abstraction

- add `review/` abstraction
- move fake review resolution behind registry
- replace direct `sim/llm.ts` imports in Ralph
- extend `StoryReviewArtifact["gate"]` to three-state
- update `parallelReview.ts` and UI consumers to accept the extended shape
- keep fake adapters as default in tests via the single resolution rule

### Phase 2 — Sonar

- implement real SonarCloud adapter with `sonar-scanner` per story branch
- wire CE task polling with exponential backoff and timeout
- implement gate + issues fetch via `sonarqube-cli` (fallback: raw API)
- persist raw Sonar artifacts (scan, CE, gate, issues)
- add doctor/runtime config validation including plan tier and region

### Phase 3 — CodeRabbit

- implement real CodeRabbit adapter (contract confirmed in Phase 0)
- wire structured output or conservative parser
- add raw CodeRabbit artifacts
- tighten gating and error handling

### Phase 4 — Harness augmentation

- wire `sonarqube-cli --mcp` into hosted harness configs
- pass Sonar context into remediation prompts for Codex/Claude
- keep engine-owned scanner/gate path as primary truth

## Test plan

### Unit

- severity mapping
- CodeRabbit parsing
- Sonar gate parsing
- Sonar CE task polling (cadence, timeout, success, CANCELED/FAILED)
- finding deduplication
- three-state gate round-trip through `StoryReviewArtifact`
- fake vs real resolution (env var and test injection)

### Integration

- Ralph review loop receives merged findings from both tools
- critical/high CodeRabbit issues block
- failed Sonar gate blocks
- passing gate with low findings still passes
- missing or disabled tool is skipped and documented
- runtime tool failure is documented and does not block by itself
- one tool failing while the other returns blocking findings still blocks
  based on the successful tool findings only
- both tools skipped or failed leaves the story unblocked by review tools
- feedback summary for skipped tool declares the skip to the worker
- Free-plan Sonar config produces `skipped` with the right reason on a
  non-main story branch

### Hermetic runtime tests

- inject command runners instead of shelling out in CI
- simulate:
  - scan success + gate fail
  - scan success + gate pass
  - CE task timeout
  - CE task CANCELED/FAILED
  - CodeRabbit high finding
  - CodeRabbit medium/low only
  - malformed tool output
  - `SONAR_TOKEN` missing with `enabled: true`
  - concurrent invocation on same branch (serialization)

## Risks

- CodeRabbit CLI may not offer a stable machine-readable output format
  (mitigated by Phase 0 discovery).
- SonarCloud analysis is asynchronous and requires polling (mitigated by
  explicit polling contract in §5.1).
- Branch-analysis plan-tier restriction surprises operators on Free
  (mitigated by doctor warning and setup docs).
- Whole-repo review instead of branch-scoped review would create noisy
  blockers (mitigated by branch analysis in §5.1).
- Silent fallback to fake review would undermine trust (mitigated by single
  resolution rule in §8 and explicit logs).
- Treating infrastructure failures as review failures would create false
  blocks and stall execution (mitigated by §7 rule: only `ran` tools gate).

## Decision summary

The correct process placement is:

- inside Ralph
- per story, on a dedicated story branch
- after code implementation
- before story pass/merge
- with CodeRabbit and Sonar run in parallel
- with Sonar using native branch analysis (`sonar.branch.name`) instead of
  file-level diff filtering
- with `sonar-scanner` as the gate backend and `sonarqube-cli` as the
  read-back / MCP helper
- with merged findings fed back into the worker
- with explicit bounded loops, three-state tool status, and an explicit
  exit-criteria table

That matches the current execution model and keeps the architecture clean.
