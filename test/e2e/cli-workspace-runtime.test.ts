import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

const repoRoot = resolve(".");
const tsxCliPath = resolve(repoRoot, "node_modules/tsx/dist/cli.mjs");
const mainCliPath = resolve(repoRoot, "src/cli/main.ts");

function runCli(args: string[], cwd: string): unknown {
  const output = execFileSync(process.execPath, [tsxCliPath, mainCliPath, ...args], {
    cwd,
    encoding: "utf8"
  });
  return JSON.parse(output);
}

describe("cli workspace runtime commands", () => {
  it("applies built-in profiles, shows effective runtime, and turns built-ins into custom profiles on manual edits", () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-runtime-cli-"));
    const dbPath = join(root, "app.sqlite");

    try {
      const profiles = runCli(["--db", dbPath, "workspace:runtime:profiles"], repoRoot) as {
        profiles: Array<{ profileKey: string; compatible: boolean }>;
      };
      expect(profiles.profiles.map((entry) => entry.profileKey)).toEqual(["codex_primary", "claude_primary"]);
      expect(profiles.profiles.every((entry) => entry.compatible)).toBe(true);

      const applied = runCli(["--db", dbPath, "workspace:runtime:apply-profile", "--profile", "codex_primary"], repoRoot) as {
        workspaceProfile: { profileKey: string | null };
        effective: { stages: { brainstorm: { selection: { provider: string } } } };
      };
      expect(applied.workspaceProfile.profileKey).toBe("codex_primary");
      expect(applied.effective.stages.brainstorm.selection.provider).toBe("claude");

      const customized = runCli(
        ["--db", dbPath, "workspace:runtime:set-stage", "--stage", "planning", "--provider", "claude", "--model", "sonnet"],
        repoRoot
      ) as {
        workspaceProfile: { profileKey: string | null };
        effective: { stages: { planning: { selection: { provider: string; model: string | null }; source: string } } };
      };
      expect(customized.workspaceProfile.profileKey).toBeNull();
      expect(customized.effective.stages.planning.selection).toEqual({ provider: "claude", model: "sonnet" });
      expect(customized.effective.stages.planning.source).toBe("workspace_profile");

      const cleared = runCli(["--db", dbPath, "workspace:runtime:clear-profile"], repoRoot) as {
        workspaceProfile: null;
      };
      expect(cleared.workspaceProfile).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("applies runtime profiles during bootstrap and reports overwrites", () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-runtime-bootstrap-"));
    const dbPath = join(root, "app.sqlite");
    const workspaceRoot = join(root, "workspace");

    try {
      runCli(
        ["--db", dbPath, "workspace:create", "--key", "app-two", "--name", "App Two", "--root-path", workspaceRoot],
        repoRoot
      );
      runCli(["--db", dbPath, "--workspace", "app-two", "workspace:runtime:apply-profile", "--profile", "codex_primary"], repoRoot);

      const bootstrap = runCli(
        [
          "--db",
          dbPath,
          "--workspace",
          "app-two",
          "workspace:bootstrap",
          "--create-root",
          "--runtime-profile",
          "claude_primary"
        ],
        repoRoot
      ) as {
        runtimeProfile: { requestedProfileKey: string; appliedProfileKey: string | null; overwrittenExistingProfile: boolean };
      };
      expect(bootstrap.runtimeProfile).toEqual({
        requestedProfileKey: "claude_primary",
        appliedProfileKey: "claude_primary",
        overwrittenExistingProfile: true,
        dryRun: false
      });
      expect(existsSync(workspaceRoot)).toBe(true);

      const show = runCli(["--db", dbPath, "--workspace", "app-two", "workspace:runtime:show"], repoRoot) as {
        workspaceProfile: { profileKey: string | null };
        effective: { defaultProvider: { provider: string } };
      };
      expect(show.workspaceProfile.profileKey).toBe("claude_primary");
      expect(show.effective.defaultProvider.provider).toBe("claude");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("applies agent-browser MCP config for all supported harness targets", () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-mcp-bootstrap-"));
    const dbPath = join(root, "app.sqlite");
    const workspaceRoot = join(root, "workspace");
    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;

    try {
      process.env.HOME = root;
      process.env.USERPROFILE = root;

      runCli(
        ["--db", dbPath, "workspace:create", "--key", "app-two", "--name", "App Two", "--root-path", workspaceRoot],
        repoRoot
      );

      const bootstrap = runCli(
        ["--db", dbPath, "--workspace", "app-two", "workspace:bootstrap", "--create-root", "--with-mcp"],
        repoRoot
      ) as {
        actions: Array<{ id: string; status: string; path?: string }>;
      };

      expect(bootstrap.actions.filter((action) => action.id.startsWith("bootstrap-mcp-")).map((action) => action.id)).toEqual([
        "bootstrap-mcp-claude",
        "bootstrap-mcp-cursor",
        "bootstrap-mcp-opencode",
        "bootstrap-mcp-codex"
      ]);
      expect(readFileSync(join(workspaceRoot, ".mcp.json"), "utf8")).toContain("agent-browser");
      expect(readFileSync(join(workspaceRoot, ".cursor", "mcp.json"), "utf8")).toContain("agent-browser");
      expect(readFileSync(join(workspaceRoot, "opencode.jsonc"), "utf8")).toContain("agent-browser");
      expect(readFileSync(join(root, ".codex", "config.toml"), "utf8")).toContain("[mcp_servers.\"agent-browser\"]");

      const show = runCli(["--db", dbPath, "--workspace", "app-two", "workspace:mcp:show"], repoRoot) as {
        targets: Array<{ target: string; configured: boolean }>;
      };
      expect(show.targets.every((target) => target.configured)).toBe(true);
    } finally {
      process.env.HOME = previousHome;
      process.env.USERPROFILE = previousUserProfile;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("simulates MCP apply in dry-run mode without writing config files", () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-mcp-dry-run-"));
    const dbPath = join(root, "app.sqlite");
    const workspaceRoot = join(root, "workspace");
    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;

    try {
      process.env.HOME = root;
      process.env.USERPROFILE = root;

      runCli(
        ["--db", dbPath, "workspace:create", "--key", "app-two", "--name", "App Two", "--root-path", workspaceRoot],
        repoRoot
      );
      runCli(["--db", dbPath, "--workspace", "app-two", "workspace:bootstrap", "--create-root"], repoRoot);

      const result = runCli(["--db", dbPath, "--workspace", "app-two", "workspace:mcp:apply", "--target", "all", "--dry-run"], repoRoot) as {
        dryRun: boolean;
        targets: Array<{ target: string; status: string; preview: string | null }>;
      };

      expect(result.dryRun).toBe(true);
      expect(result.targets.map((target) => target.status)).toEqual(["simulated", "simulated", "simulated", "simulated"]);
      expect(existsSync(join(workspaceRoot, ".mcp.json"))).toBe(false);
      expect(existsSync(join(workspaceRoot, ".cursor", "mcp.json"))).toBe(false);
      expect(existsSync(join(workspaceRoot, "opencode.jsonc"))).toBe(false);
      expect(existsSync(join(root, ".codex", "config.toml"))).toBe(false);
    } finally {
      process.env.HOME = previousHome;
      process.env.USERPROFILE = previousUserProfile;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
