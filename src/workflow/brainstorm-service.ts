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
    | "recommendedDirection";
  summary: string;
  detail: string;
};

type BrainstormReviewSummary = {
  status: "clean" | "auto_backfilled" | "needs_follow_up";
  summary: string;
  findings: BrainstormReviewFinding[];
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
      const nextDraft = this.options.deps.brainstormDraftRepository.createRevision(previousDraft, {
        ...draftUpdate,
        status: this.computeBrainstormDraftStatus({
          ...previousDraft,
          ...draftUpdate
        } as BrainstormDraft),
        lastUpdatedFromMessageId: userMessage.id
      });
      const review = this.reviewBrainstormDraft({
        draft: nextDraft,
        messageStructure,
        autoApplied
      });
      const reviewFollowUp = this.buildBrainstormReviewFollowUp(review);
      const needsStructuredFollowUp = agentOutput.needsStructuredFollowUp || review.status === "needs_follow_up";
      const followUpHint = reviewFollowUp ?? agentOutput.followUpHint ?? null;
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
            brainstormReview: review
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
        draft: this.mapBrainstormDraft(nextDraft),
        needsStructuredFollowUp,
        followUpHint,
        review
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

    const result = this.options.deps.runInTransaction(() => {
      const conceptMarkdown = this.renderConceptFromBrainstormDraft(item, draftView);
      const projectsPayload = this.buildProjectsFromBrainstormDraft(item, draftView);
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
        summary: projectsPayload.projects.map((project) => project.title).join(", "),
        status: "draft",
        markdownArtifactId: conceptArtifactRecord.id,
        structuredArtifactId: projectsArtifactRecord.id
      });
      this.options.deps.brainstormSessionRepository.update(session.id, {
        status: "resolved",
        resolvedAt: Date.now()
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

  private mapBrainstormDraft(draft: BrainstormDraft): BrainstormDraftView {
    return {
      id: draft.id,
      itemId: draft.itemId,
      sessionId: draft.sessionId,
      revision: draft.revision,
      status: draft.status,
      problem: draft.problem,
      targetUsers: JSON.parse(draft.targetUsersJson) as string[],
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
      "- If the user message is mostly a labeled plan (multiple labeled sections), extract every section even if it enlarges the patch."
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
      result[key] = JSON.stringify(this.normalizeBrainstormEntries(value));
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
      result[jsonKey] = JSON.stringify(this.normalizeBrainstormEntries([...existingEntries, ...entries]));
    }
    return result;
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
    autoApplied: BrainstormReviewSummary["autoApplied"];
  }): BrainstormReviewSummary {
    const view = this.mapBrainstormDraft(input.draft);
    const findings: BrainstormReviewFinding[] = [];

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

    if (findings.length > 0) {
      return {
        status: "needs_follow_up",
        summary: `Brainstorm review found ${findings.length} missing chat-derived draft entr${findings.length === 1 ? "y" : "ies"}.`,
        findings,
        autoApplied: input.autoApplied
      };
    }
    if (input.autoApplied.length > 0) {
      return {
        status: "auto_backfilled",
        summary: `Brainstorm review backfilled ${input.autoApplied.length} draft field${input.autoApplied.length === 1 ? "" : "s"} from the chat history.`,
        findings: [],
        autoApplied: input.autoApplied
      };
    }
    return {
      status: "clean",
      summary: "Brainstorm review found no missing chat-derived draft context.",
      findings: [],
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
      if (finding.field === "problem" || finding.field === "coreOutcome" || finding.field === "recommendedDirection") {
        return finding.field;
      }
      return `${finding.field}: ${finding.detail.match(/includes "(.+?)"/)?.[1] ?? finding.field}`;
    });
    return `Brainstorm review still misses chat-derived context. Capture: ${findings.join("; ")}.`;
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
      draft.scopeNotes ?? "No additional scope notes captured.",
      ""
    ].join("\n");
  }

  private buildProjectsFromBrainstormDraft(
    item: { title: string },
    draft: BrainstormDraftView
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
    const candidateSeeds = this.selectBrainstormProjectSeeds(draft, item.title);
    const defaultGoal = draft.coreOutcome ?? `Deliver the first usable slice for ${item.title}.`;
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
        title: this.buildBrainstormProjectTitle(item.title, seed, index),
        summary: index === 0 ? draft.problem ?? seed : seed,
        goal: candidateSeeds.length === 1 ? defaultGoal : `${defaultGoal.replace(/[.]$/, "")}: ${seed}`,
        targetUsers: [...draft.targetUsers],
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

  private selectBrainstormProjectSeeds(draft: BrainstormDraftView, itemTitle: string): string[] {
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
    const cleaned = seed
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
