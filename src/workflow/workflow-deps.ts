import type {
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
  ProjectExecutionContextRepository,
  ProjectRepository,
  QaAgentSessionRepository,
  QaFindingRepository,
  QaRunRepository,
  StageRunRepository,
  StoryReviewAgentSessionRepository,
  StoryReviewFindingRepository,
  StoryReviewRemediationAgentSessionRepository,
  StoryReviewRemediationFindingRepository,
  StoryReviewRemediationRunRepository,
  StoryReviewRunRepository,
  TestAgentSessionRepository,
  UserStoryRepository,
  VerificationRunRepository,
  WaveExecutionRepository,
  WaveRepository,
  WaveStoryDependencyRepository,
  WaveStoryExecutionRepository,
  WaveStoryRepository,
  WaveStoryTestRunRepository,
  AcceptanceCriterionRepository
} from "../persistence/repositories.js";
import type { Workspace, WorkspaceSettings } from "../domain/types.js";
import type { AgentRuntimeResolver } from "../adapters/runtime.js";

export type WorkflowDeps = {
  repoRoot: string;
  workspace: Workspace;
  workspaceSettings: WorkspaceSettings;
  workspaceRoot: string;
  artifactRoot: string;
  runInTransaction<T>(fn: () => T): T;
  agentRuntimeResolver: AgentRuntimeResolver;
  itemRepository: ItemRepository;
  brainstormSessionRepository: BrainstormSessionRepository;
  brainstormMessageRepository: BrainstormMessageRepository;
  brainstormDraftRepository: BrainstormDraftRepository;
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
  appVerificationRunRepository: AppVerificationRunRepository;
};
