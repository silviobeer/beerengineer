# Engine Follow-Up Plan

Context: post-session plan after pushing UI through the pipeline. Captures
what's done, what's broken, and what to do with the in-flight run.

## In-flight run

Run `996f1585-8232-4b87-b9f9-e479a9e37363` (item `d7e7c3d6-82b5-4d19-8368-ec8c6fc8268b`):
- Brainstorm → frontend-design: seeded from prior `d882a0c8` run (approved)
- Requirements/Architecture/Planning: passed in this run
- Execution Wave 1, Wave 2: passed
- Execution Wave 3: blocked on stories `US-02` and `US-06` — Test-Writer
  approved, Ralph (Coder) didn't reach `passed` within the cycle cap.
- Run state: `failed`, recovery_status: null (no recovery record written;
  failure came from `assertWaveSucceeded`, which throws but skips
  recovery), so `resume_run` returns 409.

### Recommended action

1. Switch main worktree back to master (already done):
   ```
   git -C /home/silvio/projects/beerengineer2 checkout master
   ```
2. Reset item state from DB (item is on `implementation/failed`, the
   transition matrix only re-enters via `start_implementation` from
   `requirements/*` or `rerun_design_prep`):
   ```
   node -e "const Database=require('/home/silvio/projects/beerengineer2/node_modules/better-sqlite3');\
   const db=new Database('/home/silvio/.local/share/beerengineer-nodejs/beerengineer.sqlite');\
   db.prepare(\"UPDATE items SET current_column='requirements', phase_status='failed', updated_at=? WHERE id=?\")\
     .run(Date.now(),'d7e7c3d6-82b5-4d19-8368-ec8c6fc8268b');"
   ```
3. Restart API, then `POST /items/:id/actions/start_implementation`. The
   new run will pick up brainstorm/VC/FD artifacts on disk and run
   requirements → architecture → planning → execution with all the
   session's optimizations active.
4. If wave 3 blocks again on the same stories: `git diff` what test-writer
   wrote vs what ralph kept failing on — possible AC mismatch.

### Watch list during the new run

- **Main worktree branch.** Master must stay on `master` for the entire
  run. The engine is supposed to do all branch work in
  `mode.itemWorktreeRoot` (`branchWorkspaceRoot()` → itemWorktreeRoot),
  but during this session main got hijacked to `story/...__w1__us-05` at
  least once. Verify main stays on master throughout.
- **PRD AC-03 mapping.** Already patched in `runs/<id>/stages/requirements/artifacts/prd.json`
  on the previous run; the new run will regenerate, watch that the 6-vs-5
  column mapping stays explicit.

## Branch + worktree at brainstorm (priority fix)

Today the item branch + item-worktree are created lazily — the first
stage that calls `runStage` writes artifacts to the run dir under the
item slug, but real-git work doesn't kick in until `runWorkflow`'s
`if (realGit.enabled) ensureItemBranchReal(realGit, context)` *after*
the workspace dirty-check. That means brainstorm/VC/FD don't actually
have a guaranteed item-branch yet for any side effects.

### What to change

1. **Move `ensureItemBranchReal` to fire before brainstorm.** It already
   runs at line 367 in `workflow.ts` (`try { if (realGit.enabled) ensureItemBranchReal(realGit, context) }`),
   which is before the brainstorm call — but the assert needs to happen
   even when starting from later stages (resume) so the worktree exists.
2. **Assert main is unchanged at run start.** Add a guard in
   `apps/engine/src/core/realGit.ts` near `branchWorkspaceRoot()` that
   throws if `workspaceRoot === itemWorktreeRoot` or if
   `currentBranch(workspaceRoot)` is not the base branch. Catches the
   "main hijack" failure mode early.
3. **Story-worktree path test.** Add an integration test that runs a
   minimal end-to-end fake-LLM workflow and verifies after each stage:
   - `currentBranch(mode.workspaceRoot) === baseBranch`
   - `currentBranch(mode.itemWorktreeRoot) === item branch (or wave/story
     when applicable)`
4. **Brainstorm side effects in item-worktree.** Verify that
   brainstorm's artifact writes go through `layout.runDir(context)` (run
   dir under `.beerengineer/workspaces/...`), NOT into the item-worktree
   or main repo. Currently it does — confirm no regression after the fix.

## Session optimizations already in master

| Commit | Change |
|---|---|
| `8fb638d` | brainstorm `constraints` coerced to string[] on real-LLM path |
| `8847f3c` | merge ui-mockup into frontend-design; designPreview hardcodes fixed |
| `2ca9c0d` | iterative clarification + approval gate for design-prep stages |
| `0686837` | visual-companion emits LLM-generated lowfi wireframes |
| `3045631` | LLM-authored mockups in frontend-design |
| `6fd1ffd` | extract user-review gate into runStageWithUserReview helper |
| `875a86f` | role-aware harness resolution honors preset role mappings |
| `4f5cbde` | correct codex model id (`gpt-5.4`) |
| `2330e9c` | route sandbox_mode through `-c` on codex exec resume |
| `19f165a` | skip `--cd` on codex exec resume |
| `8eb659e` | auto-load item workspace references for design-prep stages |
| `3e09a27` | claude-first coder defaults to sonnet; opus stays for execution |
| `b7ae853` | phase-started telegram notifications |
| `50c5cde` | strip inline HTML from artifacts before downstream stages |
| `06d9c6b` | cap reviewer cycles (2 light / 3 execution) |
| `2614f8e` | parallel stories per wave with serialised wave-branch ops |
| `179673b` | keep 3 cycles for content-heavy stages |
| `b948539` | keep 4 cycles for content-heavy stages (final) |
| `1f2bf07` | no-tools runtime mode for stage agents and reviewers |
| `c14c30c` | one-shot json output for no-tools claude invocations |
| `c039d27` | safe-readonly tools for engineering stages |
| `85a71b7` | preload compact codebase snapshot for engineering stages |
| `bed27e7` | thread codebase snapshot through state types |

## Open issues

- **Recovery record on wave failure.** `assertWaveSucceeded` throws
  without writing a recovery row. `resume_run` then 409s. Fix: write
  `writeRecoveryRecord({ status: "blocked", scope: { type:"stage",
  stageId:"execution" }, summary, ... })` from inside execution before
  the throw, or wrap at the workflow boundary.
- **Reviewer over-strictness on contract-heavy stages.** Codex hits the
  cycle cap on requirements/architecture when the artifact has multiple
  independent gaps. Considered remedy: split codex's review into "must
  fix" vs "nice to fix" so the artifact can still pass with deferred
  items captured as follow-ups.
- **DB cleanup.** `.beerengineer/workspaces/` had 192MB / 546 stale
  worktrees from prior failed runs. Add a `beerengineer workspace gc`
  command that removes orphaned item dirs.
- **Anthropic SDK migration.** Subscription policy disallows OAuth in
  the Agent SDK, so we stay on CLI for now. When/if API-key auth
  becomes acceptable: stage agents → Anthropic SDK direct (3-5×
  faster), execution-coder → claude-code-sdk (in-process tools, no
  spawn overhead). Tracked in research notes only.
- **--output-format json parser path.** Switched no-tools claude to
  `--output-format json` (single result blob) but the existing parser
  was built for stream-json. Verify on first run after deploy that the
  parser handles the single-event case cleanly; if not, the simplest
  fix is `--output-format text` and trust the system prompt's
  "return JSON only" instruction.

## Re-run checklist (for the next session)

```bash
# 1. main back on master
git -C /home/silvio/projects/beerengineer2 checkout master

# 2. reset item to requirements/failed
node -e "..."  # see step 2 above

# 3. restart API
pkill -9 -f 'tsx src/api/server.ts' 2>/dev/null; sleep 2
cd /home/silvio/projects/beerengineer2/apps/engine && \
  setsid env HOST=0.0.0.0 PORT=4100 npm run start:api < /dev/null > /tmp/be-api.log 2>&1 &

# 4. trigger start_implementation
TOKEN=$(cat /home/silvio/.local/state/beerengineer/api.token)
curl -s -X POST "http://localhost:4100/items/d7e7c3d6-82b5-4d19-8368-ec8c6fc8268b/actions/start_implementation" \
  -H "x-beerengineer-token: $TOKEN" -H 'Content-Type: application/json' -d '{}'
```
