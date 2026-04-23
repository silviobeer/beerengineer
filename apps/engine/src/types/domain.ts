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

export type Project = {
  id: string
  name: string
  description: string
  concept: Concept
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
