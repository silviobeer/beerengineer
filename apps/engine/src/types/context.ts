import type { ItemDecision } from "../core/itemDecisions.js"
import type { WorkflowContext } from "../core/workspaceLayout.js"
import type {
  ArchitectureArtifact,
  DesignArtifact,
  DocumentationArtifact,
  ImplementationPlanArtifact,
  PRD,
  Project,
  ProjectReviewArtifact,
  WireframeArtifact,
} from "./domain.js"
import type { WaveSummary } from "./execution.js"

export type { WorkflowContext }

export type CodebaseSnapshot = {
  topLevelFiles: Array<{ path: string; content: string }>
  treeSummary: string[]
  openApiSpec?: string
  /**
   * Brownfield frontend fingerprint, populated only when the item has UI
   * (i.e. brainstorm output declares `hasUi: true` on at least one project).
   * Visual-companion and frontend-design read this as their *only* view of
   * the existing visual language and component inventory, since they run on
   * `no-tools`. Engineering stages on UI items use it as a warm-up.
   */
  frontend?: FrontendSnapshot
}

export type FrontendSnapshot = {
  /** Workspace-relative roots where frontend code was detected. Always
   *  includes "" (the workspace root) when it has frontend deps. May also
   *  include subdirs like "apps/ui", "apps/web", "frontend", "web". */
  detectedRoots: string[]
  /** Best-effort framework detection from package.json deps:
   *  "next" | "react" | "vue" | "svelte" | "angular" | undefined. */
  framework?: string
  /** Best-effort styling-system detection from package.json deps:
   *  "tailwind" | "styled-components" | "emotion" | "css-modules" | undefined. */
  stylingSystem?: string
  /** Probed config / token / layout files that exist. Path is workspace-relative.
   *  Each content bounded to 32 KB (truncated with marker if larger). */
  configFiles: Array<{ path: string; content: string }>
  /** Workspace-relative paths under detected components/ and app/ dirs.
   *  Shallow listing (depth 3, capped at ~200 entries). Names only, no content. */
  componentTree: string[]
}

export type ProjectContext = WorkflowContext & {
  project: Project
  wireframes?: WireframeArtifact
  design?: DesignArtifact
  prd?: PRD
  architecture?: ArchitectureArtifact
  plan?: ImplementationPlanArtifact
  executionSummaries?: WaveSummary[]
  projectReview?: ProjectReviewArtifact
  documentation?: DocumentationArtifact
  codebase?: CodebaseSnapshot
  decisions?: ItemDecision[]
}

export type WithPrd = ProjectContext & { prd: PRD }
export type WithArchitecture = WithPrd & { architecture: ArchitectureArtifact }
export type WithPlan = WithArchitecture & { plan: ImplementationPlanArtifact }
export type WithExecution = WithPlan & { executionSummaries: WaveSummary[] }
export type WithProjectReview = WithExecution & { projectReview: ProjectReviewArtifact }
export type WithDocumentation = WithProjectReview & { documentation: DocumentationArtifact }
