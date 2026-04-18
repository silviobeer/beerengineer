import type {
  ExecutionWorkerRole,
  StoryReviewWorkerRole,
  StageKey,
  TestPreparationWorkerRole,
  VerificationRunStatus,
  VerificationWorkerRole
} from "../domain/types.js";
import type {
  RalphVerificationOutput,
  QaOutput,
  StoryReviewOutput,
  StoryExecutionOutput,
  TestPreparationOutput
} from "../schemas/output-contracts.js";

export type AdapterRunRequest = {
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
    architectureSummary?: string | null;
    stories?: Array<{
      code: string;
      title: string;
      priority: string;
      acceptanceCriteria: Array<{ code: string; text: string }>;
    }>;
  } | null;
};

export type AdapterRunResult = {
  markdownArtifacts: Array<{ kind: string; content: string }>;
  structuredArtifacts: Array<{ kind: string; content: unknown }>;
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string[];
};

export type ExecutionAdapterRunRequest = {
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

export type QaAdapterRunRequest = {
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

export type StoryReviewAdapterRunRequest = {
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
  runStoryTestPreparation(request: TestPreparationAdapterRunRequest): Promise<TestPreparationAdapterRunResult>;
  runStoryExecution(request: ExecutionAdapterRunRequest): Promise<ExecutionAdapterRunResult>;
  runStoryRalphVerification(request: RalphVerificationAdapterRunRequest): Promise<RalphVerificationAdapterRunResult>;
  runStoryReview(request: StoryReviewAdapterRunRequest): Promise<StoryReviewAdapterRunResult>;
  runProjectQa?(request: QaAdapterRunRequest): Promise<QaAdapterRunResult>;
}
