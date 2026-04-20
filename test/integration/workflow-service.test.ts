import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { createAppContext } from "../../src/app-context.js";
import type { AppError } from "../../src/shared/errors.js";
import type {
  PlanningReviewAutomationLevel,
  PlanningReviewGateEligibility,
  PlanningReviewReadinessResult,
  PlanningReviewSourceType,
  PlanningReviewStatus,
  ReviewKind,
  ReviewRunStatus
} from "../../src/domain/types.js";

const localAgentScriptPath = fileURLToPath(new URL("../../scripts/local-agent.mjs", import.meta.url));
const asRunnableConnection = (connection: unknown) => connection as {
  prepare(sql: string): { run(...args: unknown[]): unknown };
};

describe("workflow service", () => {
  function replaceRequired(source: string, searchValue: string, replaceValue: string): string {
    const patched = source.replace(searchValue, replaceValue);
    expect(patched).not.toBe(source);
    return patched;
  }

  function createGitWorkspace(root: string): string {
    const workspaceRoot = join(root, "workspace");
    mkdirSync(workspaceRoot, { recursive: true });
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
    const item = createWorkspaceItem(context, input);
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

  function createWorkspaceItem(
    context: ReturnType<typeof createAppContext>,
    input: { title: string; description: string }
  ) {
    return context.repositories.itemRepository.create({
      workspaceId: context.workspace.id,
      title: input.title,
      description: input.description
    });
  }

  function seedPlanningReviewRun(
    context: ReturnType<typeof createAppContext>,
    input: {
      sourceType: PlanningReviewSourceType;
      sourceId: string;
      step: "requirements_engineering" | "architecture" | "plan_writing";
      status: PlanningReviewStatus;
      readiness: PlanningReviewReadinessResult;
      automationLevel?: PlanningReviewAutomationLevel;
      gateEligibility?: PlanningReviewGateEligibility;
    }
  ) {
    const mappedStatus: ReviewRunStatus =
      input.status === "ready"
        ? "complete"
        : input.status === "blocked"
          ? "blocked"
          : input.status === "failed"
            ? "failed"
            : "action_required";
    return seedGenericReviewRun(context, {
      reviewKind: "planning",
      subjectType: input.sourceType,
      subjectId: input.sourceId,
      subjectStep: input.step,
      status: mappedStatus,
      readiness: input.readiness,
      automationLevel: input.automationLevel ?? "auto_gate",
      gateEligibility: input.gateEligibility ?? "advisory",
      summary: "seeded planning review"
    });
  }

  function seedGenericReviewRun(
    context: ReturnType<typeof createAppContext>,
    input: {
      reviewKind: ReviewKind;
      subjectType: string;
      subjectId: string;
      subjectStep?: string;
      status: ReviewRunStatus;
      readiness: string;
      automationLevel?: PlanningReviewAutomationLevel;
      gateEligibility?: PlanningReviewGateEligibility;
      summary?: string;
    }
  ) {
    const run = context.repositories.reviewRunRepository.create({
      reviewKind: input.reviewKind,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      subjectStep: input.subjectStep ?? null,
      status: input.status,
      readiness: input.readiness,
      interactionMode: "auto",
      reviewMode: "readiness",
      automationLevel: input.automationLevel ?? "auto_gate",
      requestedMode: "minimal_review",
      actualMode: "minimal_review",
      confidence: "medium",
      gateEligibility: input.gateEligibility ?? "advisory",
      sourceSummaryJson: JSON.stringify({ seeded: true }),
      providersUsedJson: JSON.stringify(["seeded"]),
      missingCapabilitiesJson: JSON.stringify([]),
      reviewSummary: input.summary ?? "seeded generic review",
      failedReason: null
    });
    context.repositories.reviewSynthesisRepository.create({
      runId: run.id,
      summary: input.summary ?? "seeded generic review",
      status: input.status,
      readiness: input.readiness,
      keyPointsJson: JSON.stringify([]),
      disagreementsJson: JSON.stringify([]),
      recommendedAction: "seeded action",
      gateDecision: input.status === "complete" ? "pass" : "blocked"
    });
    return run;
  }

  function seedInteractiveStoryCoreReview(
    context: ReturnType<typeof createAppContext>,
    input: {
      waveStoryExecutionId: string;
      projectId: string;
      waveId: string;
      storyId: string;
      storyCode: string;
      status: ReviewRunStatus;
      readiness: string;
      findings: Array<{
        severity: "critical" | "high" | "medium" | "low";
        category: string;
        title: string;
        description: string;
        evidence: string;
        filePath: string | null;
        line: number | null;
      }>;
    }
  ) {
    const run = context.repositories.reviewRunRepository.create({
      reviewKind: "interactive_story",
      subjectType: "wave_story_execution",
      subjectId: input.waveStoryExecutionId,
      subjectStep: "story_review",
      status: input.status,
      readiness: input.readiness,
      interactionMode: "auto",
      reviewMode: "readiness",
      automationLevel: "auto_comment",
      requestedMode: null,
      actualMode: null,
      confidence: "medium",
      gateEligibility: "advisory_only",
      sourceSummaryJson: JSON.stringify({
        storyCode: input.storyCode,
        storyId: input.storyId,
        projectId: input.projectId,
        waveId: input.waveId
      }),
      providersUsedJson: JSON.stringify(["story-reviewer"]),
      missingCapabilitiesJson: JSON.stringify([]),
      reviewSummary: "seeded interactive story core review",
      failedReason: null
    });
    context.repositories.reviewFindingRepository.createMany(
      input.findings.map((finding) => ({
        runId: run.id,
        sourceSystem: "story_review",
        reviewerRole: "story-reviewer",
        findingType: finding.category,
        normalizedSeverity: finding.severity,
        sourceSeverity: finding.severity,
        title: finding.title,
        detail: finding.description,
        evidence: finding.evidence,
        status: "open",
        fingerprint: `seeded::${finding.category}::${finding.title.toLowerCase()}::${finding.description.toLowerCase()}`,
        filePath: finding.filePath,
        line: finding.line,
        fieldPath: null
      }))
    );
    context.repositories.reviewSynthesisRepository.create({
      runId: run.id,
      summary: "seeded interactive story core review",
      status: input.status,
      readiness: input.readiness,
      keyPointsJson: JSON.stringify(input.findings.map((finding) => finding.title)),
      disagreementsJson: JSON.stringify([]),
      recommendedAction: "seeded action",
      gateDecision: input.status === "complete" ? "pass" : "advisory"
    });
    return run;
  }

  function setExecutionDefaults(
    context: ReturnType<typeof createAppContext>,
    input: {
      implementationReview: {
        interactionMode: "auto" | "assisted" | "interactive";
      };
    }
  ) {
    const serialized = JSON.stringify(input);
    context.repositories.workspaceSettingsRepository.update(context.workspace.id, {
      executionDefaultsJson: serialized
    });
    context.workspaceSettings.executionDefaultsJson = serialized;
  }

  it("starts a brainstorm run and stores prompt snapshots", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      const item = createWorkspaceItem(context, {
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

  it("snapshots the adapter context payload on requirements runs", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      const item = createWorkspaceItem(context, {
        title: "Requirements Snapshot",
        description: "Verify adapter input is captured"
      });

      const started = context.workflowService.startBrainstormSession(item.id);
      await context.workflowService.chatBrainstorm(
        started.sessionId,
        [
          "problem: Teams lack visibility into review state",
          "users: support operator; delivery lead",
          "use cases: inspect active review sessions; spot blocked approvals",
          "constraints: must run offline",
          "candidate directions: review inbox dashboard",
          "recommended direction: review inbox dashboard"
        ].join("\n")
      );
      await context.workflowService.promoteBrainstorm(started.sessionId);
      const concept = context.repositories.conceptRepository.getLatestByItemId(item.id);
      context.workflowService.approveConcept(concept!.id);
      context.workflowService.importProjects(item.id);
      const project = context.repositories.projectRepository.listByItemId(item.id)[0]!;

      const result = await context.workflowService.startStage({
        stageKey: "requirements",
        itemId: item.id,
        projectId: project.id
      });

      const run = context.repositories.stageRunRepository.getById(result.runId);
      expect(run?.inputSnapshotJson).toBeTruthy();
      const snapshot = JSON.parse(run!.inputSnapshotJson) as {
        item: { id: string };
        project: { id: string } | null;
        context: {
          stageKey: string;
          upstreamSource: { targetUsers: string[]; useCases: string[]; constraints: string[] } | null;
          stories: unknown[];
        } | null;
      };
      expect(snapshot.item.id).toBe(item.id);
      expect(snapshot.project?.id).toBe(project.id);
      expect(snapshot.context?.stageKey).toBe("requirements");
      expect(snapshot.context?.stories).toEqual([]);
      expect(snapshot.context?.upstreamSource?.targetUsers).toContain("support operator");
      expect(snapshot.context?.upstreamSource?.useCases.length).toBeGreaterThanOrEqual(2);
      expect(snapshot.context?.upstreamSource?.constraints).toContain("must run offline");
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("shows project detail including stories and latest plans", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      const item = createWorkspaceItem(context, {
        title: "Project Show",
        description: "Inspect one imported project"
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

      const shown = context.workflowService.showProject(project.id) as {
        item: { id: string };
        project: { id: string };
        deliveryStatus: string;
        stories: Array<{ acceptanceCriteria: Array<{ text: string }> }>;
        latestArchitecturePlan: { projectId: string } | null;
        latestImplementationPlan: { projectId: string } | null;
        stageRuns: Array<{ stageKey: string }>;
      };

      expect(shown.item.id).toBe(item.id);
      expect(shown.project.id).toBe(project.id);
      expect(shown.deliveryStatus).toBe("pending");
      expect(shown.stories.length).toBeGreaterThan(0);
      expect(shown.stories[0]?.acceptanceCriteria.length).toBeGreaterThan(0);
      expect(shown.latestArchitecturePlan?.projectId).toBe(project.id);
      expect(shown.latestImplementationPlan?.projectId).toBe(project.id);
      expect(shown.stageRuns.some((run) => run.stageKey === "requirements")).toBe(true);
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes planning reviews into the generic review core", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      const item = createWorkspaceItem(context, {
        title: "Planning Core Review",
        description: "Write planning reviews into generic review runs"
      });
      const startedSession = context.workflowService.startBrainstormSession(item.id);
      const review = await context.workflowService.startPlanningReview({
        sourceType: "brainstorm_session",
        sourceId: startedSession.sessionId,
        step: "requirements_engineering",
        reviewMode: "readiness",
        interactionMode: "interactive"
      });

      const coreRun = context.repositories.reviewRunRepository.getLatestBySubject({
        reviewKind: "planning",
        subjectType: "brainstorm_session",
        subjectId: startedSession.sessionId
      });

      expect(review.run.id).toBeTruthy();
      expect(coreRun?.subjectType).toBe("brainstorm_session");
      expect(coreRun?.reviewKind).toBe("planning");
      expect(coreRun?.status).toMatch(/action_required|complete/);
      expect(context.repositories.reviewFindingRepository.listByRunId(coreRun!.id).length).toBeGreaterThanOrEqual(0);
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates advisory implementation reviews from story review and coderabbit signals", { timeout: 10000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      const { project } = await prepareProjectThroughCompletedExecution(context, {
        title: "Implementation Review",
        description: "Aggregate quality signals into a generic implementation review"
      });
      const implementationPlan = context.repositories.implementationPlanRepository.getLatestByProjectId(project.id)!;
      const firstWave = context.repositories.waveRepository.listByImplementationPlanId(implementationPlan.id)[0]!;
      const firstStory = context.repositories.userStoryRepository.listByProjectId(project.id)[0]!;
      const firstWaveStory = context.repositories.waveStoryRepository.getByStoryId(firstStory.id)!;
      const latestExecution = context.repositories.waveStoryExecutionRepository.getLatestByWaveStoryId(firstWaveStory.id)!;

      seedInteractiveStoryCoreReview(context, {
        waveStoryExecutionId: latestExecution.id,
        projectId: project.id,
        waveId: firstWave.id,
        storyId: firstStory.id,
        storyCode: firstStory.code,
        status: "action_required",
        readiness: "review_required",
        findings: [
          {
            severity: "high",
            category: "maintainability",
            title: "Protect implementation review orchestration",
            description: "The implementation review path needs regression coverage.",
            evidence: "Missing review-core integration assertion",
            filePath: "src/workflow/implementation-review-service.ts",
            line: 1
          }
        ]
      });
      context.repositories.qualityKnowledgeEntryRepository.createMany([
        {
          workspaceId: context.workspace.id,
          projectId: project.id,
          waveId: firstWave.id,
          storyId: firstStory.id,
          source: "coderabbit",
          scopeType: "file",
          scopeId: "src/workflow/implementation-review-service.ts",
          kind: "recurring_issue",
          summary: "Keep implementation review providers degradable",
          evidenceJson: JSON.stringify({ detail: "CodeRabbit flagged coupling between quality providers." }),
          status: "open",
          relevanceTagsJson: JSON.stringify({
            files: ["src/workflow/implementation-review-service.ts"],
            storyCodes: [firstStory.code],
            modules: ["src/workflow"],
            categories: ["maintainability"]
          })
        }
      ]);
      context.services.coderabbitService.setConfig({
        hostUrl: "https://api.coderabbit.ai",
        organization: "beerengineer",
        repository: "beerengineer",
        token: "secret-token"
      });

      const review = (await context.workflowService.startImplementationReview({
        waveStoryExecutionId: latestExecution.id,
        automationLevel: "manual"
      })) as {
        run: { id: string; status: string; reviewKind: string };
        findings: Array<{ sourceSystem: string; title: string }>;
        synthesis: { gateDecision: string } | null;
      };

      expect(review.run.reviewKind).toBe("implementation");
      expect(review.run.status).toBe("action_required");
      expect(review.findings.map((finding) => finding.sourceSystem)).toEqual(
        expect.arrayContaining(["story_review", "coderabbit"])
      );
      expect(review.synthesis?.gateDecision).toBe("needs_human_review");
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("automatically triggers implementation review after completed story review", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      const { project } = await prepareProjectThroughCompletedExecution(context, {
        title: "Implementation Review Trigger",
        description: "Create implementation review automatically after story review"
      });
      const implementationPlan = context.repositories.implementationPlanRepository.getLatestByProjectId(project.id)!;
      const firstWave = context.repositories.waveRepository.listByImplementationPlanId(implementationPlan.id)[0]!;
      const firstStory = context.repositories.userStoryRepository.listByProjectId(project.id)[0]!;
      const firstWaveStory = context.repositories.waveStoryRepository.getByStoryId(firstStory.id)!;
      const latestExecution = context.repositories.waveStoryExecutionRepository.getLatestByWaveStoryId(firstWaveStory.id)!;

      const latestImplementationReview = context.repositories.reviewRunRepository.getLatestBySubject({
        reviewKind: "implementation",
        subjectType: "wave_story_execution",
        subjectId: latestExecution.id
      });

      expect(firstWave.id).toBeTruthy();
      expect(latestImplementationReview?.reviewKind).toBe("implementation");
      expect(latestImplementationReview?.automationLevel).toBe("auto_comment");
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks qa start when an auto-gate implementation review is not ready", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      const { project } = await prepareProjectThroughCompletedExecution(context, {
        title: "Implementation Review Gate",
        description: "Block qa when implementation review auto-gate is not ready"
      });
      const implementationPlan = context.repositories.implementationPlanRepository.getLatestByProjectId(project.id)!;
      const firstStory = context.repositories.userStoryRepository.listByProjectId(project.id)[0]!;
      const firstWaveStory = context.repositories.waveStoryRepository.getByStoryId(firstStory.id)!;
      const latestExecution = context.repositories.waveStoryExecutionRepository.getLatestByWaveStoryId(firstWaveStory.id)!;

      seedGenericReviewRun(context, {
        reviewKind: "implementation",
        subjectType: "wave_story_execution",
        subjectId: latestExecution.id,
        subjectStep: "implementation",
        status: "action_required",
        readiness: "review_required",
        automationLevel: "auto_gate",
        gateEligibility: "advisory",
        summary: "seeded blocking implementation review"
      });

      await expect(context.workflowService.startQa(project.id)).rejects.toMatchObject({
        code: "IMPLEMENTATION_REVIEW_GATE_BLOCKED"
      });
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks story approval from a generic planning review gate", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      const item = createWorkspaceItem(context, {
        title: "Generic Planning Gate",
        description: "Story approval should respect generic planning review gates"
      });
      await context.workflowService.startStage({ stageKey: "brainstorm", itemId: item.id });
      const concept = context.repositories.conceptRepository.getLatestByItemId(item.id)!;
      context.workflowService.approveConcept(concept.id);
      context.workflowService.importProjects(item.id);
      const project = context.repositories.projectRepository.listByItemId(item.id)[0]!;
      const interactiveReview = context.repositories.interactiveReviewSessionRepository.create({
        scopeType: "project",
        scopeId: project.id,
        artifactType: "stories",
        reviewType: "collection_review",
        status: "resolved"
      });

      seedGenericReviewRun(context, {
        reviewKind: "planning",
        subjectType: "interactive_review_session",
        subjectId: interactiveReview.id,
        subjectStep: "requirements_engineering",
        status: "action_required",
        readiness: "needs_evidence",
        automationLevel: "auto_gate",
        gateEligibility: "advisory",
        summary: "seeded generic planning blocker"
      });

      await context.workflowService.startStage({ stageKey: "requirements", itemId: item.id, projectId: project.id });
      await expect(() => context.workflowService.approveStories(project.id)).toThrowError(
        expect.objectContaining({ code: "PLANNING_REVIEW_GATE_BLOCKED" } satisfies Partial<AppError>)
      );
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes qa runs into the generic review core", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      const { project, qa } = await prepareProjectThroughQa(context, {
        title: "QA Core Review",
        description: "Write QA runs into the generic review core"
      });

      const coreRun = context.repositories.reviewRunRepository.getLatestBySubject({
        reviewKind: "qa",
        subjectType: "project",
        subjectId: project.id
      });

      expect(qa.status).toBeTruthy();
      expect(coreRun?.reviewKind).toBe("qa");
      expect(coreRun?.subjectType).toBe("project");
      expect(context.repositories.reviewSynthesisRepository.getLatestByRunId(coreRun!.id)?.gateDecision).toBeTruthy();
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("shows item delivery summaries and materializes documentation into the workspace export folder", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const workspaceRoot = join(root, "workspace");
    mkdirSync(workspaceRoot, { recursive: true });
    const context = createAppContext(dbPath, { workspaceRoot });

    try {
      const { item, project } = await prepareProjectThroughCompletedExecution(context, {
        title: "Workspace Documentation",
        description: "Materialize delivery documentation in the project workspace"
      });

      const qa = await context.workflowService.startQa(project.id);
      expect(qa.status).toBe("passed");
      const documentation = await context.workflowService.startDocumentation(project.id);
      expect(documentation.status).toBe("completed");

      const itemState = context.workflowService.showItem(item.id) as {
        projectSummaries: Array<{
          project: { id: string };
          deliveryStatus: string;
          latestQaStatus: string | null;
          latestDocumentationStatus: string | null;
        }>;
        deliverySummary: { totalProjects: number; completedProjects: number; pendingProjects: number };
      };
      expect(itemState.deliverySummary).toMatchObject({
        totalProjects: 1,
        completedProjects: 1,
        pendingProjects: 0
      });
      expect(itemState.projectSummaries[0]).toMatchObject({
        project: { id: project.id },
        deliveryStatus: "completed",
        latestQaStatus: "passed",
        latestDocumentationStatus: "completed"
      });

      const markdownPath = join(
        workspaceRoot,
        "docs",
        "delivery-reports",
        "default",
        `${project.code}-delivery-report.md`
      );
      const jsonPath = join(
        workspaceRoot,
        "docs",
        "delivery-reports",
        "default",
        `${project.code}-delivery-report.json`
      );
      expect(existsSync(markdownPath)).toBe(true);
      expect(existsSync(jsonPath)).toBe(true);
      expect(readFileSync(markdownPath, "utf8")).toContain(`${project.code} Delivery Report`);
      expect(JSON.parse(readFileSync(jsonPath, "utf8"))).toMatchObject({
        projectCode: project.code,
        overallStatus: "completed"
      });

      const shownDocumentation = context.workflowService.showDocumentation(project.id) as {
        latestDocumentationRun: { summaryJson: string | null } | null;
      };
      expect(shownDocumentation.latestDocumentationRun?.summaryJson).toContain("exportedArtifacts");
      expect(shownDocumentation.latestDocumentationRun?.summaryJson).toContain(`${project.code}-delivery-report.md`);
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("materializes documentation into the latest execution workspace without requiring a fresh workspace override", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const executionWorkspaceRoot = createGitWorkspace(root);
    const setupContext = createAppContext(dbPath, { workspaceRoot: executionWorkspaceRoot });

    try {
      const { project } = await prepareProjectThroughCompletedExecution(setupContext, {
        title: "Workspace Resolution",
        description: "Reuse the execution workspace when documentation is rerun later"
      });
      const qa = await setupContext.workflowService.startQa(project.id);
      expect(qa.status).toBe("passed");

      setupContext.connection.close();

      const documentationContext = createAppContext(dbPath);
      try {
        const documentation = await documentationContext.workflowService.startDocumentation(project.id);
        expect(documentation.status).toBe("completed");

        const markdownPath = join(
          executionWorkspaceRoot,
          "docs",
          "delivery-reports",
          "default",
          `${project.code}-delivery-report.md`
        );
        const jsonPath = join(
          executionWorkspaceRoot,
          "docs",
          "delivery-reports",
          "default",
          `${project.code}-delivery-report.json`
        );
        expect(existsSync(markdownPath)).toBe(true);
        expect(existsSync(jsonPath)).toBe(true);
      } finally {
        documentationContext.connection.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("prefers the dominant execution workspace when a project has mixed execution roots", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const executionWorkspaceRoot = createGitWorkspace(root);
    const setupContext = createAppContext(dbPath, { workspaceRoot: executionWorkspaceRoot });

    try {
      const { project } = await prepareProjectThroughCompletedExecution(setupContext, {
        title: "Workspace Majority",
        description: "Prefer the project workspace that most executions used"
      });
      const qa = await setupContext.workflowService.startQa(project.id);
      expect(qa.status).toBe("passed");

      const implementationPlan = setupContext.repositories.implementationPlanRepository.getLatestByProjectId(project.id)!;
      const waves = setupContext.repositories.waveRepository.listByImplementationPlanId(implementationPlan.id);
      const waveStories = waves.flatMap((wave) => setupContext.repositories.waveStoryRepository.listByWaveId(wave.id));
      const latestExecutions = waveStories
        .map((waveStory) => setupContext.repositories.waveStoryExecutionRepository.getLatestByWaveStoryId(waveStory.id))
        .filter((execution): execution is NonNullable<typeof execution> => execution !== null);
      expect(latestExecutions.length).toBeGreaterThanOrEqual(2);

      const mixedExecution = latestExecutions.at(-1)!;
      const gitMetadata = JSON.parse(mixedExecution.gitMetadataJson ?? "{}") as {
        branchRole?: "project" | "story" | "story-remediation";
        baseRef?: string;
        branchName?: string;
        workspaceRoot?: string;
        worktreePath?: string | null;
        headBefore?: string | null;
        headAfter?: string | null;
        commitSha?: string | null;
        mergedIntoRef?: string | null;
        mergedCommitSha?: string | null;
        strategy?: "applied" | "simulated";
        reason?: string | null;
      };
      setupContext.repositories.waveStoryExecutionRepository.updateStatus(mixedExecution.id, mixedExecution.status, {
        outputSummaryJson: mixedExecution.outputSummaryJson,
        errorMessage: mixedExecution.errorMessage,
        gitMetadata: {
          branchRole: gitMetadata.branchRole ?? "story",
          baseRef: gitMetadata.baseRef ?? "proj/test",
          branchName: gitMetadata.branchName ?? "story/test",
          workspaceRoot: resolve("."),
          worktreePath: gitMetadata.worktreePath ?? null,
          headBefore: gitMetadata.headBefore ?? null,
          headAfter: gitMetadata.headAfter ?? null,
          commitSha: gitMetadata.commitSha ?? null,
          mergedIntoRef: gitMetadata.mergedIntoRef ?? null,
          mergedCommitSha: gitMetadata.mergedCommitSha ?? null,
          strategy: gitMetadata.strategy ?? "simulated",
          reason: gitMetadata.reason ?? null
        }
      });

      setupContext.connection.close();

      const documentationContext = createAppContext(dbPath);
      try {
        const documentation = await documentationContext.workflowService.startDocumentation(project.id);
        expect(documentation.status).toBe("completed");

        const markdownPath = join(
          executionWorkspaceRoot,
          "docs",
          "delivery-reports",
          "default",
          `${project.code}-delivery-report.md`
        );
        expect(existsSync(markdownPath)).toBe(true);
      } finally {
        documentationContext.connection.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("falls back to the configured workspace root when execution metadata is missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const executionWorkspaceRoot = createGitWorkspace(root);
    const setupContext = createAppContext(dbPath, { workspaceRoot: executionWorkspaceRoot });

    try {
      const { project } = await prepareProjectThroughCompletedExecution(setupContext, {
        title: "Workspace Metadata Fallback",
        description: "Use configured workspace root when no execution metadata is available"
      });
      const qa = await setupContext.workflowService.startQa(project.id);
      expect(qa.status).toBe("passed");

      asRunnableConnection(setupContext.connection)
        .prepare("UPDATE wave_story_executions SET git_metadata_json = NULL")
        .run();
      setupContext.connection.close();

      const documentationContext = createAppContext(dbPath, { workspaceRoot: executionWorkspaceRoot });
      try {
        const documentation = await documentationContext.workflowService.startDocumentation(project.id);
        expect(documentation.status).toBe("completed");

        const markdownPath = join(
          executionWorkspaceRoot,
          "docs",
          "delivery-reports",
          "default",
          `${project.code}-delivery-report.md`
        );
        expect(existsSync(markdownPath)).toBe(true);
      } finally {
        documentationContext.connection.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("merges the project branch into main after completed documentation", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const workspaceRoot = createGitWorkspace(root);
    const context = createAppContext(dbPath, { workspaceRoot });

    try {
      const { project } = await prepareProjectThroughCompletedExecution(context, {
        title: "Project Branch Finalization",
        description: "Finalize the project branch after delivery completion"
      });
      const qa = await context.workflowService.startQa(project.id);
      expect(qa.status).toBe("passed");

      const documentation = await context.workflowService.startDocumentation(project.id) as {
        status: string;
        projectFinalization: { status: string; message: string };
      };
      expect(documentation.status).toBe("completed");
      expect(documentation.projectFinalization.status).toBe("merged");

      expect(execFileSync("git", ["branch", "--list", "proj/*"], { cwd: workspaceRoot, encoding: "utf8" }).trim()).toBe("");
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("supports interactive brainstorm sessions, draft updates, and promotion", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      const item = createWorkspaceItem(context, {
        title: "Interactive Brainstorm",
        description: "Clarify the concept collaboratively"
      });

      const started = context.workflowService.startBrainstormSession(item.id);
      expect(started.reused).toBe(false);

      const shown = context.workflowService.showBrainstormBySessionId(started.sessionId) as {
        session: { status: string; mode: string };
        draft: { revision: number; problem: string | null; openQuestions: string[] };
        messages: Array<{ role: string }>;
      };
      expect(shown.session.status).toBe("waiting_for_user");
      expect(shown.session.mode).toBe("explore");
      expect(shown.draft.revision).toBe(1);
      expect(shown.messages.map((message) => message.role).sort()).toEqual(["assistant", "system"]);

      const chatted = await context.workflowService.chatBrainstorm(
        started.sessionId,
        [
          "problem: Teams cannot see review state across workflow runs",
          "users: support operator; delivery lead",
          "use cases: inspect active review sessions; spot blocked approvals",
          "candidate directions: review inbox dashboard; timeline view",
          "recommended direction: review inbox dashboard"
        ].join("\n")
      ) as {
        mode: string;
        draft: { revision: number; problem: string | null; targetUsers: string[]; useCases: string[]; candidateDirections: string[] };
      };
      expect(chatted.draft.revision).toBe(2);
      expect(chatted.mode).toBe("converge");
      expect(chatted.draft.problem).toContain("review state");
      expect(chatted.draft.targetUsers).toEqual(["support operator", "delivery lead"]);
      expect(chatted.draft.useCases.length).toBe(2);
      expect(chatted.draft.candidateDirections).toEqual(["review inbox dashboard", "timeline view"]);

      const updated = context.workflowService.updateBrainstormDraft({
        sessionId: started.sessionId,
        coreOutcome: "Give delivery teams one shared review control surface",
        useCases: ["inspect active review sessions", "spot blocked approvals", "resume stalled reviews"],
        openQuestions: [],
        assumptions: ["Existing workflow records already contain enough metadata for a first MVP"]
      }) as {
        status: string;
        mode: string;
        draft: { revision: number; coreOutcome: string | null; useCases: string[]; openQuestions: string[] };
      };
      expect(updated.status).toBe("ready_for_concept");
      expect(updated.mode).toBe("converge");
      expect(updated.draft.revision).toBe(3);
      expect(updated.draft.coreOutcome).toContain("shared review control surface");
      expect(updated.draft.useCases).toContain("resume stalled reviews");
      expect(updated.draft.openQuestions).toEqual([]);

      const promoted = await context.workflowService.promoteBrainstorm(started.sessionId);
      expect(promoted.status).toBe("promoted");
      expect(context.repositories.conceptRepository.getLatestByItemId(item.id)?.id).toBe(promoted.conceptId);
      const projectsArtifact = context.repositories.artifactRepository.getLatestByKind({ itemId: item.id, kind: "projects" });
      expect(projectsArtifact?.id).toBeTruthy();
      const projectsPayload = JSON.parse(
        readFileSync(
          join(context.effectiveConfig.workspaceRoot, ".beerengineer", "workspaces", context.workspace.key, "artifacts", projectsArtifact!.path),
          "utf8"
        )
      ) as {
        projects: Array<{ title: string; goal: string }>;
      };
      expect(projectsPayload.projects.length).toBe(1);
      expect(projectsPayload.projects[0]?.title).toContain("Review");
      expect(projectsPayload.projects[0]?.goal).toContain("shared review control surface");
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks requirements with review_required when generic stories miss UI-shell upstream entries", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      const item = createWorkspaceItem(context, {
        title: "UI Shell",
        description: "Review the workflow through a shared UI shell"
      });
      const started = context.workflowService.startBrainstormSession(item.id);
      context.workflowService.updateBrainstormDraft({
        sessionId: started.sessionId,
        problem: "Operators lack a shared UI shell to review workflow runs",
        coreOutcome: "Ship a unified board, overlay, and inbox for the workflow engine",
        targetUsers: ["workflow operator", "reviewer"],
        useCases: [
          "board",
          "overlay",
          "inbox",
          "runs and artifacts",
          "chat",
          "component system",
          "showcase",
          "component inventory",
          "shared core services"
        ],
        constraints: ["must run offline"],
        nonGoals: ["multi-tenant sharing"],
        risks: ["unbounded artifact storage"],
        candidateDirections: ["single board with overlay"],
        recommendedDirection: "single board with overlay"
      });
      await context.workflowService.promoteBrainstorm(started.sessionId);
      const concept = context.repositories.conceptRepository.getLatestByItemId(item.id);
      context.workflowService.approveConcept(concept!.id);
      context.workflowService.importProjects(item.id);
      const project = context.repositories.projectRepository.listByItemId(item.id)[0]!;

      const result = await context.workflowService.startStage({
        stageKey: "requirements",
        itemId: item.id,
        projectId: project.id
      });

      expect(result.status).toBe("review_required");
      const run = context.repositories.stageRunRepository.getById(result.runId);
      expect(run?.status).toBe("review_required");
      expect(run?.errorMessage ?? "").toContain("Requirements coverage gate blocked");
      expect(run?.errorMessage ?? "").toMatch(/overlay|inbox|board/);
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("extracts labeled lists from bulleted chat messages when the adapter leaves fields empty", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      const item = createWorkspaceItem(context, {
        title: "Bulleted Brainstorm",
        description: "Plan-like chat input"
      });
      const started = context.workflowService.startBrainstormSession(item.id);

      const chatted = await context.workflowService.chatBrainstorm(
        started.sessionId,
        [
          "Here is the plan for the next milestone.",
          "",
          "Target users:",
          "- workflow operator",
          "- reviewer",
          "",
          "Use cases:",
          "- review overlay",
          "- browse inbox",
          "- inspect runs and artifacts",
          "",
          "Constraints:",
          "- must run offline",
          "",
          "Non-goals:",
          "- multi-tenant sharing",
          "",
          "Risks:",
          "- unbounded artifact storage"
        ].join("\n")
      ) as {
        draft: {
          targetUsers: string[];
          useCases: string[];
          constraints: string[];
          nonGoals: string[];
          risks: string[];
          scopeNotes: string | null;
        };
      };

      expect(chatted.draft.targetUsers).toContain("workflow operator");
      expect(chatted.draft.targetUsers).toContain("reviewer");
      expect(chatted.draft.useCases).toContain("review overlay");
      expect(chatted.draft.useCases).toContain("browse inbox");
      expect(chatted.draft.useCases).toContain("inspect runs and artifacts");
      expect(chatted.draft.constraints).toContain("must run offline");
      expect(chatted.draft.nonGoals).toContain("multi-tenant sharing");
      expect(chatted.draft.risks).toContain("unbounded artifact storage");
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("shows the latest brainstorm session by item without reopening a resolved session", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      const item = createWorkspaceItem(context, {
        title: "Resolved Brainstorm",
        description: "Inspect a closed brainstorm session"
      });

      const started = context.workflowService.startBrainstormSession(item.id);
      await context.workflowService.promoteBrainstorm(started.sessionId);

      const shown = context.workflowService.showBrainstormSession(item.id) as {
        session: { id: string; status: string };
      };

      expect(shown.session.id).toBe(started.sessionId);
      expect(shown.session.status).toBe("resolved");
      expect(context.repositories.brainstormSessionRepository.findOpenByItemId(item.id)).toBeNull();
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
      const item = createWorkspaceItem(context, {
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
    const repoScript = localAgentScriptPath;
    const originalScript = readFileSync(repoScript, "utf8");
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      const item = createWorkspaceItem(context, {
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
    const repoScript = localAgentScriptPath;
    const originalScript = readFileSync(repoScript, "utf8");
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      const item = createWorkspaceItem(context, {
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
      const item = createWorkspaceItem(context, {
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

  it("supports interactive story review sessions with messages, entries and resolution", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      const item = createWorkspaceItem(context, {
        title: "Interactive Review",
        description: "Story review flow"
      });
      await context.workflowService.startStage({
        stageKey: "brainstorm",
        itemId: item.id
      });
      const concept = context.repositories.conceptRepository.getLatestByItemId(item.id);
      context.workflowService.approveConcept(concept!.id);
      context.workflowService.importProjects(item.id);
      const project = context.repositories.projectRepository.listByItemId(item.id)[0]!;
      await context.workflowService.startStage({ stageKey: "requirements", itemId: item.id, projectId: project.id });

      const started = await context.workflowService.startInteractiveReview({ type: "stories", projectId: project.id });
      const session = context.workflowService.showInteractiveReview(started.sessionId) as {
        session: { status: string };
        entries: Array<{ entryId: string; status: string }>;
        messages: Array<{ role: string }>;
      };
      expect(session.session.status).toBe("waiting_for_user");
      expect(session.entries.length).toBeGreaterThan(0);
      expect(session.messages.map((message) => message.role).sort()).toEqual(["assistant", "system"]);

      const firstStory = context.repositories.userStoryRepository.listByProjectId(project.id)[0]!;
      const chatted = await context.workflowService.chatInteractiveReview(
        started.sessionId,
        `${firstStory.code} needs revision because acceptance criteria are too vague`
      );
      expect(chatted.derivedUpdates).toHaveLength(1);

      const updated = context.workflowService.showInteractiveReview(started.sessionId) as {
        session: { status: string };
        entries: Array<{ entryId: string; status: string }>;
      };
      expect(updated.session.status).toBe("waiting_for_user");
      expect(updated.entries.find((entry) => entry.entryId === firstStory.id)?.status).toBe("needs_revision");

      const remainingEntries = updated.entries.filter((entry) => entry.entryId !== firstStory.id);
      for (const entry of remainingEntries) {
        context.workflowService.updateInteractiveReviewEntry({
          sessionId: started.sessionId,
          storyId: entry.entryId,
          status: "accepted",
          summary: "Reviewed explicitly in integration test"
        });
      }

      expect((context.workflowService.showInteractiveReview(started.sessionId) as { session: { status: string } }).session.status).toBe(
        "ready_for_resolution"
      );

      const resolution = await context.workflowService.resolveInteractiveReview({
        sessionId: started.sessionId,
        action: "request_changes",
        rationale: "Story set still needs refinement"
      });
      expect(resolution.status).toBe("resolved");
      expect(context.repositories.itemRepository.getById(item.id)?.phaseStatus).toBe("review_required");
      expect(context.repositories.interactiveReviewResolutionRepository.listBySessionId(started.sessionId)).toHaveLength(1);

      try {
        context.workflowService.updateInteractiveReviewEntry({
          sessionId: started.sessionId,
          storyId: firstStory.id,
          status: "accepted"
        });
        throw new Error("Expected closed interactive review session to reject entry updates");
      } catch (error) {
        expect(error).toMatchObject({
          code: "INTERACTIVE_REVIEW_CLOSED"
        } satisfies Partial<AppError>);
      }
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("supports guided story edits and partial story approval in interactive review", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      const item = createWorkspaceItem(context, {
        title: "Interactive Review Edits",
        description: "Story edit flow"
      });
      await context.workflowService.startStage({
        stageKey: "brainstorm",
        itemId: item.id
      });
      const concept = context.repositories.conceptRepository.getLatestByItemId(item.id);
      context.workflowService.approveConcept(concept!.id);
      context.workflowService.importProjects(item.id);
      const project = context.repositories.projectRepository.listByItemId(item.id)[0]!;
      await context.workflowService.startStage({ stageKey: "requirements", itemId: item.id, projectId: project.id });

      const stories = context.repositories.userStoryRepository.listByProjectId(project.id);
      const session = await context.workflowService.startInteractiveReview({ type: "stories", projectId: project.id });

      const edited = context.workflowService.applyInteractiveReviewStoryEdits({
        sessionId: session.sessionId,
        storyId: stories[0]!.id,
        title: "Sharpened Story Title",
        acceptanceCriteria: ["First criterion clarified", "Second criterion added"],
        summary: "Story sharpened from review",
        status: "resolved"
      });
      expect(edited.story.title).toBe("Sharpened Story Title");
      expect(edited.acceptanceCriteria.map((criterion) => criterion.text)).toEqual([
        "First criterion clarified",
        "Second criterion added"
      ]);

      const partialApproval = await context.workflowService.resolveInteractiveReview({
        sessionId: session.sessionId,
        action: "approve_selected",
        storyIds: [stories[0]!.id],
        rationale: "First story is ready"
      });
      expect(partialApproval.status).toBe("resolved");
      expect(context.repositories.userStoryRepository.getById(stories[0]!.id)?.status).toBe("approved");
      expect(context.repositories.userStoryRepository.getById(stories[1]!.id)?.status).toBe("draft");
      expect(context.repositories.itemRepository.getById(item.id)?.currentColumn).toBe("requirements");
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not derive positive story updates from negated chat instructions", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      const item = createWorkspaceItem(context, {
        title: "Interactive Review Negation",
        description: "Negation handling"
      });
      await context.workflowService.startStage({
        stageKey: "brainstorm",
        itemId: item.id
      });
      const concept = context.repositories.conceptRepository.getLatestByItemId(item.id);
      context.workflowService.approveConcept(concept!.id);
      context.workflowService.importProjects(item.id);
      const project = context.repositories.projectRepository.listByItemId(item.id)[0]!;
      await context.workflowService.startStage({ stageKey: "requirements", itemId: item.id, projectId: project.id });

      const started = await context.workflowService.startInteractiveReview({ type: "stories", projectId: project.id });
      const firstStory = context.repositories.userStoryRepository.listByProjectId(project.id)[0]!;
      const chatted = await context.workflowService.chatInteractiveReview(
        started.sessionId,
        `Do not approve ${firstStory.code} yet and don't change anything else`
      );

      expect(chatted.derivedUpdates).toHaveLength(0);
      const review = context.workflowService.showInteractiveReview(started.sessionId) as {
        entries: Array<{ entryId: string; status: string }>;
      };
      expect(review.entries.find((entry) => entry.entryId === firstStory.id)?.status).toBe("pending");
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails interactive brainstorm chat on invalid structured agent output", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const scriptPath = join(root, "interactive-agent.mjs");
    writeFileSync(
      scriptPath,
      [
        'import { readFileSync } from "node:fs";',
        "const payload = JSON.parse(readFileSync(process.argv[2], 'utf8'));",
        "if (payload.interactionType === 'brainstorm_chat') {",
        "  process.stdout.write(JSON.stringify({ output: { assistantMessage: '', draftPatch: {} } }));",
        "} else {",
        "  process.stdout.write(JSON.stringify({ markdownArtifacts: [], structuredArtifacts: [] }));",
        "}"
      ].join("\n"),
      "utf8"
    );
    const context = createAppContext(dbPath, { adapterScriptPath: scriptPath });

    try {
      const item = createWorkspaceItem(context, {
        title: "Interactive Output Validation",
        description: "Validate invalid brainstorm chat output"
      });
      const started = context.workflowService.startBrainstormSession(item.id);

      await expect(context.workflowService.chatBrainstorm(started.sessionId, "problem: invalid output test")).rejects.toMatchObject({
        code: "INTERACTIVE_AGENT_OUTPUT_INVALID"
      } satisfies Partial<AppError>);
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails interactive review chat on invalid structured agent output", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const scriptPath = join(root, "interactive-review-agent.mjs");
    writeFileSync(
      scriptPath,
      [
        'import { readFileSync } from "node:fs";',
        "const payload = JSON.parse(readFileSync(process.argv[2], 'utf8'));",
        "if (payload.interactionType === 'story_review_chat') {",
        "  process.stdout.write(JSON.stringify({ output: { assistantMessage: '', entryUpdates: [] } }));",
        "} else {",
        "  process.stdout.write(JSON.stringify({ markdownArtifacts: [], structuredArtifacts: [] }));",
        "}"
      ].join("\n"),
      "utf8"
    );
    const setupContext = createAppContext(dbPath);
    let sessionId = "";

    try {
      const item = createWorkspaceItem(setupContext, {
        title: "Interactive Review Output Validation",
        description: "Validate invalid review chat output"
      });
      await setupContext.workflowService.startStage({
        stageKey: "brainstorm",
        itemId: item.id
      });
      const concept = setupContext.repositories.conceptRepository.getLatestByItemId(item.id);
      setupContext.workflowService.approveConcept(concept!.id);
      setupContext.workflowService.importProjects(item.id);
      const project = setupContext.repositories.projectRepository.listByItemId(item.id)[0]!;
      await setupContext.workflowService.startStage({ stageKey: "requirements", itemId: item.id, projectId: project.id });
      sessionId = (await setupContext.workflowService.startInteractiveReview({ type: "stories", projectId: project.id })).sessionId;
    } finally {
      setupContext.connection.close();
    }

    const context = createAppContext(dbPath, { adapterScriptPath: scriptPath });
    try {
      await expect(context.workflowService.chatInteractiveReview(sessionId, "Please review the first story")).rejects.toMatchObject({
        code: "INTERACTIVE_AGENT_OUTPUT_INVALID"
      } satisfies Partial<AppError>);
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("marks planning review runs as failed when reviewer output is invalid", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const scriptPath = join(root, "planning-review-agent.mjs");
    writeFileSync(
      scriptPath,
      [
        'import { readFileSync } from "node:fs";',
        "const payload = JSON.parse(readFileSync(process.argv[2], 'utf8'));",
        "if (payload.interactionType === 'planning_review') {",
        "  process.stdout.write(JSON.stringify({ output: { status: 'ready', readiness: 'ready', summary: '' } }));",
        "} else {",
        "  process.stdout.write(JSON.stringify({ markdownArtifacts: [], structuredArtifacts: [] }));",
        "}"
      ].join("\n"),
      "utf8"
    );
    const context = createAppContext(dbPath, { adapterScriptPath: scriptPath });

    try {
      const item = createWorkspaceItem(context, {
        title: "Planning Review Failure",
        description: "Persist failed planning review runs"
      });
      const brainstorm = context.workflowService.startBrainstormSession(item.id);
      context.workflowService.updateBrainstormDraft({
        sessionId: brainstorm.sessionId,
        problem: "Need a failed planning review run",
        coreOutcome: "Track invalid reviewer output correctly",
        targetUsers: ["delivery lead"],
        useCases: ["review planning artifacts safely"],
        recommendedDirection: "Persist failed planning review runs"
      });

      await expect(
        context.workflowService.startPlanningReview({
          sourceType: "brainstorm_session",
          sourceId: brainstorm.sessionId,
          step: "plan_writing",
          reviewMode: "readiness",
          interactionMode: "interactive"
        })
      ).rejects.toMatchObject({
        code: "PLANNING_REVIEW_OUTPUT_INVALID"
      } satisfies Partial<AppError>);

      const latestRun = context.repositories.reviewRunRepository.getLatestBySubject({
        reviewKind: "planning",
        subjectType: "brainstorm_session",
        subjectId: brainstorm.sessionId
      });
      expect(latestRun?.status).toBe("failed");
      expect(latestRun?.failedReason).toContain("summary");
      expect(latestRun?.automationLevel).toBe("manual");
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("normalizes readiness-like planning review statuses returned in the status field", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const scriptPath = join(root, "planning-review-readiness-status-agent.mjs");
    writeFileSync(
      scriptPath,
      [
        'import { readFileSync } from "node:fs";',
        "const payload = JSON.parse(readFileSync(process.argv[2], 'utf8'));",
        "if (payload.interactionType === 'planning_review') {",
        "  process.stdout.write(JSON.stringify({ output: {",
        "    status: 'needs_evidence',",
        "    readiness: 'needs_evidence',",
        "    summary: 'Need explicit answers before proceeding.',",
        "    findings: [{ type: 'question', title: 'Clarify the CLI flow', detail: 'Define the exact command sequence.', evidence: 'Flow is not explicit.' }],",
        "    missingInformation: ['Exact CLI sequence'],",
        "    recommendedNextEvidence: ['List required commands and expected outputs'],",
        "    assumptionsDetected: []",
        "  } }));",
        "} else {",
        "  process.stdout.write(JSON.stringify({ markdownArtifacts: [], structuredArtifacts: [] }));",
        "}"
      ].join("\n"),
      "utf8"
    );
    const context = createAppContext(dbPath, { adapterScriptPath: scriptPath });

    try {
      const item = createWorkspaceItem(context, {
        title: "Planning Review Readiness Alias",
        description: "Normalize readiness-like statuses in planning review output"
      });
      const brainstorm = context.workflowService.startBrainstormSession(item.id);
      context.workflowService.updateBrainstormDraft({
        sessionId: brainstorm.sessionId,
        problem: "Need a tolerance test for planning review output",
        coreOutcome: "Normalize readiness aliases",
        targetUsers: ["delivery lead"],
        useCases: ["review planning artifacts safely"],
        recommendedDirection: "Accept readiness-like statuses in the status field"
      });

      const review = await context.workflowService.startPlanningReview({
        sourceType: "brainstorm_session",
        sourceId: brainstorm.sessionId,
        step: "plan_writing",
        reviewMode: "readiness",
        interactionMode: "interactive"
      });

      expect(review.run.status).toBe("questions_only");
      expect(review.run.readiness).toBe("needs_evidence");
      expect(review.questions.length).toBeGreaterThan(0);
      expect(review.findings[0]?.title).toBe("Clarify the CLI flow");
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("enforces auto-gate planning review runs on approval transitions", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      const item = createWorkspaceItem(context, {
        title: "Planning Gate",
        description: "Enforce planning review gates on approvals"
      });
      await context.workflowService.startStage({ stageKey: "brainstorm", itemId: item.id });
      const concept = context.repositories.conceptRepository.getLatestByItemId(item.id);
      context.workflowService.approveConcept(concept!.id);
      context.workflowService.importProjects(item.id);
      const project = context.repositories.projectRepository.listByItemId(item.id)[0]!;

      await context.workflowService.startStage({
        stageKey: "requirements",
        itemId: item.id,
        projectId: project.id
      });
      const interactiveReview = await context.workflowService.startInteractiveReview({
        type: "stories",
        projectId: project.id
      });
      seedPlanningReviewRun(context, {
        sourceType: "interactive_review_session",
        sourceId: interactiveReview.sessionId,
        step: "requirements_engineering",
        status: "blocker_present",
        readiness: "needs_evidence"
      });
      expect(() => context.workflowService.approveStories(project.id)).toThrowError(
        expect.objectContaining({ code: "PLANNING_REVIEW_GATE_BLOCKED" } satisfies Partial<AppError>)
      );

      seedPlanningReviewRun(context, {
        sourceType: "interactive_review_session",
        sourceId: interactiveReview.sessionId,
        step: "requirements_engineering",
        status: "ready",
        readiness: "ready"
      });
      context.workflowService.approveStories(project.id);

      await context.workflowService.startStage({
        stageKey: "architecture",
        itemId: item.id,
        projectId: project.id
      });
      const architecturePlan = context.repositories.architecturePlanRepository.getLatestByProjectId(project.id)!;
      seedPlanningReviewRun(context, {
        sourceType: "architecture_plan",
        sourceId: architecturePlan.id,
        step: "architecture",
        status: "questions_only",
        readiness: "needs_evidence"
      });
      expect(() => context.workflowService.approveArchitecture(project.id)).toThrowError(
        expect.objectContaining({ code: "PLANNING_REVIEW_GATE_BLOCKED" } satisfies Partial<AppError>)
      );

      seedPlanningReviewRun(context, {
        sourceType: "architecture_plan",
        sourceId: architecturePlan.id,
        step: "architecture",
        status: "ready",
        readiness: "ready_with_assumptions"
      });
      context.workflowService.approveArchitecture(project.id);

      await context.workflowService.startStage({
        stageKey: "planning",
        itemId: item.id,
        projectId: project.id
      });
      const implementationPlan = context.repositories.implementationPlanRepository.getLatestByProjectId(project.id)!;
      seedPlanningReviewRun(context, {
        sourceType: "implementation_plan",
        sourceId: implementationPlan.id,
        step: "plan_writing",
        status: "blocked",
        readiness: "needs_human_review"
      });
      expect(() => context.workflowService.approvePlanning(project.id)).toThrowError(
        expect.objectContaining({ code: "PLANNING_REVIEW_GATE_BLOCKED" } satisfies Partial<AppError>)
      );

      seedPlanningReviewRun(context, {
        sourceType: "implementation_plan",
        sourceId: implementationPlan.id,
        step: "plan_writing",
        status: "ready",
        readiness: "ready"
      });
      context.workflowService.approvePlanning(project.id);
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not enforce planning review gates for advisory-only or non-auto-gate runs", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      const item = createWorkspaceItem(context, {
        title: "Advisory Gate Bypass",
        description: "Only advisory planning reviews should not block approvals"
      });
      await context.workflowService.startStage({ stageKey: "brainstorm", itemId: item.id });
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

      const implementationPlan = context.repositories.implementationPlanRepository.getLatestByProjectId(project.id)!;
      seedPlanningReviewRun(context, {
        sourceType: "implementation_plan",
        sourceId: implementationPlan.id,
        step: "plan_writing",
        status: "blocked",
        readiness: "needs_human_review",
        gateEligibility: "advisory_only"
      });
      context.workflowService.approvePlanning(project.id);
      seedPlanningReviewRun(context, {
        sourceType: "implementation_plan",
        sourceId: implementationPlan.id,
        step: "plan_writing",
        status: "blocker_present",
        readiness: "needs_evidence",
        automationLevel: "auto_comment"
      });
      context.workflowService.approvePlanning(project.id);
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
      const item = createWorkspaceItem(context, {
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
      const item = createWorkspaceItem(context, {
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
      const item = createWorkspaceItem(context, {
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
            appVerificationRuns: Array<{ status: string; runner: string }>;
            latestAppVerificationRun: { status: string; runner: string; resultJson: string | null } | null;
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
      expect(shown.waves[0]?.stories[0]?.appVerificationRuns).toHaveLength(1);
      expect(shown.waves[0]?.stories[0]?.latestAppVerificationRun?.status).toBe("passed");
      expect(["agent_browser", "playwright"]).toContain(
        shown.waves[0]?.stories[0]?.latestAppVerificationRun?.runner
      );
      expect(shown.waves[0]?.stories[0]?.latestAppVerificationRun?.resultJson).toContain("overallStatus");
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

  it("shows a compact execution summary and story-specific execution logs", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      const { project } = await prepareProjectThroughCompletedExecution(context, {
        title: "Execution Observability",
        description: "Inspect compact execution status and logs"
      });

      const compact = context.workflowService.showExecutionCompact(project.id) as {
        overallStatus: string;
        activeWaveCode: string | null;
        waves: Array<{
          waveCode: string;
          status: string;
          completedStoryCount: number;
          stories: Array<{ storyCode: string; status: string; lastPhase: string }>;
        }>;
      };
      expect(compact.overallStatus).toBe("completed");
      expect(compact.activeWaveCode).toBeNull();
      expect(compact.waves.map((wave) => wave.status)).toEqual(["completed", "completed"]);
      expect(compact.waves[0]?.completedStoryCount).toBe(1);
      expect(compact.waves[0]?.stories[0]).toMatchObject({
        storyCode: "ITEM-0001-P01-US01",
        status: "completed",
        lastPhase: "story_review"
      });

      const logs = context.workflowService.showExecutionLogs({
        projectId: project.id,
        storyCode: "ITEM-0001-P01-US01"
      }) as {
        wave: { code: string };
        story: { code: string };
        latestTestPreparation: { sessions: Array<{ adapterKey: string; stdout: string }> } | null;
        latestExecution: { sessions: Array<{ adapterKey: string; stdout: string }>; verificationRuns: Array<{ mode: string }> } | null;
        latestStoryReview: { sessions: Array<{ adapterKey: string; stdout: string }> } | null;
      };
      expect(logs.wave.code).toBe("W01");
      expect(logs.story.code).toBe("ITEM-0001-P01-US01");
      expect(logs.latestTestPreparation?.sessions[0]?.adapterKey).toBe("local-cli");
      expect(logs.latestExecution?.sessions[0]?.adapterKey).toBe("local-cli");
      expect(logs.latestExecution?.verificationRuns.map((run) => run.mode)).toEqual(["basic", "ralph"]);
      expect(logs.latestStoryReview?.sessions[0]?.adapterKey).toBe("local-cli");
      expect(logs.latestStoryReview?.sessions[0]?.stdout).toContain("\"overallStatus\":\"passed\"");
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("propagates persisted Sonar and Coderabbit quality knowledge into story review context snapshots", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      const item = createWorkspaceItem(context, {
        title: "Review Quality Signals",
        description: "Verify persisted quality knowledge is consumed by story review"
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

      const implementationPlan = context.repositories.implementationPlanRepository.getLatestByProjectId(project.id)!;
      const firstWave = context.repositories.waveRepository.listByImplementationPlanId(implementationPlan.id)[0]!;
      const firstStory = context.repositories.userStoryRepository.listByProjectId(project.id)[0]!;

      context.repositories.qualityKnowledgeEntryRepository.createMany([
        {
          workspaceId: context.workspace.id,
          projectId: project.id,
          waveId: firstWave.id,
          storyId: null,
          source: "sonar",
          scopeType: "project",
          scopeId: project.id,
          kind: "recurring_issue",
          summary: "Guard workflow persistence invariants",
          evidenceJson: JSON.stringify({ rule: "sonar:persistence-guard" }),
          status: "open",
          relevanceTagsJson: JSON.stringify({
            files: [],
            storyCodes: [],
            modules: [],
            categories: ["reliability"]
          })
        },
        {
          workspaceId: context.workspace.id,
          projectId: null,
          waveId: null,
          storyId: null,
          source: "coderabbit",
          scopeType: "workspace",
          scopeId: context.workspace.id,
          kind: "constraint",
          summary: "Keep review-step integrations optional and degradable",
          evidenceJson: JSON.stringify({ rule: "coderabbit:degraded-mode" }),
          status: "open",
          relevanceTagsJson: JSON.stringify({
            files: [],
            storyCodes: [firstStory.code],
            modules: [],
            categories: ["maintainability"]
          })
        }
      ]);

      const firstExecution = await context.workflowService.startExecution(project.id);
      expect(firstExecution.executions[0]?.status).toBe("completed");
      expect(firstExecution.executions[0]?.phase).toBe("story_review");
      const shown = context.workflowService.showExecution(project.id) as {
        waves: Array<{
          stories: Array<{
            story: { code: string };
            latestExecution: {
              businessContextSnapshotJson: string;
              repoContextSnapshotJson: string;
            } | null;
            latestStoryReviewRun: { status: string } | null;
          }>;
        }>;
      };
      const latestExecution = shown.waves[0]?.stories[0]?.latestExecution;
      const businessContext = JSON.parse(latestExecution!.businessContextSnapshotJson) as {
        qualityGuidance: Array<{ source: string; summary: string; status: string }>;
      };
      const repoContext = JSON.parse(latestExecution!.repoContextSnapshotJson) as {
        recurringQualityRisks: Array<{ source: string; summary: string; status: string }>;
        engineeringConstraints: Array<{ source: string; summary: string; status: string }>;
      };

      expect(shown.waves[0]?.stories[0]?.story.code).toBe(firstStory.code);
      expect(shown.waves[0]?.stories[0]?.latestStoryReviewRun?.status).toBe("passed");
      expect(businessContext.qualityGuidance).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: "sonar",
            summary: "Guard workflow persistence invariants",
            status: "open"
          }),
          expect.objectContaining({
            source: "coderabbit",
            summary: "Keep review-step integrations optional and degradable",
            status: "open"
          })
        ])
      );
      expect(repoContext.recurringQualityRisks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: "sonar",
            summary: "Guard workflow persistence invariants",
            status: "open"
          })
        ])
      );
      expect(repoContext.engineeringConstraints).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: "coderabbit",
            summary: "Keep review-step integrations optional and degradable",
            status: "open"
          })
        ])
      );

    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refreshes Sonar quality knowledge automatically after story-branch implementation", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const workspaceRoot = createGitWorkspace(root);
    const context = createAppContext(dbPath, { workspaceRoot });

    try {
      const item = createWorkspaceItem(context, {
        title: "Auto Sonar Refresh",
        description: "Persist Sonar knowledge automatically after implementation on a story branch"
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

      const firstStory = context.repositories.userStoryRepository.listByProjectId(project.id)[0]!;
      const sonarEntries = context.repositories.qualityKnowledgeEntryRepository
        .listByWorkspaceId(context.workspace.id)
        .filter((entry) => entry.source === "sonar" && entry.storyId === firstStory.id);

      expect(sonarEntries.length).toBeGreaterThan(0);
      expect(sonarEntries.some((entry) => entry.projectId === project.id)).toBe(true);
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps compact execution status running until story review starts after app verification", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      const { project } = await prepareProjectThroughCompletedExecution(context, {
        title: "Execution Midflight State",
        description: "Expose compact state between app verification and story review"
      });

      const execution = context.workflowService.showExecution(project.id);
      const storyReviewRunId = execution.waves[0]?.stories[0]?.latestStoryReviewRun?.id;
      expect(storyReviewRunId).toBeTruthy();
      asRunnableConnection(context.connection)
        .prepare("DELETE FROM story_review_agent_sessions WHERE story_review_run_id = ?")
        .run(storyReviewRunId);
      asRunnableConnection(context.connection)
        .prepare("DELETE FROM story_review_runs WHERE id = ?")
        .run(storyReviewRunId);

      const compact = context.workflowService.showExecutionCompact(project.id);
      expect(compact.waves[0]?.stories[0]).toMatchObject({
        status: "running",
        lastPhase: "app_verification"
      });
    } finally {
      context.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("marks documentation review_required when workspace materialization fails after successful agent output", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const executionWorkspaceRoot = createGitWorkspace(root);
    const setupContext = createAppContext(dbPath, { workspaceRoot: executionWorkspaceRoot });

    try {
      const { item, project } = await prepareProjectThroughCompletedExecution(setupContext, {
        title: "Documentation Materialization Failure",
        description: "Do not leave documentation runs stuck in running"
      });
      const qa = await setupContext.workflowService.startQa(project.id);
      expect(qa.status).toBe("passed");

      const implementationPlan = setupContext.repositories.implementationPlanRepository.getLatestByProjectId(project.id)!;
      const waves = setupContext.repositories.waveRepository.listByImplementationPlanId(implementationPlan.id);
      const waveStories = setupContext.repositories.waveStoryRepository.listByWaveIds(waves.map((wave) => wave.id));
      const executions = setupContext.repositories.waveStoryExecutionRepository.listLatestByWaveStoryIds(
        waveStories.map((waveStory) => waveStory.id)
      );
      const invalidWorkspaceRoot = join(root, "invalid-workspace-root");
      writeFileSync(invalidWorkspaceRoot, "not a directory", "utf8");
      asRunnableConnection(setupContext.connection)
        .prepare("UPDATE wave_story_executions SET git_metadata_json = ?")
        .run(
          JSON.stringify({
            branchRole: "story",
            baseRef: "proj/test",
            branchName: "story/test",
            workspaceRoot: invalidWorkspaceRoot,
            headBefore: null,
            headAfter: null,
            commitSha: null,
            mergedIntoRef: null,
            mergedCommitSha: null,
            strategy: "simulated",
            reason: "forced invalid workspace for test"
          })
        );
      setupContext.connection.close();

      const documentationContext = createAppContext(dbPath, { workspaceRoot: executionWorkspaceRoot });
      try {
        const documentation = await documentationContext.workflowService.startDocumentation(project.id);
        expect(executions.length).toBeGreaterThan(0);
        expect(documentation.status).toBe("review_required");

        const shown = documentationContext.workflowService.showDocumentation(project.id);
        expect(shown.latestDocumentationRun?.status).toBe("review_required");
        expect(shown.latestDocumentationRun?.errorMessage).toBeTruthy();
        expect(shown.latestDocumentationRun?.summaryJson).toContain("workspaceMaterializationError");
        expect(documentationContext.repositories.itemRepository.getById(item.id)?.phaseStatus).toBe("review_required");
      } finally {
        documentationContext.connection.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("retries a failed test-preparation wave when execution is started again after fixing the adapter", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const originalScript = readFileSync(localAgentScriptPath, "utf8");
    const adapterScriptPath = join(root, "local-agent-test-prep-invalid.mjs");
    const dbPath = join(root, "app.sqlite");

    try {
      const invalidTestPreparationScript = replaceRequired(
        originalScript,
        "      testsGenerated: payload.acceptanceCriteria.map((criterion) => ({",
        "      testsGenerated: undefined,\n      testsGeneratedBroken: payload.acceptanceCriteria.map((criterion) => ({"
      );
      writeFileSync(adapterScriptPath, invalidTestPreparationScript);
      const failingContext = createAppContext(dbPath, { adapterScriptPath });

      const item = createWorkspaceItem(failingContext, {
        title: "Execution Retry After Test Preparation Failure",
        description: "Allow retry after fixing the test preparation worker output"
      });
      await failingContext.workflowService.startStage({ stageKey: "brainstorm", itemId: item.id });
      const concept = failingContext.repositories.conceptRepository.getLatestByItemId(item.id);
      failingContext.workflowService.approveConcept(concept!.id);
      failingContext.workflowService.importProjects(item.id);
      const project = failingContext.repositories.projectRepository.listByItemId(item.id)[0]!;
      await failingContext.workflowService.startStage({ stageKey: "requirements", itemId: item.id, projectId: project.id });
      failingContext.workflowService.approveStories(project.id);
      await failingContext.workflowService.startStage({ stageKey: "architecture", itemId: item.id, projectId: project.id });
      failingContext.workflowService.approveArchitecture(project.id);
      await failingContext.workflowService.startStage({ stageKey: "planning", itemId: item.id, projectId: project.id });
      failingContext.workflowService.approvePlanning(project.id);

      const first = await failingContext.workflowService.startExecution(project.id);
      expect(first.executions[0]?.phase).toBe("test_preparation");
      expect(first.executions[0]?.status).toBe("failed");

      const failedExecution = failingContext.workflowService.showExecution(project.id) as {
        waves: Array<{
          waveExecution: { status: string } | null;
          stories: Array<{
            latestTestRun: { status: string } | null;
            latestExecution: { status: string } | null;
          }>;
        }>;
      };
      expect(failedExecution.waves[0]?.waveExecution?.status).toBe("failed");
      expect(failedExecution.waves[0]?.stories[0]?.latestTestRun?.status).toBe("failed");
      expect(failedExecution.waves[0]?.stories[0]?.latestExecution).toBeNull();
      failingContext.connection.close();

      const retryContext = createAppContext(dbPath);
      const retried = await retryContext.workflowService.startExecution(project.id);
      expect(retried.activeWaveCode).toBe("W01");
      expect(retried.blockedByFailure).toBe(false);
      expect(retried.executions[0]?.status).toBe("completed");
      expect(retried.executions[0]?.phase).toBe("story_review");

      const finalExecution = retryContext.workflowService.showExecution(project.id) as {
        waves: Array<{
          waveExecution: { status: string } | null;
          stories: Array<{
            waveStory: { id: string };
            latestTestRun: { status: string } | null;
            latestExecution: { status: string } | null;
          }>;
        }>;
      };
      const firstWaveStoryId = finalExecution.waves[0]?.stories[0]?.waveStory.id;
      expect(firstWaveStoryId).toBeTruthy();
      const testRuns = retryContext.repositories.waveStoryTestRunRepository.listByWaveStoryId(firstWaveStoryId!);
      expect(finalExecution.waves[0]?.waveExecution?.status).toBe("completed");
      expect(testRuns.map((run) => run.status)).toEqual(["failed", "completed"]);
      expect(finalExecution.waves[0]?.stories[0]?.latestTestRun?.status).toBe("completed");
      expect(finalExecution.waves[0]?.stories[0]?.latestExecution?.status).toBe("completed");
      retryContext.connection.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("marks execution review_required when Ralph returns review_required", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const originalScript = readFileSync(localAgentScriptPath, "utf8");
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

      const item = createWorkspaceItem(context, {
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
    const originalScript = readFileSync(localAgentScriptPath, "utf8");
    const adapterScriptPath = join(root, "local-agent-failed.mjs");
    const dbPath = join(root, "app.sqlite");

    try {
      const failedScript = replaceRequired(originalScript, "      overallStatus: status,", '      overallStatus: "failed",');
      writeFileSync(adapterScriptPath, failedScript);
      const context = createAppContext(dbPath, { adapterScriptPath });

      const item = createWorkspaceItem(context, {
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

  it("accepts Ralph verifier output with blank notes by normalizing them", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const originalScript = readFileSync(localAgentScriptPath, "utf8");
    const adapterScriptPath = join(root, "local-agent-ralph-blank-notes.mjs");
    const dbPath = join(root, "app.sqlite");

    try {
      const blankNotesScript = replaceRequired(
        originalScript,
        "        notes:\n          status === \"passed\"\n            ? `Criterion ${criterion.code} is covered by the stored test and implementation evidence.`\n            : `Criterion ${criterion.code} needs follow-up before completion.`",
        "        notes: \"\""
      );
      writeFileSync(adapterScriptPath, blankNotesScript);
      const context = createAppContext(dbPath, { adapterScriptPath });

      const item = createWorkspaceItem(context, {
        title: "Ralph Blank Notes",
        description: "Normalize blank Ralph notes from the verifier"
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
      expect(first.executions[0]?.status).toBe("completed");

      const shown = context.workflowService.showExecution(project.id) as {
        waves: Array<{
          stories: Array<{
            latestRalphVerification: { status: string; summaryJson?: string } | null;
            latestExecution: { status: string } | null;
          }>;
        }>;
      };
      expect(shown.waves[0]?.stories[0]?.latestExecution?.status).toBe("completed");
      expect(shown.waves[0]?.stories[0]?.latestRalphVerification?.status).toBe("passed");
      context.connection.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("stores app verification runs, surfaces them in execution state, and supports retry", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const originalScript = readFileSync(localAgentScriptPath, "utf8");
    const adapterScriptPath = join(root, "local-agent-app-review-required.mjs");
    const dbPath = join(root, "app.sqlite");

    try {
      const reviewScript = replaceRequired(
        originalScript,
        '  let overallStatus = "passed";',
        '  let overallStatus = "review_required";'
      );
      writeFileSync(adapterScriptPath, reviewScript);
      const reviewContext = createAppContext(dbPath, { adapterScriptPath });

      const item = createWorkspaceItem(reviewContext, {
        title: "App Verification Required",
        description: "Trigger app verification follow-up"
      });
      await reviewContext.workflowService.startStage({ stageKey: "brainstorm", itemId: item.id });
      const concept = reviewContext.repositories.conceptRepository.getLatestByItemId(item.id);
      reviewContext.workflowService.approveConcept(concept!.id);
      reviewContext.workflowService.importProjects(item.id);
      const project = reviewContext.repositories.projectRepository.listByItemId(item.id)[0]!;
      await reviewContext.workflowService.startStage({ stageKey: "requirements", itemId: item.id, projectId: project.id });
      reviewContext.workflowService.approveStories(project.id);
      await reviewContext.workflowService.startStage({ stageKey: "architecture", itemId: item.id, projectId: project.id });
      reviewContext.workflowService.approveArchitecture(project.id);
      await reviewContext.workflowService.startStage({ stageKey: "planning", itemId: item.id, projectId: project.id });
      reviewContext.workflowService.approvePlanning(project.id);

      const first = await reviewContext.workflowService.startExecution(project.id);
      expect(first.executions[0]?.status).toBe("review_required");
      expect(first.executions[0]?.phase).toBe("app_verification");

      const shown = reviewContext.workflowService.showExecution(project.id) as {
        waves: Array<{
          waveExecution: { status: string } | null;
          stories: Array<{
            latestExecution: { status: string; id?: string } | null;
            latestAppVerificationRun: { id: string; status: string } | null;
            latestStoryReviewRun: { status: string } | null;
          }>;
        }>;
      };
      expect(shown.waves[0]?.waveExecution?.status).toBe("review_required");
      expect(shown.waves[0]?.stories[0]?.latestExecution?.status).toBe("review_required");
      expect(shown.waves[0]?.stories[0]?.latestAppVerificationRun?.status).toBe("review_required");
      expect(shown.waves[0]?.stories[0]?.latestStoryReviewRun).toBeNull();
      const firstExecutionId = shown.waves[0]?.stories[0]?.latestExecution?.id;
      expect(firstExecutionId).toBeTruthy();
      const firstCoreRun = reviewContext.repositories.reviewRunRepository.getLatestBySubject({
        reviewKind: "app_verification",
        subjectType: "wave_story_execution",
        subjectId: firstExecutionId!
      });
      expect(firstCoreRun?.status).toBe("action_required");
      expect(firstCoreRun?.subjectStep).toBe("app_verification");

      const appVerificationRunId = shown.waves[0]?.stories[0]?.latestAppVerificationRun?.id;
      expect(appVerificationRunId).toBeTruthy();
      reviewContext.connection.close();

      const retryContext = createAppContext(dbPath);
      const retried = await retryContext.workflowService.retryAppVerification(appVerificationRunId!);
      expect(retried.status).toBe("completed");
      expect(retried.phase).toBe("story_review");

      const appVerification = retryContext.workflowService.showAppVerification(retried.appVerificationRunId) as {
        run: { status: string };
        result: { overallStatus: string } | null;
      };
      expect(appVerification.run.status).toBe("passed");
      expect(appVerification.result?.overallStatus).toBe("passed");

      const finalExecution = retryContext.workflowService.showExecution(project.id) as {
        waves: Array<{
          waveExecution: { status: string } | null;
          stories: Array<{
            latestExecution: { status: string } | null;
            latestAppVerificationRun: { status: string } | null;
            latestStoryReviewRun: { status: string } | null;
          }>;
        }>;
      };
      expect(finalExecution.waves[0]?.waveExecution?.status).toBe("completed");
      expect(finalExecution.waves[0]?.stories[0]?.latestExecution?.status).toBe("completed");
      expect(finalExecution.waves[0]?.stories[0]?.latestAppVerificationRun?.status).toBe("passed");
      expect(finalExecution.waves[0]?.stories[0]?.latestStoryReviewRun?.status).toBe("passed");
      const latestExecutionId = retryContext.workflowService.showExecution(project.id).waves[0]?.stories[0]?.latestExecution?.id;
      expect(latestExecutionId).toBeTruthy();
      const latestCoreRun = retryContext.repositories.reviewRunRepository.getLatestBySubject({
        reviewKind: "app_verification",
        subjectType: "wave_story_execution",
        subjectId: latestExecutionId!
      });
      expect(latestCoreRun?.status).toBe("complete");
      retryContext.connection.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("falls back to playwright when agent_browser baseUrl is unreachable", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      context.repositories.workspaceSettingsRepository.update(context.workspace.id, {
        appTestConfigJson: JSON.stringify(
          {
            baseUrl: "http://127.0.0.1:3000",
            runnerPreference: ["agent_browser", "playwright"]
          },
          null,
          2
        )
      });

      const item = createWorkspaceItem(context, {
        title: "App Verification Runner Fallback",
        description: "Use playwright when no app is reachable for agent browser"
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
      expect(first.executions[0]?.status).toBe("completed");

      const shown = context.workflowService.showExecution(project.id) as {
        waves: Array<{
          stories: Array<{
            latestExecution: { status: string; id?: string } | null;
            latestAppVerificationRun: { status: string; runner: string } | null;
            latestStoryReviewRun: { status: string } | null;
          }>;
        }>;
      };
      expect(shown.waves[0]?.stories[0]?.latestExecution?.status).toBe("completed");
      expect(shown.waves[0]?.stories[0]?.latestAppVerificationRun?.status).toBe("passed");
      expect(shown.waves[0]?.stories[0]?.latestAppVerificationRun?.runner).toBe("playwright");
      expect(shown.waves[0]?.stories[0]?.latestStoryReviewRun?.status).toBe("passed");
      context.connection.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists the runtime-resolved app verification endpoint from resolvedStartUrl", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const originalScript = readFileSync(localAgentScriptPath, "utf8");
    const adapterScriptPath = join(root, "local-agent-app-runtime-endpoint.mjs");
    const dbPath = join(root, "app.sqlite");

    try {
      const runtimeEndpointScript = replaceRequired(
        originalScript,
        "  const resolvedStartUrl = payload.preparedSession?.resolvedStartUrl ?? payload.projectAppTestContext?.baseUrl ?? null;",
        '  const resolvedStartUrl = "http://127.0.0.1:4173/runtime-check";'
      );
      writeFileSync(adapterScriptPath, runtimeEndpointScript);
      const context = createAppContext(dbPath, { adapterScriptPath });

      context.repositories.workspaceSettingsRepository.update(context.workspace.id, {
        appTestConfigJson: JSON.stringify(
          {
            baseUrl: "http://127.0.0.1:3000",
            runnerPreference: ["agent_browser", "playwright"]
          },
          null,
          2
        )
      });

      const item = createWorkspaceItem(context, {
        title: "App Verification Runtime Endpoint",
        description: "Persist the actual runtime endpoint used during verification"
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
      expect(first.executions[0]?.status).toBe("completed");

      const latestExecutionId = context.workflowService.showExecution(project.id).waves[0]?.stories[0]?.latestExecution?.id;
      expect(latestExecutionId).toBeTruthy();
      const latestRun = context.repositories.appVerificationRunRepository.getLatestByWaveStoryExecutionId(latestExecutionId!);
      expect(latestRun).toBeTruthy();

      const preparedSession = JSON.parse(latestRun!.preparedSessionJson ?? "{}") as {
        runner?: string;
        baseUrl?: string;
        resolvedBaseUrl?: string;
        endpointSource?: string;
        resolvedStartUrl?: string;
      };
      expect(preparedSession.runner).toBe("playwright");
      expect(preparedSession.baseUrl).toBe("http://127.0.0.1:3000");
      expect(preparedSession.resolvedBaseUrl).toBe("http://127.0.0.1:4173");
      expect(preparedSession.endpointSource).toBe("derived_runtime");
      expect(preparedSession.resolvedStartUrl).toBe("http://127.0.0.1:4173/runtime-check");

      context.connection.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("normalizes inconsistent app verification failures when all checks passed", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const originalScript = readFileSync(localAgentScriptPath, "utf8");
    const adapterScriptPath = join(root, "local-agent-app-inconsistent-status.mjs");
    const dbPath = join(root, "app.sqlite");

    try {
      const inconsistentScript = replaceRequired(
        originalScript,
        '      overallStatus,',
        '      overallStatus: "failed",'
      );
      writeFileSync(adapterScriptPath, inconsistentScript);
      const context = createAppContext(dbPath, { adapterScriptPath });

      const item = createWorkspaceItem(context, {
        title: "Normalize App Verification Status",
        description: "Treat all-passing app verification checks as passed even when the provider status is wrong"
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

      const execution = await context.workflowService.startExecution(project.id);
      expect(execution.executions[0]?.status).toBe("completed");

      const latestAppRunId = context.workflowService.showExecution(project.id).waves[0]?.stories[0]?.latestAppVerificationRun?.id;
      expect(latestAppRunId).toBeTruthy();
      const appVerification = context.workflowService.showAppVerification(latestAppRunId!) as {
        run: { status: string };
        result: { overallStatus: string; failureSummary?: string | null } | null;
      };
      expect(appVerification.run.status).toBe("passed");
      expect(appVerification.result?.overallStatus).toBe("passed");
      expect(appVerification.result?.failureSummary ?? null).toBeNull();
      context.connection.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resumes orphaned running executions when the implementation summary was already persisted", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      const item = createWorkspaceItem(context, {
        title: "Resume Interrupted Verification",
        description: "Continue verification after an interrupted execution tick"
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
          waveExecution: { id: string } | null;
          stories: Array<{
            latestExecution: { id: string; outputSummaryJson: string | null } | null;
          }>;
        }>;
      };
      const latestExecution = shownBefore.waves[0]?.stories[0]?.latestExecution;
      const latestWaveExecution = shownBefore.waves[0]?.waveExecution;
      expect(latestExecution?.outputSummaryJson).toBeTruthy();
      expect(latestWaveExecution?.id).toBeTruthy();

      asRunnableConnection(context.connection).prepare("DELETE FROM verification_runs WHERE wave_story_execution_id = ?").run(latestExecution!.id);
      asRunnableConnection(context.connection).prepare("DELETE FROM app_verification_runs WHERE wave_story_execution_id = ?").run(latestExecution!.id);
      asRunnableConnection(context.connection).prepare("DELETE FROM story_review_agent_sessions WHERE story_review_run_id IN (SELECT id FROM story_review_runs WHERE wave_story_execution_id = ?)").run(latestExecution!.id);
      asRunnableConnection(context.connection).prepare("DELETE FROM story_review_findings WHERE story_review_run_id IN (SELECT id FROM story_review_runs WHERE wave_story_execution_id = ?)").run(latestExecution!.id);
      asRunnableConnection(context.connection).prepare("DELETE FROM story_review_runs WHERE wave_story_execution_id = ?").run(latestExecution!.id);
      asRunnableConnection(context.connection)
        .prepare("UPDATE wave_story_executions SET status = 'running', completed_at = NULL, error_message = NULL WHERE id = ?")
        .run(latestExecution!.id);
      asRunnableConnection(context.connection)
        .prepare("UPDATE wave_executions SET status = 'running', completed_at = NULL WHERE id = ?")
        .run(latestWaveExecution!.id);

      const resumed = await context.workflowService.tickExecution(project.id);
      expect(resumed.executions[0]?.status).toBe("completed");
      expect(resumed.executions[0]?.phase).toBe("story_review");

      const shownAfter = context.workflowService.showExecution(project.id) as {
        waves: Array<{
          waveExecution: { status: string } | null;
          stories: Array<{
            latestExecution: { status: string } | null;
            latestBasicVerification: { status: string } | null;
            latestRalphVerification: { status: string } | null;
            latestAppVerificationRun: { status: string } | null;
            latestStoryReviewRun: { status: string } | null;
          }>;
        }>;
      };
      expect(shownAfter.waves[0]?.waveExecution?.status).toBe("completed");
      expect(shownAfter.waves[0]?.stories[0]?.latestExecution?.status).toBe("completed");
      expect(shownAfter.waves[0]?.stories[0]?.latestBasicVerification?.status).toBe("passed");
      expect(shownAfter.waves[0]?.stories[0]?.latestRalphVerification?.status).toBe("passed");
      expect(shownAfter.waves[0]?.stories[0]?.latestAppVerificationRun?.status).toBe("passed");
      expect(shownAfter.waves[0]?.stories[0]?.latestStoryReviewRun?.status).toBe("passed");
      context.connection.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("heals a failed wave execution before resuming a newer running story execution", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const context = createAppContext(dbPath);

    try {
      const item = createWorkspaceItem(context, {
        title: "Resume Under Failed Wave",
        description: "Recover a running story execution even if the parent wave is stale failed"
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
          waveExecution: { id: string } | null;
          stories: Array<{
            waveStory: { id: string };
            latestExecution: { id: string; outputSummaryJson: string | null } | null;
          }>;
        }>;
      };
      const latestExecution = shownBefore.waves[0]?.stories[0]?.latestExecution;
      const latestWaveExecution = shownBefore.waves[0]?.waveExecution;
      expect(latestExecution?.outputSummaryJson).toBeTruthy();
      expect(latestWaveExecution?.id).toBeTruthy();

      asRunnableConnection(context.connection).prepare("DELETE FROM verification_runs WHERE wave_story_execution_id = ?").run(latestExecution!.id);
      asRunnableConnection(context.connection).prepare("DELETE FROM app_verification_runs WHERE wave_story_execution_id = ?").run(latestExecution!.id);
      asRunnableConnection(context.connection).prepare("DELETE FROM story_review_agent_sessions WHERE story_review_run_id IN (SELECT id FROM story_review_runs WHERE wave_story_execution_id = ?)").run(latestExecution!.id);
      asRunnableConnection(context.connection).prepare("DELETE FROM story_review_findings WHERE story_review_run_id IN (SELECT id FROM story_review_runs WHERE wave_story_execution_id = ?)").run(latestExecution!.id);
      asRunnableConnection(context.connection).prepare("DELETE FROM story_review_runs WHERE wave_story_execution_id = ?").run(latestExecution!.id);
      asRunnableConnection(context.connection)
        .prepare("UPDATE wave_story_executions SET status = 'running', completed_at = NULL, error_message = NULL WHERE id = ?")
        .run(latestExecution!.id);
      asRunnableConnection(context.connection)
        .prepare("UPDATE wave_executions SET status = 'failed', completed_at = NULL WHERE id = ?")
        .run(latestWaveExecution!.id);

      const resumed = await context.workflowService.tickExecution(project.id);
      expect(resumed.blockedByFailure).toBe(false);
      expect(resumed.executions[0]?.status).toBe("completed");
      expect(resumed.executions[0]?.phase).toBe("story_review");

      const shownAfter = context.workflowService.showExecution(project.id) as {
        waves: Array<{
          waveExecution: { status: string } | null;
          stories: Array<{
            latestExecution: { status: string } | null;
            latestStoryReviewRun: { status: string } | null;
          }>;
        }>;
      };
      expect(shownAfter.waves[0]?.waveExecution?.status).toBe("completed");
      expect(shownAfter.waves[0]?.stories[0]?.latestExecution?.status).toBe("completed");
      expect(shownAfter.waves[0]?.stories[0]?.latestStoryReviewRun?.status).toBe("passed");
      context.connection.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects retrying a non-latest wave story execution attempt", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const originalScript = readFileSync(localAgentScriptPath, "utf8");
    const adapterScriptPath = join(root, "local-agent-ralph-review-required.mjs");
    const dbPath = join(root, "app.sqlite");

    try {
      const reviewScript = replaceRequired(
        originalScript,
        "      overallStatus: status,",
        '      overallStatus: "review_required",'
      );
      writeFileSync(adapterScriptPath, reviewScript);
      const context = createAppContext(dbPath, { adapterScriptPath });

      const item = createWorkspaceItem(context, {
        title: "Reject Stale Execution Retry",
        description: "Prevent retrying an older execution attempt after a newer one exists"
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
      expect(first.executions[0]?.phase).not.toBe("test_preparation");
      const firstExecutionId =
        first.executions[0] && first.executions[0].phase !== "test_preparation"
          ? first.executions[0].waveStoryExecutionId
          : null;
      expect(firstExecutionId).toBeTruthy();

      const second = await context.workflowService.retryWaveStoryExecution(firstExecutionId!);
      expect(second.phase).not.toBe("test_preparation");
      if (second.phase !== "test_preparation") {
        expect(second.waveStoryExecutionId).toBeTruthy();
        expect(second.waveStoryExecutionId).not.toBe(firstExecutionId);
      }

      await expect(context.workflowService.retryWaveStoryExecution(firstExecutionId!)).rejects.toMatchObject({
        code: "WAVE_STORY_EXECUTION_NOT_RETRYABLE",
        message: "Only the latest wave story execution attempt can be retried"
      } satisfies Partial<AppError>);
      context.connection.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("marks execution review_required when story review returns review_required", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const originalScript = readFileSync(localAgentScriptPath, "utf8");
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
      setExecutionDefaults(context, {
        implementationReview: {
          interactionMode: "assisted"
        }
      });

      const item = createWorkspaceItem(context, {
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

  it("does not block execution when story review returns passed with only advisory findings", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const originalScript = readFileSync(localAgentScriptPath, "utf8");
    const adapterScriptPath = join(root, "local-agent-story-review-advisory.mjs");
    const dbPath = join(root, "app.sqlite");

    try {
      const reviewScript = replaceRequired(
        originalScript,
        "function storyReview(payload) {\n  const findings = [];",
        `function storyReview(payload) {\n  const findings = [{
    severity: "low",
    category: "maintainability",
    title: "Advisory follow-up",
    description: "Non-blocking cleanup suggestion.",
    evidence: "Injected by the advisory review fixture.",
    filePath: "src/index.ts",
    line: 1,
    suggestedFix: "Optional cleanup."
  }];`
      );
      const advisoryScript = replaceRequired(
        reviewScript,
        "  const overallStatus = findings.some((finding) => finding.severity === \"critical\" || finding.severity === \"high\")\n    ? \"failed\"\n    : findings.length > 0\n      ? \"review_required\"\n      : \"passed\";",
        "  const overallStatus = \"passed\";"
      );
      writeFileSync(adapterScriptPath, advisoryScript);
      const context = createAppContext(dbPath, { adapterScriptPath });

      const item = createWorkspaceItem(context, {
        title: "Story Review Advisory",
        description: "Advisory findings should not block execution"
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
      expect(first.executions[0]?.status).toBe("completed");
      expect(first.executions[0]?.phase).toBe("story_review");

      const shown = context.workflowService.showExecution(project.id) as {
        waves: Array<{
          waveExecution: { status: string } | null;
          stories: Array<{
            latestExecution: { status: string } | null;
            latestStoryReviewRun: { status: string; summaryJson: string | null } | null;
          }>;
        }>;
      };
      expect(shown.waves[0]?.waveExecution?.status).toBe("completed");
      expect(shown.waves[0]?.stories[0]?.latestExecution?.status).toBe("completed");
      expect(shown.waves[0]?.stories[0]?.latestStoryReviewRun?.status).toBe("passed");
      expect(shown.waves[0]?.stories[0]?.latestStoryReviewRun?.summaryJson).toContain("\"overallStatus\": \"passed\"");
      context.connection.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("runs story-review remediation and records applied git metadata in a clean workspace", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const originalScript = readFileSync(localAgentScriptPath, "utf8");
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
      setExecutionDefaults(context, {
        implementationReview: {
          interactionMode: "assisted"
        }
      });

      const item = createWorkspaceItem(context, {
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
      expect(remediationShow.latestRemediationRun?.gitMetadataJson).toContain('"mergedIntoRef": "story/');
      expect(remediationShow.openFindings).toHaveLength(0);
      expect(execFileSync("git", ["branch", "--list", "story/*"], { cwd: workspaceRoot, encoding: "utf8" }).trim()).toBe("");
      expect(execFileSync("git", ["branch", "--list", "fix/*"], { cwd: workspaceRoot, encoding: "utf8" }).trim()).toBe("");
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
      const item = createWorkspaceItem(context, {
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
    const originalScript = readFileSync(localAgentScriptPath, "utf8");
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

      const item = createWorkspaceItem(context, {
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
    const originalScript = readFileSync(localAgentScriptPath, "utf8");
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

      const item = createWorkspaceItem(context, {
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
      const project = context.repositories.projectRepository.listByItemId(item.id)[0]!;
      const firstStory = context.repositories.userStoryRepository.listByProjectId(project.id)[0]!;
      const remediationRuns = context.repositories.storyReviewRemediationRunRepository.listByStoryId(firstStory.id);
      expect(remediationRuns.length).toBeGreaterThan(0);
      expect(context.repositories.itemRepository.getById(item.id)?.currentColumn).toBe("done");

      context.connection.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("marks execution failed when story review returns failed", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const originalScript = readFileSync(localAgentScriptPath, "utf8");
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

      const item = createWorkspaceItem(context, {
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
    const originalScript = readFileSync(localAgentScriptPath, "utf8");
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
      const item = createWorkspaceItem(context, {
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
    const originalScript = readFileSync(localAgentScriptPath, "utf8");
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

  it("rejects access to items from another workspace", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-run-"));
    const dbPath = join(root, "app.sqlite");
    const defaultContext = createAppContext(dbPath);

    try {
      const secondWorkspace = defaultContext.repositories.workspaceRepository.create({
        key: "secondary",
        name: "Secondary Workspace",
        description: null,
        rootPath: null
      });
      defaultContext.repositories.workspaceSettingsRepository.create({
        workspaceId: secondWorkspace.id,
        defaultAdapterKey: null,
        defaultModel: null,
        runtimeProfileJson: null,
        autorunPolicyJson: null,
        promptOverridesJson: null,
        skillOverridesJson: null,
        verificationDefaultsJson: null,
        qaDefaultsJson: null,
        gitDefaultsJson: null,
        executionDefaultsJson: null,
        appTestConfigJson: null,
        uiMetadataJson: null
      });

      const foreignContext = createAppContext(dbPath, { workspaceKey: "secondary" });
      const item = defaultContext.repositories.itemRepository.create({
        workspaceId: defaultContext.workspace.id,
        title: "Scoped Item",
        description: "Visible only in default"
      });

      await expect(foreignContext.workflowService.startStage({ stageKey: "brainstorm", itemId: item.id })).rejects.toMatchObject({
        code: "ITEM_NOT_FOUND"
      } satisfies Partial<AppError>);

      foreignContext.connection.close();
    } finally {
      defaultContext.connection.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
