import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

const repoRoot = resolve(".");
const tsxCliPath = resolve(repoRoot, "node_modules/tsx/dist/cli.mjs");
const mainCliPath = resolve(repoRoot, "src/cli/main.ts");

function runCli(args: string[], cwd: string): unknown {
  const output = execFileSync(
    process.execPath,
    [tsxCliPath, mainCliPath, ...args],
    {
      cwd,
      encoding: "utf8"
    }
  );
  return JSON.parse(output);
}

function runCliError(args: string[], cwd: string): { error: { code: string; message: string } } {
  try {
    execFileSync(process.execPath, [tsxCliPath, mainCliPath, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    });
    throw new Error("Expected CLI command to fail");
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? "";
    return JSON.parse(stderr) as { error: { code: string; message: string } };
  }
}

describe("cli happy path", () => {
  it(
    "runs item creation through architecture approval",
    () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-e2e-"));
    const dbPath = join(root, "app.sqlite");
    const cwd = resolve(".");

    try {
      const item = runCli(["--db", dbPath, "item:create", "--title", "CLI Item", "--description", "Desc"], cwd) as { id: string };
      const brainstorm = runCli(["--db", dbPath, "brainstorm:start", "--item-id", item.id], cwd) as { runId: string };
      expect(brainstorm.runId).toContain("run_");

      const itemShow = runCli(["--db", dbPath, "item:show", "--item-id", item.id], cwd) as {
        concept: { id: string };
        projects: Array<{ id: string }>;
      };

      runCli(["--db", dbPath, "concept:approve", "--concept-id", itemShow.concept.id], cwd);
      runCli(["--db", dbPath, "project:import", "--item-id", item.id], cwd);

      const imported = runCli(["--db", dbPath, "item:show", "--item-id", item.id], cwd) as {
        projects: Array<{ id: string }>;
      };
      const projectId = imported.projects[0]?.id;
      expect(projectId).toBeTruthy();

      runCli(["--db", dbPath, "requirements:start", "--item-id", item.id, "--project-id", projectId], cwd);
      const runs = runCli(["--db", dbPath, "runs:list", "--item-id", item.id], cwd) as Array<{ id: string; status: string }>;
      expect(runs.length).toBeGreaterThanOrEqual(2);
      const requirementRunId = runs.find((run) => run.status === "completed" && run.id)?.id ?? runs[1]!.id;
      const runDetail = runCli(["--db", dbPath, "run:show", "--run-id", requirementRunId], cwd) as {
        artifacts: Array<{ id: string }>;
        sessions: Array<{ id: string }>;
      };
      expect(runDetail.artifacts.length).toBeGreaterThan(0);
      expect(runDetail.sessions.length).toBe(1);

      runCli(["--db", dbPath, "stories:approve", "--project-id", projectId], cwd);
      runCli(["--db", dbPath, "architecture:start", "--item-id", item.id, "--project-id", projectId], cwd);
      runCli(["--db", dbPath, "architecture:approve", "--project-id", projectId], cwd);

      const artifacts = runCli(["--db", dbPath, "artifacts:list", "--item-id", item.id], cwd) as Array<{ id: string }>;
      expect(artifacts.length).toBeGreaterThan(0);

      const finalState = runCli(["--db", dbPath, "item:show", "--item-id", item.id], cwd) as {
        item: { currentColumn: string; phaseStatus: string };
      };

      expect(finalState.item.currentColumn).toBe("implementation");
      expect(finalState.item.phaseStatus).toBe("completed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
    },
    15000
  );

  it("returns structured errors for invalid commands", () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-e2e-"));
    const dbPath = join(root, "app.sqlite");
    const cwd = resolve(".");

    try {
      const error = runCliError(["--db", dbPath, "run:show", "--run-id", "missing"], cwd);
      expect(error.error.code).toBe("RUN_NOT_FOUND");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("works when invoked outside the repository root", () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-e2e-"));
    const dbPath = join(root, "app.sqlite");

    try {
      const item = runCli(["--db", dbPath, "item:create", "--title", "External CWD"], root) as { id: string };
      const result = runCli(["--db", dbPath, "brainstorm:start", "--item-id", item.id], root) as { status: string };
      expect(result.status).toBe("completed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
