import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { LocalCliAdapter } from "./adapters/local-cli-adapter.js";
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
  VerificationRunRepository,
  WorkspaceRepository,
  WorkspaceSettingsRepository,
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
import { DEFAULT_WORKSPACE_KEY } from "./shared/workspaces.js";
import { WorkflowService } from "./workflow/workflow-service.js";

export type EffectiveWorkspaceConfig = {
  defaultAdapterKey: string;
  defaultModel: string | null;
  workspaceRoot: string;
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
  repositories: {
    workspaceRepository: WorkspaceRepository;
    workspaceSettingsRepository: WorkspaceSettingsRepository;
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
    documentationRunRepository: DocumentationRunRepository;
    documentationAgentSessionRepository: DocumentationAgentSessionRepository;
    interactiveReviewSessionRepository: InteractiveReviewSessionRepository;
    interactiveReviewMessageRepository: InteractiveReviewMessageRepository;
    interactiveReviewEntryRepository: InteractiveReviewEntryRepository;
    interactiveReviewResolutionRepository: InteractiveReviewResolutionRepository;
    stageRunRepository: StageRunRepository;
    artifactRepository: ArtifactRepository;
    agentSessionRepository: AgentSessionRepository;
  };
  workflowService: WorkflowService;
};

export function createAppContext(
  dbPath: string,
  options?: {
    adapterScriptPath?: string;
    workspaceKey?: string;
    workspaceRoot?: string;
  }
): AppContext {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const artifactRoot = resolve(repoRoot, "var/artifacts");
  const { connection, db } = createDatabase(dbPath);
  applyMigrations(connection, baseMigrations);

  const workspaceRepository = new WorkspaceRepository(db);
  const workspaceSettingsRepository = new WorkspaceSettingsRepository(db);
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
  const documentationRunRepository = new DocumentationRunRepository(db);
  const documentationAgentSessionRepository = new DocumentationAgentSessionRepository(db);
  const interactiveReviewSessionRepository = new InteractiveReviewSessionRepository(db);
  const interactiveReviewMessageRepository = new InteractiveReviewMessageRepository(db);
  const interactiveReviewEntryRepository = new InteractiveReviewEntryRepository(db);
  const interactiveReviewResolutionRepository = new InteractiveReviewResolutionRepository(db);
  const stageRunRepository = new StageRunRepository(db);
  const artifactRepository = new ArtifactRepository(db);
  const agentSessionRepository = new AgentSessionRepository(db);
  const adapter = new LocalCliAdapter(repoRoot, options?.adapterScriptPath);
  const requestedWorkspaceKey = options?.workspaceKey ?? DEFAULT_WORKSPACE_KEY;
  const workspace = workspaceRepository.getByKey(requestedWorkspaceKey);
  if (!workspace) {
    throw new AppError("WORKSPACE_NOT_FOUND", `Workspace ${requestedWorkspaceKey} not found`);
  }
  const workspaceSettings = workspaceSettingsRepository.getByWorkspaceId(workspace.id);
  if (!workspaceSettings) {
    throw new AppError("WORKSPACE_SETTINGS_NOT_FOUND", `Workspace settings for ${workspace.key} not found`);
  }
  const effectiveConfig: EffectiveWorkspaceConfig = {
    defaultAdapterKey: workspaceSettings.defaultAdapterKey ?? adapter.key,
    defaultModel: workspaceSettings.defaultModel,
    workspaceRoot: options?.workspaceRoot ?? workspace.rootPath ?? repoRoot
  };

  return {
    connection,
    runInTransaction: <T>(fn: () => T): T => connection.transaction(fn)(),
    workspace,
    workspaceSettings,
    effectiveConfig,
    repositories: {
      workspaceRepository,
      workspaceSettingsRepository,
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
      documentationRunRepository,
      documentationAgentSessionRepository,
      interactiveReviewSessionRepository,
      interactiveReviewMessageRepository,
      interactiveReviewEntryRepository,
      interactiveReviewResolutionRepository,
      stageRunRepository,
      artifactRepository,
      agentSessionRepository
    },
    workflowService: new WorkflowService({
      repoRoot,
      workspace,
      workspaceSettings,
      workspaceRoot: effectiveConfig.workspaceRoot,
      artifactRoot,
      runInTransaction: <T>(fn: () => T): T => connection.transaction(fn)(),
      adapter,
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
      documentationRunRepository,
      documentationAgentSessionRepository,
      interactiveReviewSessionRepository,
      interactiveReviewMessageRepository,
      interactiveReviewEntryRepository,
      interactiveReviewResolutionRepository,
      stageRunRepository,
      artifactRepository,
      agentSessionRepository
    })
  };
}
