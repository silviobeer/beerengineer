import type { ReviewFinding, ReviewKind, ReviewRun, ReviewRunStatus, ReviewSourceSystem } from "../domain/types.js";
import type { WorkflowDeps } from "../workflow/workflow-deps.js";
import type { ReviewRecordInput } from "./types.js";

function normalizeModuleFromPath(filePath: string | null): string | null {
  if (!filePath) {
    return null;
  }
  const [topLevel, secondLevel] = filePath.split("/");
  return topLevel ? (secondLevel ? `${topLevel}/${secondLevel}` : topLevel) : null;
}

function fingerprintFinding(input: {
  sourceSystem: ReviewSourceSystem;
  reviewerRole: string | null;
  findingType: string;
  title: string;
  detail: string;
  filePath: string | null;
  line: number | null;
}): string {
  return [
    input.sourceSystem,
    input.reviewerRole ?? "",
    input.findingType.trim().toLowerCase(),
    input.title.trim().toLowerCase(),
    input.detail.trim().toLowerCase(),
    (input.filePath ?? "").trim().toLowerCase(),
    input.line ?? ""
  ].join("::");
}

function mapReviewKindToKnowledgeSource(reviewKind: ReviewKind): "story_review" | "planning_review" | "implementation_review" | null {
  switch (reviewKind) {
    case "interactive_story":
      return "story_review";
    case "planning":
      return "planning_review";
    case "implementation":
      return "implementation_review";
    default:
      return null;
  }
}

function mapStatusToKnowledgeStatus(status: ReviewFinding["status"]): string {
  switch (status) {
    case "resolved":
      return "resolved";
    default:
      return "open";
  }
}

function mapRunStatusToComparisonStatus(status: ReviewRunStatus): "changed" | "unchanged" {
  return status === "complete" ? "unchanged" : "changed";
}

export class ReviewCoreService {
  public constructor(private readonly deps: WorkflowDeps) {}

  public isReadyForGate(run: Pick<ReviewRun, "status" | "readiness">): boolean {
    return run.status === "complete" && (run.readiness === "ready" || run.readiness === "ready_with_assumptions");
  }

  public getLatestBlockingRunForGate(input: { reviewKind: ReviewKind; subjectType: string; subjectId: string }) {
    const run = this.deps.reviewRunRepository.getLatestBySubject(input);
    if (!run) {
      return null;
    }
    if (run.automationLevel !== "auto_gate") {
      return null;
    }
    if (run.gateEligibility !== "advisory") {
      return null;
    }
    return this.isReadyForGate(run) ? null : run;
  }

  public recordReview(input: ReviewRecordInput) {
    const run = this.startReviewRun({
      reviewKind: input.reviewKind,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      subjectStep: input.subjectStep ?? null,
      interactionMode: input.interactionMode ?? null,
      reviewMode: input.reviewMode ?? null,
      automationLevel: input.automationLevel,
      requestedMode: input.requestedMode ?? null,
      actualMode: input.actualMode ?? null,
      confidence: input.confidence ?? null,
      gateEligibility: input.gateEligibility,
      sourceSummary: input.sourceSummary,
      providersUsed: input.providersUsed,
      missingCapabilities: input.missingCapabilities
    });
    return this.completeReviewRun(run.id, {
      status: input.status,
      readiness: input.readiness,
      interactionMode: input.interactionMode ?? null,
      automationLevel: input.automationLevel,
      requestedMode: input.requestedMode ?? null,
      actualMode: input.actualMode ?? null,
      confidence: input.confidence ?? null,
      gateEligibility: input.gateEligibility,
      sourceSummary: input.sourceSummary,
      providersUsed: input.providersUsed,
      missingCapabilities: input.missingCapabilities,
      summary: input.summary,
      keyPoints: input.keyPoints,
      disagreements: input.disagreements,
      recommendedAction: input.recommendedAction,
      gateDecision: input.gateDecision,
      findings: input.findings,
      questions: input.questions,
      assumptions: input.assumptions,
      knowledgeContext: input.knowledgeContext ?? null
    });
  }

  public startReviewRun(input: {
    reviewKind: ReviewKind;
    subjectType: string;
    subjectId: string;
    subjectStep?: string | null;
    interactionMode?: ReviewRecordInput["interactionMode"];
    reviewMode?: string | null;
    automationLevel: ReviewRecordInput["automationLevel"];
    requestedMode?: string | null;
    actualMode?: string | null;
    confidence?: string | null;
    gateEligibility: ReviewRecordInput["gateEligibility"];
    sourceSummary: Record<string, unknown>;
    providersUsed: string[];
    missingCapabilities: string[];
  }) {
    return this.deps.runInTransaction(() =>
      this.deps.reviewRunRepository.create({
        reviewKind: input.reviewKind,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        subjectStep: input.subjectStep ?? null,
        status: "in_progress",
        readiness: null,
        interactionMode: input.interactionMode ?? null,
        reviewMode: input.reviewMode ?? null,
        automationLevel: input.automationLevel,
        requestedMode: input.requestedMode ?? null,
        actualMode: input.actualMode ?? null,
        confidence: input.confidence ?? null,
        gateEligibility: input.gateEligibility,
        sourceSummaryJson: JSON.stringify(input.sourceSummary, null, 2),
        providersUsedJson: JSON.stringify(input.providersUsed),
        missingCapabilitiesJson: JSON.stringify(input.missingCapabilities),
        reviewSummary: null,
        failedReason: null
      })
    );
  }

  public completeReviewRun(
    runId: string,
    input: Omit<ReviewRecordInput, "reviewKind" | "subjectType" | "subjectId" | "subjectStep" | "reviewMode">
  ) {
    const run = this.requireRun(runId);
    const previousComparableRun = this.deps.reviewRunRepository.getPreviousComparable({
      reviewKind: run.reviewKind,
      subjectType: run.subjectType,
      subjectId: run.subjectId,
      subjectStep: run.subjectStep,
      reviewMode: run.reviewMode,
      beforeStartedAt: run.startedAt,
      excludeRunId: run.id
    });
    const previousUnresolvedFindings = previousComparableRun
      ? this.deps.reviewFindingRepository.listUnresolvedByRunId(previousComparableRun.id)
      : [];
    return this.persistCompletedReview({
      run,
      input,
      previousComparableRun,
      previousUnresolvedFindings
    });
  }

  public showReview(
    runId: string,
    overrides?: {
      existingRun?: ReviewRun;
      existingFindings?: ReviewFinding[];
      existingSynthesis?: ReturnType<WorkflowDeps["reviewSynthesisRepository"]["getLatestByRunId"]>;
      existingQuestions?: ReturnType<WorkflowDeps["reviewQuestionRepository"]["listByRunId"]>;
      existingAssumptions?: ReturnType<WorkflowDeps["reviewAssumptionRepository"]["listByRunId"]>;
    }
  ) {
    const run = overrides?.existingRun ?? this.requireRun(runId);
    const findings = overrides?.existingFindings ?? this.deps.reviewFindingRepository.listByRunId(runId);
    const synthesis = overrides?.existingSynthesis ?? this.deps.reviewSynthesisRepository.getLatestByRunId(runId);
    const questions = overrides?.existingQuestions ?? this.deps.reviewQuestionRepository.listByRunId(runId);
    const assumptions = overrides?.existingAssumptions ?? this.deps.reviewAssumptionRepository.listByRunId(runId);
    const comparisonToPrevious = this.buildComparisonToPrevious(run, findings);
    return {
      run,
      sourceSummary: JSON.parse(run.sourceSummaryJson) as Record<string, unknown>,
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
      comparisonToPrevious
    };
  }

  public getLatestBySubject(input: { reviewKind: ReviewKind; subjectType: string; subjectId: string }) {
    const run = this.deps.reviewRunRepository.getLatestBySubject(input);
    return run ? this.showReview(run.id) : null;
  }

  private requireRun(runId: string): ReviewRun {
    const run = this.deps.reviewRunRepository.getById(runId);
    if (!run) {
      throw new Error(`Review run ${runId} not found`);
    }
    return run;
  }

  private persistCompletedReview(input: {
    run: ReviewRun;
    input: Omit<ReviewRecordInput, "reviewKind" | "subjectType" | "subjectId" | "subjectStep" | "reviewMode">;
    previousComparableRun: ReviewRun | null;
    previousUnresolvedFindings: ReviewFinding[];
  }) {
    const previousFingerprintSet = new Set(input.previousUnresolvedFindings.map((finding) => finding.fingerprint));

    return this.deps.runInTransaction(() => {
      this.deps.reviewRunRepository.update(input.run.id, {
        status: input.input.status,
        readiness: input.input.readiness,
        interactionMode: input.input.interactionMode ?? null,
        reviewMode: input.run.reviewMode,
        automationLevel: input.input.automationLevel,
        requestedMode: input.input.requestedMode ?? null,
        actualMode: input.input.actualMode ?? null,
        confidence: input.input.confidence ?? null,
        gateEligibility: input.input.gateEligibility,
        sourceSummaryJson: JSON.stringify(input.input.sourceSummary, null, 2),
        providersUsedJson: JSON.stringify(input.input.providersUsed),
        missingCapabilitiesJson: JSON.stringify(input.input.missingCapabilities),
        reviewSummary: input.input.summary,
        failedReason: input.input.status === "failed" ? input.input.summary : null,
        completedAt: Date.now()
      });

      const findings = this.deps.reviewFindingRepository.createMany(
        input.input.findings.map((finding) => {
          const fingerprint = fingerprintFinding({
            sourceSystem: finding.sourceSystem,
            reviewerRole: finding.reviewerRole ?? null,
            findingType: finding.findingType,
            title: finding.title,
            detail: finding.detail,
            filePath: finding.filePath ?? null,
            line: finding.line ?? null
          });
          return {
            runId: input.run.id,
            sourceSystem: finding.sourceSystem,
            reviewerRole: finding.reviewerRole ?? null,
            findingType: finding.findingType,
            normalizedSeverity: finding.normalizedSeverity,
            sourceSeverity: finding.sourceSeverity ?? null,
            title: finding.title,
            detail: finding.detail,
            evidence: finding.evidence ?? null,
            status: previousFingerprintSet.has(fingerprint) ? ("open" as const) : ("new" as const),
            fingerprint,
            filePath: finding.filePath ?? null,
            line: finding.line ?? null,
            fieldPath: finding.fieldPath ?? null
          };
        })
      );

      if (input.previousComparableRun) {
        const currentFingerprints = new Set(findings.map((finding) => finding.fingerprint));
        const resolvedFingerprints = input.previousUnresolvedFindings
          .map((finding) => finding.fingerprint)
          .filter((fingerprint) => !currentFingerprints.has(fingerprint));
        this.deps.reviewFindingRepository.markResolved(input.previousComparableRun.id, resolvedFingerprints);
      }

      const synthesis = this.deps.reviewSynthesisRepository.create({
        runId: input.run.id,
        summary: input.input.summary,
        status: input.input.status,
        readiness: input.input.readiness,
        keyPointsJson: JSON.stringify(input.input.keyPoints),
        disagreementsJson: JSON.stringify(input.input.disagreements),
        recommendedAction: input.input.recommendedAction,
        gateDecision: input.input.gateDecision
      });

      const questions = this.deps.reviewQuestionRepository.createMany(
        (input.input.questions ?? []).map((question) => ({
          runId: input.run.id,
          question: question.question,
          reason: question.reason,
          impact: question.impact,
          status: question.status ?? "open",
          answer: question.answer ?? null,
          answeredAt: question.answer ? Date.now() : null
        }))
      );
      const assumptions = this.deps.reviewAssumptionRepository.createMany(
        (input.input.assumptions ?? []).map((assumption) => ({
          runId: input.run.id,
          statement: assumption.statement,
          reason: assumption.reason,
          source: assumption.source
        }))
      );

      const updatedRun = this.requireRun(input.run.id);
      this.persistQualityKnowledge({
        reviewKind: updatedRun.reviewKind,
        findings,
        knowledgeContext: input.input.knowledgeContext ?? null
      });

      return this.showReview(input.run.id, {
        existingRun: updatedRun,
        existingFindings: findings,
        existingSynthesis: synthesis,
        existingQuestions: questions,
        existingAssumptions: assumptions
      });
    });
  }

  private persistQualityKnowledge(input: {
    reviewKind: ReviewKind;
    findings: ReviewFinding[];
    knowledgeContext: ReviewRecordInput["knowledgeContext"];
  }) {
    const knowledgeContext = input.knowledgeContext;
    if (!knowledgeContext) {
      return;
    }
    const source = mapReviewKindToKnowledgeSource(input.reviewKind);
    if (!source) {
      return;
    }
    this.deps.qualityKnowledgeService.createEntries(
      input.findings.map((finding) => {
        const moduleName = normalizeModuleFromPath(finding.filePath);
        const scopeType = finding.filePath
          ? "file"
          : knowledgeContext.storyId
            ? "story"
            : knowledgeContext.waveId
              ? "wave"
              : knowledgeContext.projectId
                ? "project"
                : "workspace";
        const scopeId =
          finding.filePath ??
          knowledgeContext.storyId ??
          knowledgeContext.waveId ??
          knowledgeContext.projectId ??
          knowledgeContext.workspaceId;
        return {
          workspaceId: knowledgeContext.workspaceId,
          projectId: knowledgeContext.projectId ?? null,
          waveId: knowledgeContext.waveId ?? null,
          storyId: knowledgeContext.storyId ?? null,
          source,
          scopeType,
          scopeId,
          kind: "recurring_issue" as const,
          summary: finding.title,
          evidenceJson: JSON.stringify(
            {
              sourceSystem: finding.sourceSystem,
              severity: finding.normalizedSeverity,
              sourceSeverity: finding.sourceSeverity,
              findingType: finding.findingType,
              detail: finding.detail,
              evidence: finding.evidence,
              filePath: finding.filePath,
              line: finding.line
            },
            null,
            2
          ),
          status: mapStatusToKnowledgeStatus(finding.status),
          relevanceTagsJson: JSON.stringify(
            {
              files: finding.filePath ? [finding.filePath] : [],
              storyCodes: [],
              modules: moduleName ? [moduleName] : [],
              categories: [finding.findingType]
            },
            null,
            2
          )
        };
      })
    );
  }

  private buildComparisonToPrevious(run: ReviewRun, findings: ReviewFinding[]) {
    const previousComparableRun = this.deps.reviewRunRepository.getPreviousComparable({
      reviewKind: run.reviewKind,
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

    const currentSummary = JSON.parse(run.sourceSummaryJson) as Record<string, unknown>;
    const previousSummary = JSON.parse(previousComparableRun.sourceSummaryJson) as Record<string, unknown>;
    const changedFields = this.diffSummary(previousSummary, currentSummary);
    const previousFindings = this.deps.reviewFindingRepository.listByRunId(previousComparableRun.id);
    return {
      previousRunId: previousComparableRun.id,
      previousStatus: previousComparableRun.status,
      statusChange: mapRunStatusToComparisonStatus(run.status),
      changedFields,
      changedFieldCount: changedFields.length,
      findingDelta: {
        newCount: findings.filter((finding) => finding.status === "new").length,
        openCount: findings.filter((finding) => finding.status === "open").length,
        resolvedCount: previousFindings.filter((finding) => !findings.some((current) => current.fingerprint === finding.fingerprint)).length
      }
    };
  }

  private diffSummary(previousSummary: Record<string, unknown>, currentSummary: Record<string, unknown>) {
    const normalizeValue = (value: unknown, present: boolean): string => {
      if (!present) {
        return "<missing>";
      }
      if (value === undefined) {
        return "<undefined>";
      }
      return JSON.stringify(value);
    };

    const keys = Array.from(new Set([...Object.keys(previousSummary), ...Object.keys(currentSummary)])).sort();
    return keys
      .map((key) => {
        const previousPresent = Object.prototype.hasOwnProperty.call(previousSummary, key);
        const currentPresent = Object.prototype.hasOwnProperty.call(currentSummary, key);
        const previousValue = normalizeValue(previousSummary[key], previousPresent);
        const currentValue = normalizeValue(currentSummary[key], currentPresent);
        if (previousValue === currentValue) {
          return null;
        }
        return {
          field: key,
          previousValue,
          currentValue
        };
      })
      .filter((value): value is { field: string; previousValue: string; currentValue: string } => value !== null);
  }
}
