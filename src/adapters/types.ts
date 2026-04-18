import type { StageKey } from "../domain/types.js";

export type AdapterRunRequest = {
  stageKey: StageKey;
  prompt: string;
  skills: Array<{ path: string; content: string }>;
  item: {
    id: string;
    title: string;
    description: string;
  };
  project?: {
    id: string;
    title: string;
    summary: string;
    goal: string;
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

export interface AgentAdapter {
  readonly key: string;
  run(request: AdapterRunRequest): Promise<AdapterRunResult>;
}
