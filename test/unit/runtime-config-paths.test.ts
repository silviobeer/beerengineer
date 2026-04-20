import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { AppError } from "../../src/shared/errors.js";
import { loadResolvedAgentRuntimeConfig, resolveInstalledAgentRuntimeConfigPath } from "../../src/shared/runtime-config.js";

function writeRuntimeConfig(path: string, patch: Record<string, unknown> = {}): void {
  const value = {
    defaultProvider: "codex",
    policy: {
      autonomyMode: "yolo",
      approvalMode: "never",
      filesystemMode: "danger-full-access",
      networkMode: "enabled",
      interactionMode: "non_blocking"
    },
    defaults: {
      interactive: {
        provider: "codex",
        model: "gpt-5.4"
      },
      autonomous: {
        provider: "codex",
        model: "gpt-5.4"
      }
    },
    interactive: {},
    stages: {},
    workers: {},
    providers: {
      codex: {
        adapterKey: "codex",
        model: "gpt-5.4",
        command: ["codex"],
        env: {},
        timeoutMs: 1800000
      }
    },
    ...patch
  };
  writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
}

describe("runtime config path resolution", () => {
  it("loads the installed default config when no override exists", () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-runtime-config-"));
    const configDir = join(root, "config");
    mkdirSync(configDir, { recursive: true });
    writeRuntimeConfig(join(configDir, "agent-runtime.json"));

    try {
      const resolved = loadResolvedAgentRuntimeConfig({ repoRoot: root });
      expect(resolved.configPath).toBe(resolveInstalledAgentRuntimeConfigPath(root));
      expect(resolved.config.defaults.autonomous?.model).toBe("gpt-5.4");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("merges a user override when no explicit config path is provided", () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-runtime-config-"));
    const configDir = join(root, "config");
    const overrideDir = join(root, "user-data", "config");
    mkdirSync(configDir, { recursive: true });
    mkdirSync(overrideDir, { recursive: true });
    writeRuntimeConfig(join(configDir, "agent-runtime.json"));
    writeFileSync(
      join(overrideDir, "agent-runtime.override.json"),
      JSON.stringify(
        {
          defaults: {
            autonomous: {
              provider: "codex",
              model: "gpt-5.4-mini"
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );

    try {
      const resolved = loadResolvedAgentRuntimeConfig({
        repoRoot: root,
        overrideConfigPath: join(overrideDir, "agent-runtime.override.json")
      });
      expect(resolved.configPath).toBe(join(overrideDir, "agent-runtime.override.json"));
      expect(resolved.config.defaults.autonomous?.model).toBe("gpt-5.4-mini");
      expect(resolved.config.defaults.interactive?.model).toBe("gpt-5.4");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("prefers an explicit config path over any user override", () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-runtime-config-"));
    const configDir = join(root, "config");
    const overrideDir = join(root, "user-data", "config");
    const explicitPath = join(root, "custom-runtime.json");
    mkdirSync(configDir, { recursive: true });
    mkdirSync(overrideDir, { recursive: true });
    writeRuntimeConfig(join(configDir, "agent-runtime.json"));
    writeRuntimeConfig(explicitPath, {
      defaults: {
        interactive: {
          provider: "codex",
          model: "custom-model"
        },
        autonomous: {
          provider: "codex",
          model: "custom-model"
        }
      }
    });
    writeFileSync(
      join(overrideDir, "agent-runtime.override.json"),
      JSON.stringify(
        {
          defaults: {
            autonomous: {
              provider: "codex",
              model: "ignored-override"
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );

    try {
      const resolved = loadResolvedAgentRuntimeConfig({
        repoRoot: root,
        explicitConfigPath: explicitPath,
        overrideConfigPath: join(overrideDir, "agent-runtime.override.json")
      });
      expect(resolved.configPath).toBe(explicitPath);
      expect(resolved.config.defaults.autonomous?.model).toBe("custom-model");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports the override file path when the user override shape is invalid", () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-runtime-config-"));
    const configDir = join(root, "config");
    const overrideDir = join(root, "user-data", "config");
    const overridePath = join(overrideDir, "agent-runtime.override.json");
    mkdirSync(configDir, { recursive: true });
    mkdirSync(overrideDir, { recursive: true });
    writeRuntimeConfig(join(configDir, "agent-runtime.json"));
    writeFileSync(
      overridePath,
      JSON.stringify(
        {
          providers: {
            codex: {
              timeoutMs: "fast"
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );

    try {
      let thrown: unknown;
      try {
        loadResolvedAgentRuntimeConfig({
          repoRoot: root,
          overrideConfigPath: overridePath
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(AppError);
      expect((thrown as AppError).code).toBe("AGENT_RUNTIME_CONFIG_INVALID");
      expect((thrown as AppError).message).toContain(overridePath);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
