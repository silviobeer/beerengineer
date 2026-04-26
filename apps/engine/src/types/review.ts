export type Severity = "critical" | "high" | "medium" | "low"

export type FindingSource =
  | "llm-reviewer"
  | "coderabbit"
  | "sonar"
  | "sonarqube"
  | "design-system"
  | "qa-llm"
  | "project-review-llm"

export type Finding<S extends FindingSource = FindingSource> = {
  source: S
  severity: Severity
  message: string
}

export type ReviewResult =
  | { pass: true }
  | { pass: false; feedback: string }
