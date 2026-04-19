import { Command } from "commander";
import { resolve } from "node:path";

import { createAppContext, type AppContext } from "../app-context.js";
import { AppError } from "../shared/errors.js";

const program = new Command();
program.name("beerengineer");
program.option("--db <path>", "SQLite database path", "./var/data/beerengineer.sqlite");
program.showHelpAfterError();

function withContext<TOptions extends object>(
  handler: (context: AppContext, options: TOptions, dbPath: string) => Promise<void> | void
) {
  return async (options: TOptions) => {
    const dbPath = resolve(program.opts<{ db: string }>().db);
    const context = createAppContext(dbPath);
    try {
      await handler(context, options, dbPath);
    } finally {
      context.connection.close();
    }
  };
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
  .action(
    withContext<{ conceptId: string }>(({ workflowService }, options) => {
      workflowService.approveConcept(options.conceptId);
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
  .action(
    withContext<{ projectId: string }>(({ workflowService }, options) => {
      workflowService.approveStories(options.projectId);
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
  .action(
    withContext<{ projectId: string }>(({ workflowService }, options) => {
      workflowService.approveArchitecture(options.projectId);
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
  .action(
    withContext<{ projectId: string }>(({ workflowService }, options) => {
      workflowService.approvePlanning(options.projectId);
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
  .action(
    withContext<{ waveStoryExecutionId: string }>(async ({ workflowService }, options) => {
      const result = await workflowService.retryWaveStoryExecution(options.waveStoryExecutionId);
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
  .action(
    withContext<{ remediationRunId: string }>(async ({ workflowService }, options) => {
      const result = await workflowService.retryStoryReviewRemediation(options.remediationRunId);
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
  .action(
    withContext<{ qaRunId: string }>(async ({ workflowService }, options) => {
      const result = await workflowService.retryQa(options.qaRunId);
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
  .action(
    withContext<{ documentationRunId: string }>(async ({ workflowService }, options) => {
      const result = await workflowService.retryDocumentation(options.documentationRunId);
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
  .action(
    withContext<{ runId: string }>(async ({ workflowService }, options) => {
      const result = await workflowService.retryRun(options.runId);
      console.log(JSON.stringify(result, null, 2));
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
