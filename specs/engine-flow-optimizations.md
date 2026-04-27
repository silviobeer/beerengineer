# Engine Flow Optimizations: Artifact Distillation + Context Fitness

A focused pass on the artifact flow between stages. The reliability
plan (Part 1 / Part 2 of `engine-reliability-plan.md`) closes the
biggest design-fidelity and merge-conflict gaps. This plan tightens
the artifact pipeline itself: less redundant data per prompt, more
of the *right* data per stage, fewer silent context losses.

The two failure modes we're optimising against:

1. **Bloat:** the same upstream artifact is shipped verbatim into
   multiple downstream stages, each in its own provider session, so
   prompt caching can't help. Tokens that don't move the model's
   output are tokens that obscure the ones that do.
2. **Quiet under-informing:** a stage gets the full upstream
   artifact today; we summarise it; the summary loses a
   load-bearing field; downstream re-invents or drifts. Recent
   examples: the coder re-invented an ad-hoc `EventSource` lifecycle
   in S-07 because `architecture.decisions[]` never reached its
   prompt; the candidate UI shipped `bg-zinc-950` because
   `design.tokens` were buried in a 50KB JSON blob.

Neither requires schema migrations. Both compose with the v4
reliability plan.

---

## Core principle: distill where the job is *synthesis*, keep full where the job is *gap-finding*

A reviewer or writer whose job is to **synthesise** a coherent
deliverable (documentation, project-review summary, hand-off
manifest) can work from a digest. A reviewer or writer whose job is
to **find missing pieces** (architecture vs PRD; project-review vs
architecture decisions) needs every data point — a summary will
elide the very thing it would have flagged.

Concrete examples observed in this codebase:

- Architecture's reviewer caught "Cancel Run AC has no backend
  contract" only because every story's ACs were visible. Summarising
  the PRD into "N stories, M total ACs" would have lost it.
- Project-review caught README/test-bundle drift only because the
  full architecture decisions list was inspectable. A digest of
  "summary + system shape + components" would have hidden the
  decisions and the drift.

**Rule of thumb.** Default to the full upstream artifact. Only
distil when (a) the next stage's job is high-level narrative
(documentation, qa report, hand-off), or (b) the field is
duplicated by a more authoritative artifact downstream
(`design.tokens` after `design-tokens.css` is materialised).

---

## Per-stage context contract (the target shape)

What each stage's payload should contain after this plan ships. The
"existing" column reflects today; "target" is the post-change
shape. ⚠ = backs off vs. earlier optimisation drafts; ➕ = adds
context that's missing today.

| Stage | Existing intake | Target intake | Notes |
|---|---|---|---|
| brainstorm | item, decisions | unchanged | already minimal |
| visual-companion | concept, projects, item-refs | unchanged | needs the visual reference |
| frontend-design | concept, projects, wireframes, item-refs | unchanged | |
| requirements | concept, wireframes, full design, codebase, decisions | concept, wireframes, **design.{tone, antiPatterns}**, codebase, decisions | tokens are visual style; requirements is about behavior. Pruning saves payload, doesn't lose signal. |
| architecture | full PRD, wireframes, full design, codebase, decisions | ⚠ **full PRD (kept; do not digest)**, wireframes, **design.{tone, antiPatterns}**, codebase, decisions | PRD must stay full so architecture's reviewer can spot AC↔contract gaps |
| planning | full PRD, full architecture, codebase, decisions | full PRD (kept), **architectureSummary** (already a type), codebase, decisions | summary form is enough; planning's job is sequencing, not gap-finding against architecture |
| test-writer | story, architectureSummary, wave | story, architectureSummary, **wave**, **design.{antiPatterns}** ➕ | so it can emit *negative* tests that mirror the design-system gate |
| execution coder | story, testPlan, architectureSummary, full design, mockupHtmlByScreen (owner only), references | story, testPlan, **architectureSummary + architectureDecisions[]** ➕, **design.{tone, antiPatterns}**, mockupHtmlByScreen (iteration 1 only), references | decisions list is the missing piece; tokens go via design-tokens.css |
| project-review | full PRD, full architecture, full plan, executionSummaries | ⚠ **full PRD (kept)**, ⚠ **full architecture (kept)**, planSummary, executionSummaries | this stage's job is gap-finding; under-pruning here was the worst risk |
| qa | project-review, merged project branch | **prdDigest**, project-review, merged project branch | qa runs tools against the live tree; doesn't need the full PRD prose |
| documentation | full PRD, full architecture, full plan, project-review | **prdDigest**, **architectureSummary**, planSummary, project-review | documentation is synthesis — digests are appropriate |
| handoff | ambient | unchanged | metadata only |

`architectureSummary` already exists as a type used in
`StoryExecutionContext`. Generalise it; reuse it for planning, qa,
documentation. `prdDigest` and `planSummary` are new shapes — small
deterministic projections.

---

## Items in priority order

Each item names the change, the safety check that justifies the
shape choice, and the rough cost.

### A. Add `architectureDecisions[]` to `architectureSummary` (highest leverage; under-informing fix)

**Change.** Extend `ArchitectureArtifact` first so the architecture
stage emits a small structured decisions list, then extend
`architectureSummary` (used in `StoryExecutionContext` and proposed
for planning) to carry that list downstream:

```ts
type ArchitectureDecision = {
  id: string
  summary: string
  rationale?: string
}

type ArchitectureArtifact = {
  // ... existing fields ...
  architecture: {
    // ... existing fields ...
    decisions?: ArchitectureDecision[] // NEW
  }
}

architectureSummary: {
  summary: string
  systemShape: string
  constraints: string[]
  relevantComponents: Array<{ name; responsibility }>
  decisions: ArchitectureDecision[]  // NEW
}
```

Today the architecture artifact does **not** expose a decisions field,
so this is a real contract extension at the architecture stage, not
just a projection tweak at execution time. The optimization is still
worth doing; the implementation cost is simply a bit higher than
"copy an existing field".

**Why.** S-07 re-invented an `SSEConnectionManager` because the
"use the centralized RunStreamProvider" decision never reached the
worker prompt. Pattern repeats whenever a story depends on a
cross-cutting choice. Cost of fixing this once: thousands of tokens
saved across runs, fewer "agent re-invents what arch decided" bugs.

**Safety check.** Decisions are a small structured field
(few entries, each ~1-3 lines). Adding them to the per-story prompt
costs ~500-2000 tokens, dwarfed by the architecture-summary surface
they're joining.

**Cost.** ~half day. Add the field to the architecture artifact
contract, emit it from the architecture stage, then copy it into
`architectureSummary` at construction. Snapshot test on
`buildStoryExecutionContext`.

### B. Drop `design.tokens` from feature-story payloads

**Change.** In `projectDesignForStory` (or whatever projects design
into the per-story context, given v4's `mockupHtmlByScreen`):
return only `{ tone, antiPatterns }` for feature stories. Setup
stories that *write* `design-tokens.css` still get the full design.

**Why.** Once setup wave materialises `design-tokens.css`, that file
is the canonical token reference. Carrying `design.tokens` in
prompts after that point is duplicate context that empirically
*loses* — tokens are too dense for the model to consume reliably,
so it falls back to Tailwind defaults.

**Safety check.** Stories need to know the *rules* (`antiPatterns`:
"no non-zero border-radius", "no Tailwind palette classes") and the
*tone* ("calm and practical"). Not the hex values; those live in
the CSS file the coder imports.

**Cost.** ~2 hours. Add `kind` parameter to `projectDesignForStory`
(or split into `projectDesignForFeatureStory` and
`projectDesignForSetupStory`); update test.

### C. Pass `sharedFiles[]` to the merge-resolver

**Change.** `RealGitMergeOptions` gains
`expectedSharedFiles?: string[]`. The wave-merge step in
`executeWave` populates it from the planning artifact's shared-file
metadata:

- feature waves: union of `wave.stories[*].sharedFiles[]`
- setup waves: union of `wave.tasks[*].sharedFiles[]`

The resolver prompt prepends:

> The following files are expected to be touched by multiple
> stories in this wave; treat conflicts on them as union-merges
> rather than logic conflicts: <list>. Conflicts on any *other*
> path are unexpected and should be flagged in your output.

**Why.** Planning v4 already emits `sharedFiles[]` for collision
detection. Reusing it as a hint for the resolver makes resolutions
faster and more predictable; "expected" conflicts get union-merged
without reasoning, "unexpected" ones get the full read+reason
treatment.

**Safety check.** The hint is advisory — the resolver still verifies
post-state markers and `git diff --diff-filter=U`. If the planner's
`sharedFiles` is wrong, the resolver still catches the mismatch.

**Cost.** ~3 hours. Plumb through `executeWave` →
`mergeStoryIntoWaveReal` → `mergeNoFf` → `resolveMergeConflictsViaLlm`
→ prompt builder.

### D. Don't re-ship `mockupHtmlByScreen` on iterations 2+

**Change.** Add persisted per-story state recording whether the owner
mockup has already been sent to the current coder session. On
subsequent iterations, omit `mockupHtmlByScreen` from the execution
payload (the coder session has already seen it; the file the coder
wrote is now the canonical interpretation).

One possible shape:

```ts
StoryImplementationArtifact = {
  // ... existing fields ...
  mockupDeliveredToSession?: boolean
}
```

`IterationContext` may mirror that as
`mockupAlreadyShownToSession?: boolean` for prompt/debug visibility,
but the gating decision should not rely on `IterationContext` alone.

**Why.** Mockup HTML is ~25KB. Owner stories often go through
2-4 iterations under cycle-cap conditions. Re-shipping wastes
tokens and pollutes the prompt diff that prompt caching would
otherwise compress.

**Safety check.** The coder is in a resumed session
(`coderSessionId` persists across iterations). The session already
has the mockup in its history.

**Cost.** ~1-2 hours. Persist the state on
`StoryImplementationArtifact`; gate the final coder payload at the
execution/coder-harness seam, or thread the persisted state explicitly
into `buildStoryExecutionContext`. Do not assume the current
`buildStoryExecutionContext` signature can infer iteration/session
state by itself.

### E. Generalise `architectureSummary`; introduce `prdDigest` + `planSummary`

**Change.** Three small renderer functions, each pure:

- `renderArchitectureSummary(architecture): ArchitectureSummary`
  (already exists; ensure decisions[] is included per item A).
- `renderPrdDigest(prd): PrdDigest` — `{ projectId, storyCount,
  acCountByStory: Record<storyId, number>, criticalAcs: AcRef[] }`.
  "Critical" = `priority === "must"` AC.
- `renderPlanSummary(plan): PlanSummary` — `{ waveCount,
  waves: Array<{id, kind, goal, storyIds, exitCriteria}>,
  risks }`.

Wire into the per-stage contract above. `qa` and `documentation`
get digests. `planning`, `project-review` keep what their reviewer
needs to do gap-finding.

**Why.** Token savings + consistent pattern. Once the renderers
exist, future stage additions can opt into the right shape rather
than carrying the whole upstream artifact.

**Safety check.** The "keep full" stages (architecture, planning,
project-review) explicitly opt out of digesting. The contract
table above is the single source of truth — tests assert each
stage receives the shape it expects.

**Cost.** ~half day. Renderers + tests + wiring at the four
consuming sites.

### F. CI-time prompt/payload consistency check

**Change.** A small unit test per stage that:

1. Reads the stage's system prompt file.
2. Greps for `payload.<field>` references in the prompt body.
3. Asserts every referenced field exists on the stage's input
   state type and is populated by the renderer/projector.

Run as part of `npm test`. Fails closed if a prompt asks the model
to use a field that the projector doesn't populate (or vice
versa — a projector adds a field the prompt never mentions, which
is dead context).

**Why.** Catches the silent failure mode of "we pruned a field but
the prompt still tells the model to use it" and "we added a field
but no prompt knows about it". Guards every future shape change.

**Safety check.** This is the test, not the change. Cannot
regress.

**Cost.** ~half day. Reusable across all 12 stages.

### G. Compact `decisions.json` periodically (defer until needed)

**Change.** When `decisions.json` exceeds N entries (start
N=15), an item-level `compactDecisions()` step runs at the start of
the run, flattening sequences of refining answers about the same
scope into a single binding entry.

**Why.** Decisions list grows monotonically across reruns and
appears in every stage's payload. After many reruns of the same
item it bloats prompts.

**Safety check.** Compaction must preserve the *binding* answer;
older non-binding "I'm thinking about X" notes can be dropped.
Probably needs an LLM call to summarise; cheap (Haiku-tier) and
runs once per run start.

**Cost.** ~half day. Defer until a real item shows the bloat.

### H. Codebase snapshot by reference (defer)

**Change.** Write `runs/<id>/codebase-snapshot.json` to disk; ship
a 2KB digest in payloads with a path reference for tool-using
stages.

**Why.** Three identical 32KB+ blocks across requirements /
architecture / planning, each in its own provider session.

**Safety check.** Tool-using stages (those with read access)
already navigate the file tree directly; they don't need the
snapshot in the prompt. No-tools stages need the digest, which
keeps the headline files visible.

**Cost.** ~half day. Defer until per-stage payload size is the
limiting factor.

---

## Sequencing

1. **F (CI consistency check)** — half day. Land first; future
   pruning becomes safe because the test guards us.
2. **A (architecture decisions in summary)** — 1 hour. Smallest
   change with biggest signal. Validates the "add context, don't
   only remove" half of the principle.
3. **C (sharedFiles hint to resolver)** — 3 hours. Concrete win on
   merge reliability we know hits us.
4. **B (prune design.tokens from feature stories)** — 2 hours.
   Direct counter to the design-drift root cause.
5. **D (mockup once per iteration chain)** — 1 hour.
6. **E (generalise summaries; prdDigest + planSummary)** — half
   day. Biggest plumbing change; do once F locks in the shape.

Total core: ~1.5 days. G and H deferred until needed.

---

## Out of scope

- Visual screenshot diffing (Playwright) — mentioned in the
  reliability plan, still belongs there.
- Reviewer "propose-defer" action — separate prompt-engineering
  pass.
- Decisions LLM-summary path (G) — defer until decisions.json on
  a real item shows the bloat.
- Codebase-by-reference (H) — defer until payload size is the
  limiter.

---

## Acceptance signals on a real run

After this lands, a fresh `start_implementation` run should show:

- The coder's per-iteration prompt for a feature story carries
  `design: { tone, antiPatterns }` — no `tokens` field.
- The coder's `architectureSummary` carries a non-empty
  `decisions[]` array.
- A wave-merge with conflicts on `package.json` + `vitest.config.ts`
  succeeds in <90s using the resolver's "expected shared file"
  fast path; resolver telemetry shows `expectedSharedFiles` was
  populated and matched the actual conflicts.
- Iteration 2 of a screen-owner story: prompt does NOT contain
  `mockupHtmlByScreen`; iteration 1 did.
- Documentation stage runs in well under a minute because its
  payload is the digests, not the full upstream artifacts.
- The CI test added in F passes — every stage's prompt references
  exactly the fields its projector populates.
