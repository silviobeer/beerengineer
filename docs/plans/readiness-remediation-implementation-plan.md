# Readiness Remediation Implementation Plan

## Goal

Implement a deterministic readiness and remediation layer in BeerEngineer so that `execution` only starts when the target workspace and technology stack are actually runnable.

This plan addresses the current failure mode where:

- the engine reaches `execution`
- the worker starts in a real worktree
- but the worktree is not operational
- and the run fails only after entering implementation

The new design should move this earlier into an explicit readiness gate with optional safe auto-remediation and an optional LLM-backed remediation fallback for nontrivial configuration or code fixes.

## Core Outcome

BeerEngineer should stop producing these two bad states:

- fake success driven by a local stub path
- real execution runs that start before the environment is actually ready

Instead, the engine should do this:

1. resolve the real workspace and runtime
2. run a structured readiness check
3. apply safe deterministic fixes when possible
4. re-check readiness
5. optionally invoke a bounded LLM remediator only for nontrivial fixable problems
6. re-check readiness again
7. start `execution` only if the environment is truly ready

## Confirmed Design Decisions

### Readiness Is Engine-Owned

Readiness is not a worker concern.

The engine decides:

- whether execution may start
- whether a problem is a hard blocker
- whether a problem is auto-fixable
- whether an LLM remediation attempt is allowed
- when to stop and require human intervention

### The Default Path Should Be Deterministic

The first remediation layer should be rule-based, not LLM-driven.

Typical readiness problems are deterministic:

- workspace root is not a git repository
- dependencies are missing
- local toolchain binaries are missing
- build command is missing or fails
- type-check command is missing or fails
- Playwright or browser binaries are missing

These should be handled through explicit checks and allowlisted fix actions.

### LLM Remediation Is A Second-Line Capability

An LLM may be used only after deterministic remediation has either:

- failed
- or classified the problem as nontrivial but plausibly fixable

Examples:

- broken imports
- invalid TypeScript config
- inconsistent package scripts
- missing framework wiring
- config drift across files

The LLM should not be the default fix engine for routine environment problems.

### Readiness Must Be Technology-Aware

The overall flow should be generic, but checks and remediations must be stack-specific.

The system should be split into:

- a generic readiness core
- technology profiles underneath it

Initial practical profile for this repo:

- `node-next-playwright`

Later profiles may include:

- `node-vite`
- `node-basic`
- `python-basic`
- `playwright-web`

### Hard Blockers Must Stop Execution Early

If readiness is not sufficient, the engine must not:

- create a misleading completed execution
- fabricate changed files
- let verification imply success

Instead it should stop with a structured blocked state such as:

- `blocked`
- `review_required`
- or another explicit pre-execution failure state

The returned result must explain:

- what is missing
- why it blocks execution
- which action is required

## Problem Statement

The current execution model assumes that once planning is approved, the system may proceed directly into story execution.

That assumption is false in real workspaces.

A story worktree may still be unusable because:

- `node_modules` are not available there
- framework binaries like `next` are missing
- type-check tooling is missing
- Playwright is not installed or configured
- app verification inputs are incomplete
- the workspace is not a valid git repository
- the project has no canonical build and verification commands

This causes late failures in `execution`, even though the correct behavior should have been:

- detect the issue before execution
- fix the safe parts automatically
- block early when auto-fix cannot safely complete the environment

## Scope

This plan covers:

- pre-execution readiness checking
- deterministic readiness remediation
- optional LLM-backed remediation fallback
- technology-specific readiness profiles
- persistence and observability of readiness runs
- CLI integration
- execution gating

This plan does not attempt to redesign:

- the full execution worker contract
- the story verification semantics
- the QA or documentation architecture

## Phase 1: Readiness Core

### New Runtime Concept

Introduce an explicit pre-execution runtime layer:

- `ExecutionReadinessRun`
- `ExecutionReadinessFinding`
- `ExecutionReadinessAction`
- optionally `ExecutionReadinessAgentSession` for LLM remediation attempts

Suggested purpose:

- `ExecutionReadinessRun`
  - one readiness assessment for a project, wave, or story execution boundary
- `ExecutionReadinessFinding`
  - one structured issue or warning
- `ExecutionReadinessAction`
  - one deterministic or LLM-backed remediation action with status and logs

### Minimal Status Model

Suggested statuses:

- `ExecutionReadinessRun`
  - `running`
  - `ready`
  - `auto_fixable`
  - `blocked`
  - `failed`

- `ExecutionReadinessFinding`
  - `open`
  - `auto_fixable`
  - `manual`
  - `resolved`

- `ExecutionReadinessAction`
  - `pending`
  - `running`
  - `completed`
  - `failed`
  - `skipped`

### Generic Finding Shape

Each finding should include:

- `code`
- `severity`
- `scopeType`
- `scopePath`
- `summary`
- `detail`
- `detectedBy`
- `classification`
- `recommendedAction`
- `isAutoFixable`

Example finding codes:

- `workspace_not_git_repo`
- `node_modules_missing`
- `next_binary_missing`
- `typescript_binary_missing`
- `playwright_missing`
- `playwright_browsers_missing`
- `build_command_failed`
- `typecheck_failed`
- `app_test_config_missing`
- `workspace_root_missing`

### Generic Action Shape

Each action should include:

- `actionType`
- `command`
- `cwd`
- `status`
- `stdout`
- `stderr`
- `exitCode`
- `startedAt`
- `completedAt`
- `initiator`

`initiator` should distinguish:

- `engine_rule`
- `llm_remediator`
- `manual`

## Phase 2: Execution Readiness Gate

### Execution Must Be Blocked Behind Readiness

Before `execution:start`, the engine should:

1. resolve the target workspace root
2. resolve the target technology profile
3. run readiness checks
4. classify findings

Outcomes:

- no blocking findings
  - execution may start
- only auto-fixable findings
  - start deterministic remediation
- non-auto-fixable but LLM-fixable findings
  - optional LLM remediation phase
- manual blockers
  - stop and surface the readiness report

### Integration Points

This gate should run before:

- `execution:start`
- `execution:retry`
- later also before remediation runs that require runnable worktrees

Optionally:

- `planning:approve --autorun` should stop at readiness if readiness cannot be achieved

### CLI Behavior

If execution is blocked by readiness, the CLI should return a structured payload such as:

```json
{
  "status": "blocked",
  "reason": "execution_readiness_failed",
  "findings": [
    {
      "code": "next_binary_missing",
      "summary": "The Next.js build tool is not available in the target worktree.",
      "recommendedAction": "Run npm --prefix apps/ui install or execute deterministic readiness remediation."
    }
  ]
}
```

The CLI must not pretend execution has started successfully when readiness is not sufficient.

## Phase 3: Deterministic Readiness Remediation

### Guiding Rule

The first remediation layer should only perform safe, allowlisted actions.

Examples of auto-fixable actions:

- install dependencies
  - `npm install`
  - `npm --prefix apps/ui install`
- install Playwright browsers
  - `npx playwright install`
- create required runtime-owned directories
- create managed worktree directories
- repair missing local generated setup artifacts
- verify and normalize local tool resolution

### Explicit Non-Goals For Deterministic Remediation

Do not auto-fix through rule-based remediation:

- large dependency upgrades
- destructive git cleanup
- config rewrites across unrelated files
- architecture-sensitive code changes
- secret provisioning
- external service credential setup

These should remain either:

- manual blockers
- or candidates for bounded LLM remediation

### Remediation Flow

1. run readiness
2. collect all auto-fixable findings
3. execute allowlisted actions in deterministic order
4. persist all outputs
5. re-run readiness
6. continue only if ready

### Example For This Repo

For the current UI stack, deterministic remediation should handle:

- `apps/ui/node_modules` missing
  - action: `npm --prefix apps/ui install`
- `next` missing
  - same dependency installation path
- `tsc` missing
  - same dependency installation path or root install path depending on resolution
- `playwright` missing
  - `npx playwright install`

## Phase 4: LLM-Backed Readiness Remediation

### When To Use It

Only after deterministic remediation has completed and readiness still is not green.

Candidate cases:

- build command exists but fails because of code or config
- invalid TS config
- missing or broken package scripts
- wrong imports or module references
- framework-specific config drift

### Required Boundaries

The LLM remediator must be tightly bounded.

It should receive:

- the readiness findings
- relevant command outputs
- the technology profile
- the allowed file scope
- the expected post-fix verification commands

It should not receive:

- open-ended instructions to “make it work somehow”
- authority to redefine product scope
- authority to bypass readiness checks

### Required Loop

1. readiness run says `not ready`
2. deterministic remediation is exhausted
3. engine classifies remaining findings as `llm_fixable`
4. bounded LLM remediation run starts
5. changes are applied
6. deterministic readiness re-runs
7. if still not ready:
   - stop with explicit unresolved findings

### Why The LLM Should Not Be First

Using an LLM first would introduce:

- unnecessary variance
- harder testing
- less reproducible behavior
- more risk of unsafe or overly broad fixes

The LLM should be a fallback or assist layer, not the primary readiness engine.

## Phase 5: Technology Profiles

### Generic Core + Specific Profiles

The system should not be fully hardcoded per framework, but it must support stack-specific checks.

Recommended architecture:

- generic readiness core
- profile-specific check providers
- profile-specific remediation providers

### Initial Profile: `node-next-playwright`

This profile should support:

- detect `package.json`
- detect `apps/ui/package.json`
- verify dependency installation
- verify `next`
- verify `tsc`
- verify canonical build command
- verify canonical type-check command
- verify Playwright installation
- verify app verification readiness for the UI path

Suggested canonical commands for this profile:

- build
  - `npm --prefix apps/ui run build`
- type-check
  - `./node_modules/.bin/tsc -p apps/ui/tsconfig.json --noEmit`
- e2e
  - `npx playwright test <target>`

### Future Profiles

Possible later profiles:

- `node-vite`
- `node-basic`
- `python-basic`
- `python-pytest`
- `playwright-web`

The engine should resolve a profile through:

- workspace settings
- explicit project metadata
- or conservative detection heuristics

## Phase 6: Workspace Doctor And Readiness Doctor

### Extend The Existing Doctor Model

The current `workspace:doctor` already fits this direction well.

It should be extended to expose:

- execution readiness checks
- stack-specific checks
- auto-fixable actions
- manual blockers
- canonical commands that will be used during execution

### New Doctor Categories

Suggested additional categories:

- `executionReadiness`
- `dependencyTooling`
- `appBuild`
- `typecheck`
- `e2eReadiness`

### Why This Matters

The doctor should become the user-visible explanation layer for:

- why execution cannot start
- what can be fixed automatically
- what still requires intervention

## Phase 7: Persistence And Observability

### Persist Every Readiness Decision

The system should persist:

- the readiness input snapshot
- findings
- deterministic actions
- LLM remediation attempts
- re-check results
- final gate decision

This is necessary for:

- debugging
- trust
- QA
- future automation analysis

### CLI Views

Add commands such as:

- `execution:readiness:start --project-id <projectId>`
- `execution:readiness:show --project-id <projectId>`
- `execution:readiness:retry --run-id <runId>`

Optional later:

- `execution:readiness:remediate --run-id <runId>`

### Required Output For Users

The user should see:

- what failed
- what was auto-fixed
- what remains blocked
- what command or file caused the issue

## Phase 8: Runtime Configuration Policy

### Real Workspaces Must Not Default To Stub Providers

The system should stop using `local-cli` as the effective default for real workspaces.

Practical requirement:

- test or fixture workspaces may use `local-cli`
- real workspaces must explicitly use real providers

This can be enforced by:

- workspace profile policy
- setup-time validation
- or doctor-level readiness failure when a real workspace resolves to a stub provider

### Runtime Checks

Before a live execution run, the engine should validate:

- provider is real
- workspace root is real
- git repo is valid
- worktree path is valid

## Phase 9: Current Repo-Specific Follow-Up

For this repo, the immediate implementation path should be:

1. add `ExecutionReadinessRun` core entities and repositories
2. add a generic readiness service
3. implement the `node-next-playwright` profile
4. extend `workspace:doctor` to expose execution readiness
5. gate `execution:start` behind readiness
6. add deterministic remediation for:
   - `npm --prefix apps/ui install`
   - `npx playwright install`
7. add optional bounded LLM readiness remediation
8. rerun execution only after readiness passes

## Acceptance Criteria

This plan is successful when:

- `execution:start` no longer begins on an unready workspace
- unready environments stop before story execution
- safe fixes such as dependency installation happen automatically when allowed
- nontrivial config or code readiness failures can optionally route through a bounded LLM remediation step
- readiness is technology-aware via reusable profiles
- the CLI shows a clear readiness report rather than vague execution failure
- real workspaces no longer accidentally run through the stub path

## Suggested Implementation Order

1. Add persistence and service skeleton for readiness runs.
2. Add generic readiness statuses, findings, and action models.
3. Implement the first technology profile: `node-next-playwright`.
4. Add deterministic remediation actions for dependency and browser setup.
5. Gate `execution:start` and `execution:retry` behind readiness.
6. Extend `workspace:doctor` with readiness categories and action previews.
7. Add bounded LLM remediation for nontrivial readiness failures.
8. Add CLI commands and observability views.
9. Enforce runtime policy so real workspaces do not silently use `local-cli`.

## Open Design Questions

- Should readiness runs be project-scoped, story-scoped, or both from the start?
- Should deterministic remediation run automatically by default, or require an explicit opt-in policy per workspace?
- Should LLM readiness remediation be enabled only for specific profiles or globally configurable?
- Should build/typecheck/e2e commands live in workspace settings, profile defaults, or project metadata with override precedence?
