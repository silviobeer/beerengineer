import type { AdapterRuntimeContext, AgentAdapter } from "../adapters/types.js";

export type ResolvedWorkerProfile = {
  promptContent: string;
  skills: Array<{ path: string; content: string }>;
};

export type ResolvedWorkerRuntime = {
  providerKey: string;
  adapterKey: string;
  model: string | null;
  policy: AdapterRuntimeContext["policy"];
  adapter: AgentAdapter;
};

export type BuildAdapterRuntimeContext = (input: {
  providerKey: string;
  model: string | null;
  policy: AdapterRuntimeContext["policy"];
  workspaceRoot?: string;
}) => AdapterRuntimeContext;
