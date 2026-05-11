import { test } from "node:test"
import assert from "node:assert/strict"

import {
  applyDeterministicDbRelevanceFallback,
  applyDbRelevanceEvidenceValidation,
  evaluateStoryDbRelevanceSupport,
  findUnsupportedDbRelevanceClaims,
} from "../../../src/stages/planning/index.js"
import type { ImplementationPlanArtifact, WaveDefinition } from "../../../src/types.js"

function featureWave(input: Partial<WaveDefinition> & Pick<WaveDefinition, "id" | "number" | "stories">): WaveDefinition {
  return {
    goal: input.goal ?? input.id,
    kind: "feature",
    stories: input.stories,
    dbRelevantStoryCount: input.dbRelevantStoryCount,
    dbRelevantWave: input.dbRelevantWave,
    internallyParallelizable: input.internallyParallelizable ?? false,
    dependencies: input.dependencies ?? [],
    exitCriteria: input.exitCriteria ?? [],
    ...input,
  }
}

function plan(waves: WaveDefinition[]): ImplementationPlanArtifact {
  return {
    project: { id: "PROJ-19", name: "Planner Output Validation" },
    conceptSummary: "concept",
    architectureSummary: "architecture",
    plan: {
      summary: "Preserve planner-authored summary",
      assumptions: ["Assume stable scope"],
      sequencingNotes: ["Preserve sequencing"],
      dependencies: ["W1 before W2"],
      risks: ["Preserve risks"],
      waves,
    },
  }
}

test("REQ-1 TC-2: explicit database work supports a story-level positive claim", () => {
  const result = evaluateStoryDbRelevanceSupport({
    story: {
      id: "US-1",
      title: "Add users table schema and apply a Prisma migration for SQLite",
      dbRelevant: true,
      sharedFiles: ["prisma/schema.prisma", "supabase/migrations/20260511090000_users.sql"],
    },
    hasSupabaseConfigured: true,
  })

  assert.equal(result.supported, true)
})

test("REQ-1 TC-3: generic backend or Supabase-only wording does not support a story-level positive claim", () => {
  const backendOnly = evaluateStoryDbRelevanceSupport({
    story: {
      id: "US-1",
      title: "Implement backend API handler for reporting endpoint",
      dbRelevant: true,
    },
    hasSupabaseConfigured: true,
  })
  const supabaseOnly = evaluateStoryDbRelevanceSupport({
    story: {
      id: "US-2",
      title: "Confirm Supabase readiness before rollout",
      dbRelevant: true,
    },
    hasSupabaseConfigured: true,
  })

  assert.equal(backendOnly.supported, false)
  assert.equal(supabaseOnly.supported, false)
})

test("REQ-1 TC-1 / TC-7: validation keeps only evidence-backed positive claims and preserves unrelated planner assertions", () => {
  const artifact = plan([
    featureWave({
      id: "W1",
      number: 1,
      goal: "Ship the API and data model update",
      stories: [
        { id: "US-1", title: "Add accounts table schema migration", dbRelevant: true, sharedFiles: ["supabase/migrations/20260511090000_accounts.sql"] },
        { id: "US-2", title: "Implement backend API handler", dbRelevant: true, sharedFiles: ["apps/engine/src/api/accounts.ts"] },
      ],
      dbRelevantWave: true,
      dbRelevantStoryCount: 2,
      exitCriteria: ["Accounts table exists and API serves reads"],
    }),
  ])

  const original = JSON.parse(JSON.stringify(artifact)) as ImplementationPlanArtifact
  const { unsupportedClaims } = applyDbRelevanceEvidenceValidation(artifact, { hasSupabaseConfigured: true })

  assert.deepEqual(unsupportedClaims, [
    { level: "story", waveId: "W1", storyId: "US-2", reason: "Story marked dbRelevant:true but does not describe concrete database work in the plan output." },
  ])
  assert.equal(artifact.plan.waves[0]?.stories[0]?.dbRelevant, true)
  assert.equal(artifact.plan.waves[0]?.stories[1]?.dbRelevant, false)
  assert.equal(artifact.plan.waves[0]?.dbRelevantStoryCount, 1)
  assert.equal(artifact.plan.waves[0]?.dbRelevantWave, true)
  assert.equal(artifact.plan.summary, original.plan.summary)
  assert.deepEqual(artifact.plan.dependencies, original.plan.dependencies)
  assert.equal(artifact.plan.waves[0]?.stories[0]?.title, original.plan.waves[0]?.stories[0]?.title)
  assert.equal(artifact.plan.waves[0]?.stories[1]?.sharedFiles?.[0], original.plan.waves[0]?.stories[1]?.sharedFiles?.[0])
})

test("REQ-1 TC-4: wave-level positive claim survives when the wave itself states explicit database work", () => {
  const artifact = plan([
    featureWave({
      id: "W1",
      number: 1,
      goal: "Run the SQLite migration path and backfill existing customer records",
      stories: [
        { id: "US-1", title: "Refresh operator copy", dbRelevant: false },
      ],
      dbRelevantWave: true,
      dbRelevantStoryCount: 0,
      exitCriteria: ["SQLite migration applied"],
    }),
  ])

  const { unsupportedClaims } = applyDbRelevanceEvidenceValidation(artifact, { hasSupabaseConfigured: false })

  assert.deepEqual(unsupportedClaims, [])
  assert.equal(artifact.plan.waves[0]?.dbRelevantStoryCount, 0)
  assert.equal(artifact.plan.waves[0]?.dbRelevantWave, true)
})

test("REQ-1 TC-5: wave-level positive claim is derived from supported child stories and drops after unsupported positives are cleared", () => {
  const supported = plan([
    featureWave({
      id: "W1",
      number: 1,
      goal: "Deliver account changes",
      stories: [
        { id: "US-1", title: "Add audit table migration for Postgres", dbRelevant: true },
      ],
      dbRelevantWave: true,
      dbRelevantStoryCount: 1,
    }),
  ])
  applyDbRelevanceEvidenceValidation(supported, { hasSupabaseConfigured: true })

  assert.equal(supported.plan.waves[0]?.dbRelevantWave, true)

  const unsupported = plan([
    featureWave({
      id: "W1",
      number: 1,
      goal: "Deliver account changes",
      stories: [
        { id: "US-1", title: "Implement backend API handler", dbRelevant: true },
      ],
      dbRelevantWave: true,
      dbRelevantStoryCount: 1,
    }),
  ])
  applyDbRelevanceEvidenceValidation(unsupported, { hasSupabaseConfigured: true })

  assert.equal(unsupported.plan.waves[0]?.stories[0]?.dbRelevant, false)
  assert.equal(unsupported.plan.waves[0]?.dbRelevantStoryCount, 0)
  assert.equal(unsupported.plan.waves[0]?.dbRelevantWave, false)
})

test("REQ-1 TC-6: non-Supabase workspaces require an explicit alternative migration path", () => {
  const unsupported = plan([
    featureWave({
      id: "W1",
      number: 1,
      goal: "Database work without a path",
      stories: [
        { id: "US-1", title: "Add customer table schema", dbRelevant: true },
      ],
      dbRelevantWave: true,
      dbRelevantStoryCount: 1,
    }),
  ])
  const supported = plan([
    featureWave({
      id: "W1",
      number: 1,
      goal: "Database work with a path",
      stories: [
        { id: "US-1", title: "Add customer table via Prisma migration on SQLite", dbRelevant: true },
      ],
      dbRelevantWave: true,
      dbRelevantStoryCount: 1,
    }),
  ])

  applyDbRelevanceEvidenceValidation(unsupported, { hasSupabaseConfigured: false })
  applyDbRelevanceEvidenceValidation(supported, { hasSupabaseConfigured: false })

  assert.equal(unsupported.plan.waves[0]?.stories[0]?.dbRelevant, false)
  assert.equal(unsupported.plan.waves[0]?.dbRelevantWave, false)
  assert.equal(supported.plan.waves[0]?.stories[0]?.dbRelevant, true)
  assert.equal(supported.plan.waves[0]?.dbRelevantWave, true)
})

test("REQ-1 TC-8: plans with no positive DB-relevance claims remain unchanged at the validation boundary", () => {
  const artifact = plan([
    featureWave({
      id: "W1",
      number: 1,
      goal: "Docs and copy only",
      stories: [
        { id: "US-1", title: "Refresh copy", dbRelevant: false },
      ],
      dbRelevantWave: false,
      dbRelevantStoryCount: 0,
    }),
  ])

  const before = JSON.parse(JSON.stringify(artifact))
  const { unsupportedClaims } = applyDbRelevanceEvidenceValidation(artifact, { hasSupabaseConfigured: true })

  assert.deepEqual(unsupportedClaims, [])
  assert.deepEqual(artifact, before)
})

test("REQ-2 TC-6: wave-only orphan DB claim is reported even when all stories are already false", () => {
  const artifact = plan([
    featureWave({
      id: "W1",
      number: 1,
      goal: "UI-only polish",
      stories: [
        { id: "US-1", title: "Refresh copy", dbRelevant: false },
      ],
      dbRelevantWave: true,
      dbRelevantStoryCount: 0,
    }),
  ])

  assert.deepEqual(findUnsupportedDbRelevanceClaims(artifact, { hasSupabaseConfigured: true }), [
    {
      level: "wave",
      waveId: "W1",
      reason: "Wave marked dbRelevantWave:true but neither the wave nor its supported stories describe concrete database work in the plan output.",
    },
  ])
})

test("REQ-2 TC-9 / TC-10 / TC-11: deterministic fallback clears only unsupported positives and re-evaluates wave support", () => {
  const artifact = plan([
    featureWave({
      id: "W1",
      number: 1,
      goal: "Deliver mixed account changes",
      stories: [
        { id: "US-1", title: "Add accounts table migration for Postgres", dbRelevant: true },
        { id: "US-2", title: "Implement backend API handler", dbRelevant: true, sharedFiles: ["apps/engine/src/api/accounts.ts"] },
      ],
      dbRelevantWave: true,
      dbRelevantStoryCount: 2,
      exitCriteria: ["Preserve exit criteria"],
    }),
    featureWave({
      id: "W2",
      number: 2,
      goal: "UI cleanup only",
      stories: [
        { id: "US-3", title: "Refresh operator copy", dbRelevant: false },
      ],
      dbRelevantWave: true,
      dbRelevantStoryCount: 0,
      exitCriteria: ["Preserve unrelated content"],
    }),
  ])

  const before = JSON.parse(JSON.stringify(artifact)) as ImplementationPlanArtifact
  const { unsupportedClaims } = applyDeterministicDbRelevanceFallback(artifact, { hasSupabaseConfigured: true })

  assert.deepEqual(unsupportedClaims, [
    {
      level: "story",
      waveId: "W1",
      storyId: "US-2",
      reason: "Story marked dbRelevant:true but does not describe concrete database work in the plan output.",
    },
    {
      level: "wave",
      waveId: "W2",
      reason: "Wave marked dbRelevantWave:true but neither the wave nor its supported stories describe concrete database work in the plan output.",
    },
  ])
  assert.equal(artifact.plan.waves[0]?.stories[0]?.dbRelevant, true)
  assert.equal(artifact.plan.waves[0]?.stories[1]?.dbRelevant, false)
  assert.equal(artifact.plan.waves[0]?.dbRelevantWave, true)
  assert.equal(artifact.plan.waves[1]?.dbRelevantWave, false)
  assert.equal(artifact.plan.waves[1]?.stories[0]?.dbRelevant, before.plan.waves[1]?.stories[0]?.dbRelevant)
  assert.equal(artifact.plan.summary, before.plan.summary)
  assert.deepEqual(artifact.plan.dependencies, before.plan.dependencies)
  assert.deepEqual(artifact.plan.waves[0]?.exitCriteria, before.plan.waves[0]?.exitCriteria)
})
