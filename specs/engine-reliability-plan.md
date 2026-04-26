# Engine Reliability Plan: Design Fidelity + Wave 0 Setup

Two changes, sequenced. Together they should move the typical run from
"60% functional, design drifted" to "90% functional, design intact" and
cut wave-merge conflicts to near zero.

Neither requires schema migrations. Both are additive.

---

## Part 1 — Restore design fidelity end-to-end

**Problem.** The coder gets `design.json` as text inside a 50KB+ payload;
the most concrete artifact (`mockupHtmlPerScreen`) is stripped before it
reaches execution; the model treats `accent: "#e6bd5c"` as one field
among hundreds and falls back to `bg-zinc-950` because it's easier.
Result: petrol-and-gold spec ships as zinc-and-amber.

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

### 1c. Restore mockup HTML for the first story per screen

Where: `apps/engine/src/core/designPrep.ts` → `projectDesign()`.

Current code unconditionally strips `mockupHtmlPerScreen` so it doesn't
bloat downstream stages. Replace with a *targeted* projection that
keeps the mockup for stories that are the first to touch a given
screen:

```ts
export function projectDesignForStory(
  design: DesignArtifact,
  story: UserStory,
  alreadyImplementedStoriesPerScreen: Record<string, string[]>,
): DesignArtifact
```

Heuristic: each story's acceptance criteria reference a screen id
(stories already carry `screen` in the test plan; if not, derive from
title). For the first story to touch screen X, keep
`mockupHtmlPerScreen[X]`. For every later story, strip.

The "already implemented" map is built up wave-by-wave inside the
execution stage and threaded into the `runRalphStory` context.

**Why first-only:** the mockup is the canonical visual reference. Once
story 1 renders the screen and commits files, story 2+ can reuse that
file as ground truth and the mockup becomes redundant context-bloat.

**Tests.** Unit test on `projectDesignForStory` covering: first-touch
keeps mockup; second-touch strips it; story whose screen isn't in the
mockup map gets no mockup field at all.

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

1. `render/designTokensCss.ts` + snapshot test
2. Wire renderer into frontend-design stage's `persistArtifacts`
3. `projectDesignForStory()` + unit test
4. Thread per-screen first-touch tracking through execution
5. Add design system block to `prompts/workers/execution.md`
6. `review/designSystemGate.ts` + unit test
7. Plumb gate into `runStoryReviewTools()` alongside coderabbit/sonar

Estimated effort: ~1 day. No schema changes.

---

## Part 2 — Wave 0: project-setup

**Problem.** Every story independently scaffolds `package.json`,
`vitest.config.ts`, `globals.css`, `app/layout.tsx` etc. The first
story to land each file defines reality; later stories conflict on it
(observed: 4 separate runs with 8-file wave→project conflicts on the
same shared infra) AND inherit whatever tokens story 1 invented. A
single setup phase that runs ONCE before any feature work fixes both.

### 2a. Add a `setup` wave kind

Where: `apps/engine/src/types/domain.ts` (or wherever
`WaveDefinition` lives) — add an optional `kind: "setup" | "feature"`
to the wave shape, defaulting to `"feature"`.

Where: `apps/engine/prompts/system/planning.md` — add a section
instructing the planner to emit a `wave 0` with `kind: "setup"`
when:

- The repo state preview shows the target stack hasn't been scaffolded
  yet (no `apps/ui/package.json`, no `tsconfig.json`, no entry layout).
- ANY story will write to `apps/ui/app/layout.tsx`,
  `apps/ui/app/globals.css`, `apps/ui/package.json`,
  `apps/ui/vitest.config.ts`, `apps/ui/tailwind.config.*`, or any other
  shared-infra file.

The setup wave's stories must be self-contained scaffold tasks (not
feature work). Examples for this UI rebuild:

- `S-SETUP-1: Scaffold Next.js 15 app at apps/ui` — writes
  `package.json`, `next.config.ts`, `tsconfig.json`, `next-env.d.ts`.
- `S-SETUP-2: Wire design tokens` — copies the
  frontend-design `design-tokens.css` artifact into
  `apps/ui/app/design-tokens.css`, imports it from `app/layout.tsx`.
- `S-SETUP-3: Configure test infra` — installs vitest +
  testing-library + jsdom, writes `vitest.config.ts`, `vitest.setup.ts`.

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

### 2c. Setup wave reads frontend-design artifacts directly

Where: setup-wave coder context.

The setup story for design tokens needs the literal CSS file from
frontend-design. Inject the artifact into the story's
`storyContext.references` (already a supported field on
`StoryExecutionContext`) so the coder sees:

```
references:
  - kind: "file"
    name: "design-tokens.css"
    path: "<frontend-design artifacts dir>/design-tokens.css"
    instruction: "Copy this file verbatim to apps/ui/app/design-tokens.css"
```

The coder writes one `cp`-equivalent operation; no rewriting, no
hex-color decisions in the model.

### 2d. Feature stories assume setup is done

Where: `prompts/workers/execution.md` — extend the new design-system
block:

```md
The setup wave has already created `apps/ui/app/design-tokens.css`
and wired it into `apps/ui/app/layout.tsx`. Do not re-create it.
Do not re-declare tokens. If a token is missing, raise it as a
blocker rather than inventing one.
```

This closes the "story 1 invents `--bg-base` instead of importing
`--color-bg`" failure mode.

### 2e. Tests

- Unit: `executeWave` serialises stories within a `kind: "setup"`
  wave even when `BEERENGINEER_SEQUENTIAL_STORIES` is unset.
- Integration: a fake-LLM end-to-end run with a planner that emits a
  wave-0 + wave-1 plan; assert wave-0 finishes before wave-1 starts
  AND that the file `apps/ui/app/design-tokens.css` exists in the
  wave-1 story's worktree.
- Regression: existing planner outputs without a setup wave continue
  to work unchanged.

### Part 2 deliverables (TDD order)

1. Type extension: `WaveDefinition.kind`
2. Planner prompt update + a fake-LLM that emits a setup wave
3. `executeWave`: serial execution for setup waves
4. `execution`: enforce setup waves complete before feature waves
5. Reference plumbing for design-tokens.css from frontend-design dir
6. Worker prompt update
7. Integration test for the full setup→feature sequence

Estimated effort: ~1.5 days. No schema changes; new field is
optional.

---

## Sequencing

Part 1 is independent and can ship first. Part 2 depends on Part 1c
(the `design-tokens.css` artifact) so it should land second.
Either order, the artifact-renderer (1a) is the bottom of the
dependency stack — start there.

Suggested order:
1. 1a (renderer) — half day
2. 1b/1d/1e (prompt + reviewer gate) — half day
3. 1c (per-story design projection) — half day
4. 2a → 2e — one and a half days

Total: ~3 days. Each piece is independently testable; ship them as
separate PRs so a regression in one doesn't roll back the others.

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
