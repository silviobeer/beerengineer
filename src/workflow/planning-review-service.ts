import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { architecturePlanOutputSchema, implementationPlanOutputSchema, planningReviewReviewerOutputSchema } from "../schemas/output-contracts.js";
import type { PlanningReviewAdapterRunResult } from "../adapters/types.js";
import type { AdapterRuntimeContext } from "../adapters/types.js";
import type {
  ArchitecturePlan,
  BrainstormDraft,
  BrainstormSession,
  Concept,
  ImplementationPlan,
  PlanningReviewAssumption,
  PlanningReviewAutomationLevel,
  PlanningReviewConfidenceLevel,
  PlanningReviewExecutionMode,
  PlanningReviewFinding,
  PlanningReviewGateEligibility,
  PlanningReviewInteractionMode,
  PlanningReviewMode,
  PlanningReviewProviderRole,
  PlanningReviewQuestion,
  PlanningReviewReadinessResult,
  PlanningReviewRun,
  PlanningReviewSourceType,
  PlanningReviewStatus,
  PlanningReviewStep,
  PlanningReviewSynthesis
} from "../domain/types.js";
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

type PlanningReviewServiceOptions = {
  deps: WorkflowDeps;
  buildAdapterRuntimeContext(input: {
    providerKey: string;
    model: string | null;
    policy: AdapterRuntimeContext["policy"];
  }): AdapterRuntimeContext;
};

type ReviewAssignment = {
  providerKey: string;
  role: PlanningReviewProviderRole;
};

type CapabilityPlan = {
  requestedMode: PlanningReviewExecutionMode;
  actualMode: PlanningReviewExecutionMode;
  assignments: ReviewAssignment[];
  providersUsed: string[];
  missingCapabilities: string[];
  confidence: PlanningReviewConfidenceLevel;
  gateEligibility: PlanningReviewGateEligibility;
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

function fingerprintFinding(input: {
  reviewerRole: PlanningReviewProviderRole;
  type: string;
  title: string;
  detail: string;
}): string {
  return `${input.reviewerRole}::${input.type}::${input.title.trim().toLowerCase()}::${input.detail.trim().toLowerCase()}`;
}

export class PlanningReviewService {
  private readonly providerAvailabilityCache = new Map<string, boolean>();

  public constructor(private readonly options: PlanningReviewServiceOptions) {}

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
    const previousComparableRun = this.options.deps.planningReviewRunRepository.getLatestComparable({
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      step: input.step,
      reviewMode: input.reviewMode
    });
    const previousUnresolvedFindings = previousComparableRun
      ? this.options.deps.planningReviewFindingRepository.listUnresolvedByRunId(previousComparableRun.id)
      : [];
    const previousFingerprintSet = new Set(previousUnresolvedFindings.map((finding) => finding.fingerprint));
    let run: PlanningReviewRun | undefined;

    try {
      run = this.options.deps.runInTransaction(() =>
        this.options.deps.planningReviewRunRepository.create({
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          step: input.step,
          status: "synthesizing",
          interactionMode: input.interactionMode,
          reviewMode: input.reviewMode,
          automationLevel: input.automationLevel ?? "manual",
          requestedMode: capability.requestedMode,
          actualMode: capability.actualMode,
          readiness: null,
          confidence: capability.confidence,
          gateEligibility: capability.gateEligibility,
          normalizedArtifactJson: JSON.stringify(normalization.artifact, null, 2),
          providersUsedJson: JSON.stringify(capability.providersUsed),
          missingCapabilitiesJson: JSON.stringify(capability.missingCapabilities),
          reviewSummary: null,
          failedReason: null
        })
      );
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
        const findings = reviewerResults.flatMap(({ assignment, response }) =>
          response.output.findings.map((finding) => ({
            runId: reviewRun.id,
            reviewerRole: assignment.role,
            findingType: finding.type,
            title: finding.title,
            detail: finding.detail,
            evidence: finding.evidence ?? null,
            status: previousFingerprintSet.has(
              fingerprintFinding({
                reviewerRole: assignment.role,
                type: finding.type,
                title: finding.title,
                detail: finding.detail
              })
            )
              ? ("open" as const)
              : ("new" as const),
            fingerprint: fingerprintFinding({
              reviewerRole: assignment.role,
              type: finding.type,
              title: finding.title,
              detail: finding.detail
            })
          }))
        );
        this.options.deps.planningReviewFindingRepository.createMany(findings);

        if (previousComparableRun) {
          const currentFingerprints = new Set(findings.map((finding) => finding.fingerprint));
          const resolvedFingerprints = previousUnresolvedFindings
            .map((finding) => finding.fingerprint)
            .filter((fingerprint) => !currentFingerprints.has(fingerprint));
          this.options.deps.planningReviewFindingRepository.markResolved(previousComparableRun.id, resolvedFingerprints);
        }

        const synthesis = this.synthesizeReview({
          run: reviewRun,
          interactionMode: input.interactionMode,
          reviewerResults: reviewerResults.map((result) => result.response.output)
        });
        this.options.deps.planningReviewSynthesisRepository.create({
          runId: reviewRun.id,
          summary: synthesis.summary,
          status: synthesis.status,
          readiness: synthesis.readiness,
          keyPointsJson: JSON.stringify(synthesis.keyPoints),
          disagreementsJson: JSON.stringify(synthesis.disagreements),
          recommendedAction: synthesis.recommendedAction
        });

        const questions =
          input.interactionMode === "interactive"
            ? this.options.deps.planningReviewQuestionRepository.createMany(
                synthesis.questions.map((question) => ({
                  runId: reviewRun.id,
                  question: question.question,
                  reason: question.reason,
                  impact: question.impact,
                  status: "open",
                  answer: null,
                  answeredAt: null
                }))
              )
            : [];
        const assumptions = this.options.deps.planningReviewAssumptionRepository.createMany(
          synthesis.assumptions.map((assumption) => ({
            runId: reviewRun.id,
            statement: assumption.statement,
            reason: assumption.reason,
            source: assumption.source
          }))
        );

        this.options.deps.planningReviewRunRepository.update(reviewRun.id, {
          status: synthesis.status,
          readiness: synthesis.readiness,
          reviewSummary: synthesis.summary,
          completedAt: Date.now()
        });

        return this.showReview(reviewRun.id, {
          existingRun: {
            ...reviewRun,
            status: synthesis.status,
            readiness: synthesis.readiness,
            reviewSummary: synthesis.summary,
            completedAt: Date.now()
          },
          existingFindings: findings.map((finding, index) => ({
            id: `transient-${index}`,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            ...finding
          })) as PlanningReviewFinding[],
          existingSynthesis: {
            id: "transient",
            createdAt: Date.now(),
            runId: reviewRun.id,
            summary: synthesis.summary,
            status: synthesis.status,
            readiness: synthesis.readiness,
            keyPointsJson: JSON.stringify(synthesis.keyPoints),
            disagreementsJson: JSON.stringify(synthesis.disagreements),
            recommendedAction: synthesis.recommendedAction
          },
          existingQuestions: questions,
          existingAssumptions: assumptions
        });
      });
    } catch (error) {
      if (run) {
        this.options.deps.planningReviewRunRepository.update(run.id, {
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
    if (run.status === "synthesizing") {
      throw new AppError(
        "PLANNING_REVIEW_RERUN_NOT_ALLOWED",
        `Planning review run ${run.id} is still synthesizing and cannot be rerun yet`
      );
    }
    const answeredQuestions = this.options.deps.planningReviewQuestionRepository
      .listByRunId(runId)
      .filter((question) => question.status === "answered" && question.answer)
      .map((question) => ({
        question: question.question,
        answer: question.answer!
      }));

    return this.startReview({
      sourceType: run.sourceType,
      sourceId: run.sourceId,
      step: run.step,
      reviewMode: run.reviewMode,
      interactionMode: run.interactionMode,
      automationLevel: run.automationLevel,
      clarificationAnswers: answeredQuestions
    });
  }

  public answerQuestion(input: { runId: string; questionId: string; answer: string }) {
    this.requireRun(input.runId);
    const question = this.options.deps.planningReviewQuestionRepository.listByRunId(input.runId).find((entry) => entry.id === input.questionId);
    if (!question) {
      throw new AppError("PLANNING_REVIEW_QUESTION_NOT_FOUND", `Planning review question ${input.questionId} not found`);
    }
    this.options.deps.planningReviewQuestionRepository.answer(input.questionId, input.answer);
    return this.showReview(input.runId);
  }

  public showReview(
    runId: string,
    overrides?: {
      existingRun?: PlanningReviewRun;
      existingFindings?: PlanningReviewFinding[];
      existingSynthesis?: PlanningReviewSynthesis;
      existingQuestions?: PlanningReviewQuestion[];
      existingAssumptions?: PlanningReviewAssumption[];
    }
  ) {
    const run = overrides?.existingRun ?? this.requireRun(runId);
    const findings = overrides?.existingFindings ?? this.options.deps.planningReviewFindingRepository.listByRunId(runId);
    const synthesis = overrides?.existingSynthesis ?? this.options.deps.planningReviewSynthesisRepository.getLatestByRunId(runId);
    const questions = overrides?.existingQuestions ?? this.options.deps.planningReviewQuestionRepository.listByRunId(runId);
    const assumptions = overrides?.existingAssumptions ?? this.options.deps.planningReviewAssumptionRepository.listByRunId(runId);
    const comparisonToPrevious = this.buildComparisonToPrevious(run, findings);
    const openQuestionCount = questions.filter((question) => question.status === "open").length;
    const answeredQuestionCount = questions.filter((question) => question.status === "answered").length;
    return {
      run,
      artifact: JSON.parse(run.normalizedArtifactJson) as NormalizedPlanningArtifact,
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

  private requireRun(runId: string): PlanningReviewRun {
    const run = this.options.deps.planningReviewRunRepository.getById(runId);
    if (!run) {
      throw new AppError("PLANNING_REVIEW_RUN_NOT_FOUND", `Planning review run ${runId} not found`);
    }
    return run;
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

  private resolveCapabilityPlan(reviewMode: PlanningReviewMode): CapabilityPlan {
    const configuredProviders = Object.entries(this.options.deps.agentRuntimeResolver.config.providers).filter(([_, config]) =>
      this.isProviderAvailable(config.adapterKey, config.command[0] ?? null)
    );
    const localProvider = configuredProviders.find(([_, config]) => config.adapterKey === "local-cli")?.[0] ?? null;
    const nonLocalProviders = configuredProviders.filter(([_, config]) => config.adapterKey !== "local-cli");
    const primaryRoles = this.selectRolesForMode(reviewMode);
    const preferredAutonomousProvider = this.options.deps.agentRuntimeResolver.resolveDefault("autonomous");
    const preferDeterministicLocal = preferredAutonomousProvider.adapterKey === "local-cli" && localProvider !== null;
    const providerByAdapterKey = new Map(nonLocalProviders.map(([providerKey, config]) => [config.adapterKey, providerKey]));
    const codexProvider = providerByAdapterKey.get("codex");
    const claudeProvider = providerByAdapterKey.get("claude");
    if (preferDeterministicLocal) {
      return {
        requestedMode: "single_model_multi_role",
        actualMode: "single_model_multi_role",
        assignments: [
          { providerKey: localProvider, role: primaryRoles[0]! },
          { providerKey: localProvider, role: primaryRoles[1]! }
        ],
        providersUsed: [localProvider],
        missingCapabilities: ["independent_second_reviewer"],
        confidence: "reduced",
        gateEligibility: "advisory_only"
      };
    }
    if (codexProvider && claudeProvider) {
      return {
        requestedMode: "full_dual_review",
        actualMode: "full_dual_review",
        assignments: this.assignPreferredDualProviders(primaryRoles, codexProvider, claudeProvider),
        providersUsed: [codexProvider, claudeProvider],
        missingCapabilities: [],
        confidence: "high",
        gateEligibility: "advisory"
      };
    }
    if (nonLocalProviders.length >= 2) {
      return {
        requestedMode: "degraded_dual_review",
        actualMode: "degraded_dual_review",
        assignments: [
          { providerKey: nonLocalProviders[0]![0], role: primaryRoles[0]! },
          { providerKey: nonLocalProviders[1]![0], role: primaryRoles[1]! }
        ],
        providersUsed: [nonLocalProviders[0]![0], nonLocalProviders[1]![0]],
        missingCapabilities: codexProvider || claudeProvider ? [] : ["preferred_codex_claude_pair"],
        confidence: "medium",
        gateEligibility: "advisory"
      };
    }
    if (localProvider) {
      return {
        requestedMode: "single_model_multi_role",
        actualMode: "single_model_multi_role",
        assignments: [
          { providerKey: localProvider, role: primaryRoles[0]! },
          { providerKey: localProvider, role: primaryRoles[1]! }
        ],
        providersUsed: [localProvider],
        missingCapabilities: ["independent_second_reviewer"],
        confidence: "reduced",
        gateEligibility: "advisory_only"
      };
    }
    if (nonLocalProviders.length === 1) {
      return {
        requestedMode: "minimal_review",
        actualMode: "minimal_review",
        assignments: [{ providerKey: nonLocalProviders[0]![0], role: primaryRoles[0]! }],
        providersUsed: [nonLocalProviders[0]![0]],
        missingCapabilities: ["independent_second_reviewer", "cross_role_challenge"],
        confidence: "low",
        gateEligibility: "advisory_only"
      };
    }
    throw new AppError("PLANNING_REVIEW_PROVIDER_UNAVAILABLE", "No planning review provider is configured");
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

  private assignPreferredDualProviders(
    roles: [PlanningReviewProviderRole, PlanningReviewProviderRole],
    codexProvider: string,
    claudeProvider: string
  ): ReviewAssignment[] {
    return roles.map((role) => ({
      providerKey: role === "implementation_reviewer" ? codexProvider : claudeProvider,
      role
    }));
  }

  private isProviderAvailable(adapterKey: string, command: string | null): boolean {
    if (adapterKey === "local-cli") {
      return true;
    }
    if (!command) {
      return false;
    }
    const cacheKey = `${adapterKey}::${command}`;
    const cached = this.providerAvailabilityCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const lookupCommand = process.platform === "win32" ? "where" : "which";
    const result = spawnSync(lookupCommand, [command], { cwd: this.options.deps.workspaceRoot, encoding: "utf8" });
    const available = result.status === 0;
    this.providerAvailabilityCache.set(cacheKey, available);
    return available;
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
    return {
      ...result,
      output: {
        ...parsed.data,
        status: parsed.data.status === "needs_clarification" ? "questions_only" : parsed.data.status
      }
    };
  }

  private synthesizeReview(input: {
    run: PlanningReviewRun;
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
    run: PlanningReviewRun;
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

  private buildComparisonToPrevious(run: PlanningReviewRun, findings: PlanningReviewFinding[]) {
    const previousComparableRun = this.options.deps.planningReviewRunRepository.getPreviousComparable({
      sourceType: run.sourceType,
      sourceId: run.sourceId,
      step: run.step,
      reviewMode: run.reviewMode,
      beforeStartedAt: run.startedAt,
      excludeRunId: run.id
    });
    if (!previousComparableRun) {
      return null;
    }

    const currentArtifact = JSON.parse(run.normalizedArtifactJson) as NormalizedPlanningArtifact;
    const previousArtifact = JSON.parse(previousComparableRun.normalizedArtifactJson) as NormalizedPlanningArtifact;
    const changedFields = this.diffArtifacts(previousArtifact, currentArtifact);
    const previousFindings = this.options.deps.planningReviewFindingRepository.listByRunId(previousComparableRun.id);
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

  private findPlausiblyImpactedFindingTitles(fields: Array<keyof NormalizedPlanningArtifact>, findings: PlanningReviewFinding[]): string[] {
    return normalizeEntries(
      findings
        .filter((finding) => {
          const haystack = `${finding.title} ${finding.detail} ${finding.evidence ?? ""}`.toLowerCase();
          return fields.some((field) => IMPACTED_FINDING_KEYWORD_MAP[field].some((keyword) => haystack.includes(keyword)));
        })
        .map((finding) => finding.title)
    );
  }
}
