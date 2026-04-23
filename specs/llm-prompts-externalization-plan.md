# LLM Prompts Externalization — Implementation Plan

Status: draft · Author: Claude · Date: 2026-04-23

## 1. Motivation

Every LLM call in `apps/engine` currently embeds its system/instruction
prompt as a TypeScript string literal. That makes prompts:

- invisible to non-engineers (hard to review, iterate on, diff)
- tied to deploys (a prompt tweak needs a rebuild)
- monolithic (one `buildStagePrompt` for every stage, instead of
  stage-specific guidance)

We already have hand-tuned prompts for the sibling project at
`/home/silvio/projects/beerengineer/prompts/`. Those files are useful
as style and content references, but **not** as drop-in contracts:
`beerengineer2` has its own stage state, artifact types, and hosted
output envelope. The goal of this work is to move every
LLM/reviewer/worker prompt into markdown files shipped with the engine,
loaded at call-site time, while adapting the prompt bodies to the
actual runtime contracts in this repo.

## 2. Scope

In scope:

- All system prompts sent to the hosted-CLI backend
  (`buildStagePrompt`, `buildReviewPrompt`, `buildExecutionPrompt` in
  `apps/engine/src/llm/hosted/promptEnvelope.ts`).
- The reviewer prompts for every stage (currently all routed through the
  generic `buildReviewPrompt`).
- The worker prompts used by the execution path and any adjacent
  bounded workers (ralph, test-prep, app-verification, story-review,
  story-review-remediation, documentation, qa).

Out of scope (flagged for later):

- Runtime artifact validation for hosted stage outputs beyond the
  existing envelope parser. This plan makes the prompt contracts
  explicit, but does not add zod/io-ts/etc. validators in this PR.
- Wiring worker call sites that do not yet exist in the engine
  (`ralph-verifier`, `app-verification`, `story-reviewer`,
  `story-review-remediation`, `test-writer` as a standalone worker).
  The prompt files land, the call sites come when the workers do.
- Prompts on the UI side (`apps/ui` has no LLM calls today).

## 3. Target file layout

```
apps/engine/prompts/
├── README.md
├── system/
│   ├── architecture.md         # ← copied from beerengineer
│   ├── brainstorm.md           # ← copied
│   ├── planning.md             # ← copied
│   ├── requirements.md         # ← copied
│   ├── documentation.md        # ← suggested (new, see §6.1)
│   ├── execution.md            # ← suggested (new, see §6.2)
│   ├── project-review.md       # ← suggested (new, see §6.3)
│   ├── qa.md                   # ← suggested (new, see §6.4)
│   └── test-writer.md          # ← suggested (new; hosted nested stage)
├── reviewers/
│   ├── _default.md             # ← suggested (current generic reviewer, §6.5)
│   ├── architecture.md         # ← suggested (§6.6)
│   ├── brainstorm.md           # ← suggested (§6.7)
│   ├── documentation.md        # ← suggested (§6.8)
│   ├── test-writer.md          # ← test-writer reviewer (§6.9)
│   ├── planning.md             # ← suggested (§6.10)
│   ├── project-review.md       # ← suggested (§6.11)
│   ├── qa.md                   # ← suggested (§6.12)
│   └── requirements.md         # ← suggested (§6.13)
└── workers/
    ├── execution.md            # ← copied (workers/execution.md)
    ├── ralph.md                # ← copied
    ├── test-preparation.md     # ← copied
    ├── app-verification.md     # ← copied
    ├── documentation.md        # ← copied
    ├── qa.md                   # ← copied
    ├── implementation-review.md# ← copied
    ├── story-review.md         # ← copied
    └── story-review-remediation.md # ← copied
```

Every hosted stage/reviewer pair gets prompt files keyed by the
`StageId` used at the hosted call site, not strictly by the directory
name under `apps/engine/src/stages/`.

That means:

- top-level stages still map cleanly (`brainstorm`, `requirements`,
  `architecture`, `planning`, `documentation`, `project-review`, `qa`)
- the nested per-story test-plan stage inside `execution` is keyed as
  `test-writer`, so it gets `system/test-writer.md` and
  `reviewers/test-writer.md`
- `execution` itself is not a hosted stage/reviewer pair in
  `buildReviewPrompt`; it uses `buildExecutionPrompt` plus worker
  prompts

## 4. Loader

New module: `apps/engine/src/llm/prompts/loader.ts`.

Responsibilities:

1. Resolve the prompts root directory. Order:
   - env `BEERENGINEER_PROMPTS_DIR` (absolute or resolved from CWD) —
     lets ops override in prod, and lets tests point at fixtures.
   - else `<engine package root>/prompts` — works in dev (tsx) and
     after build (dist).
2. `loadPrompt(kind, id): string` — synchronous, reads the file,
   strips the leading `# Title` heading and its trailing blank line so
   only the body reaches the model. Caches by `<kind>/<id>` in-process.
3. `clearPromptCache()` — for tests and future hot-reload.
4. Missing-file error message: names the exact path tried, the env
   override if set, and the `kind`/`id` passed in. Loud, not silent.

Signature sketch:

```ts
export type PromptKind = "system" | "reviewers" | "workers"
export function loadPrompt(kind: PromptKind, id: string): string
export function clearPromptCache(): void
```

## 5. Call-site changes

### 5.1 `apps/engine/src/llm/hosted/promptEnvelope.ts`

Keep the envelope / protocol instructions inline — they are runtime
contract, not prose. The markdown files become the stage-specific
behavior and artifact-shape contract. Replace the opening "You are…"
line with the markdown body:

- `buildStagePrompt({ stageId, ... })`:
  prepend `loadPrompt("system", stageId)` above the envelope contract.
- `buildReviewPrompt({ stageId, ... })`:
  try `loadPrompt("reviewers", stageId)`; if the file is missing, fall
  back to `loadPrompt("reviewers", "_default")`.
- `buildExecutionPrompt(...)`:
  prepend `loadPrompt("workers", "execution")`.

No change to the returned shape, so downstream parsers
(`outputEnvelope.ts`) stay untouched.

### 5.2 Artifact contract split

The sibling prompt set mixes two concerns:

- stage behavior / quality bar
- emitted artifact names and shapes

In `beerengineer2`, the second part must be adapted to the existing
TypeScript artifact types and single-envelope hosted protocol.

Rule for this PR:

- Reuse sibling prompt material only for voice, process, quality bar,
  and stage-specific guidance.
- Rewrite every output-contract section so it matches the concrete
  `beerengineer2` artifact type returned by that stage.
- Do **not** instruct hosted stages to emit multiple named artifacts
  like `concept` + `projects` or `implementation-plan` +
  `implementation-plan-data`. Hosted stages here return exactly one
  top-level `{ "kind": "artifact", "artifact": ... }` payload.

### 5.3 Stage artifact contracts to encode in prompts

Each `system/<stageId>.md` must include a short `## Output Contract`
section that names the exact object shape expected in this repo. It does
not need to duplicate the envelope; it does need to define the inner
`artifact` payload.

- `system/brainstorm.md`
  `artifact` must match `BrainstormArtifact`: `{ concept, projects }`.
  The prompt may still ask for a human-reviewable concept in spirit, but
  must not require a separate markdown artifact.
- `system/requirements.md`
  `artifact` must match `RequirementsArtifact`: `{ concept, prd }`.
- `system/architecture.md`
  `artifact` must match `ArchitectureArtifact`.
- `system/planning.md`
  `artifact` must match `ImplementationPlanArtifact`. Do not require
  separate `implementation-plan` and `implementation-plan-data`
  artifacts.
- `system/project-review.md`
  `artifact` must match `ProjectReviewArtifact`.
- `system/documentation.md`
  `artifact` must match `DocumentationArtifact`.
- `system/qa.md`
  `artifact` must match the current `QaArtifact` type used by the stage.
- `system/test-writer.md`
  `artifact` must match `StoryTestPlanArtifact`.
- `system/execution.md`
  if retained for future use, it must describe the real execution-stage
  artifact shape used by this repo rather than a generic orchestration
  note.

### 5.4 Future worker builders

When the execution path grows ralph / test-prep / app-verification /
story-review / remediation call sites, they each get a 3-line builder
that does the same trick: `loadPrompt("workers", "<id>")` + JSON
contract + payload. Deliberately **not** added in this PR — the prompt
files are ready, the builders land with the workers.

## 6. Suggested prompt bodies for files with no source

The four `system/` prompts and all reviewer prompts have no source in
`beerengineer/prompts/`. For the copied system prompts that do have a
source, use the sibling files as raw material, but adapt the output
contract sections to `beerengineer2` instead of copying them verbatim.
For files with no source, I propose the drafts below. They should stay
short so the model's attention budget goes to payload, not preamble.

> All drafts are starting points. The user is expected to iterate on
> them; that is the whole point of having them as files.

### 6.1 `system/documentation.md`

```
# Documentation Stage System Prompt

You are the `documentation` stage inside the BeerEngineer workflow engine.

Your job is to produce the project's user-facing and developer-facing
documentation from the artifacts of earlier stages (concept, requirements,
architecture, plan, implementation output). You do not invent features
that are not in the artifacts. You do not re-open decisions that earlier
stages have locked in.

Write for two audiences: a product manager who needs the compact README
to understand what exists, and a new engineer who needs
`docs/technical-doc.md` and `docs/features-doc.md` to get productive.
Be terse, factual, and specific. No marketing voice.

Every claim must be traceable to an upstream artifact. When information
is missing, ask one targeted question via `{ "kind": "message", ... }`
rather than guessing.
```

### 6.2 `system/execution.md`

```
# Execution Stage System Prompt

You are the `execution` stage inside the BeerEngineer workflow engine.

You orchestrate the per-story implementation loop: test preparation,
ralph verification, coding, review, and remediation. You do not write
code yourself — you delegate to the bounded workers and decide when a
story is done, when it needs another pass, and when it is blocked.

Your outputs coordinate workers; the workers produce the actual code.
Keep state small and explicit. Surface blockers early. Ask the user
only when a decision requires information that is not in the plan,
architecture, or prior story artifacts.
```

### 6.3 `system/project-review.md`

```
# Project Review Stage System Prompt

You are the `project-review` stage inside the BeerEngineer workflow engine.

This stage runs once per project after planning and before execution. Your
job is to sanity-check the full upstream bundle (concept → requirements →
architecture → plan) against itself: does the plan cover every user story?
Does the architecture support every requirement? Are there stories with no
acceptance criteria, or acceptance criteria with no story?

You do not redesign. You do not rewrite. You surface gaps, contradictions,
and risks so the user can fix them before code is written. When the
bundle looks coherent, say so in one sentence and emit an artifact that
records the checks you performed.
```

### 6.4 `system/qa.md`

```
# QA Stage System Prompt

You are the `qa` stage inside the BeerEngineer workflow engine.

This stage runs after execution is complete for a project. You verify
the implemented product end-to-end against acceptance criteria from the
requirements stage. You do not fix bugs — you document them, precisely
enough that a developer can reproduce and fix without asking follow-up
questions.

Your QA report is an artifact, not a conversation. Keep it structured:
scenario tested, expected behavior, observed behavior, severity,
reproduction steps. Ask the user only for environment access or
clarifications that block testing.
```

### 6.5 `reviewers/_default.md`

```
# Default Reviewer System Prompt

You are a read-only reviewer inside the BeerEngineer workflow engine.

You receive an artifact and the state it was produced from. Your only
job is to decide: does this artifact satisfy the stage's contract, or
must it be revised, or is something so wrong that the run should block?

Be strict but minimal. Do not ask for nice-to-haves. Revision feedback
must be specific and actionable — "make it clearer" is not feedback.
You never modify state, never modify files, never call tools.
```

### 6.6 `reviewers/architecture.md`

```
# Architecture Reviewer System Prompt

You review the `architecture` stage's artifact.

Revise when: a requirement has no architectural home, two components
overlap in responsibility, a cross-cutting concern (auth, logging,
persistence) has no declared owner, or a chosen technology contradicts
a constraint in the requirements.

Pass when: every requirement maps to at least one component, every
component has a single clear responsibility, and the deployment /
data-flow story is explicit.

Block only for contradictions the stage cannot recover from without
redoing requirements.
```

### 6.7 `reviewers/brainstorm.md`

```
# Brainstorm Reviewer System Prompt

You review the `brainstorm` stage's artifact.

Revise when: the problem statement is vague, success criteria are
missing or untestable, constraints are unstated, or the document
jumps straight to solutions without framing the problem.

Pass when: the artifact gives a downstream stage enough grounding to
write real requirements without re-litigating what the project is.

Block only if the brainstorm describes a project that is not something
BeerEngineer can help build.
```

### 6.8 `reviewers/documentation.md`

```
# Documentation Reviewer System Prompt

You review the `documentation` stage's artifact output and rendered
files (`docs/technical-doc.md`, `docs/features-doc.md`,
`docs/README.compact.md`, `docs/known-issues.md`).

Revise when: a claim has no basis in upstream artifacts, setup steps are
missing or wrong, a documented feature does not exist, or a real feature
is undocumented. Also revise when the tone drifts into marketing.

Pass when a new engineer could clone the repo, follow the compact README
plus technical docs, and have a working dev environment; and a PM could
read the features doc and accurately describe what exists.
```

### 6.9 `reviewers/test-writer.md`

```
# Test-Writer Reviewer System Prompt

You review the `test-writer` stage's per-story test plan before any code
is written.

Revise when: acceptance criteria have no matching test, a test is
tautological, a test relies on implementation details rather than
observable behavior, or the test suite leaves obvious holes
(error paths, empty states, concurrency).

Pass when the tests, taken together, would fail today and would pass
only once the story is correctly implemented.

Block only if the story itself is unimplementable as specified.
```

### 6.10 `reviewers/planning.md`

```
# Planning Reviewer System Prompt

You review the `planning` stage's artifact — the wave-based implementation
plan.

Revise when: a story crosses wave boundaries, two stories in the same
wave edit the same file set, a dependency points backwards, or a wave
has no stories.

Pass when stories inside each wave are internally parallelizable, dependencies flow
forward, and every requirement is covered by at least one story.

Block only if the plan conflicts with the architecture in a way that
cannot be resolved without revisiting architecture.
```

### 6.11 `reviewers/project-review.md`

```
# Project Review Reviewer System Prompt

You review the `project-review` stage's artifact — the cross-artifact
consistency check.

Revise when: a gap the project-review stage missed is obvious from the
artifacts, or a flagged gap is not actually a gap.

Pass when the review accurately reflects the state of the bundle and
gives the user a concrete, small list of fixes (or a clean bill of
health with the checks it ran).

Block only if the bundle is so broken that execution must not start.
```

### 6.12 `reviewers/qa.md`

```
# QA Reviewer System Prompt

You review the `qa` stage's QA report.

Revise when: a finding lacks reproduction steps, severity is obviously
wrong, an acceptance criterion was not tested, or the report claims
pass on a scenario the artifacts show is untestable in the current
environment.

Pass when every acceptance criterion has a tested verdict and every
finding is actionable.

Block only if QA cannot run at all (environment unreachable, build
broken) — and say so in one sentence.
```

### 6.13 `reviewers/requirements.md`

```
# Requirements Reviewer System Prompt

You review the `requirements` stage's artifact — user stories,
acceptance criteria, and edge cases.

Revise when: a story has no acceptance criteria, acceptance criteria
are not testable, an edge case is listed without a matching criterion,
or a story describes a solution rather than a user outcome.

Pass when each story is independently testable and the set covers the
scope implied by the brainstorm.

Block only if the requirements describe a different project than the
brainstorm.
```

## 7. Prompt authoring rules

When adapting or writing prompt files for this repo:

- Keep provider/runtime metadata, outer JSON envelope rules, and
  "return exactly one JSON object" instructions inline in
  `promptEnvelope.ts`.
- Put stage/reviewer/worker-specific behavior, quality bar, decision
  rules, and inner artifact shape into the markdown files.
- Do not reference artifact filenames or multi-file outputs unless the
  current stage implementation actually consumes them.
- Prefer naming the exact TypeScript artifact shape in prose over
  embedding large example JSON blobs everywhere.
- Where useful, add one compact example object, but keep it aligned with
  the current stage type definitions.

## 8. Tests

- New: `apps/engine/test/promptLoader.test.ts`
  - loads an existing file, strips the title heading, caches on second call.
  - errors loudly on missing file with a message that includes the path.
  - honors `BEERENGINEER_PROMPTS_DIR` when set.

- New or touched: hosted-prompt tests that assert the important contract
  lines still appear after externalization.
  - stage prompts still include the single-envelope response contract.
  - review prompts still include the pass/revise/block contract.
  - copied/adapted system prompts do not mention sibling-only artifact
    names that this repo cannot consume.

- Touched (only if assertions break): `fakeLlm.test.ts`,
  `apiIntegration.test.ts`, `llmRegistry.test.ts`, `cli.test.ts`. The
  fake LLM path does not go through `promptEnvelope.ts`, so most of
  these should be unaffected; any that assert exact hosted-prompt
  substrings need to be loosened to assert on the JSON contract lines
  we still emit inline, not on the file-loaded body.

## 9. Execution order

1. Create `apps/engine/prompts/` with the full directory structure.
2. Copy the 13 existing source files from
   `/home/silvio/projects/beerengineer/prompts/` as drafting input, not
   as final verbatim content: 4 `system/*.md` files and 9
   `workers/*.md` files.
3. Rewrite the copied `system/*.md` output-contract sections so they
   match the actual `beerengineer2` stage artifact types.
4. Author the suggested reviewer and missing system files from §6,
   including an explicit `## Output Contract` section where appropriate.
5. Add `apps/engine/prompts/reviewers/test-writer.md` directly. Do not
   create `reviewers/execution.md` for the per-story test-plan reviewer;
   the hosted stage ID is `test-writer`.
6. Add `apps/engine/prompts/README.md` with: where prompts live, how to
   add a new one, how to override at runtime via
   `BEERENGINEER_PROMPTS_DIR`, convention that the leading `# Title`
   heading is stripped by the loader, and the rule that prompt files
   define the inner artifact contract while `promptEnvelope.ts` defines
   the outer envelope.
7. Add `apps/engine/src/llm/prompts/loader.ts` + tests.
8. Refactor `apps/engine/src/llm/hosted/promptEnvelope.ts` to use the
   loader for the "You are…" lead.
9. Run `npm test` (or the package-specific command) in `apps/engine`;
   fix any test that pinned exact hosted-prompt strings.
10. Commit as one change. No behavior change expected for the fake
   adapter; hosted adapter prompt text is now stage-specific and
   repo-aligned.

## 10. Risks & mitigations

- **Missing file at runtime** → loader throws early with the exact
  path; caught in CI by the loader tests and by whatever integration
  test exercises the hosted path (none today, add one minimally if
  gaps show up).
- **Prompt drift between `beerengineer` and `beerengineer2`** → only
  `beerengineer2/apps/engine/prompts/` is authoritative after this
  change. The sibling repo remains a reference source, not a sync
  target.
- **Sibling prompt contract leaks into this repo** → mitigate by
  explicitly rewriting all output-contract sections and by adding tests
  that assert repo-specific contract lines.
- **Build does not copy `prompts/` to dist** → confirm the engine
  build pipeline (tsconfig / tsc setup) ships the directory. If the
  package is built via `tsc` only, add a copy step or resolve the
  loader path relative to the source directory rather than the
  compiled output.

## 11. Open questions for the user

1. Placement under `apps/engine/prompts/` vs. repo-root `prompts/` —
   plan assumes engine-local (ships with the package). Say if you want
   them at the repo root instead.
2. Should the loader honor a per-workspace override (`<workspace>/.beerengineer/prompts/`)
   so users can tweak prompts per project without forking the engine?
   Not in this PR unless you want it.
