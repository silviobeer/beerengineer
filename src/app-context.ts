import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { AgentRuntimeResolver, type AgentRuntimeConfig } from "./adapters/runtime.js";
import type { Workspace, WorkspaceSettings } from "./domain/types.js";
import { createDatabase } from "./persistence/database.js";
import {
  AcceptanceCriterionRepository,
  AppVerificationRunRepository,
  ArchitecturePlanRepository,
  ArtifactRepository,
  AgentSessionRepository,
  BrainstormDraftRepository,
  BrainstormMessageRepository,
  BrainstormSessionRepository,
  ConceptRepository,
  DocumentationAgentSessionRepository,
  DocumentationRunRepository,
  ExecutionAgentSessionRepository,
  ImplementationPlanRepository,
  InteractiveReviewEntryRepository,
  InteractiveReviewMessageRepository,
  InteractiveReviewResolutionRepository,
  InteractiveReviewSessionRepository,
  ItemRepository,
  ReviewAssumptionRepository,
  ReviewFindingRepository,
  ReviewQuestionRepository,
  ReviewRunRepository,
  ReviewSynthesisRepository,
  QualityKnowledgeEntryRepository,
  QaAgentSessionRepository,
  QaFindingRepository,
  QaRunRepository,
  ProjectExecutionContextRepository,
  ProjectRepository,
  StoryReviewAgentSessionRepository,
  StoryReviewFindingRepository,
  StoryReviewRemediationAgentSessionRepository,
  StoryReviewRemediationFindingRepository,
  StoryReviewRemediationRunRepository,
  StoryReviewRunRepository,
  StageRunRepository,
  TestAgentSessionRepository,
  UserStoryRepository,
  WorkspaceAssistMessageRepository,
  WorkspaceAssistSessionRepository,
  VerificationRunRepository,
  WorkspaceRepository,
  WorkspaceCoderabbitSettingsRepository,
  WorkspaceSettingsRepository,
  WorkspaceSonarSettingsRepository,
  WaveRepository,
  WaveExecutionRepository,
  WaveStoryTestRunRepository,
  WaveStoryDependencyRepository,
  WaveStoryExecutionRepository,
  WaveStoryRepository
} from "./persistence/repositories.js";
import { baseMigrations } from "./persistence/migration-registry.js";
import { applyMigrations } from "./persistence/migrator.js";
import { AppError } from "./shared/errors.js";
import { loadResolvedAgentRuntimeConfig } from "./shared/runtime-config.js";
import {
  loadWorkspaceRuntimeProfileFromJsonString,
  resolveWorkspaceRuntimeConfig,
  validateWorkspaceRuntimeProfileCompatibility,
  type WorkspaceRuntimeCompatibility,
  type WorkspaceRuntimeProfile,
  type WorkspaceRuntimeSlotSources
} from "./shared/workspace-runtime-profile.js";
import { DEFAULT_WORKSPACE_KEY } from "./shared/workspaces.js";
import { assertSafeWorkspaceRoot, isUnsafeWorkspaceRoot } from "./shared/workspace-root-guard.js";
import { CoderabbitService } from "./services/coderabbit-service.js";
import { QualityKnowledgeService } from "./services/quality-knowledge-service.js";
import { SonarService } from "./services/sonar-service.js";
import { WorkflowService } from "./workflow/workflow-service.js";

export type EffectiveWorkspaceConfig = {
  defaultAdapterKey: string;
  defaultModel: string | null;
  workspaceRoot: string;
  agentRuntimeConfigPath: string;
};

export type AgentRuntimeContext = {
  configPath: string;
  config: AgentRuntimeConfig;
  resolver: AgentRuntimeResolver;
  globalConfigPath: string;
  globalConfigSource: "installed" | "user_override" | "explicit";
  workspaceProfile: WorkspaceRuntimeProfile | null;
  workspaceProfileSource: string | null;
  workspaceProfileCompatibility: WorkspaceRuntimeCompatibility | null;
  sources: WorkspaceRuntimeSlotSources;
};

export type AppContext = {
  connection: {
    prepare(sql: string): {
      get(...args: unknown[]): unknown;
    };
    close(): void;
  };
  runInTransaction<T>(fn: () => T): T;
  workspace: Workspace;
  workspaceSettings: WorkspaceSettings;
  effectiveConfig: EffectiveWorkspaceConfig;
  agentRuntime: AgentRuntimeContext;
  repositories: {
    workspaceRepository: WorkspaceRepository;
    workspaceSettingsRepository: WorkspaceSettingsRepository;
    workspaceSonarSettingsRepository: WorkspaceSonarSettingsRepository;
    workspaceCoderabbitSettingsRepository: WorkspaceCoderabbitSettingsRepository;
    brainstormSessionRepository: BrainstormSessionRepository;
    brainstormMessageRepository: BrainstormMessageRepository;
    brainstormDraftRepository: BrainstormDraftRepository;
    itemRepository: ItemRepository;
    conceptRepository: ConceptRepository;
    projectRepository: ProjectRepository;
    userStoryRepository: UserStoryRepository;
    acceptanceCriterionRepository: AcceptanceCriterionRepository;
    architecturePlanRepository: ArchitecturePlanRepository;
    implementationPlanRepository: ImplementationPlanRepository;
    waveRepository: WaveRepository;
    waveStoryRepository: WaveStoryRepository;
    waveStoryDependencyRepository: WaveStoryDependencyRepository;
    projectExecutionContextRepository: ProjectExecutionContextRepository;
    waveExecutionRepository: WaveExecutionRepository;
    waveStoryTestRunRepository: WaveStoryTestRunRepository;
    testAgentSessionRepository: TestAgentSessionRepository;
    waveStoryExecutionRepository: WaveStoryExecutionRepository;
    executionAgentSessionRepository: ExecutionAgentSessionRepository;
    verificationRunRepository: VerificationRunRepository;
    appVerificationRunRepository: AppVerificationRunRepository;
    storyReviewRunRepository: StoryReviewRunRepository;
    storyReviewFindingRepository: StoryReviewFindingRepository;
    storyReviewAgentSessionRepository: StoryReviewAgentSessionRepository;
    storyReviewRemediationRunRepository: StoryReviewRemediationRunRepository;
    storyReviewRemediationFindingRepository: StoryReviewRemediationFindingRepository;
    storyReviewRemediationAgentSessionRepository: StoryReviewRemediationAgentSessionRepository;
    qaRunRepository: QaRunRepository;
    qaFindingRepository: QaFindingRepository;
    qaAgentSessionRepository: QaAgentSessionRepository;
    qualityKnowledgeEntryRepository: QualityKnowledgeEntryRepository;
    documentationRunRepository: DocumentationRunRepository;
    documentationAgentSessionRepository: DocumentationAgentSessionRepository;
    interactiveReviewSessionRepository: InteractiveReviewSessionRepository;
    interactiveReviewMessageRepository: InteractiveReviewMessageRepository;
    interactiveReviewEntryRepository: InteractiveReviewEntryRepository;
    interactiveReviewResolutionRepository: InteractiveReviewResolutionRepository;
    reviewRunRepository: ReviewRunRepository;
    reviewFindingRepository: ReviewFindingRepository;
    reviewSynthesisRepository: ReviewSynthesisRepository;
    reviewQuestionRepository: ReviewQuestionRepository;
    reviewAssumptionRepository: ReviewAssumptionRepository;
    stageRunRepository: StageRunRepository;
    artifactRepository: ArtifactRepository;
    agentSessionRepository: AgentSessionRepository;
  };
  services: {
    sonarService: SonarService;
    coderabbitService: CoderabbitService;
    qualityKnowledgeService: QualityKnowledgeService;
  };
  workflowService: WorkflowService;
};

export type WorkspaceSetupContext = {
  connection: {
    prepare(sql: string): {
      get(...args: unknown[]): unknown;
    };
    close(): void;
  };
  workspace: Workspace;
  workspaceSettings: WorkspaceSettings;
  workspaceRoot: string | null;
  rootPathSource: "override" | "workspace" | "unset";
  repoRoot: string;
  agentRuntimeConfigPath: string;
  agentRuntimeConfig: AgentRuntimeConfig;
  agentRuntimeConfigSource: "installed" | "user_override" | "explicit";
  adapterScriptPath?: string;
  repositories: {
    workspaceRepository: WorkspaceRepository;
    workspaceSettingsRepository: WorkspaceSettingsRepository;
    workspaceSonarSettingsRepository: WorkspaceSonarSettingsRepository;
    workspaceCoderabbitSettingsRepository: WorkspaceCoderabbitSettingsRepository;
    workspaceAssistSessionRepository: WorkspaceAssistSessionRepository;
    workspaceAssistMessageRepository: WorkspaceAssistMessageRepository;
  };
};

export function createAppContext(
  dbPath: string,
  options?: {
    adapterScriptPath?: string;
    agentRuntimeConfigPath?: string;
    workspaceKey?: string;
    workspaceRoot?: string;
  }
): AppContext {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const resolvedRuntime = loadResolvedAgentRuntimeConfig({
    repoRoot,
    explicitConfigPath: options?.agentRuntimeConfigPath
  });
  const { connection, db } = createDatabase(dbPath);
  applyMigrations(connection, baseMigrations);

  const workspaceRepository = new WorkspaceRepository(db);
  const workspaceSettingsRepository = new WorkspaceSettingsRepository(db);
  const workspaceSonarSettingsRepository = new WorkspaceSonarSettingsRepository(db);
  const workspaceCoderabbitSettingsRepository = new WorkspaceCoderabbitSettingsRepository(db);
  const workspaceAssistSessionRepository = new WorkspaceAssistSessionRepository(db);
  const workspaceAssistMessageRepository = new WorkspaceAssistMessageRepository(db);
  const brainstormSessionRepository = new BrainstormSessionRepository(db);
  const brainstormMessageRepository = new BrainstormMessageRepository(db);
  const brainstormDraftRepository = new BrainstormDraftRepository(db);
  const itemRepository = new ItemRepository(db);
  const conceptRepository = new ConceptRepository(db);
  const projectRepository = new ProjectRepository(db);
  const userStoryRepository = new UserStoryRepository(db);
  const acceptanceCriterionRepository = new AcceptanceCriterionRepository(db);
  const architecturePlanRepository = new ArchitecturePlanRepository(db);
  const implementationPlanRepository = new ImplementationPlanRepository(db);
  const waveRepository = new WaveRepository(db);
  const waveStoryRepository = new WaveStoryRepository(db);
  const waveStoryDependencyRepository = new WaveStoryDependencyRepository(db);
  const projectExecutionContextRepository = new ProjectExecutionContextRepository(db);
  const waveExecutionRepository = new WaveExecutionRepository(db);
  const waveStoryTestRunRepository = new WaveStoryTestRunRepository(db);
  const testAgentSessionRepository = new TestAgentSessionRepository(db);
  const waveStoryExecutionRepository = new WaveStoryExecutionRepository(db);
  const executionAgentSessionRepository = new ExecutionAgentSessionRepository(db);
  const verificationRunRepository = new VerificationRunRepository(db);
  const appVerificationRunRepository = new AppVerificationRunRepository(db);
  const storyReviewRunRepository = new StoryReviewRunRepository(db);
  const storyReviewFindingRepository = new StoryReviewFindingRepository(db);
  const storyReviewAgentSessionRepository = new StoryReviewAgentSessionRepository(db);
  const storyReviewRemediationRunRepository = new StoryReviewRemediationRunRepository(db);
  const storyReviewRemediationFindingRepository = new StoryReviewRemediationFindingRepository(db);
  const storyReviewRemediationAgentSessionRepository = new StoryReviewRemediationAgentSessionRepository(db);
  const qaRunRepository = new QaRunRepository(db);
  const qaFindingRepository = new QaFindingRepository(db);
  const qaAgentSessionRepository = new QaAgentSessionRepository(db);
  const qualityKnowledgeEntryRepository = new QualityKnowledgeEntryRepository(db);
  const documentationRunRepository = new DocumentationRunRepository(db);
  const documentationAgentSessionRepository = new DocumentationAgentSessionRepository(db);
  const interactiveReviewSessionRepository = new InteractiveReviewSessionRepository(db);
  const interactiveReviewMessageRepository = new InteractiveReviewMessageRepository(db);
  const interactiveReviewEntryRepository = new InteractiveReviewEntryRepository(db);
  const interactiveReviewResolutionRepository = new InteractiveReviewResolutionRepository(db);
  const reviewRunRepository = new ReviewRunRepository(db);
  const reviewFindingRepository = new ReviewFindingRepository(db);
  const reviewSynthesisRepository = new ReviewSynthesisRepository(db);
  const reviewQuestionRepository = new ReviewQuestionRepository(db);
  const reviewAssumptionRepository = new ReviewAssumptionRepository(db);
  const stageRunRepository = new StageRunRepository(db);
  const artifactRepository = new ArtifactRepository(db);
  const agentSessionRepository = new AgentSessionRepository(db);
  const requestedWorkspaceKey = options?.workspaceKey ?? DEFAULT_WORKSPACE_KEY;
  const workspace = workspaceRepository.getByKey(requestedWorkspaceKey);
  if (!workspace) {
    throw new AppError("WORKSPACE_NOT_FOUND", `Workspace ${requestedWorkspaceKey} not found`);
  }
  const workspaceSettings = workspaceSettingsRepository.getByWorkspaceId(workspace.id);
  if (!workspaceSettings) {
    throw new AppError("WORKSPACE_SETTINGS_NOT_FOUND", `Workspace settings for ${workspace.key} not found`);
  }
  const workspaceRuntimeProfile = workspaceSettings.runtimeProfileJson
    ? loadWorkspaceRuntimeProfileFromJsonString(workspaceSettings.runtimeProfileJson, {
        kind: "workspace_settings",
        workspaceKey: workspace.key
      })
    : null;
  const workspaceProfileCompatibility = workspaceRuntimeProfile
    ? validateWorkspaceRuntimeProfileCompatibility(resolvedRuntime.config, workspaceRuntimeProfile)
    : null;
  if (workspaceProfileCompatibility && !workspaceProfileCompatibility.valid) {
    console.error(
      `[beerengineer] Workspace runtime profile for ${workspace.key} is incompatible and will be ignored: ${workspaceProfileCompatibility.issues.join("; ")}`
    );
  }
  const resolvedWorkspaceRuntime = resolveWorkspaceRuntimeConfig({
    globalRuntimeConfig: resolvedRuntime.config,
    workspaceProfile: workspaceProfileCompatibility?.valid ? workspaceRuntimeProfile : null
  });
  const agentRuntimeResolver = new AgentRuntimeResolver(resolvedWorkspaceRuntime.config, {
    repoRoot,
    adapterScriptPath: options?.adapterScriptPath
  });
  const defaultRuntime = agentRuntimeResolver.resolveDefault("autonomous");
  const safeDefaultWorkspaceRoot = isUnsafeWorkspaceRoot(process.cwd(), repoRoot) ? dirname(resolve(dbPath)) : process.cwd();
  const resolvedWorkspaceRoot = options?.workspaceRoot ?? workspace.rootPath ?? safeDefaultWorkspaceRoot;
  assertSafeWorkspaceRoot(resolvedWorkspaceRoot, repoRoot, {
    allowRepoRoot: Boolean(options?.workspaceRoot || workspace.rootPath)
  });
  const effectiveConfig: EffectiveWorkspaceConfig = {
    defaultAdapterKey: defaultRuntime.adapterKey,
    defaultModel: defaultRuntime.model ?? workspaceSettings.defaultModel,
    workspaceRoot: resolvedWorkspaceRoot,
    agentRuntimeConfigPath: resolvedRuntime.configPath
  };
  const artifactRoot = resolve(effectiveConfig.workspaceRoot, ".beerengineer", "workspaces", workspace.key, "artifacts");
  const qualityKnowledgeService = new QualityKnowledgeService(qualityKnowledgeEntryRepository, workspace);
  const sonarService = new SonarService(
    workspace,
    effectiveConfig.workspaceRoot,
    workspaceSonarSettingsRepository,
    qualityKnowledgeEntryRepository,
    repoRoot
  );
  const coderabbitService = new CoderabbitService(
    workspace,
    effectiveConfig.workspaceRoot,
    workspaceCoderabbitSettingsRepository,
    qualityKnowledgeEntryRepository
  );

  return {
    connection,
    runInTransaction: <T>(fn: () => T): T => connection.transaction(fn)(),
    workspace,
    workspaceSettings,
    effectiveConfig,
    agentRuntime: {
      configPath: resolvedRuntime.configPath,
      config: resolvedWorkspaceRuntime.config,
      resolver: agentRuntimeResolver,
      globalConfigPath: resolvedRuntime.configPath,
      globalConfigSource: resolvedRuntime.source,
      workspaceProfile: workspaceRuntimeProfile,
      workspaceProfileSource: workspaceRuntimeProfile ? "workspace_settings.runtime_profile_json" : null,
      workspaceProfileCompatibility: workspaceProfileCompatibility,
      sources: resolvedWorkspaceRuntime.sources
    },
    repositories: {
      workspaceRepository,
      workspaceSettingsRepository,
      workspaceSonarSettingsRepository,
      workspaceCoderabbitSettingsRepository,
      brainstormSessionRepository,
      brainstormMessageRepository,
      brainstormDraftRepository,
      itemRepository,
      conceptRepository,
      projectRepository,
      userStoryRepository,
      acceptanceCriterionRepository,
      architecturePlanRepository,
      implementationPlanRepository,
      waveRepository,
      waveStoryRepository,
      waveStoryDependencyRepository,
      projectExecutionContextRepository,
      waveExecutionRepository,
      waveStoryTestRunRepository,
      testAgentSessionRepository,
      waveStoryExecutionRepository,
      executionAgentSessionRepository,
      verificationRunRepository,
      appVerificationRunRepository,
      storyReviewRunRepository,
      storyReviewFindingRepository,
      storyReviewAgentSessionRepository,
      storyReviewRemediationRunRepository,
      storyReviewRemediationFindingRepository,
      storyReviewRemediationAgentSessionRepository,
      qaRunRepository,
      qaFindingRepository,
      qaAgentSessionRepository,
      qualityKnowledgeEntryRepository,
      documentationRunRepository,
      documentationAgentSessionRepository,
      interactiveReviewSessionRepository,
      interactiveReviewMessageRepository,
      interactiveReviewEntryRepository,
      interactiveReviewResolutionRepository,
      reviewRunRepository,
      reviewFindingRepository,
      reviewSynthesisRepository,
      reviewQuestionRepository,
      reviewAssumptionRepository,
      stageRunRepository,
      artifactRepository,
      agentSessionRepository
    },
    services: {
      sonarService,
      coderabbitService,
      qualityKnowledgeService
    },
    workflowService: new WorkflowService({
      repoRoot,
      workspace,
      workspaceSettings,
      workspaceRoot: effectiveConfig.workspaceRoot,
      artifactRoot,
      runInTransaction: <T>(fn: () => T): T => connection.transaction(fn)(),
      agentRuntimeResolver,
      itemRepository,
      brainstormSessionRepository,
      brainstormMessageRepository,
      brainstormDraftRepository,
      conceptRepository,
      projectRepository,
      userStoryRepository,
      acceptanceCriterionRepository,
      architecturePlanRepository,
      implementationPlanRepository,
      waveRepository,
      waveStoryRepository,
      waveStoryDependencyRepository,
      projectExecutionContextRepository,
      waveExecutionRepository,
      waveStoryTestRunRepository,
      testAgentSessionRepository,
      waveStoryExecutionRepository,
      executionAgentSessionRepository,
      verificationRunRepository,
      appVerificationRunRepository,
      storyReviewRunRepository,
      storyReviewFindingRepository,
      storyReviewAgentSessionRepository,
      storyReviewRemediationRunRepository,
      storyReviewRemediationFindingRepository,
      storyReviewRemediationAgentSessionRepository,
      qaRunRepository,
      qaFindingRepository,
      qaAgentSessionRepository,
      qualityKnowledgeEntryRepository,
      documentationRunRepository,
      documentationAgentSessionRepository,
      interactiveReviewSessionRepository,
      interactiveReviewMessageRepository,
      interactiveReviewEntryRepository,
      interactiveReviewResolutionRepository,
      reviewRunRepository,
      reviewFindingRepository,
      reviewSynthesisRepository,
      reviewQuestionRepository,
      reviewAssumptionRepository,
      stageRunRepository,
      artifactRepository,
      agentSessionRepository,
      sonarService,
      coderabbitService,
      qualityKnowledgeService
    })
  };
}

export function createWorkspaceSetupContext(
  dbPath: string,
  options?: {
    agentRuntimeConfigPath?: string;
    adapterScriptPath?: string;
    workspaceKey?: string;
    workspaceRoot?: string;
  }
): WorkspaceSetupContext {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const resolvedRuntime = loadResolvedAgentRuntimeConfig({
    repoRoot,
    explicitConfigPath: options?.agentRuntimeConfigPath
  });
  const { connection, db } = createDatabase(dbPath);
  applyMigrations(connection, baseMigrations);

  const workspaceRepository = new WorkspaceRepository(db);
  const workspaceSettingsRepository = new WorkspaceSettingsRepository(db);
  const workspaceSonarSettingsRepository = new WorkspaceSonarSettingsRepository(db);
  const workspaceCoderabbitSettingsRepository = new WorkspaceCoderabbitSettingsRepository(db);
  const workspaceAssistSessionRepository = new WorkspaceAssistSessionRepository(db);
  const workspaceAssistMessageRepository = new WorkspaceAssistMessageRepository(db);
  const requestedWorkspaceKey = options?.workspaceKey ?? DEFAULT_WORKSPACE_KEY;
  const workspace = workspaceRepository.getByKey(requestedWorkspaceKey);
  if (!workspace) {
    throw new AppError("WORKSPACE_NOT_FOUND", `Workspace ${requestedWorkspaceKey} not found`);
  }
  const workspaceSettings = workspaceSettingsRepository.getByWorkspaceId(workspace.id);
  if (!workspaceSettings) {
    throw new AppError("WORKSPACE_SETTINGS_NOT_FOUND", `Workspace settings for ${workspace.key} not found`);
  }
  const resolvedWorkspaceRoot = options?.workspaceRoot ? resolve(options.workspaceRoot) : workspace.rootPath;
  if (resolvedWorkspaceRoot) {
    assertSafeWorkspaceRoot(resolvedWorkspaceRoot, repoRoot, {
      allowRepoRoot: true
    });
  }

  return {
    connection,
    workspace,
    workspaceSettings,
    workspaceRoot: resolvedWorkspaceRoot,
    rootPathSource: options?.workspaceRoot ? "override" : workspace.rootPath ? "workspace" : "unset",
    repoRoot,
    agentRuntimeConfigPath: resolvedRuntime.configPath,
    agentRuntimeConfig: resolvedRuntime.config,
    agentRuntimeConfigSource: resolvedRuntime.source,
    adapterScriptPath: options?.adapterScriptPath,
    repositories: {
      workspaceRepository,
      workspaceSettingsRepository,
      workspaceSonarSettingsRepository,
      workspaceCoderabbitSettingsRepository,
      workspaceAssistSessionRepository,
      workspaceAssistMessageRepository
    }
  };
}
