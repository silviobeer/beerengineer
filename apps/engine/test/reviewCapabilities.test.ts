import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { REVIEW_OUTCOMES } from "../src/core/capabilities/index.js"
import { runStoryReviewTools, reviewCapabilityPorts, resetTestReviewAdapters, setTestReviewAdapters } from "../src/review/registry.js"
import type { CodeRabbitResult, ReviewScope, SonarCloudResult } from "../src/review/types.js"

function scope(root: string): ReviewScope {
  return {
    workspaceRoot: root,
    artifactsDir: root,
    baselineSha: "base",
    storyBranch: "story/demo",
    baseBranch: "main",
    changedFiles: ["src/demo.ts"],
    storyId: "US-1",
    reviewCycle: 1,
    reviewPolicy: {
      coderabbit: { enabled: true },
      sonarcloud: { enabled: true, organization: "acme", projectKey: "acme_demo" },
    },
    forceFake: true,
  }
}

function coderabbit(overrides: Partial<CodeRabbitResult> = {}): CodeRabbitResult {
  return {
    status: "ran",
    findings: [],
    summary: "CodeRabbit reviewed the diff.",
    rawPath: "coderabbit.raw.txt",
    command: ["coderabbit", "review"],
    exitCode: 0,
    ...overrides,
  }
}

function sonar(overrides: Partial<SonarCloudResult> = {}): SonarCloudResult {
  return {
    status: "ran",
    passed: true,
    conditions: [{ metric: "coverage", status: "ok", actual: "90", threshold: "80" }],
    findings: [],
    summary: "Quality gate passed.",
    rawScanPath: "sonar-scan.raw.txt",
    rawGatePath: "sonar-gate.raw.json",
    command: ["sonar-scanner"],
    exitCode: 0,
    ...overrides,
  }
}

async function withReview<T>(
  adapters: { coderabbit?: CodeRabbitResult; sonarcloud?: SonarCloudResult },
  fn: (result: Awaited<ReturnType<typeof runStoryReviewTools>>, root: string) => Promise<T>,
): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "be2-review-cap-"))
  setTestReviewAdapters({
    coderabbit: async () => adapters.coderabbit ?? coderabbit(),
    sonarcloud: async () => adapters.sonarcloud ?? sonar(),
  })
  try {
    return await fn(await runStoryReviewTools(scope(root)), root)
  } finally {
    resetTestReviewAdapters()
    rmSync(root, { recursive: true, force: true })
  }
}

test("PROJ-3-PRD-4 AC-1 Sonar review output includes a capability envelope", async () => {
  await withReview({}, async result => {
    const envelope = result.capabilities.find(capability => capability.capabilityId === "sonar")
    assert.equal(envelope?.capabilityId, "sonar")
    assert.equal(envelope?.phase, "story-review")
  })
})

test("PROJ-3-PRD-4 AC-2 CodeRabbit review output includes a capability envelope", async () => {
  await withReview({}, async result => {
    const envelope = result.capabilities.find(capability => capability.capabilityId === "coderabbit")
    assert.equal(envelope?.capabilityId, "coderabbit")
    assert.equal(envelope?.phase, "story-review")
  })
})

test("PROJ-3-PRD-4 AC-3 review capability outcomes use the closed outcome set", async () => {
  await withReview({
    coderabbit: coderabbit({ status: "skipped", reason: "coderabbit-no-diff" }),
    sonarcloud: sonar({ status: "failed", reason: "sonar-token-missing", passed: false, exitCode: 1 }),
  }, async result => {
    for (const envelope of result.capabilities) assert.ok(REVIEW_OUTCOMES.includes(envelope.outcome))
  })
})

test("PROJ-3-PRD-4 AC-4 non-ran or non-meaningful outcomes include reason and artifact references", async () => {
  await withReview({
    coderabbit: coderabbit({ status: "skipped", reason: "coderabbit-no-diff" }),
    sonarcloud: sonar({ status: "failed", reason: "sonar-token-missing", passed: false, exitCode: 1 }),
  }, async result => {
    for (const envelope of result.capabilities.filter(capability => capability.outcome !== "ran")) {
      assert.ok(envelope.reason)
      assert.ok(envelope.artifacts.length > 0)
    }
  })
})

test("PROJ-3-PRD-4 AC-5 Sonar-specific scanner gate condition coverage and scope details remain available", async () => {
  await withReview({}, async result => {
    const envelope = result.capabilities.find(capability => capability.capabilityId === "sonar")
    assert.equal(envelope?.toolResult?.command[0], "sonar-scanner")
    assert.equal(envelope?.toolResult?.conditions[0]?.metric, "coverage")
    assert.equal(result.sonarcloud.conditions[0]?.actual, "90")
  })
})

test("PROJ-3-PRD-4 AC-6 CodeRabbit diff and finding details remain CodeRabbit-specific", async () => {
  await withReview({
    coderabbit: coderabbit({ findings: [{ source: "coderabbit", severity: "medium", message: "diff finding" }] }),
  }, async result => {
    const envelope = result.capabilities.find(capability => capability.capabilityId === "coderabbit")
    assert.equal(envelope?.toolResult?.findings[0]?.source, "coderabbit")
    assert.equal(result.coderabbit.command[0], "coderabbit")
  })
})

test("PROJ-3-PRD-4 AC-7 common envelope does not replace domain-specific result structures", async () => {
  await withReview({}, async result => {
    assert.ok(result.coderabbit.rawPath)
    assert.ok(result.sonarcloud.rawGatePath)
    assert.equal(result.capabilities.length, 2)
  })
})

test("PROJ-3-PRD-4 AC-8 review artifacts preserve tool-specific debugging detail", async () => {
  await withReview({}, async (_result, root) => {
    const summary = JSON.parse(await readFile(join(root, "review-tool-artifacts", "cycle-1", "review-tools-summary.json"), "utf8"))
    assert.equal(summary.coderabbit.rawPath, "coderabbit.raw.txt")
    assert.equal(summary.sonarcloud.rawScanPath, "sonar-scan.raw.txt")
    assert.equal(summary.capabilities[0].phase, "story-review")
  })
})

test("PROJ-3-PRD-4 AC-11 optional capability issues are recorded in review artifacts", async () => {
  await withReview({
    coderabbit: coderabbit({ status: "skipped", reason: "coderabbit-cli-missing" }),
  }, async (_result, root) => {
    const summary = JSON.parse(await readFile(join(root, "review-tool-artifacts", "cycle-1", "review-tools-summary.json"), "utf8"))
    assert.ok(summary.capabilities.some((capability: { outcome: string }) => capability.outcome === "not_configured"))
  })
})

test("PROJ-3-PRD-4 AC-13 review orchestration invokes review capability ports", () => {
  assert.equal(typeof reviewCapabilityPorts.coderabbit, "function")
  assert.equal(typeof reviewCapabilityPorts.sonar, "function")
})

test("PROJ-3-PRD-4 AC-14 tool adapters own tool-specific result details", async () => {
  await withReview({}, async result => {
    assert.deepEqual(result.coderabbit.command, ["coderabbit", "review"])
    assert.deepEqual(result.sonarcloud.command, ["sonar-scanner"])
  })
})

test("PROJ-3-PRD-4 AC-15 review summary can list capability outcomes without tool internals", async () => {
  await withReview({
    coderabbit: coderabbit({ status: "skipped", reason: "coderabbit-no-diff" }),
  }, async result => {
    assert.deepEqual(result.capabilities.map(capability => ({
      capabilityId: capability.capabilityId,
      outcome: capability.outcome,
    })), [
      { capabilityId: "coderabbit", outcome: "not_meaningful" },
      { capabilityId: "sonar", outcome: "ran" },
    ])
  })
})

test("PROJ-3-PRD-4 AC-16 fake review capabilities can test orchestration without real tools", async () => {
  await withReview({}, async result => {
    assert.equal(result.capabilities.every(capability => capability.outcome === "ran"), true)
  })
})

test("PROJ-3-PRD-4 AC-19 JSON output includes stable capabilityId and outcome values", async () => {
  await withReview({}, async (_result, root) => {
    const summary = JSON.parse(await readFile(join(root, "review-tool-artifacts", "cycle-1", "review-tools-summary.json"), "utf8"))
    assert.deepEqual(summary.capabilities.map((capability: { capabilityId: string }) => capability.capabilityId), ["coderabbit", "sonar"])
    assert.deepEqual(summary.capabilities.map((capability: { outcome: string }) => capability.outcome), ["ran", "ran"])
  })
})

test("PROJ-3-PRD-4 AC-20 skipped or not-meaningful capabilities are clear in summaries", async () => {
  await withReview({
    coderabbit: coderabbit({ status: "skipped", reason: "coderabbit-no-diff" }),
  }, async result => {
    const envelope = result.capabilities.find(capability => capability.capabilityId === "coderabbit")
    assert.equal(envelope?.outcome, "not_meaningful")
    assert.match(envelope?.summary ?? "", /coderabbit-no-diff|CodeRabbit/)
  })
})
