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

describe("cli interactive brainstorm", () => {
  it(
    "supports brainstorm show, chat, draft update and promote",
    () => {
      const root = mkdtempSync(join(tmpdir(), "beerengineer-e2e-"));
      const dbPath = join(root, "app.sqlite");
      const cwd = resolve(".");

      try {
        const item = runCli(["--db", dbPath, "item:create", "--title", "Brainstorm CLI", "--description", "Interactive concept shaping"], cwd) as {
          id: string;
        };
        runCli(["--db", dbPath, "brainstorm:start", "--item-id", item.id], cwd);

        const shown = runCli(["--db", dbPath, "brainstorm:show", "--item-id", item.id], cwd) as {
          session: { id: string; status: string };
          draft: { revision: number };
        };
        expect(shown.session.status).toBe("waiting_for_user");
        expect(shown.draft.revision).toBe(1);

        const chatted = runCli(
          [
            "--db",
            dbPath,
            "brainstorm:chat",
            "--session-id",
            shown.session.id,
            "--message",
            [
              "problem: Teams cannot see review state across workflow runs",
              "users: support operator; delivery lead",
              "use cases: inspect active review sessions; spot blocked approvals",
              "candidate directions: review inbox dashboard; timeline view",
              "recommended direction: review inbox dashboard"
            ].join("\n")
          ],
          cwd
        ) as {
          mode: string;
          draft: { revision: number; targetUsers: string[]; candidateDirections: string[] };
        };
        expect(chatted.draft.revision).toBe(2);
        expect(chatted.mode).toBe("converge");
        expect(chatted.draft.targetUsers).toEqual(["support operator", "delivery lead"]);
        expect(chatted.draft.candidateDirections).toEqual(["review inbox dashboard", "timeline view"]);

        const updated = runCli(
          [
            "--db",
            dbPath,
            "brainstorm:draft:update",
            "--session-id",
            shown.session.id,
            "--core-outcome",
            "Give delivery teams one shared review control surface",
            "--use-case",
            "inspect active review sessions",
            "--use-case",
            "spot blocked approvals",
            "--use-case",
            "resume stalled reviews",
            "--clear-open-questions",
            "--assumption",
            "Existing workflow records already contain enough metadata for a first MVP"
          ],
          cwd
        ) as {
          status: string;
          mode: string;
          draft: { revision: number; useCases: string[]; openQuestions: string[] };
        };
        expect(updated.status).toBe("ready_for_concept");
        expect(updated.mode).toBe("converge");
        expect(updated.draft.revision).toBe(3);
        expect(updated.draft.useCases).toContain("resume stalled reviews");
        expect(updated.draft.openQuestions).toEqual([]);

        const draft = runCli(["--db", dbPath, "brainstorm:draft", "--session-id", shown.session.id], cwd) as {
          revision: number;
          useCases: string[];
          coreOutcome: string | null;
        };
        expect(draft.revision).toBe(3);
        expect(draft.useCases.length).toBe(3);
        expect(draft.coreOutcome).toContain("shared review control surface");

        const promoted = runCli(["--db", dbPath, "brainstorm:promote", "--session-id", shown.session.id], cwd) as {
          conceptId: string;
          status: string;
        };
        expect(promoted.status).toBe("promoted");
        expect(promoted.conceptId).toContain("concept_");
        runCli(["--db", dbPath, "concept:approve", "--concept-id", promoted.conceptId], cwd);

        const imported = runCli(["--db", dbPath, "project:import", "--item-id", item.id], cwd) as {
          importedCount: number;
        };
        expect(imported.importedCount).toBe(1);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    25000
  );

  it(
    "shows a resolved brainstorm session without creating a new one",
    () => {
      const root = mkdtempSync(join(tmpdir(), "beerengineer-e2e-"));
      const dbPath = join(root, "app.sqlite");
      const cwd = resolve(".");

      try {
        const item = runCli(["--db", dbPath, "item:create", "--title", "Resolved Brainstorm CLI", "--description", "Inspect closed session"], cwd) as {
          id: string;
        };
        runCli(["--db", dbPath, "brainstorm:start", "--item-id", item.id], cwd);

        const shown = runCli(["--db", dbPath, "brainstorm:show", "--item-id", item.id], cwd) as {
          session: { id: string };
        };
        runCli(
          [
            "--db",
            dbPath,
            "brainstorm:draft:update",
            "--session-id",
            shown.session.id,
            "--problem",
            "Need a stable read-only inspect path",
            "--target-user",
            "operator",
            "--use-case",
            "inspect resolved brainstorms",
            "--recommended-direction",
            "read-only brainstorm summary"
          ],
          cwd
        );
        runCli(["--db", dbPath, "brainstorm:promote", "--session-id", shown.session.id], cwd);

        const afterPromotion = runCli(["--db", dbPath, "brainstorm:show", "--item-id", item.id], cwd) as {
          session: { id: string; status: string };
          draft: { revision: number };
        };
        expect(afterPromotion.session.id).toBe(shown.session.id);
        expect(afterPromotion.session.status).toBe("resolved");
        expect(afterPromotion.draft.revision).toBe(2);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    25000
  );
});
