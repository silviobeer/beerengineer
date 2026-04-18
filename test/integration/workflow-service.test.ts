import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { createAppContext } from "../../src/app-context.js";

describe("workflow service", () => {
  it("starts a brainstorm run and stores prompt snapshots", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      const item = context.repositories.itemRepository.create({
        title: "Agent Workflow",
        description: "Build the flow"
      });

      const result = await context.workflowService.startStage({
        stageKey: "brainstorm",
        itemId: item.id
      });
      const run = context.repositories.stageRunRepository.getById(result.runId);

      expect(run?.status).toBe("completed");
      expect(run?.systemPromptSnapshot).toContain("Brainstorm Stage System Prompt");
      expect(run?.skillsSnapshotJson).toContain("brainstorm-facilitation");
      expect(context.repositories.itemRepository.getById(item.id)?.code).toBe("ITEM-0001");
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps prior prompt snapshots after prompt file changes", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);
    const originalPrompt = readFileSync("prompts/system/brainstorm.md", "utf8");

    try {
      const item = context.repositories.itemRepository.create({
        title: "Snapshot Test",
        description: "Snapshots"
      });
      const first = await context.workflowService.startStage({
        stageKey: "brainstorm",
        itemId: item.id
      });
      writeFileSync("prompts/system/brainstorm.md", "# Brainstorm System Prompt\n\nChanged prompt for test.");
      const second = await context.workflowService.startStage({
        stageKey: "brainstorm",
        itemId: item.id
      });

      const firstRun = context.repositories.stageRunRepository.getById(first.runId);
      const secondRun = context.repositories.stageRunRepository.getById(second.runId);

      expect(firstRun?.systemPromptSnapshot).not.toBe(secondRun?.systemPromptSnapshot);
      expect(firstRun?.systemPromptSnapshot).toBe(originalPrompt);
      expect(secondRun?.systemPromptSnapshot).toContain("Changed prompt");
    } finally {
      writeFileSync("prompts/system/brainstorm.md", originalPrompt);
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("marks run review_required when structured output is invalid", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const repoScript = "scripts/local-agent.mjs";
    const originalScript = readFileSync(repoScript, "utf8");
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      const item = context.repositories.itemRepository.create({
        title: "Review Path",
        description: "Bad json"
      });

      const currentScript = existsSync(repoScript);
      expect(currentScript).toBe(true);
      const scriptContent = `process.stdout.write(JSON.stringify({markdownArtifacts:[{kind:"concept",content:"# Concept"}],structuredArtifacts:[{kind:"projects",content:{broken:true}}]}));`;
      writeFileSync(repoScript, scriptContent);
      const result = await context.workflowService.startStage({
        stageKey: "brainstorm",
        itemId: item.id
      });
      const run = context.repositories.stageRunRepository.getById(result.runId);

      expect(run?.status).toBe("review_required");
      expect(run?.errorMessage).toContain("Failed to import brainstorm output");
    } finally {
      writeFileSync(repoScript, originalScript);
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("retries a review_required run and completes after fixing the adapter output", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const repoScript = "scripts/local-agent.mjs";
    const originalScript = readFileSync(repoScript, "utf8");
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      const item = context.repositories.itemRepository.create({
        title: "Retry Path",
        description: "Retry invalid output"
      });

      writeFileSync(
        repoScript,
        `process.stdout.write(JSON.stringify({markdownArtifacts:[{kind:"concept",content:"# Concept"}],structuredArtifacts:[{kind:"projects",content:{broken:true}}]}));`
      );
      const first = await context.workflowService.startStage({
        stageKey: "brainstorm",
        itemId: item.id
      });
      const firstRun = context.repositories.stageRunRepository.getById(first.runId);
      expect(firstRun?.status).toBe("review_required");

      writeFileSync(repoScript, originalScript);
      const retried = await context.workflowService.retryRun(first.runId);
      const retriedRun = context.repositories.stageRunRepository.getById(retried.runId);

      expect(retried.retriedFromRunId).toBe(first.runId);
      expect(retriedRun?.status).toBe("completed");
    } finally {
      writeFileSync(repoScript, originalScript);
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps project import and approvals idempotent", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      const item = context.repositories.itemRepository.create({
        title: "Idempotency",
        description: "Stable approvals"
      });
      await context.workflowService.startStage({
        stageKey: "brainstorm",
        itemId: item.id
      });

      const concept = context.repositories.conceptRepository.getLatestByItemId(item.id);
      expect(concept).not.toBeNull();
      context.workflowService.approveConcept(concept!.id);
      context.workflowService.approveConcept(concept!.id);

      const firstImport = context.workflowService.importProjects(item.id);
      const secondImport = context.workflowService.importProjects(item.id);
      expect(firstImport.importedCount).toBe(1);
      expect(secondImport.importedCount).toBe(0);

      const project = context.repositories.projectRepository.listByItemId(item.id)[0];
      expect(project).toBeTruthy();
      expect(project?.code).toBe("ITEM-0001-P01");

      await context.workflowService.startStage({
        stageKey: "requirements",
        itemId: item.id,
        projectId: project!.id
      });
      context.workflowService.approveStories(project!.id);
      context.workflowService.approveStories(project!.id);

      await context.workflowService.startStage({
        stageKey: "architecture",
        itemId: item.id,
        projectId: project!.id
      });

      const stories = context.repositories.userStoryRepository.listByProjectId(project!.id);
      expect(stories.map((story) => story.code)).toEqual(["ITEM-0001-P01-US01", "ITEM-0001-P01-US02"]);
      const acceptanceCriteria = context.repositories.acceptanceCriterionRepository.listByProjectId(project!.id);
      expect(acceptanceCriteria.map((criterion) => criterion.code)).toEqual([
        "ITEM-0001-P01-US01-AC01",
        "ITEM-0001-P01-US01-AC02",
        "ITEM-0001-P01-US02-AC01",
        "ITEM-0001-P01-US02-AC02"
      ]);

      context.workflowService.approveArchitecture(project!.id);
      context.workflowService.approveArchitecture(project!.id);

      const itemState = context.repositories.itemRepository.getById(item.id);
      expect(itemState?.phaseStatus).toBe("completed");
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("links input artifacts for downstream runs", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      const item = context.repositories.itemRepository.create({
        title: "Provenance",
        description: "Track inputs"
      });
      await context.workflowService.startStage({
        stageKey: "brainstorm",
        itemId: item.id
      });
      const concept = context.repositories.conceptRepository.getLatestByItemId(item.id);
      context.workflowService.approveConcept(concept!.id);
      context.workflowService.importProjects(item.id);
      const project = context.repositories.projectRepository.listByItemId(item.id)[0]!;

      const requirementsRun = await context.workflowService.startStage({
        stageKey: "requirements",
        itemId: item.id,
        projectId: project.id
      });

      const linkedInputs = context.connection
        .prepare("SELECT count(*) as count FROM stage_run_input_artifacts WHERE stage_run_id = ?")
        .get(requirementsRun.runId) as { count: number };

      expect(linkedInputs.count).toBeGreaterThan(0);
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
