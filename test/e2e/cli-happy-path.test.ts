import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function replaceRequired(source: string, searchValue: string, replaceValue: string): string {
  const patched = source.replace(searchValue, replaceValue);
  expect(patched).not.toBe(source);
  return patched;
}

function createGitWorkspace(root: string): string {
  const workspaceRoot = join(root, "workspace");
  execFileSync("mkdir", ["-p", workspaceRoot]);
  execFileSync("git", ["init", "-b", "main"], { cwd: workspaceRoot });
  writeFileSync(join(workspaceRoot, "README.md"), "# temp workspace\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: workspaceRoot });
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init"], {
    cwd: workspaceRoot
  });
  return workspaceRoot;
}

describe("cli happy path", () => {
  it(
    "runs item creation through execution completion",
    () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-e2e-"));
    const dbPath = join(root, "app.sqlite");
    const cwd = resolve(".");

    try {
      const item = runCli(["--db", dbPath, "item:create", "--title", "CLI Item", "--description", "Desc"], cwd) as { id: string; code: string };
      expect(item.code).toBe("ITEM-0001");
      const brainstorm = runCli(["--db", dbPath, "brainstorm:start", "--item-id", item.id], cwd) as { runId: string };
      expect(brainstorm.runId).toContain("run_");

      const itemShow = runCli(["--db", dbPath, "item:show", "--item-id", item.id], cwd) as {
        concept: { id: string };
        projects: Array<{ id: string }>;
      };

      runCli(["--db", dbPath, "concept:approve", "--concept-id", itemShow.concept.id], cwd);
      runCli(["--db", dbPath, "project:import", "--item-id", item.id], cwd);

      const imported = runCli(["--db", dbPath, "item:show", "--item-id", item.id], cwd) as {
        projects: Array<{ id: string; code: string }>;
      };
      const projectId = imported.projects[0]?.id;
      expect(projectId).toBeTruthy();
      expect(imported.projects[0]?.code).toBe("ITEM-0001-P01");

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
      runCli(["--db", dbPath, "planning:start", "--item-id", item.id, "--project-id", projectId], cwd);
      runCli(["--db", dbPath, "planning:approve", "--project-id", projectId], cwd);
      const firstExecution = runCli(["--db", dbPath, "execution:start", "--project-id", projectId], cwd) as {
        activeWaveCode: string | null;
        scheduledCount: number;
      };
      expect(firstExecution.activeWaveCode).toBe("W01");
      expect(firstExecution.scheduledCount).toBe(1);

      const secondExecution = runCli(["--db", dbPath, "execution:tick", "--project-id", projectId], cwd) as {
        activeWaveCode: string | null;
        scheduledCount: number;
      };
      expect(secondExecution.activeWaveCode).toBe("W02");
      expect(secondExecution.scheduledCount).toBe(1);

      const qa = runCli(["--db", dbPath, "qa:start", "--project-id", projectId], cwd) as {
        qaRunId: string;
        status: string;
      };
      expect(qa.status).toBe("passed");

      const documentation = runCli(["--db", dbPath, "documentation:start", "--project-id", projectId], cwd) as {
        documentationRunId: string;
        status: string;
      };
      expect(documentation.status).toBe("completed");

      const executionShow = runCli(["--db", dbPath, "execution:show", "--project-id", projectId], cwd) as {
        activeWave: { code: string } | null;
        waves: Array<{
          waveExecution: { status: string } | null;
          stories: Array<{
            latestTestRun: { id: string } | null;
            latestRalphVerification: { mode: string; status: string } | null;
            verificationRuns: Array<{ mode: string; status: string }>;
            testAgentSessions: Array<{ id: string }>;
          }>;
        }>;
      };
      expect(executionShow.activeWave).toBeNull();
      expect(executionShow.waves.map((wave) => wave.waveExecution?.status)).toEqual(["completed", "completed"]);
      expect(executionShow.waves[0]?.stories[0]?.latestTestRun?.id).toContain("wave_story_test_run_");
      expect(executionShow.waves[0]?.stories[0]?.verificationRuns.map((run) => run.mode)).toEqual(["basic", "ralph"]);
      expect(executionShow.waves[0]?.stories[0]?.latestRalphVerification?.status).toBe("passed");
      expect(executionShow.waves[0]?.stories[0]?.testAgentSessions.length).toBe(1);

      const artifacts = runCli(["--db", dbPath, "artifacts:list", "--item-id", item.id], cwd) as Array<{ id: string }>;
      expect(artifacts.length).toBeGreaterThan(0);

      const finalState = runCli(["--db", dbPath, "item:show", "--item-id", item.id], cwd) as {
        item: { currentColumn: string; phaseStatus: string };
      };

      expect(finalState.item.currentColumn).toBe("done");
      expect(finalState.item.phaseStatus).toBe("completed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
    },
    25000
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
      const item = runCli(["--db", dbPath, "item:create", "--title", "External CWD"], root) as { id: string; code: string };
      expect(item.code).toBe("ITEM-0001");
      const result = runCli(["--db", dbPath, "brainstorm:start", "--item-id", item.id], root) as { status: string };
      expect(result.status).toBe("completed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it(
    "supports approve plus autorun from concept approval",
    () => {
      const root = mkdtempSync(join(tmpdir(), "beerengineer-e2e-"));
      const dbPath = join(root, "app.sqlite");
      const cwd = resolve(".");

      try {
        const item = runCli(["--db", dbPath, "item:create", "--title", "Autorun CLI", "--description", "Desc"], cwd) as {
          id: string;
        };
        runCli(["--db", dbPath, "brainstorm:start", "--item-id", item.id], cwd);
        const itemShow = runCli(["--db", dbPath, "item:show", "--item-id", item.id], cwd) as {
          concept: { id: string };
        };

        const autorun = runCli(
          ["--db", dbPath, "concept:approve", "--concept-id", itemShow.concept.id, "--autorun"],
          cwd
        ) as {
          finalStatus: string;
          stopReason: string;
          steps: Array<{ action: string }>;
        };

        expect(autorun.finalStatus).toBe("completed");
        expect(autorun.stopReason).toBe("item_completed");
        expect(autorun.steps.some((step) => step.action === "documentation:start")).toBe(true);

        const finalState = runCli(["--db", dbPath, "item:show", "--item-id", item.id], cwd) as {
          item: { currentColumn: string; phaseStatus: string };
        };
        expect(finalState.item.currentColumn).toBe("done");
        expect(finalState.item.phaseStatus).toBe("completed");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    25000
  );

  it(
    "supports live remediation runs via adapter and workspace overrides",
    () => {
      const root = mkdtempSync(join(tmpdir(), "beerengineer-e2e-"));
      const dbPath = join(root, "app.sqlite");
      const cwd = resolve(".");
      const workspaceRoot = createGitWorkspace(root);
      const adapterScriptPath = join(root, "local-agent-story-review-remediation.mjs");

      try {
        const originalScript = readFileSync(resolve(cwd, "scripts/local-agent.mjs"), "utf8");
        const remediationScript = replaceRequired(
          originalScript,
          "function storyReview(payload) {\n  const findings = [];",
          `function storyReview(payload) {\n  const findings = payload.implementation.summary.includes("story-review-remediator") ? [] : [{
    severity: "medium",
    category: "maintainability",
    title: "CLI remediation target",
    description: "The first story review requests a bounded remediation.",
    evidence: "Injected by the CLI remediation fixture.",
    filePath: "src/workflow/workflow-service.ts",
    line: 1,
    suggestedFix: "Use the remediation loop."
  }];`
        );
        writeFileSync(adapterScriptPath, remediationScript, "utf8");

        const baseArgs = [
          "--db",
          dbPath,
          "--adapter-script-path",
          adapterScriptPath,
          "--workspace-root",
          workspaceRoot
        ];
        const item = runCli([...baseArgs, "item:create", "--title", "CLI Remediation", "--description", "Desc"], cwd) as {
          id: string;
        };
        runCli([...baseArgs, "brainstorm:start", "--item-id", item.id], cwd);
        const itemShow = runCli([...baseArgs, "item:show", "--item-id", item.id], cwd) as {
          concept: { id: string };
        };

        const autorun = runCli(
          [...baseArgs, "concept:approve", "--concept-id", itemShow.concept.id, "--autorun"],
          cwd
        ) as {
          finalStatus: string;
          createdRemediationRunIds: string[];
          steps: Array<{ action: string }>;
        };

        expect(autorun.finalStatus).toBe("completed");
        expect(autorun.steps.some((step) => step.action === "remediation:story-review:start")).toBe(true);
        expect(autorun.createdRemediationRunIds.length).toBeGreaterThan(0);

        const finalState = runCli([...baseArgs, "item:show", "--item-id", item.id], cwd) as {
          item: { currentColumn: string; phaseStatus: string };
          projects: Array<{ id: string }>;
        };
        expect(finalState.item.currentColumn).toBe("done");
        expect(finalState.item.phaseStatus).toBe("completed");

        const execution = runCli(
          [...baseArgs, "execution:show", "--project-id", finalState.projects[0]!.id],
          cwd
        ) as {
          waves: Array<{
            stories: Array<{
              story: { id: string };
              latestStoryReviewRun: { status: string } | null;
            }>;
          }>;
        };
        expect(execution.waves[0]?.stories[0]?.latestStoryReviewRun?.status).toBe("passed");

        const remediation = runCli(
          [...baseArgs, "remediation:story-review:show", "--story-id", execution.waves[0]!.stories[0]!.story.id],
          cwd
        ) as {
          latestRemediationRun: { status: string; gitBranchName: string | null } | null;
          openFindings: Array<unknown>;
        };
        expect(remediation.latestRemediationRun?.status).toBe("completed");
        expect(remediation.latestRemediationRun?.gitBranchName).toContain("fix/");
        expect(remediation.openFindings).toHaveLength(0);
        expect(execFileSync("git", ["branch", "--list", "story/*"], { cwd: workspaceRoot, encoding: "utf8" })).toContain(
          "story/"
        );
        expect(execFileSync("git", ["branch", "--list", "fix/*"], { cwd: workspaceRoot, encoding: "utf8" })).toContain(
          "fix/"
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    30000
  );

  it("separates item codes by workspace and exposes workspace commands", () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-e2e-"));
    const dbPath = join(root, "app.sqlite");
    const cwd = resolve(".");

    try {
      const createdWorkspace = runCli(
        ["--db", dbPath, "workspace:create", "--key", "app-two", "--name", "App Two"],
        cwd
      ) as { key: string };
      expect(createdWorkspace.key).toBe("app-two");

      const workspaces = runCli(["--db", dbPath, "workspace:list"], cwd) as Array<{ key: string }>;
      expect(workspaces.map((workspace) => workspace.key)).toContain("default");
      expect(workspaces.map((workspace) => workspace.key)).toContain("app-two");

      const firstItem = runCli(
        ["--db", dbPath, "--workspace", "default", "item:create", "--title", "One", "--description", "Desc"],
        cwd
      ) as { code: string };
      const secondItem = runCli(
        ["--db", dbPath, "--workspace", "app-two", "item:create", "--title", "Two", "--description", "Desc"],
        cwd
      ) as { code: string };

      expect(firstItem.code).toBe("ITEM-0001");
      expect(secondItem.code).toBe("ITEM-0001");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
