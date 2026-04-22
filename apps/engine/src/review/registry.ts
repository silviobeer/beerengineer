import { parallelReview } from "../core/parallelReview.js"
import { crReview, sonarReview } from "../sim/llm.js"
import { reviewCycleArtifactsDir, writeArtifactJson, writeArtifactText } from "./artifacts.js"
import { runCodeRabbitReview } from "./coderabbit.js"
import { runSonarCloudReview } from "./sonarcloud.js"
import type {
  CodeRabbitResult,
  ReviewScope,
  ReviewToolAdapters,
  ReviewToolRegistryResult,
  SonarCloudResult,
} from "./types.js"

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

  const [coderabbit, sonarcloud] = await parallelReview<CodeRabbitResult | SonarCloudResult>("Parallel Review: CodeRabbit + SonarQube...", [
    () => adapters.coderabbit(input),
    () => adapters.sonarcloud(input),
  ])

  const artifactsDir = reviewCycleArtifactsDir(input.artifactsDir, input.reviewCycle)
  await writeArtifactJson(artifactsDir, "review-tools-summary.json", { coderabbit, sonarcloud })
  return { coderabbit: coderabbit as CodeRabbitResult, sonarcloud: sonarcloud as SonarCloudResult }
}
