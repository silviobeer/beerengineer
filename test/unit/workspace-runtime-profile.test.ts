import { describe, expect, it } from "vitest";

import { requiredAgentExecutionPolicy, type AgentRuntimeConfig } from "../../src/adapters/runtime.js";
import { AppError } from "../../src/shared/errors.js";
import {
  createEmptyWorkspaceRuntimeProfile,
  getBuiltInWorkspaceRuntimeProfilePath,
  loadBuiltInWorkspaceRuntimeProfile,
  loadWorkspaceRuntimeProfileFromJsonString,
  resolveWorkspaceRuntimeConfig,
  validateWorkspaceRuntimeProfileCompatibility
} from "../../src/shared/workspace-runtime-profile.js";

const repoRoot = process.cwd();

function createRuntimeConfig(): AgentRuntimeConfig {
  return {
    defaultProvider: "codex",
    policy: requiredAgentExecutionPolicy,
    defaults: {
      interactive: {
        provider: "codex",
        model: "gpt-5.5"
      },
      autonomous: {
        provider: "codex",
        model: "gpt-5.5"
      }
    },
    interactive: {},
    stages: {},
    workers: {},
    providers: {
      codex: {
        adapterKey: "codex",
        model: "gpt-5.5",
        command: ["codex"],
        env: {},
        timeoutMs: 1_800_000
      },
      claude: {
        adapterKey: "claude",
        model: "sonnet",
        command: ["claude"],
        env: {},
        timeoutMs: 1_800_000
      }
    }
  };
}

describe("workspace runtime profiles", () => {
  it("loads built-in profiles through the explicit profile-to-file mapping", () => {
    const codexProfile = loadBuiltInWorkspaceRuntimeProfile(repoRoot, "codex_primary");
    const claudeProfile = loadBuiltInWorkspaceRuntimeProfile(repoRoot, "claude_primary");

    expect(getBuiltInWorkspaceRuntimeProfilePath(repoRoot, "codex_primary")).toMatch(/config\/runtime-profiles\/codex-primary\.json$/);
    expect(getBuiltInWorkspaceRuntimeProfilePath(repoRoot, "claude_primary")).toMatch(/config\/runtime-profiles\/claude-primary\.json$/);
    expect(codexProfile.version).toBe(1);
    expect(codexProfile.defaultProvider).toBe("codex");
    expect(codexProfile.stages?.brainstorm?.provider).toBe("claude");
    expect(claudeProfile.defaultProvider).toBe("claude");
    expect(claudeProfile.workers?.execution?.provider).toBe("codex");
  });

  it("rejects unsupported profile versions with a source-aware error", () => {
    expect(() =>
      loadWorkspaceRuntimeProfileFromJsonString(
        JSON.stringify({
          version: 2
        }),
        { kind: "workspace_settings", workspaceKey: "default" }
      )
    ).toThrowError(AppError);

    try {
      loadWorkspaceRuntimeProfileFromJsonString(JSON.stringify({ version: 2 }), {
        kind: "workspace_settings",
        workspaceKey: "default"
      });
    } catch (error) {
      expect((error as AppError).message).toContain("unsupported version 2");
      expect((error as AppError).message).toContain("workspace_settings.runtime_profile_json");
    }
  });

  it("rejects forbidden workspace profile fields", () => {
    expect(() =>
      loadWorkspaceRuntimeProfileFromJsonString(
        JSON.stringify({
          version: 1,
          providers: {
            codex: {
              command: ["codex"]
            }
          }
        }),
        { kind: "workspace_settings", workspaceKey: "default" }
      )
    ).toThrow(/invalid/i);
  });

  it("resolves runtime precedence as global, workspace profile, then cli override while preserving providers", () => {
    const globalRuntime = createRuntimeConfig();
    const workspaceProfile = loadWorkspaceRuntimeProfileFromJsonString(
      JSON.stringify({
        version: 1,
        defaultProvider: "claude",
        stages: {
          planning: {
            provider: "claude",
            model: "sonnet"
          }
        }
      }),
      { kind: "workspace_settings", workspaceKey: "default" }
    );
    const cliOverride = {
      ...createEmptyWorkspaceRuntimeProfile(),
      workers: {
        execution: {
          provider: "claude",
          model: "sonnet"
        }
      }
    };

    const resolved = resolveWorkspaceRuntimeConfig({
      globalRuntimeConfig: globalRuntime,
      workspaceProfile,
      cliOverride
    });

    expect(resolved.config.defaultProvider).toBe("claude");
    expect(resolved.config.stages.planning).toEqual({ provider: "claude", model: "sonnet" });
    expect(resolved.config.workers.execution).toEqual({ provider: "claude", model: "sonnet" });
    expect(resolved.config.providers.codex.command).toEqual(["codex"]);
    expect(resolved.config.policy).toEqual(requiredAgentExecutionPolicy);
    expect(resolved.sources.defaultProvider).toBe("workspace_profile");
    expect(resolved.sources.stages.planning).toBe("workspace_profile");
    expect(resolved.sources.workers.execution).toBe("cli_override");
  });

  it("flags missing providers in compatibility checks", () => {
    const runtimeConfig = createRuntimeConfig();
    const incompatibleRuntime = {
      ...runtimeConfig,
      providers: {
        codex: runtimeConfig.providers.codex
      }
    };
    const profile = loadBuiltInWorkspaceRuntimeProfile(repoRoot, "codex_primary");
    const compatibility = validateWorkspaceRuntimeProfileCompatibility(incompatibleRuntime, profile);

    expect(compatibility.valid).toBe(false);
    expect(compatibility.missingProviders).toContain("claude");
  });
});
