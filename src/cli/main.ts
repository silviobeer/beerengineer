import { Command, Option } from "commander";
import { resolve } from "node:path";

import { createAppContext, createWorkspaceSetupContext, type AppContext } from "../app-context.js";
import { AgentRuntimeResolver, loadAgentRuntimeConfig } from "../adapters/runtime.js";
import {
  interactiveReviewEntryStatuses,
  interactiveReviewSeverities,
  planningReviewAutomationLevels,
  planningReviewInteractionModes,
  planningReviewModes,
  planningReviewSourceTypes,
  planningReviewSteps
} from "../domain/types.js";
import { AppError } from "../shared/errors.js";

const program = new Command();
program.name("beerengineer");
program.option("--db <path>", "SQLite database path", "./var/data/beerengineer.sqlite");
program.option("--agent-runtime-config <path>", "Path to the agent runtime config file");
program.option("--adapter-script-path <path>", "Override the local adapter script used for bounded agent runs");
program.option("--workspace <key>", "Select the active workspace", "default");
program.option("--workspace-root <path>", "Override the workspace root used for git workflow operations");
program.showHelpAfterError();

type WorkspaceSetupContextInput = Pick<
  Awaited<ReturnType<typeof createWorkspaceSetupContext>>,
  "workspace" | "workspaceRoot" | "rootPathSource" | "agentRuntimeConfigPath" | "repositories"
>;

async function createWorkspaceSetupService(context: WorkspaceSetupContextInput) {
  // Keep workspace setup lazy because this branch may intentionally not carry
  // the optional implementation files from parallel work on main.
  const module = await import(`../services/${"workspace-setup-service"}.js`);
  return new module.WorkspaceSetupService({
    workspace: context.workspace,
    workspaceRoot: context.workspaceRoot,
    rootPathSource: context.rootPathSource,
    agentRuntimeConfigPath: context.agentRuntimeConfigPath,
    sonarSettings: context.repositories.workspaceSonarSettingsRepository.getByWorkspaceId(context.workspace.id),
    coderabbitSettings: context.repositories.workspaceCoderabbitSettingsRepository.getByWorkspaceId(context.workspace.id),
    assistSessionRepository: context.repositories.workspaceAssistSessionRepository,
    assistMessageRepository: context.repositories.workspaceAssistMessageRepository
  });
}

function collectOptionValues(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function withContext<TOptions extends object>(
  handler: (context: AppContext, options: TOptions, dbPath: string) => Promise<void> | void
) {
  return async (options: TOptions) => {
    const programOptions = program.opts<{
      db: string;
      agentRuntimeConfig?: string;
      adapterScriptPath?: string;
      workspace: string;
      workspaceRoot?: string;
    }>();
    const dbPath = resolve(programOptions.db);
    let context: AppContext | null = null;
    try {
      context = createAppContext(dbPath, {
        agentRuntimeConfigPath: programOptions.agentRuntimeConfig
          ? resolve(programOptions.agentRuntimeConfig)
          : undefined,
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolveDelay) => globalThis.setTimeout(resolveDelay, ms));
}

function resolveOptionalList(values: string[], clear?: boolean): string[] | undefined {
  if (values.length > 0) {
    return values;
  }
  return clear ? [] : undefined;
}

function parseBooleanFlag(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new AppError("INVALID_BOOLEAN_OPTION", `Expected true or false, received ${value}`);
}

function buildCliErrorPayload(error: unknown): { error: { code: string; message: string } } {
  if (error instanceof AppError) {
    return {
      error: {
        code: error.code,
        message: error.message
      }
    };
  }
  return {
    error: {
      code: "UNEXPECTED_ERROR",
      message: error instanceof Error ? error.message : String(error)
    }
  };
}

function formatExecutionCompactSummary(compact: {
  project: { code: string; title: string };
  implementationPlan: { version: number; status: string };
  activeWaveCode: string | null;
  overallStatus: string;
  waves: Array<{
    waveCode: string;
    goal: string;
    status: string;
    storyCount: number;
    completedStoryCount: number;
    stories: Array<{
      storyCode: string;
      title: string;
      status: string;
      lastPhase: string;
      blockers: string[];
      lastError: string | null;
    }>;
  }>;
}): string {
  const lines = [
    `Project ${compact.project.code}: ${compact.project.title}`,
    `Plan v${compact.implementationPlan.version} (${compact.implementationPlan.status})`,
    `Overall: ${compact.overallStatus}`,
    `Active wave: ${compact.activeWaveCode ?? "none"}`
  ];

  for (const wave of compact.waves) {
    lines.push("", `Wave ${wave.waveCode} [${wave.status}] ${wave.completedStoryCount}/${wave.storyCount} completed`, `Goal: ${wave.goal}`);
    for (const story of wave.stories) {
      const suffix = story.blockers.length > 0 ? ` blockers=${story.blockers.join(",")}` : "";
      lines.push(`- ${story.storyCode} [${story.status}] phase=${story.lastPhase}${suffix}`);
      if (story.lastError) {
        lines.push(`  error: ${story.lastError}`);
      }
    }
  }

  return lines.join("\n");
}

function withWorkspaceSetupContext<TOptions extends object>(
  handler: (
    context: ReturnType<typeof createWorkspaceSetupContext>,
    options: TOptions,
    dbPath: string
  ) => Promise<void> | void
) {
  return async (options: TOptions) => {
    const programOptions = program.opts<{
      db: string;
      agentRuntimeConfig?: string;
      adapterScriptPath?: string;
      workspace: string;
      workspaceRoot?: string;
    }>();
    const dbPath = resolve(programOptions.db);
    let context: ReturnType<typeof createWorkspaceSetupContext> | null = null;
    try {
      context = createWorkspaceSetupContext(dbPath, {
        agentRuntimeConfigPath: programOptions.agentRuntimeConfig ? resolve(programOptions.agentRuntimeConfig) : undefined,
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
  .requiredOption("--workspace-key <key>")
  .requiredOption("--root-path <rootPath>")
  .action(
    withContext<{ workspaceKey: string; rootPath: string }>(({ repositories }, options) => {
      const workspace = repositories.workspaceRepository.getByKey(options.workspaceKey);
      if (!workspace) {
        throw new AppError("WORKSPACE_NOT_FOUND", `Workspace ${options.workspaceKey} not found`);
      }
      const updated = repositories.workspaceRepository.update({
        id: workspace.id,
        rootPath: resolve(options.rootPath)
      });
      console.log(JSON.stringify(updated, null, 2));
    })
  );

program
  .command("workspace:doctor")
  .action(
    withWorkspaceSetupContext<Record<string, never>>(async ({ workspace, workspaceRoot, rootPathSource, agentRuntimeConfigPath, repositories }) => {
      const service = await createWorkspaceSetupService({ workspace, workspaceRoot, rootPathSource, agentRuntimeConfigPath, repositories });
      console.log(JSON.stringify(service.doctor(), null, 2));
    })
  );

program
  .command("workspace:init")
  .option("--create-root", "Create the workspace root if it does not exist")
  .option("--init-git", "Initialize a git repository when missing")
  .option("--dry-run", "Show planned actions without mutating the workspace")
  .action(
    withWorkspaceSetupContext<{ createRoot?: boolean; initGit?: boolean; dryRun?: boolean }>(
      async ({ workspace, workspaceRoot, rootPathSource, agentRuntimeConfigPath, repositories }, options) => {
        const service = await createWorkspaceSetupService({ workspace, workspaceRoot, rootPathSource, agentRuntimeConfigPath, repositories });
        console.log(
          JSON.stringify(
            service.init({
              createRoot: Boolean(options.createRoot),
              initGit: Boolean(options.initGit),
              dryRun: Boolean(options.dryRun)
            }),
            null,
            2
          )
        );
      }
    )
  );

program
  .command("workspace:assist")
  .option("--message <message>", "Additional setup guidance for the planning assistant")
  .action(
    withWorkspaceSetupContext<{ message?: string }>(
      async ({ workspace, workspaceRoot, rootPathSource, agentRuntimeConfigPath, adapterScriptPath, repoRoot, repositories }, options) => {
        const service = await createWorkspaceSetupService({ workspace, workspaceRoot, rootPathSource, agentRuntimeConfigPath, repositories });
        const runtimeConfig = loadAgentRuntimeConfig(agentRuntimeConfigPath);
        const resolver = new AgentRuntimeResolver(runtimeConfig, {
          repoRoot,
          adapterScriptPath
        });
        const runtime = resolver.resolveDefault("interactive");
        if (options.message) {
          const openSession = repositories.workspaceAssistSessionRepository.findOpenByWorkspaceId(workspace.id);
          const sessionId = openSession?.id ?? (await service.startOrReuseAssistSession({ runtime })).session.id;
          const result = await service.chatAssistSession({ runtime, sessionId, message: options.message });
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        const result = await service.startOrReuseAssistSession({ runtime });
        console.log(JSON.stringify(result, null, 2));
      }
    )
  );

program
  .command("workspace:assist:show")
  .option("--session-id <sessionId>", "Show a specific workspace assist session")
  .action(
    withWorkspaceSetupContext<{ sessionId?: string }>(
      async ({ workspace, workspaceRoot, rootPathSource, agentRuntimeConfigPath, repositories }, options) => {
        const service = await createWorkspaceSetupService({ workspace, workspaceRoot, rootPathSource, agentRuntimeConfigPath, repositories });
        const result = service.showAssistSession(options.sessionId);
        console.log(JSON.stringify(result, null, 2));
      }
    )
  );

program
  .command("workspace:assist:list")
  .action(
    withWorkspaceSetupContext(async ({ workspace, workspaceRoot, rootPathSource, agentRuntimeConfigPath, repositories }) => {
      const service = await createWorkspaceSetupService({ workspace, workspaceRoot, rootPathSource, agentRuntimeConfigPath, repositories });
      console.log(JSON.stringify(service.listAssistSessions(), null, 2));
    })
  );

program
  .command("workspace:assist:resolve")
  .requiredOption("--session-id <sessionId>", "Resolve a workspace assist session")
  .action(
    withWorkspaceSetupContext<{ sessionId: string }>(
      async ({ workspace, workspaceRoot, rootPathSource, agentRuntimeConfigPath, repositories }, options) => {
        const service = await createWorkspaceSetupService({ workspace, workspaceRoot, rootPathSource, agentRuntimeConfigPath, repositories });
        const result = service.resolveAssistSession({ sessionId: options.sessionId });
        console.log(JSON.stringify(result, null, 2));
      }
    )
  );

program
  .command("workspace:assist:cancel")
  .requiredOption("--session-id <sessionId>", "Cancel a workspace assist session")
  .action(
    withWorkspaceSetupContext<{ sessionId: string }>(
      async ({ workspace, workspaceRoot, rootPathSource, agentRuntimeConfigPath, repositories }, options) => {
        const service = await createWorkspaceSetupService({ workspace, workspaceRoot, rootPathSource, agentRuntimeConfigPath, repositories });
        const result = service.cancelAssistSession({ sessionId: options.sessionId });
        console.log(JSON.stringify(result, null, 2));
      }
    )
  );

program
  .command("workspace:bootstrap")
  .option("--stack <stack>", "Bootstrap stack", "node-ts")
  .option("--scaffold-project-files", "Create starter project files for a new workspace")
  .option("--create-root", "Create the workspace root if it does not exist")
  .option("--init-git", "Initialize a git repository when missing")
  .option("--install-deps", "Install dependencies after scaffolding")
  .option("--with-sonar", "Create Sonar starter config when missing")
  .option("--with-coderabbit", "Create CodeRabbit starter instructions when missing")
  .option("--plan <path>", "Load bootstrap settings from a JSON plan file")
  .option("--session-id <sessionId>", "Load bootstrap settings from a workspace assist session")
  .option("--dry-run", "Show planned actions without mutating the workspace")
  .action(
    withWorkspaceSetupContext<{
      stack?: string;
      scaffoldProjectFiles?: boolean;
      createRoot?: boolean;
      initGit?: boolean;
      installDeps?: boolean;
      withSonar?: boolean;
      withCoderabbit?: boolean;
      plan?: string;
      sessionId?: string;
      dryRun?: boolean;
    }>(async ({ workspace, workspaceRoot, rootPathSource, agentRuntimeConfigPath, repositories }, options) => {
      const service = await createWorkspaceSetupService({ workspace, workspaceRoot, rootPathSource, agentRuntimeConfigPath, repositories });
      const plan = options.sessionId
        ? service.loadBootstrapPlanFromAssistSession(options.sessionId)
        : options.plan
          ? service.loadBootstrapPlan(resolve(options.plan))
          : service.loadBootstrapPlanFromOpenAssistSession();
      const openAssistSessionId = !options.sessionId && !options.plan
        ? repositories.workspaceAssistSessionRepository.findOpenByWorkspaceId(workspace.id)?.id ?? null
        : null;
      const hasExplicitBootstrapOptions =
        Boolean(options.scaffoldProjectFiles) ||
        Boolean(options.createRoot) ||
        Boolean(options.initGit) ||
        Boolean(options.installDeps) ||
        Boolean(options.withSonar) ||
        Boolean(options.withCoderabbit);
      if (!plan && !hasExplicitBootstrapOptions) {
        throw new AppError(
          "WORKSPACE_BOOTSTRAP_INPUT_REQUIRED",
          "workspace:bootstrap requires --plan, --session-id, an open workspace assist session, or explicit bootstrap flags."
        );
      }
      const planSource = options.sessionId
        ? "assist_session"
        : options.plan
          ? "plan_file"
          : plan
            ? "open_assist_session"
            : "options";
      const planReference = options.sessionId
        ? options.sessionId
        : options.plan
          ? resolve(options.plan)
          : plan
            ? openAssistSessionId
            : null;
      const stack = (plan?.stack ?? options.stack ?? "node-ts") as "node-ts" | "python";
      const effectivePlan = {
        version: plan?.version ?? 1,
        workspaceKey: workspace.key,
        rootPath: workspaceRoot,
        mode: plan?.mode ?? "greenfield",
        stack,
        scaffoldProjectFiles: plan?.scaffoldProjectFiles ?? Boolean(options.scaffoldProjectFiles),
        createRoot: plan?.createRoot ?? Boolean(options.createRoot),
        initGit: plan?.initGit ?? Boolean(options.initGit),
        installDeps: plan?.installDeps ?? Boolean(options.installDeps),
        withSonar: plan?.withSonar ?? Boolean(options.withSonar),
        withCoderabbit: plan?.withCoderabbit ?? Boolean(options.withCoderabbit),
        generatedAt: plan?.generatedAt ?? Date.now()
      };
      console.log(
        JSON.stringify(
          {
            planSource,
            planReference,
            effectivePlan,
            ...service.bootstrap({
              stack,
              scaffoldProjectFiles: effectivePlan.scaffoldProjectFiles,
              createRoot: effectivePlan.createRoot,
              initGit: effectivePlan.initGit,
              installDeps: effectivePlan.installDeps,
              withSonar: effectivePlan.withSonar,
              withCoderabbit: effectivePlan.withCoderabbit,
              dryRun: Boolean(options.dryRun)
            })
          },
          null,
          2
        )
      );
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
      console.log(
        JSON.stringify(
          workflowService.updateBrainstormDraft({
            sessionId: options.sessionId,
            problem: options.problem,
            coreOutcome: options.coreOutcome,
            targetUsers: resolveOptionalList(options.targetUser, options.clearTargetUsers),
            useCases: resolveOptionalList(options.useCase, options.clearUseCases),
            constraints: resolveOptionalList(options.constraint, options.clearConstraints),
            nonGoals: resolveOptionalList(options.nonGoal, options.clearNonGoals),
            risks: resolveOptionalList(options.risk, options.clearRisks),
            openQuestions: resolveOptionalList(options.openQuestion, options.clearOpenQuestions),
            candidateDirections: resolveOptionalList(options.candidateDirection, options.clearCandidateDirections),
            assumptions: resolveOptionalList(options.assumption, options.clearAssumptions),
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
  .command("project:show")
  .requiredOption("--project-id <projectId>")
  .action(
    withContext<{ projectId: string }>(({ workflowService }, options) => {
      console.log(JSON.stringify(workflowService.showProject(options.projectId), null, 2));
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
    withContext<{ type: string; projectId?: string }>(async ({ workflowService }, options) => {
      if (options.type !== "stories" || !options.projectId) {
        throw new AppError("INTERACTIVE_REVIEW_INVALID_INPUT", "Currently only --type stories --project-id <id> is supported");
      }
      console.log(JSON.stringify(await workflowService.startInteractiveReview({ type: "stories", projectId: options.projectId }), null, 2));
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
      ] satisfies string[])
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
  .command("planning-review:start")
  .addOption(new Option("--source-type <sourceType>").choices([...planningReviewSourceTypes]).makeOptionMandatory())
  .requiredOption("--source-id <sourceId>")
  .addOption(new Option("--step <step>").choices([...planningReviewSteps]).makeOptionMandatory())
  .addOption(new Option("--review-mode <reviewMode>").choices([...planningReviewModes]).default("readiness"))
  .addOption(new Option("--mode <mode>").choices([...planningReviewInteractionModes]).default("interactive"))
  .addOption(new Option("--automation-level <automationLevel>").choices([...planningReviewAutomationLevels]).default("manual"))
  .action(
    withContext<{
      sourceType: "brainstorm_session" | "brainstorm_draft" | "interactive_review_session" | "concept" | "architecture_plan" | "implementation_plan";
      sourceId: string;
      step: "requirements_engineering" | "architecture" | "plan_writing";
      reviewMode: "critique" | "risk" | "alternatives" | "readiness";
      mode: "interactive" | "auto";
      automationLevel: "manual" | "auto_suggest" | "auto_comment" | "auto_gate";
    }>(async ({ workflowService }, options) => {
      console.log(
        JSON.stringify(
          await workflowService.startPlanningReview({
            sourceType: options.sourceType,
            sourceId: options.sourceId,
            step: options.step,
            reviewMode: options.reviewMode,
            interactionMode: options.mode,
            automationLevel: options.automationLevel
          }),
          null,
          2
        )
      );
    })
  );

program
  .command("planning-review:show")
  .requiredOption("--run-id <runId>")
  .action(
    withContext<{ runId: string }>(({ workflowService }, options) => {
      console.log(JSON.stringify(workflowService.showPlanningReview(options.runId), null, 2));
    })
  );

program
  .command("planning-review:question:answer")
  .requiredOption("--run-id <runId>")
  .requiredOption("--question-id <questionId>")
  .requiredOption("--answer <answer>")
  .action(
    withContext<{ runId: string; questionId: string; answer: string }>(({ workflowService }, options) => {
      console.log(
        JSON.stringify(
          workflowService.answerPlanningReviewQuestion({
            runId: options.runId,
            questionId: options.questionId,
            answer: options.answer
          }),
          null,
          2
        )
      );
    })
  );

program
  .command("planning-review:rerun")
  .requiredOption("--run-id <runId>")
  .action(
    withContext<{ runId: string }>(async ({ workflowService }, options) => {
      console.log(JSON.stringify(await workflowService.rerunPlanningReview(options.runId), null, 2));
    })
  );

program
  .command("implementation-review:start")
  .requiredOption("--wave-story-execution-id <waveStoryExecutionId>")
  .addOption(new Option("--automation-level <automationLevel>").choices([...planningReviewAutomationLevels]).default("manual"))
  .addOption(new Option("--interaction-mode <interactionMode>").choices(["auto", "assisted", "interactive"]))
  .action(
    withContext<{
      waveStoryExecutionId: string;
      automationLevel: "manual" | "auto_suggest" | "auto_comment" | "auto_gate";
      interactionMode?: "auto" | "assisted" | "interactive";
    }>(async ({ workflowService }, options) => {
      console.log(
        JSON.stringify(
          await workflowService.startImplementationReview({
            waveStoryExecutionId: options.waveStoryExecutionId,
            automationLevel: options.automationLevel,
            interactionMode: options.interactionMode
          }),
          null,
          2
        )
      );
    })
  );

program
  .command("implementation-review:show")
  .requiredOption("--run-id <runId>")
  .action(
    withContext<{ runId: string }>(({ workflowService }, options) => {
      console.log(JSON.stringify(workflowService.showImplementationReview(options.runId), null, 2));
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
  .option("--compact", "Show a reduced execution summary")
  .action(
    withContext<{ projectId: string; compact?: boolean }>(({ workflowService }, options) => {
      const result = options.compact
        ? workflowService.showExecutionCompact(options.projectId)
        : workflowService.showExecution(options.projectId);
      console.log(JSON.stringify(result, null, 2));
    })
  );

program
  .command("execution:logs")
  .requiredOption("--project-id <projectId>")
  .requiredOption("--story-code <storyCode>")
  .action(
    withContext<{ projectId: string; storyCode: string }>(({ workflowService }, options) => {
      const result = workflowService.showExecutionLogs({
        projectId: options.projectId,
        storyCode: options.storyCode
      });
      console.log(JSON.stringify(result, null, 2));
    })
  );

program
  .command("execution:watch")
  .requiredOption("--project-id <projectId>")
  .option("--interval-ms <intervalMs>", "Polling interval in milliseconds", "3000")
  .option("--max-iterations <maxIterations>", "Stop after this many refreshes")
  .action(
    withContext<{ projectId: string; intervalMs: string; maxIterations?: string }>(async ({ workflowService }, options) => {
      const intervalMs = Number.parseInt(options.intervalMs, 10);
      const maxIterations = options.maxIterations ? Number.parseInt(options.maxIterations, 10) : null;
      if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
        throw new AppError("INVALID_INTERVAL", "interval-ms must be a positive integer");
      }
      if (maxIterations !== null && (!Number.isFinite(maxIterations) || maxIterations <= 0)) {
        throw new AppError("INVALID_MAX_ITERATIONS", "max-iterations must be a positive integer");
      }

      let iteration = 0;
      while (true) {
        iteration += 1;
        const compact = workflowService.showExecutionCompact(options.projectId);
        if (iteration > 1) {
          process.stdout.write("\n---\n");
        }
        process.stdout.write(`${formatExecutionCompactSummary(compact)}\n`);

        const terminal =
          compact.overallStatus === "completed" ||
          compact.overallStatus === "failed" ||
          compact.overallStatus === "review_required";
        if (terminal || (maxIterations !== null && iteration >= maxIterations)) {
          return;
        }
        await sleep(intervalMs);
      }
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

const sonarCommand = program.command("sonar");
const sonarConfigCommand = sonarCommand.command("config");

sonarConfigCommand.command("show").action(
  withContext<Record<string, never>>(({ services }) => {
    console.log(JSON.stringify(services.sonarService.showConfig(), null, 2));
  })
);

sonarConfigCommand
  .command("set")
  .addOption(new Option("--enabled <enabled>").choices(["true", "false"]))
  .option("--provider-type <providerType>")
  .option("--host-url <hostUrl>")
  .option("--organization <organization>")
  .option("--project-key <projectKey>")
  .option("--token <token>")
  .option("--default-branch <defaultBranch>")
  .addOption(new Option("--gating-mode <gatingMode>").choices(["off", "advisory", "story_gate", "wave_gate"]))
  .action(
    withContext<{
      enabled?: string;
      providerType?: string;
      hostUrl?: string;
      organization?: string;
      projectKey?: string;
      token?: string;
      defaultBranch?: string;
      gatingMode?: "off" | "advisory" | "story_gate" | "wave_gate";
    }>(({ services }, options) => {
      console.log(
        JSON.stringify(
          services.sonarService.setConfig({
            enabled: parseBooleanFlag(options.enabled),
            providerType: options.providerType,
            hostUrl: options.hostUrl,
            organization: options.organization,
            projectKey: options.projectKey,
            token: options.token,
            defaultBranch: options.defaultBranch,
            gatingMode: options.gatingMode
          }),
          null,
          2
        )
      );
    })
  );

sonarConfigCommand.command("test").action(
  withContext<Record<string, never>>(({ services }) => {
    console.log(JSON.stringify(services.sonarService.testConfig(), null, 2));
  })
);

sonarConfigCommand.command("clear-token").action(
  withContext<Record<string, never>>(({ services }) => {
    console.log(JSON.stringify(services.sonarService.clearToken(), null, 2));
  })
);

sonarCommand.command("scan").action(
  withContext<Record<string, never>>(({ services }) => {
    console.log(JSON.stringify(services.sonarService.scan(), null, 2));
  })
);

sonarCommand.command("preflight").action(
  withContext<Record<string, never>>(({ services }) => {
    console.log(JSON.stringify(services.sonarService.preflight(), null, 2));
  })
);

sonarCommand.command("status").action(
  withContext<Record<string, never>>(({ services }) => {
    console.log(JSON.stringify(services.sonarService.status(), null, 2));
  })
);

sonarCommand.command("issues").action(
  withContext<Record<string, never>>(({ services }) => {
    console.log(JSON.stringify(services.sonarService.issues(), null, 2));
  })
);

sonarCommand.command("hotspots").action(
  withContext<Record<string, never>>(({ services }) => {
    console.log(JSON.stringify(services.sonarService.hotspots(), null, 2));
  })
);

const coderabbitCommand = program.command("coderabbit");
const coderabbitConfigCommand = coderabbitCommand.command("config");

coderabbitConfigCommand.command("show").action(
  withContext<Record<string, never>>(({ services }) => {
    console.log(JSON.stringify(services.coderabbitService.showConfig(), null, 2));
  })
);

coderabbitConfigCommand
  .command("set")
  .addOption(new Option("--enabled <enabled>").choices(["true", "false"]))
  .option("--provider-type <providerType>")
  .option("--host-url <hostUrl>")
  .option("--organization <organization>")
  .option("--repository <repository>")
  .option("--token <token>")
  .option("--default-branch <defaultBranch>")
  .addOption(new Option("--gating-mode <gatingMode>").choices(["off", "advisory", "story_gate", "wave_gate"]))
  .action(
    withContext<{
      enabled?: string;
      providerType?: string;
      hostUrl?: string;
      organization?: string;
      repository?: string;
      token?: string;
      defaultBranch?: string;
      gatingMode?: "off" | "advisory" | "story_gate" | "wave_gate";
    }>(({ services }, options) => {
      console.log(
        JSON.stringify(
          services.coderabbitService.setConfig({
            enabled: parseBooleanFlag(options.enabled),
            providerType: options.providerType,
            hostUrl: options.hostUrl,
            organization: options.organization,
            repository: options.repository,
            token: options.token,
            defaultBranch: options.defaultBranch,
            gatingMode: options.gatingMode
          }),
          null,
          2
        )
      );
    })
  );

coderabbitConfigCommand.command("test").action(
  withContext<Record<string, never>>(({ services }) => {
    console.log(JSON.stringify(services.coderabbitService.testConfig(), null, 2));
  })
);

coderabbitCommand.command("preflight").action(
  withContext<Record<string, never>>(({ services }) => {
    console.log(JSON.stringify(services.coderabbitService.preflight(), null, 2));
  })
);

coderabbitConfigCommand.command("clear-token").action(
  withContext<Record<string, never>>(({ services }) => {
    console.log(JSON.stringify(services.coderabbitService.clearToken(), null, 2));
  })
);

const reviewOpsCommand = program.command("review");

reviewOpsCommand
  .command("run")
  .requiredOption("--story <storyId>")
  .action(
    withContext<{ story: string }>(async ({ repositories, workflowService }, options) => {
      const waveStory = repositories.waveStoryRepository.listByStoryIds([options.story])[0];
      if (!waveStory) {
        throw new AppError("WAVE_STORY_NOT_FOUND", `No wave story found for story ${options.story}`);
      }
      const execution = repositories.waveStoryExecutionRepository.getLatestByWaveStoryId(waveStory.id);
      if (!execution) {
        throw new AppError("WAVE_STORY_EXECUTION_NOT_FOUND", `No execution found for story ${options.story}`);
      }
      const result = await workflowService.startStoryReview(execution.id);
      console.log(JSON.stringify(result, null, 2));
    })
  );

reviewOpsCommand
  .command("status")
  .requiredOption("--story <storyId>")
  .action(
    withContext<{ story: string }>(({ workflowService }, options) => {
      console.log(JSON.stringify(workflowService.showStoryReview(options.story), null, 2));
    })
  );

reviewOpsCommand
  .command("remediate")
  .requiredOption("--story-review-run <storyReviewRunId>")
  .action(
    withContext<{ storyReviewRun: string }>(async ({ workflowService }, options) => {
      const result = await workflowService.startStoryReviewRemediation(options.storyReviewRun);
      console.log(JSON.stringify(result, null, 2));
    })
  );
try {
  await program.parseAsync(process.argv);
} catch (error: unknown) {
  const payload = buildCliErrorPayload(error);
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 1;
}
