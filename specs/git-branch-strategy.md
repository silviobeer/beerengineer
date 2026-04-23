# Git Branch Strategy

Target branch hierarchy for the real git-backed workflow:

`base -> item -> project -> wave -> story`

Merge direction:

`story -> wave -> project -> item`

Optional final handoff:

`item -> candidate -> base`

## Goals

- Give every workflow level a real integration boundary.
- Keep broken story work out of wave, project, and item integration branches.
- Make wave-level review and reruns explicit.
- Preserve a final human approval boundary before anything merges back into the user's base branch.

## Scope of v1 (known limitations)

- **Sequential story execution within a wave.** v1 uses a single working tree, so stories inside the same wave are executed one after another, not in parallel. The wave branch is still a meaningful integration boundary (wave-level review, retry, replay), but it is not yet a parallel-merge target. Per-story worktrees are a separate workstream; see [Future work](#future-work).
- **Planning may still mark same-wave stories as internally parallelizable.** The planning stage is allowed to capture safe story-level parallelism inside one wave, but in real git v1 that metadata means "dependency-independent and eligible for future concurrent execution," not "execute concurrently now." Until per-story worktrees exist, same-wave stories still run sequentially against the shared wave branch.
- **Simulation fallback stays available.** Runs fall back to the existing simulated `story -> project -> pr` model when real git mode is not viable (see [Simulation fallback](#simulation-fallback)).

## Branch levels

### 1. Base branch

The base branch is whatever branch the workspace was on when the run starts.
It is captured once at run start and is never hardcoded to `main`.

Examples:

- `main`
- `develop`
- `feat/operator-cockpit`

The engine must never merge into the base branch automatically without an explicit user decision.

### 2. Item branch

One branch per item/run root.

Suggested format:

`item/<item-slug>`

Created from the base branch when an item enters active implementation.

Purpose:

- top-level integration branch for the whole item
- parent branch for all project branches belonging to that item

### 3. Project branch

One branch per project derived from the item.

Suggested format:

`proj/<item-slug>__<project-slug>`

Created from the item branch.

Purpose:

- integration branch for a single project
- parent branch for that project's wave branches

### 4. Wave branch

One branch per execution wave inside a project.

Suggested format:

`wave/<item-slug>__<project-slug>__w<wave-number>`

Created from the project branch.

Purpose:

- integration branch for all stories scheduled in the same wave
- explicit boundary for wave-level review, retries, and replay

Note:

- A wave may contain stories that the planner marked as internally parallelizable within that wave.
- In v1 real git mode, that affects grouping and dependency semantics only; execution inside the wave remains sequential.

### 5. Story branch

One branch per story.

Suggested format:

`story/<item-slug>__<project-slug>__w<wave-number>__<story-slug>`

Created from the wave branch.

Purpose:

- implementation and remediation branch for one story
- isolated place for commits produced during Ralph iterations

### Naming rules

- Deterministic and lowercase-safe.
- Filesystem-safe on all targets: no `:`, no trailing dots, bounded length (keep each path segment ≤ 80 chars).
- Use `__` (double underscore) to separate ID components — slug IDs routinely contain `-`, so `-` is not a safe separator.
- Slug IDs must match `[a-z0-9-]+` after normalization; the engine slugifies non-conforming inputs.

## Branch tree (visual)

```
main (base)
└── item/cockpit-overlay
    └── proj/cockpit-overlay__engine-hardening
        ├── wave/cockpit-overlay__engine-hardening__w1
        │   ├── story/cockpit-overlay__engine-hardening__w1__transport-cleanup
        │   └── story/cockpit-overlay__engine-hardening__w1__overlay-wiring
        └── wave/cockpit-overlay__engine-hardening__w2
            └── story/...
```

The candidate branch (`candidate/<run-id>__<item-slug>`) is cut from `item/*` at handoff time and sits outside this tree.

## Merge flow

All merges use `--no-ff` so that wave, project, and item boundaries remain visible in the commit graph. Fast-forward merges are forbidden at every level except inside a single story branch (where Ralph iterations may fast-forward freely).

### Story to wave

When a story passes its Ralph review gate, merge:

`story/<...> -> wave/<...>`

**Failure handling:**
- Intermediate Ralph iteration failures stay on the story branch — no blocking.
- A story is considered *permanently failed* only after (a) the configured max Ralph iterations are exhausted **and** (b) the operator rejects the story at the review gate. Until both hold, the story is retryable.
- A permanently failed story leaves its branch unmerged and blocks the wave.

### Wave to project

When all required stories in a wave are accepted, merge:

`wave/<...> -> proj/<...>`

**Failure handling:**
- If wave-level review fails, fix work happens on a new story branch cut from the wave branch, then merges back into the wave before the wave is reattempted against the project.
- Wave merges are not reverted — forward-fix only, because the wave branch's history is the audit trail.

### Project to item

When a project has passed execution and downstream stages, merge:

`proj/<...> -> item/<...>`

**Failure handling:**
- If project-level QA fails after the wave already merged, the fix branches off `proj/*` as a new wave (e.g. `wave/...__w3-hotfix`), then merges up through the normal path.
- Rolling back a wave merge is explicitly not supported in v1; forward-fix via an additional wave keeps the audit trail intact.

### Item to candidate

Before user testing or final approval, create a candidate branch from the integrated item branch.

Suggested format:

`candidate/<run-id>__<item-slug>`

Purpose:

- explicit handoff branch for human QA and merge decision
- preserves the item branch as the engine-owned integration branch

(Historically this was called the `pr/*` branch; the term "candidate" is used consistently in the code and docs now. No GitHub PR is implied by the name.)

### Candidate to base

Only after explicit user approval, merge:

`candidate/<...> -> <base-branch>`

- `approve` → merge with `--no-ff`.
- `test` → keep the candidate branch open, do not merge.
- `reject` → leave the candidate branch unmerged and mark it abandoned in engine state.

## Conflict handling

Because v1 runs stories sequentially inside a wave, merge conflicts at the story → wave step are rare but possible when a story touches files already modified in the wave branch by a previous story.

Policy:

1. The engine attempts the merge. If it conflicts, the merge is aborted and the failure is surfaced to the Ralph loop of the current story.
2. The story owner (Ralph) rebases the story branch onto the current wave tip and resolves the conflict on the story branch.
3. The merge is retried.
4. If rebase fails three times on the same story, the story is escalated to operator review and the wave is paused.

Wave → project and project → item conflicts are treated the same way: resolve on the lower branch, retry the upward merge, escalate on repeat failure.

## Simulation fallback

Real git mode is preferred. The engine falls back to the simulated `story -> project -> pr` model when any of the following hold at run start:

- workspace is not a git repository
- workspace has uncommitted or untracked changes ("dirty repo")
- the base branch cannot be resolved
- `git` is not available on `PATH`
- the operator explicitly opts into simulation

Fallback behaviour:

- The engine records the fallback reason in run state.
- The cockpit surfaces a visible "simulated run" badge — fallback is never silent.
- Simulated runs do not produce real branches; the simulated PR output remains the same as today.

## Branch state machine

Per branch, the engine tracks a small state. Allowed transitions:

| Branch    | States                                                            | Allowed transitions                                                                                               |
|-----------|-------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| story     | `created → in-progress → review → accepted|rejected`              | `accepted` merges to wave; `rejected` blocks wave until operator decision                                         |
| wave      | `created → collecting → review → accepted|blocked`                | `accepted` merges to project; `blocked` requires story remediation                                                 |
| project   | `created → integrating → qa → accepted|failed`                    | `accepted` merges to item; `failed` requires a hotfix wave                                                         |
| item      | `created → integrating → ready → handoff`                         | `handoff` cuts the candidate branch                                                                                |
| candidate | `open → approved|test|rejected|abandoned`                         | `approved` merges to base; other terminals leave the branch untouched                                              |

## Worked example

Run: `run-42`, item `cockpit-overlay`, base branch `main`.

1. Engine captures `main` as base, creates `item/cockpit-overlay` off `main`.
2. Project `engine-hardening` starts → `proj/cockpit-overlay__engine-hardening` off `item/cockpit-overlay`.
3. Wave 1 starts → `wave/cockpit-overlay__engine-hardening__w1` off the project branch.
4. Story `transport-cleanup`:
   - `story/cockpit-overlay__engine-hardening__w1__transport-cleanup` off wave.
   - Ralph iterates, review passes, merges `--no-ff` back to wave.
5. Story `overlay-wiring`:
   - Branched off the now-advanced wave tip.
   - Ralph fails three iterations and operator rejects at review → story stays unmerged, wave is `blocked`.
6. Operator schedules a remediation story `overlay-wiring-v2` off the wave → passes → merges back.
7. Wave 1 review passes → wave merges `--no-ff` into project.
8. Project QA fails → new wave `wave/cockpit-overlay__engine-hardening__w2-hotfix` off the project branch, one story, passes, merges up.
9. Project → item merge succeeds.
10. Item enters handoff → `candidate/run-42__cockpit-overlay` cut from `item/cockpit-overlay`.
11. Operator chooses `approve` → candidate merges `--no-ff` into `main`.

## Operational rules

- The engine captures the starting base branch once at run start and stores it in run state.
- v1 forces sequential wave execution; per-story worktrees are out of scope.
- Planning metadata may still describe same-wave parallelism, but real git v1 interprets that as "parallelizable" rather than "parallelized."
- Simulation remains a fallback for tests, non-git workspaces, dirty repos, missing `git`, and unsupported setups.
- Branch naming is deterministic, lowercase-safe, and filesystem-safe.
- The engine may create integration branches automatically, but merges back to the base branch always require explicit user approval.
- All cross-level merges are `--no-ff`.

## Why this structure

Compared with the current simulated `story -> project -> pr` model, this adds two missing integration levels:

- `item`, which represents the whole item as the top-level engine-owned branch
- `wave`, which represents the real integration boundary for sets of stories

That makes the git model match the workflow model more closely:

- idea/item level -> `item/*`
- project level -> `proj/*`
- planning wave level -> `wave/*`
- execution story level -> `story/*`
- human approval gate -> `candidate/*`

## Future work

- **Per-story worktrees** to enable true parallel story execution inside a wave. The engine's existing worktree support makes this feasible; it is deferred to avoid coupling the branch-strategy rollout with the concurrency model change.
- **Revertible wave merges** if forward-fix-only proves too painful in practice.
- **Automatic rebase on story → wave** instead of the current conflict-then-abort approach, once per-story worktrees land.

This is the target design for the real git strategy implementation.
