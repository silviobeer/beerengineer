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
  PlanningReviewExecutionMode,
  PlanningReviewFinding,
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
  public constructor(private readonly options: PlanningReviewServiceOptions) {}

  public async startReview(input: {
    sourceType: PlanningReviewSourceType;
    sourceId: string;
    step: PlanningReviewStep;
    reviewMode: PlanningReviewMode;
    interactionMode: PlanningReviewInteractionMode;
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
    const capability = this.resolveCapabilityPlan();
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
      assumptions
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

  private resolveCapabilityPlan(): {
    requestedMode: PlanningReviewExecutionMode;
    actualMode: PlanningReviewExecutionMode;
    assignments: ReviewAssignment[];
    providersUsed: string[];
    missingCapabilities: string[];
    confidence: string;
    gateEligibility: string;
  } {
    const configuredProviders = Object.entries(this.options.deps.agentRuntimeResolver.config.providers).filter(([_, config]) =>
      this.isProviderAvailable(config.adapterKey, config.command[0] ?? null)
    );
    const localProvider = configuredProviders.find(([_, config]) => config.adapterKey === "local-cli")?.[0];
    if (localProvider) {
      return {
        requestedMode: "single_model_multi_role",
        actualMode: "single_model_multi_role",
        assignments: [
          { providerKey: localProvider, role: "implementation_reviewer" },
          { providerKey: localProvider, role: "decision_auditor" }
        ],
        providersUsed: [localProvider],
        missingCapabilities: ["independent_second_reviewer"],
        confidence: "reduced",
        gateEligibility: "advisory_only"
      };
    }
    const providerByAdapterKey = new Map(configuredProviders.map(([providerKey, config]) => [config.adapterKey, providerKey]));
    const codexProvider = providerByAdapterKey.get("codex");
    const claudeProvider = providerByAdapterKey.get("claude");
    if (codexProvider && claudeProvider) {
      return {
        requestedMode: "full_dual_review",
        actualMode: "full_dual_review",
        assignments: [
          { providerKey: codexProvider, role: "implementation_reviewer" },
          { providerKey: claudeProvider, role: "architecture_challenger" }
        ],
        providersUsed: [codexProvider, claudeProvider],
        missingCapabilities: [],
        confidence: "high",
        gateEligibility: "advisory"
      };
    }
    if (configuredProviders.length >= 2) {
      return {
        requestedMode: "degraded_dual_review",
        actualMode: "degraded_dual_review",
        assignments: [
          { providerKey: configuredProviders[0]![0], role: "implementation_reviewer" },
          { providerKey: configuredProviders[1]![0], role: "decision_auditor" }
        ],
        providersUsed: [configuredProviders[0]![0], configuredProviders[1]![0]],
        missingCapabilities: codexProvider || claudeProvider ? [] : ["preferred_codex_claude_pair"],
        confidence: "medium",
        gateEligibility: "advisory"
      };
    }
    if (configuredProviders.length >= 1) {
      return {
        requestedMode: "single_model_multi_role",
        actualMode: "single_model_multi_role",
        assignments: [
          { providerKey: configuredProviders[0]![0], role: "implementation_reviewer" },
          { providerKey: configuredProviders[0]![0], role: "decision_auditor" }
        ],
        providersUsed: [configuredProviders[0]![0]],
        missingCapabilities: ["independent_second_reviewer"],
        confidence: "reduced",
        gateEligibility: "advisory_only"
      };
    }
    throw new AppError("PLANNING_REVIEW_PROVIDER_UNAVAILABLE", "No planning review provider is configured");
  }

  private isProviderAvailable(adapterKey: string, command: string | null): boolean {
    if (adapterKey === "local-cli") {
      return true;
    }
    if (!command) {
      return false;
    }
    const result = spawnSync("which", [command], { cwd: this.options.deps.workspaceRoot, encoding: "utf8" });
    return result.status === 0;
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
      output: parsed.data
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
    const uniqueFindingTitles = normalizeEntries(
      input.reviewerResults.flatMap((result) => result.findings.map((finding) => finding.title))
    );
    const blockerCount = input.reviewerResults.flatMap((result) => result.findings).filter((finding) => finding.type === "blocker").length;
    const questionFindings = input.reviewerResults.flatMap((result) => result.findings).filter((finding) => finding.type === "question");
    const assumptions = normalizeEntries(input.reviewerResults.flatMap((result) => result.assumptionsDetected)).map((statement) => ({
      statement,
      reason: "Detected during reviewer analysis",
      source: "reviewer"
    }));
    const disagreements = normalizeEntries(
      input.reviewerResults.length > 1 &&
        new Set(input.reviewerResults.map((result) => result.readiness)).size > 1
        ? [
            `Reviewers disagree on readiness: ${Array.from(new Set(input.reviewerResults.map((result) => result.readiness))).join(", ")}`
          ]
        : []
    );
    const questions = normalizeEntries(
      questionFindings.map((finding) => finding.title).concat(input.reviewerResults.flatMap((result) => result.missingInformation))
    )
      .slice(0, 3)
      .map((question) => ({
        question,
        reason: "The review surfaced a blocker-relevant information gap.",
        impact: "Without this answer, readiness remains reduced."
      }));

    if (input.interactionMode === "auto" && questions.length > 0) {
      assumptions.push(
        ...questions.map((question) => ({
          statement: `Auto-mode unresolved question: ${question.question}`,
          reason: question.reason,
          source: "auto_mode_fallback"
        }))
      );
    }

    const status: PlanningReviewStatus =
      blockerCount > 0
        ? input.interactionMode === "interactive"
          ? "needs_clarification"
          : "blocked"
        : questions.length > 0
          ? input.interactionMode === "interactive"
            ? "needs_clarification"
            : "revising"
          : "ready";
    const readiness: PlanningReviewReadinessResult =
      blockerCount > 0
        ? input.interactionMode === "interactive"
          ? "needs_evidence"
          : "needs_human_review"
        : questions.length > 0
          ? input.interactionMode === "interactive"
            ? "needs_evidence"
            : "ready_with_assumptions"
          : assumptions.length > 0
            ? "ready_with_assumptions"
            : "ready";
    const summary =
      status === "ready"
        ? "Planning review completed without blocker-level gaps."
        : status === "needs_clarification"
          ? "Planning review found decision-relevant gaps that need clarification."
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
          : status === "needs_clarification"
            ? "Answer the open planning review questions and rerun the review."
            : status === "blocked"
              ? "Escalate to a human reviewer or strengthen the source artifact."
              : "Revise the source artifact and rerun the review.",
      questions: input.interactionMode === "interactive" ? questions : [],
      assumptions
    };
  }
}
