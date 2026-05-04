import { parallelReview } from "../core/parallelReview.js"
import { crReview, sonarReview } from "../sim/llm.js"
import { reviewCycleArtifactsDir, writeArtifactJson, writeArtifactText } from "./artifacts.js"
import { runCodeRabbitReview } from "./coderabbit.js"
import { runDesignSystemGate } from "./designSystemGate.js"
import { runSonarCloudReview } from "./sonarcloud.js"
import type {
  CodeRabbitResult,
  ReviewCapabilityResult,
  ReviewScope,
  ReviewToolAdapters,
  ReviewToolRegistryResult,
  SonarCloudResult,
} from "./types.js"
import type { ReviewArtifactRef, ReviewOutcome } from "../core/capabilities/index.js"

let injectedAdapters: ReviewToolAdapters | null = null

function fakeRequested(forceFake?: boolean): boolean {
  return forceFake === true || process.env.BEERENGINEER_FORCE_FAKE_REVIEW === "1" || injectedAdapters !== null
}

export function hasTestInjection(): boolean {
  return injectedAdapters !== null
}

export function setTestReviewAdapters(adapters: ReviewToolAdapters): void {
  injectedAdapters = adapters
}

export function resetTestReviewAdapters(): void {
  injectedAdapters = null
}

async function runFakeCodeRabbit(input: ReviewScope): Promise<CodeRabbitResult> {
  const findings = (await crReview(input.reviewCycle, input.storyId)) as CodeRabbitResult["findings"]
  const artifactsDir = reviewCycleArtifactsDir(input.artifactsDir, input.reviewCycle)
  const rawPath = await writeArtifactJson(artifactsDir, "coderabbit.fake.json", findings)
  return {
    status: "ran",
    findings,
    summary: findings.length === 0 ? "No findings." : `Fake CodeRabbit returned ${findings.length} findings.`,
    rawPath,
    command: ["fake-coderabbit"],
    exitCode: 0,
  }
}

async function runFakeSonar(input: ReviewScope): Promise<SonarCloudResult> {
  const sonar = await sonarReview(input.reviewCycle, input.storyId)
  const artifactsDir = reviewCycleArtifactsDir(input.artifactsDir, input.reviewCycle)
  const rawScanPath = await writeArtifactText(artifactsDir, "sonar-scan.fake.txt", "fake sonar scan\n")
  const rawGatePath = await writeArtifactJson(artifactsDir, "sonar-gate.fake.json", sonar)
  return {
    status: "ran",
    passed: sonar.passed,
    conditions: sonar.conditions,
    findings: sonar.findings as SonarCloudResult["findings"],
    summary: sonar.passed ? "Fake quality gate passed." : "Fake quality gate failed.",
    rawScanPath,
    rawGatePath,
    command: ["fake-sonar"],
    exitCode: 0,
  }
}

export async function runStoryReviewTools(input: ReviewScope): Promise<ReviewToolRegistryResult> {
  const adapters = fakeRequested(input.forceFake)
    ? injectedAdapters ?? { coderabbit: runFakeCodeRabbit, sonarcloud: runFakeSonar }
    : { coderabbit: runCodeRabbitReview, sonarcloud: runSonarCloudReview }

  const [designSystem, coderabbit, sonarcloud] = await parallelReview<
    ReviewToolRegistryResult["designSystem"] | CodeRabbitResult | SonarCloudResult
  >("Parallel Review: design gate + CodeRabbit + SonarQube...", [
    () => runDesignSystemGate(input),
    () => adapters.coderabbit(input),
    () => adapters.sonarcloud(input),
  ])

  const artifactsDir = reviewCycleArtifactsDir(input.artifactsDir, input.reviewCycle)
  const coderabbitResult = coderabbit as CodeRabbitResult
  const sonarcloudResult = sonarcloud as SonarCloudResult
  const capabilities = [
    codeRabbitCapabilityEnvelope(coderabbitResult),
    sonarCapabilityEnvelope(sonarcloudResult),
  ]
  await writeArtifactJson(artifactsDir, "review-tools-summary.json", {
    designSystem,
    coderabbit: coderabbitResult,
    sonarcloud: sonarcloudResult,
    capabilities,
  })
  return {
    designSystem: designSystem as ReviewToolRegistryResult["designSystem"],
    coderabbit: coderabbitResult,
    sonarcloud: sonarcloudResult,
    capabilities,
  }
}

function artifactRef(label: string, path: string | undefined): ReviewArtifactRef[] {
  return path ? [{ label, path }] : []
}

function codeRabbitOutcome(result: CodeRabbitResult): ReviewOutcome {
  if (result.status === "ran") return "ran"
  if (result.status === "failed") return "failed"
  if (result.reason === "coderabbit-cli-missing") return "not_configured"
  if (result.reason === "coderabbit-no-diff") return "not_meaningful"
  return "skipped"
}

function sonarOutcome(result: SonarCloudResult): ReviewOutcome {
  if (result.status === "ran") return "ran"
  if (result.status === "failed") {
    return result.reason === "sonar-token-missing" ? "not_configured" : "failed"
  }
  if (result.reason === "sonar-scanner-missing" || result.reason === "sonarcloud-config-incomplete") {
    return "not_configured"
  }
  return "skipped"
}

function codeRabbitCapabilityEnvelope(result: CodeRabbitResult): ReviewCapabilityResult {
  const outcome = codeRabbitOutcome(result)
  const blocking = result.status === "ran" && result.findings.some(finding => finding.severity === "critical" || finding.severity === "high")
  const summary = result.summary ?? (outcome === "ran" ? `CodeRabbit returned ${result.findings.length} findings.` : result.reason ?? "CodeRabbit did not run.")
  const artifacts = artifactRef("coderabbit raw output", result.rawPath)
  return outcome === "ran"
    ? { capabilityId: "coderabbit", phase: "story-review", outcome, blocking, summary, artifacts, toolResult: result }
    : { capabilityId: "coderabbit", phase: "story-review", outcome, blocking: false, summary, reason: result.reason ?? outcome, artifacts, toolResult: result }
}

function sonarCapabilityEnvelope(result: SonarCloudResult): ReviewCapabilityResult {
  const outcome = sonarOutcome(result)
  const blocking = result.status === "ran" && !result.passed
  const summary = result.summary ?? (outcome === "ran" ? `Sonar returned ${result.findings.length} findings.` : result.reason ?? "Sonar did not run.")
  const artifacts = [
    ...artifactRef("sonar scan output", result.rawScanPath),
    ...artifactRef("sonar gate output", result.rawGatePath),
  ]
  return outcome === "ran"
    ? { capabilityId: "sonar", phase: "story-review", outcome, blocking, summary, artifacts, toolResult: result }
    : { capabilityId: "sonar", phase: "story-review", outcome, blocking: false, summary, reason: result.reason ?? outcome, artifacts, toolResult: result }
}

export const reviewCapabilityPorts = {
  coderabbit: codeRabbitCapabilityEnvelope,
  sonar: sonarCapabilityEnvelope,
}
