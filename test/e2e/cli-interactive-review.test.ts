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
    try {
      return JSON.parse(stderr) as { error: { code: string; message: string } };
    } catch {
      return {
        error: {
          code: "UNEXPECTED_ERROR",
          message: stderr.trim()
        }
      };
    }
  }
}

describe("cli interactive review", () => {
  it(
    "supports interactive review commands for story approval and autorun",
    () => {
      const root = mkdtempSync(join(tmpdir(), "beerengineer-e2e-"));
      const dbPath = join(root, "app.sqlite");
      const cwd = resolve(".");

      try {
        const item = runCli(["--db", dbPath, "item:create", "--title", "Review CLI", "--description", "Desc"], cwd) as {
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

        const started = runCli(["--db", dbPath, "review:start", "--type", "stories", "--project-id", projectId], cwd) as {
          sessionId: string;
          status: string;
        };
        expect(started.status).toBe("waiting_for_user");

        const reviewState = runCli(["--db", dbPath, "review:show", "--session-id", started.sessionId], cwd) as {
          stories: Array<{ id: string; code: string }>;
        };
        expect(reviewState.stories.length).toBeGreaterThan(0);

        const firstStory = reviewState.stories[0]!;
        const chat = runCli(
          ["--db", dbPath, "review:chat", "--session-id", started.sessionId, "--message", `${firstStory.code} looks good and can be approved`],
          cwd
        ) as {
          derivedUpdates: Array<{ entryId: string; status: string }>;
        };
        expect(chat.derivedUpdates[0]?.entryId).toBe(firstStory.id);

        runCli(
          [
            "--db",
            dbPath,
            "review:entry:update",
            "--session-id",
            started.sessionId,
            "--story-id",
            firstStory.id,
            "--status",
            "accepted",
            "--summary",
            "Approved explicitly from CLI"
          ],
          cwd
        );

        const resolved = runCli(
          ["--db", dbPath, "review:resolve", "--session-id", started.sessionId, "--action", "approve_and_autorun"],
          cwd
        ) as {
          status: string;
          autorun: { finalStatus: string; stopReason: string };
          resolutionId: string;
        };
        expect(resolved.status).toBe("resolved");
        expect(resolved.autorun.finalStatus).toBe("completed");
        expect(resolved.autorun.stopReason).toBe("project_completed");

        const resolvedState = runCli(["--db", dbPath, "review:show", "--session-id", started.sessionId], cwd) as {
          resolutions: Array<{ id: string; payloadJson: string | null }>;
        };
        const storedResolution = resolvedState.resolutions.find((resolution) => resolution.id === resolved.resolutionId);
        expect(storedResolution?.payloadJson).toContain("\"autorun\"");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    25000
  );

  it(
    "supports guided story edits and selected approvals via interactive review CLI",
    () => {
      const root = mkdtempSync(join(tmpdir(), "beerengineer-e2e-"));
      const dbPath = join(root, "app.sqlite");
      const cwd = resolve(".");

      try {
        const item = runCli(["--db", dbPath, "item:create", "--title", "Review Edit CLI", "--description", "Desc"], cwd) as {
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

        const started = runCli(["--db", dbPath, "review:start", "--type", "stories", "--project-id", projectId], cwd) as {
          sessionId: string;
        };
        const reviewState = runCli(["--db", dbPath, "review:show", "--session-id", started.sessionId], cwd) as {
          stories: Array<{ id: string; title: string; acceptanceCriteria: Array<{ text: string }> }>;
        };
        const firstStory = reviewState.stories[0]!;

        const edited = runCli(
          [
            "--db",
            dbPath,
            "review:story:edit",
            "--session-id",
            started.sessionId,
            "--story-id",
            firstStory.id,
            "--title",
            "CLI sharpened title",
            "--acceptance-criterion",
            "Clarified criterion one",
            "--acceptance-criterion",
            "Clarified criterion two"
          ],
          cwd
        ) as {
          story: { title: string };
          acceptanceCriteria: Array<{ text: string }>;
        };
        expect(edited.story.title).toBe("CLI sharpened title");
        expect(edited.acceptanceCriteria.map((criterion) => criterion.text)).toEqual([
          "Clarified criterion one",
          "Clarified criterion two"
        ]);

        const resolved = runCli(
          [
            "--db",
            dbPath,
            "review:resolve",
            "--session-id",
            started.sessionId,
            "--action",
            "approve_selected",
            "--story-id",
            firstStory.id
          ],
          cwd
        ) as {
          status: string;
          action: string;
        };
        expect(resolved.status).toBe("resolved");
        expect(resolved.action).toBe("approve_selected");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    25000
  );

  it(
    "validates interactive review CLI enums at runtime",
    () => {
      const root = mkdtempSync(join(tmpdir(), "beerengineer-e2e-"));
      const dbPath = join(root, "app.sqlite");
      const cwd = resolve(".");

      try {
        const item = runCli(["--db", dbPath, "item:create", "--title", "Review CLI Invalid", "--description", "Desc"], cwd) as {
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
        const started = runCli(["--db", dbPath, "review:start", "--type", "stories", "--project-id", projectId], cwd) as {
          sessionId: string;
        };
        const reviewState = runCli(["--db", dbPath, "review:show", "--session-id", started.sessionId], cwd) as {
          stories: Array<{ id: string }>;
        };
        const firstStory = reviewState.stories[0]!;

        const invalidStatus = runCliError(
          [
            "--db",
            dbPath,
            "review:entry:update",
            "--session-id",
            started.sessionId,
            "--story-id",
            firstStory.id,
            "--status",
            "invalid"
          ],
          cwd
        );
        expect(invalidStatus.error.message).toContain("Allowed choices");

        const invalidAction = runCliError(
          ["--db", dbPath, "review:resolve", "--session-id", started.sessionId, "--action", "bogus"],
          cwd
        );
        expect(invalidAction.error.message).toContain("Allowed choices");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    25000
  );
});
