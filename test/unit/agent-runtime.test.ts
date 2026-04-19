import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { AgentRuntimeResolver, loadAgentRuntimeConfig, requiredAgentExecutionPolicy } from "../../src/adapters/runtime.js";
import type { AgentRuntimeConfig } from "../../src/adapters/runtime.js";
import type { AgentExecutionPolicy } from "../../src/adapters/types.js";

function writeConfig(root: string, policyOverride?: Partial<AgentExecutionPolicy>): string {
  const configPath = join(root, "agent-runtime.json");
  const config: AgentRuntimeConfig = {
    defaultProvider: "codex",
    policy: {
      ...requiredAgentExecutionPolicy,
      ...policyOverride
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
    interactive: {
      brainstorm_chat: {
        provider: "claude",
        model: "claude-brainstorm"
      }
    },
    stages: {
      requirements: {
        provider: "claude",
        model: "claude-requirements"
      }
    },
    workers: {
      qa: {
        provider: "claude",
        model: "claude-qa"
      }
    },
    providers: {
      codex: {
        adapterKey: "codex",
        model: "gpt-5.4",
        command: ["codex"],
        env: {},
        timeoutMs: 1_800_000
      },
      claude: {
        adapterKey: "claude",
        model: "claude-sonnet",
        command: ["claude"],
        env: {},
        timeoutMs: 1_800_000
      }
    }
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
  return configPath;
}

describe("agent runtime config", () => {
  it("rejects weakened execution policy values", () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-agent-runtime-"));

    try {
      const configPath = writeConfig(root, {
        approvalMode: "never"
      });
      const config = JSON.parse(JSON.stringify(loadAgentRuntimeConfig(configPath))) as AgentRuntimeConfig;
      expect(config.policy.autonomyMode).toBe("yolo");

      writeFileSync(
        configPath,
        JSON.stringify(
          {
            ...config,
            policy: {
              ...config.policy,
              networkMode: "disabled"
            }
          },
          null,
          2
        ),
        "utf8"
      );

      expect(() => loadAgentRuntimeConfig(configPath)).toThrow(/Invalid literal value, expected "enabled"/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves interactive, stage, and worker models with exact override precedence", () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-agent-runtime-"));

    try {
      const configPath = writeConfig(root);
      const config = loadAgentRuntimeConfig(configPath);
      const resolver = new AgentRuntimeResolver(config, {
        repoRoot: process.cwd()
      });

      expect(resolver.resolveInteractive("brainstorm_chat")).toMatchObject({
        providerKey: "claude",
        adapterKey: "claude",
        model: "claude-brainstorm"
      });
      expect(resolver.resolveInteractive("story_review_chat")).toMatchObject({
        providerKey: "codex",
        adapterKey: "codex",
        model: "gpt-5.4"
      });
      expect(resolver.resolveStage("requirements")).toMatchObject({
        providerKey: "claude",
        adapterKey: "claude",
        model: "claude-requirements"
      });
      expect(resolver.resolveStage("planning")).toMatchObject({
        providerKey: "codex",
        adapterKey: "codex",
        model: "gpt-5.4"
      });
      expect(resolver.resolveWorker("qa")).toMatchObject({
        providerKey: "claude",
        adapterKey: "claude",
        model: "claude-qa"
      });
      expect(resolver.resolveWorker("documentation")).toMatchObject({
        providerKey: "codex",
        adapterKey: "codex",
        model: "gpt-5.4"
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
