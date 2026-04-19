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

export const waveStoryTestRunStatuses = ["pending", "running", "review_required", "completed", "failed"] as const;
export type WaveStoryTestRunStatus = (typeof waveStoryTestRunStatuses)[number];

export const verificationRunStatuses = ["passed", "review_required", "failed"] as const;
export type VerificationRunStatus = (typeof verificationRunStatuses)[number];

export const verificationRunModes = ["basic", "ralph"] as const;
export type VerificationRunMode = (typeof verificationRunModes)[number];

export const qaRunModes = ["functional", "security", "regression", "full"] as const;
export type QaRunMode = (typeof qaRunModes)[number];

export const qaRunStatuses = ["running", "review_required", "passed", "failed"] as const;
export type QaRunStatus = (typeof qaRunStatuses)[number];

export const documentationRunStatuses = ["running", "review_required", "completed", "failed"] as const;
export type DocumentationRunStatus = (typeof documentationRunStatuses)[number];

export const qaFindingSeverities = ["critical", "high", "medium", "low"] as const;
export type QaFindingSeverity = (typeof qaFindingSeverities)[number];

export const qaFindingCategories = ["functional", "security", "regression", "ux"] as const;
export type QaFindingCategory = (typeof qaFindingCategories)[number];

export const qaFindingStatuses = ["open", "in_progress", "accepted", "resolved", "false_positive"] as const;
export type QaFindingStatus = (typeof qaFindingStatuses)[number];

export const storyReviewRunStatuses = ["running", "review_required", "passed", "failed"] as const;
export type StoryReviewRunStatus = (typeof storyReviewRunStatuses)[number];

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
  headBefore: string | null;
  headAfter: string | null;
  commitSha: string | null;
  mergedIntoRef: string | null;
  mergedCommitSha: string | null;
  strategy: "applied" | "simulated";
  reason: string | null;
};

export type Item = {
  id: string;
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
