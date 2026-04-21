# Review: UI Verification Readiness Gate

Review of the UI verification gate work landing across:
`src/services/verification-readiness-service.ts`, `src/shared/workspace-browser-url.ts`,
`src/persistence/{schema,migration-registry,repositories}.ts` (migration `0019`),
`src/workflow/{execution-service,autorun-orchestrator,autorun-types,status-resolution,verification-service,workflow-service,workflow-deps}.ts`,
`src/services/workspace-setup-service.ts`, `src/cli/main.ts`, `src/domain/types.ts`,
`src/app-context.ts`, `apps/ui/playwright.config.ts`, and the matching integration tests.

## High-impact concerns

### 1. `resolveWorkspaceBrowserUrl` port hash is weak and can collide with dev servers
`src/shared/workspace-browser-url.ts` hashes the workspace key mod 700 and maps to
`3200..3899`. Problems:
- The range includes common dev/service ports like **3306 (MySQL), 3478 (STUN), 3389 (RDP),
  3690 (SVN)**. Maintain an explicit exclusion set (DB ports, known dev-tool ports) and
  re-hash on collision.
- `hash * 31 % 700` produces **uneven bucketing** for similar workspace keys (e.g. `foo-1`,
  `foo-2`) — two adjacent projects may collide on the same port. Use a wider range and/or
  hash with SHA-1 for better distribution.
- No port collision check against the OS — if another process already holds `:3223`,
  verification will fail at runtime rather than at the readiness gate. Consider probing
  `net.createServer().listen(0)` availability inside `inspect()`.

### 2. `existsSync` vs. binary executability
`inspect()` checks `existsSync(playwrightBinaryPath)`, but `isBinaryAvailable` uses
`spawnSync(binary, ["--version"])`. Windows won't find an unsuffixed `playwright` binary;
on Linux a file that exists but isn't executable still passes `existsSync`. Use
`statSync(...).mode & 0o111` or a short `spawnSync(playwrightBinaryPath, ["--version"])`
probe.

### 3. `VerificationReadinessCoreService.inspect` runs per tick without early memoization
Like the execution-readiness path, the verification gate runs **per UI story per tick**.
`inspect()` reads `playwright.config.ts` and `package.json` from disk each time, parses JSON,
runs `agent-browser --version` via `spawnSync` (10s timeout). Under a UI-heavy wave with N
stories, that's N synchronous spawns + N file reads per tick.
Reuse is via `findLatestReusable` keyed on `inputSnapshotJson` — good — but that runs
*after* computing the full input snapshot, which itself does file I/O (`statSync` on 9
watched paths). Push the dedupe earlier so `inspect()` itself is skipped when the
fingerprint is unchanged.

### 4. `inputSnapshot.watchedPaths` doesn't include rendered `playwright.config` content
The snapshot records `stat.size` and `mtimeMs` for the config file but **not a content
hash**. If a user edits `playwright.config.ts` to change `baseURL` without changing size
enough, `findLatestReusable` can serve a stale run. Including a short content hash of the
Playwright config is safer than stat-only.

### 5. `playwright_baseurl_mismatch` uses a substring match
```ts
if (!playwrightConfigSource.includes(appConfig.baseUrl)) { ... }
```
False-positives on configs that construct the URL at runtime
(`baseURL: \`http://\${host}:\${port}\``) or pull from env. Either accept env-driven configs
(parse the file with a TS parser, or relax to "Playwright config exists") and let runtime
verification catch URL mismatches.

### 6. `webServer` detection regex can misfire
```ts
/webServer\s*:\s*\{[\s\S]*command\s*:/m
```
On a config that has `webServer: { url: "...", timeout: ... }` followed *later* by a
`command:` inside an unrelated block (e.g. inside `projects[].use.launchOptions.env`), the
greedy `[\s\S]*` can swallow across scopes and match. Anchor by closing brace:
`/webServer\s*:\s*\{[^}]*command\s*:/`, or parse with the TypeScript AST.

### 7. `shouldStoryRequireVerificationReadiness` couples gating to worker-role heuristic
```ts
return this.selectWorkerRole(story, acceptanceCriteria) === "frontend-implementer";
```
This ties the verification-gate trigger to the worker-routing heuristic — a different
concern. A story can be routed to `frontend-implementer` but genuinely need no UI route
verification (e.g. pure CSS token update). Conversely, a `backend-implementer` story that
emits an RSC view would slip past the gate. Use an explicit story flag or
acceptance-criterion tag instead of reusing the worker-role selector.

## Medium concerns

### 8. `ExecutionAdvanceResult.scheduledCount` semantics changed
`executions.length` now includes `verification_readiness`/`readiness` blocked entries that
were **not scheduled**. The test expects `scheduledCount: 1` for a readiness-blocked
project, which contradicts the field's name. Either rename it (`processedCount`) or
subtract blocked entries.

### 9. Doctor runs verification inspect with a fake story
`workspace-setup-service.ts:buildVerificationReadinessChecks` fabricates a `"doctor-story"`
and calls `inspect()`. This triggers `spawnSync("agent-browser", ["--version"])` every
time the doctor runs, adding real latency. Add a `skipProbe` flag for the doctor path.

### 10. `resolveCompactExecutionStoryStatus` precedence bug
```ts
if (storyEntry.latestVerificationReadiness && storyEntry.latestVerificationReadiness.status !== "ready") {
  return "blocked";
}
```
Runs **before** the `latestStoryReviewRun?.status === "passed"` check. A story that has
already passed review (truly completed) but has a stale, non-ready `latestVerificationReadiness`
row will be reported as `blocked`. Readiness rows are append-only — completed stories will
regress in status. Gate on `latestVerificationReadiness.updatedAt > latestStoryReviewRun.updatedAt`
or only consider the readiness state when the story is still in-flight.

### 11. `resolveCompactExecutionStoryPhase` short-circuits on readiness
Same pattern: phase resolution returns `"pending"` or `"blocked"` based on readiness
**before** checking review/execution phases. Completed stories report phase `pending`.
Move the readiness check to the fallthrough branch.

### 12. `workspaceRoot: null` silently bypasses the gate
The autorun host decision calls `getLatestExecutionReadinessByProjectId` which returns
null when no readiness ever ran, and readiness itself is skipped when `workspaceRoot` is
null. Confirm the "no workspace" path doesn't silently let autorun proceed past the gate.

### 13. Readiness reuse window is unbounded
`findLatestReusable` returns any prior non-`running` run with identical inputSnapshot —
**no time bound**. If the workspace changes in a way not reflected in the snapshot, the
stale run is served forever. Add a max-age (e.g. 15 minutes) on reuse.

### 14. `runDeterministicAction` re-throws on `result.error` — leaves action row in `running`
```ts
if (result.error) { throw result.error; }
```
The outer try/catch in `runForProject` catches it and marks the run `failed`, but the
previously-created `action` row stays `running` forever. Wrap the action update in the
catch path too.

### 15. `isBinaryAvailable` swallows timeouts
If `agent-browser --version` hangs until the 10s timeout, `result.status` is `null`. The
function correctly returns `false`, but the 10s delay is eaten with no telemetry. Log or
surface a "probe timed out" note.

## Minor

### 16. Duplicated status/severity enums
`verificationReadinessRunStatuses = executionReadinessRunStatuses` and all the
`*Severity`/`*Classification` aliases. Separate `export const` declarations buy nothing
over `export type VerificationReadinessRunStatus = ExecutionReadinessRunStatus`. Drop the
duplicated constants.

### 17. `workspace_root_missing` in verification gate is unreachable
If `workspaceRoot` doesn't exist, execution readiness returns `blocked` first and
verification never runs. The verification-side `workspace_root_missing` branch is
effectively dead. Fine defensively; just be aware.

### 18. Schema duplication between `execution_readiness_*` and `verification_readiness_*`
Six tables are structurally identical except for name. A single `readiness_runs` table
with a `domain: "execution" | "verification"` column would halve repository code, enable
shared retention, and make cross-domain reporting trivial. Worth considering before a
third domain (e.g. deployment readiness) lands.

### 19. Test helper `writeFakeNpmScript` mutates global `process.env.PATH`
Mutating the global `PATH` inside parallel vitest runs is a race. Another test's
`spawnSync("npm", ...)` can pick up the fake. Wrap in `describe.sequential` or pass PATH
via the spawn `env` option instead of mutating globals.

### 20. `VerificationReadinessCoreService` mutates `findings` inside `parseAppTestConfig`
Parser-side effect: `parseAppTestConfig(raw, findings, ...)` pushes into the caller's
findings array. Readable here but a surprise compared to `ExecutionReadinessCoreService`
where parsing is pure. Return a `{config, error}` discriminated union and let `inspect()`
push the finding.

### 21. `findingRepository.listLatestByRunId` no longer filters by iteration
Now filters `status !== "resolved"` instead of "latest iteration". That's a behavior
change — the name says "latest" but the semantics are "not resolved." Rename
(`listUnresolvedByRunId`) or restore iteration filtering.

## What looks good
- Fixing the execution-readiness feedback from the prior review: `isAutoFixable` is now
  `boolean` in the domain with row-level mapping at the repository boundary.
- `findLatestReusable` with a deterministic input snapshot is the fingerprint-based dedupe
  the prior review asked for.
- `try/catch` around `runForProject` now flips the run to `failed` on synchronous
  exceptions — also a prior-review fix.
- `apps/ui/playwright.config.ts` matches the canonical baseUrl and webServer contract.
- Deterministic port derivation (`resolveWorkspaceBrowserUrl`) removes the ":3000
  collision" failure mode, and the explicit :3000 blocker makes the policy
  self-documenting.
- Test coverage this round is substantial — autofix, build-fail, typecheck-fail,
  server-contract-missing, invalid config, shared-port, playwright-missing,
  fallback-available.
- Autorun stops cleanly on readiness blockers via the `hasAnyExecutionProgress` guard —
  correctly distinguishes "never started" from "started then blocked."

## Suggested priority
1. Fix the status/phase resolution precedence (#10, #11) — this will misreport completed
   work.
2. Harden the Playwright config matching (#5, #6) — false positives block real UI work.
3. Decouple `shouldStoryRequireVerificationReadiness` from the routing heuristic (#7) —
   routing heuristic ≠ verification contract.
4. Add a max-age on `findLatestReusable` (#13) and close the action-on-error hole (#14).
5. Probe-based port selection or an explicit exclusion list for
   `resolveWorkspaceBrowserUrl` (#1).
