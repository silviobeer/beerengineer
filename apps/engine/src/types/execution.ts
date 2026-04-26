import type { AcceptanceCriterion, DesignArtifact, StoryReference } from "./domain.js"
import type { Severity } from "./review.js"
import type { SimulatedBranch } from "./repo.js"

export type StoryTestPlanArtifact = {
  project: {
    id: string
    name: string
  }
  story: {
    id: string
    title: string
  }
  acceptanceCriteria: AcceptanceCriterion[]
  testPlan: {
    summary: string
    testCases: Array<{
      id: string
      name: string
      mapsToAcId: string
      type: "unit" | "integration" | "e2e"
      description: string
    }>
    fixtures: string[]
    edgeCases: string[]
    assumptions: string[]
  }
}

export type StoryExecutionContext = {
  kind?: "feature" | "setup"
  item: {
    slug: string
    baseBranch: string
  }
  project: {
    id: string
    name: string
  }
  conceptSummary: string
  story: {
    id: string
    title: string
    acceptanceCriteria: AcceptanceCriterion[]
  }
  setupContract?: {
    expectedFiles: string[]
    requiredScripts: string[]
    postChecks: string[]
  }
  architectureSummary: {
    summary: string
    systemShape: string
    constraints: string[]
    relevantComponents: Array<{
      name: string
      responsibility: string
    }>
  }
  wave: {
    id: string
    number: number
    goal: string
    dependencies: string[]
  }
  storyBranch?: string
  worktreeRoot?: string
  // Path to the primary workspace checkout (where .beerengineer/workspace.json
  // lives). Distinct from worktreeRoot, which points at the per-story worktree.
  primaryWorkspaceRoot?: string
  design?: DesignArtifact
  mockupHtmlByScreen?: Record<string, string>
  references?: StoryReference[]
  testPlan: StoryTestPlanArtifact
}

export type StoryCheckResult = {
  name: string
  kind: "unit" | "integration" | "e2e" | "lint" | "typecheck" | "review-gate"
  status: "pass" | "fail" | "skipped"
  summary?: string
}

export type StoryImplementationArtifact = {
  story: {
    id: string
    title: string
  }
  mode: "ralph-wiggum"
  status: "in_progress" | "ready_for_review" | "passed" | "blocked"
  implementationGoal: string
  maxIterations: number
  maxReviewCycles: number
  currentReviewCycle: number
  iterations: Array<{
    number: number
    reviewCycle: number
    action: string
    checks: StoryCheckResult[]
    result: "continue" | "tests_failed" | "review_feedback_applied" | "done" | "blocked"
    notes: string[]
  }>
  coderSessionId?: string | null
  priorAttempts?: Array<{
    iteration: number
    summary: string
    outcome: "passed" | "failed" | "blocked"
  }>
  changedFiles: string[]
  finalSummary: string
  branch?: SimulatedBranch
}

export type StoryReviewArtifact = {
  story: {
    id: string
    title: string
  }
  reviewCycle: number
  reviewers: Array<{
    source: "coderabbit" | "sonarqube"
    status: "pass" | "revise"
    findings: Array<{
      severity: Severity
      message: string
      file?: string
      line?: number
      ruleId?: string
    }>
  }>
  gate: {
    status: "pass" | "fail"
    failedBecause: string[]
    coderabbit:
      | {
          status: "ran"
          passed: boolean
        }
      | {
          status: "skipped"
          reason: string
        }
      | {
          status: "failed"
          reason: string
          exitCode?: number
        }
    sonar:
      | {
          status: "ran"
          passed: boolean
          conditions?: Array<{
            metric: "reliability" | "security" | "maintainability" | string
            status: "ok" | "error"
            actual: string
            threshold: string
          }>
        }
      | {
          status: "skipped"
          reason: string
        }
      | {
          status: "failed"
          reason: string
          exitCode?: number
        }
    designSystem:
      | {
          status: "ran"
          passed: boolean
        }
      | {
          status: "skipped"
          reason: string
        }
  }
  outcome: "pass" | "revise" | "pass-unreviewed" | "pass-tool-failure" | "pass-partial"
  feedbackSummary: string[]
}

export type WaveSummary = {
  waveId: string
  waveBranch: string
  projectBranch: string
  storiesMerged: Array<{
    storyId: string
    branch: string
    commitCount: number
    filesIntegrated: string[]
  }>
  storiesBlocked: string[]
}
