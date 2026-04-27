import type { Finding } from "../types.js"
import type { WorkspaceReviewPolicy } from "../types/workspace.js"

export type GateCondition = {
  metric: "reliability" | "security" | "maintainability" | string
  status: "ok" | "error"
  actual: string
  threshold: string
}

export type ToolGate =
  | {
      status: "ran"
      passed: boolean
      conditions?: GateCondition[]
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

export type ReviewScope = {
  workspaceRoot: string
  artifactsDir: string
  baselineSha: string | null
  storyBranch: string
  baseBranch: string
  changedFiles: string[]
  storyId: string
  reviewCycle: number
  reviewPolicy: WorkspaceReviewPolicy
  forceFake?: boolean
}

export type CodeRabbitResult = {
  status: "ran" | "skipped" | "failed"
  reason?: string
  findings: Finding<"coderabbit">[]
  summary?: string
  rawPath: string
  command: string[]
  exitCode: number
}

export type SonarCloudResult = {
  status: "ran" | "skipped" | "failed"
  reason?: string
  passed: boolean
  conditions: GateCondition[]
  findings: Finding<"sonarqube">[]
  summary?: string
  rawScanPath: string
  rawGatePath: string
  command: string[]
  exitCode: number
}

export type ReviewToolRegistryResult = {
  designSystem: {
    status: "ran" | "skipped"
    passed: boolean
    findings: Finding<"design-system">[]
    summary?: string
  }
  coderabbit: CodeRabbitResult
  sonarcloud: SonarCloudResult
}

export type ReviewToolAdapters = {
  coderabbit: (input: ReviewScope) => Promise<CodeRabbitResult>
  sonarcloud: (input: ReviewScope) => Promise<SonarCloudResult>
}
