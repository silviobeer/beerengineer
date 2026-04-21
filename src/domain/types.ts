export const boardColumns = [
  "idea",
  "brainstorm",
  "requirements",
  "implementation",
  "done"
] as const;

export type BoardColumn = (typeof boardColumns)[number];

export const itemPhaseStatuses = [
  "draft",
  "running",
  "review_required",
  "completed",
  "failed"
] as const;

export type ItemPhaseStatus = (typeof itemPhaseStatuses)[number];

export const recordStatuses = ["draft", "approved", "completed", "failed"] as const;
export type RecordStatus = (typeof recordStatuses)[number];

export const stageKeys = ["brainstorm", "requirements", "architecture", "planning"] as const;
export type StageKey = (typeof stageKeys)[number];

export const stageRunStatuses = [
  "pending",
  "running",
  "needs_user_input",
  "completed",
  "failed",
  "review_required"
] as const;

export type StageRunStatus = (typeof stageRunStatuses)[number];

export const executionWorkerRoles = [
  "implementer",
  "backend-implementer",
  "frontend-implementer",
  "story-review-remediator"
] as const;
export type ExecutionWorkerRole = (typeof executionWorkerRoles)[number];

export const testPreparationWorkerRoles = ["test-writer"] as const;
export type TestPreparationWorkerRole = (typeof testPreparationWorkerRoles)[number];

export const verificationWorkerRoles = ["ralph-verifier"] as const;
export type VerificationWorkerRole = (typeof verificationWorkerRoles)[number];

export const storyReviewWorkerRoles = ["story-reviewer"] as const;
export type StoryReviewWorkerRole = (typeof storyReviewWorkerRoles)[number];

export const qaWorkerRoles = ["qa-verifier"] as const;
export type QaWorkerRole = (typeof qaWorkerRoles)[number];

export const documentationWorkerRoles = ["documentation-writer"] as const;
export type DocumentationWorkerRole = (typeof documentationWorkerRoles)[number];

export const waveExecutionStatuses = [
  "pending",
  "running",
  "blocked",
  "review_required",
  "completed",
  "failed"
] as const;
export type WaveExecutionStatus = (typeof waveExecutionStatuses)[number];

export const waveStoryExecutionStatuses = ["pending", "running", "review_required", "completed", "failed"] as const;
export type WaveStoryExecutionStatus = (typeof waveStoryExecutionStatuses)[number];

export const executionReadinessRunStatuses = ["running", "ready", "auto_fixable", "blocked", "failed"] as const;
export type ExecutionReadinessRunStatus = (typeof executionReadinessRunStatuses)[number];
export const verificationReadinessRunStatuses = executionReadinessRunStatuses;
export type VerificationReadinessRunStatus = ExecutionReadinessRunStatus;

export const executionReadinessFindingStatuses = ["open", "auto_fixable", "manual", "resolved"] as const;
export type ExecutionReadinessFindingStatus = (typeof executionReadinessFindingStatuses)[number];
export const verificationReadinessFindingStatuses = executionReadinessFindingStatuses;
export type VerificationReadinessFindingStatus = ExecutionReadinessFindingStatus;

export const executionReadinessActionStatuses = ["pending", "running", "completed", "failed", "skipped"] as const;
export type ExecutionReadinessActionStatus = (typeof executionReadinessActionStatuses)[number];
export const verificationReadinessActionStatuses = executionReadinessActionStatuses;
export type VerificationReadinessActionStatus = ExecutionReadinessActionStatus;

export const executionReadinessFindingSeverities = ["info", "warning", "error"] as const;
export type ExecutionReadinessFindingSeverity = (typeof executionReadinessFindingSeverities)[number];
export const verificationReadinessFindingSeverities = executionReadinessFindingSeverities;
export type VerificationReadinessFindingSeverity = ExecutionReadinessFindingSeverity;

export const executionReadinessFindingClassifications = ["auto_fixable", "llm_fixable", "manual_blocker"] as const;
export type ExecutionReadinessFindingClassification = (typeof executionReadinessFindingClassifications)[number];
export const verificationReadinessFindingClassifications = executionReadinessFindingClassifications;
export type VerificationReadinessFindingClassification = ExecutionReadinessFindingClassification;

export const executionReadinessActionInitiators = ["engine_rule", "llm_remediator", "manual"] as const;
export type ExecutionReadinessActionInitiator = (typeof executionReadinessActionInitiators)[number];
export const verificationReadinessActionInitiators = executionReadinessActionInitiators;
export type VerificationReadinessActionInitiator = ExecutionReadinessActionInitiator;

export const waveStoryTestRunStatuses = ["pending", "running", "review_required", "completed", "failed"] as const;
export type WaveStoryTestRunStatus = (typeof waveStoryTestRunStatuses)[number];

export const verificationRunStatuses = ["passed", "review_required", "failed"] as const;
export type VerificationRunStatus = (typeof verificationRunStatuses)[number];

export const verificationRunModes = ["basic", "ralph"] as const;
export type VerificationRunMode = (typeof verificationRunModes)[number];

export const appVerificationRunStatuses = [
  "pending",
  "preparing",
  "in_progress",
  "passed",
  "review_required",
  "failed"
] as const;
export type AppVerificationRunStatus = (typeof appVerificationRunStatuses)[number];

export const appVerificationRunners = ["agent_browser", "playwright"] as const;
export type AppVerificationRunner = (typeof appVerificationRunners)[number];

export const qaRunModes = ["functional", "security", "regression", "full"] as const;
export type QaRunMode = (typeof qaRunModes)[number];

export const qaRunStatuses = ["running", "review_required", "passed", "failed"] as const;
export type QaRunStatus = (typeof qaRunStatuses)[number];

export const documentationRunStatuses = ["running", "review_required", "completed", "failed"] as const;
export type DocumentationRunStatus = (typeof documentationRunStatuses)[number];

export const interactiveReviewScopeTypes = [
  "item",
  "project",
  "concept",
  "story_collection",
  "story",
  "architecture",
  "implementation_plan",
  "qa_run",
  "documentation_run"
] as const;
export type InteractiveReviewScopeType = (typeof interactiveReviewScopeTypes)[number];

export const interactiveReviewArtifactTypes = [
  "concept",
  "stories",
  "architecture",
  "implementation_plan",
  "qa",
  "documentation"
] as const;
export type InteractiveReviewArtifactType = (typeof interactiveReviewArtifactTypes)[number];

export const interactiveReviewTypes = [
  "artifact_review",
  "collection_review",
  "exception_review",
  "guided_edit"
] as const;
export type InteractiveReviewType = (typeof interactiveReviewTypes)[number];

export const interactiveReviewStatuses = [
  "open",
  "waiting_for_user",
  "synthesizing",
  "ready_for_resolution",
  "resolved",
  "cancelled"
] as const;
export type InteractiveReviewStatus = (typeof interactiveReviewStatuses)[number];

export const interactiveReviewMessageRoles = ["system", "assistant", "user"] as const;
export type InteractiveReviewMessageRole = (typeof interactiveReviewMessageRoles)[number];

export const interactiveReviewEntryTypes = ["story", "section", "finding", "option"] as const;
export type InteractiveReviewEntryType = (typeof interactiveReviewEntryTypes)[number];

export const interactiveReviewEntryStatuses = [
  "pending",
  "accepted",
  "needs_revision",
  "rejected",
  "resolved"
] as const;
export type InteractiveReviewEntryStatus = (typeof interactiveReviewEntryStatuses)[number];

export const interactiveReviewSeverities = ["critical", "high", "medium", "low"] as const;
export type InteractiveReviewSeverity = (typeof interactiveReviewSeverities)[number];

export const interactiveReviewResolutionTypes = [
  "approve",
  "approve_and_autorun",
  "approve_all",
  "approve_all_and_autorun",
  "approve_selected",
  "request_story_revisions",
  "apply_story_edits",
  "regenerate_story_set",
  "request_changes",
  "apply_guided_changes",
  "retry",
  "retry_and_autorun",
  "accept_with_rationale",
  "reject",
  "defer"
] as const;
export type InteractiveReviewResolutionType = (typeof interactiveReviewResolutionTypes)[number];

export const brainstormSessionStatuses = [
  "open",
  "waiting_for_user",
  "synthesizing",
  "ready_for_concept",
  "resolved",
  "cancelled"
] as const;
export type BrainstormSessionStatus = (typeof brainstormSessionStatuses)[number];

export const brainstormSessionModes = ["explore", "shape", "compare", "converge"] as const;
export type BrainstormSessionMode = (typeof brainstormSessionModes)[number];

export const brainstormDraftStatuses = ["drafting", "needs_input", "ready_for_concept", "superseded"] as const;
export type BrainstormDraftStatus = (typeof brainstormDraftStatuses)[number];

export const workspaceAssistSessionStatuses = ["open", "resolved", "cancelled"] as const;
export type WorkspaceAssistSessionStatus = (typeof workspaceAssistSessionStatuses)[number];

export const planningReviewSteps = ["requirements_engineering", "architecture", "plan_writing"] as const;
export type PlanningReviewStep = (typeof planningReviewSteps)[number];

export const planningReviewStatuses = [
  "synthesizing",
  "blocker_present",
  "questions_only",
  "revising",
  "ready",
  "blocked",
  "failed"
] as const;
export type PlanningReviewStatus = (typeof planningReviewStatuses)[number];

export const planningReviewInteractionModes = ["interactive", "auto"] as const;
export type PlanningReviewInteractionMode = (typeof planningReviewInteractionModes)[number];

export const reviewInteractionModes = ["auto", "assisted", "interactive"] as const;
export type ReviewInteractionMode = (typeof reviewInteractionModes)[number];

export const planningReviewReadinessResults = [
  "ready",
  "ready_with_assumptions",
  "needs_evidence",
  "needs_human_review",
  "high_risk"
] as const;
export type PlanningReviewReadinessResult = (typeof planningReviewReadinessResults)[number];

export const planningReviewModes = ["critique", "risk", "alternatives", "readiness"] as const;
export type PlanningReviewMode = (typeof planningReviewModes)[number];

export const planningReviewExecutionModes = [
  "full_dual_review",
  "degraded_dual_review",
  "single_model_multi_role",
  "minimal_review"
] as const;
export type PlanningReviewExecutionMode = (typeof planningReviewExecutionModes)[number];

export const planningReviewConfidenceLevels = ["high", "medium", "reduced", "low"] as const;
export type PlanningReviewConfidenceLevel = (typeof planningReviewConfidenceLevels)[number];

export const planningReviewGateEligibilities = ["advisory", "advisory_only"] as const;
export type PlanningReviewGateEligibility = (typeof planningReviewGateEligibilities)[number];

export const planningReviewAutomationLevels = ["manual", "auto_suggest", "auto_comment", "auto_gate"] as const;
export type PlanningReviewAutomationLevel = (typeof planningReviewAutomationLevels)[number];

export const planningReviewSourceTypes = [
  "brainstorm_session",
  "brainstorm_draft",
  "interactive_review_session",
  "concept",
  "architecture_plan",
  "implementation_plan"
] as const;
export type PlanningReviewSourceType = (typeof planningReviewSourceTypes)[number];

export const planningReviewProviderRoles = [
  "implementation_reviewer",
  "architecture_challenger",
  "decision_auditor",
  "product_skeptic",
  "synthesizer"
] as const;
export type PlanningReviewProviderRole = (typeof planningReviewProviderRoles)[number];

export const implementationReviewProviderRoles = [
  "implementation_reviewer",
  "regression_reviewer",
  "security_reviewer"
] as const;
export type ImplementationReviewProviderRole = (typeof implementationReviewProviderRoles)[number];

export const reviewKinds = ["planning", "interactive_story", "implementation", "app_verification", "qa", "documentation"] as const;
export type ReviewKind = (typeof reviewKinds)[number];

export const reviewRunStatuses = ["in_progress", "action_required", "complete", "blocked", "failed"] as const;
export type ReviewRunStatus = (typeof reviewRunStatuses)[number];

export const reviewFindingStatuses = ["new", "open", "resolved"] as const;
export type ReviewFindingStatus = (typeof reviewFindingStatuses)[number];

export const reviewQuestionStatuses = ["open", "answered", "dismissed", "assumed"] as const;
export type ReviewQuestionStatus = (typeof reviewQuestionStatuses)[number];

export const reviewSourceSystems = [
  "llm",
  "coderabbit",
  "sonarcloud",
  "tests",
  "qa",
  "story_review",
  "planning_review",
  "implementation_review"
] as const;
export type ReviewSourceSystem = (typeof reviewSourceSystems)[number];

export const reviewFindingSeverities = ["critical", "high", "medium", "low"] as const;
export type ReviewFindingSeverity = (typeof reviewFindingSeverities)[number];

export const reviewGateDecisions = ["pass", "advisory", "blocked", "needs_human_review"] as const;
export type ReviewGateDecision = (typeof reviewGateDecisions)[number];

export const workspaceAssistMessageRoles = ["system", "assistant", "user"] as const;
export type WorkspaceAssistMessageRole = (typeof workspaceAssistMessageRoles)[number];

export const qaFindingSeverities = ["critical", "high", "medium", "low"] as const;
export type QaFindingSeverity = (typeof qaFindingSeverities)[number];

export const qaFindingCategories = ["functional", "security", "regression", "ux"] as const;
export type QaFindingCategory = (typeof qaFindingCategories)[number];

export const qaFindingStatuses = ["open", "in_progress", "accepted", "resolved", "false_positive"] as const;
export type QaFindingStatus = (typeof qaFindingStatuses)[number];

export const storyReviewRunStatuses = ["running", "review_required", "passed", "failed"] as const;
export type StoryReviewRunStatus = (typeof storyReviewRunStatuses)[number];

export const qualityGatingModes = ["off", "advisory", "story_gate", "wave_gate"] as const;
export type QualityGatingMode = (typeof qualityGatingModes)[number];

export const integrationValidationStatuses = ["untested", "valid", "invalid"] as const;
export type IntegrationValidationStatus = (typeof integrationValidationStatuses)[number];

export const qualityDecisionStatuses = ["passed", "review_required", "failed", "blocked"] as const;
export type QualityDecisionStatus = (typeof qualityDecisionStatuses)[number];

export const qualityKnowledgeSources = [
  "sonar",
  "coderabbit",
  "verification",
  "qa",
  "story_review",
  "planning_review",
  "implementation_review"
] as const;
export type QualityKnowledgeSource = (typeof qualityKnowledgeSources)[number];

export const qualityKnowledgeScopeTypes = ["workspace", "project", "wave", "story", "file", "module"] as const;
export type QualityKnowledgeScopeType = (typeof qualityKnowledgeScopeTypes)[number];

export const qualityKnowledgeKinds = ["rule", "constraint", "lesson", "recurring_issue", "recommendation"] as const;
export type QualityKnowledgeKind = (typeof qualityKnowledgeKinds)[number];

export const storyReviewFindingSeverities = ["critical", "high", "medium", "low"] as const;
export type StoryReviewFindingSeverity = (typeof storyReviewFindingSeverities)[number];

export const storyReviewFindingCategories = [
  "correctness",
  "security",
  "reliability",
  "performance",
  "maintainability",
  "persistence"
] as const;
export type StoryReviewFindingCategory = (typeof storyReviewFindingCategories)[number];

export const storyReviewFindingStatuses = ["open", "in_progress", "accepted", "resolved", "false_positive"] as const;
export type StoryReviewFindingStatus = (typeof storyReviewFindingStatuses)[number];

export const remediationRunStatuses = ["running", "completed", "review_required", "failed"] as const;
export type RemediationRunStatus = (typeof remediationRunStatuses)[number];

export const remediationResolutionStatuses = ["selected", "resolved", "still_open", "not_reproducible"] as const;
export type RemediationResolutionStatus = (typeof remediationResolutionStatuses)[number];

export type GitBranchRole = "project" | "story" | "story-remediation";

export type GitBranchMetadata = {
  branchRole: GitBranchRole;
  baseRef: string;
  branchName: string;
  workspaceRoot: string;
  worktreePath: string | null;
  headBefore: string | null;
  headAfter: string | null;
  commitSha: string | null;
  mergedIntoRef: string | null;
  mergedCommitSha: string | null;
  strategy: "applied" | "simulated";
  reason: string | null;
};

export type Workspace = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  rootPath: string | null;
  createdAt: number;
  updatedAt: number;
};

export type WorkspaceSettings = {
  workspaceId: string;
  defaultAdapterKey: string | null;
  defaultModel: string | null;
  runtimeProfileJson: string | null;
  autorunPolicyJson: string | null;
  promptOverridesJson: string | null;
  skillOverridesJson: string | null;
  verificationDefaultsJson: string | null;
  appTestConfigJson: string | null;
  qaDefaultsJson: string | null;
  gitDefaultsJson: string | null;
  executionDefaultsJson: string | null;
  uiMetadataJson: string | null;
  createdAt: number;
  updatedAt: number;
};

export type WorkspaceSonarSettings = {
  workspaceId: string;
  enabled: number;
  providerType: string;
  hostUrl: string | null;
  organization: string | null;
  projectKey: string | null;
  token: string | null;
  defaultBranch: string | null;
  gatingMode: QualityGatingMode;
  validationStatus: IntegrationValidationStatus;
  lastTestedAt: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
};

export type WorkspaceCoderabbitSettings = {
  workspaceId: string;
  enabled: number;
  providerType: string;
  hostUrl: string | null;
  organization: string | null;
  repository: string | null;
  token: string | null;
  defaultBranch: string | null;
  gatingMode: QualityGatingMode;
  validationStatus: IntegrationValidationStatus;
  lastTestedAt: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
};

export const workspaceSetupCheckStatuses = ["ok", "warning", "missing", "blocked", "not_applicable"] as const;
export type WorkspaceSetupCheckStatus = (typeof workspaceSetupCheckStatuses)[number];

export const workspaceSetupStatuses = ["ready", "limited", "warning", "blocked"] as const;
export type WorkspaceSetupStatus = (typeof workspaceSetupStatuses)[number];

export const workspaceSetupAutonomyLevels = ["safe", "workspace-write", "setup-capable"] as const;
export type WorkspaceSetupAutonomyLevel = (typeof workspaceSetupAutonomyLevels)[number];

export type Item = {
  id: string;
  workspaceId: string;
  code: string;
  title: string;
  description: string;
  currentColumn: BoardColumn;
  phaseStatus: ItemPhaseStatus;
  createdAt: number;
  updatedAt: number;
};

export type Concept = {
  id: string;
  itemId: string;
  version: number;
  title: string;
  summary: string;
  status: RecordStatus;
  markdownArtifactId: string;
  structuredArtifactId: string;
  createdAt: number;
  updatedAt: number;
};

export type Project = {
  id: string;
  itemId: string;
  code: string;
  conceptId: string;
  title: string;
  summary: string;
  goal: string;
  status: RecordStatus;
  position: number;
  createdAt: number;
  updatedAt: number;
};

export type UserStory = {
  id: string;
  projectId: string;
  code: string;
  title: string;
  description: string;
  actor: string;
  goal: string;
  benefit: string;
  priority: string;
  status: RecordStatus;
  sourceArtifactId: string;
  createdAt: number;
  updatedAt: number;
};

export type AcceptanceCriterion = {
  id: string;
  storyId: string;
  code: string;
  text: string;
  position: number;
  createdAt: number;
  updatedAt: number;
};

export type ArchitecturePlan = {
  id: string;
  projectId: string;
  version: number;
  summary: string;
  status: RecordStatus;
  markdownArtifactId: string;
  structuredArtifactId: string;
  createdAt: number;
  updatedAt: number;
};

export type ImplementationPlan = {
  id: string;
  projectId: string;
  version: number;
  summary: string;
  status: RecordStatus;
  markdownArtifactId: string;
  structuredArtifactId: string;
  createdAt: number;
  updatedAt: number;
};

export type Wave = {
  id: string;
  implementationPlanId: string;
  code: string;
  goal: string;
  position: number;
  createdAt: number;
  updatedAt: number;
};

export type WaveStory = {
  id: string;
  waveId: string;
  storyId: string;
  parallelGroup: string | null;
  position: number;
  createdAt: number;
  updatedAt: number;
};

export type WaveStoryDependency = {
  blockingStoryId: string;
  dependentStoryId: string;
};

export type ProjectExecutionContext = {
  id: string;
  projectId: string;
  relevantDirectories: string[];
  relevantFiles: string[];
  integrationPoints: string[];
  testLocations: string[];
  repoConventions: string[];
  executionNotes: string[];
  createdAt: number;
  updatedAt: number;
};

export type ExecutionReadinessRun = {
  id: string;
  projectId: string;
  waveId: string | null;
  storyId: string | null;
  status: ExecutionReadinessRunStatus;
  profileKey: string;
  workspaceRoot: string;
  inputSnapshotJson: string;
  summaryJson: string | null;
  errorMessage: string | null;
  startedAt: number;
  updatedAt: number;
  completedAt: number | null;
};

export type ExecutionReadinessFinding = {
  id: string;
  runId: string;
  checkIteration: number;
  code: string;
  severity: ExecutionReadinessFindingSeverity;
  scopeType: string;
  scopePath: string | null;
  summary: string;
  detail: string;
  detectedBy: string;
  classification: ExecutionReadinessFindingClassification;
  recommendedAction: string | null;
  isAutoFixable: boolean;
  status: ExecutionReadinessFindingStatus;
  createdAt: number;
  updatedAt: number;
};

export type ExecutionReadinessAction = {
  id: string;
  runId: string;
  checkIteration: number;
  actionType: string;
  initiator: ExecutionReadinessActionInitiator;
  commandJson: string | null;
  cwd: string | null;
  status: ExecutionReadinessActionStatus;
  stdout: string | null;
  stderr: string | null;
  exitCode: number | null;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  completedAt: number | null;
};

export type VerificationReadinessRun = {
  id: string;
  projectId: string;
  waveId: string | null;
  storyId: string | null;
  status: VerificationReadinessRunStatus;
  profileKey: string;
  workspaceRoot: string;
  inputSnapshotJson: string;
  summaryJson: string | null;
  errorMessage: string | null;
  startedAt: number;
  updatedAt: number;
  completedAt: number | null;
};

export type VerificationReadinessFinding = {
  id: string;
  runId: string;
  checkIteration: number;
  code: string;
  severity: VerificationReadinessFindingSeverity;
  scopeType: string;
  scopePath: string | null;
  summary: string;
  detail: string;
  detectedBy: string;
  classification: VerificationReadinessFindingClassification;
  recommendedAction: string | null;
  isAutoFixable: boolean;
  status: VerificationReadinessFindingStatus;
  createdAt: number;
  updatedAt: number;
};

export type VerificationReadinessAction = {
  id: string;
  runId: string;
  checkIteration: number;
  actionType: string;
  initiator: VerificationReadinessActionInitiator;
  commandJson: string | null;
  cwd: string | null;
  status: VerificationReadinessActionStatus;
  stdout: string | null;
  stderr: string | null;
  exitCode: number | null;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  completedAt: number | null;
};

export type WaveExecution = {
  id: string;
  waveId: string;
  status: WaveExecutionStatus;
  attempt: number;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
};

export type WaveStoryExecution = {
  id: string;
  waveExecutionId: string;
  testPreparationRunId: string;
  waveStoryId: string;
  storyId: string;
  status: WaveStoryExecutionStatus;
  attempt: number;
  workerRole: ExecutionWorkerRole;
  systemPromptSnapshot: string;
  skillsSnapshotJson: string;
  businessContextSnapshotJson: string;
  repoContextSnapshotJson: string;
  gitBranchName: string | null;
  gitBaseRef: string | null;
  gitMetadataJson: string | null;
  outputSummaryJson: string | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
};

export type WaveStoryTestRun = {
  id: string;
  waveExecutionId: string;
  waveStoryId: string;
  storyId: string;
  status: WaveStoryTestRunStatus;
  attempt: number;
  workerRole: TestPreparationWorkerRole;
  systemPromptSnapshot: string;
  skillsSnapshotJson: string;
  businessContextSnapshotJson: string;
  repoContextSnapshotJson: string;
  outputSummaryJson: string | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
};

export type TestAgentSession = {
  id: string;
  waveStoryTestRunId: string;
  adapterKey: string;
  status: "running" | "completed" | "failed";
  commandJson: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  createdAt: number;
  updatedAt: number;
};

export type ExecutionAgentSession = {
  id: string;
  waveStoryExecutionId: string;
  adapterKey: string;
  status: "running" | "completed" | "failed";
  commandJson: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  createdAt: number;
  updatedAt: number;
};

export type VerificationRun = {
  id: string;
  waveExecutionId: string | null;
  waveStoryExecutionId: string | null;
  mode: VerificationRunMode;
  status: VerificationRunStatus;
  systemPromptSnapshot: string | null;
  skillsSnapshotJson: string | null;
  summaryJson: string;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
};

export type AppVerificationRun = {
  id: string;
  waveStoryExecutionId: string;
  status: AppVerificationRunStatus;
  runner: AppVerificationRunner;
  attempt: number;
  startedAt: number | null;
  completedAt: number | null;
  projectAppTestContextJson: string | null;
  storyContextJson: string | null;
  preparedSessionJson: string | null;
  resultJson: string | null;
  artifactsJson: string | null;
  failureSummary: string | null;
  createdAt: number;
  updatedAt: number;
};

export type StoryReviewRun = {
  id: string;
  waveStoryExecutionId: string;
  status: StoryReviewRunStatus;
  inputSnapshotJson: string;
  systemPromptSnapshot: string;
  skillsSnapshotJson: string;
  summaryJson: string | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
};

export type StoryReviewFinding = {
  id: string;
  storyReviewRunId: string;
  severity: StoryReviewFindingSeverity;
  category: StoryReviewFindingCategory;
  title: string;
  description: string;
  evidence: string;
  filePath: string | null;
  line: number | null;
  suggestedFix: string | null;
  status: StoryReviewFindingStatus;
  createdAt: number;
  updatedAt: number;
};

export type StoryReviewRemediationRun = {
  id: string;
  storyReviewRunId: string;
  waveStoryExecutionId: string;
  remediationWaveStoryExecutionId: string | null;
  storyId: string;
  status: RemediationRunStatus;
  attempt: number;
  workerRole: ExecutionWorkerRole;
  inputSnapshotJson: string;
  systemPromptSnapshot: string;
  skillsSnapshotJson: string;
  gitBranchName: string | null;
  gitBaseRef: string | null;
  gitMetadataJson: string | null;
  outputSummaryJson: string | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
};

export type StoryReviewRemediationFinding = {
  storyReviewRemediationRunId: string;
  storyReviewFindingId: string;
  resolutionStatus: RemediationResolutionStatus;
  createdAt: number;
  updatedAt: number;
};

export type StoryReviewRemediationAgentSession = {
  id: string;
  storyReviewRemediationRunId: string;
  adapterKey: string;
  status: "running" | "completed" | "failed";
  commandJson: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  createdAt: number;
  updatedAt: number;
};

export type StoryReviewAgentSession = {
  id: string;
  storyReviewRunId: string;
  adapterKey: string;
  status: "running" | "completed" | "failed";
  commandJson: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  createdAt: number;
  updatedAt: number;
};

export type QaRun = {
  id: string;
  projectId: string;
  mode: QaRunMode;
  status: QaRunStatus;
  inputSnapshotJson: string;
  systemPromptSnapshot: string;
  skillsSnapshotJson: string;
  summaryJson: string | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
};

export type QaFinding = {
  id: string;
  qaRunId: string;
  severity: QaFindingSeverity;
  category: QaFindingCategory;
  title: string;
  description: string;
  evidence: string;
  reproSteps: string[];
  suggestedFix: string | null;
  status: QaFindingStatus;
  storyId: string | null;
  acceptanceCriterionId: string | null;
  waveStoryExecutionId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type QaAgentSession = {
  id: string;
  qaRunId: string;
  adapterKey: string;
  status: "running" | "completed" | "failed";
  commandJson: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  createdAt: number;
  updatedAt: number;
};

export type QualityKnowledgeEntry = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  waveId: string | null;
  storyId: string | null;
  source: QualityKnowledgeSource;
  scopeType: QualityKnowledgeScopeType;
  scopeId: string;
  kind: QualityKnowledgeKind;
  summary: string;
  evidenceJson: string;
  status: string;
  relevanceTagsJson: string;
  createdAt: number;
  updatedAt: number;
};

export type DocumentationRun = {
  id: string;
  projectId: string;
  status: DocumentationRunStatus;
  inputSnapshotJson: string;
  systemPromptSnapshot: string;
  skillsSnapshotJson: string;
  staleAt: number | null;
  staleReason: string | null;
  summaryJson: string | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
};

export type InteractiveReviewSession = {
  id: string;
  scopeType: InteractiveReviewScopeType;
  scopeId: string;
  artifactType: InteractiveReviewArtifactType;
  reviewType: InteractiveReviewType;
  status: InteractiveReviewStatus;
  startedAt: number;
  updatedAt: number;
  resolvedAt: number | null;
  lastAssistantMessageId: string | null;
  lastUserMessageId: string | null;
};

export type InteractiveReviewMessage = {
  id: string;
  sessionId: string;
  role: InteractiveReviewMessageRole;
  content: string;
  structuredPayloadJson: string | null;
  derivedUpdatesJson: string | null;
  createdAt: number;
};

export type InteractiveReviewEntry = {
  id: string;
  sessionId: string;
  entryType: InteractiveReviewEntryType;
  entryId: string;
  title: string;
  status: InteractiveReviewEntryStatus;
  summary: string | null;
  changeRequest: string | null;
  rationale: string | null;
  severity: InteractiveReviewSeverity | null;
  createdAt: number;
  updatedAt: number;
};

export type InteractiveReviewResolution = {
  id: string;
  sessionId: string;
  resolutionType: InteractiveReviewResolutionType;
  payloadJson: string | null;
  createdAt: number;
  appliedAt: number | null;
};

export type BrainstormSession = {
  id: string;
  itemId: string;
  status: BrainstormSessionStatus;
  mode: BrainstormSessionMode;
  startedAt: number;
  updatedAt: number;
  resolvedAt: number | null;
  lastAssistantMessageId: string | null;
  lastUserMessageId: string | null;
};

export type BrainstormMessage = {
  id: string;
  sessionId: string;
  role: "system" | "assistant" | "user";
  content: string;
  createdAt: number;
  structuredPayloadJson: string | null;
  derivedUpdatesJson: string | null;
};

export type BrainstormDraft = {
  id: string;
  itemId: string;
  sessionId: string;
  revision: number;
  status: BrainstormDraftStatus;
  problem: string | null;
  targetUsersJson: string;
  coreOutcome: string | null;
  useCasesJson: string;
  constraintsJson: string;
  nonGoalsJson: string;
  risksJson: string;
  openQuestionsJson: string;
  candidateDirectionsJson: string;
  recommendedDirection: string | null;
  scopeNotes: string | null;
  assumptionsJson: string;
  lastUpdatedAt: number;
  lastUpdatedFromMessageId: string | null;
};

export type WorkspaceAssistSession = {
  id: string;
  workspaceId: string;
  status: WorkspaceAssistSessionStatus;
  currentPlanJson: string;
  startedAt: number;
  updatedAt: number;
  resolvedAt: number | null;
  lastAssistantMessageId: string | null;
  lastUserMessageId: string | null;
};

export type WorkspaceAssistMessage = {
  id: string;
  sessionId: string;
  role: WorkspaceAssistMessageRole;
  content: string;
  structuredPayloadJson: string | null;
  derivedPlanJson: string | null;
  createdAt: number;
};

export type ReviewRun = {
  id: string;
  reviewKind: ReviewKind;
  subjectType: string;
  subjectId: string;
  subjectStep: string | null;
  status: ReviewRunStatus;
  readiness: string | null;
  interactionMode: ReviewInteractionMode | null;
  reviewMode: string | null;
  automationLevel: PlanningReviewAutomationLevel;
  requestedMode: string | null;
  actualMode: string | null;
  confidence: string | null;
  gateEligibility: PlanningReviewGateEligibility;
  sourceSummaryJson: string;
  providersUsedJson: string;
  missingCapabilitiesJson: string;
  reviewSummary: string | null;
  startedAt: number;
  updatedAt: number;
  completedAt: number | null;
  failedReason: string | null;
};

export type ReviewFinding = {
  id: string;
  runId: string;
  sourceSystem: ReviewSourceSystem;
  reviewerRole: string | null;
  findingType: string;
  normalizedSeverity: ReviewFindingSeverity;
  sourceSeverity: string | null;
  title: string;
  detail: string;
  evidence: string | null;
  status: ReviewFindingStatus;
  fingerprint: string;
  filePath: string | null;
  line: number | null;
  fieldPath: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ReviewSynthesis = {
  id: string;
  runId: string;
  summary: string;
  status: ReviewRunStatus;
  readiness: string;
  keyPointsJson: string;
  disagreementsJson: string;
  recommendedAction: string;
  gateDecision: ReviewGateDecision;
  createdAt: number;
};

export type ReviewQuestion = {
  id: string;
  runId: string;
  question: string;
  reason: string;
  impact: string;
  status: ReviewQuestionStatus;
  answer: string | null;
  createdAt: number;
  updatedAt: number;
  answeredAt: number | null;
};

export type ReviewAssumption = {
  id: string;
  runId: string;
  statement: string;
  reason: string;
  source: string;
  createdAt: number;
};

export type DocumentationAgentSession = {
  id: string;
  documentationRunId: string;
  adapterKey: string;
  status: "running" | "completed" | "failed";
  commandJson: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  createdAt: number;
  updatedAt: number;
};

export type ItemWorkflowSnapshot = {
  hasApprovedConcept: boolean;
  projectCount: number;
  allStoriesApproved: boolean;
  allImplementationPlansApproved: boolean;
};
