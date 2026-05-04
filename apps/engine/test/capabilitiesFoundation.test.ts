import { test } from "node:test"
import assert from "node:assert/strict"

import {
  CAPABILITY_IDS,
  defineCapabilities,
  failedReviewOutcome,
  isCapabilityId,
  notConfiguredReviewOutcome,
  notMeaningfulReviewOutcome,
  preflightDisabled,
  preflightMissing,
  preflightNotConfigured,
  REVIEW_OUTCOMES,
  reviewRan,
  skippedReviewOutcome,
  type CapabilityDefinition,
  type CapabilityId,
  type CapabilityPreflightResult,
  type ReviewCapabilityEnvelope,
  type ReviewOutcome,
} from "../src/core/capabilities/index.js"
import type { CodeRabbitResult, SonarCloudResult } from "../src/review/types.js"

test("PROJ-3-PRD-1 AC-1 capability IDs are the closed project set", () => {
  assert.deepEqual([...CAPABILITY_IDS].sort(), ["coderabbit", "git", "github", "sonar", "supabase"])
  assert.equal(isCapabilityId("git"), true)
  assert.equal(isCapabilityId("github"), true)
  assert.equal(isCapabilityId("sonar"), true)
  assert.equal(isCapabilityId("coderabbit"), true)
  assert.equal(isCapabilityId("supabase"), true)
  assert.equal(isCapabilityId("sonarcloud"), false)
  assert.equal(isCapabilityId("gh"), false)
  assert.equal(isCapabilityId("cr"), false)
})

test("PROJ-3-PRD-1 AC-2 capability-aware JSON output carries capabilityId", () => {
  const output = preflightNotConfigured("sonar", "SONAR_TOKEN is missing")
  const json = JSON.parse(JSON.stringify(output)) as { capabilityId?: unknown }

  assert.equal(json.capabilityId, "sonar")
  assert.equal(isCapabilityId(json.capabilityId), true)
})

test("PROJ-3-PRD-1 AC-3 aliases are rejected for capability JSON contracts", () => {
  const aliases = ["sonarcloud", "gh", "cr"]

  for (const alias of aliases) {
    assert.equal(isCapabilityId(alias), false)
  }
})

test("PROJ-3-PRD-1 AC-4 explicit capability ports define the allowed categories", () => {
  const definitions = defineCapabilities([
    {
      id: "git",
      ports: {
        availability: async () => ({ capabilityId: "git", available: true }),
        preflight: async () => ({ capabilityId: "git", status: "ready" }),
      },
    },
    {
      id: "sonar",
      ports: {
        enable: async () => ({ capabilityId: "sonar", status: "ready" }),
        audit: async () => ({ capabilityId: "sonar", status: "warning", reason: "coverage missing" }),
        repair: async () => ({ capabilityId: "sonar", status: "disabled", reason: "operator approval required" }),
        review: async () => reviewRan("sonar", "story", "Sonar review passed", { passed: true }),
      },
    },
    {
      id: "github",
      ports: {
        connect: async () => ({ capabilityId: "github", status: "ready" }),
      },
    },
  ] satisfies CapabilityDefinition[])

  assert.deepEqual(Object.keys(definitions.git.ports).sort(), ["availability", "preflight"])
  assert.deepEqual(Object.keys(definitions.github.ports), ["connect"])
  assert.deepEqual(Object.keys(definitions.sonar.ports).sort(), ["audit", "enable", "repair", "review"])
})

test("PROJ-3-PRD-1 AC-5 capabilities can omit ports that do not apply", () => {
  const definitions = defineCapabilities([
    { id: "coderabbit", ports: { review: async () => reviewRan("coderabbit", "story", "CodeRabbit ran", { findings: [] }) } },
  ] satisfies CapabilityDefinition[])

  assert.equal(definitions.coderabbit.ports.audit, undefined)
  assert.equal(definitions.coderabbit.ports.repair, undefined)
})

test("PROJ-3-PRD-1 AC-6 registry is static and has no plugin lifecycle", () => {
  const definitions = defineCapabilities([{ id: "git", ports: {} }] satisfies CapabilityDefinition[])

  assert.equal(typeof definitions.git, "object")
  assert.equal("registerPlugin" in definitions, false)
  assert.equal("discoverPlugins" in definitions, false)
  assert.equal("loadPlugin" in definitions, false)
})

test("PROJ-3-PRD-1 AC-7 availability is a cheap participation check", async () => {
  const definitions = defineCapabilities([
    {
      id: "git",
      ports: {
        availability: async () => ({ capabilityId: "git", available: true }),
      },
    },
  ] satisfies CapabilityDefinition[])

  const result = await definitions.git.ports.availability?.()
  assert.deepEqual(result, { capabilityId: "git", available: true })
})

test("PROJ-3-PRD-1 AC-8 preflight is detailed readiness and context reporting", () => {
  const result: CapabilityPreflightResult = {
    capabilityId: "github",
    status: "warning",
    reason: "gh is authenticated for a different account",
    context: { account: "octocat" },
  }

  assert.equal(result.capabilityId, "github")
  assert.equal(result.status, "warning")
  assert.deepEqual(result.context, { account: "octocat" })
})

test("PROJ-3-PRD-1 AC-9 normal unavailable states are represented as preflight data", () => {
  assert.deepEqual(preflightMissing("coderabbit", "coderabbit CLI not found"), {
    capabilityId: "coderabbit",
    status: "missing",
    reason: "coderabbit CLI not found",
  })
  assert.deepEqual(preflightDisabled("sonar", "disabled by workspace policy"), {
    capabilityId: "sonar",
    status: "disabled",
    reason: "disabled by workspace policy",
  })
  assert.deepEqual(preflightNotConfigured("github", "gh auth login required"), {
    capabilityId: "github",
    status: "not_configured",
    reason: "gh auth login required",
  })
})

test("PROJ-3-PRD-1 AC-10 review envelope includes identity, phase, outcome, blocking, summary, and artifacts", () => {
  const envelope: ReviewCapabilityEnvelope<{ findings: [] }> = {
    capabilityId: "coderabbit",
    phase: "story-review",
    outcome: "ran",
    blocking: false,
    summary: "CodeRabbit completed",
    artifacts: [{ label: "raw output", path: "coderabbit.raw.txt" }],
    toolResult: { findings: [] },
  }

  assert.equal(envelope.capabilityId, "coderabbit")
  assert.equal(envelope.phase, "story-review")
  assert.equal(envelope.outcome, "ran")
  assert.equal(envelope.blocking, false)
  assert.equal(envelope.summary, "CodeRabbit completed")
  assert.deepEqual(envelope.artifacts, [{ label: "raw output", path: "coderabbit.raw.txt" }])
})

test("PROJ-3-PRD-1 AC-11 review outcome states are the exact closed set", () => {
  const expected: ReviewOutcome[] = ["ran", "skipped", "failed", "not_configured", "not_meaningful"]

  assert.deepEqual([...REVIEW_OUTCOMES], expected)
})

test("PROJ-3-PRD-1 AC-12 Sonar data is preserved outside CodeRabbit result shape", () => {
  const sonarEnvelope: ReviewCapabilityEnvelope<SonarCloudResult> = {
    capabilityId: "sonar",
    phase: "story-review",
    outcome: "ran",
    blocking: false,
    summary: "Sonar gate passed",
    artifacts: [],
    toolResult: {
      status: "ran",
      passed: true,
      conditions: [{ metric: "coverage", status: "ok", actual: "82%", threshold: "80%" }],
      findings: [],
      rawScanPath: "sonar-scan.raw.txt",
      rawGatePath: "sonar-gate.raw.json",
      command: ["sonar-scanner"],
      exitCode: 0,
    },
  }

  assert.equal(sonarEnvelope.toolResult?.passed, true)
  assert.equal(sonarEnvelope.toolResult?.conditions[0]?.metric, "coverage")
})

test("PROJ-3-PRD-1 AC-13 CodeRabbit data is preserved outside Sonar result shape", () => {
  const coderabbitEnvelope: ReviewCapabilityEnvelope<CodeRabbitResult> = {
    capabilityId: "coderabbit",
    phase: "story-review",
    outcome: "ran",
    blocking: false,
    summary: "CodeRabbit found no blockers",
    artifacts: [],
    toolResult: {
      status: "ran",
      findings: [],
      rawPath: "coderabbit.raw.txt",
      command: ["coderabbit", "review"],
      exitCode: 0,
    },
  }

  assert.deepEqual(coderabbitEnvelope.toolResult?.findings, [])
  assert.equal(coderabbitEnvelope.toolResult?.rawPath, "coderabbit.raw.txt")
})

test("PROJ-3-PRD-1 AC-14 ran means completed with meaningful tool result", () => {
  const result = reviewRan("sonar", "story-review", "Sonar produced a gate result", { passed: true })

  assert.equal(result.outcome, "ran")
  assert.equal(result.reason, undefined)
  assert.deepEqual(result.toolResult, { passed: true })
})

test("PROJ-3-PRD-1 AC-15 skipped means intentionally not attempted", () => {
  const result = skippedReviewOutcome("coderabbit", "story-review", "disabled by review policy")

  assert.equal(result.outcome, "skipped")
  assert.equal(result.reason, "disabled by review policy")
})

test("PROJ-3-PRD-1 AC-16 not_configured means required setup is absent", () => {
  const result = notConfiguredReviewOutcome("sonar", "story-review", "SONAR_TOKEN is missing")

  assert.equal(result.outcome, "not_configured")
  assert.equal(result.reason, "SONAR_TOKEN is missing")
})

test("PROJ-3-PRD-1 AC-17 failed means an attempted capability hit execution failure", () => {
  const result = failedReviewOutcome("coderabbit", "story-review", "coderabbit exited 1")

  assert.equal(result.outcome, "failed")
  assert.equal(result.reason, "coderabbit exited 1")
})

test("PROJ-3-PRD-1 AC-18 not_meaningful means input cannot support assessment", () => {
  const result = notMeaningfulReviewOutcome("coderabbit", "story-review", "no diff against base branch")

  assert.equal(result.outcome, "not_meaningful")
  assert.equal(result.reason, "no diff against base branch")
})
