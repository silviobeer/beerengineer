import { Command } from "commander";
import { resolve } from "node:path";

import { createAppContext, type AppContext } from "../app-context.js";
import { AppError } from "../shared/errors.js";

const program = new Command();
program.name("beerengineer");
program.option("--db <path>", "SQLite database path", "./var/data/beerengineer.sqlite");
program.option("--adapter-script-path <path>", "Override the local adapter script used for bounded agent runs");
program.option("--workspace-root <path>", "Override the workspace root used for git workflow operations");
program.showHelpAfterError();

function withContext<TOptions extends object>(
  handler: (context: AppContext, options: TOptions, dbPath: string) => Promise<void> | void
) {
  return async (options: TOptions) => {
    const programOptions = program.opts<{
      db: string;
      adapterScriptPath?: string;
      workspaceRoot?: string;
    }>();
    const dbPath = resolve(programOptions.db);
    const context = createAppContext(dbPath, {
      adapterScriptPath: programOptions.adapterScriptPath ? resolve(programOptions.adapterScriptPath) : undefined,
      workspaceRoot: programOptions.workspaceRoot ? resolve(programOptions.workspaceRoot) : undefined
    });
    try {
      await handler(context, options, dbPath);
    } finally {
      context.connection.close();
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
  .command("item:create")
  .requiredOption("--title <title>")
  .option("--description <description>", "", "")
  .action(
    withContext<{ title: string; description: string }>(({ repositories }, options) => {
      const item = repositories.itemRepository.create({
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
        await printAutorunForProject(context, {
          projectId: story.projectId,
          trigger: "execution:retry",
          initialSteps: [
            {
              action: "execution:retry",
              scopeType: "waveStoryExecutionId" in result ? "execution" : "project",
              scopeId: "waveStoryExecutionId" in result ? String(result.waveStoryExecutionId) : story.projectId,
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
