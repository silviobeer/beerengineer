# Review: CLI Stage Run Hang After Functional Completion

## Scope

Observed while driving `ITEM-0007` through the CLI:
- `brainstorm:start`
- `brainstorm:chat`
- `brainstorm:promote`
- `concept:approve --autorun`

## Observed behavior

- The functional side effects happen correctly:
  - brainstorm session reaches `resolved`
  - concept is created
  - concept approval works
  - project import starts
  - autorun advances into `requirements`
- But the originating CLI command does not terminate cleanly and the stage run metadata remains inconsistent.

Concrete evidence from `ITEM-0007`:
- Brainstorm session `brainstorm_session_494c5782-d750-4961-970a-d681017eddfa` is `resolved`
- Concept `concept_4d737ee7-25f2-4f25-9abb-3cb435585221` exists
- Item moved to `requirements`
- Yet stage run `run_3b65c0f8-58ad-4c3e-ac95-11d5de625418` still shows `stageKey: "brainstorm"` and `status: "running"`
- The CLI commands `brainstorm:start`, `brainstorm:promote`, and `concept:approve --autorun` did not emit their final JSON result in the calling shell session

## Additional architecture-stage issue

The same `ITEM-0007` run exposed a second issue in the architecture path.

Concrete evidence:
- An earlier architecture attempt ended `review_required` because the returned `architecture-plan-data` payload did not match the required shape
- The recorded import error complained about missing `summary`, `decisions`, and `risks`
- That failed attempt also left noisy artifact history with repeated `architecture-plan-data` entries for one run
- A later architecture run completed successfully and produced the actual plan that is now attached to the project

Implication:
- retry/recovery works
- but malformed architecture output is not being contained cleanly on the first failing attempt
- the operator sees unnecessary artifact noise and an unclear intermediate review state

## Additional execution/worktree precondition issue

While continuing `ITEM-0007` beyond planning, the next blocker was not another architecture-stage defect.

Concrete evidence:
- `planning:approve --autorun` advanced into `execution:start`
- autorun then stopped with `stopReason: "verification_readiness_blocked"`
- the resulting verification-readiness run for story `ITEM-0007-P01-US03` reported:
  - missing `apps/ui/playwright.config.*`
  - missing `apps/ui/tests` / `apps/ui/tests/e2e`
  - missing Playwright dependency in `apps/ui/package.json`
- those files and dependency declarations do exist in the main repo working tree, but they are still uncommitted
- the readiness run executed inside story worktree `/home/silvio/projects/beerengineer/.beerengineer/workspaces/default/worktrees/ITEM-0007-P01-US03`, which is created from committed `HEAD`

Implication:
- this is a real process hazard, but it is not an architecture-stage bug
- the CLI currently assumes the baseline repo state needed by story worktrees is committed before execution begins
- if critical project-setup files only exist as local working-tree changes, readiness will misclassify the story worktree as missing required browser-verification setup

Suggested fix direction:
1. Make the execution preflight/doctor surface this constraint explicitly before autorun starts:
   - required project-setup files exist only as uncommitted changes
   - story worktrees will not inherit them
2. Decide on one supported policy and enforce it clearly:
   - either require a clean committed baseline before execution
   - or explicitly stage/copy approved baseline files into story worktrees
3. Add an integration test that proves readiness behaves predictably when required UI verification files exist in the main working tree but not in committed `HEAD`.

## Expected behavior

- Once the brainstorm session is promoted and the concept is persisted, the brainstorm stage run should move to a terminal state such as `completed`
- The corresponding CLI command should print its final JSON payload and exit
- If autorun continues into downstream stages, the upstream stage run must still be closed first

## Likely failure boundary

The failure appears to sit in the stage-run lifecycle / CLI completion path, not in the domain transition itself.

Why:
- domain state is already advanced correctly
- downstream state transitions begin
- only the original run status and command completion remain stuck

Likely areas to inspect:
- brainstorm/stage completion handoff in `src/workflow/brainstorm-service.ts`
- generic stage-run completion in `src/workflow/stage-service.ts`
- CLI command handlers awaiting workflow calls in `src/cli/main.ts`
- autorun chaining where the initial promise may never resolve cleanly after downstream continuation begins

For the architecture-stage issue specifically:
- structured artifact extraction / import in `src/workflow/output-importers.ts`
- artifact persistence and deduplication in `src/workflow/stage-service.ts`
- adapter output normalization before architecture import

## Impact

- misleading observability: operators see `running` although the stage already resolved
- confusing CLI UX: command appears hung even though work progressed
- automation risk: wrappers that wait for process completion may mis-handle success as a timeout/hang
- possible repeat pattern for downstream stages, especially when `--autorun` is involved

## Suggested fix direction

1. Make stage completion explicit before any downstream autorun continuation is awaited.
2. Ensure the stage run is marked terminal in the same transaction that persists the finished stage output.
3. Keep autorun as a separate continuation step whose result is returned after the originating stage run is already closed.
4. Add an integration test that asserts both:
   - side effects exist
   - originating stage run is terminal
   - CLI-facing workflow call resolves
5. Add an architecture regression test for malformed `architecture-plan-data` that asserts:
   - one failing attempt produces one clean failing/review-required result
   - malformed structured output does not create duplicate artifact noise
   - a retry can produce one clean successful attempt

## Reproduction seed

Use `ITEM-0007` or an equivalent new item with:
- `brainstorm:start`
- either `brainstorm:chat` or `brainstorm:draft:update`
- `brainstorm:promote`
- `concept:approve --autorun`

Watch for:
- item/project state progressing
- brainstorm stage run staying `running`
- CLI command session not terminating
