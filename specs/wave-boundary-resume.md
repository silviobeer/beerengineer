# Wave-Boundary Resume

## Problem

When the execution stage aborts mid-project (e.g., a later wave fails a
dependency check, a tool outage, a hard crash), today's resume surface
cannot keep work already merged in prior waves:

- Only runs with `recovery_status = "blocked"` are resumable via
  `performResume`. Hard failures (thrown error → `run_finished status=failed`)
  leave `recovery_status = null` and the run is terminal from the CLI's
  perspective.
- `normalizeProjectResume` accepts `scope.stageId = "execution"` but
  produces `{ startStage: "execution", execution: undefined }`.
  `execution/index.ts` then re-runs **every** wave from scratch because
  its skip-check is `resume?.waveNumber && wave.number < resume.waveNumber`.
- Even if a fresh workflow run were started on the same item, artifacts
  are written under `runs/<runId>/stages/...`. A new runId creates a new
  path; wave-summary files from the failed run are inaccessible.

Concretely: in the helloworld run
`faf0f96f-20e5-46e1-b717-d64802cab759`, Wave 1 (GREETING-4, GREETING-2)
was fully implemented, reviewed, and merged onto real git branches before
planning emitted invalid dependency prose that broke Wave 2 scheduling.
The fix (planning validator) has landed but the run itself cannot resume
to retry Wave 2 — Wave 1 must be re-implemented.

## Goal

Enable resuming a failed execution stage at a **wave boundary**, so
completed waves keep their artifacts and merged branches, and the run
picks up at the first unfinished wave.

Specifically, after this change:

1. A hard-failed run with `current_stage = "execution"` that completed at
   least one wave can be resumed without re-running the completed waves.
2. Resume uses the real-git branch state as the source of truth; the
   `wave-summary.json` is reused from the original run directory or
   reconstructed deterministically from git history.
3. The resumed run writes new artifacts for subsequent waves into a
   continuation directory but can still read predecessor wave summaries.

## Non-Goals

- Automatic recovery from mid-wave story failures (covered by existing
  `recovery_scope = "story"` path).
- Diff-based / AI-driven "patch up" of the failed plan. Planning fixes
  are enforced by the validator at plan-approval time.
- Retroactive migration of old failed runs. Scope is prospective: hitting
  this path with a fresh crash should work; old runs without
  recovery_status stay terminal.

## Design

### Surface: `recovery_scope = "wave"`

Introduce a new recovery scope variant alongside `run`, `stage`, `story`:

```ts
type RecoveryScope =
  | { type: "run"; runId: string }
  | { type: "stage"; runId: string; stageId: string }
  | { type: "wave"; runId: string; waveNumber: number }  // NEW
  | { type: "story"; runId: string; waveNumber: number; storyId: string }
```

`recovery_scope_ref` encoding: `"execution/waves/<n>"` (matches the
on-disk path under `stages/execution/waves/wave-<n>`).

### Where recovery gets set

Today `runWorkflow` catches a thrown stage error and emits
`run_finished status=failed` **without** setting `recovery_status`. For
execution-stage wave-level failures, introduce:

1. A typed wrapper error `ExecutionWaveGateError(waveNumber, reason)`
   thrown by `assertWaveDependenciesSatisfied` and the wave-status
   guard in `executeWave`.
2. A catch in `runProject` (or `runOrchestrator`) that, on
   `ExecutionWaveGateError`, records a blocked recovery with
   `scope = { type: "wave", waveNumber: n - 1 }` (the last completed
   wave) before re-throwing.

This keeps the contract uniform: every resumable state must set
`recovery_status` so `loadResumeReadiness` has truth to work with.

### Resume-plan normalization

Extend `normalizeProjectResume`:

```ts
if (scope.type === "wave") {
  return {
    startStage: "execution",
    execution: { startFromWave: scope.waveNumber + 1 },
  }
}
```

And extend `ExecutionResumeOptions` + `execution/index.ts`:

```ts
for (const wave of ctx.plan.plan.waves) {
  if (resume?.startFromWave && wave.number < resume.startFromWave) {
    const persisted = await readJsonIfExists<WaveSummary>(
      layout.waveSummaryFile(ctx, wave.number),
    )
    if (persisted) { summaries.push(persisted); completedWaveIds.add(wave.id); continue }
    const reconstructed = await reconstructWaveSummaryFromGit(ctx, wave)
    if (reconstructed) { summaries.push(reconstructed); completedWaveIds.add(wave.id); continue }
    throw new Error(`cannot_resume_without_wave_${wave.number}_summary`)
  }
  // unchanged path
}
```

### Artifact reuse — the ctx problem

`ctx` is runId-scoped, so the resumed run (same runId via `performResume`)
already points at the original `runs/<runId>/` dir. Artifacts are right
there. This means **if we keep the same runId**, no copy is needed.

`performResume` already re-invokes `runWorkflow` under the original run's
IO. We just need to ensure:

- The resume path uses the original runId (it does).
- `prepareWaveScopeForResume` runs analogously to
  `prepareStoryScopeForResume` to mark the last-completed wave's summary
  as canonical (set status "in_progress" on any stale mid-wave state).

### Git truth

The real-git branch layout already encodes wave completion:
`item/<slug> → proj/... → wave/...__w<n>` (merged) and
`story/...__w<n>__<id>` (merged into wave branch).

If `wave-summary.json` is missing or corrupt, `reconstructWaveSummaryFromGit`
verifies:
- `wave/...__w<n>` exists and is reachable from `item/<slug>`
- Every story id in `plan.waves[n-1].stories` has a merged
  `story/...__w<n>__<id>` commit

Returns a synthesized `WaveSummary` with `storiesMerged = wave.stories`,
`storiesBlocked = []`. Fails loud (no silent assumption of success) when
git state disagrees with the plan.

## CLI Surface

Reuse existing `beerengineer item action --action resume_run` flow. The
`--remediation-summary` is still required ("what you fixed before
resuming"), e.g., "updated planning validator, wave-dep prose fixed".

Optional flag: `--from-wave <n>` to override the recovery record's
waveNumber (for manual intervention when the recorded scope is wrong).
Default: use the scope persisted in `recovery_scope_ref`.

## Failure Modes Covered

| Failure | Today | After this change |
|---|---|---|
| Wave N dep check fails after Wave 1..N-1 succeed | Hard fail, not resumable | Blocked at wave scope, resume replays from Wave N |
| Tool outage during Wave N (ralph crash mid-story) | Story scope (existing path) | Unchanged — story scope still wins |
| All waves succeed, project-review fails | Hard fail | Already covered by stage scope |
| Planning emits invalid plan | Caught by validator in planning stage (no execution started) | Unchanged |

## Test Plan

- Unit: `normalizeProjectResume` with `scope.type = "wave"` returns the
  expected `ProjectResumePlan`.
- Unit: `ExecutionWaveGateError` triggers recovery record write with
  correct scope.
- Integration: seed a workflow run, kill it after Wave 1 completes with
  a simulated wave-dep failure, then resume and assert Wave 2 + 3 run
  without re-invoking Wave 1 LLM adapters.
- Integration (real git): after resume, assert the wave-1 branch is not
  re-created or re-merged; only wave-2+ branches advance.
- Regression: story-scope resume still works unchanged.

## Open Questions

- Should `reconstructWaveSummaryFromGit` be strict (refuse resume if git
  state is inconsistent) or lenient (log warning, continue)? Default:
  strict — mismatches indicate a branching bug and silent continuation
  would compound it.
- Where should the wave-scope recovery record be written for concurrent
  wave implementations? (future parallel-wave execution): one record per
  run is sufficient since a wave boundary is a single serialization
  point.
- CLI UX for the common case where the user just wants to retry without
  a remediation summary: loosen the `--remediation-summary` requirement
  when `recovery_scope.type = "wave"` and the failure cause is a
  deterministic gate check? Probably yes — a wave-dep validator catch is
  not an "external remediation" situation.

## Rollout

Single-PR feasible. Engine-only. No DB migration needed (recovery_scope
column is already TEXT). Add typecheck + unit tests + one integration
test covering the exact helloworld repro.
