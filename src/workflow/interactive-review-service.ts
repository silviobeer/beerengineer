import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { interactiveStoryReviewAgentOutputSchema } from "../schemas/output-contracts.js";
import type { InteractiveStoryReviewAgentOutput } from "../schemas/output-contracts.js";
import { AppError } from "../shared/errors.js";
import { formatAcceptanceCriterionCode } from "../shared/codes.js";
import { assertCanMoveItem } from "../domain/workflow-rules.js";
import { interactiveReviewEntryStatuses, interactiveReviewSeverities } from "../domain/types.js";
import type {
  InteractiveReviewEntryStatus,
  InteractiveReviewResolutionType,
  InteractiveReviewSession,
  InteractiveReviewSeverity
} from "../domain/types.js";
import type { AdapterRuntimeContext, AgentAdapter } from "../adapters/types.js";
import type { InteractiveFlowKey } from "../adapters/runtime.js";
import type { AutorunSummary, AutorunStep } from "./autorun-types.js";
import type { WorkflowDeps } from "./workflow-deps.js";
import type { WorkflowEntityLoaders } from "./entity-loaders.js";

const INTERACTIVE_REVIEW_MARKDOWN_LIMIT = 12000;

function capInteractiveReviewMarkdown(value: string | null): string | null {
  if (!value) {
    return value;
  }
  if (value.length <= INTERACTIVE_REVIEW_MARKDOWN_LIMIT) {
    return value;
  }
  return `${value.slice(0, INTERACTIVE_REVIEW_MARKDOWN_LIMIT)}\n\n…[truncated ${value.length - INTERACTIVE_REVIEW_MARKDOWN_LIMIT} chars of concept markdown]`;
}

const supportedInteractiveReviewResolutionActions = [
  "approve",
  "approve_and_autorun",
  "approve_all",
  "approve_all_and_autorun",
  "approve_selected",
  "request_changes",
  "request_story_revisions",
  "apply_story_edits"
] as const;

type InteractiveReviewServiceOptions = {
  deps: WorkflowDeps;
  loaders: Pick<
    WorkflowEntityLoaders,
    "requireProject" | "requireItem" | "requireStory" | "requireInteractiveReviewSession"
  >;
  resolveInteractiveRuntime(flow: InteractiveFlowKey): {
    providerKey: string;
    adapterKey: string;
    model: string | null;
    policy: AdapterRuntimeContext["policy"];
    adapter: AgentAdapter;
  };
  buildAdapterRuntimeContext(input: {
    providerKey: string;
    model: string | null;
    policy: AdapterRuntimeContext["policy"];
  }): AdapterRuntimeContext;
  approveStories(projectId: string): void;
  buildSnapshot(itemId: string): ReturnType<typeof import("../domain/aggregate-status.js").buildItemWorkflowSnapshot>;
  autorunForProject(input: {
    projectId: string;
    trigger: string;
    initialSteps?: AutorunStep[];
  }): Promise<AutorunSummary>;
  triggerPlanningReview?(input: {
    sourceType: "interactive_review_session";
    sourceId: string;
    step: "requirements_engineering";
    reviewMode: "readiness";
    interactionMode: "interactive";
    automationLevel: "auto_comment";
  }): Promise<unknown>;
};

export class InteractiveReviewService {
  public constructor(private readonly options: InteractiveReviewServiceOptions) {}

  public async startInteractiveReview(input: { type: "stories"; projectId: string }) {
    if (input.type !== "stories") {
      throw new AppError("INTERACTIVE_REVIEW_TYPE_NOT_SUPPORTED", `Review type ${input.type} is not supported yet`);
    }

    const project = this.options.loaders.requireProject(input.projectId);
    const item = this.options.loaders.requireItem(project.itemId);
    const stories = this.options.deps.userStoryRepository.listByProjectId(project.id);
    if (stories.length === 0) {
      throw new AppError("STORIES_NOT_FOUND", "No user stories found for project");
    }

    const existing = this.options.deps.interactiveReviewSessionRepository.findOpenByScope({
      scopeType: "project",
      scopeId: project.id,
      artifactType: "stories",
      reviewType: "collection_review"
    });
    if (existing) {
      const planningReview =
        this.options.triggerPlanningReview && existing.artifactType === "stories" && existing.scopeType === "project"
          ? await this.options.triggerPlanningReview({
              sourceType: "interactive_review_session",
              sourceId: existing.id,
              step: "requirements_engineering",
              reviewMode: "readiness",
              interactionMode: "interactive",
              automationLevel: "auto_comment"
            })
          : undefined;
      return {
        sessionId: existing.id,
        status: existing.status,
        reused: true,
        ...(planningReview ? { planningReview } : {})
      };
    }

    const created = this.options.deps.runInTransaction(() => {
      const session = this.options.deps.interactiveReviewSessionRepository.create({
        scopeType: "project",
        scopeId: project.id,
        artifactType: "stories",
        reviewType: "collection_review",
        status: "open"
      });
      this.options.deps.interactiveReviewMessageRepository.create({
        sessionId: session.id,
        role: "system",
        content: "Interactive review session for project stories.",
        structuredPayloadJson: JSON.stringify(
          {
            itemId: item.id,
            projectId: project.id,
            storyIds: stories.map((story) => story.id)
          },
          null,
          2
        ),
        derivedUpdatesJson: null
      });
      const assistantMessage = this.options.deps.interactiveReviewMessageRepository.create({
        sessionId: session.id,
        role: "assistant",
        content: this.buildStoryReviewKickoffMessage(project.code, stories),
        structuredPayloadJson: JSON.stringify(
          {
            availableActions: [...supportedInteractiveReviewResolutionActions]
          },
          null,
          2
        ),
        derivedUpdatesJson: null
      });
      this.options.deps.interactiveReviewEntryRepository.createMany(
        stories.map((story) => ({
          sessionId: session.id,
          entryType: "story",
          entryId: story.id,
          title: `${story.code} ${story.title}`,
          status: story.status === "approved" ? "accepted" : "pending",
          summary: null,
          changeRequest: null,
          rationale: null,
          severity: null
        }))
      );
      const nextStatus = this.computeInteractiveReviewStatus(
        stories.map((story) => ({
          status: story.status === "approved" ? "accepted" : "pending"
        }))
      );
      this.options.deps.interactiveReviewSessionRepository.update(session.id, {
        lastAssistantMessageId: assistantMessage.id,
        status: nextStatus
      });
      return session;
    });

    const planningReview =
      this.options.triggerPlanningReview && created.artifactType === "stories" && created.scopeType === "project"
        ? await this.options.triggerPlanningReview({
            sourceType: "interactive_review_session",
            sourceId: created.id,
            step: "requirements_engineering",
            reviewMode: "readiness",
            interactionMode: "interactive",
            automationLevel: "auto_comment"
          })
        : undefined;
    return {
      sessionId: created.id,
      status: this.showInteractiveReview(created.id).session.status,
      reused: false,
      ...(planningReview ? { planningReview } : {})
    };
  }

  public showInteractiveReview(sessionId: string) {
    const session = this.options.loaders.requireInteractiveReviewSession(sessionId);
    const messages = this.options.deps.interactiveReviewMessageRepository.listBySessionId(sessionId);
    const entries = this.options.deps.interactiveReviewEntryRepository.listBySessionId(sessionId);
    const resolutions = this.options.deps.interactiveReviewResolutionRepository.listBySessionId(sessionId);

    if (session.artifactType === "stories" && session.scopeType === "project") {
      const project = this.options.loaders.requireProject(session.scopeId);
      const item = this.options.loaders.requireItem(project.itemId);
      const stories = this.options.deps.userStoryRepository.listByProjectId(project.id);
      const acceptanceCriteriaByStoryId = this.groupAcceptanceCriteriaByStoryId(project.id);
      const enrichedStories = stories.map((story) => ({
        ...story,
        acceptanceCriteria: acceptanceCriteriaByStoryId.get(story.id) ?? []
      }));
      return { session, item, project, stories: enrichedStories, messages, entries, resolutions };
    }

    return { session, messages, entries, resolutions };
  }

  public async chatInteractiveReview(sessionId: string, message: string) {
    const session = this.options.loaders.requireInteractiveReviewSession(sessionId);
    this.assertInteractiveReviewOpen(session);
    const storyScope = this.getStoryReviewScope(session);
    const existingMessages = this.options.deps.interactiveReviewMessageRepository.listBySessionId(sessionId).map((entry) => ({
      role: entry.role,
      content: entry.content
    }));
    const existingEntries = this.options.deps.interactiveReviewEntryRepository.listBySessionId(sessionId);
    const entryIdByStoryId = new Map(existingEntries.map((entry) => [entry.entryId, entry.entryId]));
    const acceptanceCriteriaByStoryId = this.groupAcceptanceCriteriaByStoryId(storyScope.project.id);
    const runtime = this.options.resolveInteractiveRuntime("story_review_chat");
    const agentResult = await runtime.adapter.runInteractiveStoryReview({
      runtime: this.options.buildAdapterRuntimeContext(runtime),
      interactionType: "story_review_chat",
      prompt: this.buildInteractiveStoryReviewPrompt(),
      session: {
        id: session.id,
        status: session.status,
        artifactType: "stories",
        reviewType: session.reviewType
      },
      item: {
        id: storyScope.item.id,
        code: storyScope.item.code,
        title: storyScope.item.title,
        description: storyScope.item.description
      },
      project: {
        id: storyScope.project.id,
        code: storyScope.project.code,
        title: storyScope.project.title,
        summary: storyScope.project.summary,
        goal: storyScope.project.goal
      },
      stories: storyScope.stories.map((story) => ({
        id: story.id,
        entryId: entryIdByStoryId.get(story.id) ?? story.id,
        code: story.code,
        title: story.title,
        description: story.description,
        priority: story.priority,
        status: story.status,
        acceptanceCriteria: acceptanceCriteriaByStoryId.get(story.id) ?? []
      })),
      entries: existingEntries.map((entry) => ({
        entryId: entry.entryId,
        title: entry.title,
        status: entry.status,
        summary: entry.summary,
        changeRequest: entry.changeRequest,
        rationale: entry.rationale,
        severity: entry.severity
      })),
      messages: existingMessages,
      userMessage: message,
      allowedStatuses: [...interactiveReviewEntryStatuses],
      allowedActions: ["update_entries", "request_structured_follow_up", "suggest_resolution"],
      upstreamSource: this.loadUpstreamSourceForItem(storyScope.item.id)
    });
    const agentOutput = this.parseInteractiveStoryReviewAgentOutput(agentResult.output);
    const validEntryIds = new Set(existingEntries.map((entry) => entry.entryId));
    for (const update of agentOutput.entryUpdates) {
      if (!validEntryIds.has(update.entryId)) {
        throw new AppError("INTERACTIVE_AGENT_OUTPUT_INVALID", `Interactive review agent referenced unknown entry ${update.entryId}`);
      }
    }
    const derivedUpdates = agentOutput.entryUpdates;

    return this.options.deps.runInTransaction(() => {
      const userMessage = this.options.deps.interactiveReviewMessageRepository.create({
        sessionId,
        role: "user",
        content: message,
        structuredPayloadJson: null,
        derivedUpdatesJson: JSON.stringify(
          {
            entryUpdates: derivedUpdates,
            recommendedResolution: agentOutput.recommendedResolution ?? null
          },
          null,
          2
        )
      });
      this.options.deps.interactiveReviewSessionRepository.update(sessionId, {
        lastUserMessageId: userMessage.id
      });

      for (const update of derivedUpdates) {
        this.options.deps.interactiveReviewEntryRepository.updateByEntryId(sessionId, update.entryId, {
          status: update.status,
          summary: update.summary,
          changeRequest: update.changeRequest,
          severity: update.severity
        });
      }

      const entries = this.options.deps.interactiveReviewEntryRepository.listBySessionId(sessionId);
      const assistantMessage = this.options.deps.interactiveReviewMessageRepository.create({
        sessionId,
        role: "assistant",
        content: agentOutput.assistantMessage,
        structuredPayloadJson: JSON.stringify(
          {
            availableActions: [...supportedInteractiveReviewResolutionActions],
            derivedUpdateCount: derivedUpdates.length,
            needsStructuredFollowUp: agentOutput.needsStructuredFollowUp,
            followUpHint: agentOutput.followUpHint ?? null,
            recommendedResolution: agentOutput.recommendedResolution ?? null
          },
          null,
          2
        ),
        derivedUpdatesJson: JSON.stringify(
          {
            entryUpdates: derivedUpdates,
            recommendedResolution: agentOutput.recommendedResolution ?? null
          },
          null,
          2
        )
      });
      const nextStatus = this.computeInteractiveReviewStatus(entries);
      this.options.deps.interactiveReviewSessionRepository.update(sessionId, {
        lastAssistantMessageId: assistantMessage.id,
        status: nextStatus
      });

      return {
        sessionId,
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        status: nextStatus,
        derivedUpdates,
        needsStructuredFollowUp: agentOutput.needsStructuredFollowUp,
        followUpHint: agentOutput.followUpHint ?? null,
        recommendedResolution: agentOutput.recommendedResolution ?? null
      };
    });
  }

  public updateInteractiveReviewEntry(input: {
    sessionId: string;
    storyId: string;
    status: InteractiveReviewEntryStatus;
    summary?: string;
    changeRequest?: string;
    rationale?: string;
    severity?: "critical" | "high" | "medium" | "low";
  }) {
    const session = this.options.loaders.requireInteractiveReviewSession(input.sessionId);
    this.assertInteractiveReviewOpen(session);
    this.assertInteractiveReviewEntryStatus(input.status);
    this.assertInteractiveReviewSeverity(input.severity);
    const storyScope = this.getStoryReviewScope(session);
    const story = this.options.deps.userStoryRepository.getById(input.storyId);
    if (story?.projectId !== storyScope.project.id) {
      throw new AppError("STORY_NOT_FOUND", `Story ${input.storyId} not found in review scope`);
    }

    this.options.deps.interactiveReviewEntryRepository.updateByEntryId(session.id, story.id, {
      status: input.status,
      summary: input.summary ?? null,
      changeRequest: input.changeRequest ?? null,
      rationale: input.rationale ?? null,
      severity: input.severity ?? null
    });
    const entries = this.options.deps.interactiveReviewEntryRepository.listBySessionId(session.id);
    const nextStatus = this.computeInteractiveReviewStatus(entries);
    this.options.deps.interactiveReviewSessionRepository.update(session.id, {
      status: nextStatus
    });
    return {
      sessionId: session.id,
      storyId: story.id,
      status: nextStatus
    };
  }

  public applyInteractiveReviewStoryEdits(input: {
    sessionId: string;
    storyId: string;
    title?: string;
    description?: string;
    actor?: string;
    goal?: string;
    benefit?: string;
    priority?: string;
    acceptanceCriteria?: string[];
    summary?: string;
    rationale?: string;
    status?: Extract<InteractiveReviewEntryStatus, "resolved" | "accepted" | "needs_revision">;
  }) {
    const session = this.options.loaders.requireInteractiveReviewSession(input.sessionId);
    this.assertInteractiveReviewOpen(session);
    const storyScope = this.getStoryReviewScope(session);
    const story = this.options.loaders.requireStory(input.storyId);
    if (story.projectId !== storyScope.project.id) {
      throw new AppError("STORY_NOT_FOUND", `Story ${input.storyId} not found in review scope`);
    }

    const sanitizedAcceptanceCriteria = input.acceptanceCriteria?.map((criterion) => criterion.trim()).filter(Boolean);
    if (sanitizedAcceptanceCriteria?.length === 0) {
      throw new AppError("ACCEPTANCE_CRITERIA_INVALID", "Acceptance criteria must not be empty when provided");
    }
    const nextEntryStatus = input.status ?? "resolved";

    const updatedStory = this.options.deps.runInTransaction(() => {
      this.options.deps.userStoryRepository.update(story.id, {
        ...(input.title === undefined ? {} : { title: input.title.trim() }),
        ...(input.description === undefined ? {} : { description: input.description.trim() }),
        ...(input.actor === undefined ? {} : { actor: input.actor.trim() }),
        ...(input.goal === undefined ? {} : { goal: input.goal.trim() }),
        ...(input.benefit === undefined ? {} : { benefit: input.benefit.trim() }),
        ...(input.priority === undefined ? {} : { priority: input.priority.trim() }),
        status: "draft"
      });

      if (sanitizedAcceptanceCriteria) {
        this.options.deps.acceptanceCriterionRepository.deleteByStoryId(story.id);
        this.options.deps.acceptanceCriterionRepository.createMany(
          sanitizedAcceptanceCriteria.map((criterion, index) => ({
            storyId: story.id,
            code: formatAcceptanceCriterionCode(story.code, index + 1),
            text: criterion,
            position: index
          }))
        );
      }

      this.options.deps.interactiveReviewEntryRepository.updateByEntryId(session.id, story.id, {
        status: nextEntryStatus,
        summary: input.summary ?? "Guided edits applied",
        changeRequest: null,
        rationale: input.rationale ?? null,
        severity: null
      });
      const assistantMessage = this.options.deps.interactiveReviewMessageRepository.create({
        sessionId: session.id,
        role: "assistant",
        content: `Applied guided edits to ${story.code}.`,
        structuredPayloadJson: JSON.stringify(
          {
            storyId: story.id,
            changedFields: [
              ...(input.title === undefined ? [] : ["title"]),
              ...(input.description === undefined ? [] : ["description"]),
              ...(input.actor === undefined ? [] : ["actor"]),
              ...(input.goal === undefined ? [] : ["goal"]),
              ...(input.benefit === undefined ? [] : ["benefit"]),
              ...(input.priority === undefined ? [] : ["priority"]),
              ...(sanitizedAcceptanceCriteria ? ["acceptanceCriteria"] : [])
            ]
          },
          null,
          2
        ),
        derivedUpdatesJson: JSON.stringify(
          {
            entryUpdates: [
              {
                entryId: story.id,
                status: nextEntryStatus
              }
            ]
          },
          null,
          2
        )
      });
      const entries = this.options.deps.interactiveReviewEntryRepository.listBySessionId(session.id);
      this.options.deps.interactiveReviewSessionRepository.update(session.id, {
        lastAssistantMessageId: assistantMessage.id,
        status: this.computeInteractiveReviewStatus(entries)
      });
      return this.options.loaders.requireStory(story.id);
    });

    return {
      sessionId: session.id,
      story: updatedStory,
      acceptanceCriteria: this.options.deps.acceptanceCriterionRepository.listByStoryId(story.id)
    };
  }

  public async resolveInteractiveReview(input: {
    sessionId: string;
    action: Extract<
      InteractiveReviewResolutionType,
      | "approve"
      | "approve_and_autorun"
      | "approve_all"
      | "approve_all_and_autorun"
      | "approve_selected"
      | "request_changes"
      | "request_story_revisions"
      | "apply_story_edits"
    >;
    storyIds?: string[];
    rationale?: string;
  }) {
    const session = this.options.loaders.requireInteractiveReviewSession(input.sessionId);
    this.assertInteractiveReviewOpen(session);
    this.assertInteractiveReviewResolutionAction(input.action);
    const storyScope = this.getStoryReviewScope(session);
    const { project, item } = storyScope;
    const targetedStoryIds = input.storyIds ? this.resolveInteractiveReviewStoryIds(project.id, input.storyIds) : [];
    const resolution = this.options.deps.runInTransaction(() =>
      this.applyInteractiveReviewResolutionInTransaction(input, session.id, project.id, item.id, targetedStoryIds)
    );

    if (input.action === "approve_and_autorun" || input.action === "approve_all_and_autorun") {
      const autorun = await this.options.autorunForProject({
        projectId: project.id,
        trigger: "review:resolve",
        initialSteps: [{ action: "review:resolve", scopeType: "project", scopeId: project.id, status: "approved" }]
      });
      this.options.deps.interactiveReviewResolutionRepository.updatePayloadJson(
        resolution.id,
        JSON.stringify(
          {
            ...(input.rationale ? { rationale: input.rationale } : {}),
            autorun
          },
          null,
          2
        )
      );
      return {
        sessionId: session.id,
        resolutionId: resolution.id,
        status: "resolved",
        autorun
      };
    }

    return {
      sessionId: session.id,
      resolutionId: resolution.id,
      status: "resolved",
      action: input.action
    };
  }

  private getStoryReviewScope(session: InteractiveReviewSession) {
    this.assertStoryProjectSession(session);
    const project = this.options.loaders.requireProject(session.scopeId);
    const item = this.options.loaders.requireItem(project.itemId);
    const stories = this.options.deps.userStoryRepository.listByProjectId(project.id);
    return { item, project, stories };
  }

  private buildStoryReviewKickoffMessage(projectCode: string, stories: Array<{ code: string; title: string; priority: string }>): string {
    const storyLines = stories.map((story) => `- ${story.code}: ${story.title} (${story.priority})`).join("\n");
    return [
      `Story review for ${projectCode} is open.`,
      "",
      "Current scope:",
      storyLines,
      "",
      "Use `review:chat` for feedback, `review:entry:update` for structured per-story status, `review:story:edit` for guided edits, then finish with `review:resolve`."
    ].join("\n");
  }

  private buildInteractiveStoryReviewPrompt(): string {
    return [
      "You are assisting an interactive review of project stories.",
      "Return only structured per-story entry updates grounded in the provided stories, entries, and chat history.",
      "Only update entries when the user message clearly references a specific story or an unambiguous set of stories.",
      "If the user feedback is ambiguous, leave entryUpdates empty and set needsStructuredFollowUp=true with a short hint.",
      "Do not directly mutate stories or resolve the workflow. Suggest next steps through the structured response.",
      "",
      "Coverage check:",
      "- The `upstreamSource` payload carries the brainstorm draft and the concept markdown this project derives from.",
      "- For every target user, use case, constraint, non-goal, and risk in the upstream source, verify that it is represented in a story or explicitly declared out of scope.",
      "- If any source entry is uncovered, flag it via a follow-up hint or by updating the matching story entry to `needs_revision` with a concrete `changeRequest` pointing at the missing source entry.",
      "- Never recommend `approve` or `approve_all` while any mandatory source entry (target user, core use case, hard constraint) is uncovered."
    ].join("\n");
  }

  private loadUpstreamSourceForItem(itemId: string): {
    conceptMarkdown: string | null;
    brainstormDraft: {
      problem: string | null;
      coreOutcome: string | null;
      targetUsers: string[];
      useCases: string[];
      constraints: string[];
      nonGoals: string[];
      risks: string[];
      assumptions: string[];
      openQuestions: string[];
      candidateDirections: string[];
      recommendedDirection: string | null;
      scopeNotes: string | null;
    } | null;
  } | null {
    const session = this.options.deps.brainstormSessionRepository.getLatestByItemId(itemId);
    const draft = session ? this.options.deps.brainstormDraftRepository.getLatestBySessionId(session.id) : null;
    const brainstormDraft = draft
      ? {
          problem: draft.problem,
          coreOutcome: draft.coreOutcome,
          targetUsers: JSON.parse(draft.targetUsersJson) as string[],
          useCases: JSON.parse(draft.useCasesJson) as string[],
          constraints: JSON.parse(draft.constraintsJson) as string[],
          nonGoals: JSON.parse(draft.nonGoalsJson) as string[],
          risks: JSON.parse(draft.risksJson) as string[],
          assumptions: JSON.parse(draft.assumptionsJson) as string[],
          openQuestions: JSON.parse(draft.openQuestionsJson) as string[],
          candidateDirections: JSON.parse(draft.candidateDirectionsJson) as string[],
          recommendedDirection: draft.recommendedDirection,
          scopeNotes: draft.scopeNotes
        }
      : null;

    let conceptMarkdown: string | null = null;
    if (!brainstormDraft) {
      const concept = this.options.deps.conceptRepository.getLatestByItemId(itemId);
      if (concept) {
        const artifact = this.options.deps.artifactRepository.getById(concept.markdownArtifactId);
        if (artifact) {
          try {
            conceptMarkdown = capInteractiveReviewMarkdown(
              readFileSync(resolve(this.options.deps.artifactRoot, artifact.path), "utf8")
            );
          } catch {
            conceptMarkdown = null;
          }
        }
      }
    }

    if (!conceptMarkdown && !brainstormDraft) {
      return null;
    }
    return { conceptMarkdown, brainstormDraft };
  }

  private parseInteractiveStoryReviewAgentOutput(output: unknown): InteractiveStoryReviewAgentOutput {
    const parsed = interactiveStoryReviewAgentOutputSchema.safeParse(output);
    if (!parsed.success) {
      throw new AppError("INTERACTIVE_AGENT_OUTPUT_INVALID", parsed.error.message);
    }
    return parsed.data;
  }

  private computeInteractiveReviewStatus(entries: Array<{ status: string }>): "waiting_for_user" | "ready_for_resolution" {
    return entries.length > 0 && entries.every((entry) => entry.status !== "pending") ? "ready_for_resolution" : "waiting_for_user";
  }

  private resolveInteractiveReviewStoryIds(projectId: string, storyIds: string[]): string[] {
    const uniqueStoryIds = Array.from(new Set(storyIds));
    const projectStoryIds = new Set(this.options.deps.userStoryRepository.listByProjectId(projectId).map((story) => story.id));
    for (const storyId of uniqueStoryIds) {
      if (!projectStoryIds.has(storyId)) {
        throw new AppError("STORY_NOT_FOUND", `Story ${storyId} not found in review scope`);
      }
    }
    return uniqueStoryIds;
  }

  private applyInteractiveReviewResolutionInTransaction(
    input: Parameters<InteractiveReviewService["resolveInteractiveReview"]>[0],
    sessionId: string,
    projectId: string,
    itemId: string,
    targetedStoryIds: string[]
  ) {
    const payload = {
      ...(input.rationale ? { rationale: input.rationale } : {}),
      ...(targetedStoryIds.length > 0 ? { storyIds: targetedStoryIds } : {})
    };
    const createdResolution = this.options.deps.interactiveReviewResolutionRepository.create({
      sessionId,
      resolutionType: input.action,
      payloadJson: Object.keys(payload).length > 0 ? JSON.stringify(payload, null, 2) : null
    });

    this.applyStoryApprovalAction(input.action, sessionId, projectId, targetedStoryIds);
    this.applyReviewRequiredAction(input, sessionId, itemId, targetedStoryIds);
    this.applyStoryEditsResolution(input, sessionId, itemId, targetedStoryIds);

    this.options.deps.interactiveReviewResolutionRepository.markApplied(createdResolution.id);
    this.options.deps.interactiveReviewSessionRepository.update(sessionId, {
      status: "resolved",
      resolvedAt: Date.now()
    });
    return createdResolution;
  }

  private applyStoryApprovalAction(
    action: Parameters<InteractiveReviewService["resolveInteractiveReview"]>[0]["action"],
    sessionId: string,
    projectId: string,
    targetedStoryIds: string[]
  ) {
    if (action === "approve" || action === "approve_and_autorun" || action === "approve_all" || action === "approve_all_and_autorun") {
      this.options.approveStories(projectId);
      return;
    }
    if (action !== "approve_selected") {
      return;
    }
    if (targetedStoryIds.length === 0) {
      throw new AppError("INTERACTIVE_REVIEW_STORY_IDS_REQUIRED", "approve_selected requires at least one story id");
    }
    this.options.deps.userStoryRepository.approveByIds(targetedStoryIds);
    for (const storyId of targetedStoryIds) {
      this.options.deps.interactiveReviewEntryRepository.updateByEntryId(sessionId, storyId, {
        status: "accepted",
        summary: "Approved via selected resolution",
        changeRequest: null
      });
    }
    this.maybeAdvanceAfterPartialStoryApproval(projectId);
  }

  private applyReviewRequiredAction(
    input: Parameters<InteractiveReviewService["resolveInteractiveReview"]>[0],
    sessionId: string,
    itemId: string,
    targetedStoryIds: string[]
  ) {
    if (input.action !== "request_changes" && input.action !== "request_story_revisions") {
      return;
    }
    const affectedStoryIds =
      targetedStoryIds.length > 0
        ? targetedStoryIds
        : this.options.deps.interactiveReviewEntryRepository
            .listBySessionId(sessionId)
            .filter((entry) => entry.entryType === "story")
            .map((entry) => entry.entryId);
    if (input.action === "request_story_revisions") {
      for (const storyId of affectedStoryIds) {
        this.options.deps.interactiveReviewEntryRepository.updateByEntryId(sessionId, storyId, {
          status: "needs_revision",
          summary: "Revision requested via session resolution",
          changeRequest: input.rationale ?? "Revise the story based on review feedback"
        });
      }
    }
    this.options.deps.itemRepository.updatePhaseStatus(itemId, "review_required");
  }

  private applyStoryEditsResolution(
    input: Parameters<InteractiveReviewService["resolveInteractiveReview"]>[0],
    sessionId: string,
    itemId: string,
    targetedStoryIds: string[]
  ) {
    if (input.action !== "apply_story_edits") {
      return;
    }
    if (targetedStoryIds.length === 0) {
      throw new AppError("INTERACTIVE_REVIEW_STORY_IDS_REQUIRED", "apply_story_edits requires at least one edited story id");
    }
    for (const storyId of targetedStoryIds) {
      this.options.deps.interactiveReviewEntryRepository.updateByEntryId(sessionId, storyId, {
        status: "resolved",
        summary: "Guided edits applied and accepted for follow-up workflow",
        changeRequest: null,
        rationale: input.rationale ?? null
      });
    }
    this.options.deps.itemRepository.updatePhaseStatus(itemId, "draft");
  }

  private maybeAdvanceAfterPartialStoryApproval(projectId: string): void {
    const project = this.options.loaders.requireProject(projectId);
    const snapshot = this.options.buildSnapshot(project.itemId);
    if (!snapshot.allStoriesApproved) {
      return;
    }
    const item = this.options.loaders.requireItem(project.itemId);
    assertCanMoveItem(item.currentColumn, "implementation", snapshot);
    this.options.deps.itemRepository.updateColumn(project.itemId, "implementation", "draft");
  }

  private assertInteractiveReviewOpen(session: InteractiveReviewSession): void {
    if (session.status === "resolved" || session.status === "cancelled") {
      throw new AppError("INTERACTIVE_REVIEW_CLOSED", `Interactive review session ${session.id} is already closed`);
    }
  }

  private assertStoryProjectSession(session: InteractiveReviewSession): void {
    if (session.scopeType !== "project" || session.artifactType !== "stories") {
      throw new AppError("INTERACTIVE_REVIEW_TYPE_NOT_SUPPORTED", "Session is not a story review");
    }
  }

  private assertInteractiveReviewEntryStatus(status: string): asserts status is InteractiveReviewEntryStatus {
    if (!(interactiveReviewEntryStatuses as readonly string[]).includes(status)) {
      throw new AppError("INTERACTIVE_REVIEW_ENTRY_STATUS_INVALID", `Interactive review entry status ${status} is invalid`);
    }
  }

  private assertInteractiveReviewSeverity(severity?: string): asserts severity is InteractiveReviewSeverity | undefined {
    if (severity !== undefined && !(interactiveReviewSeverities as readonly string[]).includes(severity)) {
      throw new AppError("INTERACTIVE_REVIEW_SEVERITY_INVALID", `Interactive review severity ${severity} is invalid`);
    }
  }

  private assertInteractiveReviewResolutionAction(
    action: string
  ): asserts action is (typeof supportedInteractiveReviewResolutionActions)[number] {
    if (!(supportedInteractiveReviewResolutionActions as readonly string[]).includes(action)) {
      throw new AppError("INTERACTIVE_REVIEW_ACTION_INVALID", `Interactive review action ${action} is invalid`);
    }
  }

  private groupAcceptanceCriteriaByStoryId(projectId: string) {
    return this.options.deps.acceptanceCriterionRepository.listByProjectId(projectId).reduce((map, criterion) => {
      const current = map.get(criterion.storyId) ?? [];
      current.push(criterion);
      map.set(criterion.storyId, current);
      return map;
    }, new Map<string, ReturnType<WorkflowDeps["acceptanceCriterionRepository"]["listByProjectId"]>>());
  }
}
