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

describe("cli planning review", () => {
  it(
    "attaches advisory planning review to brainstorm promotion and stage runs",
    () => {
      const root = mkdtempSync(join(tmpdir(), "beerengineer-planning-review-trigger-"));
      const dbPath = join(root, "app.sqlite");
      const cwd = resolve(".");

      try {
        const item = runCli(["--db", dbPath, "item:create", "--title", "Planning Trigger CLI", "--description", "Exercise auto planning review hooks"], cwd) as {
          id: string;
        };
        runCli(["--db", dbPath, "brainstorm:start", "--item-id", item.id], cwd);
        const brainstorm = runCli(["--db", dbPath, "brainstorm:show", "--item-id", item.id], cwd) as {
          session: { id: string };
        };
        runCli(
          [
            "--db",
            dbPath,
            "brainstorm:draft:update",
            "--session-id",
            brainstorm.session.id,
            "--problem",
            "Need advisory planning review hooks in the normal workflow",
            "--core-outcome",
            "Attach readiness review without separate manual ceremony",
            "--target-user",
            "delivery lead",
            "--use-case",
            "review architecture and plans automatically after generation",
            "--risk",
            "Automation could create noise",
            "--recommended-direction",
            "Trigger advisory planning review from existing workflow services",
            "--clear-open-questions"
          ],
          cwd
        );

        const promoted = runCli(["--db", dbPath, "brainstorm:promote", "--session-id", brainstorm.session.id], cwd) as {
          planningReview?: { run: { id: string; status: string } };
          conceptId: string;
        };
        expect(promoted.planningReview?.run.status).toBe("ready");

        runCli(["--db", dbPath, "concept:approve", "--concept-id", promoted.conceptId], cwd);
        runCli(["--db", dbPath, "project:import", "--item-id", item.id], cwd);
        const itemState = runCli(["--db", dbPath, "item:show", "--item-id", item.id], cwd) as {
          projects: Array<{ id: string }>;
        };
        const projectId = itemState.projects[0]!.id;

        runCli(["--db", dbPath, "requirements:start", "--item-id", item.id, "--project-id", projectId], cwd);
        runCli(["--db", dbPath, "stories:approve", "--project-id", projectId], cwd);

        const architecture = runCli(["--db", dbPath, "architecture:start", "--item-id", item.id, "--project-id", projectId], cwd) as {
          planningReview?: { run: { status: string } };
          status: string;
        };
        expect(architecture.status).toBe("completed");
        expect(architecture.planningReview?.run.status).toBe("ready");

        runCli(["--db", dbPath, "architecture:approve", "--project-id", projectId], cwd);
        const planning = runCli(["--db", dbPath, "planning:start", "--item-id", item.id, "--project-id", projectId], cwd) as {
          planningReview?: { run: { status: string } };
          status: string;
        };
        expect(planning.status).toBe("completed");
        expect(planning.planningReview?.run.status).toBe("needs_clarification");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    25000
  );

  it(
    "supports planning review creation, clarification answers and rerun",
    () => {
      const root = mkdtempSync(join(tmpdir(), "beerengineer-planning-review-"));
      const dbPath = join(root, "app.sqlite");
      const cwd = resolve(".");

      try {
        const item = runCli(["--db", dbPath, "item:create", "--title", "Planning Review CLI", "--description", "Validate planning review runtime"], cwd) as {
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
            "Teams need a reliable planning review loop before implementation",
            "--core-outcome",
            "Make early planning reviews first-class in the CLI",
            "--target-user",
            "delivery lead",
            "--use-case",
            "review a plan before implementation",
            "--risk",
            "Review noise could hide real blockers",
            "--recommended-direction",
            "Add explicit planning review runs with synthesis and clarification",
            "--clear-open-questions"
          ],
          cwd
        );

        const started = runCli(
          [
            "--db",
            dbPath,
            "planning-review:start",
            "--source-type",
            "brainstorm_session",
            "--source-id",
            shown.session.id,
            "--step",
            "plan_writing",
            "--review-mode",
            "readiness",
            "--mode",
            "interactive"
          ],
          cwd
        ) as {
          run: { id: string; status: string };
          questions: Array<{ id: string; question: string }>;
        };

        expect(started.run.status).toBe("needs_clarification");
        expect(started.questions.length).toBeGreaterThanOrEqual(2);

        const testQuestion = started.questions.find((question) => question.question.toLowerCase().includes("test")) ?? started.questions[0]!;
        const rolloutQuestion =
          started.questions.find((question) => question.question.toLowerCase().includes("rollout")) ?? started.questions[1]!;

        runCli(
          [
            "--db",
            dbPath,
            "planning-review:question:answer",
            "--run-id",
            started.run.id,
            "--question-id",
            testQuestion.id,
            "--answer",
            "Tests will cover the new planning review CLI flow and synthesis persistence."
          ],
          cwd
        );
        runCli(
          [
            "--db",
            dbPath,
            "planning-review:question:answer",
            "--run-id",
            started.run.id,
            "--question-id",
            rolloutQuestion.id,
            "--answer",
            "Rollout starts as advisory-only and includes a manual rollback to the old review path."
          ],
          cwd
        );

        const rerun = runCli(["--db", dbPath, "planning-review:rerun", "--run-id", started.run.id], cwd) as {
          run: { id: string; status: string };
          findings: Array<{ status: string }>;
          synthesis: { readiness: string } | null;
        };

        expect(rerun.run.status).toBe("ready");
        expect(rerun.synthesis?.readiness).toBe("ready");
        expect(rerun.findings).toHaveLength(0);

        const originalRun = runCli(["--db", dbPath, "planning-review:show", "--run-id", started.run.id], cwd) as {
          findings: Array<{ status: string }>;
        };
        expect(originalRun.findings.length).toBeGreaterThan(0);
        expect(originalRun.findings.every((finding) => finding.status === "resolved")).toBe(true);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    25000
  );

  it(
    "supports additional planning review source types",
    () => {
      const root = mkdtempSync(join(tmpdir(), "beerengineer-planning-review-sources-"));
      const dbPath = join(root, "app.sqlite");
      const cwd = resolve(".");

      try {
        const item = runCli(["--db", dbPath, "item:create", "--title", "Planning Source CLI", "--description", "Exercise multiple source types"], cwd) as {
          id: string;
        };
        runCli(["--db", dbPath, "brainstorm:start", "--item-id", item.id], cwd);
        const brainstorm = runCli(["--db", dbPath, "brainstorm:show", "--item-id", item.id], cwd) as {
          session: { id: string };
        };
        runCli(
          [
            "--db",
            dbPath,
            "brainstorm:draft:update",
            "--session-id",
            brainstorm.session.id,
            "--problem",
            "Need reviewable requirement artifacts",
            "--core-outcome",
            "Keep planning review inputs normalized",
            "--target-user",
            "architect",
            "--use-case",
            "rerun review from draft or interactive review session",
            "--recommended-direction",
            "Use persisted workflow objects as planning review sources",
            "--clear-open-questions"
          ],
          cwd
        );

        const latestDraft = runCli(["--db", dbPath, "brainstorm:draft", "--session-id", brainstorm.session.id], cwd) as {
          id: string;
        };

        const fromDraft = runCli(
          [
            "--db",
            dbPath,
            "planning-review:start",
            "--source-type",
            "brainstorm_draft",
            "--source-id",
            latestDraft.id,
            "--step",
            "requirements_engineering",
            "--review-mode",
            "critique",
            "--mode",
            "interactive"
          ],
          cwd
        ) as {
          run: { status: string };
        };
        expect(fromDraft.run.status).toBe("ready");

        const promoted = runCli(["--db", dbPath, "brainstorm:promote", "--session-id", brainstorm.session.id], cwd) as {
          conceptId: string;
        };
        runCli(["--db", dbPath, "concept:approve", "--concept-id", promoted.conceptId], cwd);
        runCli(["--db", dbPath, "project:import", "--item-id", item.id], cwd);
        const itemState = runCli(["--db", dbPath, "item:show", "--item-id", item.id], cwd) as {
          projects: Array<{ id: string }>;
        };
        const projectId = itemState.projects[0]!.id;
        runCli(["--db", dbPath, "requirements:start", "--item-id", item.id, "--project-id", projectId], cwd);

        const review = runCli(["--db", dbPath, "review:start", "--type", "stories", "--project-id", projectId], cwd) as {
          sessionId: string;
        };
        const fromInteractiveReview = runCli(
          [
            "--db",
            dbPath,
            "planning-review:start",
            "--source-type",
            "interactive_review_session",
            "--source-id",
            review.sessionId,
            "--step",
            "requirements_engineering",
            "--review-mode",
            "readiness",
            "--mode",
            "interactive"
          ],
          cwd
        ) as {
          run: { status: string };
        };
        expect(fromInteractiveReview.run.status).toBe("needs_clarification");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    25000
  );

  it(
    "treats concept reviews without a proposal as clarification-needed",
    () => {
      const root = mkdtempSync(join(tmpdir(), "beerengineer-planning-review-concept-"));
      const dbPath = join(root, "app.sqlite");
      const cwd = resolve(".");

      try {
        const item = runCli(["--db", dbPath, "item:create", "--title", "Planning Concept CLI", "--description", "Review concept-only source"], cwd) as {
          id: string;
        };
        runCli(["--db", dbPath, "brainstorm:start", "--item-id", item.id], cwd);
        const brainstorm = runCli(["--db", dbPath, "brainstorm:show", "--item-id", item.id], cwd) as {
          session: { id: string };
        };
        const promoted = runCli(["--db", dbPath, "brainstorm:promote", "--session-id", brainstorm.session.id], cwd) as {
          conceptId: string;
        };

        const review = runCli(
          [
            "--db",
            dbPath,
            "planning-review:start",
            "--source-type",
            "concept",
            "--source-id",
            promoted.conceptId,
            "--step",
            "architecture",
            "--review-mode",
            "critique",
            "--mode",
            "interactive"
          ],
          cwd
        ) as {
          run: { status: string };
          findings: Array<{ title: string; findingType: string }>;
        };

        expect(review.run.status).toBe("needs_clarification");
        expect(review.findings.some((finding) => finding.title === "proposal is missing" && finding.findingType === "blocker")).toBe(true);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    25000
  );

  it(
    "carries persistent findings forward as open on rerun",
    () => {
      const root = mkdtempSync(join(tmpdir(), "beerengineer-planning-review-persistent-"));
      const dbPath = join(root, "app.sqlite");
      const cwd = resolve(".");

      try {
        const item = runCli(["--db", dbPath, "item:create", "--title", "Planning Persistent CLI", "--description", "Track persistent findings"], cwd) as {
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
            "Need rerun tracking for planning review findings",
            "--core-outcome",
            "Keep persistent findings visible across reruns",
            "--target-user",
            "delivery lead",
            "--use-case",
            "rerun the same review without changing the source artifact",
            "--recommended-direction",
            "Store finding fingerprints and compare against the previous run",
            "--clear-risks",
            "--clear-open-questions"
          ],
          cwd
        );

        const started = runCli(
          [
            "--db",
            dbPath,
            "planning-review:start",
            "--source-type",
            "brainstorm_session",
            "--source-id",
            shown.session.id,
            "--step",
            "requirements_engineering",
            "--review-mode",
            "critique",
            "--mode",
            "interactive"
          ],
          cwd
        ) as {
          run: { id: string };
          findings: Array<{ status: string }>;
        };
        expect(started.findings.length).toBeGreaterThan(0);
        expect(started.findings.every((finding) => finding.status === "new")).toBe(true);

        const rerun = runCli(["--db", dbPath, "planning-review:rerun", "--run-id", started.run.id], cwd) as {
          findings: Array<{ status: string }>;
        };
        expect(rerun.findings.length).toBeGreaterThan(0);
        expect(rerun.findings.every((finding) => finding.status === "open")).toBe(true);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    25000
  );
});
