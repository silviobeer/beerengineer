import type { ReviewProviderResult } from "../types.js";
import type { WorkflowDeps } from "../../workflow/workflow-deps.js";

export class VerificationSignalProvider {
  public constructor(private readonly deps: WorkflowDeps) {}

  public provide(waveStoryExecutionId: string): ReviewProviderResult {
    const findings: ReviewProviderResult["findings"] = [];
    const latestBasic = this.deps.verificationRunRepository.getLatestByWaveStoryExecutionIdAndMode(waveStoryExecutionId, "basic");
    const latestRalph = this.deps.verificationRunRepository.getLatestByWaveStoryExecutionIdAndMode(waveStoryExecutionId, "ralph");
    const latestApp = this.deps.appVerificationRunRepository.getLatestByWaveStoryExecutionId(waveStoryExecutionId);

    const pushFinding = (label: string, status: string | null, errorMessage: string | null) => {
      if (!status || status === "passed") {
        return;
      }
      findings.push({
        reviewerRole: label,
        findingType: "verification",
        normalizedSeverity: status === "failed" ? "critical" : "high",
        sourceSeverity: status,
        title: `${label} returned ${status}`,
        detail: errorMessage ?? `${label} did not complete cleanly for this execution.`,
        evidence: errorMessage ?? null,
        filePath: null,
        line: null,
        fieldPath: null
      });
    };

    pushFinding("basic_verification", latestBasic?.status ?? null, latestBasic?.errorMessage ?? null);
    pushFinding("ralph_verification", latestRalph?.status ?? null, latestRalph?.errorMessage ?? null);
    pushFinding("app_verification", latestApp?.status ?? null, latestApp?.failureSummary ?? null);

    return {
      providerId: "verification",
      sourceSystem: "tests",
      findings
    };
  }
}
