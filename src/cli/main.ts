import { Command, Option } from "commander";
import { resolve } from "node:path";

import { createAppContext, type AppContext } from "../app-context.js";
import { interactiveReviewEntryStatuses, interactiveReviewResolutionTypes, interactiveReviewSeverities } from "../domain/types.js";
import { AppError } from "../shared/errors.js";

const program = new Command();
program.name("beerengineer");
program.option("--db <path>", "SQLite database path", "./var/data/beerengineer.sqlite");
program.option("--adapter-script-path <path>", "Override the local adapter script used for bounded agent runs");
program.option("--workspace <key>", "Select the active workspace", "default");
program.option("--workspace-root <path>", "Override the workspace root used for git workflow operations");
program.showHelpAfterError();

function collectOptionValues(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function withContext<TOptions extends object>(
  handler: (context: AppContext, options: TOptions, dbPath: string) => Promise<void> | void
) {
  return async (options: TOptions) => {
    const programOptions = program.opts<{
      db: string;
      adapterScriptPath?: string;
      workspace: string;
      workspaceRoot?: string;
    }>();
    const dbPath = resolve(programOptions.db);
    let context: AppContext | null = null;
    try {
      context = createAppContext(dbPath, {
        adapterScriptPath: programOptions.adapterScriptPath ? resolve(programOptions.adapterScriptPath) : undefined,
        workspaceKey: programOptions.workspace,
        workspaceRoot: programOptions.workspaceRoot ? resolve(programOptions.workspaceRoot) : undefined
      });
      await handler(context, options, dbPath);
    } finally {
      context?.connection.close();
    }
  };
}

async function printAutorunForItem(
  context: AppContext,
  input: {
    itemId: string;
    trigger: string;
    initialSteps: Array<{ action: string; scopeType: "item" | "project" | "run" | "execution" | "remediation" | "qa" | "documentation"; scopeId: string; status: string }>;
  }
): Promise<void> {
  const result = await context.workflowService.autorunForItem(input);
  console.log(JSON.stringify(result, null, 2));
}

async function printAutorunForProject(
  context: AppContext,
  input: {
    projectId: string;
    trigger: string;
    initialSteps: Array<{ action: string; scopeType: "item" | "project" | "run" | "execution" | "remediation" | "qa" | "documentation"; scopeId: string; status: string }>;
  }
): Promise<void> {
  const result = await context.workflowService.autorunForProject(input);
  console.log(JSON.stringify(result, null, 2));
}

program
  .command("workspace:list")
  .action(
    withContext<Record<string, never>>(({ repositories }) => {
      console.log(JSON.stringify(repositories.workspaceRepository.listAll(), null, 2));
    })
  );

program
  .command("workspace:create")
  .requiredOption("--key <key>")
  .requiredOption("--name <name>")
  .option("--description <description>")
  .option("--root-path <rootPath>")
  .action(
    withContext<{ key: string; name: string; description?: string; rootPath?: string }>(({ repositories, runInTransaction }, options) => {
      const workspace = runInTransaction(() => {
        const createdWorkspace = repositories.workspaceRepository.create({
          key: options.key,
          name: options.name,
          description: options.description ?? null,
          rootPath: options.rootPath ? resolve(options.rootPath) : null
        });
        repositories.workspaceSettingsRepository.create({
          workspaceId: createdWorkspace.id,
          defaultAdapterKey: null,
          defaultModel: null,
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
        return createdWorkspace;
      });
      console.log(JSON.stringify(workspace, null, 2));
    })
  );

program
  .command("workspace:show")
  .option("--workspace-key <key>")
  .action(
    withContext<{ workspaceKey?: string }>(({ repositories, workspace }, options) => {
      const resolvedWorkspace = options.workspaceKey ? repositories.workspaceRepository.getByKey(options.workspaceKey) : workspace;
      if (!resolvedWorkspace) {
        throw new AppError("WORKSPACE_NOT_FOUND", `Workspace ${options.workspaceKey} not found`);
      }
      const settings = repositories.workspaceSettingsRepository.getByWorkspaceId(resolvedWorkspace.id);
      console.log(JSON.stringify({ workspace: resolvedWorkspace, settings }, null, 2));
    })
  );

program
  .command("workspace:update-root")
  .requiredOption("--workspace <key>")
  .requiredOption("--root-path <rootPath>")
  .action(
    withContext<{ workspace: string; rootPath: string }>(({ repositories }, options) => {
      const workspace = repositories.workspaceRepository.getByKey(options.workspace);
      if (!workspace) {
        throw new AppError("WORKSPACE_NOT_FOUND", `Workspace ${options.workspace} not found`);
      }
      const updated = repositories.workspaceRepository.update({
        id: workspace.id,
        rootPath: resolve(options.rootPath)
      });
      console.log(JSON.stringify(updated, null, 2));
    })
  );

program
  .command("item:create")
  .requiredOption("--title <title>")
  .option("--description <description>", "", "")
  .action(
    withContext<{ title: string; description: string }>(({ repositories, workspace }, options) => {
      const item = repositories.itemRepository.create({
        workspaceId: workspace.id,
        title: options.title,
        description: options.description
      });
      console.log(JSON.stringify(item, null, 2));
    })
  );

program
  .command("brainstorm:start")
  .requiredOption("--item-id <itemId>")
  .action(
    withContext<{ itemId: string }>(async ({ workflowService }, options) => {
      const result = await workflowService.startStage({
        stageKey: "brainstorm",
        itemId: options.itemId
      });
      console.log(JSON.stringify(result, null, 2));
    })
  );

program
  .command("brainstorm:show")
  .requiredOption("--item-id <itemId>")
  .action(
    withContext<{ itemId: string }>(({ workflowService }, options) => {
      console.log(JSON.stringify(workflowService.showBrainstormSession(options.itemId), null, 2));
    })
  );

program
  .command("brainstorm:chat")
  .requiredOption("--session-id <sessionId>")
  .requiredOption("--message <message>")
  .action(
    withContext<{ sessionId: string; message: string }>(async ({ workflowService }, options) => {
      console.log(JSON.stringify(await workflowService.chatBrainstorm(options.sessionId, options.message), null, 2));
    })
  );

program
  .command("brainstorm:draft")
  .requiredOption("--session-id <sessionId>")
  .action(
    withContext<{ sessionId: string }>(({ workflowService }, options) => {
      console.log(JSON.stringify(workflowService.showBrainstormDraft(options.sessionId), null, 2));
    })
  );

program
  .command("brainstorm:draft:update")
  .requiredOption("--session-id <sessionId>")
  .option("--problem <problem>")
  .option("--core-outcome <coreOutcome>")
  .option("--target-user <value>", "Repeatable target user", collectOptionValues, [])
  .option("--use-case <value>", "Repeatable use case", collectOptionValues, [])
  .option("--constraint <value>", "Repeatable constraint", collectOptionValues, [])
  .option("--non-goal <value>", "Repeatable non-goal", collectOptionValues, [])
  .option("--risk <value>", "Repeatable risk", collectOptionValues, [])
  .option("--open-question <value>", "Repeatable open question", collectOptionValues, [])
  .option("--candidate-direction <value>", "Repeatable candidate direction", collectOptionValues, [])
  .option("--assumption <value>", "Repeatable assumption", collectOptionValues, [])
  .option("--recommended-direction <value>")
  .option("--scope-notes <value>")
  .option("--clear-target-users", "Clear target users before writing")
  .option("--clear-use-cases", "Clear use cases before writing")
  .option("--clear-constraints", "Clear constraints before writing")
  .option("--clear-non-goals", "Clear non-goals before writing")
  .option("--clear-risks", "Clear risks before writing")
  .option("--clear-open-questions", "Clear open questions before writing")
  .option("--clear-candidate-directions", "Clear candidate directions before writing")
  .option("--clear-assumptions", "Clear assumptions before writing")
  .option("--clear-recommended-direction", "Clear the recommended direction")
  .option("--clear-scope-notes", "Clear scope notes")
  .action(
    withContext<{
      sessionId: string;
      problem?: string;
      coreOutcome?: string;
      targetUser: string[];
      useCase: string[];
      constraint: string[];
      nonGoal: string[];
      risk: string[];
      openQuestion: string[];
      candidateDirection: string[];
      assumption: string[];
      recommendedDirection?: string;
      scopeNotes?: string;
      clearTargetUsers?: boolean;
      clearUseCases?: boolean;
      clearConstraints?: boolean;
      clearNonGoals?: boolean;
      clearRisks?: boolean;
      clearOpenQuestions?: boolean;
      clearCandidateDirections?: boolean;
      clearAssumptions?: boolean;
      clearRecommendedDirection?: boolean;
      clearScopeNotes?: boolean;
    }>(({ workflowService }, options) => {
      const resolveList = (values: string[], clear?: boolean): string[] | undefined =>
        values.length > 0 ? values : clear ? [] : undefined;
      console.log(
        JSON.stringify(
          workflowService.updateBrainstormDraft({
            sessionId: options.sessionId,
            problem: options.problem,
            coreOutcome: options.coreOutcome,
            targetUsers: resolveList(options.targetUser, options.clearTargetUsers),
            useCases: resolveList(options.useCase, options.clearUseCases),
            constraints: resolveList(options.constraint, options.clearConstraints),
            nonGoals: resolveList(options.nonGoal, options.clearNonGoals),
            risks: resolveList(options.risk, options.clearRisks),
            openQuestions: resolveList(options.openQuestion, options.clearOpenQuestions),
            candidateDirections: resolveList(options.candidateDirection, options.clearCandidateDirections),
            assumptions: resolveList(options.assumption, options.clearAssumptions),
            recommendedDirection: options.clearRecommendedDirection ? null : options.recommendedDirection,
            scopeNotes: options.clearScopeNotes ? null : options.scopeNotes
          }),
          null,
          2
        )
      );
    })
  );

program
  .command("brainstorm:promote")
  .requiredOption("--session-id <sessionId>")
  .option("--autorun", "Approve concept and continue automatically after promotion")
  .action(
    withContext<{ sessionId: string; autorun?: boolean }>(async ({ workflowService }, options) => {
      console.log(JSON.stringify(await workflowService.promoteBrainstorm(options.sessionId, { autorun: options.autorun }), null, 2));
    })
  );

program
  .command("concept:approve")
  .requiredOption("--concept-id <conceptId>")
  .option("--autorun", "Continue automatically after approval")
  .action(
    withContext<{ conceptId: string; autorun?: boolean }>(async (context, options) => {
      const concept = context.repositories.conceptRepository.getById(options.conceptId);
      if (!concept) {
        throw new AppError("CONCEPT_NOT_FOUND", `Concept ${options.conceptId} not found`);
      }
      context.workflowService.approveConcept(options.conceptId);
      if (options.autorun) {
        await printAutorunForItem(context, {
          itemId: concept.itemId,
          trigger: "concept:approve",
          initialSteps: [{ action: "concept:approve", scopeType: "item", scopeId: concept.itemId, status: "approved" }]
        });
        return;
      }
      console.log(JSON.stringify({ status: "approved", conceptId: options.conceptId }, null, 2));
    })
  );

program
  .command("project:import")
  .requiredOption("--item-id <itemId>")
  .action(
    withContext<{ itemId: string }>(({ workflowService }, options) => {
      const result = workflowService.importProjects(options.itemId);
      console.log(JSON.stringify(result, null, 2));
    })
  );

program
  .command("requirements:start")
  .requiredOption("--item-id <itemId>")
  .requiredOption("--project-id <projectId>")
  .action(
    withContext<{ itemId: string; projectId: string }>(async ({ workflowService }, options) => {
      const result = await workflowService.startStage({
        stageKey: "requirements",
        itemId: options.itemId,
        projectId: options.projectId
      });
      console.log(JSON.stringify(result, null, 2));
    })
  );

program
  .command("stories:approve")
  .requiredOption("--project-id <projectId>")
  .option("--autorun", "Continue automatically after approval")
  .action(
    withContext<{ projectId: string; autorun?: boolean }>(async (context, options) => {
      context.workflowService.approveStories(options.projectId);
      if (options.autorun) {
        await printAutorunForProject(context, {
          projectId: options.projectId,
          trigger: "stories:approve",
          initialSteps: [{ action: "stories:approve", scopeType: "project", scopeId: options.projectId, status: "approved" }]
        });
        return;
      }
      console.log(JSON.stringify({ status: "approved", projectId: options.projectId }, null, 2));
    })
  );

program
  .command("review:start")
  .requiredOption("--type <type>")
  .option("--project-id <projectId>")
  .action(
    withContext<{ type: string; projectId?: string }>(({ workflowService }, options) => {
      if (options.type !== "stories" || !options.projectId) {
        throw new AppError("INTERACTIVE_REVIEW_INVALID_INPUT", "Currently only --type stories --project-id <id> is supported");
      }
      console.log(JSON.stringify(workflowService.startInteractiveReview({ type: "stories", projectId: options.projectId }), null, 2));
    })
  );

program
  .command("review:show")
  .requiredOption("--session-id <sessionId>")
  .action(
    withContext<{ sessionId: string }>(({ workflowService }, options) => {
      console.log(JSON.stringify(workflowService.showInteractiveReview(options.sessionId), null, 2));
    })
  );

program
  .command("review:chat")
  .requiredOption("--session-id <sessionId>")
  .requiredOption("--message <message>")
  .action(
    withContext<{ sessionId: string; message: string }>(async ({ workflowService }, options) => {
      console.log(JSON.stringify(await workflowService.chatInteractiveReview(options.sessionId, options.message), null, 2));
    })
  );

program
  .command("review:entry:update")
  .requiredOption("--session-id <sessionId>")
  .requiredOption("--story-id <storyId>")
  .addOption(new Option("--status <status>", "Review entry status").choices([...interactiveReviewEntryStatuses]).makeOptionMandatory())
  .option("--summary <summary>")
  .option("--change-request <changeRequest>")
  .option("--rationale <rationale>")
  .addOption(new Option("--severity <severity>").choices([...interactiveReviewSeverities]))
  .action(
    withContext<{
      sessionId: string;
      storyId: string;
      status: "pending" | "accepted" | "needs_revision" | "rejected" | "resolved";
      summary?: string;
      changeRequest?: string;
      rationale?: string;
      severity?: "critical" | "high" | "medium" | "low";
    }>(({ workflowService }, options) => {
      console.log(JSON.stringify(workflowService.updateInteractiveReviewEntry(options), null, 2));
    })
  );

program
  .command("review:story:edit")
  .requiredOption("--session-id <sessionId>")
  .requiredOption("--story-id <storyId>")
  .option("--title <title>")
  .option("--description <description>")
  .option("--actor <actor>")
  .option("--goal <goal>")
  .option("--benefit <benefit>")
  .option("--priority <priority>")
  .option("--acceptance-criterion <text>", "Repeatable acceptance criterion", collectOptionValues, [])
  .option("--summary <summary>")
  .option("--rationale <rationale>")
  .addOption(new Option("--status <status>").choices(["resolved", "accepted", "needs_revision"]))
  .action(
    withContext<{
      sessionId: string;
      storyId: string;
      title?: string;
      description?: string;
      actor?: string;
      goal?: string;
      benefit?: string;
      priority?: string;
      acceptanceCriterion: string[];
      summary?: string;
      rationale?: string;
      status?: "resolved" | "accepted" | "needs_revision";
    }>(({ workflowService }, options) => {
      console.log(
        JSON.stringify(
          workflowService.applyInteractiveReviewStoryEdits({
            sessionId: options.sessionId,
            storyId: options.storyId,
            title: options.title,
            description: options.description,
            actor: options.actor,
            goal: options.goal,
            benefit: options.benefit,
            priority: options.priority,
            acceptanceCriteria: options.acceptanceCriterion.length > 0 ? options.acceptanceCriterion : undefined,
            summary: options.summary,
            rationale: options.rationale,
            status: options.status
          }),
          null,
          2
        )
      );
    })
  );

program
  .command("review:resolve")
  .requiredOption("--session-id <sessionId>")
  .addOption(
    new Option("--action <action>", "Review resolution action")
      .choices([
        "approve",
        "approve_and_autorun",
        "approve_all",
        "approve_all_and_autorun",
        "approve_selected",
        "request_changes",
        "request_story_revisions",
        "apply_story_edits"
      ] satisfies Array<(typeof interactiveReviewResolutionTypes)[number]>)
      .makeOptionMandatory()
  )
  .option("--story-id <storyId>", "Repeatable story target", collectOptionValues, [])
  .option("--rationale <rationale>")
  .action(
    withContext<{
      sessionId: string;
      action:
        | "approve"
        | "approve_and_autorun"
        | "approve_all"
        | "approve_all_and_autorun"
        | "approve_selected"
        | "request_changes"
        | "request_story_revisions"
        | "apply_story_edits";
      storyId: string[];
      rationale?: string;
    }>(async ({ workflowService }, options) => {
      console.log(
        JSON.stringify(
          await workflowService.resolveInteractiveReview({
            sessionId: options.sessionId,
            action: options.action,
            storyIds: options.storyId.length > 0 ? options.storyId : undefined,
            rationale: options.rationale
          }),
          null,
          2
        )
      );
    })
  );

program
  .command("architecture:start")
  .requiredOption("--item-id <itemId>")
  .requiredOption("--project-id <projectId>")
  .action(
    withContext<{ itemId: string; projectId: string }>(async ({ workflowService }, options) => {
      const result = await workflowService.startStage({
        stageKey: "architecture",
        itemId: options.itemId,
        projectId: options.projectId
      });
      console.log(JSON.stringify(result, null, 2));
    })
  );

program
  .command("architecture:approve")
  .requiredOption("--project-id <projectId>")
  .option("--autorun", "Continue automatically after approval")
  .action(
    withContext<{ projectId: string; autorun?: boolean }>(async (context, options) => {
      context.workflowService.approveArchitecture(options.projectId);
      if (options.autorun) {
        await printAutorunForProject(context, {
          projectId: options.projectId,
          trigger: "architecture:approve",
          initialSteps: [
            { action: "architecture:approve", scopeType: "project", scopeId: options.projectId, status: "approved" }
          ]
        });
        return;
      }
      console.log(JSON.stringify({ status: "approved", projectId: options.projectId }, null, 2));
    })
  );

program
  .command("planning:start")
  .requiredOption("--item-id <itemId>")
  .requiredOption("--project-id <projectId>")
  .action(
    withContext<{ itemId: string; projectId: string }>(async ({ workflowService }, options) => {
      const result = await workflowService.startStage({
        stageKey: "planning",
        itemId: options.itemId,
        projectId: options.projectId
      });
      console.log(JSON.stringify(result, null, 2));
    })
  );

program
  .command("planning:approve")
  .requiredOption("--project-id <projectId>")
  .option("--autorun", "Continue automatically after approval")
  .action(
    withContext<{ projectId: string; autorun?: boolean }>(async (context, options) => {
      context.workflowService.approvePlanning(options.projectId);
      if (options.autorun) {
        await printAutorunForProject(context, {
          projectId: options.projectId,
          trigger: "planning:approve",
          initialSteps: [{ action: "planning:approve", scopeType: "project", scopeId: options.projectId, status: "approved" }]
        });
        return;
      }
      console.log(JSON.stringify({ status: "approved", projectId: options.projectId }, null, 2));
    })
  );

program
  .command("execution:start")
  .requiredOption("--project-id <projectId>")
  .action(
    withContext<{ projectId: string }>(async ({ workflowService }, options) => {
      const result = await workflowService.startExecution(options.projectId);
      console.log(JSON.stringify(result, null, 2));
    })
  );

program
  .command("execution:tick")
  .requiredOption("--project-id <projectId>")
  .action(
    withContext<{ projectId: string }>(async ({ workflowService }, options) => {
      const result = await workflowService.tickExecution(options.projectId);
      console.log(JSON.stringify(result, null, 2));
    })
  );

program
  .command("execution:show")
  .requiredOption("--project-id <projectId>")
  .action(
    withContext<{ projectId: string }>(({ workflowService }, options) => {
      const result = workflowService.showExecution(options.projectId);
      console.log(JSON.stringify(result, null, 2));
    })
  );

program
  .command("execution:retry")
  .requiredOption("--wave-story-execution-id <waveStoryExecutionId>")
  .option("--autorun", "Continue automatically after retry")
  .action(
    withContext<{ waveStoryExecutionId: string; autorun?: boolean }>(async (context, options) => {
      const previousExecution = context.repositories.waveStoryExecutionRepository.getById(options.waveStoryExecutionId);
      if (!previousExecution) {
        throw new AppError(
          "WAVE_STORY_EXECUTION_NOT_FOUND",
          `Wave story execution ${options.waveStoryExecutionId} not found`
        );
      }
      const story = context.repositories.userStoryRepository.getById(previousExecution.storyId);
      if (!story) {
        throw new AppError("STORY_NOT_FOUND", `Story ${previousExecution.storyId} not found`);
      }
      const result = await context.workflowService.retryWaveStoryExecution(options.waveStoryExecutionId);
      if (options.autorun) {
        const initialStep =
          result.phase === "test_preparation"
            ? {
                action: "execution:retry",
                scopeType: "project" as const,
                scopeId: story.projectId,
                status: String(result.status)
              }
            : {
                action: "execution:retry",
                scopeType: "execution" as const,
                scopeId: result.waveStoryExecutionId,
                status: String(result.status)
              };
        await printAutorunForProject(context, {
          projectId: story.projectId,
          trigger: "execution:retry",
          initialSteps: [initialStep]
        });
        return;
      }
      console.log(JSON.stringify(result, null, 2));
    })
  );

program
  .command("app-verification:start")
  .requiredOption("--wave-story-execution-id <waveStoryExecutionId>")
  .action(
    withContext<{ waveStoryExecutionId: string }>(async ({ workflowService }, options) => {
      const result = await workflowService.startAppVerification(options.waveStoryExecutionId);
      console.log(JSON.stringify(result, null, 2));
    })
  );

program
  .command("app-verification:show")
  .requiredOption("--app-verification-run-id <appVerificationRunId>")
  .action(
    withContext<{ appVerificationRunId: string }>(({ workflowService }, options) => {
      const result = workflowService.showAppVerification(options.appVerificationRunId);
      console.log(JSON.stringify(result, null, 2));
    })
  );

program
  .command("app-verification:retry")
  .requiredOption("--app-verification-run-id <appVerificationRunId>")
  .action(
    withContext<{ appVerificationRunId: string }>(async ({ workflowService }, options) => {
      const result = await workflowService.retryAppVerification(options.appVerificationRunId);
      console.log(JSON.stringify(result, null, 2));
    })
  );

program
  .command("remediation:story-review:start")
  .requiredOption("--story-review-run-id <storyReviewRunId>")
  .action(
    withContext<{ storyReviewRunId: string }>(async ({ workflowService }, options) => {
      const result = await workflowService.startStoryReviewRemediation(options.storyReviewRunId);
      console.log(JSON.stringify(result, null, 2));
    })
  );

program
  .command("remediation:story-review:show")
  .requiredOption("--story-id <storyId>")
  .action(
    withContext<{ storyId: string }>(({ workflowService }, options) => {
      const result = workflowService.showStoryReviewRemediation(options.storyId);
      console.log(JSON.stringify(result, null, 2));
    })
  );

program
  .command("remediation:story-review:retry")
  .requiredOption("--remediation-run-id <remediationRunId>")
  .option("--autorun", "Continue automatically after retry")
  .action(
    withContext<{ remediationRunId: string; autorun?: boolean }>(async (context, options) => {
      const remediationRun = context.repositories.storyReviewRemediationRunRepository.getById(options.remediationRunId);
      if (!remediationRun) {
        throw new AppError(
          "STORY_REVIEW_REMEDIATION_RUN_NOT_FOUND",
          `Story review remediation run ${options.remediationRunId} not found`
        );
      }
      const story = context.repositories.userStoryRepository.getById(remediationRun.storyId);
      if (!story) {
        throw new AppError("STORY_NOT_FOUND", `Story ${remediationRun.storyId} not found`);
      }
      const result = await context.workflowService.retryStoryReviewRemediation(options.remediationRunId);
      if (options.autorun) {
        await printAutorunForProject(context, {
          projectId: story.projectId,
          trigger: "remediation:story-review:retry",
          initialSteps: [
            {
              action: "remediation:story-review:retry",
              scopeType: "remediation",
              scopeId: String(result.storyReviewRemediationRunId),
              status: String(result.status)
            }
          ]
        });
        return;
      }
      console.log(JSON.stringify(result, null, 2));
    })
  );

program
  .command("qa:start")
  .requiredOption("--project-id <projectId>")
  .action(
    withContext<{ projectId: string }>(async ({ workflowService }, options) => {
      const result = await workflowService.startQa(options.projectId);
      console.log(JSON.stringify(result, null, 2));
    })
  );

program
  .command("qa:show")
  .requiredOption("--project-id <projectId>")
  .action(
    withContext<{ projectId: string }>(({ workflowService }, options) => {
      const result = workflowService.showQa(options.projectId);
      console.log(JSON.stringify(result, null, 2));
    })
  );

program
  .command("qa:retry")
  .requiredOption("--qa-run-id <qaRunId>")
  .option("--autorun", "Continue automatically after retry")
  .action(
    withContext<{ qaRunId: string; autorun?: boolean }>(async (context, options) => {
      const result = await context.workflowService.retryQa(options.qaRunId);
      if (options.autorun) {
        await printAutorunForProject(context, {
          projectId: String(result.projectId),
          trigger: "qa:retry",
          initialSteps: [{ action: "qa:retry", scopeType: "qa", scopeId: String(result.qaRunId), status: String(result.status) }]
        });
        return;
      }
      console.log(JSON.stringify(result, null, 2));
    })
  );

program
  .command("documentation:start")
  .requiredOption("--project-id <projectId>")
  .action(
    withContext<{ projectId: string }>(async ({ workflowService }, options) => {
      const result = await workflowService.startDocumentation(options.projectId);
      console.log(JSON.stringify(result, null, 2));
    })
  );

program
  .command("documentation:show")
  .requiredOption("--project-id <projectId>")
  .action(
    withContext<{ projectId: string }>(({ workflowService }, options) => {
      const result = workflowService.showDocumentation(options.projectId);
      console.log(JSON.stringify(result, null, 2));
    })
  );

program
  .command("documentation:retry")
  .requiredOption("--documentation-run-id <documentationRunId>")
  .option("--autorun", "Continue automatically after retry")
  .action(
    withContext<{ documentationRunId: string; autorun?: boolean }>(async (context, options) => {
      const result = await context.workflowService.retryDocumentation(options.documentationRunId);
      if (options.autorun) {
        await printAutorunForProject(context, {
          projectId: String(result.projectId),
          trigger: "documentation:retry",
          initialSteps: [
            {
              action: "documentation:retry",
              scopeType: "documentation",
              scopeId: String(result.documentationRunId),
              status: String(result.status)
            }
          ]
        });
        return;
      }
      console.log(JSON.stringify(result, null, 2));
    })
  );

program
  .command("item:show")
  .requiredOption("--item-id <itemId>")
  .action(
    withContext<{ itemId: string }>(({ workflowService }, options) => {
      console.log(JSON.stringify(workflowService.showItem(options.itemId), null, 2));
    })
  );

program
  .command("runs:list")
  .option("--item-id <itemId>")
  .option("--project-id <projectId>")
  .action(
    withContext<{ itemId?: string; projectId?: string }>(({ workflowService }, options) => {
      const runs = workflowService.listRuns(options);
      console.log(JSON.stringify(runs, null, 2));
    })
  );

program
  .command("run:show")
  .requiredOption("--run-id <runId>")
  .action(
    withContext<{ runId: string }>(({ workflowService }, options) => {
      const payload = workflowService.showRun(options.runId);
      console.log(JSON.stringify(payload, null, 2));
    })
  );

program
  .command("run:retry")
  .requiredOption("--run-id <runId>")
  .option("--autorun", "Continue automatically after retry")
  .action(
    withContext<{ runId: string; autorun?: boolean }>(async (context, options) => {
      const previousRun = context.repositories.stageRunRepository.getById(options.runId);
      if (!previousRun) {
        throw new AppError("RUN_NOT_FOUND", `Stage run ${options.runId} not found`);
      }
      const result = await context.workflowService.retryRun(options.runId);
      if (options.autorun) {
        if (previousRun.projectId) {
          await printAutorunForProject(context, {
            projectId: previousRun.projectId,
            trigger: "run:retry",
            initialSteps: [{ action: "run:retry", scopeType: "run", scopeId: String(result.runId), status: String(result.status) }]
          });
          return;
        }
        await printAutorunForItem(context, {
          itemId: previousRun.itemId,
          trigger: "run:retry",
          initialSteps: [{ action: "run:retry", scopeType: "run", scopeId: String(result.runId), status: String(result.status) }]
        });
        return;
      }
      console.log(JSON.stringify(result, null, 2));
    })
  );

program
  .command("autorun:start")
  .requiredOption("--item-id <itemId>")
  .action(
    withContext<{ itemId: string }>(async (context, options) => {
      await printAutorunForItem(context, {
        itemId: options.itemId,
        trigger: "autorun:start",
        initialSteps: []
      });
    })
  );

program
  .command("autorun:resume")
  .requiredOption("--project-id <projectId>")
  .action(
    withContext<{ projectId: string }>(async (context, options) => {
      await printAutorunForProject(context, {
        projectId: options.projectId,
        trigger: "autorun:resume",
        initialSteps: []
      });
    })
  );

program
  .command("artifacts:list")
  .option("--run-id <runId>")
  .option("--item-id <itemId>")
  .action(
    withContext<{ runId?: string; itemId?: string }>(({ workflowService }, options) => {
      const artifacts = workflowService.listArtifacts(options);
      console.log(JSON.stringify(artifacts, null, 2));
    })
  );

program
  .command("sessions:list")
  .requiredOption("--run-id <runId>")
  .action(
    withContext<{ runId: string }>(({ workflowService }, options) => {
      const sessions = workflowService.listSessions(options.runId);
      console.log(JSON.stringify(sessions, null, 2));
    })
  );
program.parseAsync(process.argv).catch((error: unknown) => {
  const payload =
    error instanceof AppError
      ? {
          error: {
            code: error.code,
            message: error.message
          }
        }
      : {
          error: {
            code: "UNEXPECTED_ERROR",
            message: error instanceof Error ? error.message : String(error)
          }
        };
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 1;
});
