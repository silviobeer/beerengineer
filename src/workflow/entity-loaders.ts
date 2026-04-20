import type { AppVerificationRun, BrainstormDraft, BrainstormSession, InteractiveReviewSession } from "../domain/types.js";
import { AppError } from "../shared/errors.js";
import type { WorkflowDeps } from "./workflow-deps.js";

export function createWorkflowEntityLoaders(deps: WorkflowDeps) {
  const requireItem = (itemId: string) => {
    const item = deps.itemRepository.getById(itemId);
    if (!item) {
      throw new AppError("ITEM_NOT_FOUND", `Item ${itemId} not found`);
    }
    if (item.workspaceId !== deps.workspace.id) {
      throw new AppError("ITEM_NOT_FOUND", `Item ${itemId} not found in workspace ${deps.workspace.key}`);
    }
    return item;
  };

  const requireProject = (projectId: string) => {
    const project = deps.projectRepository.getById(projectId);
    if (!project) {
      throw new AppError("PROJECT_NOT_FOUND", `Project ${projectId} not found`);
    }
    requireItem(project.itemId);
    return project;
  };

  const requireStory = (storyId: string) => {
    const story = deps.userStoryRepository.getById(storyId);
    if (!story) {
      throw new AppError("STORY_NOT_FOUND", `Story ${storyId} not found`);
    }
    requireProject(story.projectId);
    return story;
  };

  const requireAcceptanceCriterion = (acceptanceCriterionId: string) => {
    const acceptanceCriterion = deps.acceptanceCriterionRepository.getById(acceptanceCriterionId);
    if (!acceptanceCriterion) {
      throw new AppError("ACCEPTANCE_CRITERION_NOT_FOUND", `Acceptance criterion ${acceptanceCriterionId} not found`);
    }
    requireStory(acceptanceCriterion.storyId);
    return acceptanceCriterion;
  };

  const requireWave = (waveId: string) => {
    const wave = deps.waveRepository.getById(waveId);
    if (!wave) {
      throw new AppError("WAVE_NOT_FOUND", `Wave ${waveId} not found`);
    }
    return wave;
  };

  const requireWaveStory = (waveStoryId: string) => {
    const waveStory = deps.waveStoryRepository.getById(waveStoryId);
    if (!waveStory) {
      throw new AppError("WAVE_STORY_NOT_FOUND", `Wave story ${waveStoryId} not found`);
    }
    requireStory(waveStory.storyId);
    return waveStory;
  };

  const requireWaveStoryByStoryId = (storyId: string) => {
    const waveStory = deps.waveStoryRepository.getByStoryId(storyId);
    if (!waveStory) {
      throw new AppError("WAVE_STORY_NOT_FOUND", `No wave story found for story ${storyId}`);
    }
    return waveStory;
  };

  const requireWaveExecution = (waveExecutionId: string) => {
    const waveExecution = deps.waveExecutionRepository.getById(waveExecutionId);
    if (!waveExecution) {
      throw new AppError("WAVE_EXECUTION_NOT_FOUND", `Wave execution ${waveExecutionId} not found`);
    }
    return waveExecution;
  };

  const requireWaveStoryTestRun = (waveStoryTestRunId: string) => {
    const waveStoryTestRun = deps.waveStoryTestRunRepository.getById(waveStoryTestRunId);
    if (!waveStoryTestRun) {
      throw new AppError("WAVE_STORY_TEST_RUN_NOT_FOUND", `Wave story test run ${waveStoryTestRunId} not found`);
    }
    return waveStoryTestRun;
  };

  const requireWaveStoryExecution = (waveStoryExecutionId: string) => {
    const waveStoryExecution = deps.waveStoryExecutionRepository.getById(waveStoryExecutionId);
    if (!waveStoryExecution) {
      throw new AppError("WAVE_STORY_EXECUTION_NOT_FOUND", `Wave story execution ${waveStoryExecutionId} not found`);
    }
    return waveStoryExecution;
  };

  const requireAppVerificationRun = (appVerificationRunId: string): AppVerificationRun => {
    const appVerificationRun = deps.appVerificationRunRepository.getById(appVerificationRunId);
    if (!appVerificationRun) {
      throw new AppError("APP_VERIFICATION_RUN_NOT_FOUND", `App verification run ${appVerificationRunId} not found`);
    }
    requireWaveStoryExecution(appVerificationRun.waveStoryExecutionId);
    return appVerificationRun;
  };

  const requireStoryReviewRun = (storyReviewRunId: string) => {
    const storyReviewRun = deps.storyReviewRunRepository.getById(storyReviewRunId);
    if (!storyReviewRun) {
      throw new AppError("STORY_REVIEW_RUN_NOT_FOUND", `Story review run ${storyReviewRunId} not found`);
    }
    requireWaveStoryExecution(storyReviewRun.waveStoryExecutionId);
    return storyReviewRun;
  };

  const requireStoryReviewRemediationRun = (storyReviewRemediationRunId: string) => {
    const remediationRun = deps.storyReviewRemediationRunRepository.getById(storyReviewRemediationRunId);
    if (!remediationRun) {
      throw new AppError(
        "STORY_REVIEW_REMEDIATION_RUN_NOT_FOUND",
        `Story review remediation run ${storyReviewRemediationRunId} not found`
      );
    }
    return remediationRun;
  };

  const requireQaRun = (qaRunId: string) => {
    const qaRun = deps.qaRunRepository.getById(qaRunId);
    if (!qaRun) {
      throw new AppError("QA_RUN_NOT_FOUND", `QA run ${qaRunId} not found`);
    }
    requireProject(qaRun.projectId);
    return qaRun;
  };

  const requireDocumentationRun = (documentationRunId: string) => {
    const documentationRun = deps.documentationRunRepository.getById(documentationRunId);
    if (!documentationRun) {
      throw new AppError("DOCUMENTATION_RUN_NOT_FOUND", `Documentation run ${documentationRunId} not found`);
    }
    requireProject(documentationRun.projectId);
    return documentationRun;
  };

  const requireInteractiveReviewSession = (sessionId: string): InteractiveReviewSession => {
    const session = deps.interactiveReviewSessionRepository.getById(sessionId);
    if (!session) {
      throw new AppError("INTERACTIVE_REVIEW_SESSION_NOT_FOUND", `Interactive review session ${sessionId} not found`);
    }
    if (session.scopeType === "project" || session.scopeType === "story_collection") {
      requireProject(session.scopeId);
    } else if (session.scopeType === "story") {
      requireStory(session.scopeId);
    } else if (session.scopeType === "concept" || session.scopeType === "item") {
      requireItem(session.scopeId);
    } else if (session.scopeType === "architecture" || session.scopeType === "implementation_plan") {
      requireProject(session.scopeId);
    } else if (session.scopeType === "qa_run") {
      requireQaRun(session.scopeId);
    } else if (session.scopeType === "documentation_run") {
      requireDocumentationRun(session.scopeId);
    }
    return session;
  };

  const requireBrainstormSession = (sessionId: string): BrainstormSession => {
    const session = deps.brainstormSessionRepository.getById(sessionId);
    if (!session) {
      throw new AppError("BRAINSTORM_SESSION_NOT_FOUND", `Brainstorm session ${sessionId} not found`);
    }
    requireItem(session.itemId);
    return session;
  };

  const requireLatestBrainstormDraft = (sessionId: string): BrainstormDraft => {
    const draft = deps.brainstormDraftRepository.getLatestBySessionId(sessionId);
    if (!draft) {
      throw new AppError("BRAINSTORM_DRAFT_NOT_FOUND", `No brainstorm draft found for session ${sessionId}`);
    }
    return draft;
  };

  const requireImplementationPlanForProject = (projectId: string) => {
    const implementationPlan = deps.implementationPlanRepository.getLatestByProjectId(projectId);
    if (!implementationPlan || implementationPlan.status !== "approved") {
      throw new AppError("IMPLEMENTATION_PLAN_NOT_APPROVED", "Approved implementation plan is required for execution");
    }
    return implementationPlan;
  };

  return {
    requireItem,
    requireProject,
    requireStory,
    requireAcceptanceCriterion,
    requireWave,
    requireWaveStory,
    requireWaveStoryByStoryId,
    requireWaveExecution,
    requireWaveStoryTestRun,
    requireWaveStoryExecution,
    requireAppVerificationRun,
    requireStoryReviewRun,
    requireStoryReviewRemediationRun,
    requireQaRun,
    requireDocumentationRun,
    requireInteractiveReviewSession,
    requireBrainstormSession,
    requireLatestBrainstormDraft,
    requireImplementationPlanForProject
  };
}

export type WorkflowEntityLoaders = ReturnType<typeof createWorkflowEntityLoaders>;
