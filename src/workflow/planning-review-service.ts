import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { architecturePlanOutputSchema, implementationPlanOutputSchema, planningReviewReviewerOutputSchema } from "../schemas/output-contracts.js";
import type { PlanningReviewAdapterRunResult } from "../adapters/types.js";
import type { AdapterRuntimeContext } from "../adapters/types.js";
import type {
  ArchitecturePlan,
  BrainstormDraft,
  Concept,
  ImplementationPlan,
  PlanningReviewAutomationLevel,
  PlanningReviewConfidenceLevel,
  PlanningReviewExecutionMode,
  PlanningReviewGateEligibility,
  PlanningReviewInteractionMode,
  PlanningReviewMode,
  PlanningReviewProviderRole,
  PlanningReviewReadinessResult,
  PlanningReviewSourceType,
  PlanningReviewStatus,
  PlanningReviewStep,
  ReviewAssumption,
  ReviewFinding,
  ReviewQuestion,
  ReviewRun,
  ReviewSynthesis,
  ReviewSourceSystem
} from "../domain/types.js";
import { ReviewExecutionPlanner, type ReviewAssignment, type ReviewCapabilityPlan } from "../review/review-execution-planner.js";
import type { ReviewCoreService } from "../review/review-core-service.js";
import type { WorkflowDeps } from "./workflow-deps.js";
import { AppError } from "../shared/errors.js";

type NormalizedPlanningArtifact = {
  problem: string | null;
  goal: string | null;
  nonGoals: string[];
  context: string[];
  constraints: string[];
  proposal: string | null;
  alternatives: string[];
  assumptions: string[];
  risks: string[];
  openQuestions: string[];
  testPlan: string[];
  rolloutPlan: string[];
  clarificationAnswers: Array<{
    question: string;
    answer: string;
  }>;
};

type PlanningReviewView = {
  run: {
    id: string;
    sourceType: PlanningReviewSourceType;
    sourceId: string;
    step: PlanningReviewStep;
    status: PlanningReviewStatus;
    interactionMode: PlanningReviewInteractionMode | null;
    reviewMode: PlanningReviewMode | null;
    automationLevel: PlanningReviewAutomationLevel;
    requestedMode: string | null;
    actualMode: string | null;
    readiness: string | null;
    confidence: string | null;
    gateEligibility: PlanningReviewGateEligibility;
    reviewSummary: string | null;
    startedAt: number;
    updatedAt: number;
    completedAt: number | null;
    failedReason: string | null;
  };
  artifact: NormalizedPlanningArtifact;
  findings: ReviewFinding[];
  synthesis:
    | (ReviewSynthesis & {
        keyPoints: string[];
        disagreements: string[];
      })
    | null;
  questions: ReviewQuestion[];
  assumptions: ReviewAssumption[];
  questionSummary: {
    totalQuestions: number;
    openQuestions: number;
    answeredQuestions: number;
  };
  comparisonToPrevious: unknown;
};

type PlanningReviewCompletionInput = Parameters<ReviewCoreService["completeReviewRun"]>[1];

type PlanningReviewServiceOptions = {
  deps: WorkflowDeps;
  reviewCoreService: ReviewCoreService;
  buildAdapterRuntimeContext(input: {
    providerKey: string;
    model: string | null;
    policy: AdapterRuntimeContext["policy"];
  }): AdapterRuntimeContext;
};

const HIGH_RISK_PATTERN = /\b(risk|migration|rollback|security|compliance|production|backward compatibility|data loss)\b/i;

const IMPACTED_FINDING_KEYWORD_MAP: Record<keyof NormalizedPlanningArtifact, string[]> = {
  problem: ["problem"],
  goal: ["goal", "outcome", "success"],
  nonGoals: ["non-goal", "scope"],
  context: ["context", "use case"],
  constraints: ["constraint"],
  proposal: ["proposal", "approach", "direction"],
  alternatives: ["alternative"],
  assumptions: ["assumption"],
  risks: ["risk"],
  openQuestions: ["open question", "question"],
  testPlan: ["test", "verification", "validate"],
  rolloutPlan: ["rollout", "deploy", "rollback", "migration"],
  clarificationAnswers: ["clarification", "answer"]
};

function normalizeEntries(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = `${value ?? ""}`.replace(/\s+/g, " ").trim();
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

export class PlanningReviewService {
  private readonly executionPlanner: ReviewExecutionPlanner;

  public constructor(private readonly options: PlanningReviewServiceOptions) {
    this.executionPlanner = new ReviewExecutionPlanner(options.deps.agentRuntimeResolver, options.deps.workspaceRoot);
  }

  public async startReview(input: {
    sourceType: PlanningReviewSourceType;
    sourceId: string;
    step: PlanningReviewStep;
    reviewMode: PlanningReviewMode;
    interactionMode: PlanningReviewInteractionMode;
    automationLevel?: PlanningReviewAutomationLevel;
    clarificationAnswers?: Array<{
      question: string;
      answer: string;
    }>;
  }) {
    const normalization = this.normalizeSource({
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      step: input.step,
      clarificationAnswers: input.clarificationAnswers ?? []
    });
    const capability = this.resolveCapabilityPlan(input.reviewMode);
    let run: ReviewRun | undefined;

    try {
      run = this.options.reviewCoreService.startReviewRun({
        reviewKind: "planning",
        subjectType: input.sourceType,
        subjectId: input.sourceId,
        subjectStep: input.step,
        interactionMode: input.interactionMode,
        reviewMode: input.reviewMode,
        automationLevel: input.automationLevel ?? "manual",
        requestedMode: capability.requestedMode,
        actualMode: capability.actualMode,
        confidence: capability.confidence,
        gateEligibility: capability.gateEligibility,
        sourceSummary: normalization.artifact as Record<string, unknown>,
        providersUsed: capability.providersUsed,
        missingCapabilities: capability.missingCapabilities
      });
      const reviewRun = run;
      const reviewerResults = await Promise.all(
        capability.assignments.map(async (assignment) => {
          const runtime = this.options.deps.agentRuntimeResolver.resolveProvider(assignment.providerKey);
          const response = await runtime.adapter.runPlanningReview({
            runtime: this.options.buildAdapterRuntimeContext(runtime),
            interactionType: "planning_review",
            prompt: this.buildPlanningReviewPrompt({
              role: assignment.role,
              step: input.step,
              reviewMode: input.reviewMode,
              interactionMode: input.interactionMode
            }),
            step: input.step,
            reviewMode: input.reviewMode,
            interactionMode: input.interactionMode,
            reviewerRole: assignment.role,
            source: {
              type: input.sourceType,
              id: input.sourceId
            },
            artifact: normalization.artifact
          });
          return {
            assignment,
            response: this.parseReviewerOutput(response)
          };
        })
      );

      return this.options.deps.runInTransaction(() => {
        const synthesis = this.synthesizeReview({
          run: reviewRun,
          interactionMode: input.interactionMode,
          reviewerResults: reviewerResults.map((result) => result.response.output)
        });
        this.options.reviewCoreService.completeReviewRun(reviewRun.id, {
          ...this.mapPlanningCompletionInput({
            input,
            capability,
            normalization,
            reviewerResults,
            synthesis
          })
        });
        return this.showReview(reviewRun.id);
      });
    } catch (error) {
      if (run) {
        this.options.deps.reviewRunRepository.update(run.id, {
          status: "failed",
          failedReason: error instanceof Error ? error.message : "Unknown planning review failure",
          completedAt: Date.now()
        });
      }
      throw error;
    }
  }

  public async rerunReview(runId: string) {
    const run = this.requireRun(runId);
    if (run.status === "in_progress") {
      throw new AppError(
        "PLANNING_REVIEW_RERUN_NOT_ALLOWED",
        `Planning review run ${run.id} is still synthesizing and cannot be rerun yet`
      );
    }
    const answeredQuestions = this.listAnsweredQuestions(run);

    return this.startReview({
      sourceType: run.subjectType as PlanningReviewSourceType,
      sourceId: run.subjectId,
      step: run.subjectStep as PlanningReviewStep,
      reviewMode: run.reviewMode as PlanningReviewMode,
      interactionMode: (run.interactionMode ?? "interactive") as PlanningReviewInteractionMode,
      automationLevel: run.automationLevel,
      clarificationAnswers: answeredQuestions
    });
  }

  public answerQuestion(input: { runId: string; questionId: string; answer: string }) {
    this.requireRun(input.runId);
    const question = this.options.deps.reviewQuestionRepository.listByRunId(input.runId).find((entry) => entry.id === input.questionId);
    if (!question) {
      throw new AppError("PLANNING_REVIEW_QUESTION_NOT_FOUND", `Planning review question ${input.questionId} not found`);
    }
    this.options.deps.reviewQuestionRepository.answer(input.questionId, input.answer);
    return this.showReview(input.runId);
  }

  public showReview(
    runId: string,
    overrides?: {
      existingRun?: ReviewRun;
      existingFindings?: ReviewFinding[];
      existingSynthesis?: ReviewSynthesis;
      existingQuestions?: ReviewQuestion[];
      existingAssumptions?: ReviewAssumption[];
    }
  ): PlanningReviewView {
    const run = overrides?.existingRun ?? this.requireRun(runId);
    const findings = overrides?.existingFindings ?? this.options.deps.reviewFindingRepository.listByRunId(runId);
    const synthesis = overrides?.existingSynthesis ?? this.options.deps.reviewSynthesisRepository.getLatestByRunId(runId);
    const questions = overrides?.existingQuestions ?? this.options.deps.reviewQuestionRepository.listByRunId(runId);
    const assumptions = overrides?.existingAssumptions ?? this.options.deps.reviewAssumptionRepository.listByRunId(runId);
    const comparisonToPrevious = this.buildComparisonToPrevious(run, findings);
    const openQuestionCount = questions.filter((question) => question.status === "open").length;
    const answeredQuestionCount = questions.filter((question) => question.status === "answered").length;
    return {
      run: this.mapRunToPlanningView(run, findings),
      artifact: JSON.parse(run.sourceSummaryJson) as NormalizedPlanningArtifact,
      findings,
      synthesis: synthesis
        ? {
            ...synthesis,
            keyPoints: JSON.parse(synthesis.keyPointsJson) as string[],
            disagreements: JSON.parse(synthesis.disagreementsJson) as string[]
          }
        : null,
      questions,
      assumptions,
      questionSummary: {
        totalQuestions: questions.length,
        openQuestions: openQuestionCount,
        answeredQuestions: answeredQuestionCount
      },
      comparisonToPrevious
    };
  }

  private mapRunToPlanningView(run: ReviewRun, findings: ReviewFinding[]): PlanningReviewView["run"] {
    return {
      id: run.id,
      sourceType: run.subjectType as PlanningReviewSourceType,
      sourceId: run.subjectId,
      step: run.subjectStep as PlanningReviewStep,
      status: this.mapPlanningStatus(run.status, run.readiness, findings),
      interactionMode: run.interactionMode as PlanningReviewInteractionMode | null,
      reviewMode: run.reviewMode as PlanningReviewMode | null,
      automationLevel: run.automationLevel,
      requestedMode: run.requestedMode,
      actualMode: run.actualMode,
      readiness: run.readiness,
      confidence: run.confidence,
      gateEligibility: run.gateEligibility,
      reviewSummary: run.reviewSummary,
      startedAt: run.startedAt,
      updatedAt: run.updatedAt,
      completedAt: run.completedAt,
      failedReason: run.failedReason
    };
  }

  private mapPlanningCompletionInput(input: {
    input: {
      sourceType: PlanningReviewSourceType;
      sourceId: string;
      step: PlanningReviewStep;
      reviewMode: PlanningReviewMode;
      interactionMode: PlanningReviewInteractionMode;
      automationLevel?: PlanningReviewAutomationLevel;
    };
    capability: ReviewCapabilityPlan<PlanningReviewProviderRole>;
    normalization: { artifact: NormalizedPlanningArtifact };
    reviewerResults: Array<{
      assignment: ReviewAssignment<PlanningReviewProviderRole>;
      response: { output: Awaited<ReturnType<PlanningReviewService["parseReviewerOutput"]>>["output"] };
    }>;
    synthesis: ReturnType<PlanningReviewService["synthesizeReview"]>;
  }): PlanningReviewCompletionInput {
    return {
      status: this.mapCoreStatus(input.synthesis.status),
      readiness: input.synthesis.readiness,
      interactionMode: input.input.interactionMode,
      automationLevel: input.input.automationLevel ?? "manual",
      requestedMode: input.capability.requestedMode,
      actualMode: input.capability.actualMode,
      confidence: input.capability.confidence,
      gateEligibility: input.capability.gateEligibility,
      sourceSummary: input.normalization.artifact as Record<string, unknown>,
      providersUsed: input.capability.providersUsed,
      missingCapabilities: input.capability.missingCapabilities,
      summary: input.synthesis.summary,
      keyPoints: input.synthesis.keyPoints,
      disagreements: input.synthesis.disagreements,
      recommendedAction: input.synthesis.recommendedAction,
      gateDecision: input.synthesis.status === "ready" ? "pass" : input.synthesis.status === "blocked" ? "needs_human_review" : "advisory",
      findings: input.reviewerResults.flatMap(({ assignment, response }) =>
        response.output.findings.map((finding) => ({
          sourceSystem: "planning_review" as ReviewSourceSystem,
          reviewerRole: assignment.role,
          findingType: finding.type,
          normalizedSeverity:
            finding.type === "blocker" ? ("high" as const) : finding.type === "major_concern" ? ("medium" as const) : ("low" as const),
          sourceSeverity: finding.type,
          title: finding.title,
          detail: finding.detail,
          evidence: finding.evidence ?? null,
          filePath: null,
          line: null,
          fieldPath: null
        }))
      ),
      questions:
        input.input.interactionMode === "interactive"
          ? input.synthesis.questions.map((question) => ({
              question: question.question,
              reason: question.reason,
              impact: question.impact,
              status: "open" as const,
              answer: null
            }))
          : [],
      assumptions: input.synthesis.assumptions,
      knowledgeContext: {
        workspaceId: this.options.deps.workspace.id,
        projectId: this.resolveProjectIdForSource(input.input.sourceType, input.input.sourceId),
        waveId: null,
        storyId: null
      }
    };
  }

  private requireRun(runId: string): ReviewRun {
    const run = this.options.deps.reviewRunRepository.getById(runId);
    if (!run || run.reviewKind !== "planning") {
      throw new AppError("PLANNING_REVIEW_RUN_NOT_FOUND", `Planning review run ${runId} not found`);
    }
    return run;
  }

  private listAnsweredQuestions(run: ReviewRun) {
    return this.options.deps.reviewQuestionRepository
      .listByRunId(run.id)
      .filter((question) => question.status === "answered" && question.answer)
      .map((question) => ({
        question: question.question,
        answer: question.answer!
      }));
  }

  private resolveProjectIdForSource(sourceType: PlanningReviewSourceType, sourceId: string): string | null {
    switch (sourceType) {
      case "architecture_plan":
        return this.options.deps.architecturePlanRepository.getById(sourceId)?.projectId ?? null;
      case "implementation_plan":
        return this.options.deps.implementationPlanRepository.getById(sourceId)?.projectId ?? null;
      case "interactive_review_session": {
        const session = this.options.deps.interactiveReviewSessionRepository.getById(sourceId);
        if (!session) {
          return null;
        }
        if (session.scopeType === "project") {
          return session.scopeId;
        }
        if (session.artifactType === "architecture" || session.artifactType === "implementation_plan") {
          return this.resolveProjectIdForSource(
            session.artifactType === "architecture" ? "architecture_plan" : "implementation_plan",
            session.scopeId
          );
        }
        return null;
      }
      default:
        return null;
    }
  }

  private normalizeSource(input: {
    sourceType: PlanningReviewSourceType;
    sourceId: string;
    step: PlanningReviewStep;
    clarificationAnswers: Array<{
      question: string;
      answer: string;
    }>;
  }): { artifact: NormalizedPlanningArtifact } {
    switch (input.sourceType) {
      case "brainstorm_session":
        return { artifact: this.normalizeBrainstormSession(input.sourceId, input.clarificationAnswers) };
      case "brainstorm_draft":
        return { artifact: this.normalizeBrainstormDraftSource(input.sourceId, input.clarificationAnswers) };
      case "interactive_review_session":
        return { artifact: this.normalizeInteractiveReviewSession(input.sourceId, input.clarificationAnswers) };
      case "concept":
        return { artifact: this.normalizeConcept(input.sourceId, input.clarificationAnswers) };
      case "architecture_plan":
        return { artifact: this.normalizeArchitecturePlan(input.sourceId, input.clarificationAnswers) };
      case "implementation_plan":
        return { artifact: this.normalizeImplementationPlan(input.sourceId, input.clarificationAnswers) };
      default:
        throw new AppError(
          "PLANNING_REVIEW_SOURCE_NOT_SUPPORTED",
          `Planning review source type ${input.sourceType} is not supported yet`
        );
    }
  }

  private normalizeBrainstormSession(
    sessionId: string,
    clarificationAnswers: NormalizedPlanningArtifact["clarificationAnswers"]
  ): NormalizedPlanningArtifact {
    const session = this.options.deps.brainstormSessionRepository.getById(sessionId);
    if (!session) {
      throw new AppError("BRAINSTORM_SESSION_NOT_FOUND", `Brainstorm session ${sessionId} not found`);
    }
    const draft = this.options.deps.brainstormDraftRepository.getLatestBySessionId(session.id);
    if (!draft) {
      throw new AppError("BRAINSTORM_DRAFT_NOT_FOUND", `No brainstorm draft found for ${session.id}`);
    }
    return this.normalizeFromBrainstormDraft(draft, clarificationAnswers);
  }

  private normalizeBrainstormDraftSource(
    draftId: string,
    clarificationAnswers: NormalizedPlanningArtifact["clarificationAnswers"]
  ): NormalizedPlanningArtifact {
    const draft = this.options.deps.brainstormDraftRepository.getById(draftId);
    if (!draft) {
      throw new AppError("BRAINSTORM_DRAFT_NOT_FOUND", `Brainstorm draft ${draftId} not found`);
    }
    return this.normalizeFromBrainstormDraft(draft, clarificationAnswers);
  }

  private normalizeInteractiveReviewSession(
    sessionId: string,
    clarificationAnswers: NormalizedPlanningArtifact["clarificationAnswers"]
  ): NormalizedPlanningArtifact {
    const session = this.options.deps.interactiveReviewSessionRepository.getById(sessionId);
    if (!session) {
      throw new AppError("INTERACTIVE_REVIEW_SESSION_NOT_FOUND", `Interactive review session ${sessionId} not found`);
    }
    if (session.artifactType === "concept" && session.scopeType === "concept") {
      return this.normalizeConcept(session.scopeId, clarificationAnswers);
    }
    if (session.artifactType === "architecture") {
      return this.normalizeArchitecturePlan(session.scopeId, clarificationAnswers);
    }
    if (session.artifactType === "implementation_plan") {
      return this.normalizeImplementationPlan(session.scopeId, clarificationAnswers);
    }
    if (session.artifactType === "stories" && session.scopeType === "project") {
      const project = this.options.deps.projectRepository.getById(session.scopeId);
      if (!project) {
        throw new AppError("PROJECT_NOT_FOUND", `Project ${session.scopeId} not found`);
      }
      const entries = this.options.deps.interactiveReviewEntryRepository.listBySessionId(session.id);
      return {
        problem: project.summary,
        goal: project.goal,
        nonGoals: [],
        context: normalizeEntries(entries.map((entry) => entry.title)),
        constraints: [],
        proposal: entries.filter((entry) => entry.status === "accepted").map((entry) => entry.title).join("; ") || null,
        alternatives: [],
        assumptions: [],
        risks: normalizeEntries(entries.filter((entry) => entry.status === "needs_revision").map((entry) => entry.summary ?? entry.changeRequest)),
        openQuestions: normalizeEntries(
          entries
            .filter((entry) => entry.status === "pending")
            .map((entry) => entry.summary ?? entry.changeRequest ?? `Resolve review state for ${entry.title}`)
        ),
        testPlan: [],
        rolloutPlan: [],
        clarificationAnswers
      };
    }
    throw new AppError(
      "PLANNING_REVIEW_SOURCE_NOT_SUPPORTED",
      `Interactive review session ${session.id} with artifactType ${session.artifactType} is not supported for planning review`
    );
  }

  private normalizeConcept(conceptId: string, clarificationAnswers: NormalizedPlanningArtifact["clarificationAnswers"]): NormalizedPlanningArtifact {
    const concept = this.options.deps.conceptRepository.getById(conceptId);
    if (!concept) {
      throw new AppError("CONCEPT_NOT_FOUND", `Concept ${conceptId} not found`);
    }
    const item = this.options.deps.itemRepository.getById(concept.itemId);
    if (!item) {
      throw new AppError("ITEM_NOT_FOUND", `Item ${concept.itemId} not found`);
    }
    return {
      problem: item.description || item.title,
      goal: concept.summary,
      nonGoals: [],
      context: normalizeEntries([`Item ${item.code}: ${item.title}`]),
      constraints: [],
      proposal: null,
      alternatives: [],
      assumptions: [],
      risks: [],
      openQuestions: [],
      testPlan: [],
      rolloutPlan: [],
      clarificationAnswers
    };
  }

  private normalizeArchitecturePlan(
    architecturePlanId: string,
    clarificationAnswers: NormalizedPlanningArtifact["clarificationAnswers"]
  ): NormalizedPlanningArtifact {
    const plan = this.options.deps.architecturePlanRepository.getById(architecturePlanId);
    if (!plan) {
      throw new AppError("ARCHITECTURE_PLAN_NOT_FOUND", `Architecture plan ${architecturePlanId} not found`);
    }
    const project = this.options.deps.projectRepository.getById(plan.projectId);
    if (!project) {
      throw new AppError("PROJECT_NOT_FOUND", `Project ${plan.projectId} not found`);
    }
    const parsed = architecturePlanOutputSchema.parse(this.readArtifactJson(plan.structuredArtifactId));
    return {
      problem: project.summary,
      goal: project.goal,
      nonGoals: [],
      context: normalizeEntries([`Project ${project.code}: ${project.title}`, parsed.summary]),
      constraints: [],
      proposal: parsed.decisions.join("; "),
      alternatives: [],
      assumptions: [],
      risks: parsed.risks,
      openQuestions: [],
      testPlan: parsed.nextSteps.filter((step) => /test|verify|validation/i.test(step)),
      rolloutPlan: parsed.nextSteps.filter((step) => /rollout|deploy|migration/i.test(step)),
      clarificationAnswers
    };
  }

  private normalizeImplementationPlan(
    implementationPlanId: string,
    clarificationAnswers: NormalizedPlanningArtifact["clarificationAnswers"]
  ): NormalizedPlanningArtifact {
    const plan = this.options.deps.implementationPlanRepository.getById(implementationPlanId);
    if (!plan) {
      throw new AppError("IMPLEMENTATION_PLAN_NOT_FOUND", `Implementation plan ${implementationPlanId} not found`);
    }
    const project = this.options.deps.projectRepository.getById(plan.projectId);
    if (!project) {
      throw new AppError("PROJECT_NOT_FOUND", `Project ${plan.projectId} not found`);
    }
    const parsed = implementationPlanOutputSchema.parse(this.readArtifactJson(plan.structuredArtifactId));
    return {
      problem: project.summary,
      goal: parsed.summary,
      nonGoals: [],
      context: normalizeEntries([
        `Project ${project.code}: ${project.title}`,
        ...parsed.waves.map((wave) => `${wave.waveCode}: ${wave.goal}`)
      ]),
      constraints: [],
      proposal: parsed.summary,
      alternatives: [],
      assumptions: parsed.assumptions,
      risks: parsed.risks,
      openQuestions: [],
      testPlan: [],
      rolloutPlan: [],
      clarificationAnswers
    };
  }

  private normalizeFromBrainstormDraft(
    draft: BrainstormDraft,
    clarificationAnswers: NormalizedPlanningArtifact["clarificationAnswers"]
  ): NormalizedPlanningArtifact {
    const candidateDirections = JSON.parse(draft.candidateDirectionsJson) as string[];
    return {
      problem: draft.problem,
      goal: draft.coreOutcome,
      nonGoals: JSON.parse(draft.nonGoalsJson) as string[],
      context: JSON.parse(draft.useCasesJson) as string[],
      constraints: JSON.parse(draft.constraintsJson) as string[],
      proposal: draft.recommendedDirection ?? draft.scopeNotes,
      alternatives: candidateDirections.filter((direction) => direction !== draft.recommendedDirection),
      assumptions: JSON.parse(draft.assumptionsJson) as string[],
      risks: JSON.parse(draft.risksJson) as string[],
      openQuestions: JSON.parse(draft.openQuestionsJson) as string[],
      testPlan: [],
      rolloutPlan: [],
      clarificationAnswers
    };
  }

  private readArtifactJson(artifactId: string): unknown {
    const artifact = this.options.deps.artifactRepository.getById(artifactId);
    if (!artifact) {
      throw new AppError("ARTIFACT_NOT_FOUND", `Artifact ${artifactId} not found`);
    }
    const absolutePath = resolve(this.options.deps.artifactRoot, artifact.path);
    return JSON.parse(readFileSync(absolutePath, "utf8")) as unknown;
  }

  private resolveCapabilityPlan(reviewMode: PlanningReviewMode): ReviewCapabilityPlan<PlanningReviewProviderRole> {
    const primaryRoles = this.selectRolesForMode(reviewMode);
    return this.executionPlanner.planDualRoleReview({
      roles: primaryRoles,
      preferCodexFor: ["implementation_reviewer"],
      preferClaudeFor: ["architecture_challenger", "decision_auditor", "product_skeptic"],
      unavailableCode: "PLANNING_REVIEW_PROVIDER_UNAVAILABLE"
    });
  }

  private selectRolesForMode(reviewMode: PlanningReviewMode): [PlanningReviewProviderRole, PlanningReviewProviderRole] {
    switch (reviewMode) {
      case "critique":
        return ["implementation_reviewer", "architecture_challenger"];
      case "risk":
        return ["implementation_reviewer", "decision_auditor"];
      case "alternatives":
        return ["architecture_challenger", "product_skeptic"];
      case "readiness":
      default:
        return ["implementation_reviewer", "decision_auditor"];
    }
  }

  private buildPlanningReviewPrompt(input: {
    role: PlanningReviewProviderRole;
    step: PlanningReviewStep;
    reviewMode: PlanningReviewMode;
    interactionMode: PlanningReviewInteractionMode;
  }): string {
    return [
      "You are assisting a BeerEngineer planning review run.",
      `Role: ${input.role}`,
      `Step: ${input.step}`,
      `Review mode: ${input.reviewMode}`,
      `Interaction mode: ${input.interactionMode}`,
      "Return only the structured review output.",
      "Ground every finding in the provided normalized artifact.",
      "Prefer blocker and major_concern findings over generic prose.",
      "Use question findings only for decision-relevant missing information.",
      "Do not invent implementation details that are absent from the artifact."
    ].join("\n");
  }

  private parseReviewerOutput(result: PlanningReviewAdapterRunResult): PlanningReviewAdapterRunResult {
    const parsed = planningReviewReviewerOutputSchema.safeParse(result.output);
    if (!parsed.success) {
      throw new AppError("PLANNING_REVIEW_OUTPUT_INVALID", parsed.error.message);
    }
    const normalizedStatus = (() => {
      switch (parsed.data.status) {
        case "needs_clarification":
        case "needs_evidence":
          return "questions_only" as const;
        case "ready_with_assumptions":
          return "ready" as const;
        case "needs_human_review":
        case "high_risk":
          return "blocked" as const;
        default:
          return parsed.data.status;
      }
    })();
    return {
      ...result,
      output: {
        ...parsed.data,
        status: normalizedStatus
      }
    };
  }

  private synthesizeReview(input: {
    run: ReviewRun;
    interactionMode: PlanningReviewInteractionMode;
    reviewerResults: Array<PlanningReviewAdapterRunResult["output"]>;
  }): {
    status: PlanningReviewStatus;
    readiness: PlanningReviewReadinessResult;
    summary: string;
    keyPoints: string[];
    disagreements: string[];
    recommendedAction: string;
    questions: Array<{
      question: string;
      reason: string;
      impact: string;
    }>;
    assumptions: Array<{
      statement: string;
      reason: string;
      source: string;
    }>;
  } {
    const findings = input.reviewerResults.flatMap((result) => result.findings);
    const uniqueFindingTitles = normalizeEntries(findings.map((finding) => finding.title));
    const blockerCount = findings.filter((finding) => finding.type === "blocker").length;
    const majorConcernCount = findings.filter((finding) => finding.type === "major_concern").length;
    const assumptions = normalizeEntries(input.reviewerResults.flatMap((result) => result.assumptionsDetected)).map((statement) => ({
      statement,
      reason: "Detected during reviewer analysis",
      source: "reviewer"
    }));
    const reviewerReadinessValues = Array.from(new Set(input.reviewerResults.map((result) => result.readiness)));
    const reviewerStatusValues = Array.from(new Set(input.reviewerResults.map((result) => result.status)));
    const disagreements = normalizeEntries(
      [
        ...(input.reviewerResults.length > 1 && reviewerReadinessValues.length > 1
          ? [`Reviewers disagree on readiness: ${reviewerReadinessValues.join(", ")}`]
          : []),
        ...(input.reviewerResults.length > 1 && reviewerStatusValues.length > 1
          ? [`Reviewers disagree on review status: ${reviewerStatusValues.join(", ")}`]
          : [])
      ]
    );
    const questions = this.buildClarificationQuestions(input.reviewerResults);

    if (input.interactionMode === "auto" && questions.length > 0) {
      assumptions.push(
        ...questions.map((question) => ({
          statement: `Auto-mode unresolved question: ${question.question}`,
          reason: question.reason,
          source: "auto_mode_fallback"
        }))
      );
    }

    const autoNeedsHumanReview = this.autoModeNeedsHumanReview({
      run: input.run,
      findings,
      reviewerResults: input.reviewerResults,
      questions
    });
    const autoBlockedByRisk =
      input.interactionMode === "auto" &&
      (autoNeedsHumanReview || (majorConcernCount > 0 && input.run.reviewMode === "risk"));

    const status: PlanningReviewStatus =
      blockerCount > 0
        ? input.interactionMode === "interactive"
          ? "blocker_present"
          : "blocked"
        : autoBlockedByRisk
          ? "blocked"
        : questions.length > 0
          ? input.interactionMode === "interactive"
            ? "questions_only"
            : "revising"
          : "ready";
    const readiness: PlanningReviewReadinessResult =
      blockerCount > 0
        ? input.interactionMode === "interactive"
          ? "needs_evidence"
          : "needs_human_review"
        : autoBlockedByRisk
          ? "needs_human_review"
        : questions.length > 0
          ? input.interactionMode === "interactive"
            ? "needs_evidence"
            : autoNeedsHumanReview
              ? "needs_human_review"
              : "ready_with_assumptions"
          : assumptions.length > 0
            ? "ready_with_assumptions"
            : "ready";
    const summary =
      status === "ready"
        ? "Planning review completed without blocker-level gaps."
        : status === "blocker_present"
          ? "Planning review found blocking gaps that must be resolved before the artifact can proceed."
          : status === "questions_only"
            ? "Planning review found clarification questions, but no hard blockers."
          : status === "blocked"
            ? "Planning review could not continue safely in auto mode."
            : "Planning review completed with follow-up work still required.";
    return {
      status,
      readiness,
      summary,
      keyPoints: uniqueFindingTitles.slice(0, 7),
      disagreements,
      recommendedAction:
        status === "ready"
          ? "Proceed to the next workflow step."
          : status === "blocker_present"
            ? "Resolve the blocking gaps, answer the linked questions, and rerun the review."
            : status === "questions_only"
              ? "Answer the open planning review questions and rerun the review."
            : status === "blocked"
              ? "Escalate to a human reviewer or strengthen the source artifact before proceeding."
              : "Revise the source artifact and rerun the review.",
      questions: input.interactionMode === "interactive" ? questions : [],
      assumptions
    };
  }

  private autoModeNeedsHumanReview(input: {
    run: ReviewRun;
    findings: PlanningReviewAdapterRunResult["output"]["findings"];
    reviewerResults: Array<PlanningReviewAdapterRunResult["output"]>;
    questions: Array<{ question: string; reason: string; impact: string }>;
  }): boolean {
    if (input.run.interactionMode !== "auto") {
      return false;
    }
    if (input.reviewerResults.some((result) => result.readiness === "needs_human_review" || result.readiness === "high_risk")) {
      return true;
    }
    if (input.findings.some((finding) => HIGH_RISK_PATTERN.test(`${finding.title} ${finding.detail} ${finding.evidence ?? ""}`))) {
      return true;
    }
    if (input.run.reviewMode === "risk" && (input.questions.length > 0 || input.findings.some((finding) => finding.type === "major_concern"))) {
      return true;
    }
    if (input.run.reviewMode === "readiness" && input.questions.length > 1) {
      return true;
    }
    return false;
  }

  private buildClarificationQuestions(
    reviewerResults: Array<PlanningReviewAdapterRunResult["output"]>
  ): Array<{
    question: string;
    reason: string;
    impact: string;
  }> {
    const candidates = new Map<
      string,
      {
        question: string;
        reason: string;
        impact: string;
        priority: number;
      }
    >();

    const upsertCandidate = (input: {
      question: string;
      reason: string;
      impact: string;
      priority: number;
    }) => {
      const normalizedQuestion = input.question.replace(/\s+/g, " ").trim();
      if (!normalizedQuestion) {
        return;
      }
      const key = normalizedQuestion.toLowerCase();
      const existing = candidates.get(key);
      if (!existing || input.priority > existing.priority) {
        candidates.set(key, {
          question: normalizedQuestion,
          reason: input.reason.trim() || "The review found a missing decision-relevant detail.",
          impact: input.impact.trim() || "Without this clarification, readiness remains reduced.",
          priority: input.priority
        });
      }
    };

    for (const result of reviewerResults) {
      const primaryBlocker = result.findings.find((finding) => finding.type === "blocker") ?? null;
      result.missingInformation.forEach((question) => {
        upsertCandidate({
          question,
          reason: primaryBlocker?.detail ?? "The review surfaced a blocker-level information gap.",
          impact:
            primaryBlocker?.evidence ??
            "Without this answer, the review cannot confirm the artifact is safe to proceed.",
          priority: primaryBlocker ? 300 : 100
        });
      });

      for (const finding of result.findings) {
        if (finding.type !== "question") {
          continue;
        }
        upsertCandidate({
          question: finding.title,
          reason: finding.detail,
          impact: finding.evidence ?? "Without this clarification, readiness remains reduced.",
          priority: 200
        });
      }
    }

    return Array.from(candidates.values())
      .sort((left, right) => right.priority - left.priority || left.question.localeCompare(right.question))
      .map(({ question, reason, impact }) => ({
        question,
        reason,
        impact
      }));
  }

  private buildComparisonToPrevious(run: ReviewRun, findings: ReviewFinding[]) {
    const previousComparableRun = this.options.deps.reviewRunRepository.getPreviousComparable({
      reviewKind: "planning",
      subjectType: run.subjectType,
      subjectId: run.subjectId,
      subjectStep: run.subjectStep,
      reviewMode: run.reviewMode,
      beforeStartedAt: run.startedAt,
      excludeRunId: run.id
    });
    if (!previousComparableRun) {
      return null;
    }

    const currentArtifact = JSON.parse(run.sourceSummaryJson) as NormalizedPlanningArtifact;
    const previousArtifact = JSON.parse(previousComparableRun.sourceSummaryJson) as NormalizedPlanningArtifact;
    const changedFields = this.diffArtifacts(previousArtifact, currentArtifact);
    const previousFindings = this.options.deps.reviewFindingRepository.listByRunId(previousComparableRun.id);
    const impactedFindingTitles = this.findPlausiblyImpactedFindingTitles(
      changedFields.map((entry) => entry.field),
      [...previousFindings, ...findings]
    );

    return {
      previousRunId: previousComparableRun.id,
      changedFields,
      changedFieldCount: changedFields.length,
      findingDelta: {
        newCount: findings.filter((finding) => finding.status === "new").length,
        openCount: findings.filter((finding) => finding.status === "open").length,
        resolvedCount: previousFindings.filter(
          (finding) => !findings.some((currentFinding) => currentFinding.fingerprint === finding.fingerprint)
        ).length
      },
      plausiblyImpactedFindingTitles: impactedFindingTitles
    };
  }

  private diffArtifacts(previousArtifact: NormalizedPlanningArtifact, currentArtifact: NormalizedPlanningArtifact) {
    const changedFields: Array<{
      field: keyof NormalizedPlanningArtifact;
      previousValue: string;
      currentValue: string;
    }> = [];

    const fields: Array<keyof NormalizedPlanningArtifact> = [
      "problem",
      "goal",
      "nonGoals",
      "context",
      "constraints",
      "proposal",
      "alternatives",
      "assumptions",
      "risks",
      "openQuestions",
      "testPlan",
      "rolloutPlan",
      "clarificationAnswers"
    ];

    for (const field of fields) {
      const previousValue = this.stringifyArtifactField(previousArtifact[field]);
      const currentValue = this.stringifyArtifactField(currentArtifact[field]);
      if (previousValue !== currentValue) {
        changedFields.push({
          field,
          previousValue,
          currentValue
        });
      }
    }

    return changedFields;
  }

  private stringifyArtifactField(value: NormalizedPlanningArtifact[keyof NormalizedPlanningArtifact]): string {
    if (value === null) {
      return "";
    }
    if (typeof value === "string") {
      return value.trim();
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return "";
      }
      if (typeof value[0] === "string") {
        return normalizeEntries(value as string[]).join("; ");
      }
      return (value as Array<{ question: string; answer: string }>)
        .map((entry) => `${entry.question.trim()} => ${entry.answer.trim()}`)
        .join("; ");
    }
    return "";
  }

  private findPlausiblyImpactedFindingTitles(fields: Array<keyof NormalizedPlanningArtifact>, findings: ReviewFinding[]): string[] {
    return normalizeEntries(
      findings
        .filter((finding) => {
          const haystack = `${finding.title} ${finding.detail} ${finding.evidence ?? ""}`.toLowerCase();
          return fields.some((field) => IMPACTED_FINDING_KEYWORD_MAP[field].some((keyword) => haystack.includes(keyword)));
        })
        .map((finding) => finding.title)
    );
  }

  private mapCoreStatus(status: PlanningReviewStatus) {
    switch (status) {
      case "synthesizing":
        return "in_progress" as const;
      case "ready":
        return "complete" as const;
      case "blocked":
        return "blocked" as const;
      case "failed":
        return "failed" as const;
      default:
        return "action_required" as const;
    }
  }

  private mapPlanningStatus(
    status: ReviewRun["status"],
    readiness: ReviewRun["readiness"],
    findings: ReviewFinding[]
  ): PlanningReviewStatus {
    switch (status) {
      case "in_progress":
        return "synthesizing";
      case "complete":
        return "ready";
      case "blocked":
        return "blocked";
      case "failed":
        return "failed";
      case "action_required":
      default:
        if (findings.some((finding) => finding.findingType === "blocker")) {
          return "blocker_present";
        }
        return readiness === "needs_human_review" ? "blocked" : readiness === "needs_evidence" ? "questions_only" : "revising";
    }
  }
}
