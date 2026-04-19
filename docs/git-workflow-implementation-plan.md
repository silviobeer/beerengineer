# Git Workflow Implementation Plan

## Goal

Define a Git workflow that fits the full BeerEngineer process:

1. planning creates the execution structure
2. execution changes code story by story
3. story review may trigger remediation
4. QA may trigger project-level remediation
5. documentation writes final reports

The Git workflow must stay:

- deterministic
- audit-friendly
- compatible with autonomous workers
- safe under retries and remediation

## Why This Needs Its Own Design

BeerEngineer is not a simple human-only Git flow.

The system already has:

- project-level plans
- wave execution
- story-level execution
- story review
- QA
- documentation
- upcoming autonomous remediation

A clean Git workflow must answer:

- when branches are created
- which runtime step may write code
- what a commit represents
- how parallel story work avoids conflicts
- how remediation reopens work safely
- when merges happen
- when final reports are generated relative to Git state

## Core Design Decision

The Git workflow should be **engine-owned**, not LLM-owned.

The engine decides:

- branch topology
- when a worker gets a branch
- what commit boundary applies
- when merge is allowed
- when a branch must be recreated or discarded

The worker decides only:

- how to change code within the assigned scope
- how to summarize the change

## Responsibilities Split

The Git workflow must enforce a hard boundary between:

- `CLI / Engine`
- `LLM Worker`

### CLI / Engine Responsibilities

The engine owns all deterministic orchestration.

That includes:

- choosing the active project and story
- creating and naming branches
- creating and assigning worktrees
- determining the base ref for a worker run
- assembling bounded worker context
- deciding whether the run is execution or remediation
- deciding which findings are selected for remediation
- constraining allowed scope
- triggering verification and review
- deciding whether a commit is acceptable
- deciding whether merge is allowed
- performing branch merges
- marking documentation as stale after post-documentation code changes
- persisting Git metadata in runtime records

The engine should also own:

- retry limits
- escalation rules
- branch cleanup policy
- stale branch detection

### LLM Worker Responsibilities

The worker owns only the bounded content work inside the assigned Git scope.

That includes:

- reading the provided context
- editing code in the assigned branch/worktree
- writing or adjusting tests when allowed by the current step
- addressing selected findings inside the allowed scope
- summarizing the performed changes
- reporting blockers when it cannot complete the bounded task

### LLM Worker Must Not Decide

The worker must not decide:

- which branch to use
- whether to create a branch
- whether to rebase
- whether to merge
- whether to widen scope beyond the assigned story or remediation set
- whether to pick additional findings opportunistically
- whether to skip verification or documentation regeneration

If the worker believes the assigned scope is wrong, it should surface that as a
bounded blocker. The engine remains the authority.

## Recommended Topology

## Base Branch

Use one protected integration branch:

- `main`

This is the source of truth for:

- approved project state
- latest merged code
- releases

## Project Branch

For each active project, create one long-lived project integration branch:

- `proj/<project-code>`

Example:

- `proj/ITEM-0001-P01`

Purpose:

- isolate one project from unrelated concurrent work
- keep project-local execution and remediation off `main`
- provide a stable merge base for story branches

## Story Branch

Each executable story gets its own short-lived branch:

- `story/<project-code>/<story-code>`

Example:

- `story/ITEM-0001-P01/ITEM-0001-P01-US01`

Purpose:

- one story = one bounded code-change branch
- supports parallel execution safely
- makes review and remediation traceable

## Optional Remediation Branch

If remediation should remain separated from the original story branch, use:

- `fix/<story-code>/<finding-run-id>`
- later for QA:
  - `fix/qa/<project-code>/<qa-run-id>`

First cut recommendation:

- story remediation may reuse the same story branch lineage
- QA remediation should likely use a fresh dedicated fix branch

## Branch Lifecycle

### Planning

Planning does not write production code.

It should not create story branches yet.

It may ensure the project branch exists:

- create `proj/<project-code>` from `main`

### Execution

When a story becomes executable:

1. engine creates or refreshes `story/<project-code>/<story-code>` from the current project branch
2. engine optionally creates a dedicated worktree for that branch
3. worker runs only on that branch/worktree
4. worker commits only story-local code
5. engine reruns verification
6. if story passes, branch is merged into the project branch

### Story Review Remediation

If story review fails or returns review-required:

1. engine reopens the same story
2. engine chooses the remediation branch strategy
3. remediation runs on the assigned branch/worktree only
4. a new commit is created
5. engine reruns:
   - basic verification
   - Ralph
   - story review
6. only then may the story branch merge into the project branch

### QA Remediation

If QA fails at project level:

1. engine identifies target stories or project-level fix scope
2. engine creates the required remediation branch set
3. workers commit bounded fixes only in those assigned branches
4. engine merges those fixes back into the project branch
5. engine reruns QA
6. documentation must be regenerated afterwards

### Documentation

Documentation should not change production code.

It should run against a stable Git state:

- after QA passes or ends on allowed `review_required`
- after any accepted remediation is already merged into the project branch

Documentation may write only:

- report artifacts
- optional docs-export files if that becomes part of the design later

## Commit Model

## Primary Rule

One code-changing commit should represent one bounded execution or remediation
unit.

### Story Execution Commit

Recommended default:

- one successful story execution = one commit

Commit format:

- `feat(<story-code>): implement story`

Example:

- `feat(ITEM-0001-P01-US01): implement story`

### Story Remediation Commit

Recommended format:

- `fix(<story-code>): address story review findings`

Example:

- `fix(ITEM-0001-P01-US01): address story review findings`

### QA Remediation Commit

If QA remediation maps to one story:

- `fix(<story-code>): address qa findings`

If QA remediation is truly project-level:

- `fix(<project-code>): address qa findings`

### Non-Code Documentation Commit

Only if documentation is later exported into tracked repo files:

- `docs(<project-code>): update delivery report`

For the current artifact-based model, this should usually **not** produce a Git
commit.

## Commit Timing

Do not commit:

- after planning
- after test preparation alone
- after failed intermediate verification
- after QA summary generation alone

Commit only when the bounded code unit is coherent enough for replay and merge.

The engine decides when the commit boundary is reached.

The worker may propose a commit summary, but should not decide whether multiple
logical units get combined.

## Merge Rules

## Story To Project Branch

A story branch may merge into the project branch only when:

- test preparation completed
- implementation completed
- basic verification passed
- Ralph passed
- story review passed

This keeps the project branch green at story granularity.

## Project Branch To Main

A project branch may merge into `main` only when:

- all planned waves are complete
- QA is `passed`
  - or later an explicitly allowed `review_required` policy exists
- any accepted remediation is already merged
- documentation is regenerated from the final merged project branch state

## Fast-Forward vs Merge Commit

Recommended first cut:

- use merge commits from story branch into project branch
- use merge commits from project branch into `main`

Reason:

- preserves the audit trail of bounded autonomous units
- clearer later when mapping runtime runs to Git history

If history cleanliness matters later, squash can be reconsidered. For now,
traceability is more valuable.

## Parallel Execution Safety

Parallel execution is one of the main reasons to define the Git workflow
carefully.

### Rule

Parallel workers must not write directly to the same branch.

They always work on separate story branches.

### Engine Guardrails

The engine should not start parallel story execution when:

- stories have explicit dependencies
- stories share known risky write scope
- a remediation run is already reopening one of the affected stories

Later, a write-scope heuristic can refine this further.

The worker should assume that if it was started in parallel, the engine has
already accepted the concurrency risk.

## Required Runtime State

To make Git state traceable, the DB should eventually record:

### Story Execution

- `gitBaseRef`
- `gitBranchName`
- `gitHeadBefore`
- `gitHeadAfter`
- `commitSha`
- `mergedIntoRef`
- `mergedCommitSha`

For:

- `WaveStoryExecution`

### Story Remediation

Same for:

- `StoryReviewRemediationRun`

### QA Remediation

Same for:

- `QaRemediationRun`

### Project-Level

Optionally:

- current project branch head
- latest main merge sha

This can live in dedicated Git metadata tables or as bounded JSON on the runtime
records.

## Worktree Strategy

If multiple autonomous workers run in parallel, normal branch checkout in one
working directory is not enough.

Recommended model:

- one Git worktree per active story branch

Example structure:

- `.worktrees/ITEM-0001-P01-US01`
- `.worktrees/ITEM-0001-P01-US02`

The engine should manage:

- worktree creation
- worktree cleanup
- branch assignment per worktree
- branch freshness before worker start
- project-branch sync before merge

This is the cleanest way to support safe parallel story execution.

## Untracked / Generated Files

The repo must distinguish clearly between:

- tracked source changes
- generated runtime artifacts
- temporary worker files

### Should Stay Untracked

- `var/artifacts/`
- SQLite databases
- temporary worker payloads
- local worktree scratch files

### Should Be Tracked

- source code
- prompts
- skills
- migration files
- docs plans
- any deliberately exported human docs under `docs/`

This implies a strict `.gitignore` policy aligned with runtime output.

## Documentation Interaction

Documentation must run against a stable Git state.

Rules:

- documentation uses the current merged project branch state
- if remediation succeeds afterwards, documentation becomes stale
- a new documentation run is required before project completion on `main`

If later you choose to export delivery reports into tracked docs files:

- export only from the final project branch state
- commit them only after QA/remediation are settled

## Failure And Recovery Rules

### Worker Failure Before Commit

If a worker fails before producing a valid commit:

- keep the branch
- keep the worktree if useful for retry
- no merge
- mark runtime state as failed

### Verification Failure After Commit

If a worker commits but verification fails:

- keep the branch unmerged
- create remediation or retry on top of that branch
- do not merge into project branch

### Merge Conflict

If a story branch no longer rebases cleanly onto the current project branch:

- engine rebases or recreates branch from current project branch
- worker reruns in bounded mode
- old branch lineage remains referenced in runtime metadata

The worker must not attempt to resolve merge strategy on its own.

## Suggested Implementation Order

1. Define branch naming rules in docs and code constants
2. Add Git metadata fields to story execution runtime records
3. Add engine-owned branch creation for one story execution
4. Add one-branch-per-story commit flow
5. Add merge gate from story branch to project branch
6. Add project branch creation and project-level merge gate to `main`
7. Add worktree support for parallel execution
8. Add remediation branch handling
9. Add documentation invalidation rules relative to Git state

## Non-Goals For The First Cut

Do not include yet:

- GitHub PR automation
- release tagging
- semantic versioning automation
- cross-repo orchestration
- deployment automation
- organization-wide mono-repo policy

## Success Criteria

The Git workflow is in a good first state when:

- each story execution has its own branch
- workers never write directly to `main`
- story merge requires passing story-local gates
- project merge requires passing QA and fresh documentation
- remediation can reopen and repair bounded code safely
- Git state is traceable from runtime records
- parallel execution can later move to managed worktrees without redesigning the whole model
