import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { PromptResolver } from "../../src/services/prompt-resolver.js";

describe("prompt resolver", () => {
  it("loads prompt and skill files", () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-prompt-"));
    writeFileSync(join(root, "prompt.md"), "prompt");
    writeFileSync(join(root, "skill.md"), "skill");

    try {
      const resolver = new PromptResolver(root);
      const resolved = resolver.resolve({
        promptPath: "prompt.md",
        skillPaths: ["skill.md"]
      });

      expect(resolved.promptContent).toBe("prompt");
      expect(resolved.skills[0]?.content).toBe("skill");
      expect(resolver.resolveFile("prompt.md")).toBe("prompt");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
