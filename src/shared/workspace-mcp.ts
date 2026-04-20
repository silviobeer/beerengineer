import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { AppError } from "./errors.js";

export const harnessMcpTargets = ["claude", "cursor", "opencode", "codex"] as const;
export type HarnessMcpTarget = (typeof harnessMcpTargets)[number];

export type HarnessMcpTargetDescriptor = {
  target: HarnessMcpTarget;
  label: string;
  path: string;
  scope: "project" | "user";
};

const agentBrowserServerName = "agent-browser";

type JsonObject = Record<string, unknown>;

function stripJsonComments(input: string): string {
  let result = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const current = input[index];
    const next = input[index + 1];

    if (inLineComment) {
      if (current === "\n") {
        inLineComment = false;
        result += current;
      }
      continue;
    }

    if (inBlockComment) {
      if (current === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inString) {
      result += current;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (current === "\\") {
        escaped = true;
        continue;
      }
      if (current === "\"") {
        inString = false;
      }
      continue;
    }

    if (current === "\"") {
      inString = true;
      result += current;
      continue;
    }

    if (current === "/" && next === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (current === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    result += current;
  }

  return result;
}

function parseJsonConfig(path: string): JsonObject {
  try {
    return JSON.parse(stripJsonComments(readFileSync(path, "utf8"))) as JsonObject;
  } catch (error) {
    throw new AppError("WORKSPACE_MCP_CONFIG_INVALID", `MCP config ${path} is invalid JSON/JSONC.`);
  }
}

function stringifyJsonConfig(value: JsonObject): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function codexAgentBrowserBlock(): string {
  return [
    `[mcp_servers."${agentBrowserServerName}"]`,
    `command = "agent-browser"`,
    `args = ["mcp"]`,
    ``
  ].join("\n");
}

function upsertCodexAgentBrowserConfig(existing: string): string {
  const block = codexAgentBrowserBlock().trimEnd();
  const tablePattern = /^\[mcp_servers\."agent-browser"\][\s\S]*?(?=^\[|\s*$)/m;
  if (tablePattern.test(existing)) {
    return `${existing.replace(tablePattern, block).replace(/\s*$/, "\n")}`;
  }
  const trimmed = existing.trimEnd();
  return `${trimmed.length > 0 ? `${trimmed}\n\n` : ""}${block}\n`;
}

function hasCodexAgentBrowserConfig(content: string): boolean {
  return /^\[mcp_servers\."agent-browser"\]/m.test(content);
}

function resolveOpenCodeConfigPath(workspaceRoot: string): string {
  return existsSync(resolve(workspaceRoot, "opencode.json"))
    ? resolve(workspaceRoot, "opencode.json")
    : resolve(workspaceRoot, "opencode.jsonc");
}

export function resolveHarnessMcpTargets(workspaceRoot: string): HarnessMcpTargetDescriptor[] {
  const homeDirectory = process.env.USERPROFILE ?? process.env.HOME;
  if (!homeDirectory) {
    throw new AppError("WORKSPACE_MCP_HOME_REQUIRED", "HOME/USERPROFILE is not set, so user-scoped MCP configs cannot be resolved.");
  }
  return [
    {
      target: "claude",
      label: "Claude Code MCP",
      path: resolve(workspaceRoot, ".mcp.json"),
      scope: "project"
    },
    {
      target: "cursor",
      label: "Cursor MCP",
      path: resolve(workspaceRoot, ".cursor", "mcp.json"),
      scope: "project"
    },
    {
      target: "opencode",
      label: "OpenCode MCP",
      path: resolveOpenCodeConfigPath(workspaceRoot),
      scope: "project"
    },
    {
      target: "codex",
      label: "Codex MCP",
      path: join(homeDirectory, ".codex", "config.toml"),
      scope: "user"
    }
  ];
}

export function resolveHarnessMcpTarget(workspaceRoot: string, target: HarnessMcpTarget): HarnessMcpTargetDescriptor {
  const descriptor = resolveHarnessMcpTargets(workspaceRoot).find((entry) => entry.target === target);
  if (!descriptor) {
    throw new AppError("WORKSPACE_MCP_TARGET_INVALID", `Unknown MCP target ${target}.`);
  }
  return descriptor;
}

export function isHarnessMcpConfigured(descriptor: HarnessMcpTargetDescriptor): boolean {
  if (!existsSync(descriptor.path)) {
    return false;
  }
  if (descriptor.target === "codex") {
    return hasCodexAgentBrowserConfig(readFileSync(descriptor.path, "utf8"));
  }
  const parsed = parseJsonConfig(descriptor.path);
  if (descriptor.target === "opencode") {
    return Boolean((parsed.mcp as JsonObject | undefined)?.[agentBrowserServerName]);
  }
  return Boolean((parsed.mcpServers as JsonObject | undefined)?.[agentBrowserServerName]);
}

export function renderHarnessMcpConfigPreview(descriptor: HarnessMcpTargetDescriptor): string {
  if (descriptor.target === "codex") {
    return codexAgentBrowserBlock();
  }

  if (descriptor.target === "opencode") {
    return stringifyJsonConfig({
      $schema: "https://opencode.ai/config.json",
      mcp: {
        [agentBrowserServerName]: {
          type: "local",
          command: ["agent-browser", "mcp"],
          enabled: true
        }
      }
    });
  }

  return stringifyJsonConfig({
    mcpServers: {
      [agentBrowserServerName]: {
        type: "stdio",
        command: "agent-browser",
        args: ["mcp"],
        env: {}
      }
    }
  });
}

export function applyHarnessMcpConfig(descriptor: HarnessMcpTargetDescriptor): { path: string; created: boolean; configured: boolean } {
  const targetPath = descriptor.path;
  const existed = existsSync(targetPath);
  mkdirSync(dirname(targetPath), { recursive: true });

  if (descriptor.target === "codex") {
    const nextContent = upsertCodexAgentBrowserConfig(existed ? readFileSync(targetPath, "utf8") : "");
    writeFileSync(targetPath, nextContent, "utf8");
    return { path: targetPath, created: !existed, configured: true };
  }

  const parsed = existed ? parseJsonConfig(targetPath) : {};
  if (descriptor.target === "opencode") {
    const currentMcp = (parsed.mcp as JsonObject | undefined) ?? {};
    const nextConfig: JsonObject = {
      ...parsed,
      $schema: parsed.$schema ?? "https://opencode.ai/config.json",
      mcp: {
        ...currentMcp,
        [agentBrowserServerName]: {
          type: "local",
          command: ["agent-browser", "mcp"],
          enabled: true
        }
      }
    };
    writeFileSync(targetPath, stringifyJsonConfig(nextConfig), "utf8");
    return { path: targetPath, created: !existed, configured: true };
  }

  const currentServers = (parsed.mcpServers as JsonObject | undefined) ?? {};
  const nextConfig: JsonObject = {
    ...parsed,
    mcpServers: {
      ...currentServers,
      [agentBrowserServerName]: {
        type: "stdio",
        command: "agent-browser",
        args: ["mcp"],
        env: {}
      }
    }
  };
  writeFileSync(targetPath, stringifyJsonConfig(nextConfig), "utf8");
  return { path: targetPath, created: !existed, configured: true };
}

export function assertHarnessMcpTarget(value: string): asserts value is HarnessMcpTarget {
  if (!(harnessMcpTargets as readonly string[]).includes(value)) {
    throw new AppError("WORKSPACE_MCP_TARGET_INVALID", `Unknown MCP target ${value}.`);
  }
}
