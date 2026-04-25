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
