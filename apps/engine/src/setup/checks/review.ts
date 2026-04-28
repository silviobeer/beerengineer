import type { CheckResult } from "../types.js"
import { createCheck, probeCommand, remedyForTool } from "./shared.js"

export async function runReviewChecks(): Promise<CheckResult[]> {
  const [coderabbit, sonarScanner, sonarqubeCli] = await Promise.all([
    probeCommand("coderabbit", ["--version"]),
    probeCommand("sonar-scanner", ["--version"]),
    probeCommand("sonar", ["--version"]),
  ])
  const sonarTokenPresent = Boolean(process.env.SONAR_TOKEN)

  return [
    createCheck("review.coderabbit", "CodeRabbit CLI", coderabbit.ok ? "ok" : "missing", coderabbit.version ?? coderabbit.detail, {
      remedy: coderabbit.ok ? undefined : remedyForTool("coderabbit"),
    }),
    createCheck("review.sonar-scanner", "sonar-scanner", sonarScanner.ok ? "ok" : "missing", sonarScanner.version ?? sonarScanner.detail, {
      remedy: sonarScanner.ok ? undefined : remedyForTool("sonar-scanner"),
    }),
    createCheck("review.sonarqube-cli", "sonarqube-cli", sonarqubeCli.ok ? "ok" : "missing", sonarqubeCli.version ?? sonarqubeCli.detail, {
      remedy: sonarqubeCli.ok ? undefined : remedyForTool("sonar"),
    }),
    createCheck(
      "review.sonar-token",
      "SONAR_TOKEN",
      sonarTokenPresent ? "ok" : "missing",
      sonarTokenPresent
        ? "Token available for scanner/API auth"
        : "Missing SONAR_TOKEN. Story-branch Sonar gating will fail if Sonar is enabled.",
      sonarTokenPresent
        ? {}
        : { remedy: { hint: "Create a SonarQube Cloud analysis token and export it as SONAR_TOKEN." } },
    ),
    createCheck(
      "review.sonar-plan",
      "Sonar branch-analysis plan tier",
      "unknown",
      "Branch analysis for story branches requires SonarQube Cloud Team, Enterprise, or OSS; Free plan workspaces will be skipped.",
    ),
  ]
}
