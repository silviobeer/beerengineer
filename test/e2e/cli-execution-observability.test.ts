import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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

function runCliText(args: string[], cwd: string): string {
  return execFileSync(process.execPath, [tsxCliPath, mainCliPath, ...args], {
    cwd,
    encoding: "utf8"
  });
}

describe("cli execution observability", () => {
  it(
    "shows compact execution summaries, story logs, and watch output",
    () => {
      const root = mkdtempSync(join(tmpdir(), "beerengineer-e2e-"));
      const dbPath = join(root, "app.sqlite");
      const cwd = resolve(".");

      try {
        const item = runCli(["--db", dbPath, "item:create", "--title", "Execution Watch", "--description", "Desc"], cwd) as {
          id: string;
        };
        runCli(["--db", dbPath, "brainstorm:start", "--item-id", item.id], cwd);
        const itemShow = runCli(["--db", dbPath, "item:show", "--item-id", item.id], cwd) as {
          concept: { id: string };
        };
        runCli(["--db", dbPath, "concept:approve", "--concept-id", itemShow.concept.id], cwd);
        runCli(["--db", dbPath, "project:import", "--item-id", item.id], cwd);
        const imported = runCli(["--db", dbPath, "item:show", "--item-id", item.id], cwd) as {
          projects: Array<{ id: string }>;
        };
        const projectId = imported.projects[0]!.id;
        runCli(["--db", dbPath, "requirements:start", "--item-id", item.id, "--project-id", projectId], cwd);
        runCli(["--db", dbPath, "stories:approve", "--project-id", projectId], cwd);
        runCli(["--db", dbPath, "architecture:start", "--item-id", item.id, "--project-id", projectId], cwd);
        runCli(["--db", dbPath, "architecture:approve", "--project-id", projectId], cwd);
        runCli(["--db", dbPath, "planning:start", "--item-id", item.id, "--project-id", projectId], cwd);
        runCli(["--db", dbPath, "planning:approve", "--project-id", projectId], cwd);
        runCli(["--db", dbPath, "execution:start", "--project-id", projectId], cwd);
        runCli(["--db", dbPath, "execution:tick", "--project-id", projectId], cwd);

        const compact = runCli(["--db", dbPath, "execution:show", "--project-id", projectId, "--compact"], cwd) as {
          overallStatus: string;
          activeWaveCode: string | null;
          waves: Array<{ waveCode: string; status: string; stories: Array<{ storyCode: string; status: string }> }>;
        };
        expect(compact.overallStatus).toBe("completed");
        expect(compact.activeWaveCode).toBeNull();
        expect(compact.waves[0]?.stories[0]).toMatchObject({
          storyCode: "ITEM-0001-P01-US01",
          status: "completed"
        });

        const logs = runCli(
          ["--db", dbPath, "execution:logs", "--project-id", projectId, "--story-code", "ITEM-0001-P01-US01"],
          cwd
        ) as {
          story: { code: string };
          latestExecution: { sessions: Array<{ adapterKey: string }> } | null;
          latestStoryReview: { sessions: Array<{ adapterKey: string }> } | null;
        };
        expect(logs.story.code).toBe("ITEM-0001-P01-US01");
        expect(logs.latestExecution?.sessions[0]?.adapterKey).toBe("local-cli");
        expect(logs.latestStoryReview?.sessions[0]?.adapterKey).toBe("local-cli");

        const watchOutput = runCliText(
          [
            "--db",
            dbPath,
            "execution:watch",
            "--project-id",
            projectId,
            "--interval-ms",
            "10",
            "--max-iterations",
            "1"
          ],
          cwd
        );
        expect(watchOutput).toContain("Project ITEM-0001-P01");
        expect(watchOutput).toContain("Overall: completed");
        expect(watchOutput).toContain("Wave W01 [completed]");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    35000
  );
});
