import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ZodError, z } from "zod";

import type {
  AgentRuntimeConfig,
  AgentRuntimeConfigOverride,
  InteractiveFlowKey
} from "../adapters/runtime.js";
import { loadAgentRuntimeConfigFromObject } from "../adapters/runtime.js";
import { stageKeys, type StageKey } from "../domain/types.js";
import { AppError } from "./errors.js";

export const workspaceRuntimeProfileBuiltInKeys = ["codex_primary", "claude_primary"] as const;
export type WorkspaceRuntimeProfileBuiltInKey = (typeof workspaceRuntimeProfileBuiltInKeys)[number];

const workspaceRuntimeDefaultModes = ["interactive", "autonomous"] as const;
export type WorkspaceRuntimeDefaultMode = (typeof workspaceRuntimeDefaultModes)[number];

const workspaceRuntimeInteractiveFlowKeys = ["brainstorm_chat", "story_review_chat"] as const;

export const workspaceRuntimeWorkerKeys = [
  "test_preparation",
  "execution",
  "ralph",
  "app_verification",
  "story_review",
  "story_review_remediation",
  "qa",
  "documentation"
] as const;
export type WorkspaceRuntimeWorkerKey = (typeof workspaceRuntimeWorkerKeys)[number];

const workspaceRuntimeProfileMetaSourceValues = ["builtin", "workspace_custom"] as const;
export type WorkspaceRuntimeProfileMetaSource = (typeof workspaceRuntimeProfileMetaSourceValues)[number];

const providerSelectionSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1).nullable().optional()
  })
  .strict();

const workspaceRuntimeProfileVersionSchema = z.number().int();

const workspaceRuntimeProfileSchema = z
  .object({
    version: z.literal(1),
    profileKey: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    defaultProvider: z.string().min(1).optional(),
    defaults: z
      .object({
        interactive: providerSelectionSchema.optional(),
        autonomous: providerSelectionSchema.optional()
      })
      .strict()
      .optional(),
    interactive: z
      .object({
        brainstorm_chat: providerSelectionSchema.optional(),
        story_review_chat: providerSelectionSchema.optional()
      })
      .strict()
      .optional(),
    stages: z
      .object({
        brainstorm: providerSelectionSchema.optional(),
        requirements: providerSelectionSchema.optional(),
        architecture: providerSelectionSchema.optional(),
        planning: providerSelectionSchema.optional()
      })
      .strict()
      .optional(),
    workers: z
      .object({
        test_preparation: providerSelectionSchema.optional(),
        execution: providerSelectionSchema.optional(),
        ralph: providerSelectionSchema.optional(),
        app_verification: providerSelectionSchema.optional(),
        story_review: providerSelectionSchema.optional(),
        story_review_remediation: providerSelectionSchema.optional(),
        qa: providerSelectionSchema.optional(),
        documentation: providerSelectionSchema.optional()
      })
      .strict()
      .optional(),
    meta: z
      .object({
        source: z.enum(workspaceRuntimeProfileMetaSourceValues).optional(),
        description: z.string().min(1).optional()
      })
      .strict()
      .optional()
  })
  .strict();

export type WorkspaceRuntimeSelection = z.infer<typeof providerSelectionSchema>;
export type WorkspaceRuntimeProfile = z.infer<typeof workspaceRuntimeProfileSchema>;

export type WorkspaceRuntimeProfileSource =
  | { kind: "builtin"; profileKey: WorkspaceRuntimeProfileBuiltInKey; path: string }
  | { kind: "workspace_settings"; workspaceKey: string }
  | { kind: "cli_override"; label: string };

export type WorkspaceRuntimeConfigLayerSource = "global" | "workspace_profile" | "cli_override";

export type WorkspaceRuntimeSlotSources = {
  defaultProvider: WorkspaceRuntimeConfigLayerSource;
  defaults: Record<WorkspaceRuntimeDefaultMode, WorkspaceRuntimeConfigLayerSource>;
  interactive: Record<InteractiveFlowKey, WorkspaceRuntimeConfigLayerSource>;
  stages: Record<StageKey, WorkspaceRuntimeConfigLayerSource>;
  workers: Record<WorkspaceRuntimeWorkerKey, WorkspaceRuntimeConfigLayerSource>;
};

export type WorkspaceRuntimeCompatibility = {
  valid: boolean;
  missingProviders: string[];
  issues: string[];
};

export type ResolvedWorkspaceRuntimeConfig = {
  config: AgentRuntimeConfig;
  sources: WorkspaceRuntimeSlotSources;
};

const builtInProfilePathByKey: Record<WorkspaceRuntimeProfileBuiltInKey, string> = {
  codex_primary: "config/runtime-profiles/codex-primary.json",
  claude_primary: "config/runtime-profiles/claude-primary.json"
};

function formatWorkspaceRuntimeProfileSource(source: WorkspaceRuntimeProfileSource): string {
  if (source.kind === "builtin") {
    return `built-in profile ${source.profileKey} (${source.path})`;
  }
  if (source.kind === "workspace_settings") {
    return `workspace_settings.runtime_profile_json for workspace ${source.workspaceKey}`;
  }
  return source.label;
}

function parseWorkspaceRuntimeProfileObject(parsedJson: unknown, source: WorkspaceRuntimeProfileSource): WorkspaceRuntimeProfile {
  const formattedSource = formatWorkspaceRuntimeProfileSource(source);
  const versionResult = workspaceRuntimeProfileVersionSchema.safeParse(
    typeof parsedJson === "object" && parsedJson !== null ? (parsedJson as Record<string, unknown>).version : undefined
  );
  if (!versionResult.success) {
    throw new AppError(
      "WORKSPACE_RUNTIME_PROFILE_INVALID",
      `Workspace runtime profile from ${formattedSource} is invalid: version is required and must be an integer.`
    );
  }
  if (versionResult.data !== 1) {
    throw new AppError(
      "WORKSPACE_RUNTIME_PROFILE_INVALID",
      `Workspace runtime profile from ${formattedSource} has unsupported version ${versionResult.data}; only version: 1 is supported.`
    );
  }

  try {
    return workspaceRuntimeProfileSchema.parse(parsedJson);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new AppError(
        "WORKSPACE_RUNTIME_PROFILE_INVALID",
        `Workspace runtime profile from ${formattedSource} is invalid: ${error.issues.map((issue) => issue.message).join("; ")}`
      );
    }
    throw error;
  }
}

export function loadWorkspaceRuntimeProfileFromJsonString(
  profileJson: string,
  source: WorkspaceRuntimeProfileSource
): WorkspaceRuntimeProfile {
  try {
    return parseWorkspaceRuntimeProfileObject(JSON.parse(profileJson) as unknown, source);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new AppError(
        "WORKSPACE_RUNTIME_PROFILE_INVALID",
        `Workspace runtime profile from ${formatWorkspaceRuntimeProfileSource(source)} contains invalid JSON.`
      );
    }
    throw error;
  }
}

export function loadBuiltInWorkspaceRuntimeProfile(
  repoRoot: string,
  profileKey: WorkspaceRuntimeProfileBuiltInKey
): WorkspaceRuntimeProfile {
  const path = getBuiltInWorkspaceRuntimeProfilePath(repoRoot, profileKey);
  return loadWorkspaceRuntimeProfileFromJsonString(readFileSync(path, "utf8"), {
    kind: "builtin",
    profileKey,
    path
  });
}

function profileToRuntimeOverride(profile: WorkspaceRuntimeProfile | null | undefined): AgentRuntimeConfigOverride {
  if (!profile) {
    return {};
  }
  return {
    ...("defaultProvider" in profile ? { defaultProvider: profile.defaultProvider } : {}),
    ...("defaults" in profile ? { defaults: profile.defaults } : {}),
    ...("interactive" in profile ? { interactive: profile.interactive } : {}),
    ...("stages" in profile ? { stages: profile.stages } : {}),
    ...("workers" in profile ? { workers: profile.workers } : {})
  };
}

function mergeProviders(
  base: AgentRuntimeConfig["providers"],
  override?: AgentRuntimeConfigOverride["providers"]
): AgentRuntimeConfig["providers"] {
  if (!override) {
    return base;
  }
  const mergedProviders: AgentRuntimeConfig["providers"] = { ...base };
  for (const [providerKey, providerOverride] of Object.entries(override)) {
    if (!providerOverride) {
      continue;
    }
    mergedProviders[providerKey] = {
      ...(base[providerKey] ?? {}),
      ...providerOverride
    } as AgentRuntimeConfig["providers"][string];
  }
  return mergedProviders;
}

function mergeRuntimeConfig(base: AgentRuntimeConfig, override: AgentRuntimeConfigOverride): AgentRuntimeConfig {
  return loadAgentRuntimeConfigFromObject({
    ...base,
    ...override,
    policy: {
      ...base.policy,
      ...(override.policy ?? {})
    },
    defaults: {
      ...base.defaults,
      ...(override.defaults ?? {})
    },
    interactive: {
      ...base.interactive,
      ...(override.interactive ?? {})
    },
    stages: {
      ...base.stages,
      ...(override.stages ?? {})
    },
    workers: {
      ...base.workers,
      ...(override.workers ?? {})
    },
    providers: mergeProviders(base.providers, override.providers)
  });
}

function sourceForSlot<TSelection extends WorkspaceRuntimeSelection | undefined>(
  selection: TSelection,
  definedSource: WorkspaceRuntimeConfigLayerSource
): WorkspaceRuntimeConfigLayerSource {
  return selection ? definedSource : "global";
}

export function validateWorkspaceRuntimeProfileCompatibility(
  globalRuntimeConfig: AgentRuntimeConfig,
  profile: WorkspaceRuntimeProfile
): WorkspaceRuntimeCompatibility {
  const providers = new Set<string>();
  if (profile.defaultProvider) {
    providers.add(profile.defaultProvider);
  }
  for (const selection of [
    profile.defaults?.interactive,
    profile.defaults?.autonomous,
    profile.interactive?.brainstorm_chat,
    profile.interactive?.story_review_chat,
    profile.stages?.brainstorm,
    profile.stages?.requirements,
    profile.stages?.architecture,
    profile.stages?.planning,
    profile.workers?.test_preparation,
    profile.workers?.execution,
    profile.workers?.ralph,
    profile.workers?.app_verification,
    profile.workers?.story_review,
    profile.workers?.story_review_remediation,
    profile.workers?.qa,
    profile.workers?.documentation
  ]) {
    if (selection) {
      providers.add(selection.provider);
    }
  }

  const missingProviders = Array.from(providers).filter((providerKey) => !globalRuntimeConfig.providers[providerKey]);
  return {
    valid: missingProviders.length === 0,
    missingProviders,
    issues: missingProviders.map((providerKey) => `Provider ${providerKey} is not defined in the global runtime config.`)
  };
}

export function assertWorkspaceRuntimeProfileCompatibility(
  globalRuntimeConfig: AgentRuntimeConfig,
  profile: WorkspaceRuntimeProfile,
  source: WorkspaceRuntimeProfileSource
): void {
  const compatibility = validateWorkspaceRuntimeProfileCompatibility(globalRuntimeConfig, profile);
  if (!compatibility.valid) {
    throw new AppError(
      "WORKSPACE_RUNTIME_PROFILE_INCOMPATIBLE",
      `Workspace runtime profile from ${formatWorkspaceRuntimeProfileSource(source)} references undefined providers: ${compatibility.missingProviders.join(", ")}`
    );
  }
}

export function resolveWorkspaceRuntimeConfig(input: {
  globalRuntimeConfig: AgentRuntimeConfig;
  workspaceProfile?: WorkspaceRuntimeProfile | null;
  cliOverride?: WorkspaceRuntimeProfile | null;
}): ResolvedWorkspaceRuntimeConfig {
  const workspaceOverride = profileToRuntimeOverride(input.workspaceProfile);
  const cliOverride = profileToRuntimeOverride(input.cliOverride);
  const withWorkspaceProfile = mergeRuntimeConfig(input.globalRuntimeConfig, workspaceOverride);
  const config = mergeRuntimeConfig(withWorkspaceProfile, cliOverride);

  return {
    config,
    sources: {
      defaultProvider: input.cliOverride?.defaultProvider
        ? "cli_override"
        : input.workspaceProfile?.defaultProvider
          ? "workspace_profile"
          : "global",
      defaults: {
        interactive: input.cliOverride?.defaults?.interactive
          ? "cli_override"
          : sourceForSlot(input.workspaceProfile?.defaults?.interactive, "workspace_profile"),
        autonomous: input.cliOverride?.defaults?.autonomous
          ? "cli_override"
          : sourceForSlot(input.workspaceProfile?.defaults?.autonomous, "workspace_profile")
      },
      interactive: {
        brainstorm_chat: input.cliOverride?.interactive?.brainstorm_chat
          ? "cli_override"
          : sourceForSlot(input.workspaceProfile?.interactive?.brainstorm_chat, "workspace_profile"),
        story_review_chat: input.cliOverride?.interactive?.story_review_chat
          ? "cli_override"
          : sourceForSlot(input.workspaceProfile?.interactive?.story_review_chat, "workspace_profile")
      },
      stages: {
        brainstorm: input.cliOverride?.stages?.brainstorm
          ? "cli_override"
          : sourceForSlot(input.workspaceProfile?.stages?.brainstorm, "workspace_profile"),
        requirements: input.cliOverride?.stages?.requirements
          ? "cli_override"
          : sourceForSlot(input.workspaceProfile?.stages?.requirements, "workspace_profile"),
        architecture: input.cliOverride?.stages?.architecture
          ? "cli_override"
          : sourceForSlot(input.workspaceProfile?.stages?.architecture, "workspace_profile"),
        planning: input.cliOverride?.stages?.planning
          ? "cli_override"
          : sourceForSlot(input.workspaceProfile?.stages?.planning, "workspace_profile")
      },
      workers: {
        test_preparation: input.cliOverride?.workers?.test_preparation
          ? "cli_override"
          : sourceForSlot(input.workspaceProfile?.workers?.test_preparation, "workspace_profile"),
        execution: input.cliOverride?.workers?.execution
          ? "cli_override"
          : sourceForSlot(input.workspaceProfile?.workers?.execution, "workspace_profile"),
        ralph: input.cliOverride?.workers?.ralph
          ? "cli_override"
          : sourceForSlot(input.workspaceProfile?.workers?.ralph, "workspace_profile"),
        app_verification: input.cliOverride?.workers?.app_verification
          ? "cli_override"
          : sourceForSlot(input.workspaceProfile?.workers?.app_verification, "workspace_profile"),
        story_review: input.cliOverride?.workers?.story_review
          ? "cli_override"
          : sourceForSlot(input.workspaceProfile?.workers?.story_review, "workspace_profile"),
        story_review_remediation: input.cliOverride?.workers?.story_review_remediation
          ? "cli_override"
          : sourceForSlot(input.workspaceProfile?.workers?.story_review_remediation, "workspace_profile"),
        qa: input.cliOverride?.workers?.qa
          ? "cli_override"
          : sourceForSlot(input.workspaceProfile?.workers?.qa, "workspace_profile"),
        documentation: input.cliOverride?.workers?.documentation
          ? "cli_override"
          : sourceForSlot(input.workspaceProfile?.workers?.documentation, "workspace_profile")
      }
    }
  };
}

export function createEmptyWorkspaceRuntimeProfile(): WorkspaceRuntimeProfile {
  return {
    version: 1,
    meta: {
      source: "workspace_custom"
    }
  };
}

export function withWorkspaceRuntimeStageSelection(
  profile: WorkspaceRuntimeProfile,
  stage: StageKey,
  selection: WorkspaceRuntimeSelection
): WorkspaceRuntimeProfile {
  return {
    ...profile,
    stages: {
      ...(profile.stages ?? {}),
      [stage]: selection
    }
  };
}

export function withWorkspaceRuntimeWorkerSelection(
  profile: WorkspaceRuntimeProfile,
  worker: WorkspaceRuntimeWorkerKey,
  selection: WorkspaceRuntimeSelection
): WorkspaceRuntimeProfile {
  return {
    ...profile,
    workers: {
      ...(profile.workers ?? {}),
      [worker]: selection
    }
  };
}

export function withWorkspaceRuntimeInteractiveSelection(
  profile: WorkspaceRuntimeProfile,
  flow: InteractiveFlowKey,
  selection: WorkspaceRuntimeSelection
): WorkspaceRuntimeProfile {
  return {
    ...profile,
    interactive: {
      ...(profile.interactive ?? {}),
      [flow]: selection
    }
  };
}

export function convertWorkspaceRuntimeProfileToCustom(profile: WorkspaceRuntimeProfile): WorkspaceRuntimeProfile {
  return {
    ...profile,
    profileKey: undefined,
    meta: {
      ...profile.meta,
      source: "workspace_custom"
    }
  };
}

export function getBuiltInWorkspaceRuntimeProfilePath(
  repoRoot: string,
  profileKey: WorkspaceRuntimeProfileBuiltInKey
): string {
  const relativePath = builtInProfilePathByKey[profileKey];
  if (!relativePath) {
    throw new AppError("WORKSPACE_RUNTIME_PROFILE_NOT_FOUND", `Unknown built-in workspace runtime profile ${profileKey}.`);
  }
  return resolve(repoRoot, relativePath);
}

export function assertWorkspaceRuntimeStageKey(stage: string): asserts stage is StageKey {
  if (!(stageKeys as readonly string[]).includes(stage)) {
    throw new AppError("WORKSPACE_RUNTIME_SLOT_INVALID", `Unknown stage ${stage}.`);
  }
}

export function assertWorkspaceRuntimeWorkerKey(worker: string): asserts worker is WorkspaceRuntimeWorkerKey {
  if (!(workspaceRuntimeWorkerKeys as readonly string[]).includes(worker)) {
    throw new AppError("WORKSPACE_RUNTIME_SLOT_INVALID", `Unknown worker ${worker}.`);
  }
}

export function assertWorkspaceRuntimeInteractiveFlowKey(flow: string): asserts flow is InteractiveFlowKey {
  if (!(workspaceRuntimeInteractiveFlowKeys as readonly string[]).includes(flow)) {
    throw new AppError("WORKSPACE_RUNTIME_SLOT_INVALID", `Unknown interactive flow ${flow}.`);
  }
}
