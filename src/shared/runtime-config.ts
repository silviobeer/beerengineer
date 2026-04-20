import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  loadAgentRuntimeConfigFromObject,
  loadAgentRuntimeConfigOverrideFromObject,
  type AgentRuntimeConfig,
  type AgentRuntimeConfigOverride
} from "../adapters/runtime.js";
import { AppError } from "./errors.js";
import { resolveDefaultAgentRuntimeOverridePath } from "./user-data-paths.js";

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function loadRuntimeOverrideConfig(path: string): AgentRuntimeConfigOverride {
  try {
    return loadAgentRuntimeConfigOverrideFromObject(readJsonFile(path));
  } catch (error) {
    if (error instanceof AppError && error.code === "AGENT_RUNTIME_CONFIG_INVALID") {
      throw new AppError(error.code, `Agent runtime override config ${path} is invalid: ${error.message}`, { cause: error });
    }
    throw error;
  }
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
  return {
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
  };
}

export function resolveInstalledAgentRuntimeConfigPath(repoRoot: string): string {
  return resolve(repoRoot, "config/agent-runtime.json");
}

export function resolveAgentRuntimeConfigPath(input: { repoRoot: string; explicitConfigPath?: string }): string {
  if (input.explicitConfigPath) {
    return resolve(input.explicitConfigPath);
  }
  return resolveInstalledAgentRuntimeConfigPath(input.repoRoot);
}

export function loadResolvedAgentRuntimeConfig(input: {
  repoRoot: string;
  explicitConfigPath?: string;
  overrideConfigPath?: string;
}): { configPath: string; config: AgentRuntimeConfig } {
  const configPath = resolveAgentRuntimeConfigPath(input);
  if (input.explicitConfigPath) {
    return {
      configPath,
      config: loadAgentRuntimeConfigFromObject(readJsonFile(configPath))
    };
  }

  const defaultConfig = loadAgentRuntimeConfigFromObject(readJsonFile(configPath));
  const overrideConfigPath = resolve(input.overrideConfigPath ?? resolveDefaultAgentRuntimeOverridePath());
  if (!existsSync(overrideConfigPath)) {
    return { configPath, config: defaultConfig };
  }

  const overrideConfig = loadRuntimeOverrideConfig(overrideConfigPath);
  return {
    configPath: overrideConfigPath,
    config: loadAgentRuntimeConfigFromObject(mergeRuntimeConfig(defaultConfig, overrideConfig))
  };
}
