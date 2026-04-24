export type Item = {
  id: string
  title: string
  description: string
  baseBranch?: string
}

export type Concept = {
  summary: string
  problem: string
  users: string[]
  constraints: string[]
}

export type ReferenceInput = {
  value: string
  description?: string
}

export type Project = {
  id: string
  name: string
  description: string
  concept: Concept
  hasUi?: boolean
}

export type SourceFile = {
  type: "file" | "figma" | "url"
  path?: string
  url?: string
  description: string
}

export type Amendment = {
  type: "scope_addition" | "scope_change"
  projectId?: string
  description: string
  relatedScreens?: string[]
}

export type LayoutDescription = {
  kind: "single-column" | "two-column" | "sidebar-main" | "top-nav-main" | "grid"
  regions: Array<{
    id: string
    label: string
  }>
}

export type ScreenElement = {
  id: string
  region: string
  kind:
    | "heading"
    | "text"
    | "input"
    | "button"
    | "list"
    | "card"
    | "table"
    | "placeholder"
  label: string
  placeholder?: string
}

export type Screen = {
  id: string
  name: string
  purpose: string
  projectIds: string[]
  layout: LayoutDescription
  elements: ScreenElement[]
}

export type NavigationFlow = {
  id: string
  from: string
  to: string
  trigger: string
  projectIds: string[]
}

export type Navigation = {
  entryPoints: Array<{ screenId: string; projectId: string }>
  flows: NavigationFlow[]
}

export type WireframeArtifact = {
  screens: Screen[]
  navigation: Navigation
  inputMode: "none" | "references"
  sourceFiles?: SourceFile[]
  conceptAmendments?: Amendment[]
  /**
   * Lowfi wireframe HTML produced by the LLM — one standalone HTML document
   * per screen. Each value must be a full `<!doctype html>…</html>` document
   * with inline CSS only (monospace, gray palette, dashed borders). The
   * renderer writes these verbatim to disk; no re-serialisation occurs.
   *
   * Required in new runs. May be absent in artifacts produced before this
   * field was introduced (the renderer falls back to the procedural generator
   * in that case).
   */
  wireframeHtmlPerScreen?: Record<string, string>
}

export type FontSpec = {
  family: string
  weight: string
  usage: string
}

export type ColorPalette = {
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

export type DesignTokens = {
  light: ColorPalette
  dark?: ColorPalette
}

export type Typography = {
  display: FontSpec
  body: FontSpec
  mono?: FontSpec
  scale: Record<string, string>
}

export type Spacing = {
  baseUnit: string
  sectionPadding: string
  cardPadding: string
  contentMaxWidth: string
}

export type BorderTokens = {
  buttons: string
  cards: string
  badges: string
}

export type ShadowScale = Record<string, string>

export type DesignArtifact = {
  tokens: DesignTokens
  typography: Typography
  spacing: Spacing
  borders: BorderTokens
  shadows: ShadowScale
  tone: string
  antiPatterns: string[]
  inputMode: "none" | "references"
  sourceFiles?: SourceFile[]
  conceptAmendments?: Amendment[]
  /**
   * High-fidelity HTML mockups produced by the LLM — one standalone HTML
   * document per UI-bearing screen from the wireframes artifact. Each value
   * must be a full `<!doctype html>…</html>` document with inline CSS and
   * realistic mock content. The renderer writes these verbatim to disk; no
   * re-serialisation occurs.
   */
  mockupHtmlPerScreen?: Record<string, string>
}

export type AcceptanceCriterion = {
  id: string
  text: string
  priority: "must" | "should" | "could"
  category: "functional" | "validation" | "error" | "state" | "ui"
}

export type UserStory = {
  id: string
  title: string
  description?: string
  acceptanceCriteria: AcceptanceCriterion[]
}

export type PRD = {
  stories: UserStory[]
}

export type ArchitectureArtifact = {
  project: {
    id: string
    name: string
    description: string
  }
  concept: Concept
  prdSummary: {
    storyCount: number
    storyIds: string[]
  }
  architecture: {
    summary: string
    systemShape: string
    components: Array<{
      name: string
      responsibility: string
    }>
    dataModelNotes: string[]
    apiNotes: string[]
    deploymentNotes: string[]
    constraints: string[]
    risks: string[]
    openQuestions: string[]
  }
}

export type WaveDefinition = {
  id: string
  number: number
  goal: string
  stories: Array<{
    id: string
    title: string
  }>
  internallyParallelizable: boolean
  dependencies: string[]
  exitCriteria: string[]
}

export type ImplementationPlanArtifact = {
  project: {
    id: string
    name: string
  }
  conceptSummary: string
  architectureSummary: string
  plan: {
    summary: string
    assumptions: string[]
    sequencingNotes: string[]
    dependencies: string[]
    risks: string[]
    waves: WaveDefinition[]
  }
}

import type { Finding, Severity } from "./review.js"

export type ProjectReviewFinding = Finding<"project-review-llm"> & {
  id: string
  severity: Severity
  category:
    | "architecture"
    | "security"
    | "maintainability"
    | "consistency"
    | "integration"
  evidence: string
  recommendation: string
}

export type ProjectReviewArtifact = {
  project: {
    id: string
    name: string
  }
  scope: "project-wide-code-review"
  overallStatus: "pass" | "pass_with_risks" | "fail"
  summary: string
  findings: ProjectReviewFinding[]
  recommendations: string[]
}

export type DocumentationSection = {
  heading: string
  content: string
}

export type DocumentationArtifact = {
  project: {
    id: string
    name: string
  }
  mode: "generate" | "update" | "mixed"
  technicalDoc: {
    title: string
    summary: string
    sections: DocumentationSection[]
  }
  featuresDoc: {
    title: string
    summary: string
    sections: DocumentationSection[]
  }
  compactReadme: {
    title: string
    summary: string
    sections: DocumentationSection[]
  }
  knownIssues: string[]
}
