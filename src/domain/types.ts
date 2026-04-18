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

export const executionWorkerRoles = ["implementer", "backend-implementer", "frontend-implementer"] as const;
export type ExecutionWorkerRole = (typeof executionWorkerRoles)[number];

export const testPreparationWorkerRoles = ["test-writer"] as const;
export type TestPreparationWorkerRole = (typeof testPreparationWorkerRoles)[number];

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
  businessContextSnapshotJson: string;
  repoContextSnapshotJson: string;
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
  status: VerificationRunStatus;
  summaryJson: string;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ItemWorkflowSnapshot = {
  hasApprovedConcept: boolean;
  projectCount: number;
  allStoriesApproved: boolean;
  allImplementationPlansApproved: boolean;
};
