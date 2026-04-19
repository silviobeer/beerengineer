import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { createAppContext } from "../../src/app-context.js";

describe("workflow service", () => {
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

  async function prepareProjectThroughCompletedExecution(
    context: ReturnType<typeof createAppContext>,
    input: { title: string; description: string }
  ) {
    const item = context.repositories.itemRepository.create({
      title: input.title,
      description: input.description
    });
    await context.workflowService.startStage({ stageKey: "brainstorm", itemId: item.id });
    const concept = context.repositories.conceptRepository.getLatestByItemId(item.id);
    context.workflowService.approveConcept(concept!.id);
    context.workflowService.importProjects(item.id);
    const project = context.repositories.projectRepository.listByItemId(item.id)[0]!;
    await context.workflowService.startStage({ stageKey: "requirements", itemId: item.id, projectId: project.id });
    context.workflowService.approveStories(project.id);
    await context.workflowService.startStage({ stageKey: "architecture", itemId: item.id, projectId: project.id });
    context.workflowService.approveArchitecture(project.id);
    await context.workflowService.startStage({ stageKey: "planning", itemId: item.id, projectId: project.id });
    context.workflowService.approvePlanning(project.id);
    await context.workflowService.startExecution(project.id);
    await context.workflowService.tickExecution(project.id);

    return { item, project };
  }

  async function prepareProjectThroughQa(
    context: ReturnType<typeof createAppContext>,
    input: { title: string; description: string }
  ) {
    const prepared = await prepareProjectThroughCompletedExecution(context, input);
    const qa = await context.workflowService.startQa(prepared.project.id);
    return {
      ...prepared,
      qa
    };
  }

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
      await context.workflowService.startStage({
        stageKey: "planning",
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
      context.workflowService.approvePlanning(project!.id);
      context.workflowService.approvePlanning(project!.id);

      const itemState = context.repositories.itemRepository.getById(item.id);
      expect(itemState?.currentColumn).toBe("implementation");
      expect(itemState?.phaseStatus).toBe("completed");
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("imports implementation plans with waves and story dependencies", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      const item = context.repositories.itemRepository.create({
        title: "Planning Flow",
        description: "Persist implementation plans"
      });
      await context.workflowService.startStage({
        stageKey: "brainstorm",
        itemId: item.id
      });
      const concept = context.repositories.conceptRepository.getLatestByItemId(item.id);
      context.workflowService.approveConcept(concept!.id);
      context.workflowService.importProjects(item.id);
      const project = context.repositories.projectRepository.listByItemId(item.id)[0]!;

      await context.workflowService.startStage({
        stageKey: "requirements",
        itemId: item.id,
        projectId: project.id
      });
      context.workflowService.approveStories(project.id);
      await context.workflowService.startStage({
        stageKey: "architecture",
        itemId: item.id,
        projectId: project.id
      });
      context.workflowService.approveArchitecture(project.id);

      const result = await context.workflowService.startStage({
        stageKey: "planning",
        itemId: item.id,
        projectId: project.id
      });
      expect(result.status).toBe("completed");

      const implementationPlan = context.repositories.implementationPlanRepository.getLatestByProjectId(project.id);
      expect(implementationPlan?.summary).toContain("implementation plan");

      const waves = context.repositories.waveRepository.listByImplementationPlanId(implementationPlan!.id);
      expect(waves.map((wave) => wave.code)).toEqual(["W01", "W02"]);

      const firstWaveStories = context.repositories.waveStoryRepository.listByWaveId(waves[0]!.id);
      const secondWaveStories = context.repositories.waveStoryRepository.listByWaveId(waves[1]!.id);
      expect(firstWaveStories).toHaveLength(1);
      expect(secondWaveStories).toHaveLength(1);

      const dependencies = context.repositories.waveStoryDependencyRepository.listByDependentStoryId(secondWaveStories[0]!.storyId);
      expect(dependencies).toHaveLength(1);
      expect(dependencies[0]?.blockingStoryId).toBe(firstWaveStories[0]?.storyId);
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

  it("runs execution wave by wave with stored contexts and sessions", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      const item = context.repositories.itemRepository.create({
        title: "Execution Flow",
        description: "Run planned waves"
      });
      await context.workflowService.startStage({
        stageKey: "brainstorm",
        itemId: item.id
      });
      const concept = context.repositories.conceptRepository.getLatestByItemId(item.id);
      context.workflowService.approveConcept(concept!.id);
      context.workflowService.importProjects(item.id);
      const project = context.repositories.projectRepository.listByItemId(item.id)[0]!;

      await context.workflowService.startStage({
        stageKey: "requirements",
        itemId: item.id,
        projectId: project.id
      });
      context.workflowService.approveStories(project.id);
      await context.workflowService.startStage({
        stageKey: "architecture",
        itemId: item.id,
        projectId: project.id
      });
      context.workflowService.approveArchitecture(project.id);
      await context.workflowService.startStage({
        stageKey: "planning",
        itemId: item.id,
        projectId: project.id
      });
      context.workflowService.approvePlanning(project.id);

      const first = await context.workflowService.startExecution(project.id);
      expect(first.activeWaveCode).toBe("W01");
      expect(first.scheduledCount).toBe(1);
      expect(first.executions[0]?.status).toBe("completed");
      expect(first.executions[0]?.phase).toBe("story_review");

      const second = await context.workflowService.tickExecution(project.id);
      expect(second.activeWaveCode).toBe("W02");
      expect(second.scheduledCount).toBe(1);
      expect(second.executions[0]?.status).toBe("completed");
      expect(second.executions[0]?.phase).toBe("story_review");

      const shown = context.workflowService.showExecution(project.id) as {
        projectExecutionContext: { relevantDirectories: string[] } | null;
        activeWave: { code: string } | null;
        waves: Array<{
          waveExecution: { status: string } | null;
          stories: Array<{
            latestTestRun: { id: string; outputSummaryJson: string | null } | null;
            latestExecution: {
              businessContextSnapshotJson: string;
              repoContextSnapshotJson: string;
              testPreparationRunId: string;
            } | null;
            testAgentSessions: Array<{ adapterKey: string }>;
            verificationRuns: Array<{ mode: string; status: string }>;
            latestBasicVerification: { mode: string; status: string } | null;
            latestRalphVerification: { mode: string; status: string } | null;
            agentSessions: Array<{ adapterKey: string }>;
            latestStoryReviewRun: { status: string; summaryJson: string | null } | null;
            latestStoryReviewFindings: Array<{ severity: string }>;
            storyReviewAgentSessions: Array<{ adapterKey: string }>;
          }>;
        }>;
      };

      expect(shown.projectExecutionContext?.relevantDirectories).toContain("src");
      expect(shown.activeWave).toBeNull();
      expect(shown.waves.map((wave) => wave.waveExecution?.status)).toEqual(["completed", "completed"]);
      expect(shown.waves[0]?.stories[0]?.latestTestRun?.outputSummaryJson).toContain("testsGenerated");
      expect(shown.waves[0]?.stories[0]?.latestExecution?.businessContextSnapshotJson).toContain("ITEM-0001-P01-US01");
      expect(shown.waves[0]?.stories[0]?.latestExecution?.testPreparationRunId).toBe(
        shown.waves[0]?.stories[0]?.latestTestRun?.id
      );
      expect(shown.waves[1]?.stories[0]?.latestExecution?.repoContextSnapshotJson).toContain("src");
      expect(shown.waves[0]?.stories[0]?.testAgentSessions[0]?.adapterKey).toBe("local-cli");
      expect(shown.waves[0]?.stories[0]?.verificationRuns.map((run) => run.mode)).toEqual(["basic", "ralph"]);
      expect(shown.waves[0]?.stories[0]?.latestBasicVerification?.status).toBe("passed");
      expect(shown.waves[0]?.stories[0]?.latestRalphVerification?.status).toBe("passed");
      expect(shown.waves[0]?.stories[0]?.latestStoryReviewRun?.status).toBe("passed");
      expect(shown.waves[0]?.stories[0]?.latestStoryReviewRun?.summaryJson).toContain("overallStatus");
      expect(shown.waves[0]?.stories[0]?.latestStoryReviewFindings).toHaveLength(0);
      expect(shown.waves[0]?.stories[0]?.storyReviewAgentSessions[0]?.adapterKey).toBe("local-cli");
      expect(shown.waves[0]?.stories[0]?.agentSessions[0]?.adapterKey).toBe("local-cli");
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("marks execution review_required when Ralph returns review_required", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const originalScript = readFileSync("scripts/local-agent.mjs", "utf8");
    const adapterScriptPath = join(root, "local-agent-review.mjs");
    const dbPath = join(root, "app.sqlite");

    try {
      const reviewScript = replaceRequired(
        originalScript,
        "      overallStatus: status,",
        '      overallStatus: "review_required",'
      );
      writeFileSync(adapterScriptPath, reviewScript);
      const context = createAppContext(dbPath, { adapterScriptPath });

      const item = context.repositories.itemRepository.create({
        title: "Ralph Review",
        description: "Trigger Ralph review"
      });
      await context.workflowService.startStage({ stageKey: "brainstorm", itemId: item.id });
      const concept = context.repositories.conceptRepository.getLatestByItemId(item.id);
      context.workflowService.approveConcept(concept!.id);
      context.workflowService.importProjects(item.id);
      const project = context.repositories.projectRepository.listByItemId(item.id)[0]!;
      await context.workflowService.startStage({ stageKey: "requirements", itemId: item.id, projectId: project.id });
      context.workflowService.approveStories(project.id);
      await context.workflowService.startStage({ stageKey: "architecture", itemId: item.id, projectId: project.id });
      context.workflowService.approveArchitecture(project.id);
      await context.workflowService.startStage({ stageKey: "planning", itemId: item.id, projectId: project.id });
      context.workflowService.approvePlanning(project.id);

      const first = await context.workflowService.startExecution(project.id);
      expect(first.executions[0]?.status).toBe("review_required");

      const shown = context.workflowService.showExecution(project.id) as {
        waves: Array<{
          waveExecution: { status: string } | null;
          stories: Array<{
            latestRalphVerification: { status: string } | null;
            latestExecution: { status: string } | null;
            latestStoryReviewRun: { status: string } | null;
          }>;
        }>;
      };
      expect(shown.waves[0]?.waveExecution?.status).toBe("review_required");
      expect(shown.waves[0]?.stories[0]?.latestExecution?.status).toBe("review_required");
      expect(shown.waves[0]?.stories[0]?.latestRalphVerification?.status).toBe("review_required");
      expect(shown.waves[0]?.stories[0]?.latestStoryReviewRun).toBeNull();
      context.connection.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("marks execution failed when Ralph returns failed", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const originalScript = readFileSync("scripts/local-agent.mjs", "utf8");
    const adapterScriptPath = join(root, "local-agent-failed.mjs");
    const dbPath = join(root, "app.sqlite");

    try {
      const failedScript = replaceRequired(originalScript, "      overallStatus: status,", '      overallStatus: "failed",');
      writeFileSync(adapterScriptPath, failedScript);
      const context = createAppContext(dbPath, { adapterScriptPath });

      const item = context.repositories.itemRepository.create({
        title: "Ralph Failure",
        description: "Trigger Ralph failure"
      });
      await context.workflowService.startStage({ stageKey: "brainstorm", itemId: item.id });
      const concept = context.repositories.conceptRepository.getLatestByItemId(item.id);
      context.workflowService.approveConcept(concept!.id);
      context.workflowService.importProjects(item.id);
      const project = context.repositories.projectRepository.listByItemId(item.id)[0]!;
      await context.workflowService.startStage({ stageKey: "requirements", itemId: item.id, projectId: project.id });
      context.workflowService.approveStories(project.id);
      await context.workflowService.startStage({ stageKey: "architecture", itemId: item.id, projectId: project.id });
      context.workflowService.approveArchitecture(project.id);
      await context.workflowService.startStage({ stageKey: "planning", itemId: item.id, projectId: project.id });
      context.workflowService.approvePlanning(project.id);

      const first = await context.workflowService.startExecution(project.id);
      expect(first.executions[0]?.status).toBe("failed");

      const shown = context.workflowService.showExecution(project.id) as {
        waves: Array<{
          waveExecution: { status: string } | null;
          stories: Array<{
            latestRalphVerification: { status: string } | null;
            latestExecution: { status: string } | null;
            latestStoryReviewRun: { status: string } | null;
          }>;
        }>;
      };
      expect(shown.waves[0]?.waveExecution?.status).toBe("failed");
      expect(shown.waves[0]?.stories[0]?.latestExecution?.status).toBe("failed");
      expect(shown.waves[0]?.stories[0]?.latestRalphVerification?.status).toBe("failed");
      expect(shown.waves[0]?.stories[0]?.latestStoryReviewRun).toBeNull();
      context.connection.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("marks execution review_required when story review returns review_required", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const originalScript = readFileSync("scripts/local-agent.mjs", "utf8");
    const adapterScriptPath = join(root, "local-agent-story-review-required.mjs");
    const dbPath = join(root, "app.sqlite");

    try {
      const reviewScript = replaceRequired(
        originalScript,
        "function storyReview(payload) {\n  const findings = [];",
        `function storyReview(payload) {\n  const findings = [{
    severity: "medium",
    category: "performance",
    title: "Potential N+1 query path",
    description: "Repeated lookup pattern may not scale cleanly.",
    evidence: "Observed in the bounded review fixture.",
    filePath: "src/workflow/workflow-service.ts",
    line: 1,
    suggestedFix: "Batch the lookup before scaling the path."
  }];`
      );
      writeFileSync(adapterScriptPath, reviewScript);
      const context = createAppContext(dbPath, { adapterScriptPath });

      const item = context.repositories.itemRepository.create({
        title: "Story Review Required",
        description: "Trigger story review follow-up"
      });
      await context.workflowService.startStage({ stageKey: "brainstorm", itemId: item.id });
      const concept = context.repositories.conceptRepository.getLatestByItemId(item.id);
      context.workflowService.approveConcept(concept!.id);
      context.workflowService.importProjects(item.id);
      const project = context.repositories.projectRepository.listByItemId(item.id)[0]!;
      await context.workflowService.startStage({ stageKey: "requirements", itemId: item.id, projectId: project.id });
      context.workflowService.approveStories(project.id);
      await context.workflowService.startStage({ stageKey: "architecture", itemId: item.id, projectId: project.id });
      context.workflowService.approveArchitecture(project.id);
      await context.workflowService.startStage({ stageKey: "planning", itemId: item.id, projectId: project.id });
      context.workflowService.approvePlanning(project.id);

      const first = await context.workflowService.startExecution(project.id);
      expect(first.executions[0]?.status).toBe("review_required");
      expect(first.executions[0]?.phase).toBe("story_review");

      const shown = context.workflowService.showExecution(project.id) as {
        waves: Array<{
          waveExecution: { status: string } | null;
          stories: Array<{
            latestExecution: { status: string } | null;
            latestStoryReviewRun: { status: string } | null;
          }>;
        }>;
      };
      expect(shown.waves[0]?.waveExecution?.status).toBe("review_required");
      expect(shown.waves[0]?.stories[0]?.latestExecution?.status).toBe("review_required");
      expect(shown.waves[0]?.stories[0]?.latestStoryReviewRun?.status).toBe("review_required");
      context.connection.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("runs story-review remediation and records applied git metadata in a clean workspace", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const originalScript = readFileSync("scripts/local-agent.mjs", "utf8");
    const adapterScriptPath = join(root, "local-agent-story-review-remediation.mjs");
    const dbPath = join(root, "app.sqlite");
    const workspaceRoot = createGitWorkspace(root);

    try {
      const remediationScript = replaceRequired(
        originalScript,
        "function storyReview(payload) {\n  const findings = [];",
        `function storyReview(payload) {\n  const findings = payload.implementation.summary.includes("story-review-remediator") ? [] : [{
    severity: "medium",
    category: "maintainability",
    title: "Story review remediation target",
    description: "The initial execution leaves one bounded review finding behind.",
    evidence: "Injected by the remediation fixture.",
    filePath: "src/workflow/workflow-service.ts",
    line: 1,
    suggestedFix: "Run the dedicated remediation path."
  }];`
      );
      writeFileSync(adapterScriptPath, remediationScript);
      const context = createAppContext(dbPath, { adapterScriptPath, workspaceRoot });

      const item = context.repositories.itemRepository.create({
        title: "Story Review Remediation",
        description: "Exercise remediation and git metadata"
      });
      await context.workflowService.startStage({ stageKey: "brainstorm", itemId: item.id });
      const concept = context.repositories.conceptRepository.getLatestByItemId(item.id);
      context.workflowService.approveConcept(concept!.id);
      context.workflowService.importProjects(item.id);
      const project = context.repositories.projectRepository.listByItemId(item.id)[0]!;
      await context.workflowService.startStage({ stageKey: "requirements", itemId: item.id, projectId: project.id });
      context.workflowService.approveStories(project.id);
      await context.workflowService.startStage({ stageKey: "architecture", itemId: item.id, projectId: project.id });
      context.workflowService.approveArchitecture(project.id);
      await context.workflowService.startStage({ stageKey: "planning", itemId: item.id, projectId: project.id });
      context.workflowService.approvePlanning(project.id);
      await context.workflowService.startExecution(project.id);

      const shownBefore = context.workflowService.showExecution(project.id) as {
        waves: Array<{
          stories: Array<{
            story: { id: string };
            latestExecution: { gitMetadataJson: string | null };
            latestStoryReviewRun: { id: string; status: string } | null;
          }>;
        }>;
      };
      const firstStory = shownBefore.waves[0]!.stories[0]!;
      expect(firstStory.latestStoryReviewRun?.status).toBe("review_required");
      expect(firstStory.latestExecution.gitMetadataJson).toContain('"strategy": "applied"');

      const remediation = await context.workflowService.startStoryReviewRemediation(firstStory.latestStoryReviewRun!.id);
      expect(remediation.status).toBe("completed");

      const remediationShow = context.workflowService.showStoryReviewRemediation(firstStory.story.id) as {
        latestRemediationRun: { gitMetadataJson: string | null; status: string } | null;
        openFindings: Array<unknown>;
      };
      expect(remediationShow.latestRemediationRun?.status).toBe("completed");
      expect(remediationShow.latestRemediationRun?.gitMetadataJson).toContain('"branchName": "fix/');
      expect(remediationShow.openFindings).toHaveLength(0);
      expect(execFileSync("git", ["branch", "--list", "story/*"], { cwd: workspaceRoot, encoding: "utf8" })).toContain(
        "story/"
      );
      expect(execFileSync("git", ["branch", "--list", "fix/*"], { cwd: workspaceRoot, encoding: "utf8" })).toContain(
        "fix/"
      );
      context.connection.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("autoruns from concept approval through documentation completion", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      const item = context.repositories.itemRepository.create({
        title: "Autorun Happy Path",
        description: "Continue from concept approval"
      });
      await context.workflowService.startStage({ stageKey: "brainstorm", itemId: item.id });
      const concept = context.repositories.conceptRepository.getLatestByItemId(item.id);
      context.workflowService.approveConcept(concept!.id);

      const result = await context.workflowService.autorunForItem({
        itemId: item.id,
        trigger: "concept:approve",
        initialSteps: [{ action: "concept:approve", scopeType: "item", scopeId: item.id, status: "approved" }]
      });

      expect(result.finalStatus).toBe("completed");
      expect(result.stopReason).toBe("item_completed");
      expect(result.steps.map((step) => step.action)).toEqual([
        "concept:approve",
        "project:import",
        "requirements:start",
        "stories:approve",
        "architecture:start",
        "architecture:approve",
        "planning:start",
        "planning:approve",
        "execution:start",
        "execution:tick",
        "qa:start",
        "documentation:start"
      ]);

      const itemState = context.repositories.itemRepository.getById(item.id);
      expect(itemState?.currentColumn).toBe("done");
      expect(itemState?.phaseStatus).toBe("completed");
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("autorun stops when QA ends in review_required", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const originalScript = readFileSync("scripts/local-agent.mjs", "utf8");
    const adapterScriptPath = join(root, "local-agent-autorun-qa-review-required.mjs");
    const dbPath = join(root, "app.sqlite");

    try {
      const reviewScript = replaceRequired(
        originalScript,
        "  const findings = [];",
        `  const findings = [{
    severity: "medium",
    category: "functional",
    title: "Autorun QA follow-up",
    description: "The QA worker requests manual review.",
    evidence: "Injected by the autorun test fixture.",
    reproSteps: ["Open the flow", "Observe the project-level issue"],
    suggestedFix: "Address the medium issue before sign-off.",
    storyCode: payload.stories[0]?.code ?? null,
    acceptanceCriterionCode: null
  }];`
      );
      writeFileSync(adapterScriptPath, reviewScript);
      const context = createAppContext(dbPath, { adapterScriptPath });

      const item = context.repositories.itemRepository.create({
        title: "Autorun QA Stop",
        description: "Stop at QA review required"
      });
      await context.workflowService.startStage({ stageKey: "brainstorm", itemId: item.id });
      const concept = context.repositories.conceptRepository.getLatestByItemId(item.id);
      context.workflowService.approveConcept(concept!.id);

      const result = await context.workflowService.autorunForItem({
        itemId: item.id,
        trigger: "concept:approve",
        initialSteps: [{ action: "concept:approve", scopeType: "item", scopeId: item.id, status: "approved" }]
      });

      expect(result.finalStatus).toBe("stopped");
      expect(result.stopReason).toBe("qa_review_required");
      expect(result.steps.at(-1)?.action).toBe("qa:start");
      expect(context.repositories.itemRepository.getById(item.id)?.currentColumn).toBe("implementation");
      expect(context.repositories.itemRepository.getById(item.id)?.phaseStatus).toBe("review_required");

      context.connection.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("autorun triggers story-review remediation automatically", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const originalScript = readFileSync("scripts/local-agent.mjs", "utf8");
    const adapterScriptPath = join(root, "local-agent-autorun-story-review-remediation.mjs");
    const dbPath = join(root, "app.sqlite");
    const workspaceRoot = createGitWorkspace(root);

    try {
      const remediationScript = replaceRequired(
        originalScript,
        "function storyReview(payload) {\n  const findings = [];",
        `function storyReview(payload) {\n  const findings = payload.implementation.summary.includes("story-review-remediator") ? [] : [{
    severity: "medium",
    category: "maintainability",
    title: "Autorun remediation target",
    description: "The first story review requests a bounded remediation.",
    evidence: "Injected by the autorun remediation fixture.",
    filePath: "src/workflow/workflow-service.ts",
    line: 1,
    suggestedFix: "Use the remediation loop."
  }];`
      );
      writeFileSync(adapterScriptPath, remediationScript);
      const context = createAppContext(dbPath, { adapterScriptPath, workspaceRoot });

      const item = context.repositories.itemRepository.create({
        title: "Autorun Remediation",
        description: "Automatically remediate story review findings"
      });
      await context.workflowService.startStage({ stageKey: "brainstorm", itemId: item.id });
      const concept = context.repositories.conceptRepository.getLatestByItemId(item.id);
      context.workflowService.approveConcept(concept!.id);

      const result = await context.workflowService.autorunForItem({
        itemId: item.id,
        trigger: "concept:approve",
        initialSteps: [{ action: "concept:approve", scopeType: "item", scopeId: item.id, status: "approved" }]
      });

      expect(result.finalStatus).toBe("completed");
      expect(result.steps.some((step) => step.action === "remediation:story-review:start")).toBe(true);
      expect(result.createdRemediationRunIds.length).toBeGreaterThan(0);
      expect(context.repositories.itemRepository.getById(item.id)?.currentColumn).toBe("done");

      context.connection.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("marks execution failed when story review returns failed", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const originalScript = readFileSync("scripts/local-agent.mjs", "utf8");
    const adapterScriptPath = join(root, "local-agent-story-review-failed.mjs");
    const dbPath = join(root, "app.sqlite");

    try {
      const failedScript = replaceRequired(
        originalScript,
        "function storyReview(payload) {\n  const findings = [];",
        `function storyReview(payload) {\n  const findings = [{
    severity: "high",
    category: "security",
    title: "Critical story review finding",
    description: "A high-severity technical issue was injected for the test fixture.",
    evidence: "Observed in the bounded review fixture.",
    filePath: "src/workflow/workflow-service.ts",
    line: 1,
    suggestedFix: "Address the high-severity issue before completing the story."
  }];`
      );
      writeFileSync(adapterScriptPath, failedScript);
      const context = createAppContext(dbPath, { adapterScriptPath });

      const item = context.repositories.itemRepository.create({
        title: "Story Review Failure",
        description: "Trigger story review failure"
      });
      await context.workflowService.startStage({ stageKey: "brainstorm", itemId: item.id });
      const concept = context.repositories.conceptRepository.getLatestByItemId(item.id);
      context.workflowService.approveConcept(concept!.id);
      context.workflowService.importProjects(item.id);
      const project = context.repositories.projectRepository.listByItemId(item.id)[0]!;
      await context.workflowService.startStage({ stageKey: "requirements", itemId: item.id, projectId: project.id });
      context.workflowService.approveStories(project.id);
      await context.workflowService.startStage({ stageKey: "architecture", itemId: item.id, projectId: project.id });
      context.workflowService.approveArchitecture(project.id);
      await context.workflowService.startStage({ stageKey: "planning", itemId: item.id, projectId: project.id });
      context.workflowService.approvePlanning(project.id);

      const first = await context.workflowService.startExecution(project.id);
      expect(first.executions[0]?.status).toBe("failed");
      expect(first.executions[0]?.phase).toBe("story_review");

      const shown = context.workflowService.showExecution(project.id) as {
        waves: Array<{
          waveExecution: { status: string } | null;
          stories: Array<{
            latestExecution: { status: string } | null;
            latestStoryReviewRun: { status: string } | null;
          }>;
        }>;
      };
      expect(shown.waves[0]?.waveExecution?.status).toBe("failed");
      expect(shown.waves[0]?.stories[0]?.latestExecution?.status).toBe("failed");
      expect(shown.waves[0]?.stories[0]?.latestStoryReviewRun?.status).toBe("failed");
      context.connection.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("runs project QA after completed execution and stores findings and sessions", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      const { item, project } = await prepareProjectThroughCompletedExecution(context, {
        title: "QA Flow",
        description: "Run project QA"
      });

      const result = await context.workflowService.startQa(project.id);
      expect(result.status).toBe("passed");

      const shown = context.workflowService.showQa(project.id) as {
        latestQaRun: { id: string; status: string; summaryJson: string | null } | null;
        qaRuns: Array<{
          qaRun: { status: string };
          findings: Array<{ severity: string }>;
          sessions: Array<{ adapterKey: string }>;
        }>;
      };

      expect(shown.latestQaRun?.status).toBe("passed");
      expect(shown.latestQaRun?.summaryJson).toContain("overallStatus");
      expect(shown.qaRuns).toHaveLength(1);
      expect(shown.qaRuns[0]?.findings).toHaveLength(0);
      expect(shown.qaRuns[0]?.sessions[0]?.adapterKey).toBe("local-cli");
      expect(context.repositories.itemRepository.getById(item.id)?.phaseStatus).toBe("completed");
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("marks QA review_required when the QA worker returns only medium findings and supports retry", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const originalScript = readFileSync("scripts/local-agent.mjs", "utf8");
    const adapterScriptPath = join(root, "local-agent-qa-review-required.mjs");
    const dbPath = join(root, "app.sqlite");

    try {
      const reviewScript = replaceRequired(
        originalScript,
        "  const findings = [];",
        `  const findings = [{
    severity: "medium",
    category: "functional",
    title: "Cross-story flow needs follow-up",
    description: "A medium project-level QA issue was injected for the fixture.",
    evidence: "Observed in the bounded QA fixture.",
    reproSteps: ["Open the assembled flow", "Repeat the relevant transition"],
    suggestedFix: "Tighten the flow before sign-off.",
    storyCode: payload.stories[0]?.code ?? null,
    acceptanceCriterionCode: null
  }];`
      );
      writeFileSync(adapterScriptPath, reviewScript);
      const context = createAppContext(dbPath, { adapterScriptPath });
      const { item, project } = await prepareProjectThroughCompletedExecution(context, {
        title: "QA Review Required",
        description: "Trigger QA follow-up"
      });

      const first = await context.workflowService.startQa(project.id);
      expect(first.status).toBe("review_required");

      const firstShown = context.workflowService.showQa(project.id) as {
        latestQaRun: { id: string; status: string } | null;
        qaRuns: Array<{ findings: Array<{ severity: string }> }>;
      };
      expect(firstShown.latestQaRun?.status).toBe("review_required");
      expect(firstShown.qaRuns[0]?.findings[0]?.severity).toBe("medium");
      expect(context.repositories.itemRepository.getById(item.id)?.phaseStatus).toBe("review_required");

      writeFileSync(adapterScriptPath, originalScript);
      const retried = await context.workflowService.retryQa(first.qaRunId);
      expect(retried.retriedFromQaRunId).toBe(first.qaRunId);
      expect(retried.status).toBe("passed");
      expect(context.repositories.qaRunRepository.listByProjectId(project.id)).toHaveLength(2);
      expect(context.repositories.itemRepository.getById(item.id)?.phaseStatus).toBe("completed");

      context.connection.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks QA start until execution is fully completed", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      const item = context.repositories.itemRepository.create({
        title: "QA Blocked",
        description: "Execution must finish first"
      });
      await context.workflowService.startStage({ stageKey: "brainstorm", itemId: item.id });
      const concept = context.repositories.conceptRepository.getLatestByItemId(item.id);
      context.workflowService.approveConcept(concept!.id);
      context.workflowService.importProjects(item.id);
      const project = context.repositories.projectRepository.listByItemId(item.id)[0]!;
      await context.workflowService.startStage({ stageKey: "requirements", itemId: item.id, projectId: project.id });
      context.workflowService.approveStories(project.id);
      await context.workflowService.startStage({ stageKey: "architecture", itemId: item.id, projectId: project.id });
      context.workflowService.approveArchitecture(project.id);
      await context.workflowService.startStage({ stageKey: "planning", itemId: item.id, projectId: project.id });
      context.workflowService.approvePlanning(project.id);

      await expect(context.workflowService.startQa(project.id)).rejects.toMatchObject({
        code: "QA_EXECUTION_INCOMPLETE"
      });
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("runs project documentation after QA and stores artifacts and sessions", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      const { item, project } = await prepareProjectThroughQa(context, {
        title: "Documentation Flow",
        description: "Run project documentation"
      });

      const result = await context.workflowService.startDocumentation(project.id);
      expect(result.status).toBe("completed");

      const shown = context.workflowService.showDocumentation(project.id) as {
        latestDocumentationRun: { id: string; status: string; summaryJson: string | null } | null;
        documentationRuns: Array<{
          documentationRun: { status: string };
          artifacts: Array<{ kind: string }>;
          sessions: Array<{ adapterKey: string }>;
        }>;
      };

      expect(shown.latestDocumentationRun?.status).toBe("completed");
      expect(shown.latestDocumentationRun?.summaryJson).toContain("artifactIds");
      expect(shown.documentationRuns).toHaveLength(1);
      expect(shown.documentationRuns[0]?.artifacts.map((artifact) => artifact.kind)).toEqual([
        "delivery-report",
        "delivery-report-data"
      ]);
      expect(shown.documentationRuns[0]?.sessions[0]?.adapterKey).toBe("local-cli");
      expect(context.repositories.itemRepository.getById(item.id)?.currentColumn).toBe("done");
      expect(context.repositories.itemRepository.getById(item.id)?.phaseStatus).toBe("completed");
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("marks documentation review_required when QA is review_required and supports retry", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const originalScript = readFileSync("scripts/local-agent.mjs", "utf8");
    const adapterScriptPath = join(root, "local-agent-documentation-review-required.mjs");
    const dbPath = join(root, "app.sqlite");

    try {
      const reviewScript = replaceRequired(
        originalScript,
        "  const findings = [];",
        `  const findings = [{
    severity: "medium",
    category: "functional",
    title: "Documentation follow-up fixture",
    description: "A medium QA finding was injected for the documentation flow.",
    evidence: "Observed in the QA fixture.",
    reproSteps: ["Open the flow", "Inspect the remaining project-level issue"],
    suggestedFix: "Address the medium QA issue before final sign-off.",
    storyCode: payload.stories[0]?.code ?? null,
    acceptanceCriterionCode: null
  }];`
      );
      writeFileSync(adapterScriptPath, reviewScript);
      const context = createAppContext(dbPath, { adapterScriptPath });
      const { item, project } = await prepareProjectThroughCompletedExecution(context, {
        title: "Documentation Review Required",
        description: "Trigger documentation follow-up"
      });

      const qa = await context.workflowService.startQa(project.id);
      expect(qa.status).toBe("review_required");

      const firstDocumentation = await context.workflowService.startDocumentation(project.id);
      expect(firstDocumentation.status).toBe("review_required");
      expect(context.repositories.itemRepository.getById(item.id)?.phaseStatus).toBe("review_required");

      writeFileSync(adapterScriptPath, originalScript);
      const retriedQa = await context.workflowService.retryQa(qa.qaRunId);
      expect(retriedQa.status).toBe("passed");

      const retriedDocumentation = await context.workflowService.retryDocumentation(firstDocumentation.documentationRunId);
      expect(retriedDocumentation.retriedFromDocumentationRunId).toBe(firstDocumentation.documentationRunId);
      expect(retriedDocumentation.status).toBe("completed");
      expect(context.repositories.documentationRunRepository.listByProjectId(project.id)).toHaveLength(2);
      expect(context.repositories.itemRepository.getById(item.id)?.phaseStatus).toBe("completed");

      context.connection.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks documentation start until QA has completed", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      const { project } = await prepareProjectThroughCompletedExecution(context, {
        title: "Documentation Blocked",
        description: "QA must finish first"
      });

      await expect(context.workflowService.startDocumentation(project.id)).rejects.toMatchObject({
        code: "DOCUMENTATION_QA_INCOMPLETE"
      });
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
