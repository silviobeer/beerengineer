import { parallelReview } from "../core/parallelReview.js";
import { crReview, sonarReview } from "../sim/llm.js";
import { reviewCycleArtifactsDir, writeArtifactJson, writeArtifactText } from "./artifacts.js";
import { runCodeRabbitReview } from "./coderabbit.js";
import { runDesignSystemGate } from "./designSystemGate.js";
import { runSonarCloudReview } from "./sonarcloud.js";
let injectedAdapters = null;
function fakeRequested(forceFake) {
    return forceFake === true || process.env.BEERENGINEER_FORCE_FAKE_REVIEW === "1" || injectedAdapters !== null;
}
export function hasTestInjection() {
    return injectedAdapters !== null;
}
export function setTestReviewAdapters(adapters) {
    injectedAdapters = adapters;
}
export function resetTestReviewAdapters() {
    injectedAdapters = null;
}
async function runFakeCodeRabbit(input) {
    const findings = (await crReview(input.reviewCycle, input.storyId));
    const artifactsDir = reviewCycleArtifactsDir(input.artifactsDir, input.reviewCycle);
    const rawPath = await writeArtifactJson(artifactsDir, "coderabbit.fake.json", findings);
    return {
        status: "ran",
        findings,
        summary: findings.length === 0 ? "No findings." : `Fake CodeRabbit returned ${findings.length} findings.`,
        rawPath,
        command: ["fake-coderabbit"],
        exitCode: 0,
    };
}
async function runFakeSonar(input) {
    const sonar = await sonarReview(input.reviewCycle, input.storyId);
    const artifactsDir = reviewCycleArtifactsDir(input.artifactsDir, input.reviewCycle);
    const rawScanPath = await writeArtifactText(artifactsDir, "sonar-scan.fake.txt", "fake sonar scan\n");
    const rawGatePath = await writeArtifactJson(artifactsDir, "sonar-gate.fake.json", sonar);
    return {
        status: "ran",
        passed: sonar.passed,
        conditions: sonar.conditions,
        findings: sonar.findings,
        summary: sonar.passed ? "Fake quality gate passed." : "Fake quality gate failed.",
        rawScanPath,
        rawGatePath,
        command: ["fake-sonar"],
        exitCode: 0,
    };
}
export async function runStoryReviewTools(input) {
    const adapters = fakeRequested(input.forceFake)
        ? injectedAdapters ?? { coderabbit: runFakeCodeRabbit, sonarcloud: runFakeSonar }
        : { coderabbit: runCodeRabbitReview, sonarcloud: runSonarCloudReview };
    const [designSystem, coderabbit, sonarcloud] = await parallelReview("Parallel Review: design gate + CodeRabbit + SonarQube...", [
        () => runDesignSystemGate(input),
        () => adapters.coderabbit(input),
        () => adapters.sonarcloud(input),
    ]);
    const artifactsDir = reviewCycleArtifactsDir(input.artifactsDir, input.reviewCycle);
    await writeArtifactJson(artifactsDir, "review-tools-summary.json", { designSystem, coderabbit, sonarcloud });
    return {
        designSystem: designSystem,
        coderabbit: coderabbit,
        sonarcloud: sonarcloud,
    };
}
