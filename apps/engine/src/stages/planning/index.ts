import { runStage } from "../../core/stageRuntime.js"
import { printStageCompletion, stageSummary, summaryArtifactFile } from "../../core/stageHelpers.js"
import { stagePresent } from "../../core/stagePresentation.js"
import { createPlanningReview, createPlanningStage, type RunLlmConfig } from "../../llm/registry.js"
import { enforceWaveParallelism } from "../../core/planValidator.js"
import { renderArchitectureSummary } from "../../render/artifactDigests.js"
import { renderPlanMarkdown } from "../../render/plan.js"
import type { ImplementationPlanArtifact, PRD, WithArchitecture } from "../../types.js"
import type { ReviewAgentAdapter, ReviewAgentResponse } from "../../core/adapters.js"
import type { PlanningState } from "./types.js"

export type PlanningDbRelevanceContext = {
  hasSupabaseConfigured: boolean
}

export type StoryDbRelevanceSupport = {
  supported: boolean
  reason?: string
}

export type DbRelevanceUnsupportedClaim =
  | { level: "story"; waveId: string; storyId: string; reason: string }
  | { level: "wave"; waveId: string; reason: string }

const DB_EVIDENCE_PATTERNS = [
  /\b(?:schema|table|column|index|foreign key|data model|storage|datastore|persisted data|database read|database write|read from (?:the )?(?:database|db)|write to (?:the )?(?:database|db)|query (?:the )?(?:database|db)|sql query|backfill|seed|sqlite|postgres(?:ql)?|mysql|mariadb)\b/i,
  /\b(?:migrat(?:e|ion|ions)|insert(?:ing)? into|upsert(?:ing)?|delete(?:ing)? from|update(?:ing)? (?:the )?(?:database|db|table|row|record)|persist(?:ing|ed)?|store in (?:the )?(?:database|db))\b/i,
  /(?:^|\/)(?:supabase\/migrations|db\/migrations)\//i,
  /\.sql\b/i,
  /\bschema\.prisma\b/i,
]

const MIGRATION_PATH_PATTERNS = [
  /\b(?:migration path|migrat(?:e|ion|ions)|backfill|seed|manual sql|sql script|prisma migrate|prisma migration|drizzle(?:-kit)?|knex|typeorm)\b/i,
]

const DATASTORE_PATTERNS = [
  /\b(?:sqlite|postgres(?:ql)?|mysql|mariadb|database|db|sql|supabase|prisma)\b/i,
]

const STORY_UNSUPPORTED_REASON = "Story marked dbRelevant:true but does not describe concrete database work in the plan output."
const STORY_MISSING_PATH_REASON = "Story marked dbRelevant:true in a workspace without Supabase, but the plan does not name an explicit migration path or equivalent database approach."
const WAVE_UNSUPPORTED_REASON = "Wave marked dbRelevantWave:true but neither the wave nor its supported stories describe concrete database work in the plan output."

export function validatePlanStoryEnvelope(
  waveNumber: number,
  ref: { id?: unknown; title?: unknown; dbRelevant?: unknown; dbRelevanceOverride?: unknown; dbRelevanceOverrideReason?: unknown },
): string | null {
  if (!ref.id || typeof ref.id !== "string") {
    return `Wave ${waveNumber} contains a story without an \`id\` (shape must be {id, title, dbRelevant}).`
  }
  if (typeof ref.dbRelevant !== "boolean") {
    return `Wave ${waveNumber} story "${ref.id}" is missing required boolean \`dbRelevant\`.`
  }
  if (ref.dbRelevanceOverride !== undefined && ref.dbRelevanceOverride !== "not-db-relevant") {
    return `Wave ${waveNumber} story "${ref.id}" has invalid \`dbRelevanceOverride\`.`
  }
  if (ref.dbRelevanceOverride === "not-db-relevant") {
    if (typeof ref.dbRelevanceOverrideReason !== "string" || ref.dbRelevanceOverrideReason.trim().length === 0) {
      return `Wave ${waveNumber} story "${ref.id}" requires non-empty \`dbRelevanceOverrideReason\`.`
    }
  }
  return null
}

function normalizedText(parts: Array<string | undefined | null>): string {
  return parts
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join("\n")
}

function hasAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(text))
}

function hasConcreteDatabaseEvidence(text: string): boolean {
  return hasAnyPattern(text, DB_EVIDENCE_PATTERNS)
}

function hasExplicitMigrationPath(text: string): boolean {
  return hasAnyPattern(text, MIGRATION_PATH_PATTERNS) && hasAnyPattern(text, DATASTORE_PATTERNS)
}

function storyEvidenceText(
  story: NonNullable<ImplementationPlanArtifact["plan"]>["waves"][number]["stories"][number],
): string {
  return normalizedText([
    story.title,
    ...(story.sharedFiles ?? []),
  ])
}

function waveEvidenceText(
  wave: NonNullable<ImplementationPlanArtifact["plan"]>["waves"][number],
): string {
  return normalizedText([
    wave.goal,
    ...(wave.exitCriteria ?? []),
    ...((wave.tasks ?? []).map(task => task.title)),
  ])
}

function waveHasExplicitDatabaseEvidence(
  wave: NonNullable<ImplementationPlanArtifact["plan"]>["waves"][number],
): boolean {
  return hasConcreteDatabaseEvidence(waveEvidenceText(wave))
}

export function evaluateStoryDbRelevanceSupport(input: {
  story: NonNullable<ImplementationPlanArtifact["plan"]>["waves"][number]["stories"][number]
  hasSupabaseConfigured: boolean
}): StoryDbRelevanceSupport {
  const text = storyEvidenceText(input.story)
  if (!hasConcreteDatabaseEvidence(text)) {
    return { supported: false, reason: STORY_UNSUPPORTED_REASON }
  }
  if (!input.hasSupabaseConfigured && !hasExplicitMigrationPath(text)) {
    return { supported: false, reason: STORY_MISSING_PATH_REASON }
  }
  return { supported: true }
}

export function summarizeWaveDbRelevance(
  wave: NonNullable<ImplementationPlanArtifact["plan"]>["waves"][number],
): { dbRelevantStoryCount: number; dbRelevantWave: boolean } {
  const storyList = Array.isArray(wave.stories) ? wave.stories : []
  const dbRelevantStoryCount = storyList.filter(story => story.dbRelevant === true).length
  return {
    dbRelevantStoryCount,
    dbRelevantWave: dbRelevantStoryCount > 0 || waveHasExplicitDatabaseEvidence(wave),
  }
}

export function applyDbRelevanceEvidenceValidation(
  artifact: ImplementationPlanArtifact,
  context: PlanningDbRelevanceContext,
): { artifact: ImplementationPlanArtifact; unsupportedClaims: DbRelevanceUnsupportedClaim[] } {
  const unsupportedClaims: DbRelevanceUnsupportedClaim[] = []

  for (const wave of artifact.plan?.waves ?? []) {
    if (wave.kind === "setup") {
      wave.dbRelevantStoryCount = 0
      wave.dbRelevantWave = false
      continue
    }

    for (const story of wave.stories ?? []) {
      if (story.dbRelevant !== true) continue
      const support = evaluateStoryDbRelevanceSupport({
        story,
        hasSupabaseConfigured: context.hasSupabaseConfigured,
      })
      if (support.supported) continue
      unsupportedClaims.push({
        level: "story",
        waveId: wave.id,
        storyId: story.id,
        reason: support.reason ?? STORY_UNSUPPORTED_REASON,
      })
      story.dbRelevant = false
    }

    const summary = summarizeWaveDbRelevance(wave)
    if (wave.dbRelevantWave === true && !summary.dbRelevantWave) {
      unsupportedClaims.push({
        level: "wave",
        waveId: wave.id,
        reason: WAVE_UNSUPPORTED_REASON,
      })
    }
    wave.dbRelevantStoryCount = summary.dbRelevantStoryCount
    wave.dbRelevantWave = summary.dbRelevantWave
  }

  return { artifact, unsupportedClaims }
}

export function applyDbRelevanceSummaries(artifact: ImplementationPlanArtifact): ImplementationPlanArtifact {
  for (const wave of artifact.plan?.waves ?? []) {
    if (wave.kind === "setup") {
      wave.dbRelevantStoryCount = 0
      wave.dbRelevantWave = false
      continue
    }
    const summary = summarizeWaveDbRelevance(wave)
    wave.dbRelevantStoryCount = summary.dbRelevantStoryCount
    wave.dbRelevantWave = summary.dbRelevantWave
  }
  return artifact
}

function validatePlanStoryIds(artifact: ImplementationPlanArtifact, prd: PRD): string | null {
  applyDbRelevanceSummaries(artifact)
  const prdIds = new Set(prd.stories.map(s => s.id))
  const seen = new Set<string>()
  const issues: string[] = []
  const waves = artifact.plan?.waves
  if (!Array.isArray(waves)) {
    return `Plan is missing a \`plan.waves\` array. The artifact must include \`plan.waves: Array<{id,number,goal,stories,internallyParallelizable,dependencies,exitCriteria}>\`; got \`${JSON.stringify(artifact.plan ?? null).slice(0, 200)}\`.`
  }
  if (waves.length === 0) {
    return `Plan contains zero waves. Every PRD story must belong to exactly one wave; emit at least one wave with the PRD stories assigned.`
  }
  const waveIds = new Set(waves.map(w => w.id))
  const waveIdsBefore = new Map<string, Set<string>>()
  const idsBefore = new Set<string>()
  for (const wave of waves) {
    waveIdsBefore.set(wave.id, new Set(idsBefore))
    idsBefore.add(wave.id)
  }
  for (const wave of waves) {
    validateWaveShape(wave, prdIds, seen, issues)
    validateWaveDependencies(wave, waveIds, waveIdsBefore, issues)
  }
  for (const s of prd.stories) {
    if (!seen.has(s.id)) issues.push(`PRD story "${s.id}" is not assigned to any wave.`)
  }
  return issues.length > 0 ? issues.join(" ") : null
}

function validateWaveShape(
  wave: NonNullable<ImplementationPlanArtifact["plan"]>["waves"][number],
  prdIds: Set<string>,
  seen: Set<string>,
  issues: string[],
): void {
  if ((wave.kind ?? "feature") === "setup") {
    validateSetupWave(wave, issues)
    return
  }
  validateFeatureWave(wave, prdIds, seen, issues)
}

function validateSetupWave(
  wave: NonNullable<ImplementationPlanArtifact["plan"]>["waves"][number],
  issues: string[],
): void {
  const setupTasks = Array.isArray(wave.tasks) ? wave.tasks : []
  if (setupTasks.length === 0) {
    issues.push(`Setup wave ${wave.id ?? wave.number ?? "?"} has zero tasks. Setup waves must use \`tasks\` with at least one setup task.`)
  }
  for (const task of setupTasks) {
    if (!task.id || !task.title) {
      issues.push(`Setup wave ${wave.id} contains a task missing \`id\` or \`title\`.`)
      continue
    }
    validateSetupTask(wave.id, task, issues)
  }
}

function validateSetupTask(waveId: string, task: { id?: string; sharedFiles?: unknown; contract?: unknown }, issues: string[]): void {
  const contract = task.contract as
    | { expectedFiles?: unknown; requiredScripts?: unknown; postChecks?: unknown }
    | undefined
  if (
    !contract ||
    !Array.isArray(contract.expectedFiles) ||
    !Array.isArray(contract.requiredScripts) ||
    !Array.isArray(contract.postChecks)
  ) {
    issues.push(
      `Setup wave ${waveId} task "${task.id}" has malformed \`contract\`; required shape is { expectedFiles: string[], requiredScripts: string[], postChecks: string[] }.`,
    )
  }
  if (!Array.isArray(task.sharedFiles)) {
    issues.push(
      `Setup wave ${waveId} task "${task.id}" is missing \`sharedFiles: string[]\` (use [] when none).`,
    )
  }
}

function validateFeatureWave(
  wave: NonNullable<ImplementationPlanArtifact["plan"]>["waves"][number],
  prdIds: Set<string>,
  seen: Set<string>,
  issues: string[],
): void {
  const storyList = Array.isArray(wave.stories) ? wave.stories : []
  if (storyList.length === 0) {
    issues.push(`Wave ${wave.id ?? wave.number ?? "?"} has zero stories. Every feature wave must contain at least one PRD story.`)
  }
  for (const ref of storyList) {
    validateFeatureStoryRef(wave.number, ref as { id?: string; title?: string }, prdIds, seen, issues)
  }
}

function validateFeatureStoryRef(
  waveNumber: number,
  ref: { id?: string; title?: string; dbRelevant?: unknown },
  prdIds: Set<string>,
  seen: Set<string>,
  issues: string[],
): void {
  const envelopeError = validatePlanStoryEnvelope(waveNumber, ref)
  if (envelopeError) {
    issues.push(envelopeError)
    return
  }
  const id = ref.id
  const title = ref.title
  if (!id || typeof id !== "string") {
    issues.push(`Wave ${waveNumber} contains a story without an \`id\` (shape must be {id, title}).`)
    return
  }
  if (!prdIds.has(id)) {
    const titleSuffix = title ? ` ("${title}")` : ""
    issues.push(`Wave ${waveNumber} references story id "${id}"${titleSuffix} that is not in the PRD. Only PRD story ids are allowed.`)
  }
  if (seen.has(id)) {
    issues.push(`Story id "${id}" appears in more than one wave; each PRD story must appear exactly once.`)
  }
  seen.add(id)
}

function validateWaveDependencies(
  wave: NonNullable<ImplementationPlanArtifact["plan"]>["waves"][number],
  waveIds: Set<string>,
  waveIdsBefore: Map<string, Set<string>>,
  issues: string[],
): void {
  for (const dep of wave.dependencies ?? []) {
    if (typeof dep !== "string" || !/^W\d+$/.test(dep)) {
      issues.push(`Wave ${wave.id} has invalid dependency "${dep}". Dependencies must be an Array<string> of earlier wave ids like "W1" — never prose, never story ids.`)
      continue
    }
    if (!waveIds.has(dep)) {
      issues.push(`Wave ${wave.id} depends on unknown wave "${dep}".`)
    } else if (!waveIdsBefore.get(wave.id)!.has(dep)) {
      issues.push(`Wave ${wave.id} depends on "${dep}" which is not an earlier wave (dependencies must flow forward only).`)
    }
  }
}

function validatingReviewer<S>(
  inner: ReviewAgentAdapter<S, ImplementationPlanArtifact>,
  validate: (artifact: ImplementationPlanArtifact) => string | null,
): ReviewAgentAdapter<S, ImplementationPlanArtifact> {
  return {
    async review(input): Promise<ReviewAgentResponse> {
      if (!input) return inner.review(input)
      const feedback = validate(input.artifact)
      if (feedback) return { kind: "revise", feedback }
      return inner.review(input)
    },
    getSessionId: inner.getSessionId?.bind(inner),
    setSessionId: inner.setSessionId?.bind(inner),
  }
}

export async function planning(ctx: WithArchitecture, llm?: RunLlmConfig): Promise<ImplementationPlanArtifact> {
  stagePresent.header(`planning — ${ctx.project.name}`)

  const { result } = await runStage({
    stageId: "planning",
    stageAgentLabel: "LLM-5 (Planning)",
    reviewerLabel: "Planning-Review-LLM",
    workspaceId: ctx.workspaceId,
    workspaceRoot: ctx.workspaceRoot!,
    runId: ctx.runId,
    createInitialState: (): PlanningState => ({
      projectId: ctx.project.id,
      prd: ctx.prd,
      architectureSummary: renderArchitectureSummary(ctx.architecture),
      codebase: ctx.codebase,
      decisions: ctx.decisions,
      revisionCount: 0,
    }),
    stageAgent: createPlanningStage(ctx.project, llm),
    reviewer: validatingReviewer(createPlanningReview(llm), artifact => validatePlanStoryIds(artifact, ctx.prd)),
    askUser: async () => "",
    async persistArtifacts(run, artifact) {
      applyDbRelevanceEvidenceValidation(artifact, {
        hasSupabaseConfigured: ctx.supabase?.configured === true,
      })
      return [
        {
          kind: "json",
          label: "Implementation Plan JSON",
          fileName: "implementation-plan.json",
          content: JSON.stringify(artifact, null, 2),
        },
        {
          kind: "md",
          label: "Implementation Plan Markdown",
          fileName: "implementation-plan.md",
          content: renderPlanMarkdown(artifact),
        },
        summaryArtifactFile(
          "planning",
          stageSummary(run, [`Waves: ${Array.isArray(artifact.plan?.waves) ? artifact.plan.waves.length : 0}`]),
        ),
      ]
    },
    async onApproved(artifact, run) {
      applyDbRelevanceEvidenceValidation(artifact, {
        hasSupabaseConfigured: ctx.supabase?.configured === true,
      })
      stagePresent.ok("Planning review: implementation plan is ready.")
      // Post-validate: downgrade `internallyParallelizable: true` to
      // false on any wave whose stories share files (or fail to declare
      // sharedFiles, treated as overlap-unknown). Mutates `artifact` in
      // place; emits canonical `wave_serialized` events for audit.
      const decisions = enforceWaveParallelism(artifact, { runId: ctx.runId })
      for (const decision of decisions) {
        const reasonText = decision.cause === "missing_shared_files"
          ? `wave ${decision.waveId}: forced sequential because stories did not declare sharedFiles (overlap unknown)`
          : `wave ${decision.waveId}: forced sequential due to shared-file overlap on ${decision.overlappingFiles.join(", ")}`
        stagePresent.warn(reasonText)
      }
      const waves = Array.isArray(artifact.plan?.waves) ? artifact.plan.waves : []
      waves.forEach(wave => {
        let tag = "(stories run sequentially)"
        if (wave.kind === "setup") tag = "(shared infra setup)"
        else if (wave.internallyParallelizable) tag = "(stories can run in parallel)"
        let entries: Array<{ title: string }> = []
        if (wave.kind === "setup") entries = Array.isArray(wave.tasks) ? wave.tasks : []
        else entries = Array.isArray(wave.stories) ? wave.stories : []
        stagePresent.chat(`Wave ${wave.number} ${tag}`, entries.map(story => story.title).join(", "))
      })
      printStageCompletion(run, "planning")
      return artifact
    },
    maxReviews: 4,
  })

  return result
}
