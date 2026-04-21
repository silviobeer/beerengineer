# Project Branch Baseline Drift Gap

## Problem

Execution for `ITEM-0007-P01` blocked in `verification_readiness` even though the main repo already contained the required UI browser-verification setup.

The story worktree for `ITEM-0007-P01-US01` was created from commit `4580c5b`, while `main` had already advanced to `ab1fc80`.

As a result, the story worktree missed committed files that existed in the main checkout:

- `apps/ui/playwright.config.ts`
- `apps/ui/tests/e2e/*`
- `@playwright/test` in `apps/ui/package.json`

The CLI therefore reported a false manual blocker in `verification_readiness`.

## Why This Matters

- Project execution can fail against stale repo state even when the required setup is already committed.
- Readiness findings become misleading because they describe missing files that are only missing in the stale branch, not in the real repo baseline.
- Operators cannot trust the process if project/story branches silently drift behind `main`.

## Expected Behavior

Before creating or reusing project/story execution branches, the workflow should ensure that the execution baseline is aligned with the intended source branch.

For the current single-mainline workflow, that means:

- new project/story branches should fork from the current `main` HEAD unless an explicit project baseline is stored
- existing untouched project/story branches should be fast-forwarded when `main` has advanced
- stale execution branches should be reported as a branch-baseline blocker before readiness checks run

## Required Fix

1. Persist the intended baseline commit for project execution.
2. At execution start, compare the project/story branch HEAD against that baseline.
3. If the branch is stale and has no project-specific commits, fast-forward it automatically.
4. If the branch is stale and has diverged, stop with an explicit branch-baseline blocker instead of emitting misleading readiness failures.
5. Recreate or refresh story worktrees after the branch baseline changes.

## Verification

- Reproduce with a project branch created before a later commit adds required setup files.
- Confirm the engine detects the stale baseline before `execution_readiness` / `verification_readiness`.
- Confirm untouched branches auto-fast-forward and reuse the updated files.
- Confirm diverged branches block with a specific branch-baseline error.
