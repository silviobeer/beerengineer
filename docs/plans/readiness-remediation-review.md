# Review: Execution Readiness Remediation

Review of the readiness persistence + service + execution gating changes landing across:
`src/persistence/schema.ts`, `src/persistence/migration-registry.ts`, `src/persistence/repositories.ts`,
`src/services/execution-readiness-service.ts`, `src/workflow/execution-service.ts`,
`src/services/workspace-setup-service.ts`, `src/cli/main.ts`,
`test/integration/workflow-service.test.ts`, and supporting domain/context/workflow wiring.

## High-impact concerns

### 1. Readiness runs synchronously on every tick — performance/UX risk
`advanceExecution` runs the full inspection **unconditionally on every call**, and `inspect()` calls
`spawnSync` for `npm run build` and `tsc --noEmit`. On a real repo these can take minutes and
**block the Node event loop** the entire time because `tickExecution` is `async` but `spawnSync`
is not.

Worse, in the same `advanceExecution` call, readiness runs again **per executable story**
(`execution-service.ts:1033–1039`). With N executable stories you do N+1 full builds/typechecks
per tick, even though the worktree content and upstream workspace is identical. Consider:
- Skip the outer per-project readiness when you know the per-story check will cover it.
- Convert to `spawn` (async) with a timeout.
- Memoize by `(workspaceRoot, canonicalCommands, mtime hash)` for the duration of a tick.

### 2. Every tick persists a fresh run + findings — unbounded DB growth
`runForProject` always creates a new `execution_readiness_runs` row plus N findings and optionally
N actions. Autorun loops will hammer this. No retention policy, no dedupe of "nothing changed
since last run." Worth at least a sidecar TODO or a cheap fingerprint check that short-circuits
to the previous run when inputs are identical.

### 3. `failed` status is dead code
`executionReadinessRunStatuses` includes `"failed"`, and `runForProject` sets
`errorMessage: "Readiness execution failed."` when `finalStatus === "failed"` — but `deriveStatus`
only ever returns `ready | auto_fixable | blocked`. Nothing in the service surfaces `failed`.
Either wire it up (spawnSync throwing, unexpected exception) or remove it from the enum and the
conditional branch.

### 4. `isAutoFixable: number` in the domain type
`ExecutionReadinessFinding.isAutoFixable: number` leaks the SQLite 0/1 encoding into the domain
layer, and the same field is a `boolean` inside `CoreReadinessFinding`. This means consumers
(CLI JSON output, workspace doctor) get `0|1` for some readings and `boolean` in-memory for
others. Map at the repository boundary and keep the domain type as `boolean`.

### 5. `execution:retry` autorun loop on readiness block
`src/cli/main.ts` at the new `result.phase === "readiness"` branch sets
`action: "execution:retry"` with `status: "blocked"`. If the blocker is non-auto-fixable
(e.g. `build_command_failed`), autorun will retry forever — readiness re-runs, re-builds,
re-fails. Needs either a terminal status for "readiness blocked" that stops autorun, or a
backoff/cap.

## Medium concerns

### 6. `runExecutionReadiness` (CLI/public) does not use the story worktree
The public `runExecutionReadiness(projectId)` runs against the main workspace root with no story
context, while gating inside `advanceExecution` runs against the per-story worktree path. A user
inspecting readiness via `execution:readiness:start` can get a green result while execution is
still blocked by the worktree check. Either accept a `--story-code` / `--worktree` override or
document the split explicitly.

### 7. Duplicate `readiness` variable shadowing
`advanceExecution` (`execution-service.ts:927`) binds `readiness`, then the for-loop at line 1033
binds another `readiness` in the inner scope. The outer one is already done with by then, so no
bug — but readers will trip on it. Rename the outer to `waveReadiness` or similar.

### 8. `readiness` field on the outer return is redundant
Lines 1082–1092: you compute `readinessExecution` from the executions list and then re-expose its
`readiness` on the top-level `ExecutionAdvanceResult`. The caller can already find it inside
`executions`. This also means the top-level object reports only the *first* readiness-blocked
story — which is lossy if multiple stories are blocked with different findings.

### 9. `.git` existence check misses bare-worktree edge cases
`existsSync(resolve(workspaceRoot, ".git"))` returns true for worktree `.git` files (linked file),
which is correct for Git worktrees. OK — but a sanity note: for a detached worktree without a
linked gitdir, this wouldn't catch corruption. Low priority.

### 10. No timeout / stdio cap on `npm install`
`runDeterministicAction` runs `npm --prefix apps/ui install` via `spawnSync` with no timeout and
full stdout/stderr capture into the DB. On a cold cache that's a very large blob in SQLite.
Consider truncating like `formatCommandFailure` does (it already caps command-failure output at
2000 chars — do the same for action stdout/stderr).

## Minor

### 11. Classification heuristics are string-includes
`workspace-setup-service.ts:766–783` buckets findings by `finding.code.includes("build")` /
`"typecheck"` / etc. Works today because you control the codes, but one `"rebuild_needed"`
finding would land in `appBuild`. Add an explicit `category` field on `CoreReadinessFinding`
(or a small map) to make the doctor buckets deterministic.

### 12. `completedAt` update for actions
`actionRepository.update` sets `completedAt` via `definedField`, and the call site at line 550
always passes it. Fine, but consider always setting `updatedAt` via a trigger or a single
`touch()` helper so all four repos use one pattern.

### 13. Test coverage gap
Integration tests only exercise "ready" and "toolchain missing" paths. The more interesting
branches — `build_command_failed`, `typecheck_failed`, and especially the **auto-fix →
re-inspect** transition where the second iteration produces new findings — aren't covered. The
auto-fix loop is the core claim of this feature; it deserves a green test.

### 14. `status` for new runs set to `"running"` but never flipped on synchronous failure
If the core `spawnSync` throws (not just non-zero exit — actually throws, e.g. ENOENT for `npm`),
`runForProject` never catches it and the run row stays `"running"` forever. Wrap in try/catch
and set `failed` + `errorMessage`.

## What looks good
- Migration `0018` is clean and uses `IF NOT EXISTS` plus sensible composite indexes on
  `(run_id, check_iteration, created_at)`.
- Foreign keys are declared on all three tables.
- The `CoreReadinessCommand` canonical list is a nice artifact — future verification/test-
  preparation phases can reuse the same commands without re-deriving them.
- Moving `ensureProjectExecutionContext` *after* readiness in `retryWaveStoryExecution` is the
  right call — no point creating context for a run that'll be blocked.
- The doctor integration is well-isolated — skipping the check when `workspaceRoot` is null
  avoids a crash during early bootstrap.

## Suggested priority
1. Fix the `failed` enum branch and `isAutoFixable` domain type (quick wins).
2. Stop duplicating readiness runs per story inside one tick.
3. Decide what `execution:retry` autorun does when blocked by a non-auto-fixable readiness
   finding.
4. Add the failure-path integration tests (especially the remediation → re-inspect round trip).
5. Add a retention strategy or a dedupe/fingerprint path before this table starts eating disk.
