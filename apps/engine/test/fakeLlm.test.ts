import { test } from "node:test"
import assert from "node:assert/strict"

import { crReview, sonarReview } from "../src/sim/llm.js"
import { parallelReview } from "../src/core/parallelReview.js"
import { FakeBrainstormStageAdapter } from "../src/llm/fake/brainstormStage.js"
import { FakeBrainstormReviewAdapter } from "../src/llm/fake/brainstormReview.js"
import { FakeRequirementsStageAdapter } from "../src/llm/fake/requirementsStage.js"
import { FakeRequirementsReviewAdapter } from "../src/llm/fake/requirementsReview.js"
import { FakeArchitectureStageAdapter } from "../src/llm/fake/architectureStage.js"
import { FakeArchitectureReviewAdapter } from "../src/llm/fake/architectureReview.js"
import { FakePlanningStageAdapter } from "../src/llm/fake/planningStage.js"
import { FakePlanningReviewAdapter } from "../src/llm/fake/planningReview.js"
import { FakeTestWriterStageAdapter } from "../src/llm/fake/testWriterStage.js"
import { FakeTestWriterReviewAdapter } from "../src/llm/fake/testWriterReview.js"
import { FakeQaStageAdapter } from "../src/llm/fake/qaStage.js"
import { FakeQaReviewAdapter } from "../src/llm/fake/qaReview.js"
import { FakeProjectReviewStageAdapter } from "../src/llm/fake/projectReviewStage.js"
import { FakeProjectReviewReviewAdapter } from "../src/llm/fake/projectReviewReview.js"
import { FakeDocumentationStageAdapter } from "../src/llm/fake/documentationStage.js"
import { FakeDocumentationReviewAdapter } from "../src/llm/fake/documentationReview.js"
import type { Project, Concept, PRD } from "../src/types.js"

const concept: Concept = {
  summary: "s",
  problem: "p",
  users: ["u"],
  constraints: ["c"],
}
const project: Project = { id: "P01", name: "P", description: "d", concept }
const prd: PRD = {
  stories: [
    {
      id: "US-01",
      title: "t",
      acceptanceCriteria: [{ id: "AC-01", text: "x", priority: "must", category: "functional" }],
    },
  ],
}

// ─── sim/llm.ts (CodeRabbit + SonarQube stub) ────────────────────────────────

test("crReview severity sequence matches the simulation contract: high+medium → medium → low", async () => {
  const [loop1, loop2, loop3] = await Promise.all([crReview(1, "US-1"), crReview(2, "US-1"), crReview(3, "US-1")])
  assert.deepEqual(loop1.map(f => f.severity), ["high", "medium"])
  assert.deepEqual(loop2.map(f => f.severity), ["medium"])
  assert.deepEqual(loop3.map(f => f.severity), ["low"])
  assert.ok(loop1.every(f => f.source === "coderabbit"))
  assert.ok(loop1[0].message.includes("[US-1]"))
})

test("sonarReview: loop 1+2 fail quality gate, loop 3 passes", async () => {
  const [l1, l2, l3] = await Promise.all([sonarReview(1), sonarReview(2), sonarReview(3)])
  assert.equal(l1.passed, false)
  assert.equal(l2.passed, false)
  assert.equal(l3.passed, true)
  assert.ok(l1.conditions.some(c => c.status === "error"))
  assert.ok(l3.conditions.every(c => c.status === "ok"))
})

test("parallelReview runs all reviewers concurrently and collects results in order", async () => {
  const originalLog = console.log
  console.log = () => {}
  try {
    const started: number[] = []
    const make = (id: number, ms: number) => async () => {
      started.push(id)
      await new Promise(r => setTimeout(r, ms))
      return id
    }
    const begin = Date.now()
    const out = await parallelReview("parallel test", [make(1, 80), make(2, 80), make(3, 80)])
    const elapsed = Date.now() - begin
    assert.deepEqual(out, [1, 2, 3])
    assert.deepEqual(started, [1, 2, 3])
    assert.ok(elapsed < 200, `should run in parallel, got ${elapsed}ms`)
  } finally {
    console.log = originalLog
  }
})

// ─── Stage adapters ──────────────────────────────────────────────────────────

test("brainstorm stage asks 3 questions then returns artifact; review passes on 2nd attempt", async () => {
  const stage = new FakeBrainstormStageAdapter()
  const review = new FakeBrainstormReviewAdapter()
  const state = {
    item: { id: "i1", title: "T", description: "d" },
    questionsAsked: 0,
    targetQuestions: 3,
    history: [],
  }

  let response = await stage.step({ kind: "begin", state })
  assert.equal(response.kind, "message")

  for (let i = 0; i < 3; i++) {
    const prev = response
    assert.equal(prev.kind, "message")
    response = await stage.step({ kind: "user-message", state, userMessage: `ans${i}` })
  }
  assert.equal(response.kind, "artifact")
  if (response.kind === "artifact") {
    assert.equal(response.artifact.projects.length, 1)
    assert.equal(response.artifact.projects[0].id, "P01")
  }

  // Reviewer: 1st call revises, 2nd passes
  const anyArtifact = response.kind === "artifact" ? response.artifact : { concept, projects: [project] }
  const r1 = await review.review({ artifact: anyArtifact, state })
  const r2 = await review.review({ artifact: anyArtifact, state })
  assert.equal(r1.kind, "revise")
  assert.equal(r2.kind, "pass")
})

test("requirements stage produces PRD with 3 stories after clarifications; reviewer revises once then passes", async () => {
  const stage = new FakeRequirementsStageAdapter()
  const review = new FakeRequirementsReviewAdapter()
  const state = {
    concept,
    clarificationCount: 0,
    maxClarifications: 2,
    history: [],
  }

  const q1 = await stage.step({ kind: "begin", state })
  assert.equal(q1.kind, "message")
  const q2 = await stage.step({ kind: "user-message", state, userMessage: "answer 1" })
  assert.equal(q2.kind, "message")
  const out = await stage.step({ kind: "user-message", state, userMessage: "answer 2" })
  assert.equal(out.kind, "artifact")
  if (out.kind === "artifact") {
    assert.equal(out.artifact.prd.stories.length, 3)
    assert.ok(out.artifact.prd.stories[1].acceptanceCriteria.some(ac => ac.text.includes("answer 1")))
  }

  // Reviewer: revise then pass
  const dummy = out.kind === "artifact" ? out.artifact : ({ concept, prd } as never)
  assert.equal((await review.review({ artifact: dummy, state })).kind, "revise")
  assert.equal((await review.review({ artifact: dummy, state })).kind, "pass")

  // After revise, stage returns a "Welche Story" message on review-feedback input
  const after = await stage.step({ kind: "review-feedback", state, reviewFeedback: "tighten US-02" })
  assert.equal(after.kind, "message")
  assert.equal(state.lastReviewFeedback, "tighten US-02")
})

test("architecture stage + reviewer: autorun with revise-then-pass", async () => {
  const stage = new FakeArchitectureStageAdapter(project)
  const review = new FakeArchitectureReviewAdapter()
  const state = { project, prd, revisionCount: 0 } as never
  const a1 = await stage.step({ kind: "begin", state })
  assert.equal(a1.kind, "artifact")
  if (a1.kind === "artifact") {
    assert.equal(a1.artifact.prdSummary.storyCount, 1)
    assert.ok(a1.artifact.architecture.components.length >= 1)
  }
  assert.equal((await review.review()).kind, "revise")
  assert.equal((await review.review()).kind, "pass")

  // Rejects user-message — autorun doesn't chat
  await assert.rejects(
    () => stage.step({ kind: "user-message", state, userMessage: "nope" } as never),
    /does not accept user messages/,
  )
})

test("planning stage produces two waves with explicit story-level parallelism semantics; reviewer revises then passes", async () => {
  const stage = new FakePlanningStageAdapter(project)
  const review = new FakePlanningReviewAdapter()
  const prd3: PRD = {
    stories: ["US-01", "US-02", "US-03"].map(id => ({
      id,
      title: id,
      acceptanceCriteria: [],
    })),
  }
  const state = { prd: prd3, architectureArtifact: { architecture: { summary: "A" } }, revisionCount: 0 } as never
  const out = await stage.step({ kind: "begin", state })
  assert.equal(out.kind, "artifact")
  if (out.kind === "artifact") {
    const waves = out.artifact.plan.waves
    assert.equal(waves.length, 2)
    assert.equal(waves[0].internallyParallelizable, false)
    assert.equal(waves[0].stories.length, 1)
    assert.equal(waves[1].internallyParallelizable, true)
    assert.deepEqual(waves[1].dependencies, ["W1"])
    assert.equal(waves[1].stories.length, 2)
  }
  assert.equal((await review.review()).kind, "revise")
  assert.equal((await review.review()).kind, "pass")
})

test("test-writer stage builds a test plan from ACs; reviewer revises then passes", async () => {
  const stage = new FakeTestWriterStageAdapter(project)
  const review = new FakeTestWriterReviewAdapter()
  const state = {
    projectId: project.id,
    wave: { id: "W1", number: 1, goal: "g", dependencies: [], stories: [], internallyParallelizable: false, exitCriteria: [] },
    story: { id: "US-01", title: "x" },
    acceptanceCriteria: [
      { id: "AC-01", text: "a", priority: "must" as const, category: "functional" as const },
      { id: "AC-02", text: "b", priority: "must" as const, category: "validation" as const },
    ],
    revisionCount: 0,
  }
  const out = await stage.step({ kind: "begin", state })
  assert.equal(out.kind, "artifact")
  if (out.kind === "artifact") {
    assert.equal(out.artifact.testPlan.testCases.length, 2)
    assert.equal(out.artifact.testPlan.testCases[0].mapsToAcId, "AC-01")
  }
  assert.equal((await review.review()).kind, "revise")
  assert.equal((await review.review()).kind, "pass")
})

test("qa stage: findings trigger fix/accept message; 'accept' returns accepted artifact; 'fix' starts loop 2", async () => {
  const stage = new FakeQaStageAdapter()
  const review = new FakeQaReviewAdapter()

  const stateAccept = { loop: 0, findings: [] }
  const q1 = await stage.step({ kind: "begin", state: stateAccept })
  assert.equal(q1.kind, "message")
  const answeredAccept = await stage.step({ kind: "user-message", state: stateAccept, userMessage: "accept" })
  assert.equal(answeredAccept.kind, "artifact")
  if (answeredAccept.kind === "artifact") {
    assert.equal(answeredAccept.artifact.accepted, true)
    assert.equal(answeredAccept.artifact.findings.length, 2)
  }

  const stateFix = { loop: 0, findings: [] }
  await stage.step({ kind: "begin", state: stateFix })
  const afterFix = await stage.step({ kind: "user-message", state: stateFix, userMessage: "fix" })
  assert.equal(afterFix.kind, "artifact")
  if (afterFix.kind === "artifact") {
    assert.equal(afterFix.artifact.findings.length, 0)
    assert.equal(afterFix.artifact.loops, 2)
  }

  // Review
  const accepted = { accepted: true, loops: 1, findings: [] }
  const pending = { accepted: false, loops: 1, findings: [{ source: "qa-llm", severity: "medium" as const, message: "x" }] }
  assert.equal((await review.review({ artifact: accepted, state: stateAccept })).kind, "pass")
  assert.equal((await review.review({ artifact: pending, state: stateAccept })).kind, "revise")
})

test("project-review reviewer: high finding triggers revise; clean/low passes", async () => {
  const review = new FakeProjectReviewReviewAdapter()
  const artifactDirty = {
    project: { id: "P01", name: "P" },
    scope: "project-wide-code-review" as const,
    overallStatus: "fail" as const,
    summary: "",
    findings: [
      { id: "PR-1", source: "project-review-llm" as const, severity: "high" as const, category: "architecture" as const, message: "m", evidence: "e", recommendation: "r" },
    ],
    recommendations: [],
  }
  const artifactClean = { ...artifactDirty, findings: [], overallStatus: "pass" as const }
  assert.equal((await review.review({ artifact: artifactDirty, state: {} as never })).kind, "revise")
  assert.equal((await review.review({ artifact: artifactClean, state: {} as never })).kind, "pass")
})

test("project-review stage: first run emits findings; after revision with feedback emits cleanup-only", async () => {
  const stage = new FakeProjectReviewStageAdapter(project)
  const state: {
    revisionCount: number
    lastReviewFeedback?: string
    executionSummaries: Array<{ waveId: string; storiesMerged: unknown[]; storiesBlocked: string[] }>
    implementationPlan: { plan: { waves: unknown[] } }
    prd: PRD
  } = {
    revisionCount: 0,
    executionSummaries: [{ waveId: "W1", storiesMerged: [{}], storiesBlocked: [] }],
    implementationPlan: { plan: { waves: [{}] } },
    prd,
  }

  const a1 = await stage.step({ kind: "begin", state: state as never })
  assert.equal(a1.kind, "artifact")
  if (a1.kind === "artifact") {
    assert.equal(a1.artifact.overallStatus, "fail")
    assert.ok(a1.artifact.findings.length >= 1)
  }

  // Revision after feedback: the stage expects state mutations done by the caller
  const a2 = await stage.step({ kind: "review-feedback", state: state as never, reviewFeedback: "tighten it" })
  assert.equal(a2.kind, "artifact")
  if (a2.kind === "artifact") {
    assert.equal(a2.artifact.overallStatus, "pass_with_risks")
    assert.equal(a2.artifact.findings.every(f => f.severity === "low"), true)
  }
})

test("documentation reviewer enforces Known Risks when project-review findings exist", async () => {
  const review = new FakeDocumentationReviewAdapter()
  const stateWithFindings = {
    project,
    prd,
    projectReview: {
      project: { id: "P01", name: "P" },
      scope: "project-wide-code-review" as const,
      overallStatus: "pass_with_risks" as const,
      summary: "",
      findings: [
        { id: "PR-1", source: "project-review-llm" as const, severity: "low" as const, category: "maintainability" as const, message: "m", evidence: "e", recommendation: "r" },
      ],
      recommendations: [],
    },
  } as never

  const artifactWithoutRisks = {
    project: { id: "P01", name: "P" },
    mode: "generate" as const,
    technicalDoc: { title: "t", summary: "s", sections: [{ heading: "Architecture", content: "" }] },
    featuresDoc: { title: "f", summary: "s", sections: [{ heading: "Implemented Features", content: "US-01" }] },
    compactReadme: { title: "r", summary: "s", sections: [] },
    knownIssues: [],
  }
  assert.equal((await review.review({ artifact: artifactWithoutRisks, state: stateWithFindings })).kind, "revise")

  const artifactWithRisks = {
    ...artifactWithoutRisks,
    technicalDoc: { ...artifactWithoutRisks.technicalDoc, sections: [{ heading: "Known Risks", content: "..." }] },
  }
  assert.equal((await review.review({ artifact: artifactWithRisks, state: stateWithFindings })).kind, "pass")
})

test("documentation reviewer flags missing stories in features doc and oversized README", async () => {
  const review = new FakeDocumentationReviewAdapter()
  const state = { project, prd, projectReview: { findings: [] } } as never

  const tooLongReadme = {
    project: { id: "P01", name: "P" },
    mode: "generate" as const,
    technicalDoc: { title: "t", summary: "s", sections: [] },
    featuresDoc: { title: "f", summary: "s", sections: [{ heading: "Implemented Features", content: "US-01" }] },
    compactReadme: {
      title: "r",
      summary: "s",
      sections: [
        { heading: "a", content: "" },
        { heading: "b", content: "" },
        { heading: "c", content: "" },
        { heading: "d", content: "" },
        { heading: "e", content: "" },
      ],
    },
    knownIssues: [],
  }
  const res = await review.review({ artifact: tooLongReadme, state })
  assert.equal(res.kind, "revise")
  if (res.kind === "revise") assert.match(res.feedback, /Compact README/)

  const missingStory = {
    ...tooLongReadme,
    compactReadme: { ...tooLongReadme.compactReadme, sections: [] },
    featuresDoc: { title: "f", summary: "s", sections: [{ heading: "Implemented Features", content: "nothing here" }] },
  }
  const res2 = await review.review({ artifact: missingStory, state })
  assert.equal(res2.kind, "revise")
  if (res2.kind === "revise") assert.match(res2.feedback, /missing stories/)
})

test("documentation stage produces artifact covering the PRD stories", async () => {
  const stage = new FakeDocumentationStageAdapter(project)
  const state = {
    projectId: project.id,
    prd,
    architecture: {
      project: { id: project.id, name: project.name, description: project.description },
      concept,
      prdSummary: { storyCount: 1, storyIds: ["US-01"] },
      architecture: {
        summary: "sum",
        systemShape: "shape",
        components: [],
        dataModelNotes: [],
        apiNotes: [],
        deploymentNotes: [],
        constraints: [],
        risks: [],
        openQuestions: [],
      },
    },
    implementationPlan: {
      project: { id: project.id, name: project.name },
      conceptSummary: "sum",
      architectureSummary: "sum",
      plan: {
        summary: "p",
        assumptions: [],
        sequencingNotes: [],
        dependencies: [],
        risks: [],
        waves: [
          {
            id: "W1",
            number: 1,
            goal: "g",
            stories: [{ id: "US-01", title: "t" }],
            internallyParallelizable: false,
            dependencies: [],
            exitCriteria: [],
          },
        ],
      },
    },
    executionSummaries: [
      {
        waveId: "W1",
        waveBranch: "wave/demo__p01__w1",
        projectBranch: "proj/demo__p01",
        storiesMerged: [{ storyId: "US-01", branch: "story/p01-us-01", commitCount: 1, filesIntegrated: [] }],
        storiesBlocked: [],
      },
    ],
    projectReview: {
      project: { id: project.id, name: project.name },
      scope: "project-wide-code-review" as const,
      overallStatus: "pass" as const,
      summary: "",
      findings: [],
      recommendations: [],
    },
    revisionCount: 0,
    existingDocs: {},
  }
  const out = await stage.step({ kind: "begin", state: state as never })
  assert.equal(out.kind, "artifact")
  if (out.kind === "artifact") {
    assert.equal(out.artifact.mode, "generate")
    assert.ok(out.artifact.technicalDoc.sections.length >= 1)
    const features = out.artifact.featuresDoc.sections.find(s => s.heading === "Implemented Features")
    assert.ok(features)
    assert.ok(features!.content.includes("US-01"))
  }
})
