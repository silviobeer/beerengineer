import type { ReviewProviderResult } from "../types.js";
import type { WorkflowDeps } from "../../workflow/workflow-deps.js";

function normalizeSeverity(value: string) {
  switch (value.toLowerCase()) {
    case "blocker":
    case "critical":
      return "critical" as const;
    case "high":
    case "major":
      return "high" as const;
    case "medium":
    case "minor":
      return "medium" as const;
    default:
      return "low" as const;
  }
}

export class SonarcloudReviewProvider {
  public constructor(private readonly deps: WorkflowDeps) {}

  public provide(filePaths: string[]): ReviewProviderResult {
    const preflight = this.deps.sonarService.preflight();
    if (!preflight.config.configured) {
      return {
        providerId: "sonarcloud",
        sourceSystem: "sonarcloud",
        findings: []
      };
    }
    const scan = this.deps.sonarService.scan();
    const matchingIssues = scan.issues.filter((issue) => filePaths.length === 0 || (issue.filePath ? filePaths.includes(issue.filePath) : true));
    const matchingHotspots = scan.hotspots.filter((hotspot) => filePaths.length === 0 || (hotspot.filePath ? filePaths.includes(hotspot.filePath) : true));
    return {
      providerId: "sonarcloud",
      sourceSystem: "sonarcloud",
      findings: [
        ...matchingIssues.map((issue) => ({
          reviewerRole: "sonarcloud",
          findingType: issue.category,
          normalizedSeverity: normalizeSeverity(issue.severity),
          sourceSeverity: issue.severity,
          title: issue.message,
          detail: `${issue.type} issue reported by SonarCloud.`,
          evidence: issue.key,
          filePath: issue.filePath,
          line: issue.line,
          fieldPath: null
        })),
        ...matchingHotspots.map((hotspot) => ({
          reviewerRole: "sonarcloud",
          findingType: "security_hotspot",
          normalizedSeverity: normalizeSeverity(hotspot.severity),
          sourceSeverity: hotspot.severity,
          title: hotspot.message,
          detail: "Security hotspot reported by SonarCloud.",
          evidence: hotspot.key,
          filePath: hotspot.filePath,
          line: hotspot.line,
          fieldPath: null
        }))
      ]
    };
  }
}
