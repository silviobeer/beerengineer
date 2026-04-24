# PROJ-1 Concept: Design-Preparation Stages

## Problem

The engine pipeline jumps from `brainstorm` (concept) straight to `requirements` (PRD). For UI-heavy items this skips two critical steps:

- **No screen layout before requirements.** Requirements are written without knowing which screens exist, how navigation works, or where data is displayed. User stories end up more abstract than necessary.
- **No design language before architecture/execution.** Execution agents improvise visual decisions (colors, typography, spacing). Results are inconsistent. Architecture cannot make informed decisions about component libraries or design system integration.

## Solution

Two new native engine stages that establish visual context before the text-based stages begin. Both run at **item level** (once per item, before the project loop), both are **conditional** on `hasUi`.

**`hasUi` derivation:** The brainstorm stage sets a `hasUi` flag on its output. Since brainstorm produces `projects[]` (each with its own concept), the item-level decision is derived: `hasUi = true` if any project's concept indicates a UI component. The exact placement (top-level brainstorm artifact field vs. per-project flag) will be specified in requirements.

### Chain Position

```
brainstorm -> concept + hasUi
  |
  +-- hasUi? -> visual-companion  (layout: which screens, what goes where)
  +-- hasUi? -> frontend-design   (look: colors, typography, tone)
  |
  +-- for each project:
        requirements(concept + wireframes + design)
        architecture(concept + prd + wireframes + design)
        planning -> execution -> ...
```

Both stages follow the existing stage runtime pattern: agent + reviewer loop, structured artifacts, session resume, recovery. No new runtime machinery.

## Non-Goals

- No replacement for real design tools (Figma, Sketch) -- complement / quick-start
- No workspace edits (no tailwind.config, no globals.css) -- only artifacts
- No UI pages in `apps/ui` in this PROJ -- CLI + API first, UI later
- No new board column -- the stages run in the transition from `brainstorm` to `requirements`

## Stage 1: visual-companion

**Role:** Senior UX Designer

**Input:** Brainstorm concept. Optionally user-provided wireframes/mockups.

**Conversation flow:** Stage opens by asking "Do you already have wireframes or mockups?" The user responds with file paths, URLs, or "no." The stage sets `inputMode` accordingly:

| Mode | User provides | Engine behavior |
|------|--------------|-----------------|
| `none` (default) | nothing | Stage converses, renders own gray-box wireframes, builds structured artifact |
| `references` | screenshots / Figma link / PNGs / inspiration | Stage takes them as context, still renders own structured wireframes + HTML (for downstream consistency), links references in artifact |
| `authoritative` | finished wireframes/mockups (HTML, Figma, PDFs) that serve as source of truth | Stage extracts only structured metadata (screen list, navigation, purposes), renders no own HTML, artifact references user files |

**Output:** `WireframeArtifact`

```typescript
type WireframeArtifact = {
  screens: Screen[]
  navigation: Navigation
  inputMode: "none" | "references" | "authoritative"
  sourceFiles?: SourceFile[]
  conceptAmendments?: Amendment[]
}

type Screen = {
  id: string
  name: string
  purpose: string
  layout: LayoutDescription
  elements: ScreenElement[]
}

type Navigation = {
  entryPoints: string[]       // screen IDs
  flows: NavigationFlow[]
}

type SourceFile = {
  type: "file" | "figma" | "url"
  path?: string               // relative to stageArtifactsDir
  url?: string
  description: string
}

type Amendment = {
  type: "scope_addition" | "scope_change"
  description: string
  relatedScreens?: string[]
}

// LayoutDescription, ScreenElement, NavigationFlow are intentionally
// left opaque at concept level. Their shape will be specified in
// the requirements phase.
```

**HTML rendering:** Engine code (not LLM) generates from the JSON artifact:
- `screen-map.html` -- overview of all screens with connection arrows
- `<screen-id>.html` -- gray-box wireframe per screen (boxes, labels, placeholders -- no styling)

Style follows the reference skill: monospace font, dashed borders, gray backgrounds, labeled placeholders.

**Reviewer:** Checks completeness (all concept features have screens), navigation consistency, no styling decisions leaking into wireframes.

**Skip:** Automatic when `concept.hasUi === false`. Stage is silently skipped, `ctx.wireframes` stays `undefined`.

## Stage 2: frontend-design

**Role:** Senior Visual Designer

**Input:** Brainstorm concept + wireframe artifact. Optionally existing design system or reference apps.

**Conversation flow:** Stage opens by asking "Do you already have a design system or reference apps?" Same `inputMode` logic as visual-companion.

**Output:** `DesignArtifact`

```typescript
type DesignArtifact = {
  tokens: DesignTokens
  typography: Typography
  spacing: Spacing
  borders: BorderTokens
  shadows: ShadowScale
  tone: string                // one-sentence visual personality
  antiPatterns: string[]      // what to avoid in this design
  inputMode: "none" | "references" | "authoritative"
  sourceFiles?: SourceFile[]
  conceptAmendments?: Amendment[]
}

type DesignTokens = {
  light: ColorPalette
  dark?: ColorPalette
}

type ColorPalette = {
  primary: string
  secondary: string
  accent: string
  background: string
  surface: string
  textPrimary: string
  textMuted: string
  success: string
  warning: string
  error: string
  info: string
}

type Typography = {
  display: FontSpec
  body: FontSpec
  mono?: FontSpec
  scale: Record<string, string>  // e.g. "xs" -> "0.75rem"
}

type FontSpec = {
  family: string
  weight: string
  usage: string
}

type Spacing = {
  baseUnit: string
  sectionPadding: string
  cardPadding: string
  contentMaxWidth: string
}

type BorderTokens = {
  buttons: string
  cards: string
  badges: string
}

type ShadowScale = Record<string, string>  // e.g. "sm" -> "0 1px 2px ..."
```

**HTML rendering:** Engine code generates:
- `design-preview.html` -- color palette swatches, typography samples with live text, spacing grid, border radius examples, shadow scale visualization. All rendered from the structured tokens.

**Reviewer:** Checks consistency (contrast ratios, readability), completeness (all token categories filled), no code decisions (no component library choices, no file paths).

**Skip:** Same condition as visual-companion (`concept.hasUi === false`).

## Artifact Flow

Both stages use the same persistence pattern as existing stages: JSON artifact file in `stageArtifactsDir`, loaded via `loadWireframes()` / `loadDesign()`, placed on `ProjectContext` as optional fields.

### Downstream consumption

- **requirements** reads `concept + wireframes + design` to write screen-aware user stories with visual acceptance criteria
- **architecture** reads all of the above plus `prd` to make informed component library / design system integration decisions
- **planning** and **execution** receive the full context chain

### External source handling

- Local files (PNGs, HTMLs, PDFs) uploaded during stage conversation are copied to `stageArtifactsDir`, referenced by relative path in `sourceFiles`
- URLs (Figma, Sketch Cloud, etc.) are stored as link references with user-provided description
- Image files can be embedded in downstream `stageContext` for vision-capable providers (Claude)
- HTML files are never inlined into prompts (too large/noisy) -- only structured metadata flows downstream

### Concept amendments

- Both artifacts can optionally contain `conceptAmendments[]`
- Small scope additions (new screen, additional flow) are recorded as amendments
- `runWorkflow()` merges amendments after design stages into an `enrichedConcept` on the `ProjectContext` before the project loop starts
- Fundamental scope changes cause the stage to block and recommend re-running brainstorm

## Engine Changes

| Area | Change |
|------|--------|
| `workflow.ts` | Two new stage calls between brainstorm and project loop. `if (concept.hasUi)` guard. New `loadWireframes()` + `loadDesign()`. Results on `ctx.wireframes` + `ctx.design`. |
| `types.ts` | `WireframeArtifact`, `DesignArtifact`, `Amendment`, `SourceFile` types. `ProjectContext` gets optional `wireframes?` + `design?` fields. |
| `src/stages/visual-companion/index.ts` | Stage entry point, same shape as existing stages |
| `src/stages/frontend-design/index.ts` | Stage entry point, same shape as existing stages |
| `prompts/system/visual-companion.md` | System prompt for wireframe agent |
| `prompts/system/frontend-design.md` | System prompt for design agent |
| `prompts/reviewers/visual-companion.md` | Reviewer prompt for wireframe review |
| `prompts/reviewers/frontend-design.md` | Reviewer prompt for design review |
| `src/llm/fake/visualCompanionStage.ts` | Fake LLM for unit tests |
| `src/llm/fake/visualCompanionReview.ts` | Fake reviewer for unit tests |
| `src/llm/fake/frontendDesignStage.ts` | Fake LLM for unit tests |
| `src/llm/fake/frontendDesignReview.ts` | Fake reviewer for unit tests |
| `src/llm/registry.ts` | Registration of new stage/reviewer agents |
| `promptEnvelope.ts` | `stageContext` extension: downstream stages see `wireframes` + `design` in payload when present |
| `boardColumns.ts` | No change -- no new board column |
| `runOrchestrator.ts` | Resume/recovery for new stages (same pattern as existing) |
| `stageRuntime.ts` | No change -- existing `runStageLoop()` is used as-is |

### New code

| File | Purpose |
|------|---------|
| `src/core/renderers/wireframeHtml.ts` | Takes `WireframeArtifact`, renders screen-map + per-screen HTML with gray-box style |
| `src/core/renderers/designPreviewHtml.ts` | Takes `DesignArtifact`, renders swatch page with color palettes, typography samples, spacing grid |

### API endpoints (all implemented now, UI-ready)

```
GET  /runs/:runId/artifacts              -> list all artifact files for a run
GET  /runs/:runId/artifacts/*path        -> serve raw file (HTML, PNG, JSON)
GET  /items/:id/wireframes               -> structured wireframe data + HTML paths
GET  /items/:id/design                   -> structured design data + preview path
```

### CLI commands

```
beerengineer item wireframes <id|code> [--open]   # prints screen list + URLs, --open opens in browser
beerengineer item design <id|code> [--open]       # prints token overview, --open opens design-preview.html
```

### Harness events

```json
{"type": "wireframes_ready", "itemId": "...", "runId": "...", "screenCount": 5, "urls": ["..."]}
{"type": "design_ready", "itemId": "...", "runId": "...", "url": "..."}
```

## Presentation

- **Engine-internal:** Two separate stages with independent reviewer loops, artifacts, sessions, recovery
- **CLI:** Two visible stages with separate output
- **UI (later, not this PROJ):** One "Design Prep" step with two sub-phases/tabs (wireframes + design language). Pure presentation grouping, no architectural impact.

## Tests

- Fake LLM stages for unit tests (same pattern as existing fakes)
- API integration tests for new artifact endpoints
- HTML renderer tests (artifact in -> valid HTML out)
- Skip logic tests (`hasUi: false` -> stages skipped, `ctx.wireframes` stays `undefined`)
- Amendment merge tests (amendments correctly enriching concept for downstream)
- Input mode tests (all three modes produce consistent structured artifacts)
