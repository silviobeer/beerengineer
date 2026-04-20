import type {
  PlanningReviewAutomationLevel,
  PlanningReviewGateEligibility,
  PlanningReviewInteractionMode,
  ReviewFindingSeverity,
  ReviewGateDecision,
  ReviewKind,
  ReviewRunStatus,
  ReviewSourceSystem
} from "../domain/types.js";

export type ReviewProviderResult = {
  providerId: string;
  sourceSystem: ReviewSourceSystem;
  findings: Array<{
    reviewerRole?: string | null;
    findingType: string;
    normalizedSeverity: ReviewFindingSeverity;
    sourceSeverity?: string | null;
    title: string;
    detail: string;
    evidence?: string | null;
    filePath?: string | null;
    line?: number | null;
    fieldPath?: string | null;
  }>;
  summary?: string | null;
  gateSignal?: ReviewGateDecision;
  confidence?: string | null;
  providerMetadata?: Record<string, unknown>;
};

export type ReviewRecordInput = {
  reviewKind: ReviewKind;
  subjectType: string;
  subjectId: string;
  subjectStep?: string | null;
  status: ReviewRunStatus;
  readiness: string;
  interactionMode?: PlanningReviewInteractionMode | null;
  reviewMode?: string | null;
  automationLevel: PlanningReviewAutomationLevel;
  requestedMode?: string | null;
  actualMode?: string | null;
  confidence?: string | null;
  gateEligibility: PlanningReviewGateEligibility;
  sourceSummary: Record<string, unknown>;
  providersUsed: string[];
  missingCapabilities: string[];
  summary: string;
  keyPoints: string[];
  disagreements: string[];
  recommendedAction: string;
  gateDecision: ReviewGateDecision;
  findings: Array<
    ReviewProviderResult["findings"][number] & {
      sourceSystem: ReviewSourceSystem;
    }
  >;
  questions?: Array<{
    question: string;
    reason: string;
    impact: string;
    status?: "open" | "answered" | "dismissed" | "assumed";
    answer?: string | null;
  }>;
  assumptions?: Array<{
    statement: string;
    reason: string;
    source: string;
  }>;
  knowledgeContext?: {
    source: "planning_review" | "implementation_review";
    workspaceId: string;
    projectId?: string | null;
    waveId?: string | null;
    storyId?: string | null;
  } | null;
};
