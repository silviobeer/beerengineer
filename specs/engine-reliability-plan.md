# Engine Reliability Plan: Design Fidelity + Shared-Infra Wave

Two changes, sequenced. Together they should move the typical run from
"60% functional, design drifted" to "90% functional, design intact" and
cut wave-merge conflicts to near zero.

Neither requires schema migrations. Both are additive.

> **Revision history.**
>
> *v2 (2026-04-26).* Incorporated codex review. Three fixes vs. v1:
> (a) screen-owner map is now precomputed deterministically before
> execution starts so parallel stories can't race on "first touch";
> (b) added an explicit transport-layer section (1.0) for `design` +
> `mockupHtml` + `references` because none of those fields exist on
> `StoryExecutionContext` today; (c) setup-wave stories now bypass
> the test-writer entirely and run against a structural scaffold
> contract instead of feature-style ACs.
>
> *v3 (2026-04-26).* Generalised "Wave 0 / project-setup" to a
> *shared-infra wave* that's not specific to greenfield. The original
> trigger ("target stack not scaffolded yet") only fires on
> greenfield projects; brownfield runs that touch shared files —
> `package.json`, `design-tokens.css`, `app/layout.tsx`, etc. —
> still produce the same merge-conflict cascade. Reframed the
> trigger as "two or more stories will write to the same file";
> not-yet-scaffolded becomes one specific case. The contract
> mechanism (`expectedFiles` / `expectedScripts` / `postChecks`)
> is unchanged because it already works for both *create* and
> *extend* deltas.

---

## Part 1 — Restore design fidelity end-to-end

**Problem.** The coder gets `design.json` as text inside a 50KB+ payload;
the most concrete artifact (`mockupHtmlPerScreen`) is stripped before it
reaches execution; the model treats `accent: "#e6bd5c"` as one field
among hundreds and falls back to `bg-zinc-950` because it's easier.
Result: petrol-and-gold spec ships as zinc-and-amber.

### 1.0. Plumbing: extend `StoryExecutionContext` so design can travel

`StoryExecutionContext` (`apps/engine/src/types/execution.ts`) today
exposes `item`, `project`, `conceptSummary`, `story`, `architectureSummary`,
`wave`, `storyBranch?`, `worktreeRoot?`, `testPlan`. There is no
`design` field, no `mockupHtml` field, and no `references` field. Every
later step in this plan assumes those exist, so they have to be added
first.

Add three optional fields:

```ts
export type StoryReference = {
  kind: "file" | "snippet" | "note"
  name: string
  // For kind:"file" — absolute path to the source artifact on disk.
  path?: string
  // For kind:"snippet" — inline content (HTML, markdown, etc.).
  content?: string
  // Operator-style instruction the coder should follow verbatim
  // (e.g. "Copy this file unchanged to apps/ui/app/design-tokens.css").
  instruction?: string
}

export type StoryExecutionContext = {
  // ... existing fields ...
  design?: DesignArtifact      // tokens / typography / spacing / borders / antiPatterns
  mockupHtml?: string           // canonical visual reference for the screen this story owns
  references?: StoryReference[] // explicit artifacts the coder must consume
}
```

`buildStoryExecutionContext` in
`apps/engine/src/stages/execution/index.ts` is the single point where
all of this gets populated. It already reads `ctx.architecture`; extend
it to read `ctx.design` and the new screen-owner map (see 1c) and
fill the three optional fields per story.

`projectDesign()` in `core/designPrep.ts` keeps stripping
`mockupHtmlPerScreen` from the per-project design (still right — the
project context is shared by every story and would bloat). The mockup
travels via `storyContext.mockupHtml` for exactly the screen-owner
story. Same idea for `storyContext.references`.

The hosted prompt envelope already JSON-stringifies `storyContext` into
the worker payload, so once the fields exist, the coder sees them
without further wiring. The execution worker prompt (`prompts/workers/execution.md`)
needs to mention them so the model treats them as ground truth — covered
in 1d.

**Tests.** Unit test on `buildStoryExecutionContext`:
- design field populated from the project context's design
- mockupHtml populated only for the screen-owner story
- references list contains the design-tokens.css path for setup stories
  (covered fully in Part 2)

### 1a. Emit a literal `design-tokens.css` artifact

Where: `apps/engine/src/stages/frontend-design/`.

The frontend-design stage already produces `design.json` with full
light + dark palettes, typography, spacing, and borders. Add a
deterministic *renderer* that turns those values into a single CSS
file the coder can import verbatim:

```
:root, html.light, [data-theme="light"] { --color-primary: #005a65; ... }
@media (prefers-color-scheme: dark) { :root { --color-primary: #2da3b0; ... } }
html.dark, [data-theme="dark"]        { --color-primary: #2da3b0; ... }

/* Sharp-edge anti-pattern enforcement (from design.borders) */
*, *::before, *::after { border-radius: 0 !important; }

/* Typography tokens */
:root {
  --font-display: 'Space Grotesk', 'Inter', system-ui, sans-serif;
  --font-body:    'Inter', system-ui, sans-serif;
  --font-mono:    'JetBrains Mono', 'SFMono-Regular', Menlo, monospace;
  --font-size-base: 0.9375rem;
  ...
}
```

Persisted as a stage artifact alongside `design.json` and
`design-preview.html`:

```
runs/<runId>/stages/frontend-design/artifacts/
  design.json
  design.md
  design-preview.html
  design-tokens.css     <-- NEW
```

The renderer is a pure function `renderDesignTokensCss(design): string`.
Drop it next to `render/prd.ts` (already an established pattern).

**Tests.** Snapshot test: pass a synthetic `DesignArtifact`, assert the
emitted CSS contains all 11 light + 11 dark tokens, the
`border-radius: 0` reset, and three font-family declarations.

### 1b. Wave 0 (separate change) ships `design-tokens.css` to the repo

The actual file write into `apps/ui/app/design-tokens.css` happens in
the project-setup wave (Part 2). Keeping the **renderer** in
frontend-design and the **delivery** in wave 0 means we keep the design
artifact reproducible from the design.json without any other state.

### 1c. Give the screen-owner story the mockup HTML

Where: new `apps/engine/src/core/screenOwners.ts`, consumed by
`buildStoryExecutionContext` (1.0) before any story runs.

**Determinism is the requirement.** v1 of this plan computed
"first-touch" lazily inside execution as stories ran, which races
under parallel execution: two stories in the same wave both believe
they are first because they start before either has finished. Compute
ownership once, up front, before any worktree is created.

```ts
export type ScreenOwnerMap = Record<string /* screenId */, string /* storyId */>

export function computeScreenOwners(
  prd: PRD,
  plan: ImplementationPlanArtifact,
  wireframes: WireframeArtifact | undefined,
): ScreenOwnerMap
```

Resolution rules, applied in plan-order so two runs of the same plan
produce the same map:

1. Iterate waves in `plan.waves` order, then stories in
   `wave.stories` order (the planner's declared order, not parallel
   execution order).
2. For each story, derive the set of screen ids it touches:
   - First, look at the story's `screens` field if the test-writer or
     planner emits it.
   - Else, scan the story's acceptance criteria and title text for any
     `screenId` from `wireframes.screens` (substring match,
     case-insensitive).
   - Else, the story owns no screen and is skipped.
3. The first story (in iteration order) seen for each `screenId`
   becomes that screen's owner. Subsequent stories touching the same
   screen are not owners.

Owner-map result is plumbed once into execution and consumed by
`buildStoryExecutionContext`. Story whose id matches `owners[screenId]`
gets `mockupHtml = design.mockupHtmlPerScreen[screenId]` on its
context; everyone else gets `mockupHtml: undefined`.

**Edge cases.**
- Story touches multiple screens → owner of any screen it's the
  earliest for. The context can carry a list (`mockupHtml: string[]`)
  but in practice each story owns at most one screen and we enforce
  that with a `console.warn` if a single story is owner of more than
  one. Cap at three to avoid unbounded payload bloat.
- Same screen has zero owner (no story matches) → mockup never
  reaches any coder; not a regression vs. today.
- Resume / replay → the owner map is recomputed deterministically from
  the same plan, so a resumed run reaches the same conclusions.

**Why first-only:** the mockup is the canonical visual reference. Once
the owner story renders the screen and commits files, later stories
read that file as ground truth and the mockup becomes redundant
context bloat. The owner gets the visual fidelity boost; everyone
else doesn't pay the token cost.

**Tests.**
- `computeScreenOwners` covering: plan-order tie-breaking, multi-wave
  ordering, story-touches-no-screen, story-touches-multiple-screens,
  empty wireframes input.
- `buildStoryExecutionContext`: owner story gets `mockupHtml`,
  non-owner story for same screen gets `undefined`.

### 1c-bis. Keep `projectDesign()` stripping the mockup map

Leave `projectDesign()` as-is — it strips `mockupHtmlPerScreen` so
the *project-level* `ProjectContext.design` stays small. The mockup
delivery channel is the new per-story `storyContext.mockupHtml` field
(via 1.0 + 1c), not the project context. No regression vs. today's
behavior; only owner stories get the bytes.

### 1d. Move design rules from payload into the story-coder system prompt

Where: `apps/engine/prompts/workers/execution.md`.

Add a fixed section that the model sees on every coder turn, not only
when the design block happens to surface:

```md
## Design system enforcement

The repository ships a single source of truth at `apps/ui/app/design-tokens.css`.

Hard rules — violating any of these means the change must be revised:
- Every color you write MUST come from a `var(--color-*)` token. No
  hardcoded hex values. No Tailwind palette classes
  (`bg-zinc-*`, `text-amber-*`, `border-slate-*`, etc.). The only
  exception is reading the token's value back from the file you imported.
- Every interactive element (button, card, chip, badge, input, dropdown)
  MUST be sharp-cornered. Do not write `rounded`, `rounded-*`, or any
  `border-radius` other than `0`. The global reset in `design-tokens.css`
  enforces this; do not undo it.
- Mono font is reserved for code, log lines, item codes, chip labels,
  timestamps, and keyboard hints. Use `var(--font-mono)`. Display headings
  use `var(--font-display)`. Body text uses `var(--font-body)`.
- Every component file you create MUST start by importing
  `app/design-tokens.css` if it is the entry layout, OR rely on the
  layout having imported it. Never re-declare tokens.

If you are tempted to ship a hardcoded color "just for now": stop and
either add the token to `design-tokens.css` (and the design.json that
generated it) or use the closest existing token.
```

This goes in the system prompt because it's a fixed rule, not
per-story state. Cost: ~200 extra tokens per coder turn, paid by
prompt caching after the first call in a session.

### 1e. Programmatic design-system gate in the reviewer

Where: `apps/engine/src/review/` (next to coderabbit/sonarcloud).

Add a tiny built-in gate that runs *before* the LLM reviewer, against
the per-story diff:

- Fail if any newly-added file matches `\b#[0-9a-fA-F]{3,8}\b` outside
  of `design-tokens.css` and `*.test.tsx`.
- Fail if any newly-added line contains a Tailwind palette class:
  `\b(bg|text|border|ring|outline|fill|stroke|from|to|via)-(zinc|slate|gray|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b`.
- Fail if any newly-added line contains `rounded` (any variant) or
  `border-radius:\s*[^0]`.

These are tens of lines of regex; not a model call. Findings get fed
into the existing review-feedback channel so the coder fixes them on
the next iteration without burning a review cycle.

**Acceptance.** A run that ships `bg-zinc-950` in `Topbar.tsx` should
fail this gate on cycle 1, get a feedback string like
`design-system-violation: Topbar.tsx:14 used Tailwind palette class 'bg-zinc-950' — replace with var(--color-bg)`,
and the coder corrects it without the model needing to "notice" the
problem.

### Part 1 deliverables (TDD order)

1. Extend `StoryExecutionContext` with `design`, `mockupHtml`,
   `references` + the `StoryReference` type (1.0)
2. `render/designTokensCss.ts` + snapshot test (1a)
3. Wire renderer into frontend-design stage's `persistArtifacts` (1a)
4. `core/screenOwners.ts` with `computeScreenOwners()` + unit test (1c)
5. Plumb owner map through execution into
   `buildStoryExecutionContext`; populate the new context fields (1.0 + 1c)
6. Add design-system block to `prompts/workers/execution.md` (1d)
7. `review/designSystemGate.ts` + unit test (1e)
8. Plumb gate into `runStoryReviewTools()` alongside coderabbit/sonar (1e)

Estimated effort: ~1.5 days. No schema changes.

---

## Part 2 — Shared-infra wave (serialise cross-cutting edits)

**Problem.** Every story independently writes to shared files —
`package.json`, `vitest.config.ts`, `globals.css`, `app/layout.tsx`,
`app/_lib/types.ts` — and the first story to land each file defines
reality. Later stories conflict on it (observed: 4 separate runs with
8-file wave→project conflicts on the same shared infra) AND inherit
whatever shape story 1 invented (e.g. `--bg-base` instead of the
canonical `--color-bg`).

This isn't a greenfield-only problem. A brownfield project with a
clean `apps/ui` already in place still hits the same cascade as soon
as a wave has multiple stories that need to *extend* the same file:
add a new design token; bump a shared dependency; register a new
type in `app/_lib/types.ts`; wire a new context provider into
`app/layout.tsx`. The conflict mechanism is identical — only the
diff base differs.

**Solution.** Detect "two or more stories in this wave will write to
the same file" at planning time, lift the conflicting writes into a
single serial setup wave that runs first, then let the feature
stories branch from a tree where the shared edits are already
settled. Brownfield runs that don't trigger this condition are
unaffected.

### 2a. Add a `setup` wave kind

Where: `apps/engine/src/types/domain.ts` (or wherever
`WaveDefinition` lives) — add an optional `kind: "setup" | "feature"`
to the wave shape, defaulting to `"feature"`.

Where: `apps/engine/prompts/system/planning.md` — add a section
instructing the planner to emit a setup wave whenever a feature wave
would otherwise have stories that write to the same file.

Trigger rule (single source of truth, evaluated per wave):

> If two or more stories in the wave will edit the same file, lift
> those edits into a setup wave that runs serially before this one.

"Will edit" is computed from each story's expected file list (the
planner already considers shared-file collision when deciding wave
membership; this just elevates the consequence from "warning" to
"split a setup wave").

Greenfield is the special case where every shared file is *missing*,
so every multi-story wave triggers the rule. Brownfield runs that
don't hit shared-file collisions skip the setup wave entirely and
run unchanged.

The setup wave's stories perform the cross-cutting edits, not feature
work. Concrete examples:

*Greenfield (apps/ui doesn't exist yet)*
- `S-SETUP-1`: Scaffold Next.js 15 app at apps/ui — writes
  `package.json`, `next.config.ts`, `tsconfig.json`, `next-env.d.ts`.
- `S-SETUP-2`: Wire design tokens — copies the frontend-design
  `design-tokens.css` artifact into `apps/ui/app/design-tokens.css`,
  imports it from `app/layout.tsx`.
- `S-SETUP-3`: Configure test infra — installs vitest +
  testing-library + jsdom, writes `vitest.config.ts`,
  `vitest.setup.ts`.

*Brownfield (apps/ui already in place)*
- `S-SETUP-1`: Extend `app/_lib/types.ts` with the four new domain
  types this wave's feature stories all consume.
- `S-SETUP-2`: Add `@playwright/test` + `playwright` to
  `apps/ui/package.json` devDeps and ship `apps/ui/playwright.config.ts`.
- `S-SETUP-3`: Register the new `RunStreamProvider` in
  `apps/ui/app/layout.tsx` so feature stories can `useRunStream()`
  without re-mounting the provider.

Both shapes pass the same `verifySetupContract` —
`expectedFiles` / `expectedScripts` / `postChecks` doesn't care
whether the file existed before; it only checks the post-state.

### 2b. Setup wave runs serial, before any feature wave

Where: `apps/engine/src/stages/execution/index.ts`.

Current code runs all waves in plan order, with stories within a wave
in parallel. Two changes:

1. If a wave has `kind: "setup"`, force serial story execution within
   it (no parallel stories — they'd race on the same shared files
   they're explicitly there to create).
2. The setup wave merges into the project branch before any feature
   wave starts, so feature stories all branch from a tree that already
   has `globals.css`, `package.json`, `vitest.config.ts`, etc.

This is a ~10 line change in `executeWave` plus a guard in `execution`
that runs setup waves first. The existing `dependencies` field on
`WaveDefinition` already lets the planner say "wave 1 depends on
wave 0".

### 2c. Setup stories bypass the test-writer

Setup work — scaffolding `package.json`, copying `design-tokens.css`,
configuring vitest — is not feature work and must not flow through the
existing test-writer/coder loop. Today, when a plan story has no
matching PRD entry, the executor synthesises a placeholder story and
the test-writer emits generic "core flow works" acceptance criteria
(`apps/engine/src/stages/execution/index.ts:312` and
`:404`). For setup work that produces noise: tests like "scaffolding
shows correct UX" against files that have no UX.

Decision: **setup stories run a dedicated execution path with no
test-writer**. Concretely, in `runWaveStory`:

```ts
if (wave.kind === "setup") {
  return runSetupStory(ctx, wave, story, opts, llm)
}
// existing test-writer + ralph path stays intact for feature waves
```

`runSetupStory` reuses `runCoderHarness` (so we keep the harness
abstraction, telemetry, and worktree handling) but:

1. Skips test-writer entirely — no `StoryTestPlanArtifact` is
   produced.
2. The `storyContext` carries the explicit setup contract instead of
   acceptance criteria:
   ```ts
   {
     kind: "setup",
     contract: {
       expectedFiles: string[]   // list of paths that MUST exist after the story
       expectedScripts: string[] // npm scripts that must be runnable
       postChecks: string[]      // shell commands; all must exit 0
     },
     references: StoryReference[] // see 1.0; e.g. design-tokens.css
   }
   ```
3. Instead of the review tool gate (CodeRabbit / Sonar / design-system),
   success is a deterministic `verifySetupContract()`:
   - every file in `expectedFiles` exists in the story worktree
   - every script in `expectedScripts` runs to exit 0 (`npm install`,
     `npm run typecheck`)
   - every command in `postChecks` exits 0
   - if any fails, the coder gets the failure messages as targeted
     review feedback and we iterate up to the same review cap that
     applies to other execution stories.

Setup stories are structurally simpler than feature stories — there's
no "ten stages of cycle" to satisfy. They tend to converge in 1–2
iterations because the contract is binary: file exists or not.

PRD shape: setup stories ARE present in the PRD, but with a flag
`kind: "setup"` and a `setupContract` field instead of
`acceptanceCriteria`. Planning prompt update:

```md
When the repo lacks the target stack scaffolding, emit one or more
setup stories at the head of the plan with kind:"setup". Each setup
story declares a setupContract { expectedFiles, expectedScripts,
postChecks } and lists references to artifacts it must consume
(e.g. design-tokens.css from frontend-design). Setup stories do not
get acceptance criteria; the contract is the spec.
```

Requirements stage gets the same instruction so the PRD it emits
already includes the setup stories.

### 2d. Feature stories see setup output as fixed ground truth

Where: `prompts/workers/execution.md` — extend the design-system
block from 1d:

```md
The setup wave has already created `apps/ui/app/design-tokens.css`
and wired it into `apps/ui/app/layout.tsx`. Do not re-create it.
Do not re-declare tokens. If a token is missing, raise it as a
blocker rather than inventing one.
```

Closes the "story 1 invents `--bg-base` instead of importing
`--color-bg`" failure mode.

### 2e. Setup stories carry references via 1.0

The `references` field added in 1.0 is what setup stories use to
receive the `design-tokens.css` artifact from frontend-design. The
setup story's `setupContract.expectedFiles` includes
`apps/ui/app/design-tokens.css` and its `references` includes one
entry pointing at the frontend-design output path. The coder copies
the file; `verifySetupContract` confirms the destination exists.

### 2f. Tests

- Unit: `executeWave` serialises stories within a `kind: "setup"`
  wave even when `BEERENGINEER_SEQUENTIAL_STORIES` is unset.
- Unit: `verifySetupContract` covering missing file, failing script,
  failing post-check, and the all-green path. Cover BOTH the
  *create* case (file doesn't exist beforehand) and the *extend*
  case (file exists with different content beforehand) — the
  contract should match either way as long as the post-state holds.
- Integration (greenfield): fake-LLM run where `apps/ui` doesn't
  exist; planner emits setup wave that scaffolds it; assert
  (a) `verifySetupContract` passes, (b) the test-writer is NOT
  invoked for setup stories, (c) `apps/ui/app/design-tokens.css`
  exists in the feature-story worktree, (d) the setup wave finishes
  before the feature wave starts.
- Integration (brownfield): fake-LLM run where `apps/ui` exists with
  a stub `app/_lib/types.ts`; planner detects two feature stories
  both want to extend the same file and emits a setup wave that
  performs the type additions once; assert the feature stories see
  the extended file in their worktrees.
- Regression: planner outputs whose feature waves don't have
  shared-file collisions skip setup entirely and run unchanged
  through the feature-only path.

### Part 2 deliverables (TDD order)

1. Type extension: `WaveDefinition.kind`, `UserStory.kind` +
   `setupContract` (story-level), `StoryReference` already added in
   1.0
2. Planner prompt update + requirements prompt update + a fake-LLM
   that emits a setup wave with a real setup contract
3. `executeWave`: serial story execution for setup waves; setup
   waves must complete before any feature wave starts
4. `runSetupStory` + `verifySetupContract` (new, no test-writer
   invocation)
5. Branch in `runWaveStory` to call `runSetupStory` when
   `wave.kind === "setup"`
6. Reference plumbing: setup story's references list the
   `design-tokens.css` artifact path from the active
   frontend-design run
7. Worker prompt update for feature stories ("setup is done; do not
   re-declare tokens")
8. Integration test for the full setup→feature sequence

Estimated effort: ~2 days (was 1.5; +0.5 for the setup-bypass code
path that didn't exist in v1). No schema changes; both `kind` fields
and `setupContract` are optional.

---

## Sequencing

Both parts depend on **1.0 (transport)** — without it neither the
mockup nor the design-tokens.css reference can reach the coder. Land
that first as a no-op refactor (fields exist, nothing populates them
yet).

Suggested order:
1. 1.0 (StoryExecutionContext extension) — half day
2. 1a/1b (renderer + frontend-design wiring) — half day
3. 1c (`computeScreenOwners` + plumb into `buildStoryExecutionContext`)
   — half day
4. 1d/1e (prompt + reviewer gate) — half day
5. 2a–2f (setup wave) — two days

Total: ~3.5 days. Each piece is independently testable; ship them as
separate PRs so a regression in one doesn't roll back the others.

The `Topbar.tsx` / `LogRail.tsx` / `BoardCard.tsx` `--color-accent`
fallback to `#5fa` (mint) in the current candidate is a useful
acceptance signal: a real run with all of Part 1 in place must NOT
emit any code that needs that fallback to render correctly.

---

## What this does NOT cover

Out of scope deliberately:

- **Visual diffing / screenshot review.** Real fix but expensive (Playwright,
  baseline images, flake handling). Track separately.
- **Reviewer "propose-defer" action.** Mentioned in the diagnosis; goes
  in a separate prompt-engineering pass.
- **Streaming JSON retry on parse error.** One-line defensive fix; do
  it inline next time we touch the provider runtime.
- **Light-mode toggle UX.** The tokens will support it; the toggle is
  a feature story, not infrastructure.
