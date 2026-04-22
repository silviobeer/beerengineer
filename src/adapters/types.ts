import type {
  AppVerificationRunner,
  BrainstormSessionMode,
  BrainstormSessionStatus,
  DocumentationWorkerRole,
  ExecutionWorkerRole,
  ImplementationReviewProviderRole,
  InteractiveReviewEntryStatus,
  InteractiveReviewSeverity,
  InteractiveReviewStatus,
  PlanningReviewInteractionMode,
  PlanningReviewMode,
  PlanningReviewProviderRole,
  PlanningReviewStep,
  QaRunStatus,
  StoryReviewRunStatus,
  StoryReviewWorkerRole,
  StageKey,
  TestPreparationWorkerRole,
  VerificationRunStatus,
  VerificationWorkerRole
} from "../domain/types.js";
import type {
  AppVerificationOutput,
  DocumentationOutput,
  InteractiveBrainstormAgentOutput,
  ImplementationReviewOutput,
  InteractiveStoryReviewAgentOutput,
  PlanningReviewReviewerOutput,
  RalphVerificationOutput,
  QaOutput,
  StoryReviewOutput,
  StoryExecutionOutput,
  TestPreparationOutput,
  WorkspaceSetupAssistOutput
} from "../schemas/output-contracts.js";

export type AgentExecutionPolicy = {
  autonomyMode: "manual" | "yolo";
  approvalMode: "always" | "never";
  filesystemMode: "read-only" | "workspace-write" | "danger-full-access";
  networkMode: "disabled" | "enabled";
  interactionMode: "blocking" | "non_blocking";
};

export type AdapterRuntimeContext = {
  provider: string;
  model: string | null;
  policy: AgentExecutionPolicy;
  workspaceRoot: string;
};

export type WorkspaceSetupAssistAdapterRunRequest = {
  runtime: AdapterRuntimeContext;
  interactionType: "workspace_setup_assist";
  prompt: string;
  workspace: {
    key: string;
    name: string;
    rootPath: string | null;
  };
  doctor: {
    status: string;
    missing: string[];
    suggestedActions: string[];
    autoFixable: string[];
    checks: Record<string, Array<{ id: string; status: string; message: string }>>;
  };
  currentPlan: {
    version: 1;
    workspaceKey: string;
    rootPath: string | null;
    mode: "greenfield" | "brownfield";
    stack: "node-ts" | "python";
    scaffoldProjectFiles: boolean;
    createRoot: boolean;
    initGit: boolean;
    installDeps: boolean;
    withSonar: boolean;
    withCoderabbit: boolean;
    generatedAt: number;
  };
  userMessage: string;
};

export type WorkspaceSetupAssistAdapterRunResult = {
  output: WorkspaceSetupAssistOutput;
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string[];
};

export type PlanningReviewAdapterRunRequest = {
  runtime: AdapterRuntimeContext;
  interactionType: "planning_review";
  prompt: string;
  step: PlanningReviewStep;
  reviewMode: PlanningReviewMode;
  interactionMode: PlanningReviewInteractionMode;
  reviewerRole: PlanningReviewProviderRole;
  source: {
    type: string;
    id: string;
  };
  artifact: {
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
};

export type PlanningReviewAdapterRunResult = {
  output: PlanningReviewReviewerOutput;
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string[];
};

export type ImplementationReviewAdapterRunRequest = {
  runtime: AdapterRuntimeContext;
  interactionType: "implementation_review";
  prompt: string;
  skills: Array<{ path: string; content: string }>;
  reviewerRole: ImplementationReviewProviderRole;
  story: ExecutionAdapterRunRequest["story"];
  project: ExecutionAdapterRunRequest["project"];
  wave: ExecutionAdapterRunRequest["wave"];
  implementationPlan: ExecutionAdapterRunRequest["implementationPlan"];
  item: ExecutionAdapterRunRequest["item"];
  acceptanceCriteria: ExecutionAdapterRunRequest["acceptanceCriteria"];
  projectExecutionContext: ExecutionAdapterRunRequest["projectExecutionContext"];
  implementation: StoryExecutionOutput;
  basicVerification: {
    status: VerificationRunStatus | null;
    summary: Record<string, unknown> | null;
  };
  ralphVerification: {
    status: VerificationRunStatus | null;
    summary: Record<string, unknown> | null;
  };
  appVerification: {
    status: "pending" | "preparing" | "in_progress" | "passed" | "review_required" | "failed" | null;
    summary: Record<string, unknown> | null;
  };
  latestStoryReview: {
    status: StoryReviewRunStatus | null;
    summary: Record<string, unknown> | null;
    findings: Array<{
      severity: string;
      category: string;
      title: string;
      description: string;
      evidence: string;
      filePath: string | null;
      line: number | null;
      suggestedFix: string | null;
    }>;
  };
  externalSignals: Array<{
    sourceSystem: string;
    reviewerRole: string | null;
    normalizedSeverity: string;
    findingType: string;
    title: string;
    detail: string;
    evidence: string | null;
    filePath: string | null;
    line: number | null;
  }>;
  qualityKnowledge: Array<{
    source: string;
    scopeType: string;
    scopeId: string;
    summary: string;
    status: string;
  }>;
};

export type ImplementationReviewAdapterRunResult = {
  output: ImplementationReviewOutput;
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string[];
};

export type AdapterRunRequest = {
  runtime: AdapterRuntimeContext;
  stageKey: StageKey;
  prompt: string;
  skills: Array<{ path: string; content: string }>;
  item: {
    id: string;
    code: string;
    title: string;
    description: string;
  };
  project?: {
    id: string;
    code: string;
    title: string;
    summary: string;
    goal: string;
  } | null;
  context?: {
    conceptSummary?: string | null;
    conceptMarkdown?: string | null;
    architectureSummary?: string | null;
    upstreamSource?: {
      problem: string | null;
      coreOutcome: string | null;
      targetUsers: string[];
      useCases: string[];
      constraints: string[];
      nonGoals: string[];
      risks: string[];
      assumptions: string[];
      openQuestions: string[];
      candidateDirections: string[];
      recommendedDirection: string | null;
      scopeNotes: string | null;
      designConstraints?: string[];
      requiredDeliverables?: string[];
      referenceArtifacts?: string[];
    } | null;
    userClarifications?: string[];
    reviewFeedback?: Array<{
      reviewRunId: string;
      stageKey: StageKey;
      status: string;
      readiness: string | null;
      summary: string;
      recommendedAction: string | null;
      findings: Array<{
        type: string;
        title: string;
        detail: string;
        evidence: string | null;
      }>;
      openQuestions: Array<{
        question: string;
        reason: string | null;
        impact: string | null;
      }>;
    }>;
    stories?: Array<{
      code: string;
      title: string;
      description: string;
      actor: string;
      goal: string;
      benefit: string;
      priority: string;
      acceptanceCriteria: Array<{ code: string; text: string }>;
    }>;
  } | null;
};

export type AdapterRunResult = {
  markdownArtifacts: Array<{ kind: string; content: string }>;
  structuredArtifacts: Array<{ kind: string; content: unknown }>;
  needsUserInput?: boolean;
  userInputQuestion?: string | null;
  followUpHint?: string | null;
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string[];
};

export type ExecutionAdapterRunRequest = {
  runtime: AdapterRuntimeContext;
  workerRole: ExecutionWorkerRole;
  prompt: string;
  skills: Array<{ path: string; content: string }>;
  item: {
    id: string;
    code: string;
    title: string;
    description: string;
  };
  project: {
    id: string;
    code: string;
    title: string;
    summary: string;
    goal: string;
  };
  implementationPlan: {
    id: string;
    summary: string;
    version: number;
  };
  wave: {
    id: string;
    code: string;
    goal: string;
    position: number;
  };
  story: {
    id: string;
    code: string;
    title: string;
    description: string;
    actor: string;
    goal: string;
    benefit: string;
    priority: string;
  };
  acceptanceCriteria: Array<{
    id: string;
    code: string;
    text: string;
    position: number;
  }>;
  architecture: {
    id: string;
    summary: string;
    version: number;
  } | null;
  projectExecutionContext: {
    relevantDirectories: string[];
    relevantFiles: string[];
    integrationPoints: string[];
    testLocations: string[];
    repoConventions: string[];
    executionNotes: string[];
  };
  businessContextSnapshotJson: string;
  repoContextSnapshotJson: string;
  testPreparation: {
    id: string;
    summary: string;
    testFiles: Array<{
      path: string;
      content: string;
      writeMode: "proposed" | "written";
    }>;
    testsGenerated: Array<{
      path: string;
      intent: string;
    }>;
    assumptions: string[];
  };
};

export type ExecutionAdapterRunResult = {
  output: StoryExecutionOutput;
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string[];
};

export type TestPreparationAdapterRunRequest = {
  runtime: AdapterRuntimeContext;
  workerRole: TestPreparationWorkerRole;
  prompt: string;
  skills: Array<{ path: string; content: string }>;
  item: ExecutionAdapterRunRequest["item"];
  project: ExecutionAdapterRunRequest["project"];
  implementationPlan: ExecutionAdapterRunRequest["implementationPlan"];
  wave: ExecutionAdapterRunRequest["wave"];
  story: ExecutionAdapterRunRequest["story"];
  acceptanceCriteria: ExecutionAdapterRunRequest["acceptanceCriteria"];
  architecture: ExecutionAdapterRunRequest["architecture"];
  projectExecutionContext: ExecutionAdapterRunRequest["projectExecutionContext"];
  businessContextSnapshotJson: string;
  repoContextSnapshotJson: string;
};

export type TestPreparationAdapterRunResult = {
  output: TestPreparationOutput;
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string[];
};

export type RalphVerificationAdapterRunRequest = {
  runtime: AdapterRuntimeContext;
  workerRole: VerificationWorkerRole;
  prompt: string;
  skills: Array<{ path: string; content: string }>;
  item: ExecutionAdapterRunRequest["item"];
  project: ExecutionAdapterRunRequest["project"];
  implementationPlan: ExecutionAdapterRunRequest["implementationPlan"];
  wave: ExecutionAdapterRunRequest["wave"];
  story: ExecutionAdapterRunRequest["story"];
  acceptanceCriteria: ExecutionAdapterRunRequest["acceptanceCriteria"];
  architecture: ExecutionAdapterRunRequest["architecture"];
  projectExecutionContext: ExecutionAdapterRunRequest["projectExecutionContext"];
  businessContextSnapshotJson: string;
  repoContextSnapshotJson: string;
  testPreparation: ExecutionAdapterRunRequest["testPreparation"];
  implementation: StoryExecutionOutput;
  basicVerification: {
    status: VerificationRunStatus;
    summary: {
      storyCode: string;
      changedFiles: string[];
      testsRun: StoryExecutionOutput["testsRun"];
      blockers: string[];
    };
  };
};

export type RalphVerificationAdapterRunResult = {
  output: RalphVerificationOutput;
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string[];
};

export type AppVerificationAdapterRunRequest = {
  runtime: AdapterRuntimeContext;
  workerRole: "app-verifier";
  prompt: string;
  skills: Array<{ path: string; content: string }>;
  item: ExecutionAdapterRunRequest["item"];
  project: ExecutionAdapterRunRequest["project"];
  implementationPlan: ExecutionAdapterRunRequest["implementationPlan"];
  wave: ExecutionAdapterRunRequest["wave"];
  story: ExecutionAdapterRunRequest["story"];
  acceptanceCriteria: ExecutionAdapterRunRequest["acceptanceCriteria"];
  architecture: ExecutionAdapterRunRequest["architecture"];
  projectExecutionContext: ExecutionAdapterRunRequest["projectExecutionContext"];
  businessContextSnapshotJson: string;
  repoContextSnapshotJson: string;
  implementation: StoryExecutionOutput;
  projectAppTestContext: {
    projectId: string;
    workspaceRoot: string;
    baseUrl: string;
    runnerPreference: AppVerificationRunner[];
    readiness: {
      healthUrl?: string;
      command?: string;
      timeoutMs?: number;
    } | null;
    auth: {
      strategy: "password" | "existing_session";
      defaultRole?: string;
    };
    users: Array<{
      key: string;
      role: string;
      email?: string;
      passwordSecretRef?: string;
    }>;
    fixtures: {
      seedCommand?: string;
      resetCommand?: string;
    } | null;
    routes: Record<string, string>;
    featureFlags: Record<string, boolean | string>;
  };
  storyAppVerificationContext: {
    waveStoryExecutionId: string;
    storyId: string;
    storyTitle: string;
    summary: string;
    acceptanceCriteria: string[];
    preferredRole?: string;
    startRoute?: string;
    changedFiles: string[];
    checks: Array<{
      id: string;
      description: string;
      expectedOutcome: string;
    }>;
    preconditions: string[];
    notes: string[];
  };
  preparedSession: {
    runner: AppVerificationRunner;
    baseUrl: string;
    resolvedBaseUrl: string;
    endpointSource: "configured" | "derived_runtime" | "fallback_playwright";
    ready: boolean;
    loginRole?: string;
    loginUserKey?: string;
    resolvedStartUrl?: string;
    seeded: boolean;
    artifactsDir?: string;
  };
};

export type AppVerificationAdapterRunResult = {
  output: AppVerificationOutput;
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string[];
};

export type QaAdapterRunRequest = {
  runtime: AdapterRuntimeContext;
  workerRole: "qa-verifier";
  prompt: string;
  skills: Array<{ path: string; content: string }>;
  item: ExecutionAdapterRunRequest["item"];
  project: ExecutionAdapterRunRequest["project"];
  implementationPlan: ExecutionAdapterRunRequest["implementationPlan"];
  architecture: ExecutionAdapterRunRequest["architecture"];
  projectExecutionContext: ExecutionAdapterRunRequest["projectExecutionContext"];
  inputSnapshotJson: string;
  waves: Array<{
    id: string;
    code: string;
    goal: string;
    position: number;
  }>;
  stories: Array<{
    id: string;
    code: string;
    title: string;
    description: string;
    actor: string;
    goal: string;
    benefit: string;
    priority: string;
    acceptanceCriteria: Array<{
      id: string;
      code: string;
      text: string;
      position: number;
    }>;
    latestExecution: {
      id: string;
      status: string;
      outputSummaryJson: string | null;
      businessContextSnapshotJson: string;
      repoContextSnapshotJson: string;
    };
    latestRalphVerification: {
      id: string;
      status: string;
      summaryJson: string;
    };
    latestStoryReview: {
      id: string;
      status: string;
      summaryJson: string | null;
    };
  }>;
};

export type QaAdapterRunResult = {
  output: QaOutput;
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string[];
};

export type DocumentationAdapterRunRequest = {
  runtime: AdapterRuntimeContext;
  workerRole: DocumentationWorkerRole;
  prompt: string;
  skills: Array<{ path: string; content: string }>;
  item: ExecutionAdapterRunRequest["item"];
  project: ExecutionAdapterRunRequest["project"];
  concept: {
    id: string;
    version: number;
    title: string;
    summary: string;
  } | null;
  implementationPlan: ExecutionAdapterRunRequest["implementationPlan"];
  architecture: ExecutionAdapterRunRequest["architecture"];
  projectExecutionContext: ExecutionAdapterRunRequest["projectExecutionContext"];
  inputSnapshotJson: string;
  latestQaRun: {
    id: string;
    status: QaRunStatus;
    summaryJson: string | null;
  };
  openQaFindings: Array<{
    severity: "critical" | "high" | "medium" | "low";
    category: "functional" | "security" | "regression" | "ux";
    title: string;
    description: string;
    evidence: string;
    reproSteps: string[];
    suggestedFix: string | null;
    storyCode: string | null;
    acceptanceCriterionCode: string | null;
  }>;
  waves: Array<{
    id: string;
    code: string;
    goal: string;
    position: number;
    storiesDelivered: string[];
  }>;
  stories: Array<{
    id: string;
    code: string;
    title: string;
    description: string;
    acceptanceCriteria: Array<{
      id: string;
      code: string;
      text: string;
      position: number;
    }>;
    latestTestPreparation: TestPreparationOutput;
    latestExecution: StoryExecutionOutput;
    latestBasicVerification: {
      id: string;
      status: VerificationRunStatus;
      summaryJson: string;
    };
    latestRalphVerification: {
      id: string;
      status: VerificationRunStatus;
      summary: RalphVerificationOutput;
    };
    latestStoryReview: {
      id: string;
      status: StoryReviewRunStatus;
      summary: StoryReviewOutput;
      findings: Array<{
        severity: "critical" | "high" | "medium" | "low";
        category: "correctness" | "security" | "reliability" | "performance" | "maintainability" | "persistence";
        title: string;
        description: string;
        evidence: string;
        filePath: string | null;
        line: number | null;
        suggestedFix: string | null;
        status: "open" | "in_progress" | "accepted" | "resolved" | "false_positive";
      }>;
    };
  }>;
};

export type DocumentationAdapterRunResult = {
  output: DocumentationOutput;
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string[];
};

export type InteractiveBrainstormAdapterRunRequest = {
  runtime: AdapterRuntimeContext;
  interactionType: "brainstorm_chat";
  prompt: string;
  session: {
    id: string;
    status: BrainstormSessionStatus;
    mode: BrainstormSessionMode;
  };
  item: AdapterRunRequest["item"];
  draft: {
    revision: number;
    status: string;
    problem: string | null;
    coreOutcome: string | null;
    targetUsers: string[];
    useCases: string[];
    constraints: string[];
    nonGoals: string[];
    risks: string[];
    openQuestions: string[];
    candidateDirections: string[];
    recommendedDirection: string | null;
    scopeNotes: string | null;
    assumptions: string[];
  };
  messages: Array<{
    role: "system" | "assistant" | "user";
    content: string;
  }>;
  userMessage: string;
  allowedActions: Array<"suggest_patch" | "request_structured_follow_up" | "suggest_promote">;
};

export type InteractiveBrainstormAdapterRunResult = {
  output: InteractiveBrainstormAgentOutput;
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string[];
};

export type InteractiveStoryReviewAdapterRunRequest = {
  runtime: AdapterRuntimeContext;
  interactionType: "story_review_chat";
  prompt: string;
  session: {
    id: string;
    status: InteractiveReviewStatus;
    artifactType: "stories";
    reviewType: string;
  };
  item: AdapterRunRequest["item"];
  project: NonNullable<AdapterRunRequest["project"]>;
  stories: Array<{
    id: string;
    // Engine-owned review entry id. Adapters must echo this value back in entryUpdates.
    entryId: string;
    code: string;
    title: string;
    description: string;
    priority: string;
    status: string;
    acceptanceCriteria: Array<{ id: string; code: string; text: string; position: number }>;
  }>;
  entries: Array<{
    entryId: string;
    title: string;
    status: InteractiveReviewEntryStatus;
    summary: string | null;
    changeRequest: string | null;
    rationale: string | null;
    severity: InteractiveReviewSeverity | null;
  }>;
  messages: Array<{
    role: "system" | "assistant" | "user";
    content: string;
  }>;
  userMessage: string;
  allowedStatuses: InteractiveReviewEntryStatus[];
  allowedActions: Array<"update_entries" | "request_structured_follow_up" | "suggest_resolution">;
  upstreamSource?: {
    conceptMarkdown: string | null;
    brainstormDraft: {
      problem: string | null;
      coreOutcome: string | null;
      targetUsers: string[];
      useCases: string[];
      constraints: string[];
      nonGoals: string[];
      risks: string[];
      assumptions: string[];
      openQuestions: string[];
      candidateDirections: string[];
      recommendedDirection: string | null;
      scopeNotes: string | null;
    } | null;
    coverageGaps?: Array<{
      sourceField: "targetUsers" | "useCases" | "constraints" | "nonGoals" | "risks" | "assumptions";
      sourceEntry: string;
      severity: "blocker" | "major";
    }>;
  } | null;
};

export type InteractiveStoryReviewAdapterRunResult = {
  output: InteractiveStoryReviewAgentOutput;
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string[];
};

export type StoryReviewAdapterRunRequest = {
  runtime: AdapterRuntimeContext;
  workerRole: StoryReviewWorkerRole;
  prompt: string;
  skills: Array<{ path: string; content: string }>;
  item: ExecutionAdapterRunRequest["item"];
  project: ExecutionAdapterRunRequest["project"];
  implementationPlan: ExecutionAdapterRunRequest["implementationPlan"];
  wave: ExecutionAdapterRunRequest["wave"];
  story: ExecutionAdapterRunRequest["story"];
  acceptanceCriteria: ExecutionAdapterRunRequest["acceptanceCriteria"];
  architecture: ExecutionAdapterRunRequest["architecture"];
  projectExecutionContext: ExecutionAdapterRunRequest["projectExecutionContext"];
  inputSnapshotJson: string;
  businessContextSnapshotJson: string;
  repoContextSnapshotJson: string;
  testPreparation: ExecutionAdapterRunRequest["testPreparation"];
  implementation: StoryExecutionOutput;
  basicVerification: {
    status: VerificationRunStatus;
    summary: {
      storyCode: string;
      changedFiles: string[];
      testsRun: StoryExecutionOutput["testsRun"];
      blockers: string[];
    };
  };
  ralphVerification: {
    status: VerificationRunStatus;
    summary: {
      storyCode: string;
      overallStatus: "passed" | "review_required" | "failed";
      summary: string;
      acceptanceCriteriaResults: Array<{
        acceptanceCriterionId: string;
        acceptanceCriterionCode: string;
        status: "passed" | "review_required" | "failed";
        evidence: string;
        notes: string;
      }>;
      blockers: string[];
    };
  };
};

export type StoryReviewAdapterRunResult = {
  output: StoryReviewOutput;
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string[];
};

export interface AgentAdapter {
  readonly key: string;
  run(request: AdapterRunRequest): Promise<AdapterRunResult>;
  runPlanningReview(request: PlanningReviewAdapterRunRequest): Promise<PlanningReviewAdapterRunResult>;
  runImplementationReview(request: ImplementationReviewAdapterRunRequest): Promise<ImplementationReviewAdapterRunResult>;
  runInteractiveBrainstorm(request: InteractiveBrainstormAdapterRunRequest): Promise<InteractiveBrainstormAdapterRunResult>;
  runInteractiveStoryReview(request: InteractiveStoryReviewAdapterRunRequest): Promise<InteractiveStoryReviewAdapterRunResult>;
  runWorkspaceSetupAssist(request: WorkspaceSetupAssistAdapterRunRequest): Promise<WorkspaceSetupAssistAdapterRunResult>;
  runStoryTestPreparation(request: TestPreparationAdapterRunRequest): Promise<TestPreparationAdapterRunResult>;
  runStoryExecution(request: ExecutionAdapterRunRequest): Promise<ExecutionAdapterRunResult>;
  runStoryRalphVerification(request: RalphVerificationAdapterRunRequest): Promise<RalphVerificationAdapterRunResult>;
  runStoryAppVerification(request: AppVerificationAdapterRunRequest): Promise<AppVerificationAdapterRunResult>;
  runStoryReview(request: StoryReviewAdapterRunRequest): Promise<StoryReviewAdapterRunResult>;
  runProjectQa(request: QaAdapterRunRequest): Promise<QaAdapterRunResult>;
  runProjectDocumentation(request: DocumentationAdapterRunRequest): Promise<DocumentationAdapterRunResult>;
}
