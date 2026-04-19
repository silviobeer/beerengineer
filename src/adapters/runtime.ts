import { existsSync, readFileSync } from "node:fs";

import { ZodError, z } from "zod";

import type { StageKey } from "../domain/types.js";
import { AppError } from "../shared/errors.js";
import type { WorkerProfileKey } from "../workflow/worker-profiles.js";
import { CodexCliAdapter } from "./hosted/providers/codex-adapter.js";
import { ClaudeCliAdapter } from "./hosted/providers/claude-adapter.js";
import { LocalCliAdapter } from "./local-cli-adapter.js";
import type { AgentAdapter, AgentExecutionPolicy } from "./types.js";

export type InteractiveFlowKey = "brainstorm_chat" | "story_review_chat";

export type AgentRuntimeWorkerKey =
  | "test_preparation"
  | "execution"
  | "ralph"
  | "app_verification"
  | "story_review"
  | "story_review_remediation"
  | "qa"
  | "documentation";

export const runtimeWorkerKeyByProfileKey: Record<WorkerProfileKey, AgentRuntimeWorkerKey> = {
  testPreparation: "test_preparation",
  execution: "execution",
  ralph: "ralph",
  appVerification: "app_verification",
  storyReview: "story_review",
  storyReviewRemediation: "story_review_remediation",
  qa: "qa",
  documentation: "documentation"
};

export const requiredAgentExecutionPolicy: AgentExecutionPolicy = {
  autonomyMode: "yolo",
  approvalMode: "never",
  filesystemMode: "danger-full-access",
  networkMode: "enabled",
  interactionMode: "non_blocking"
};

const agentExecutionPolicySchema = z.object({
  autonomyMode: z.literal("yolo"),
  approvalMode: z.literal("never"),
  filesystemMode: z.literal("danger-full-access"),
  networkMode: z.literal("enabled"),
  interactionMode: z.literal("non_blocking")
}).strict();

const providerSelectionSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1).nullable().optional()
}).strict();

const providerConfigSchema = z.object({
  adapterKey: z.enum(["local-cli", "codex", "claude"]),
  model: z.string().min(1).nullable().optional(),
  command: z.array(z.string().min(1)).min(1),
  env: z.record(z.string(), z.string()).default({}),
  timeoutMs: z.number().int().positive().default(120_000)
}).strict();

const agentRuntimeConfigSchema = z.object({
  defaultProvider: z.string().min(1),
  policy: agentExecutionPolicySchema,
  defaults: z.object({
    interactive: providerSelectionSchema.optional(),
    autonomous: providerSelectionSchema.optional()
  }).strict(),
  interactive: z.object({
    brainstorm_chat: providerSelectionSchema.optional(),
    story_review_chat: providerSelectionSchema.optional()
  }).strict().default({}),
  stages: z.object({
    brainstorm: providerSelectionSchema.optional(),
    requirements: providerSelectionSchema.optional(),
    architecture: providerSelectionSchema.optional(),
    planning: providerSelectionSchema.optional()
  }).strict().default({}),
  workers: z.object({
    test_preparation: providerSelectionSchema.optional(),
    execution: providerSelectionSchema.optional(),
    ralph: providerSelectionSchema.optional(),
    app_verification: providerSelectionSchema.optional(),
    story_review: providerSelectionSchema.optional(),
    story_review_remediation: providerSelectionSchema.optional(),
    qa: providerSelectionSchema.optional(),
    documentation: providerSelectionSchema.optional()
  }).strict().default({}),
  providers: z.record(z.string().min(1), providerConfigSchema)
}).strict();

export type AgentRuntimeConfig = z.infer<typeof agentRuntimeConfigSchema>;

export type ResolvedAgentRuntime = {
  providerKey: string;
  adapterKey: string;
  model: string | null;
  command: string[];
  env: Record<string, string>;
  timeoutMs: number;
  policy: AgentExecutionPolicy;
  adapter: AgentAdapter;
};

class UnsupportedProviderAdapter implements AgentAdapter {
  public constructor(
    public readonly key: string,
    private readonly providerKey: string
  ) {}

  private fail(): never {
    throw new AppError(
      "AGENT_PROVIDER_NOT_IMPLEMENTED",
      `Provider ${this.providerKey} (${this.key}) is configured but not implemented yet`
    );
  }

  public async run() {
    return this.fail();
  }

  public async runInteractiveBrainstorm() {
    return this.fail();
  }

  public async runInteractiveStoryReview() {
    return this.fail();
  }

  public async runStoryTestPreparation() {
    return this.fail();
  }

  public async runStoryExecution() {
    return this.fail();
  }

  public async runStoryRalphVerification() {
    return this.fail();
  }

  public async runStoryAppVerification() {
    return this.fail();
  }

  public async runStoryReview() {
    return this.fail();
  }

  public async runProjectQa() {
    return this.fail();
  }

  public async runProjectDocumentation() {
    return this.fail();
  }
}
export function loadAgentRuntimeConfig(configPath: string): AgentRuntimeConfig {
  if (!existsSync(configPath)) {
    throw new AppError("AGENT_RUNTIME_CONFIG_NOT_FOUND", `Agent runtime config ${configPath} not found`);
  }

  const raw = readFileSync(configPath, "utf8");
  const parsedJson = JSON.parse(raw) as unknown;
  let parsed: AgentRuntimeConfig;
  try {
    parsed = agentRuntimeConfigSchema.parse(parsedJson);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new AppError("AGENT_RUNTIME_CONFIG_INVALID", error.issues.map((issue) => issue.message).join("; "));
    }
    throw error;
  }

  if (!parsed.providers[parsed.defaultProvider]) {
    throw new AppError(
      "AGENT_RUNTIME_CONFIG_INVALID",
      `Default provider ${parsed.defaultProvider} is not defined in providers`
    );
  }

  for (const selection of [
    parsed.defaults.interactive,
    parsed.defaults.autonomous,
    parsed.interactive.brainstorm_chat,
    parsed.interactive.story_review_chat,
    parsed.stages.brainstorm,
    parsed.stages.requirements,
    parsed.stages.architecture,
    parsed.stages.planning,
    parsed.workers.test_preparation,
    parsed.workers.execution,
    parsed.workers.ralph,
    parsed.workers.app_verification,
    parsed.workers.story_review,
    parsed.workers.story_review_remediation,
    parsed.workers.qa,
    parsed.workers.documentation
  ]) {
    if (selection && !parsed.providers[selection.provider]) {
      throw new AppError(
        "AGENT_RUNTIME_CONFIG_INVALID",
        `Selected provider ${selection.provider} is not defined in providers`
      );
    }
  }

  return parsed;
}

function createProviderAdapter(input: {
  providerKey: string;
  providerConfig: AgentRuntimeConfig["providers"][string];
  repoRoot: string;
  adapterScriptPath?: string;
}): AgentAdapter {
  if (input.providerConfig.adapterKey === "local-cli") {
    return new LocalCliAdapter(input.repoRoot, input.adapterScriptPath, input.providerConfig.timeoutMs);
  }
  if (input.providerConfig.adapterKey === "codex") {
    return new CodexCliAdapter(input.providerConfig.command, input.providerConfig.env, input.providerConfig.timeoutMs);
  }
  if (input.providerConfig.adapterKey === "claude") {
    return new ClaudeCliAdapter(input.providerConfig.command, input.providerConfig.env, input.providerConfig.timeoutMs);
  }
  return new UnsupportedProviderAdapter(input.providerConfig.adapterKey, input.providerKey);
}

export class AgentRuntimeResolver {
  private readonly adaptersByProviderKey: Map<string, AgentAdapter>;

  public constructor(
    public readonly config: AgentRuntimeConfig,
    input: {
      repoRoot: string;
      adapterScriptPath?: string;
    }
  ) {
    this.adaptersByProviderKey = new Map(
      Object.entries(config.providers).map(([providerKey, providerConfig]) => [
        providerKey,
        createProviderAdapter({
          providerKey,
          providerConfig,
          repoRoot: input.repoRoot,
          adapterScriptPath: input.adapterScriptPath
        })
      ])
    );
  }

  public resolveDefault(mode: "interactive" | "autonomous"): ResolvedAgentRuntime {
    return this.resolveFromSelection(
      this.config.defaults[mode] ?? {
        provider: this.config.defaultProvider
      }
    );
  }

  public resolveInteractive(flow: InteractiveFlowKey): ResolvedAgentRuntime {
    return this.resolveFromSelection(
      this.config.interactive[flow] ??
        this.config.defaults.interactive ?? {
          provider: this.config.defaultProvider
        }
    );
  }

  public resolveStage(stageKey: StageKey): ResolvedAgentRuntime {
    return this.resolveFromSelection(
      this.config.stages[stageKey] ??
        this.config.defaults.autonomous ?? {
          provider: this.config.defaultProvider
        }
    );
  }

  public resolveWorker(workerKey: AgentRuntimeWorkerKey): ResolvedAgentRuntime {
    return this.resolveFromSelection(
      this.config.workers[workerKey] ??
        this.config.defaults.autonomous ?? {
          provider: this.config.defaultProvider
        }
    );
  }

  private resolveFromSelection(selection: {
    provider: string;
    model?: string | null;
  }): ResolvedAgentRuntime {
    const providerConfig = this.config.providers[selection.provider];
    if (!providerConfig) {
      throw new AppError(
        "AGENT_RUNTIME_CONFIG_INVALID",
        `Selected provider ${selection.provider} is not defined in providers`
      );
    }
    const adapter = this.adaptersByProviderKey.get(selection.provider)!;
    const model = selection.model ?? providerConfig.model ?? null;
    return {
      providerKey: selection.provider,
      adapterKey: providerConfig.adapterKey,
      model,
      command: providerConfig.command,
      env: providerConfig.env,
      timeoutMs: providerConfig.timeoutMs,
      policy: this.config.policy,
      adapter
    };
  }
}
