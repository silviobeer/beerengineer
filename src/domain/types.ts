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

export const stageKeys = ["brainstorm", "requirements", "architecture"] as const;
export type StageKey = (typeof stageKeys)[number];

export const stageRunStatuses = [
  "pending",
  "running",
  "completed",
  "failed",
  "review_required"
] as const;

export type StageRunStatus = (typeof stageRunStatuses)[number];

export type Item = {
  id: string;
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
  title: string;
  description: string;
  actor: string;
  goal: string;
  benefit: string;
  acceptanceCriteriaJson: string;
  priority: string;
  status: RecordStatus;
  sourceArtifactId: string;
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

export type ItemWorkflowSnapshot = {
  hasApprovedConcept: boolean;
  projectCount: number;
  allStoriesApproved: boolean;
  allArchitectureApproved: boolean;
};
