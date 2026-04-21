import type { ArtifactService } from "../services/artifact-service.js";
import type { AdapterRuntimeContext } from "../adapters/types.js";
import type { AutorunStep, AutorunSummary } from "./autorun-types.js";
import type {
  BrainstormDraft,
  BrainstormDraftStatus,
  BrainstormSession,
  BrainstormSessionMode,
  BrainstormSessionStatus
} from "../domain/types.js";
import type { InteractiveBrainstormAgentOutput } from "../schemas/output-contracts.js";
import { interactiveBrainstormAgentOutputSchema } from "../schemas/output-contracts.js";
import { AppError } from "../shared/errors.js";
import type { ArtifactRecord } from "../persistence/repositories.js";
import type { WorkflowDeps } from "./workflow-deps.js";
import type { WorkflowEntityLoaders } from "./entity-loaders.js";
import {
  extractBrainstormMessageStructure,
  extractLabeledBrainstormLists,
  hasAnyExtraction,
  mergeBrainstormMessageStructures,
  type BrainstormExtraction,
  type BrainstormListExtractionField,
  type BrainstormMessageStructure
} from "./brainstorm-message-parser.js";
import { deriveGenericUpstreamContext } from "./upstream-context.js";
import { assertStageRunTransitionAllowed } from "./stage-run-rules.js";
import type { StageOwnedReviewFeedback } from "./stage-owned-review-feedback.js";

export type BrainstormDraftView = {
  id: string;
  itemId: string;
  sessionId: string;
  revision: number;
  status: BrainstormDraftStatus;
  problem: string | null;
  targetUsers: string[];
  coreOutcome: string | null;
  useCases: string[];
  constraints: string[];
  nonGoals: string[];
  risks: string[];
  openQuestions: string[];
  candidateDirections: string[];
  recommendedDirection: string | null;
  scopeNotes: string | null;
  assumptions: string[];
  lastUpdatedAt: number;
  lastUpdatedFromMessageId: string | null;
};

type BrainstormReviewFinding = {
  severity: "major";
  field:
    | "problem"
    | "coreOutcome"
    | "targetUsers"
    | "useCases"
    | "constraints"
    | "nonGoals"
    | "risks"
    | "assumptions"
    | "openQuestions"
    | "candidateDirections"
    | "recommendedDirection"
    | "projectShape";
  summary: string;
  detail: string;
};

type BrainstormProjectShapeAssessment = {
  recommendation: "single_project" | "split_projects" | "undecided";
  rationale: string;
  suggestedSeeds: string[];
};

type BrainstormReviewSummary = {
  status: "clean" | "auto_backfilled" | "needs_follow_up";
  summary: string;
  findings: BrainstormReviewFinding[];
  projectShape: BrainstormProjectShapeAssessment;
  autoApplied: Array<{
    field:
      | "problem"
      | "coreOutcome"
      | "targetUsers"
      | "useCases"
      | "constraints"
      | "nonGoals"
      | "risks"
      | "assumptions"
      | "openQuestions"
      | "candidateDirections"
      | "recommendedDirection"
      | "scopeNotes";
    values: string[];
  }>;
};

type BrainstormLoopState = {
  owner: "stage_llm";
  status: "clean" | "revising" | "needs_user_input";
  question: string | null;
  followUpHint: string | null;
  reviewFeedback: StageOwnedReviewFeedback[];
};

type BrainstormServiceOptions = {
  deps: WorkflowDeps;
  artifactService: ArtifactService;
  loaders: Pick<WorkflowEntityLoaders, "requireItem" | "requireBrainstormSession" | "requireLatestBrainstormDraft">;
  approveConcept(conceptId: string): void;
  triggerPlanningReview(input: {
    sourceType: "brainstorm_session";
    sourceId: string;
    step: "requirements_engineering";
    reviewMode: "readiness";
    interactionMode: "interactive";
    automationLevel: "auto_comment";
  }): Promise<unknown>;
  autorunForItem(input: { itemId: string; trigger: string; initialSteps?: AutorunStep[] }): Promise<AutorunSummary>;
};

export class BrainstormService {
  public constructor(private readonly options: BrainstormServiceOptions) {}

  public startBrainstormSession(itemId: string) {
    const item = this.options.loaders.requireItem(itemId);
    const existing = this.options.deps.brainstormSessionRepository.findOpenByItemId(item.id);
    if (existing) {
      return {
        sessionId: existing.id,
        status: existing.status,
        reused: true
      };
    }

    const created = this.options.deps.runInTransaction(() => {
      if (item.currentColumn === "idea") {
        this.options.deps.itemRepository.updateColumn(item.id, "brainstorm", "running");
      }
      const session = this.options.deps.brainstormSessionRepository.create({
        itemId: item.id,
        status: "open",
        mode: "explore"
      });
      this.options.deps.brainstormMessageRepository.create({
        sessionId: session.id,
        role: "system",
        content: "Interactive brainstorm session for item.",
        structuredPayloadJson: JSON.stringify(
          {
            itemId: item.id,
            itemCode: item.code
          },
          null,
          2
        ),
        derivedUpdatesJson: null
      });
      const draft = this.options.deps.brainstormDraftRepository.create({
        itemId: item.id,
        sessionId: session.id,
        revision: 1,
        status: "needs_input",
        problem: item.description || item.title,
        targetUsersJson: JSON.stringify([]),
        coreOutcome: item.title,
        useCasesJson: JSON.stringify([]),
        constraintsJson: JSON.stringify([]),
        nonGoalsJson: JSON.stringify([]),
        risksJson: JSON.stringify([]),
        openQuestionsJson: JSON.stringify(["What is the smallest useful user outcome for this item?"]),
        candidateDirectionsJson: JSON.stringify([]),
        recommendedDirection: null,
        scopeNotes: null,
        assumptionsJson: JSON.stringify([]),
        lastUpdatedFromMessageId: null
      });
      const assistantMessage = this.options.deps.brainstormMessageRepository.create({
        sessionId: session.id,
        role: "assistant",
        content: this.buildBrainstormKickoffMessage(item),
        structuredPayloadJson: JSON.stringify(
          {
            draftRevision: draft.revision
          },
          null,
          2
        ),
        derivedUpdatesJson: null
      });
      const nextStatus = this.computeBrainstormSessionStatus(draft);
      const nextMode = this.computeBrainstormSessionMode(draft);
      this.options.deps.brainstormSessionRepository.update(session.id, {
        status: nextStatus,
        mode: nextMode,
        lastAssistantMessageId: assistantMessage.id
      });
      return { sessionId: session.id, status: nextStatus };
    });

    return {
      ...created,
      reused: false
    };
  }

  public showBrainstormBySessionId(sessionId: string) {
    const session = this.options.loaders.requireBrainstormSession(sessionId);
    const item = this.options.loaders.requireItem(session.itemId);
    const draft = this.options.loaders.requireLatestBrainstormDraft(session.id);
    const messages = this.options.deps.brainstormMessageRepository.listBySessionId(session.id);
    return {
      session,
      item,
      draft: this.mapBrainstormDraft(draft),
      messages,
      latestReview: this.extractLatestBrainstormReview(messages)
    };
  }

  public showBrainstormSession(itemId: string) {
    const item = this.options.loaders.requireItem(itemId);
    const session = this.options.deps.brainstormSessionRepository.getLatestByItemId(item.id);
    if (session) {
      return this.showBrainstormBySessionId(session.id);
    }
    const started = this.startBrainstormSession(item.id);
    return this.showBrainstormBySessionId(started.sessionId);
  }

  public showBrainstormDraft(sessionId: string) {
    const session = this.options.loaders.requireBrainstormSession(sessionId);
    this.options.loaders.requireItem(session.itemId);
    return this.mapBrainstormDraft(this.options.loaders.requireLatestBrainstormDraft(session.id));
  }

  public updateBrainstormDraft(input: {
    sessionId: string;
    problem?: string;
    coreOutcome?: string;
    targetUsers?: string[];
    useCases?: string[];
    constraints?: string[];
    nonGoals?: string[];
    risks?: string[];
    openQuestions?: string[];
    candidateDirections?: string[];
    recommendedDirection?: string | null;
    scopeNotes?: string | null;
    assumptions?: string[];
  }) {
    const session = this.options.loaders.requireBrainstormSession(input.sessionId);
    this.assertBrainstormSessionOpen(session);
    const item = this.options.loaders.requireItem(session.itemId);
    const previousDraft = this.options.loaders.requireLatestBrainstormDraft(session.id);
    const previousView = this.mapBrainstormDraft(previousDraft);

    const draftUpdate: Partial<BrainstormDraft> = {};
    const summaryParts: string[] = [];

    const assignScalar = (
      key: "problem" | "coreOutcome" | "recommendedDirection" | "scopeNotes",
      nextValue: string | null | undefined,
      label: string
    ) => {
      if (nextValue === undefined) {
        return;
      }
      draftUpdate[key] = nextValue;
      summaryParts.push(`${label}=${nextValue ?? "cleared"}`);
    };

    const assignList = (
      key:
        | "targetUsersJson"
        | "useCasesJson"
        | "constraintsJson"
        | "nonGoalsJson"
        | "risksJson"
        | "openQuestionsJson"
        | "candidateDirectionsJson"
        | "assumptionsJson",
      nextValue: string[] | undefined,
      label: string
    ) => {
      if (nextValue === undefined) {
        return;
      }
      const normalized = this.normalizeBrainstormEntries(nextValue);
      draftUpdate[key] = JSON.stringify(normalized);
      summaryParts.push(`${label}=${normalized.length}`);
    };

    assignScalar("problem", input.problem, "problem");
    assignScalar("coreOutcome", input.coreOutcome, "coreOutcome");
    assignScalar("recommendedDirection", input.recommendedDirection, "recommendedDirection");
    assignScalar("scopeNotes", input.scopeNotes, "scopeNotes");
    assignList("targetUsersJson", input.targetUsers, "targetUsers");
    assignList("useCasesJson", input.useCases, "useCases");
    assignList("constraintsJson", input.constraints, "constraints");
    assignList("nonGoalsJson", input.nonGoals, "nonGoals");
    assignList("risksJson", input.risks, "risks");
    assignList("openQuestionsJson", input.openQuestions, "openQuestions");
    assignList("candidateDirectionsJson", input.candidateDirections, "candidateDirections");
    assignList("assumptionsJson", input.assumptions, "assumptions");

    if (summaryParts.length === 0) {
      throw new AppError("BRAINSTORM_DRAFT_UPDATE_EMPTY", "No brainstorm draft changes were provided");
    }

    return this.options.deps.runInTransaction(() => {
      const userMessage = this.options.deps.brainstormMessageRepository.create({
        sessionId: session.id,
        role: "user",
        content: `Structured brainstorm draft update: ${summaryParts.join(", ")}`,
        structuredPayloadJson: JSON.stringify(input, null, 2),
        derivedUpdatesJson: null
      });
      const nextDraftInput = {
        ...previousDraft,
        ...draftUpdate,
        lastUpdatedFromMessageId: userMessage.id
      } as BrainstormDraft;
      const nextDraft = this.options.deps.brainstormDraftRepository.createRevision(previousDraft, {
        ...draftUpdate,
        status: this.computeBrainstormDraftStatus(nextDraftInput),
        lastUpdatedFromMessageId: userMessage.id
      });
      const assistantMessage = this.options.deps.brainstormMessageRepository.create({
        sessionId: session.id,
        role: "assistant",
        content: this.buildBrainstormFollowUpMessage(item, nextDraft),
        structuredPayloadJson: JSON.stringify(
          {
            draftRevision: nextDraft.revision,
            updateType: "structured"
          },
          null,
          2
        ),
        derivedUpdatesJson: JSON.stringify(
          {
            previousDraft: previousView,
            nextDraft: this.mapBrainstormDraft(nextDraft)
          },
          null,
          2
        )
      });
      const nextStatus = this.computeBrainstormSessionStatus(nextDraft);
      const nextMode = this.computeBrainstormSessionMode(nextDraft);
      this.options.deps.brainstormSessionRepository.update(session.id, {
        status: nextStatus,
        mode: nextMode,
        lastAssistantMessageId: assistantMessage.id,
        lastUserMessageId: userMessage.id
      });
      this.options.deps.itemRepository.updatePhaseStatus(item.id, nextStatus === "ready_for_concept" ? "completed" : "running");
      return {
        sessionId: session.id,
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        status: nextStatus,
        mode: nextMode,
        draft: this.mapBrainstormDraft(nextDraft)
      };
    });
  }

  public async chatBrainstorm(sessionId: string, message: string) {
    const session = this.options.loaders.requireBrainstormSession(sessionId);
    this.assertBrainstormSessionOpen(session);
    const item = this.options.loaders.requireItem(session.itemId);
    const previousDraft = this.options.loaders.requireLatestBrainstormDraft(session.id);
    const messages = this.options.deps.brainstormMessageRepository.listBySessionId(session.id).map((entry) => ({
      role: entry.role,
      content: entry.content
    }));
    const runtime = this.options.deps.agentRuntimeResolver.resolveInteractive("brainstorm_chat");
    const agentResult = await runtime.adapter.runInteractiveBrainstorm({
      runtime: this.buildAdapterRuntimeContext(runtime),
      interactionType: "brainstorm_chat",
      prompt: this.buildInteractiveBrainstormPrompt(),
      session: {
        id: session.id,
        status: session.status,
        mode: session.mode
      },
      item: {
        id: item.id,
        code: item.code,
        title: item.title,
        description: item.description
      },
      draft: this.mapBrainstormDraft(previousDraft),
      messages,
      userMessage: message,
      allowedActions: ["suggest_patch", "request_structured_follow_up", "suggest_promote"]
    });
    const agentOutput = this.parseInteractiveBrainstormAgentOutput(agentResult.output);

    return this.options.deps.runInTransaction(() => {
      const userMessage = this.options.deps.brainstormMessageRepository.create({
        sessionId: session.id,
        role: "user",
        content: message,
        structuredPayloadJson: null,
        derivedUpdatesJson: null
      });
      const adapterDraftUpdate = this.mapInteractiveBrainstormDraftPatch(agentOutput.draftPatch);
      const extraction = extractLabeledBrainstormLists(message);
      const messageStructure = mergeBrainstormMessageStructures(
        [...messages, { role: "user", content: message }]
          .filter((entry) => entry.role === "user")
          .map((entry) => extractBrainstormMessageStructure(entry.content))
      );
      const draftUpdate = this.augmentDraftUpdateWithMessageExtraction(
        adapterDraftUpdate,
        previousDraft,
        extraction,
        messageStructure
      );
      const autoApplied = this.summarizeAutoAppliedDraftUpdates(previousDraft, draftUpdate);
      const provisionalDraft = {
        ...previousDraft,
        ...draftUpdate,
        status: this.computeBrainstormDraftStatus({
          ...previousDraft,
          ...draftUpdate
        } as BrainstormDraft),
        lastUpdatedFromMessageId: userMessage.id
      } as BrainstormDraft;
      const review = this.reviewBrainstormDraft({
        draft: provisionalDraft,
        messageStructure,
        agentDecision: {
          projectShapeDecision: agentOutput.projectShapeDecision ?? messageStructure.projectShapeDecision ?? null,
          decisionRationale: agentOutput.decisionRationale ?? messageStructure.decisionRationale ?? null,
          projectSeeds: agentOutput.projectSeeds ?? []
        },
        autoApplied
      });
      const reviewFollowUp = this.buildBrainstormReviewFollowUp(review);
      const needsStructuredFollowUp = this.shouldKeepBrainstormFollowUp(agentOutput.needsStructuredFollowUp, review);
      const finalDraftStatus = needsStructuredFollowUp
        ? (Boolean(provisionalDraft.problem && provisionalDraft.coreOutcome) ? "drafting" : "needs_input")
        : provisionalDraft.status;
      const nextDraft = this.options.deps.brainstormDraftRepository.createRevision(previousDraft, {
        ...draftUpdate,
        status: finalDraftStatus,
        lastUpdatedFromMessageId: userMessage.id
      });
      const followUpHint = reviewFollowUp ?? agentOutput.followUpHint ?? null;
      const reviewLoopState = this.buildBrainstormLoopState(review, followUpHint);
      const assistantMessageContent = review.status === "needs_follow_up"
        ? this.buildBrainstormAssistantMessageWithReviewFollowUp(agentOutput.assistantMessage, reviewFollowUp)
        : agentOutput.assistantMessage;
      const assistantMessage = this.options.deps.brainstormMessageRepository.create({
        sessionId: session.id,
        role: "assistant",
        content: assistantMessageContent,
        structuredPayloadJson: JSON.stringify(
          {
            draftRevision: nextDraft.revision,
            needsStructuredFollowUp,
            followUpHint,
            brainstormReview: review,
            reviewFeedback: reviewLoopState.reviewFeedback,
            reviewLoopState
          },
          null,
          2
        ),
        derivedUpdatesJson: JSON.stringify(
          {
            draftPatch: agentOutput.draftPatch,
            nextDraft: this.mapBrainstormDraft(nextDraft)
          },
          null,
          2
        )
      });
      const nextStatus = needsStructuredFollowUp ? "waiting_for_user" : this.computeBrainstormSessionStatus(nextDraft);
      const nextMode = this.computeBrainstormSessionMode(nextDraft);
      this.options.deps.brainstormSessionRepository.update(session.id, {
        status: nextStatus,
        mode: nextMode,
        lastAssistantMessageId: assistantMessage.id,
        lastUserMessageId: userMessage.id
      });
      this.options.deps.itemRepository.updatePhaseStatus(item.id, nextStatus === "ready_for_concept" ? "completed" : "running");
      return {
        sessionId: session.id,
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        status: nextStatus,
        mode: nextMode,
        draft: this.mapBrainstormDraft(nextDraft),
        needsStructuredFollowUp,
        followUpHint,
        review,
        reviewFeedback: reviewLoopState.reviewFeedback,
        reviewLoopState
      };
    });
  }

  public async promoteBrainstorm(sessionId: string, options?: { autorun?: boolean }) {
    const session = this.options.loaders.requireBrainstormSession(sessionId);
    this.assertBrainstormSessionOpen(session);
    const item = this.options.loaders.requireItem(session.itemId);
    const draft = this.options.loaders.requireLatestBrainstormDraft(session.id);
    const draftView = this.mapBrainstormDraft(draft);
    const previousConcept = this.options.deps.conceptRepository.getLatestByItemId(item.id);
    const latestReview = this.extractLatestBrainstormReview(this.options.deps.brainstormMessageRepository.listBySessionId(session.id));
    const promotionProjectShape = this.resolvePromotionProjectShapeDecision(draftView, latestReview);
    if (latestReview?.status === "needs_follow_up") {
      throw new AppError(
        "BRAINSTORM_REQUIRES_FOLLOW_UP",
        latestReview.summary
      );
    }
    if (promotionProjectShape.recommendation === "undecided") {
      throw new AppError(
        "BRAINSTORM_PROJECT_SHAPE_UNDECIDED",
        "The brainstorm must explicitly decide whether this becomes one project or multiple projects before concept promotion."
      );
    }

    const result = this.options.deps.runInTransaction(() => {
      const conceptMarkdown = this.renderConceptFromBrainstormDraft(item, draftView);
      const projectsPayload = this.buildProjectsFromBrainstormDraft(item, draftView, {
        status: latestReview?.status ?? "clean",
        summary: latestReview?.summary ?? "Promotion project-shape decision derived from the current draft.",
        findings: latestReview?.findings ?? [],
        projectShape: promotionProjectShape,
        autoApplied: latestReview?.autoApplied ?? []
      });
      const conceptArtifactRecord = this.persistManualArtifact({
        item,
        sessionScopedId: session.id,
        kind: "concept",
        format: "md",
        content: conceptMarkdown
      });
      const projectsArtifactRecord = this.persistManualArtifact({
        item,
        sessionScopedId: session.id,
        kind: "projects",
        format: "json",
        content: JSON.stringify(projectsPayload, null, 2)
      });
      const concept = this.options.deps.conceptRepository.create({
        itemId: item.id,
        version: (previousConcept?.version ?? 0) + 1,
        title: `${item.title} Concept`,
        summary: this.buildConceptSummary(item.title, draftView, projectsPayload.projects),
        status: "draft",
        markdownArtifactId: conceptArtifactRecord.id,
        structuredArtifactId: projectsArtifactRecord.id
      });
      this.options.deps.brainstormSessionRepository.update(session.id, {
        status: "resolved",
        resolvedAt: Date.now()
      });
      this.closeOpenBrainstormStageRuns(item.id, {
        sessionId: session.id,
        conceptId: concept.id
      });
      this.options.deps.itemRepository.updatePhaseStatus(item.id, "completed");
      return { concept, draftRevision: draft.revision };
    });

    const planningReview = await this.options.triggerPlanningReview({
      sourceType: "brainstorm_session",
      sourceId: session.id,
      step: "requirements_engineering",
      reviewMode: "readiness",
      interactionMode: "interactive",
      automationLevel: "auto_comment"
    });

    if (options?.autorun) {
      this.options.approveConcept(result.concept.id);
      const autorun = await this.options.autorunForItem({
        itemId: item.id,
        trigger: "brainstorm:promote",
        initialSteps: [{ action: "brainstorm:promote", scopeType: "item", scopeId: item.id, status: "promoted" }]
      });
      return {
        sessionId: session.id,
        conceptId: result.concept.id,
        draftRevision: result.draftRevision,
        planningReview,
        autorun
      };
    }

    return {
      sessionId: session.id,
      conceptId: result.concept.id,
      draftRevision: result.draftRevision,
      status: "promoted",
      planningReview
    };
  }

  private assertBrainstormSessionOpen(session: BrainstormSession): void {
    if (session.status === "resolved" || session.status === "cancelled") {
      throw new AppError("BRAINSTORM_SESSION_CLOSED", `Brainstorm session ${session.id} is already closed`);
    }
  }

  private closeOpenBrainstormStageRuns(
    itemId: string,
    context: { sessionId: string; conceptId: string }
  ): void {
    const runs = this.options.deps.stageRunRepository.listByItemId(itemId);
    for (const run of runs) {
      if (run.stageKey !== "brainstorm") {
        continue;
      }
      if (run.status !== "running" && run.status !== "pending") {
        continue;
      }
      if (run.status === "pending") {
        assertStageRunTransitionAllowed(run.status, "running");
        this.options.deps.stageRunRepository.updateStatus(run.id, "running");
      }
      assertStageRunTransitionAllowed("running", "completed");
      this.options.deps.stageRunRepository.updateStatus(run.id, "completed", {
        outputSummaryJson: JSON.stringify(
          {
            stageKey: "brainstorm",
            finalStatus: "completed",
            resolvedBy: "brainstorm:promote",
            brainstormSessionId: context.sessionId,
            conceptId: context.conceptId
          },
          null,
          2
        ),
        errorMessage: null
      });
    }
  }

  private mapBrainstormDraft(draft: BrainstormDraft): BrainstormDraftView {
    return {
      id: draft.id,
      itemId: draft.itemId,
      sessionId: draft.sessionId,
      revision: draft.revision,
      status: draft.status,
      problem: draft.problem,
      targetUsers: this.normalizeTargetUserEntries(JSON.parse(draft.targetUsersJson) as string[]),
      coreOutcome: draft.coreOutcome,
      useCases: JSON.parse(draft.useCasesJson) as string[],
      constraints: JSON.parse(draft.constraintsJson) as string[],
      nonGoals: JSON.parse(draft.nonGoalsJson) as string[],
      risks: JSON.parse(draft.risksJson) as string[],
      openQuestions: JSON.parse(draft.openQuestionsJson) as string[],
      candidateDirections: JSON.parse(draft.candidateDirectionsJson) as string[],
      recommendedDirection: draft.recommendedDirection,
      scopeNotes: draft.scopeNotes,
      assumptions: JSON.parse(draft.assumptionsJson) as string[],
      lastUpdatedAt: draft.lastUpdatedAt,
      lastUpdatedFromMessageId: draft.lastUpdatedFromMessageId
    };
  }

  private buildInteractiveBrainstormPrompt(): string {
    return [
      "You are assisting an interactive brainstorm session.",
      "Return only structured brainstorm updates grounded in the provided item, draft, and chat history.",
      "Prefer additive updates and preserve existing intent unless the latest user message clearly changes it.",
      "If the user message is ambiguous, keep the patch narrow and set needsStructuredFollowUp=true with a short hint.",
      "Do not claim workflow transitions. Suggest them only through the structured response.",
      "",
      "Structured extraction rules (mandatory):",
      "- When the user message contains lists of target users, use cases, constraints, non-goals, risks, or assumptions — whether inline (e.g. \"users: a; b\") or bulleted across multiple lines — route EACH entry into the matching draftPatch array (targetUsers, useCases, constraints, nonGoals, risks, assumptions).",
      "- Never copy list content into scopeNotes. scopeNotes is reserved for free-form context that does not fit any of the structured fields.",
      "- Recognize common label synonyms: users/actors → targetUsers; scenarios → useCases; out of scope → nonGoals.",
      "- If the user message is mostly a labeled plan (multiple labeled sections), extract every section even if it enlarges the patch.",
      "",
      "Project shaping rules (mandatory):",
      "- Explicitly decide whether the brainstorm should stay one focused project or split into multiple projects.",
      "- Return `projectShapeDecision` as `single_project` or `split_projects` when the current chat gives enough evidence.",
      "- Return `decisionRationale` with a short justification for that decision.",
      "- Return `projectSeeds` as the proposed project titles/seeds when you choose `split_projects`, or as a single focused seed when you choose `single_project`.",
      "- If the chat does not provide enough evidence to make that decision safely, set `needsStructuredFollowUp=true` and ask the user to clarify project shape."
    ].join("\n");
  }

  private parseInteractiveBrainstormAgentOutput(output: unknown): InteractiveBrainstormAgentOutput {
    const parsed = interactiveBrainstormAgentOutputSchema.safeParse(output);
    if (!parsed.success) {
      throw new AppError("INTERACTIVE_AGENT_OUTPUT_INVALID", parsed.error.message);
    }
    return parsed.data;
  }

  private mapInteractiveBrainstormDraftPatch(patch: InteractiveBrainstormAgentOutput["draftPatch"]): Partial<BrainstormDraft> {
    const result: Partial<BrainstormDraft> = {};
    const assignList = (
      key:
        | "targetUsersJson"
        | "useCasesJson"
        | "constraintsJson"
        | "nonGoalsJson"
        | "risksJson"
        | "openQuestionsJson"
        | "candidateDirectionsJson"
        | "assumptionsJson",
      value?: string[]
    ) => {
      if (value === undefined) {
        return;
      }
      result[key] = JSON.stringify(
        key === "targetUsersJson" ? this.normalizeTargetUserEntries(value) : this.normalizeBrainstormEntries(value)
      );
    };

    if (patch.problem !== undefined) {
      result.problem = patch.problem;
    }
    if (patch.coreOutcome !== undefined) {
      result.coreOutcome = patch.coreOutcome;
    }
    if (patch.recommendedDirection !== undefined) {
      result.recommendedDirection = patch.recommendedDirection;
    }
    if (patch.scopeNotes !== undefined) {
      result.scopeNotes = patch.scopeNotes;
    }
    assignList("targetUsersJson", patch.targetUsers);
    assignList("useCasesJson", patch.useCases);
    assignList("constraintsJson", patch.constraints);
    assignList("nonGoalsJson", patch.nonGoals);
    assignList("risksJson", patch.risks);
    assignList("openQuestionsJson", patch.openQuestions);
    assignList("candidateDirectionsJson", patch.candidateDirections);
    assignList("assumptionsJson", patch.assumptions);
    return result;
  }

  private augmentDraftUpdateWithMessageExtraction(
    adapterUpdate: Partial<BrainstormDraft>,
    previousDraft: BrainstormDraft,
    extraction: BrainstormExtraction,
    messageStructure: BrainstormMessageStructure
  ): Partial<BrainstormDraft> {
    if (!hasAnyExtraction(extraction) && !hasAnyExtraction(messageStructure)) {
      return adapterUpdate;
    }
    const fieldMap: Record<
      BrainstormListExtractionField,
      | "targetUsersJson"
      | "useCasesJson"
      | "constraintsJson"
      | "nonGoalsJson"
      | "risksJson"
      | "assumptionsJson"
      | "openQuestionsJson"
      | "candidateDirectionsJson"
    > = {
      targetUsers: "targetUsersJson",
      useCases: "useCasesJson",
      constraints: "constraintsJson",
      nonGoals: "nonGoalsJson",
      risks: "risksJson",
      assumptions: "assumptionsJson",
      openQuestions: "openQuestionsJson",
      candidateDirections: "candidateDirectionsJson"
    };
    const result: Partial<BrainstormDraft> = { ...adapterUpdate };
    this.applyScalarBackfill(result, adapterUpdate, messageStructure);
    for (const field of Object.keys(extraction) as BrainstormListExtractionField[]) {
      const entries = extraction[field];
      if (entries.length === 0) {
        continue;
      }
      const jsonKey = fieldMap[field];
      const adapterValue = adapterUpdate[jsonKey];
      const previousValue = previousDraft[jsonKey];
      const existingEntries = adapterValue !== undefined
        ? (JSON.parse(adapterValue) as string[])
        : (JSON.parse(previousValue) as string[]);
      const sanitizedEntries = this.sanitizeExistingStructuredEntries(field, existingEntries);
      result[jsonKey] = JSON.stringify(
        field === "targetUsers"
          ? this.normalizeTargetUserEntries([...sanitizedEntries, ...entries])
          : this.normalizeBrainstormEntries([...sanitizedEntries, ...entries])
      );
    }
    this.applyOpenQuestionResolution(result, adapterUpdate, previousDraft, messageStructure);
    return result;
  }

  private sanitizeExistingStructuredEntries(
    field: BrainstormListExtractionField,
    existingEntries: string[]
  ): string[] {
    return this.normalizeBrainstormEntries(existingEntries.filter((entry) => {
      if (!entry.includes(":")) {
        return true;
      }
      const extracted = extractBrainstormMessageStructure(entry);
      const otherListFields = (
        [
          "targetUsers",
          "useCases",
          "constraints",
          "nonGoals",
          "risks",
          "assumptions",
          "openQuestions",
          "candidateDirections"
        ] as BrainstormListExtractionField[]
      ).filter((candidate) => candidate !== field && extracted[candidate].length > 0);
      const hasOtherSignals = Boolean(
        extracted.problem
        || extracted.coreOutcome
        || extracted.recommendedDirection
        || extracted.scopeNotes
        || extracted.smallestUsefulOutcome
        || extracted.projectShapeDecision
        || extracted.decisionRationale
        || otherListFields.length > 0
      );
      return !hasOtherSignals;
    }));
  }

  private applyOpenQuestionResolution(
    result: Partial<BrainstormDraft>,
    adapterUpdate: Partial<BrainstormDraft>,
    previousDraft: BrainstormDraft,
    messageStructure: BrainstormMessageStructure
  ): void {
    if (!messageStructure.smallestUsefulOutcome) {
      return;
    }
    const adapterValue = adapterUpdate.openQuestionsJson;
    const previousValue = previousDraft.openQuestionsJson;
    const existingEntries = adapterValue !== undefined
      ? (JSON.parse(adapterValue) as string[])
      : (JSON.parse(previousValue) as string[]);
    const remaining = existingEntries.filter(
      (entry) => !/smallest useful (user )?outcome|smallest useful slice/i.test(entry)
    );
    result.openQuestionsJson = JSON.stringify(this.normalizeBrainstormEntries(remaining));
    if (adapterUpdate.scopeNotes === undefined && !previousDraft.scopeNotes?.includes(messageStructure.smallestUsefulOutcome)) {
      result.scopeNotes = [previousDraft.scopeNotes, messageStructure.smallestUsefulOutcome].filter(Boolean).join("\n");
    }
  }

  private applyScalarBackfill(
    result: Partial<BrainstormDraft>,
    adapterUpdate: Partial<BrainstormDraft>,
    messageStructure: BrainstormMessageStructure
  ): void {
    if (messageStructure.problem && adapterUpdate.problem === undefined) {
      result.problem = messageStructure.problem;
    }
    if (messageStructure.coreOutcome && adapterUpdate.coreOutcome === undefined) {
      result.coreOutcome = messageStructure.coreOutcome;
    }
    if (messageStructure.recommendedDirection && adapterUpdate.recommendedDirection === undefined) {
      result.recommendedDirection = messageStructure.recommendedDirection;
    }
    if (messageStructure.scopeNotes && adapterUpdate.scopeNotes === undefined) {
      result.scopeNotes = messageStructure.scopeNotes;
    }
    if (messageStructure.smallestUsefulOutcome && adapterUpdate.scopeNotes === undefined) {
      result.scopeNotes = [result.scopeNotes, messageStructure.smallestUsefulOutcome].filter(Boolean).join("\n");
    }
  }

  private summarizeAutoAppliedDraftUpdates(
    previousDraft: BrainstormDraft,
    draftUpdate: Partial<BrainstormDraft>
  ): BrainstormReviewSummary["autoApplied"] {
    const applied: BrainstormReviewSummary["autoApplied"] = [];

    const pushScalar = (
      field: "problem" | "coreOutcome" | "recommendedDirection" | "scopeNotes",
      value: string | null | undefined
    ) => {
      if (value === undefined || value === null) {
        return;
      }
      if (previousDraft[field] === value) {
        return;
      }
      applied.push({ field, values: [value] });
    };

    pushScalar("problem", draftUpdate.problem);
    pushScalar("coreOutcome", draftUpdate.coreOutcome);
    pushScalar("recommendedDirection", draftUpdate.recommendedDirection);
    pushScalar("scopeNotes", draftUpdate.scopeNotes);

    const listFieldMap: Array<{
      field: BrainstormReviewSummary["autoApplied"][number]["field"];
      key:
        | "targetUsersJson"
        | "useCasesJson"
        | "constraintsJson"
        | "nonGoalsJson"
        | "risksJson"
        | "assumptionsJson"
        | "openQuestionsJson"
        | "candidateDirectionsJson";
    }> = [
      { field: "targetUsers", key: "targetUsersJson" },
      { field: "useCases", key: "useCasesJson" },
      { field: "constraints", key: "constraintsJson" },
      { field: "nonGoals", key: "nonGoalsJson" },
      { field: "risks", key: "risksJson" },
      { field: "assumptions", key: "assumptionsJson" },
      { field: "openQuestions", key: "openQuestionsJson" },
      { field: "candidateDirections", key: "candidateDirectionsJson" }
    ];

    for (const entry of listFieldMap) {
      const nextValue = draftUpdate[entry.key];
      if (nextValue === undefined) {
        continue;
      }
      const previousValues = JSON.parse(previousDraft[entry.key]) as string[];
      const nextValues = JSON.parse(nextValue) as string[];
      const added = nextValues.filter((value) => !previousValues.some((previous) => previous.toLowerCase() === value.toLowerCase()));
      if (added.length > 0) {
        applied.push({ field: entry.field, values: added });
      }
    }

    return applied;
  }

  private reviewBrainstormDraft(input: {
    draft: BrainstormDraft;
    messageStructure: BrainstormMessageStructure;
    agentDecision: Pick<InteractiveBrainstormAgentOutput, "projectShapeDecision" | "decisionRationale" | "projectSeeds">;
    autoApplied: BrainstormReviewSummary["autoApplied"];
  }): BrainstormReviewSummary {
    const view = this.mapBrainstormDraft(input.draft);
    const findings: BrainstormReviewFinding[] = [];
    const projectShape = this.assessBrainstormProjectShape(view, input.agentDecision);

    const checkScalar = (
      field: BrainstormReviewFinding["field"],
      sourceValue: string | null,
      draftValue: string | null,
      label: string
    ) => {
      if (!sourceValue) {
        return;
      }
      if (draftValue && draftValue.trim().length > 0) {
        return;
      }
      findings.push({
        severity: "major",
        field,
        summary: `Missing ${label} from brainstorm draft`,
        detail: `The chat history includes ${label}, but the current draft still does not capture it.`
      });
    };

    const checkList = (
      field: BrainstormReviewFinding["field"],
      sourceValues: string[],
      draftValues: string[],
      label: string
    ) => {
      for (const sourceValue of sourceValues) {
        const covered = draftValues.some((draftValue) => draftValue.toLowerCase() === sourceValue.toLowerCase());
        if (!covered) {
          findings.push({
            severity: "major",
            field,
            summary: `Missing ${label} entry from brainstorm draft`,
            detail: `The chat history includes "${sourceValue}", but the current draft does not capture it under ${label}.`
          });
        }
      }
    };

    checkScalar("problem", input.messageStructure.problem, view.problem, "problem");
    checkScalar("coreOutcome", input.messageStructure.coreOutcome, view.coreOutcome, "core outcome");
    checkScalar("recommendedDirection", input.messageStructure.recommendedDirection, view.recommendedDirection, "recommended direction");
    checkList("targetUsers", input.messageStructure.targetUsers, view.targetUsers, "target users");
    checkList("useCases", input.messageStructure.useCases, view.useCases, "use cases");
    checkList("constraints", input.messageStructure.constraints, view.constraints, "constraints");
    checkList("nonGoals", input.messageStructure.nonGoals, view.nonGoals, "non-goals");
    checkList("risks", input.messageStructure.risks, view.risks, "risks");
    checkList("assumptions", input.messageStructure.assumptions, view.assumptions, "assumptions");
    checkList("openQuestions", input.messageStructure.openQuestions, view.openQuestions, "open questions");
    checkList("candidateDirections", input.messageStructure.candidateDirections, view.candidateDirections, "candidate directions");
    this.appendDecisionFindings(view, projectShape, findings);

    if (findings.length > 0) {
      return {
        status: "needs_follow_up",
        summary: `Brainstorm review found ${findings.length} missing chat-derived draft entr${findings.length === 1 ? "y" : "ies"}.`,
        findings,
        projectShape,
        autoApplied: input.autoApplied
      };
    }
    if (input.autoApplied.length > 0) {
      return {
        status: "auto_backfilled",
        summary: `Brainstorm review backfilled ${input.autoApplied.length} draft field${input.autoApplied.length === 1 ? "" : "s"} from the chat history.`,
        findings: [],
        projectShape,
        autoApplied: input.autoApplied
      };
    }
    return {
      status: "clean",
      summary: "Brainstorm review found no missing chat-derived draft context.",
      findings: [],
      projectShape,
      autoApplied: []
    };
  }

  private extractLatestBrainstormReview(messages: Array<{ role: string; structuredPayloadJson: string | null }>): BrainstormReviewSummary | null {
    for (const message of [...messages].reverse()) {
      if (message.role !== "assistant" || !message.structuredPayloadJson) {
        continue;
      }
      try {
        const parsed = JSON.parse(message.structuredPayloadJson) as { brainstormReview?: BrainstormReviewSummary };
        if (parsed.brainstormReview) {
          return parsed.brainstormReview;
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  private buildBrainstormReviewFollowUp(review: BrainstormReviewSummary): string | null {
    if (review.status !== "needs_follow_up" || review.findings.length === 0) {
      return null;
    }
    const findings = review.findings.slice(0, 3).map((finding) => {
      if (
        finding.field === "problem" ||
        finding.field === "coreOutcome" ||
        finding.field === "recommendedDirection" ||
        finding.field === "projectShape"
      ) {
        return finding.field;
      }
      return `${finding.field}: ${finding.detail.match(/includes "(.+?)"/)?.[1] ?? finding.field}`;
    });
    return `Brainstorm review still misses chat-derived context. Capture: ${findings.join("; ")}.`;
  }

  private shouldKeepBrainstormFollowUp(
    agentRequestedFollowUp: boolean,
    review: BrainstormReviewSummary
  ): boolean {
    if (review.status === "needs_follow_up") {
      return true;
    }
    if (!agentRequestedFollowUp) {
      return false;
    }
    if (review.autoApplied.length > 0) {
      return false;
    }
    return review.projectShape.recommendation === "undecided" || review.findings.length > 0;
  }

  private buildBrainstormLoopState(
    review: BrainstormReviewSummary,
    followUpHint: string | null
  ): BrainstormLoopState {
    const reviewFeedback = [this.buildBrainstormReviewFeedback(review)];
    if (review.status === "needs_follow_up") {
      return {
        owner: "stage_llm",
        status: "needs_user_input",
        question: reviewFeedback[0].openQuestions[0]?.question ?? followUpHint,
        followUpHint,
        reviewFeedback
      };
    }
    if (review.status === "auto_backfilled") {
      return {
        owner: "stage_llm",
        status: "revising",
        question: null,
        followUpHint,
        reviewFeedback
      };
    }
    return {
      owner: "stage_llm",
      status: "clean",
      question: null,
      followUpHint,
      reviewFeedback
    };
  }

  private buildBrainstormReviewFeedback(review: BrainstormReviewSummary): StageOwnedReviewFeedback {
    return {
      reviewRunId: `brainstorm-review:${review.projectShape.recommendation}:${review.status}`,
      stageKey: "brainstorm",
      status: review.status,
      readiness: review.status === "needs_follow_up" ? "needs_evidence" : "ready",
      summary: review.summary,
      recommendedAction:
        review.status === "needs_follow_up"
          ? this.buildBrainstormReviewFollowUp(review) ?? "Capture the missing brainstorm decisions and rerun the stage."
          : "Proceed with the current brainstorm draft.",
      findings: review.findings.map((finding) => ({
        type: finding.field,
        title: finding.summary,
        detail: finding.detail,
        evidence: null
      })),
      openQuestions: review.findings
        .filter((finding) => finding.field === "projectShape" || finding.field === "recommendedDirection" || finding.field === "targetUsers")
        .map((finding) => ({
          question: finding.summary,
          reason: finding.detail,
          impact: "Without this clarification, the brainstorm should stay in the stage-owned dialog."
        }))
    };
  }

  private buildBrainstormAssistantMessageWithReviewFollowUp(baseMessage: string, reviewFollowUp: string | null): string {
    if (!reviewFollowUp) {
      return baseMessage;
    }
    if (baseMessage.includes(reviewFollowUp)) {
      return baseMessage;
    }
    return `${baseMessage}\n\n${reviewFollowUp}`;
  }

  private normalizeBrainstormEntries(values: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
      const normalized = value.replaceAll(/\s+/g, " ").trim();
      const dedupeKey = normalized.toLowerCase();
      if (!normalized || seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      result.push(normalized);
    }
    return result;
  }

  private normalizeTargetUserEntries(values: string[]): string[] {
    return this.normalizeBrainstormEntries(
      values.map((value) => value.replace(/^and\s+/i, "").replace(/[.,;:]+$/, "").trim())
    );
  }

  private computeBrainstormDraftStatus(draft: BrainstormDraft): BrainstormDraftStatus {
    const view = this.mapBrainstormDraft(draft);
    const hasCore = Boolean(view.problem && view.coreOutcome);
    const hasUsers = view.targetUsers.length > 0;
    const hasUseCases = view.useCases.length > 0;
    const hasDirection = Boolean(view.recommendedDirection || view.candidateDirections.length > 0);
    if (hasCore && hasUsers && hasUseCases && hasDirection) {
      return "ready_for_concept";
    }
    return hasCore ? "drafting" : "needs_input";
  }

  private computeBrainstormSessionStatus(draft: BrainstormDraft): BrainstormSessionStatus {
    const status = this.computeBrainstormDraftStatus(draft);
    if (status === "ready_for_concept") {
      return "ready_for_concept";
    }
    return "waiting_for_user";
  }

  private computeBrainstormSessionMode(draft: BrainstormDraft): BrainstormSessionMode {
    const view = this.mapBrainstormDraft(draft);
    if (this.computeBrainstormDraftStatus(draft) === "ready_for_concept") {
      return "converge";
    }
    if (!view.problem || view.targetUsers.length === 0) {
      return "explore";
    }
    if (view.candidateDirections.length > 1) {
      return "compare";
    }
    return "shape";
  }

  private buildBrainstormKickoffMessage(item: { code: string; title: string; description: string }): string {
    return [
      `Interactive brainstorm for ${item.code} is open.`,
      "",
      `Current item: ${item.title}`,
      item.description ? `Description: ${item.description}` : "Description: none provided",
      "",
      "Start by clarifying the core problem, the target users, or the smallest useful outcome."
    ].join("\n");
  }

  private buildBrainstormFollowUpMessage(item: { code: string; title: string }, draft: BrainstormDraft): string {
    const view = this.mapBrainstormDraft(draft);
    const nextQuestion = this.resolveBrainstormNextQuestion(view);
    return [
      `Brainstorm summary for ${item.code}:`,
      `problem=${view.problem ?? "missing"}`,
      `targetUsers=${view.targetUsers.length}`,
      `useCases=${view.useCases.length}`,
      `candidateDirections=${view.candidateDirections.length}`,
      "",
      nextQuestion
    ].join("\n");
  }

  private renderConceptFromBrainstormDraft(
    item: { code: string; title: string; description: string },
    draft: BrainstormDraftView
  ): string {
    const scopeNotes = this.summarizeScopeNotes(draft.scopeNotes);
    return [
      `# ${item.title} Concept`,
      "",
      "## Item Code",
      item.code,
      "",
      "## Problem",
      draft.problem ?? item.description,
      "",
      "## Desired Outcome",
      draft.coreOutcome ?? item.title,
      "",
      "## Target Users",
      draft.targetUsers.length > 0 ? draft.targetUsers.map((entry) => `- ${entry}`).join("\n") : "- TBD",
      "",
      "## Use Cases",
      draft.useCases.length > 0 ? draft.useCases.map((entry) => `- ${entry}`).join("\n") : "- TBD",
      "",
      "## Constraints",
      draft.constraints.length > 0 ? draft.constraints.map((entry) => `- ${entry}`).join("\n") : "- None captured",
      "",
      "## Non-Goals",
      draft.nonGoals.length > 0 ? draft.nonGoals.map((entry) => `- ${entry}`).join("\n") : "- None captured",
      "",
      "## Risks",
      draft.risks.length > 0 ? draft.risks.map((entry) => `- ${entry}`).join("\n") : "- None captured",
      "",
      "## Recommended Approach",
      draft.recommendedDirection ?? draft.candidateDirections[0] ?? "Refine during concept review",
      "",
      "## Assumptions",
      draft.assumptions.length > 0 ? draft.assumptions.map((entry) => `- ${entry}`).join("\n") : "- None captured",
      "",
      "## Scope Notes",
      scopeNotes ?? "No additional scope notes captured.",
      ""
    ].join("\n");
  }

  private buildProjectsFromBrainstormDraft(
    item: { title: string },
    draft: BrainstormDraftView,
    latestReview: BrainstormReviewSummary | null
  ): {
    projects: Array<{
      title: string;
      summary: string;
      goal: string;
      targetUsers: string[];
      useCases: string[];
      constraints: string[];
      nonGoals: string[];
      risks: string[];
      assumptions: string[];
      designConstraints: string[];
      requiredDeliverables: string[];
      referenceArtifacts: string[];
    }>;
  } {
    const projectShape = this.assessBrainstormProjectShape(draft, {
      projectShapeDecision: latestReview?.projectShape.recommendation === "undecided" ? null : latestReview?.projectShape.recommendation ?? null,
      decisionRationale: latestReview?.projectShape.rationale ?? null,
      projectSeeds: latestReview?.projectShape.suggestedSeeds ?? []
    });
    const candidateSeeds = this.selectBrainstormProjectSeeds(draft, item.title, projectShape);
    const defaultGoal = this.buildProjectGoal(item.title, draft);
    const genericContext = deriveGenericUpstreamContext({
      constraints: draft.constraints,
      nonGoals: draft.nonGoals,
      scopeNotes: draft.scopeNotes
    });

    if (candidateSeeds.length === 0) {
      candidateSeeds.push(draft.coreOutcome ?? draft.problem ?? item.title);
    }

    return {
      projects: candidateSeeds.map((seed, index) => ({
        title: candidateSeeds.length === 1
          ? this.buildSingleProjectTitle(item.title, draft, seed)
          : this.buildBrainstormProjectTitle(item.title, seed, index),
        summary: index === 0 ? this.buildProjectSummary(item.title, draft, seed) : seed,
        goal: candidateSeeds.length === 1 ? defaultGoal : `${defaultGoal.replace(/[.]$/, "")}: ${seed}`,
        targetUsers: this.normalizeTargetUserEntries([...draft.targetUsers]),
        useCases: [...draft.useCases],
        constraints: [...draft.constraints],
        nonGoals: [...draft.nonGoals],
        risks: [...draft.risks],
        assumptions: [...draft.assumptions],
        designConstraints: [...genericContext.designConstraints],
        requiredDeliverables: [...genericContext.requiredDeliverables],
        referenceArtifacts: [...genericContext.referenceArtifacts]
      }))
    };
  }

  private resolvePromotionProjectShapeDecision(
    draft: BrainstormDraftView,
    latestReview: BrainstormReviewSummary | null
  ): BrainstormProjectShapeAssessment {
    if (latestReview && latestReview.projectShape.recommendation !== "undecided") {
      return latestReview.projectShape;
    }
    if (draft.recommendedDirection) {
      return {
        recommendation: "single_project",
        rationale: "The draft has an explicit recommended direction.",
        suggestedSeeds: [draft.recommendedDirection]
      };
    }
    if (draft.candidateDirections.length === 1) {
      return {
        recommendation: "single_project",
        rationale: "The draft has exactly one candidate direction.",
        suggestedSeeds: [...draft.candidateDirections]
      };
    }
    return {
      recommendation: "undecided",
      rationale: "The draft does not contain a single explicit direction or an approved split decision.",
      suggestedSeeds: this.deriveImplicitProjectTracks(draft).map((track) => track.seed).slice(0, 3)
    };
  }

  private selectBrainstormProjectSeeds(
    draft: BrainstormDraftView,
    itemTitle: string,
    projectShape: BrainstormProjectShapeAssessment
  ): string[] {
    if (projectShape.recommendation === "split_projects" && projectShape.suggestedSeeds.length > 1) {
      return projectShape.suggestedSeeds;
    }
    if (draft.recommendedDirection) {
      return [draft.recommendedDirection];
    }

    const normalizedDirections = this.normalizeBrainstormEntries(draft.candidateDirections);
    if (normalizedDirections.length > 1) {
      return normalizedDirections.slice(0, 3);
    }
    if (normalizedDirections.length === 1) {
      return normalizedDirections;
    }

    const normalizedUseCases = this.normalizeBrainstormEntries(draft.useCases);
    if (normalizedUseCases.length > 0) {
      const [firstUseCase] = normalizedUseCases;
      return [draft.coreOutcome ?? firstUseCase];
    }

    return [draft.coreOutcome ?? draft.problem ?? itemTitle];
  }

  private appendDecisionFindings(
    view: BrainstormDraftView,
    projectShape: BrainstormProjectShapeAssessment,
    findings: BrainstormReviewFinding[]
  ): void {
    if (this.needsTargetUserClarification(view)) {
      findings.push({
        severity: "major",
        field: "targetUsers",
        summary: "Missing target users for a detailed brainstorm draft",
        detail: "The draft already contains rich use cases and constraints, but it still does not name the primary target users or actors."
      });
    }

    if (this.needsDirectionClarification(view, projectShape)) {
      findings.push({
        severity: "major",
        field: "recommendedDirection",
        summary: "Missing focused implementation direction",
        detail: "The draft contains enough scope to continue, but it still does not capture a clear recommended implementation direction."
      });
    }

    if (projectShape.recommendation === "undecided") {
      findings.push({
        severity: "major",
        field: "projectShape",
        summary: "Project shape needs an explicit decision",
        detail: `The brainstorm needs an explicit decision on whether this should stay one focused MVP project or split into multiple projects. Suggested seeds: ${projectShape.suggestedSeeds.join("; ")}.`
      });
    } else if (projectShape.recommendation === "split_projects" && projectShape.suggestedSeeds.length < 2) {
      findings.push({
        severity: "major",
        field: "projectShape",
        summary: "Split-project decision lacks concrete project seeds",
        detail: "The brainstorm decided to split into multiple projects, but it does not yet name at least two concrete project seeds."
      });
    } else if (projectShape.recommendation === "single_project" && projectShape.suggestedSeeds.length > 1) {
      findings.push({
        severity: "major",
        field: "projectShape",
        summary: "Single-project decision is inconsistent with multiple project seeds",
        detail: "The brainstorm decided to stay as one project, but it still returns multiple project seeds. Reduce it to one focused seed or switch the decision to split_projects."
      });
    }
  }

  private needsTargetUserClarification(view: BrainstormDraftView): boolean {
    if (view.targetUsers.length > 0) {
      return false;
    }
    return view.useCases.length >= 3 || view.constraints.length >= 3 || view.assumptions.length >= 2;
  }

  private needsDirectionClarification(
    view: BrainstormDraftView,
    projectShape: BrainstormProjectShapeAssessment
  ): boolean {
    if (projectShape.recommendation === "split_projects") {
      return false;
    }
    if (view.recommendedDirection) {
      return false;
    }
    if (view.candidateDirections.length > 1) {
      return true;
    }
    return view.useCases.length >= 5 && view.targetUsers.length > 0;
  }

  private assessBrainstormProjectShape(
    view: BrainstormDraftView,
    agentDecision: Pick<InteractiveBrainstormAgentOutput, "projectShapeDecision" | "decisionRationale" | "projectSeeds">
  ): BrainstormProjectShapeAssessment {
    const heuristicSeeds = this.deriveImplicitProjectTracks(view).map((track) => track.seed).slice(0, 3);
    if (agentDecision.projectShapeDecision) {
      return {
        recommendation: agentDecision.projectShapeDecision,
        rationale:
          agentDecision.decisionRationale
          ?? (agentDecision.projectShapeDecision === "split_projects"
            ? "The brainstorm model decided to split this work into multiple projects."
            : "The brainstorm model decided to keep this as one focused project."),
        suggestedSeeds: agentDecision.projectSeeds.length > 0
          ? agentDecision.projectSeeds
          : this.defaultProjectSeedsForDecision(view, agentDecision.projectShapeDecision, heuristicSeeds)
      };
    }

    return {
      recommendation: "undecided",
      rationale: "The brainstorm draft has enough scope to continue, but it does not yet contain an explicit project-shape decision from the model.",
      suggestedSeeds: heuristicSeeds.length > 0 ? heuristicSeeds : [view.coreOutcome ?? view.problem ?? "Focused project"]
    };
  }

  private defaultProjectSeedsForDecision(
    view: BrainstormDraftView,
    decision: "single_project" | "split_projects",
    heuristicSeeds: string[]
  ): string[] {
    if (decision === "single_project") {
      return [view.recommendedDirection ?? view.candidateDirections[0] ?? view.coreOutcome ?? view.problem ?? "Focused project"];
    }
    return heuristicSeeds.length > 0
      ? heuristicSeeds
      : this.normalizeBrainstormEntries(view.candidateDirections).slice(0, 3);
  }

  private deriveImplicitProjectTracks(view: BrainstormDraftView): Array<{ key: string; seed: string; matches: string[] }> {
    const scopeLines = (view.scopeNotes ?? "")
      .split(/\r?\n/)
      .map((entry) => entry.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean);
    const corpus = this.normalizeBrainstormEntries([
      ...view.useCases,
      ...view.constraints,
      ...view.nonGoals,
      ...view.assumptions,
      ...scopeLines
    ]);

    const trackDefinitions: Array<{ key: string; seed: string; pattern: RegExp }> = [
      {
        key: "surface",
        seed: "workspace shell, board, inbox, and conversation surfaces",
        pattern: /\b(board|overlay|inbox|chat|conversation|runs?|artifacts?|settings?|workspace|shell|panel|view)\b/i
      },
      {
        key: "platform",
        seed: "shared workflow read models and action services",
        pattern: /\b(core|service|services|api|http|handler|read model|read models|query|queries|aggregation|aggregate|workflow logic|capabilit)\b/i
      },
      {
        key: "components",
        seed: "reusable UI components, showcase, and inventory",
        pattern: /\b(component|components|showcase|inventory|primitive|primitives|design system|tokens?|typography)\b/i
      }
    ];

    return trackDefinitions
      .map((definition) => ({
        key: definition.key,
        seed: definition.seed,
        matches: corpus.filter((entry) => definition.pattern.test(entry))
      }))
      .filter((track) => track.matches.length >= 2);
  }

  private resolveBrainstormNextQuestion(view: BrainstormDraftView): string {
    if (view.targetUsers.length === 0) {
      return "Who is the primary user or actor for this item?";
    }
    if (view.useCases.length === 0) {
      return "What is the first concrete use case we should support?";
    }
    if (view.recommendedDirection === null) {
      return "Which direction should become the recommended MVP approach?";
    }
    return "The draft is converging. Add any remaining assumptions or promote it to a concept.";
  }

  private buildBrainstormProjectTitle(itemTitle: string, seed: string, index: number): string {
    const cleaned = this.cleanTitleSeed(seed)
      .replace(/^(build|create|support|enable|deliver)\s+/i, "")
      .replace(/[.?!].*$/, "")
      .trim();
    if (!cleaned) {
      return `${itemTitle} Track ${index + 1}`;
    }
    const words = cleaned.split(/\s+/).slice(0, 6);
    const title = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
    return title.toLowerCase().startsWith(itemTitle.toLowerCase()) ? title : `${itemTitle} ${title}`;
  }

  private buildSingleProjectTitle(itemTitle: string, draft: BrainstormDraftView, seed: string): string {
    const normalizedItemTitle = itemTitle.trim();
    const cleanedSeed = this.cleanTitleSeed(seed);
    if (!cleanedSeed) {
      return normalizedItemTitle;
    }

    const lowSignalSeed = /^(one|single)\s+/i.test(cleanedSeed)
      || /\b(apps\/ui|shared core workflow services?|next\.js|mvp|v1|first release)\b/i.test(cleanedSeed);
    if (lowSignalSeed) {
      return normalizedItemTitle;
    }

    const outcomeTitle = draft.coreOutcome ? this.cleanTitleSeed(draft.coreOutcome) : "";
    if (outcomeTitle && outcomeTitle.toLowerCase().includes(normalizedItemTitle.toLowerCase())) {
      return normalizedItemTitle;
    }

    return this.buildBrainstormProjectTitle(normalizedItemTitle, cleanedSeed, 0);
  }

  private buildConceptSummary(
    itemTitle: string,
    draft: BrainstormDraftView,
    projects: Array<{ title: string; goal: string }>
  ): string {
    const normalizedOutcome = this.normalizeSentenceSummary(draft.coreOutcome);
    if (normalizedOutcome) {
      return normalizedOutcome;
    }
    if (projects.length === 1) {
      return this.normalizeSentenceSummary(projects[0]!.goal) ?? projects[0]!.goal;
    }
    return projects.map((project) => project.title).join(", ");
  }

  private buildProjectSummary(itemTitle: string, draft: BrainstormDraftView, seed: string): string {
    return this.normalizeSentenceSummary(draft.problem)
      ?? this.normalizeSentenceSummary(draft.coreOutcome)
      ?? this.normalizeSentenceSummary(seed)
      ?? `Deliver the first usable slice for ${itemTitle}.`;
  }

  private buildProjectGoal(itemTitle: string, draft: BrainstormDraftView): string {
    const normalizedOutcome = this.normalizeSentenceSummary(draft.coreOutcome);
    if (normalizedOutcome) {
      return normalizedOutcome;
    }
    const useCaseSummary = this.normalizeBrainstormEntries(draft.useCases).slice(0, 3).join(", ");
    if (useCaseSummary) {
      return `Deliver the first usable slice for ${itemTitle} covering ${useCaseSummary}.`;
    }
    return `Deliver the first usable slice for ${itemTitle}.`;
  }

  private normalizeSentenceSummary(value: string | null | undefined): string | null {
    const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
    if (!normalized) {
      return null;
    }
    return normalized.replace(/[:;]+$/, "");
  }

  private cleanTitleSeed(value: string): string {
    return value
      .replace(/\b(one focused|single integrated|single)\b/gi, " ")
      .replace(/\b(ui v\d+|v\d+|first release|mvp)\b/gi, " ")
      .replace(/\bin\s+apps\/[a-z0-9/_-]+\b/gi, " ")
      .replace(/\bon shared core workflow services?\b/gi, " ")
      .replace(/\busing shared core workflow services?\b/gi, " ")
      .replace(/\bon core services?\b/gi, " ")
      .replace(/\bwith shared core workflow services?\b/gi, " ")
      .replace(/\bbuild\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private summarizeScopeNotes(scopeNotes: string | null): string | null {
    if (!scopeNotes) {
      return null;
    }

    const lines = this.normalizeBrainstormEntries(
      scopeNotes
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .filter((entry) => !/^#{1,6}\s+/.test(entry))
        .map((entry) => entry.replace(/^[-*•]\s*/, ""))
        .map((entry) => entry.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1"))
    );

    if (lines.length === 0) {
      return null;
    }

    const summarized = lines.slice(0, 5).map((entry) => `- ${entry}`);
    if (lines.length > 5) {
      summarized.push("- Additional scope notes are preserved in the brainstorm artifacts.");
    }
    return summarized.join("\n");
  }

  private persistManualArtifact(input: {
    item: { id: string };
    sessionScopedId: string;
    kind: string;
    format: "md" | "json";
    content: string;
  }): ArtifactRecord {
    const written = this.options.artifactService.writeArtifact({
      itemId: input.item.id,
      projectId: null,
      stageKey: "brainstorm",
      stageRunId: input.sessionScopedId,
      kind: input.kind,
      format: input.format,
      content: input.content
    });
    return this.options.deps.artifactRepository.create({
      stageRunId: null,
      itemId: input.item.id,
      projectId: null,
      kind: input.kind,
      format: input.format,
      path: written.path,
      sha256: written.sha256,
      sizeBytes: written.sizeBytes
    });
  }

  private buildAdapterRuntimeContext(input: {
    providerKey: string;
    model: string | null;
    policy: AdapterRuntimeContext["policy"];
  }): AdapterRuntimeContext {
    return {
      provider: input.providerKey,
      model: input.model,
      policy: input.policy,
      workspaceRoot: this.options.deps.workspaceRoot
    };
  }
}
