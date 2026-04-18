import type { ExecutionWorkerRole, StageKey } from "../domain/types.js";
import type { StoryExecutionOutput } from "../schemas/output-contracts.js";

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
};

export type ExecutionAdapterRunResult = {
  output: StoryExecutionOutput;
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string[];
};

export interface AgentAdapter {
  readonly key: string;
  run(request: AdapterRunRequest): Promise<AdapterRunResult>;
  runStoryExecution(request: ExecutionAdapterRunRequest): Promise<ExecutionAdapterRunResult>;
}
