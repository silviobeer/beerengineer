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

function mapReviewKindToKnowledgeSource(reviewKind: ReviewKind): "planning_review" | "implementation_review" | null {
  switch (reviewKind) {
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
    const previousComparableRun = this.deps.reviewRunRepository.getLatestComparable({
      reviewKind: input.reviewKind,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      subjectStep: input.subjectStep ?? null,
      reviewMode: input.reviewMode ?? null
    });
    const previousUnresolvedFindings = previousComparableRun
      ? this.deps.reviewFindingRepository.listUnresolvedByRunId(previousComparableRun.id)
      : [];
    const previousFingerprintSet = new Set(previousUnresolvedFindings.map((finding) => finding.fingerprint));

    return this.deps.runInTransaction(() => {
      const run = this.deps.reviewRunRepository.create({
        reviewKind: input.reviewKind,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        subjectStep: input.subjectStep ?? null,
        status: input.status,
        readiness: input.readiness,
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
        reviewSummary: input.summary,
        failedReason: input.status === "failed" ? input.summary : null
      });

      const findings = this.deps.reviewFindingRepository.createMany(
        input.findings.map((finding) => {
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
            runId: run.id,
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

      if (previousComparableRun) {
        const currentFingerprints = new Set(findings.map((finding) => finding.fingerprint));
        const resolvedFingerprints = previousUnresolvedFindings
          .map((finding) => finding.fingerprint)
          .filter((fingerprint) => !currentFingerprints.has(fingerprint));
        this.deps.reviewFindingRepository.markResolved(previousComparableRun.id, resolvedFingerprints);
      }

      const synthesis = this.deps.reviewSynthesisRepository.create({
        runId: run.id,
        summary: input.summary,
        status: input.status,
        readiness: input.readiness,
        keyPointsJson: JSON.stringify(input.keyPoints),
        disagreementsJson: JSON.stringify(input.disagreements),
        recommendedAction: input.recommendedAction,
        gateDecision: input.gateDecision
      });

      const questions = this.deps.reviewQuestionRepository.createMany(
        (input.questions ?? []).map((question) => ({
          runId: run.id,
          question: question.question,
          reason: question.reason,
          impact: question.impact,
          status: question.status ?? "open",
          answer: question.answer ?? null,
          answeredAt: question.answer ? Date.now() : null
        }))
      );
      const assumptions = this.deps.reviewAssumptionRepository.createMany(
        (input.assumptions ?? []).map((assumption) => ({
          runId: run.id,
          statement: assumption.statement,
          reason: assumption.reason,
          source: assumption.source
        }))
      );

      this.deps.reviewRunRepository.update(run.id, {
        status: input.status,
        readiness: input.readiness,
        reviewSummary: input.summary,
        completedAt: Date.now()
      });

      this.persistQualityKnowledge({
        reviewKind: input.reviewKind,
        findings,
        knowledgeContext: input.knowledgeContext ?? null
      });

      return this.showReview(run.id, {
        existingRun: {
          ...run,
          status: input.status,
          readiness: input.readiness,
          reviewSummary: input.summary,
          completedAt: Date.now()
        },
        existingFindings: findings,
        existingSynthesis: synthesis,
        existingQuestions: questions,
        existingAssumptions: assumptions
      });
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
