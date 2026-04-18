import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { LocalCliAdapter } from "./adapters/local-cli-adapter.js";
import { createDatabase } from "./persistence/database.js";
import {
  AcceptanceCriterionRepository,
  ArchitecturePlanRepository,
  ArtifactRepository,
  AgentSessionRepository,
  ConceptRepository,
  ExecutionAgentSessionRepository,
  ImplementationPlanRepository,
  ItemRepository,
  ProjectExecutionContextRepository,
  ProjectRepository,
  StageRunRepository,
  TestAgentSessionRepository,
  UserStoryRepository,
  VerificationRunRepository,
  WaveRepository,
  WaveExecutionRepository,
  WaveStoryTestRunRepository,
  WaveStoryDependencyRepository,
  WaveStoryExecutionRepository,
  WaveStoryRepository
} from "./persistence/repositories.js";
import { baseMigrations } from "./persistence/migration-registry.js";
import { applyMigrations } from "./persistence/migrator.js";
import { WorkflowService } from "./workflow/workflow-service.js";

export type AppContext = {
  connection: {
    prepare(sql: string): {
      get(...args: unknown[]): unknown;
    };
    close(): void;
  };
  runInTransaction<T>(fn: () => T): T;
  repositories: {
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
    stageRunRepository: StageRunRepository;
    artifactRepository: ArtifactRepository;
    agentSessionRepository: AgentSessionRepository;
  };
  workflowService: WorkflowService;
};

export function createAppContext(dbPath: string): AppContext {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const artifactRoot = resolve(repoRoot, "var/artifacts");
  const { connection, db } = createDatabase(dbPath);
  applyMigrations(connection, baseMigrations);

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
  const stageRunRepository = new StageRunRepository(db);
  const artifactRepository = new ArtifactRepository(db);
  const agentSessionRepository = new AgentSessionRepository(db);
  const adapter = new LocalCliAdapter(repoRoot);

  return {
    connection,
    runInTransaction: <T>(fn: () => T): T => connection.transaction(fn)(),
    repositories: {
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
      stageRunRepository,
      artifactRepository,
      agentSessionRepository
    },
    workflowService: new WorkflowService({
      repoRoot,
      artifactRoot,
      runInTransaction: <T>(fn: () => T): T => connection.transaction(fn)(),
      adapter,
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
      stageRunRepository,
      artifactRepository,
      agentSessionRepository
    })
  };
}
