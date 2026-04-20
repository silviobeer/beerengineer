import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  applyHarnessMcpConfig,
  isHarnessMcpConfigured,
  renderHarnessMcpConfigPreview,
  resolveHarnessMcpTargets
} from "../../src/shared/workspace-mcp.js";

describe("workspace MCP harness config", () => {
  it("renders and applies agent-browser MCP config for all supported targets", () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-workspace-mcp-"));
    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;

    try {
      process.env.HOME = root;
      process.env.USERPROFILE = root;

      const descriptors = resolveHarnessMcpTargets(root);
      expect(descriptors.map((descriptor) => descriptor.target)).toEqual(["claude", "cursor", "opencode", "codex"]);

      for (const descriptor of descriptors) {
        expect(isHarnessMcpConfigured(descriptor)).toBe(false);
        expect(renderHarnessMcpConfigPreview(descriptor)).toContain("agent-browser");

        const result = applyHarnessMcpConfig(descriptor);
        expect(result.configured).toBe(true);
        expect(existsSync(descriptor.path)).toBe(true);
        expect(isHarnessMcpConfigured(descriptor)).toBe(true);
      }

      expect(readFileSync(join(root, ".mcp.json"), "utf8")).toContain("\"mcpServers\"");
      expect(readFileSync(join(root, ".cursor", "mcp.json"), "utf8")).toContain("\"agent-browser\"");
      expect(readFileSync(join(root, "opencode.jsonc"), "utf8")).toContain("\"mcp\"");
      expect(readFileSync(join(root, ".codex", "config.toml"), "utf8")).toContain("[mcp_servers.\"agent-browser\"]");
    } finally {
      process.env.HOME = previousHome;
      process.env.USERPROFILE = previousUserProfile;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("merges into existing OpenCode and Codex configs without dropping unrelated entries", () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-workspace-mcp-"));
    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;

    try {
      process.env.HOME = root;
      process.env.USERPROFILE = root;

      writeFileSync(
        join(root, "opencode.json"),
        JSON.stringify(
          {
            $schema: "https://opencode.ai/config.json",
            theme: "light",
            mcp: {
              existing: {
                type: "local",
                command: ["existing-mcp"]
              }
            }
          },
          null,
          2
        ),
        "utf8"
      );
      const codexDir = join(root, ".codex");
      mkdirSync(codexDir, { recursive: true });
      writeFileSync(join(codexDir, "config.toml"), "[profile.default]\nmodel = \"gpt-5.4\"\n", "utf8");

      const descriptors = resolveHarnessMcpTargets(root);
      applyHarnessMcpConfig(descriptors.find((descriptor) => descriptor.target === "opencode")!);
      applyHarnessMcpConfig(descriptors.find((descriptor) => descriptor.target === "codex")!);

      const opencodeConfig = readFileSync(join(root, "opencode.json"), "utf8");
      const codexConfig = readFileSync(join(root, ".codex", "config.toml"), "utf8");
      expect(opencodeConfig).toContain("\"existing\"");
      expect(opencodeConfig).toContain("\"agent-browser\"");
      expect(codexConfig).toContain("[profile.default]");
      expect(codexConfig).toContain("[mcp_servers.\"agent-browser\"]");
    } finally {
      process.env.HOME = previousHome;
      process.env.USERPROFILE = previousUserProfile;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
