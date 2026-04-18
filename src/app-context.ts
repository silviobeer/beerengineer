import { resolve } from "node:path";

import { LocalCliAdapter } from "./adapters/local-cli-adapter.js";
import { createDatabase } from "./persistence/database.js";
import {
  ArchitecturePlanRepository,
  ArtifactRepository,
  AgentSessionRepository,
  ConceptRepository,
  ItemRepository,
  ProjectRepository,
  StageRunRepository,
  UserStoryRepository
} from "./persistence/repositories.js";
import { baseMigrations } from "./persistence/migration-registry.js";
import { applyMigrations } from "./persistence/migrator.js";
import { WorkflowService } from "./workflow/workflow-service.js";

export type AppContext = {
  connection: {
    close(): void;
  };
  repositories: {
    itemRepository: ItemRepository;
    conceptRepository: ConceptRepository;
    projectRepository: ProjectRepository;
    userStoryRepository: UserStoryRepository;
    architecturePlanRepository: ArchitecturePlanRepository;
    stageRunRepository: StageRunRepository;
    artifactRepository: ArtifactRepository;
    agentSessionRepository: AgentSessionRepository;
  };
  workflowService: WorkflowService;
};

export function createAppContext(dbPath: string): AppContext {
  const repoRoot = resolve(".");
  const artifactRoot = resolve("./var/artifacts");
  const { connection, db } = createDatabase(dbPath);
  applyMigrations(connection, baseMigrations);

  const itemRepository = new ItemRepository(db);
  const conceptRepository = new ConceptRepository(db);
  const projectRepository = new ProjectRepository(db);
  const userStoryRepository = new UserStoryRepository(db);
  const architecturePlanRepository = new ArchitecturePlanRepository(db);
  const stageRunRepository = new StageRunRepository(db);
  const artifactRepository = new ArtifactRepository(db);
  const agentSessionRepository = new AgentSessionRepository(db);
  const adapter = new LocalCliAdapter(repoRoot);

  return {
    connection,
    repositories: {
      itemRepository,
      conceptRepository,
      projectRepository,
      userStoryRepository,
      architecturePlanRepository,
      stageRunRepository,
      artifactRepository,
      agentSessionRepository
    },
    workflowService: new WorkflowService({
      repoRoot,
      artifactRoot,
      adapter,
      itemRepository,
      conceptRepository,
      projectRepository,
      userStoryRepository,
      architecturePlanRepository,
      stageRunRepository,
      artifactRepository,
      agentSessionRepository
    })
  };
}
