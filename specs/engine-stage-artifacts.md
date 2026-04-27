# Engine Stage Artifacts: Inputs & Outputs

Reference for what each pipeline stage **reads** from prior stages and
what it **writes** to disk. All artifact paths are relative to
`<workspaceDir>/runs/<runId>/stages/<stage>/artifacts/`.

`<workspaceDir>` = `.beerengineer/workspaces/<workspaceId>/` under the
engine's CWD.

## Pipeline data flow

Reads on the left of the slash, writes on the right. Item-scoped state
(workspace.json, decisions.json, repo-state.json) is implicit input to
every stage and isn't repeated below.

```
  item · decisions
        │
        ▼
  ┌────────────────────────────────────────────────────────────────┐
  │ brainstorm                                                     │
  │   reads:  item, decisions                                      │
  │   writes: concept · projects[]                                 │
  └─────────────────────────────┬──────────────────────────────────┘
                                │
                                ▼
  ┌────────────────────────────────────────────────────────────────┐
  │ visual-companion              (UI items only)                  │
  │   reads:  concept, projects, item-refs                         │
  │   writes: wireframes · lowfi mockups (HTML)                    │
  └─────────────────────────────┬──────────────────────────────────┘
                                │
                                ▼
  ┌────────────────────────────────────────────────────────────────┐
  │ frontend-design               (UI items only)                  │
  │   reads:  concept, projects, wireframes, item-refs             │
  │   writes: design · design-preview · design-tokens.css          │
  └─────────────────────────────┬──────────────────────────────────┘
                                │  fan out per project
                                ▼
  ┌────────────────────────────────────────────────────────────────┐
  │ requirements                                                   │
  │   reads:  concept, wireframes, design, codebase, decisions     │
  │   writes: prd (stories + ACs)                                  │
  └─────────────────────────────┬──────────────────────────────────┘
                                │
                                ▼
  ┌────────────────────────────────────────────────────────────────┐
  │ architecture                                                   │
  │   reads:  prd, wireframes, design, codebase, decisions         │
  │   writes: architecture                                         │
  └─────────────────────────────┬──────────────────────────────────┘
                                │
                                ▼
  ┌────────────────────────────────────────────────────────────────┐
  │ planning                                                       │
  │   reads:  prd, architecture, codebase, decisions               │
  │   writes: plan (waves + stories)                               │
  └─────────────────────────────┬──────────────────────────────────┘
                                │  fan out per wave / per story
                                ▼
  ┌────────────────────────────────────────────────────────────────┐
  │ test-writer                                                    │
  │   reads:  story, architecture-summary, wave, design antiPatterns │
  │   writes: test-plan                                            │
  └─────────────────────────────┬──────────────────────────────────┘
                                │
                                ▼
  ┌────────────────────────────────────────────────────────────────┐
  │ coder (Ralph + worker)                                         │
  │   reads:  story, test-plan, architecture-summary,              │
  │          design guidance, mockupHtmlByScreen (owner only,      │
  │          iteration 1), references                              │
  │   writes: commits on story branch · implementation.json ·      │
  │          story-review.json · review-tool-artifacts/            │
  └─────────────────────────────┬──────────────────────────────────┘
                                │  merge story → wave → project
                                │  (LLM resolver kicks in on conflicts)
                                ▼
  ┌────────────────────────────────────────────────────────────────┐
  │ project-review                                                 │
  │   reads:  full prd, full architecture, plan-summary,           │
  │          execution-summaries                                   │
  │   writes: project-review (findings · recommendations)          │
  └─────────────────────────────┬──────────────────────────────────┘
                                │
                                ▼
  ┌────────────────────────────────────────────────────────────────┐
  │ qa                                                             │
  │   reads:  prd-digest, project-review, merged project branch    │
  │   writes: qa-report                                            │
  └─────────────────────────────┬──────────────────────────────────┘
                                │
                                ▼
  ┌────────────────────────────────────────────────────────────────┐
  │ documentation                                                  │
  │   reads:  prd-digest, architecture-summary, plan-summary,      │
  │          project-review                                        │
  │   writes: README · technical-doc · features-doc (committed)    │
  └─────────────────────────────┬──────────────────────────────────┘
                                │
                                ▼
  ┌────────────────────────────────────────────────────────────────┐
  │ handoff                                                        │
  │   reads:  full project context                                 │
  │   writes: candidate branch · handoff manifest                  │
  └─────────────────────────────┬──────────────────────────────────┘
                                │
                                ▼
                candidate/<runId>__<projectId>__<itemSlug>
                operator answers: test / merge / reject
```

**Branch hierarchy** (real git):
```
master                                            (untouched by engine)
  └─ item/<slug>                                  (one per item, item worktree)
       └─ proj/<slug>__<projectId>                (one per project)
            └─ wave/<slug>__<projectId>__w<n>     (one per wave)
                 └─ story/<slug>__<projectId>__w<n>__<storyId>  (per-story worktree)
```

Stories merge `→` waves merge `→` projects merge `→` item; never into master automatically. The candidate branch off the project tip is what the operator promotes.

## Item-scoped persistent state

Lives outside any single run; survives across reruns of the same item.

| File | Owner | Purpose |
|---|---|---|
| `<workspaceDir>/workspace.json` | engine | item id, current_column, current_run, lifecycle status |
| `<workspaceDir>/decisions.json` | `core/itemDecisions.ts` | operator clarification answers + resume summaries; seeded into every stage that reads `ProjectContext.decisions` |
| `<workspaceDir>/repo-state.json` | `core/repoSimulation.ts` | simulated branch/commit graph (engine's parallel git model) |
| `<runDir>/run.json` | engine | run-level metadata, current_stage, recovery_status |
| `<runDir>/repo-state.json` | engine | per-run snapshot of simulated repo state |

## 1. brainstorm

**Reads**
- `Item` (title, description, optional photo references)
- `ProjectContext` ambient (workspaceId, runId, baseBranch)
- prior `decisions.json` (operator scope decisions for this item)

**Writes** to `stages/brainstorm/artifacts/`
- `concept.json` → `Concept` `{ summary, problem, users, constraints }`
- `concept.md` (rendered)
- `projects.json` → `Project[]` each with `{ id, name, description, hasUi, concept }`
- `summary.md`

**Downstream** seeds `ProjectContext.project.concept` and the project list
that drives every later stage to fan out.

## 2. visual-companion (UI items only — `project.hasUi === true`)

**Reads**
- `concept.json`, `projects.json` from brainstorm
- item references (loaded by `loadItemWorkspaceReferences()` from
  `<itemDir>/references/`)

**Writes** to `stages/visual-companion/artifacts/`
- `wireframes.json` → `WireframeArtifact` `{ inputMode, screens[], navigation, conceptAmendments }`
  - each `screen` carries `{ id, name, purpose, projectIds, layout, elements }`
- `project-freeze.json` (canonical project ID set; later stages assert
  these match)
- `mockups/<screen-id>.html` (lowfi wireframe HTML, one per screen)
- `mockups/sitemap.html` (linked index)

**Downstream** seeds `ProjectContext.wireframes`. `project-freeze.json`
gates `assertDesignPrepProjectFreeze` so resumes can't drift project
sets.

## 3. frontend-design (UI items only)

**Reads**
- `concept`, `projects` from brainstorm
- `wireframes` from visual-companion
- item references

**Writes** to `stages/frontend-design/artifacts/`
- `design.json` → `DesignArtifact` `{ tokens, typography, spacing, borders, shadows, tone, antiPatterns, mockupHtmlPerScreen, conceptAmendments }`
- `design.md`
- `design-preview.html` (token swatches + sample type)
- (planned in Part 1a) `design-tokens.css` (deterministic CSS render of `design.json` tokens)

**Downstream** seeds `ProjectContext.design`. `mockupHtmlPerScreen` is
**stripped from the per-project context** by `projectDesign()` and
delivered per-story to the screen-owner only (planned in Part 1c via
`StoryExecutionContext.mockupHtmlByScreen`).

## 4. requirements (per project)

**Reads**
- `ProjectContext.project.concept`
- `ProjectContext.wireframes` (optional)
- `ProjectContext.design` (optional)
- `ProjectContext.codebase` (compact snapshot from `loadCodebaseSnapshot`)
- `ProjectContext.decisions` (operator-binding scope answers)
- prior clarifications via `runStage`'s history

**Writes** to `stages/requirements/artifacts/`
- `prd.json` → `RequirementsArtifact` `{ concept, prd: { stories[] } }`
  - each `story` `{ id, title, description?, acceptanceCriteria[] }`
  - each `acceptanceCriterion` `{ id, text, priority, category }`
- `prd.md` (rendered)
- `summary.md`

**Downstream** seeds `ProjectContext.prd`.

## 5. architecture (per project)

**Reads**
- `ProjectContext.prd`
- `ProjectContext.wireframes`, `design` (optional)
- `ProjectContext.codebase`
- `ProjectContext.decisions`

**Writes** to `stages/architecture/artifacts/`
- `architecture.json` → `ArchitectureArtifact` `{ project, concept, prdSummary, architecture: { summary, systemShape, components[], dataModelNotes[], apiNotes[], deploymentNotes[], constraints[], decisions[], risks[], openQuestions[] } }`
- `architecture.md`
- `summary.md`

**Downstream** seeds `ProjectContext.architecture`.

## 6. planning (per project)

**Reads**
- `ProjectContext.prd`
- `ProjectContext.architecture` (project-review keeps the full artifact; planning receives a distilled `architectureSummary`)
- `ProjectContext.codebase`
- `ProjectContext.decisions`

**Writes** to `stages/planning/artifacts/`
- `implementation-plan.json` → `ImplementationPlanArtifact` `{ project, conceptSummary, architectureSummary, plan: { summary, assumptions, sequencingNotes, dependencies, risks, waves[] } }`
  - each `wave` `{ id, number, goal, stories[], parallel, dependencies, exitCriteria }`
  - each `wave` may carry `kind?: "setup" | "feature"` (default `feature`); a wave whose `kind` is `setup` triggers serialised execution and the dedicated setup path described in the reliability plan
- `implementation-plan.md`
- `summary.md`

**Downstream** seeds `ProjectContext.plan` and drives wave/story execution.

## 7. test-writer (per story, runs inside execution wave)

**Reads** (`StoryExecutionContext` — see `apps/engine/src/types/execution.ts`)
- `item` `{ slug, baseBranch }`
- `project` `{ id, name }`
- `conceptSummary` (string from project.concept.summary)
- `story` `{ id, title, acceptanceCriteria[] }`
- `architectureSummary` `{ summary, systemShape, constraints, relevantComponents[], decisions[] }`
- `wave` `{ id, number, goal, dependencies }`
- `design` `{ antiPatterns[] }` (negative-test guidance mirrored from the design-system gate)

**Writes** to `stages/execution/waves/wave-<n>/stories/<storyId>/test-writer/`
- `test-plan.json` → `StoryTestPlanArtifact` `{ story, testPlan: { testCases[], coverage, edgeCases, assumptions } }`
  - each `testCase` `{ id, kind, ac, scenario, given, when, then }`
- `test-plan.md`
- `summary.md`

**Downstream** populates `StoryExecutionContext.testPlan` for the coder.

## 8. execution coder (Ralph + worker)

**Reads** (`StoryExecutionContext` — see `apps/engine/src/types/execution.ts`)
- everything test-writer reads, plus:
- `testPlan` (from step 7)
- `storyBranch` (real-git branch name)
- `worktreeRoot` (per-story isolated worktree)
- `primaryWorkspaceRoot` (the main repo checkout where `workspace.json` lives — distinct from the per-story worktree, used for review-policy lookup)
- `kind` (`"feature"` default, `"setup"` routes to the dedicated setup-story path)
- `setupContract` (only when `kind === "setup"`) — `{ expectedFiles[], requiredScripts[], postChecks[] }`
- `design`
  - feature stories: `{ tone, antiPatterns }`
  - setup stories that materialise shared assets: full `DesignArtifact`
- `mockupHtmlByScreen` (only on the screen-owner story, and only on the first coder-session delivery)
- `references` — `StoryReference[]` of explicit artifacts the coder must consume verbatim (e.g. the design-tokens.css path for setup stories)
- prior iterations' `priorAttempts[]` (via `iterationContext`)

**Writes** to `stages/execution/waves/wave-<n>/stories/<storyId>/ralph/`
- `coder-baseline.json` (git baseline before iteration)
- `implementation.json` → `StoryImplementationArtifact` per-iteration log + status
  - includes persisted coder-session delivery state (`mockupDeliveredToSession`) so later iterations stop re-shipping mockup HTML
- `story-review-cycle-<n>.json` (per review cycle)
- `story-review.json` (final review gate verdict)
- `review-tool-artifacts/cycle-<n>/`
  - `coderabbit.raw.txt`
  - `sonar-scan.raw.txt`
  - `sonar-gate.raw.json`
  - `design-system.raw.txt` (Part 1e — programmatic gate for hardcoded colors / Tailwind palette / non-zero radius)
  - `review-tools-summary.json`
- `merge-resolver.<timestamp>.json` (post-fix Part 3) — when a wave-merge needs LLM resolution
  - resolver prompt includes `expectedSharedFiles[]` hints from planning metadata so expected shared-file conflicts are treated as union merges
- `log.jsonl`

**Real-git side effects** (the actual code):
- commits on `story/<slug>__<projectId>__w<n>__<storyId>` (the new commit-on-iteration fix)
- on `passed`: `mergeStoryIntoWaveReal` folds story → wave
- on `blocked`: `abandonStoryBranchReal` parks the branch under `refs/beerengineer/abandoned/`

After all stories: `wave-<n>/wave-summary.json` records `{ storiesMerged[], storiesBlocked[] }`.

## 9. project-review (per project, after all execution waves)

**Reads** (`WithExecution`)
- `ProjectContext.prd`
- `ProjectContext.architecture`
- `ProjectContext.plan`
- `ProjectContext.executionSummaries[]` (one per wave)

**Writes** to `stages/project-review/artifacts/`
- `project-review.json` → `ProjectReviewArtifact` `{ projectId, summary, findings[], recommendations[], readiness }`
  - each `finding` `{ id, severity, category, area, evidence }`
- `project-review.md`
- `summary.md`

**Downstream** seeds `ProjectContext.projectReview`.

## 10. qa (per project)

**Reads**
- `ProjectContext.projectReview`
- the merged project branch state (commits + tests)

**Writes** to `stages/qa/artifacts/`
- `qa-report.json` → `QaArtifact` `{ projectId, status, checks[], issues[] }`
- `summary.md`

**Downstream** lifts `runStage` status from QA's checks.

## 11. documentation (per project)

**Reads**
- `ProjectContext.prd`
- `ProjectContext.architecture`
- `ProjectContext.plan`
- `ProjectContext.projectReview`

**Writes** to `stages/documentation/artifacts/`
- `documentation.json` → `DocumentationArtifact` `{ projectId, files[] }`
- `<each file referenced in artifact.files>` (e.g. `docs/README.compact.md`, `docs/technical-doc.md`, `docs/features-doc.md`) — these get committed into the project worktree by the coder, not just into the artifacts dir.
- `summary.md`

**Downstream** seeds `ProjectContext.documentation`.

## 12. handoff (terminal)

**Reads** the entire `ProjectContext`.

**Writes**
- a `candidate/<runId>__<projectId>__<itemSlug>` branch in the item
  worktree (when the operator answers `merge` to the prompt)
- handoff manifest at `handoffs/<projectId>-merge-handoff.json`
- prompts the operator: `Test, merge or reject candidate? [test/merge/reject]`

The candidate branch is the public output of the run. Manual merge to
master is operator-driven.

## Cross-cutting per-stage outputs

Every stage also writes via `runStage`:

- `stages/<stage>/run.json` — `StageRun` (runId, status, attempts, sessionIds, current state)
- `stages/<stage>/log.jsonl` — append-only event log (chat messages, tool calls, review cycles)
- `stages/<stage>/recovery.json` — written on stage block / failure (post-fix in Part 3c); drives `resume_run`
- `stages/<stage>/artifacts/summary.md` — short narrative summary

## Quick reference: who reads what

| Stage | Reads | Writes (key) |
|---|---|---|
| brainstorm | item, decisions | concept, projects |
| visual-companion | concept, projects, refs | wireframes, mockups |
| frontend-design | concept, projects, wireframes, refs | design, design-preview, design-tokens.css |
| requirements | concept, wireframes, design, codebase, decisions | prd |
| architecture | prd, wireframes, design, codebase, decisions | architecture |
| planning | prd, architecture, codebase, decisions | plan (waves) |
| test-writer | story, architecture summary | test-plan |
| execution coder | story, test-plan, design, mockup (owner), refs | commits + implementation.json + story-review.json |
| project-review | prd, architecture, plan, execution summaries | project-review |
| qa | project-review, merged project branch | qa-report |
| documentation | prd, architecture, plan, project-review | documentation files (committed) |
| handoff | everything | candidate branch + handoff manifest |
