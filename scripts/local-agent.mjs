import { readFileSync } from "node:fs";

const payload = JSON.parse(readFileSync(process.argv[2], "utf8"));

function normalizeEntries(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = `${value}`.replace(/\s+/g, " ").trim();
    const dedupeKey = normalized.toLowerCase();
    if (!normalized || seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    result.push(normalized);
  }
  return result;
}

function splitEntries(value) {
  return normalizeEntries(`${value}`.split(/\n|;/g));
}

function applyBrainstormLabel(result, label, value) {
  if (!value) {
    return false;
  }
  if (label === "problem") {
    result.problem = value;
    return true;
  }
  if (label === "outcome" || label === "core outcome" || label === "goal") {
    result.coreOutcome = value;
    return true;
  }
  if (label === "user" || label === "users" || label === "target user" || label === "target users" || label === "actor") {
    result.targetUsers.push(...splitEntries(value));
    return true;
  }
  if (label === "use case" || label === "use cases") {
    result.useCases.push(...splitEntries(value));
    return true;
  }
  if (label === "constraint" || label === "constraints") {
    result.constraints.push(...splitEntries(value));
    return true;
  }
  if (label === "non-goal" || label === "non-goals") {
    result.nonGoals.push(...splitEntries(value));
    return true;
  }
  if (label === "risk" || label === "risks") {
    result.risks.push(...splitEntries(value));
    return true;
  }
  if (label === "question" || label === "questions" || label === "open question" || label === "open questions") {
    result.openQuestions.push(...splitEntries(value));
    return true;
  }
  if (label === "direction" || label === "directions" || label === "candidate direction" || label === "candidate directions") {
    result.candidateDirections.push(...splitEntries(value));
    return true;
  }
  if (label === "recommended direction" || label === "recommendation") {
    result.recommendedDirection = value;
    return true;
  }
  if (label === "assumption" || label === "assumptions") {
    result.assumptions.push(...splitEntries(value));
    return true;
  }
  if (label === "scope notes" || label === "scope") {
    result.scopeNotes = value;
    return true;
  }
  if (label === "project shape decision" || label === "project shape") {
    const normalized = value.toLowerCase();
    if (/\b(not multiple|single|one focused|one project|keep this as one)\b/.test(normalized)) {
      result.projectShapeDecision = "single_project";
    } else if (/\b(split|multiple|separate projects?)\b/.test(normalized)) {
      result.projectShapeDecision = "split_projects";
    }
    result.projectShapeDecisionText = value;
    return true;
  }
  if (label === "rationale" || label === "decision rationale") {
    result.decisionRationale = result.decisionRationale
      ? normalizeEntries([result.decisionRationale, value]).join(" ")
      : value;
    return true;
  }
  return false;
}

function parseLabeledBrainstormMessage(message) {
  const result = {
    targetUsers: [],
    useCases: [],
    constraints: [],
    nonGoals: [],
    risks: [],
    openQuestions: [],
    candidateDirections: [],
    assumptions: [],
    projectShapeDecision: null,
    projectShapeDecisionText: null,
    decisionRationale: null,
    unlabeled: []
  };
  const lines = `${message}`
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean);

  let activeLabel = null;
  for (const line of lines) {
    const match = line.match(/^([a-z ]+):\s*(.*)$/i);
    if (match) {
      const label = match[1].trim().toLowerCase();
      const value = match[2].trim();
      if (!value) {
        activeLabel = label;
        continue;
      }
      activeLabel = null;
      if (applyBrainstormLabel(result, label, value)) {
        continue;
      }
      result.unlabeled.push(line);
      continue;
    }
    if (activeLabel && applyBrainstormLabel(result, activeLabel, line)) {
      continue;
    }
    result.unlabeled.push(line);
  }
  return result;
}

function normalizeEntry(value) {
  return `${value}`.replace(/\s+/g, " ").trim();
}

function mergeFragmentedEntries(values) {
  const merged = [];
  for (const rawValue of values ?? []) {
    const value = normalizeEntry(rawValue);
    if (!value) {
      continue;
    }
    const previous = merged.length > 0 ? merged[merged.length - 1] : null;
    const normalizedCurrent = value.toLowerCase();
    const previousNormalized = previous ? previous.toLowerCase() : "";
    if (
      previous
      && (/^(and|or)\b/.test(normalizedCurrent)
        || (previousNormalized.includes(" with ") && normalizedCurrent.split(" ").length <= 4)
        || (previousNormalized.includes(" of ") && normalizedCurrent.split(" ").length <= 3))
    ) {
      merged[merged.length - 1] = normalizeEntry(`${previous} ${value}`);
      continue;
    }
    merged.push(value);
  }
  return normalizeEntries(merged);
}

function normalizeUpstreamSource(upstreamSource) {
  if (!upstreamSource) {
    return {
      problem: null,
      coreOutcome: null,
      targetUsers: [],
      useCases: [],
      constraints: [],
      nonGoals: [],
      risks: [],
      assumptions: [],
      recommendedDirection: null,
      scopeNotes: null
    };
  }

  return {
    problem: upstreamSource.problem ? normalizeEntry(upstreamSource.problem) : null,
    coreOutcome: upstreamSource.coreOutcome ? normalizeEntry(upstreamSource.coreOutcome) : null,
    targetUsers: mergeFragmentedEntries(upstreamSource.targetUsers ?? []),
    useCases: mergeFragmentedEntries(upstreamSource.useCases ?? []),
    constraints: mergeFragmentedEntries(upstreamSource.constraints ?? []),
    nonGoals: mergeFragmentedEntries(upstreamSource.nonGoals ?? []),
    risks: mergeFragmentedEntries(upstreamSource.risks ?? []),
    assumptions: mergeFragmentedEntries(upstreamSource.assumptions ?? []),
    recommendedDirection: upstreamSource.recommendedDirection ? normalizeEntry(upstreamSource.recommendedDirection) : null,
    scopeNotes: upstreamSource.scopeNotes ? `${upstreamSource.scopeNotes}`.trim() : null
  };
}

function tokenize(value) {
  return normalizeEntry(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s/-]+/g, " ")
    .split(/[\s/.-]+/)
    .filter((token) => token.length >= 3);
}

function containsAny(value, keywords) {
  const normalized = normalizeEntry(value).toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword));
}

function deriveRequirementsActors(upstream) {
  const explicit = mergeFragmentedEntries(upstream.targetUsers ?? []);
  if (explicit.length > 0) {
    return explicit;
  }
  return ["workspace operator", "delivery lead", "reviewer"];
}

function selectPrimaryActor(actors, preferredKeywords) {
  const normalizedActors = actors.map((actor) => ({ original: actor, normalized: actor.toLowerCase() }));
  const match = normalizedActors.find((actor) => preferredKeywords.some((keyword) => actor.normalized.includes(keyword)));
  return match ? match.original : actors[0] ?? "operator";
}

function dedupeByTitle(stories) {
  const seen = new Set();
  const result = [];
  for (const story of stories) {
    const key = story.title.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(story);
  }
  return result;
}

function buildCoverageSection(upstream, storyLabels) {
  const sections = [];
  const pushField = (label, entries) => {
    if (!entries || entries.length === 0) {
      return;
    }
    sections.push(`### ${label}`);
    for (const entry of entries) {
      const normalizedEntry = entry.toLowerCase();
      const matched = storyLabels.filter((story) =>
        story.coverageTerms.some((term) => normalizedEntry.includes(term) || story.text.includes(term))
      );
      const targets = matched.length > 0 ? matched.map((story) => story.label).join(", ") : "Out of scope (not yet mapped)";
      sections.push(`- ${entry} -> ${targets}`);
    }
    sections.push("");
  };

  pushField("Target Users", upstream.targetUsers);
  pushField("Use Cases", upstream.useCases);
  pushField("Constraints", upstream.constraints);
  pushField("Non-Goals", upstream.nonGoals);
  pushField("Risks", upstream.risks);
  pushField("Assumptions", upstream.assumptions);
  return sections.join("\n").trim();
}

function deriveGenericPlanningContext(upstream) {
  const designConstraints = normalizeEntries([
    ...(upstream.designConstraints ?? []),
    ...(upstream.constraints ?? []).filter((entry) =>
      /\b(design|visual|layout|typography|font|color|theme|look|feel|marketing|terminal emulator|shell)\b/i.test(entry)
    )
  ]);
  const requiredDeliverables = normalizeEntries([
    ...(upstream.requiredDeliverables ?? []),
    ...(upstream.constraints ?? []).filter((entry) => /\b(showcase|inventory|deliverable)\b/i.test(entry))
  ]);
  const referenceArtifacts = normalizeEntries(upstream.referenceArtifacts ?? []);
  return { designConstraints, requiredDeliverables, referenceArtifacts };
}

function buildRequirementsStories(project, context) {
  const upstream = normalizeUpstreamSource(context?.upstreamSource);
  const genericContext = deriveGenericPlanningContext(context?.upstreamSource ?? {});
  const actors = deriveRequirementsActors(upstream);
  const operatorActor = selectPrimaryActor(actors, ["operator", "workspace"]);
  const deliveryActor = selectPrimaryActor(actors, ["delivery", "lead"]);
  const reviewerActor = selectPrimaryActor(actors, ["reviewer", "review"]);

  const useCases = upstream.useCases;
  const constraints = upstream.constraints;
  const notes = upstream.scopeNotes ? upstream.scopeNotes.toLowerCase() : "";
  const recommendedDirection = upstream.recommendedDirection ?? project.goal ?? project.summary;
  const scopeSummary = upstream.coreOutcome ?? project.goal ?? project.summary;

  const stories = [];

  const boardRelated = useCases.filter((entry) => containsAny(entry, ["workspace", "board", "column", "card", "switch"]));
  if (boardRelated.length > 0) {
    stories.push({
      title: "Operate the workspace board",
      description: `As a ${operatorActor}, I want a workspace-scoped board so that I can manage items from the primary operational view.`,
      actor: operatorActor,
      goal: "Switch workspace and work items from the real domain board",
      benefit: "The workflow stays visible and actionable without leaving the UI shell",
      acceptanceCriteria: [
        "The UI exposes the active workspace and lets the user switch to another workspace globally.",
        "The board groups real items into the domain columns idea, brainstorm, requirements, implementation, and done.",
        "Each board card shows at least item code, title, mode, and compact attention signals."
      ],
      priority: "high",
      coverageTerms: ["workspace", "board", "column", "card", "switch", "mode", "attention"]
    });
  }

  const overlayRelated = useCases.filter((entry) => containsAny(entry, ["overlay", "timeline", "next actions", "chat preview", "status"]));
  if (overlayRelated.length > 0) {
    stories.push({
      title: "Inspect item detail in an overlay panel",
      description: `As a ${deliveryActor}, I want item detail in a right-side overlay so that I can inspect status and next actions without shrinking the board.`,
      actor: deliveryActor,
      goal: "Open a selected item in an on-demand context panel",
      benefit: "Users get depth without losing the wide board view",
      acceptanceCriteria: [
        "Selecting a board card opens a right-side overlay instead of navigating to a separate detail page or reserving a permanent third column.",
        "The overlay shows the selected item summary, stage timeline, next actions, status or mode summary, and a chat preview.",
        "Closing the overlay returns focus to the board without losing the selected workspace context."
      ],
      priority: "high",
      coverageTerms: ["overlay", "timeline", "next actions", "chat preview", "status"]
    });
  }

  const inboxRelated = useCases.filter((entry) => containsAny(entry, ["inbox", "waiting", "blocked", "failed", "urgency"]));
  if (inboxRelated.length > 0) {
    stories.push({
      title: "Work the operational inbox",
      description: `As a ${deliveryActor}, I want an inbox of waiting and failed workflow work so that I can address the highest-priority attention items quickly.`,
      actor: deliveryActor,
      goal: "Review and prioritize waiting sessions, blocked reviews, and failed work",
      benefit: "Operational follow-up is visible in one structured queue",
      acceptanceCriteria: [
        "The inbox aggregates waiting sessions, blocked reviews, and failed or review-required runs from real workflow entities.",
        "Inbox entries can be sorted by urgency and provide a primary action back into the relevant item or session.",
        "The inbox is exposed as a first-class view rather than a hidden secondary utility."
      ],
      priority: "high",
      coverageTerms: ["inbox", "waiting", "blocked", "failed", "urgency", "session"]
    });
  }

  const conversationRelated = useCases.filter((entry) => containsAny(entry, ["chat", "brainstorm", "planning-review", "review"]));
  if (conversationRelated.length > 0) {
    stories.push({
      title: "Continue interactive workflow conversations",
      description: `As a ${reviewerActor}, I want to read and respond to active workflow conversations so that review and planning loops continue directly in the UI.`,
      actor: reviewerActor,
      goal: "Work brainstorm, review, and planning-review conversations from the shell",
      benefit: "Attention-heavy workflow decisions stay inside the product surface",
      acceptanceCriteria: [
        "The UI can show the active transcript for brainstorm, interactive review, and planning-review sessions.",
        "The user can send a reply and then see the refreshed session status and next actionable resolution controls.",
        "Conversation actions rely on structured workflow services rather than terminal output parsing."
      ],
      priority: "high",
      coverageTerms: ["chat", "brainstorm", "planning-review", "review", "transcript", "resolution"]
    });
  }

  const runRelated = useCases.filter((entry) => containsAny(entry, ["runs", "artifacts"]));
  if (runRelated.length > 0) {
    stories.push({
      title: "Inspect workflow runs and artifacts",
      description: `As a ${operatorActor}, I want dedicated runs and artifacts views so that I can inspect workflow evidence without leaving the UI shell.`,
      actor: operatorActor,
      goal: "Navigate run history and generated artifacts from the current workspace",
      benefit: "Operational debugging and review evidence become directly accessible",
      acceptanceCriteria: [
        "The shell includes dedicated Runs and Artifacts views for the active workspace.",
        "The runs view links to real stage or execution records and reflects current status.",
        "The artifacts view links to persisted workflow artifacts relevant to the selected workspace or item."
      ],
      priority: "medium",
      coverageTerms: ["runs", "artifacts", "history", "evidence"]
    });
  }

  if (
    containsAny(recommendedDirection, ["apps/ui", "next.js", "core services", "cli"])
    || constraints.some((entry) => containsAny(entry, ["core workflow", "cli output", "hardcode workflow logic"]))
  ) {
    stories.push({
      title: "Build the shell on shared core services",
      description: `As a ${operatorActor}, I want the UI to rely on shared workflow services so that the shell stays aligned with the engine instead of wrapping CLI text.`,
      actor: operatorActor,
      goal: "Expose structured board, inbox, item-detail, conversation, and action-capability read models through core services",
      benefit: "UI behavior stays consistent with workflow rules and remains testable",
      acceptanceCriteria: [
        "The UI reads board, inbox, item detail, and conversation state from shared application or core services or thin API handlers.",
        "The shell does not parse terminal output and does not duplicate workflow rules inside visual components.",
        "Components remain data-driven and consume structured view models and capability lists."
      ],
      priority: "high",
      coverageTerms: ["core services", "cli", "workflow rules", "data-driven", "capability", "read model"]
    });
  }

  if (containsAny(notes, ["showcase"]) || constraints.some((entry) => containsAny(entry, ["showcase"]))) {
    stories.push({
      title: "Maintain a reusable UI component system",
      description: `As a ${deliveryActor}, I want a reusable component system with a showcase so that the shell can evolve without page-specific markup drift.`,
      actor: deliveryActor,
      goal: "Ship reusable shell components together with a visible showcase and component inventory",
      benefit: "UI quality and reviewability improve as new screens are added",
      acceptanceCriteria: [
        "Core shell, board, overlay, inbox, conversation, and primitive components are implemented as reusable named components.",
        "The UI includes a showcase route that renders central components in realistic state variants, including empty, loading, and error states.",
        "A maintained component inventory documents component purpose, main props or view model, and implementation status."
      ],
      priority: "medium",
      coverageTerms: ["component", "showcase", "inventory", "primitive", "reuse"]
    });
  }

  if (stories.length === 0) {
    stories.push({
      title: `Deliver ${project.title} through the UI shell`,
      description: `As a ${operatorActor}, I want the first usable slice of ${project.title} represented in the UI shell.`,
      actor: operatorActor,
      goal: `Manage ${project.title} from a structured user interface`,
      benefit: "Traceable workflow execution without terminal wrapping",
      acceptanceCriteria: [
        "The UI exposes the project through structured workflow services.",
        "The resulting shell reflects the primary user outcomes described in the project goal."
      ],
      priority: "high",
      coverageTerms: tokenize(scopeSummary)
    });
  }

  return {
    upstream,
    genericContext,
    actors,
    scopeSummary,
    stories: dedupeByTitle(stories)
  };
}

function brainstormChat(payload) {
  const parsed = parseLabeledBrainstormMessage(payload.userMessage);
  const draftPatch = {};
  if (parsed.problem !== undefined) {
    draftPatch.problem = parsed.problem;
  }
  if (parsed.coreOutcome !== undefined) {
    draftPatch.coreOutcome = parsed.coreOutcome;
  }
  if (parsed.targetUsers.length > 0) {
    draftPatch.targetUsers = normalizeEntries([...payload.draft.targetUsers, ...parsed.targetUsers]);
  }
  if (parsed.useCases.length > 0) {
    draftPatch.useCases = normalizeEntries([...payload.draft.useCases, ...parsed.useCases]);
  }
  if (parsed.constraints.length > 0) {
    draftPatch.constraints = normalizeEntries([...payload.draft.constraints, ...parsed.constraints]);
  }
  if (parsed.nonGoals.length > 0) {
    draftPatch.nonGoals = normalizeEntries([...payload.draft.nonGoals, ...parsed.nonGoals]);
  }
  if (parsed.risks.length > 0) {
    draftPatch.risks = normalizeEntries([...payload.draft.risks, ...parsed.risks]);
  }
  if (parsed.openQuestions.length > 0) {
    draftPatch.openQuestions = normalizeEntries([...payload.draft.openQuestions, ...parsed.openQuestions]);
  }
  if (parsed.candidateDirections.length > 0) {
    draftPatch.candidateDirections = normalizeEntries([...payload.draft.candidateDirections, ...parsed.candidateDirections]);
  }
  if (parsed.assumptions.length > 0) {
    draftPatch.assumptions = normalizeEntries([...payload.draft.assumptions, ...parsed.assumptions]);
  }
  if (parsed.recommendedDirection !== undefined) {
    draftPatch.recommendedDirection = parsed.recommendedDirection;
  } else if (parsed.candidateDirections.length > 0 && !payload.draft.recommendedDirection) {
    draftPatch.recommendedDirection = parsed.candidateDirections[0];
  }
  if (parsed.scopeNotes !== undefined) {
    draftPatch.scopeNotes = parsed.scopeNotes;
  } else if (parsed.unlabeled.length > 0) {
    const previousNotes = payload.draft.scopeNotes ? [payload.draft.scopeNotes] : [];
    draftPatch.scopeNotes = normalizeEntries([...previousNotes, ...parsed.unlabeled]).join("\n");
  }

  let projectShapeDecision = null;
  let decisionRationale = null;
  let projectSeeds = [];
  if (parsed.projectShapeDecision) {
    projectShapeDecision = parsed.projectShapeDecision;
    decisionRationale = parsed.decisionRationale
      ?? (projectShapeDecision === "split_projects"
        ? "The message explicitly chooses to split the brainstorm into multiple projects."
        : "The message explicitly keeps the brainstorm as one focused project.");
    if (projectShapeDecision === "split_projects") {
      projectSeeds = normalizeEntries(
        parsed.candidateDirections.length > 0
          ? parsed.candidateDirections
          : [parsed.projectShapeDecisionText ?? "Split project track"]
      ).slice(0, 3);
    } else {
      projectSeeds = [
        parsed.recommendedDirection
        ?? parsed.projectShapeDecisionText
        ?? payload.draft.recommendedDirection
        ?? payload.item.title
      ];
    }
  } else if (parsed.recommendedDirection) {
    projectShapeDecision = "single_project";
    decisionRationale = "The message includes an explicit recommended direction, so the brainstorm stays focused on one project.";
    projectSeeds = [parsed.recommendedDirection];
  } else if (parsed.candidateDirections.length > 1) {
    projectShapeDecision = "split_projects";
    decisionRationale = "The message presents multiple candidate directions as separate delivery tracks.";
    projectSeeds = normalizeEntries(parsed.candidateDirections).slice(0, 3);
  }

  const needsStructuredFollowUp = Object.keys(draftPatch).length === 0 || projectShapeDecision === null;
  return {
    output: {
      assistantMessage: needsStructuredFollowUp
        ? "I need one more structured clarification before this brainstorm is concept-ready. Use labeled fields or `brainstorm:draft:update` for precise edits."
        : `Captured brainstorm updates for ${payload.item.code}. Review the draft and continue refining or promote when ready.`,
      draftPatch,
      projectShapeDecision,
      decisionRationale,
      projectSeeds,
      needsStructuredFollowUp,
      followUpHint: needsStructuredFollowUp
        ? "Use labels like `problem:`, `users:`, `use cases:`, and clarify whether this should stay one project or split into multiple projects."
        : null
    }
  };
}

function messageIncludesPositiveSignal(message, signal) {
  const escapedSignal = signal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const negativePrefixes = ["do not", "don't", "dont", "no", "not", "never", "avoid", "skip"];
  if (negativePrefixes.some((prefix) => new RegExp(`\\b${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+${escapedSignal}\\b`).test(message))) {
    return false;
  }
  return new RegExp(`\\b${escapedSignal}\\b`).test(message);
}

function storyReviewChat(payload) {
  const normalized = payload.userMessage.toLowerCase();
  const revisionSignals = ["needs revision", "need revision", "revise", "revision", "change", "fix", "ueberarbeiten"];
  const rejectSignals = ["reject", "rejected", "ablehnen"];
  const approveSignals = ["approve", "approved", "looks good", "ok", "passt", "freigeben"];
  const severitySignals = [
    { severity: "critical", keywords: ["critical"] },
    { severity: "high", keywords: ["high"] },
    { severity: "medium", keywords: ["medium"] },
    { severity: "low", keywords: ["low"] }
  ];
  const status = rejectSignals.some((signal) => messageIncludesPositiveSignal(normalized, signal))
    ? "rejected"
    : revisionSignals.some((signal) => messageIncludesPositiveSignal(normalized, signal))
      ? "needs_revision"
      : approveSignals.some((signal) => messageIncludesPositiveSignal(normalized, signal))
        ? "accepted"
        : null;
  const severity = severitySignals.find((candidate) => candidate.keywords.some((keyword) => normalized.includes(keyword)))?.severity ?? null;
  const matchedStories = payload.stories.filter(
    (story) => normalized.includes(story.code.toLowerCase()) || normalized.includes(story.title.toLowerCase())
  );
  const entryUpdates = status
    ? matchedStories.map((story) => ({
        entryId: story.entryId,
        status,
        summary:
          status === "accepted"
            ? "Accepted from interactive review chat"
            : status === "needs_revision"
              ? "Revision requested from interactive review chat"
              : "Rejected from interactive review chat",
        changeRequest: status === "accepted" ? null : payload.userMessage,
        rationale: null,
        severity
      }))
    : [];
  const needsStructuredFollowUp = entryUpdates.length === 0;
  return {
    output: {
      assistantMessage: needsStructuredFollowUp
        ? `I could not safely map that feedback to a specific story in ${payload.project.code}. Use the story code/title or switch to \`review:entry:update\` / \`review:story:edit\`.`
        : `Captured ${entryUpdates.length} structured review update(s) for ${payload.project.code}.`,
      entryUpdates,
      needsStructuredFollowUp,
      followUpHint: needsStructuredFollowUp ? "Reference a specific story code or use the structured review commands." : null,
      recommendedResolution: null
    }
  };
}

function workspaceSetupAssist(payload) {
  const normalizedMessage = `${payload.userMessage}`.trim().toLowerCase();
  const plan = {
    ...payload.currentPlan,
    generatedAt: Date.now()
  };
  const rationale = [];
  const warnings = [];

  if (normalizedMessage.includes("brownfield") || normalizedMessage.includes("existing project")) {
    plan.mode = "brownfield";
    plan.scaffoldProjectFiles = false;
    rationale.push("The request points to an existing project, so starter scaffold files stay disabled.");
  }

  if (normalizedMessage.includes("greenfield") || normalizedMessage.includes("new project")) {
    plan.mode = "greenfield";
    plan.scaffoldProjectFiles = true;
    rationale.push("The request points to a new project, so starter scaffold files stay enabled.");
  }

  if (normalizedMessage.includes("install deps") || normalizedMessage.includes("install dependencies")) {
    plan.installDeps = true;
    rationale.push("The user explicitly asked to install dependencies.");
  }

  if (normalizedMessage.includes("no sonar") || normalizedMessage.includes("without sonar")) {
    plan.withSonar = false;
    rationale.push("The user explicitly disabled Sonar bootstrap.");
  }

  if (normalizedMessage.includes("no coderabbit") || normalizedMessage.includes("without coderabbit")) {
    plan.withCoderabbit = false;
    rationale.push("The user explicitly disabled CodeRabbit bootstrap.");
  }

  if (payload.doctor.status === "blocked") {
    warnings.push("The doctor report is blocked. Resolve the blocking setup issues before executing the plan.");
  }

  return {
    output: {
      assistantMessage:
        plan.mode === "brownfield"
          ? `Prepared a brownfield setup plan for ${payload.workspace.key}. Existing project files remain authoritative.`
          : `Prepared a greenfield setup plan for ${payload.workspace.key}. Starter files can be scaffolded deterministically.`,
      plan,
      rationale,
      warnings,
      needsUserInput: false,
      followUpHint: null
    }
  };
}

function brainstorming(item) {
  const projectTitle = `${item.title} Core Flow`;
  return {
    markdownArtifacts: [
      {
        kind: "concept",
        content: `# ${item.title} Concept

## Item Code
${item.code}

## Summary
${item.description || "A locally orchestrated MVP item."}

## Proposed Projects
- ${projectTitle}`
      }
    ],
    structuredArtifacts: [
      {
        kind: "projects",
        content: {
          projects: [
            {
              title: projectTitle,
              summary: `Primary delivery track for ${item.title}.`,
              goal: `Deliver the first usable slice for ${item.title}.`
            }
          ]
        }
      }
    ]
  };
}

function requirements(project, context) {
  const clarificationText = mergeFragmentedEntries(context?.userClarifications ?? []);
  const clarificationBlob = clarificationText.join(" ").toLowerCase();
  const normalizedUpstream = normalizeUpstreamSource(context?.upstreamSource);
  const focusSignalText = [
    normalizedUpstream.coreOutcome,
    normalizedUpstream.recommendedDirection,
    ...normalizedUpstream.constraints
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const broadScope =
    normalizedUpstream.useCases.length >= 6
    || normalizedUpstream.constraints.length + normalizedUpstream.nonGoals.length + normalizedUpstream.risks.length >= 6;
  const hasOutcomeClarification =
    clarificationBlob.includes("smallest useful")
    || clarificationBlob.includes("first useful")
    || clarificationBlob.includes("first slice")
    || clarificationBlob.includes("v1")
    || clarificationBlob.includes("first release")
    || clarificationBlob.includes("board")
    || clarificationBlob.includes("overlay")
    || clarificationBlob.includes("inbox")
    || focusSignalText.includes("board-first")
    || focusSignalText.includes("primary operational view")
    || focusSignalText.includes("primary surface");

  if (broadScope && !hasOutcomeClarification) {
    return {
      markdownArtifacts: [],
      structuredArtifacts: [],
      needsUserInput: true,
      userInputQuestion:
        "What is the smallest useful user outcome for this project slice, and which capabilities must be in scope for that first release?",
      followUpHint:
        "Answer with the primary user outcome plus the must-have capabilities for the first release. Example: board + overlay + inbox, while runs/artifacts and showcase follow later."
    };
  }

  const { upstream, genericContext, stories, scopeSummary } = buildRequirementsStories(project, context);
  const storyLabels = stories.map((story, index) => ({
    label: `Story ${index + 1}: ${story.title}`,
    coverageTerms: story.coverageTerms,
    text: `${story.title} ${story.description} ${story.goal} ${story.benefit}`.toLowerCase()
  }));
  const constraintsSection = mergeFragmentedEntries([
    ...upstream.constraints,
    ...upstream.nonGoals,
    ...upstream.risks,
    ...upstream.assumptions
  ]);
  const edgeCases = [
    "Empty states for boards, inboxes, transcripts, runs, and artifacts are explicitly represented.",
    "Failed or review-required workflow work remains visible with a recovery path back into the relevant item or session.",
    "Workspace switching preserves the current shell context without leaking data from another workspace."
  ];
  const sourceCoverage = buildCoverageSection(upstream, storyLabels);

  return {
    markdownArtifacts: [
      {
        kind: "stories-markdown",
        content: `# Stories for ${project.code} ${project.title}

## Project Goal
${project.goal}

## Scope Summary
${scopeSummary}

## User Stories
${stories.map((story, index) => `### Story ${index + 1}: ${story.title}

- Actor: ${story.actor}
- Goal: ${story.goal}
- Benefit: ${story.benefit}
- Description: ${story.description}
- Acceptance Criteria:
${story.acceptanceCriteria.map((criterion) => `  - ${criterion}`).join("\n")}`).join("\n\n")}

## Edge Cases
${edgeCases.map((entry) => `- ${entry}`).join("\n")}

## Constraints / Notes
${constraintsSection.map((entry) => `- ${entry}`).join("\n")}

## Design Constraints
${(genericContext.designConstraints.length > 0 ? genericContext.designConstraints : ["No explicit design constraints captured."]).map((entry) => `- ${entry}`).join("\n")}

## Required Deliverables
${(genericContext.requiredDeliverables.length > 0 ? genericContext.requiredDeliverables : ["No explicit required deliverables captured."]).map((entry) => `- ${entry}`).join("\n")}

## Reference Artifacts
${(genericContext.referenceArtifacts.length > 0 ? genericContext.referenceArtifacts : ["No explicit reference artifacts captured."]).map((entry) => `- ${entry}`).join("\n")}

## Source Coverage
${sourceCoverage || "- No structured upstream coverage entries were available."}`
      }
    ],
    structuredArtifacts: [
      {
        kind: "stories",
        content: {
          stories: stories.map(({ coverageTerms, ...story }) => story)
        }
      }
    ]
  };
}

function architecture(project, context) {
  const reviewFeedback = context?.reviewFeedback ?? [];
  const latestFeedback = reviewFeedback.length > 0 ? reviewFeedback[reviewFeedback.length - 1] : null;
  const revisionNotes = latestFeedback
    ? latestFeedback.findings.map((finding) => `${finding.title}: ${finding.detail}`)
    : [];
  return {
    markdownArtifacts: [
      {
        kind: "architecture-plan",
        content: `# Architecture Plan for ${project.code} ${project.title}

## Summary
Modular engine-first implementation with reproducible stage runs.

${revisionNotes.length > 0 ? `## Revision Notes\n${revisionNotes.map((note) => `- ${note}`).join("\n")}` : ""}`
      }
    ],
    structuredArtifacts: [
      {
        kind: "architecture-plan-data",
        content: {
          summary: `Modular architecture for ${project.title}`,
          decisions: [
            "Keep workflow logic in the domain layer",
            "Store stage runs and artifacts separately",
            ...(latestFeedback ? ["Address the latest planning-review feedback inside the architecture artifact"] : [])
          ],
          risks: ["Prompt or skill files may drift without snapshots"],
          nextSteps: ["Continue into implementation waves after approval"]
        }
      }
    ]
  };
}

function planning(project, context) {
  const reviewFeedback = context?.reviewFeedback ?? [];
  const latestFeedback = reviewFeedback.length > 0 ? reviewFeedback[reviewFeedback.length - 1] : null;
  const feedbackText = JSON.stringify(latestFeedback ?? {}).toLowerCase();
  const stories = context?.stories ?? [
    { code: `${project.code}-US01`, title: `Create ${project.title} workflow record` },
    { code: `${project.code}-US02`, title: `Approve ${project.title} stories` }
  ];
  const waves = stories.map((story, index) => ({
    waveCode: `W${String(index + 1).padStart(2, "0")}`,
    goal: index === 0 ? "Establish the first executable slice" : `Advance ${story.title}`,
    dependsOn: index === 0 ? [] : [`W${String(index).padStart(2, "0")}`],
    stories: [
      {
        storyCode: story.code,
        dependsOnStoryCodes: index === 0 ? [] : [stories[index - 1].code],
        parallelGroup: null
      }
    ]
  }));

  return {
    markdownArtifacts: [
      {
        kind: "implementation-plan",
        content: `# Implementation Plan for ${project.code} ${project.title}

## Summary
Locally generated wave plan grounded in the approved architecture.

## Waves
${waves.map((wave) => `- ${wave.waveCode}: ${wave.goal}`).join("\n")}`
      }
    ],
    structuredArtifacts: [
      {
        kind: "implementation-plan-data",
        content: {
          summary: `Incremental implementation plan for ${project.title}`,
          waves,
          risks: ["Later implementation may refine story-level sequencing inside each wave"],
          assumptions: ["The approved architecture remains the governing structure for execution"],
          testPlan:
            latestFeedback && feedbackText.includes("test plan")
              ? [
                  "Verify each wave through targeted story-level tests before execution advances.",
                  "Run a focused workflow regression pass before project QA."
                ]
              : [],
          rolloutPlan:
            latestFeedback && feedbackText.includes("rollout")
              ? [
                  "Release the first wave behind a controlled rollout gate.",
                  "Keep a rollback path that restores the previous shell behavior if the new slice fails."
                ]
              : []
        }
      }
    ]
  };
}

function testPreparation(payload) {
  const baseName = payload.story.code.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const testPath = `test/generated/${baseName}.test.ts`;
  return {
    output: {
      summary: `Local test writer prepared a deterministic failing test plan for ${payload.story.code}.`,
      testFiles: [
        {
          path: testPath,
          content: `describe("${payload.story.code}", () => {\n  it("covers the planned acceptance criteria", () => {\n    throw new Error("Generated failing test placeholder");\n  });\n});\n`,
          writeMode: "proposed"
        }
      ],
      testsGenerated: payload.acceptanceCriteria.map((criterion) => ({
        path: testPath,
        intent: `Verify ${criterion.code}: ${criterion.text}`
      })),
      assumptions: [
        "The generated tests are stored as structured output before repo mutation is enforced.",
        "The implementer receives these test targets as the success contract."
      ],
      blockers: []
    }
  };
}

function storyExecution(payload) {
  const targetFiles = [];
  const storyText = `${payload.story.title} ${payload.story.description} ${payload.story.goal}`.toLowerCase();

  if (storyText.includes("workflow")) {
    targetFiles.push("src/workflow/workflow-service.ts");
  }
  if (storyText.includes("cli")) {
    targetFiles.push("src/cli/main.ts");
  }
  if (targetFiles.length === 0) {
    targetFiles.push("src/domain/types.ts");
  }

  return {
    output: {
      summary: `Local execution worker prepared ${payload.story.code} with role ${payload.workerRole} against ${payload.testPreparation.testFiles.length} prewritten test target(s).`,
      changedFiles: targetFiles,
      testsRun: [
        {
          command: `npm test -- ${payload.testPreparation.testFiles[0].path}`,
          status: "passed"
        }
      ],
      implementationNotes: [
        `Story ${payload.story.code} executed with curated repo context.`,
        `Wave ${payload.wave.code} remains engine-orchestrated.`,
        `Implementation used prewritten tests from test preparation ${payload.testPreparation.id}.`
      ],
      blockers: []
    }
  };
}

function ralphVerification(payload) {
  const status = payload.basicVerification.status === "failed"
    ? "failed"
    : payload.basicVerification.status === "review_required"
      ? "review_required"
      : "passed";

  return {
    output: {
      storyCode: payload.story.code,
      overallStatus: status,
      summary:
        status === "passed"
          ? `Ralph verification passed for ${payload.story.code}.`
          : `Ralph verification requires follow-up for ${payload.story.code}.`,
      acceptanceCriteriaResults: payload.acceptanceCriteria.map((criterion) => ({
        acceptanceCriterionId: criterion.id,
        acceptanceCriterionCode: criterion.code,
        status,
        evidence:
          status === "passed"
            ? `Observed in ${payload.implementation.testsRun.map((testRun) => testRun.command).join(", ")} and implementation summary.`
            : `Basic verification status was ${payload.basicVerification.status}; acceptance criterion cannot be considered complete.`,
        notes:
          status === "passed"
            ? `Criterion ${criterion.code} is covered by the stored test and implementation evidence.`
            : `Criterion ${criterion.code} needs follow-up before completion.`
      })),
      blockers: status === "passed" ? [] : payload.implementation.blockers
    }
  };
}

function appVerification(payload) {
  const storyText = `${payload.story.title} ${payload.story.description} ${payload.story.goal}`.toLowerCase();
  const hasConfig = Boolean(payload.projectAppTestContext?.baseUrl);
  const runner = payload.preparedSession?.runner ?? payload.projectAppTestContext?.runnerPreference?.[0] ?? "agent_browser";
  const resolvedStartUrl = payload.preparedSession?.resolvedStartUrl ?? payload.projectAppTestContext?.baseUrl ?? null;

  let overallStatus = "passed";
  let failureSummary = null;
  if (!hasConfig) {
    overallStatus = "failed";
    failureSummary = "App test configuration is missing a baseUrl.";
  } else if (storyText.includes("browser infra fail") || storyText.includes("app infra fail")) {
    overallStatus = "failed";
    failureSummary = `The local browser runner could not prepare ${payload.story.code}.`;
  } else if (storyText.includes("browser fail") || storyText.includes("ui fail") || storyText.includes("app review required")) {
    overallStatus = "review_required";
    failureSummary = `The local browser flow exposed a product issue for ${payload.story.code}.`;
  }

  return {
    output: {
      storyCode: payload.story.code,
      runner,
      overallStatus,
      summary:
        overallStatus === "passed"
          ? `App verification passed for ${payload.story.code}.`
          : overallStatus === "review_required"
            ? `App verification found a product issue for ${payload.story.code}.`
            : `App verification failed to prepare the browser session for ${payload.story.code}.`,
      resolvedStartUrl,
      checks: payload.storyAppVerificationContext.checks.map((check, index) => ({
        id: check.id || `check-${index + 1}`,
        description: check.description,
        status: overallStatus,
        evidence:
          overallStatus === "passed"
            ? `Observed expected product signal at ${resolvedStartUrl ?? payload.projectAppTestContext.baseUrl}.`
            : overallStatus === "review_required"
              ? `The UI flow did not satisfy the expected outcome: ${check.expectedOutcome}.`
              : failureSummary ?? "Browser session preparation failed before the story flow could be executed."
      })),
      artifacts: [
        {
          kind: "report",
          path: `artifacts/app-verification/${payload.story.code.toLowerCase()}.json`,
          label: `${payload.story.code} app verification report`,
          contentType: "application/json"
        }
      ],
      failureSummary
    }
  };
}

function qaVerification(payload) {
  const findings = [];

  for (const story of payload.stories) {
    let implementation = null;
    try {
      implementation = story.latestExecution.outputSummaryJson
        ? JSON.parse(story.latestExecution.outputSummaryJson)
        : null;
    } catch {
      implementation = null;
    }
    const changedFiles = implementation?.changedFiles ?? story.latestExecution?.changedFiles ?? [];
    const hasPassingTestEvidence = (implementation?.testsRun ?? []).some((testRun) => testRun.status === "passed");
    if (!changedFiles.some((path) => path.includes("test")) && !hasPassingTestEvidence) {
      findings.push({
        severity: "medium",
        category: "regression",
        title: `No concrete test file mutation recorded for ${story.code}`,
        description: `${story.code} completed without a changed file path under test/, which is a regression risk at project level.`,
        evidence: `Changed files: ${changedFiles.join(", ") || "none recorded"}.`,
        reproSteps: [
          "Inspect the implementation output for the completed story",
          "Confirm that only source files were reported as changed"
        ],
        suggestedFix: "Persist at least one concrete test file mutation or extend the generated execution output to show the committed test artifact.",
        storyCode: story.code,
        acceptanceCriterionCode: null
      });
    }
  }

  const highestSeverity = findings.some((finding) => finding.severity === "critical" || finding.severity === "high")
    ? "failed"
    : findings.length > 0
      ? "review_required"
      : "passed";

  return {
    output: {
      projectCode: payload.project.code,
      overallStatus: highestSeverity,
      summary:
        highestSeverity === "passed"
          ? `QA passed for ${payload.project.code} with no project-level findings.`
          : `QA found ${findings.length} project-level issue(s) for ${payload.project.code}.`,
      findings,
      recommendations:
        findings.length > 0
          ? ["Tighten the implementation output so QA can trace concrete test file mutations per story."]
          : ["No additional QA follow-up is required in the local stub."]
    }
  };
}

function storyReview(payload) {
  const findings = [];
  const changedFiles = payload.implementation?.changedFiles ?? [];
  const testsRun = payload.implementation?.testsRun ?? [];
  const hasTargetedTests = testsRun.some((testRun) => testRun.status === "passed");

  if (!hasTargetedTests) {
    findings.push({
      severity: "high",
      category: "correctness",
      title: `No passing test evidence recorded for ${payload.story.code}`,
      description: `${payload.story.code} reached story review without any passing test command in the implementation output.`,
      evidence: `Implementation tests: ${testsRun.map((testRun) => `${testRun.command}:${testRun.status}`).join(", ") || "none recorded"}.`,
      filePath: changedFiles[0] ?? null,
      line: null,
      suggestedFix: "Ensure the implementation worker records at least one passing test command before story review."
    });
  }

  const overallStatus = findings.some((finding) => finding.severity === "critical" || finding.severity === "high")
    ? "failed"
    : findings.length > 0
      ? "review_required"
      : "passed";

  return {
    output: {
      storyCode: payload.story.code,
      overallStatus,
      summary:
        overallStatus === "passed"
          ? `No technical risks were found in the bounded story review for ${payload.story.code}.`
          : `Story review found ${findings.length} technical issue(s) for ${payload.story.code}.`,
      findings,
      recommendations:
        findings.length > 0
          ? ["Tighten the implementation evidence and re-run the story after addressing the review findings."]
          : ["No additional story-review follow-up is required in the local stub."]
    }
  };
}

function documentationWriter(payload) {
  let qaSummary = null;
  try {
    qaSummary = payload.latestQaRun.summaryJson ? JSON.parse(payload.latestQaRun.summaryJson) : null;
  } catch {
    qaSummary = null;
  }
  const qaOpenFindings = payload.openQaFindings.length;
  const changedAreas = Array.from(
    new Set(payload.stories.flatMap((story) => story.latestExecution.changedFiles ?? []))
  );
  const technicalReviewCounts = payload.stories.flatMap((story) => story.latestStoryReview.findings).reduce(
    (acc, finding) => {
      acc[finding.severity] += finding.status === "open" ? 1 : 0;
      return acc;
    },
    { critical: 0, high: 0, medium: 0, low: 0 }
  );
  const overallStatus = payload.latestQaRun.status === "review_required" ? "review_required" : "completed";
  const reportMarkdown = `# ${payload.project.code} Delivery Report

## Outcome Summary
${payload.project.title} completed through execution, QA, and documentation with status \`${overallStatus}\`.

## Original Scope
${payload.concept?.summary ?? `Deliver the first usable slice for ${payload.project.title}.`}

## Delivered Scope
${payload.stories.map((story) => `- ${story.code}: ${story.title}`).join("\n")}

## Architecture Snapshot
${payload.architecture?.summary ?? "No separate architecture summary was stored."}

## Execution Summary By Wave
${payload.waves.map((wave) => `- ${wave.code}: ${wave.goal} (${wave.storiesDelivered.join(", ")})`).join("\n")}

## Test And Verification Summary
- Ralph passed for ${payload.stories.map((story) => story.code).join(", ")}
- QA status: ${payload.latestQaRun.status}

## Technical Review Summary
- Reviewed stories: ${payload.stories.map((story) => story.code).join(", ")}
- Open technical findings: critical ${technicalReviewCounts.critical}, high ${technicalReviewCounts.high}, medium ${technicalReviewCounts.medium}, low ${technicalReviewCounts.low}

## QA Summary
${qaSummary?.summary ?? `QA found ${qaOpenFindings} open finding(s).`}

## Open Follow-Ups
${qaOpenFindings > 0 ? payload.openQaFindings.map((finding) => `- ${finding.title}`).join("\n") : "- None."}

## Key Changed Areas
${changedAreas.length > 0 ? changedAreas.map((area) => `- ${area}`).join("\n") : "- No changed areas were recorded."}
`;

  return {
    output: {
      projectCode: payload.project.code,
      overallStatus,
      summary:
        overallStatus === "completed"
          ? `Documentation completed for ${payload.project.code}.`
          : `Documentation completed with open follow-ups for ${payload.project.code}.`,
      originalScope: payload.concept?.summary ?? `Deliver the first usable slice for ${payload.project.title}.`,
      deliveredScope: `Delivered ${payload.stories.length} stories across ${payload.waves.length} waves.`,
      architectureSnapshot: payload.architecture?.summary ?? "No architecture summary was stored.",
      waves: payload.waves.map((wave) => ({
        waveCode: wave.code,
        goal: wave.goal,
        storiesDelivered: wave.storiesDelivered
      })),
      storiesDelivered: payload.stories.map((story) => ({
        storyCode: story.code,
        summary: story.latestExecution.summary
      })),
      verificationSummary: {
        ralphPassedStoryCodes: payload.stories.map((story) => story.code),
        storyReviewPassedStoryCodes: payload.stories
          .filter((story) => story.latestStoryReview.status === "passed")
          .map((story) => story.code),
        qaStatus: payload.latestQaRun.status,
        qaOpenFindingCount: qaOpenFindings
      },
      technicalReviewSummary: {
        reviewedStoryCodes: payload.stories.map((story) => story.code),
        openFindingCounts: technicalReviewCounts
      },
      qaSummary: {
        status: payload.latestQaRun.status,
        summary: qaSummary?.summary ?? `QA found ${qaOpenFindings} open finding(s).`,
        openFindings: qaOpenFindings
      },
      openFollowUps:
        qaOpenFindings > 0
          ? payload.openQaFindings.map((finding) => finding.title)
          : ["No open follow-ups remain in the local documentation stub."],
      keyChangedAreas: changedAreas,
      reportMarkdown
    }
  };
}

function planningReview(payload) {
  const findings = [];
  const missingInformation = [];
  const recommendedNextEvidence = [];
  const assumptionsDetected = normalizeEntries(payload.artifact.assumptions ?? []);
  const clarificationAnswers = payload.artifact.clarificationAnswers ?? [];

  const roleLabel =
    payload.reviewerRole === "implementation_reviewer"
      ? "implementation"
      : payload.reviewerRole === "architecture_challenger"
        ? "architecture"
        : payload.reviewerRole === "decision_auditor"
          ? "decision"
          : payload.reviewerRole;

  const hasClarificationFor = (keywords) =>
    clarificationAnswers.some(
      (entry) =>
        entry.answer &&
        keywords.some((keyword) => `${entry.question} ${entry.answer}`.toLowerCase().includes(keyword.toLowerCase()))
    );

  const requireField = (value, label, question, keywords = []) => {
    if ((!value || `${value}`.trim().length === 0) && keywords.length > 0 && hasClarificationFor(keywords)) {
      assumptionsDetected.push(`Clarification answers partially cover missing ${label}.`);
      return;
    }
    if (value && `${value}`.trim().length > 0) {
      return;
    }
    findings.push({
      type: "blocker",
      title: `${label} is missing`,
      detail: `${roleLabel} review cannot validate the artifact without an explicit ${label}.`,
      evidence: null
    });
    missingInformation.push(question);
  };

  requireField(payload.artifact.problem, "problem statement", "What exact user or delivery problem is being solved?", ["problem"]);
  requireField(payload.artifact.goal, "goal", "What concrete outcome defines success for this artifact?", ["goal", "success"]);
  requireField(payload.artifact.proposal, "proposal", "What is the currently preferred approach?", ["proposal", "approach", "direction"]);

  if ((payload.artifact.risks ?? []).length === 0) {
    findings.push({
      type: "major_concern",
      title: "Risks are missing",
      detail: `${roleLabel} review has no explicit risk register to validate tradeoffs or rollout safety.`,
      evidence: null
    });
    recommendedNextEvidence.push("List the main delivery, migration, and operational risks explicitly.");
  }

  if (payload.step === "plan_writing" && (payload.artifact.testPlan ?? []).length === 0 && !hasClarificationFor(["test", "verification"])) {
    findings.push({
      type: "question",
      title: "Test plan is missing",
      detail: "Implementation readiness depends on a credible test path.",
      evidence: null
    });
    missingInformation.push("Which tests or verification steps will prove the plan is complete?");
  }

  if (payload.step === "plan_writing" && (payload.artifact.rolloutPlan ?? []).length === 0 && !hasClarificationFor(["rollout", "deploy", "rollback"])) {
    findings.push({
      type: "question",
      title: "Rollout plan is missing",
      detail: "The plan has no explicit rollout or rollback path.",
      evidence: null
    });
    recommendedNextEvidence.push("Add a rollout and rollback outline for production-facing changes.");
  }

  if (payload.reviewMode === "alternatives" && (payload.artifact.alternatives ?? []).length === 0) {
    findings.push({
      type: "major_concern",
      title: "Alternatives are not documented",
      detail: "The current proposal converged without any explicit alternative analysis.",
      evidence: null
    });
  }

  if ((payload.artifact.openQuestions ?? []).length > 0) {
    findings.push({
      type: "question",
      title: "Open questions remain",
      detail: `The artifact still lists ${payload.artifact.openQuestions.length} unresolved question(s).`,
      evidence: payload.artifact.openQuestions.join("; ")
    });
  }

  if ((payload.artifact.clarificationAnswers ?? []).length > 0) {
    recommendedNextEvidence.push(
      `Incorporate ${payload.artifact.clarificationAnswers.length} clarification answer(s) back into the source artifact.`
    );
  }

  const hasBlocker = findings.some((finding) => finding.type === "blocker");
  const hasQuestion = findings.some((finding) => finding.type === "question");
  const hasMajorConcern = findings.some((finding) => finding.type === "major_concern");

  return {
    output: {
      status: hasBlocker ? "needs_clarification" : hasQuestion ? "questions_only" : hasMajorConcern ? "in_review" : "ready",
      readiness: hasBlocker ? "needs_evidence" : hasQuestion ? "needs_evidence" : hasMajorConcern ? "ready_with_assumptions" : "ready",
      summary: hasBlocker
        ? `${roleLabel} review found blocking gaps in the artifact.`
        : hasQuestion || hasMajorConcern
          ? `${roleLabel} review found follow-up work but no hard blocker.`
          : `${roleLabel} review found the artifact ready to proceed.`,
      findings,
      missingInformation: normalizeEntries(missingInformation),
      recommendedNextEvidence: normalizeEntries(recommendedNextEvidence),
      assumptionsDetected
    }
  };
}

function implementationReview(payload) {
  const findings = [];
  const changedFiles = payload.implementation?.changedFiles ?? [];
  const testsRun = payload.implementation?.testsRun ?? [];
  const externalSignals = payload.externalSignals ?? [];
  const latestStoryReviewFindings = payload.latestStoryReview?.findings ?? [];
  const hasReviewRequiredVerification = [payload.basicVerification?.status, payload.ralphVerification?.status, payload.appVerification?.status].some(
    (status) => status && status !== "passed"
  );

  if (!testsRun.some((testRun) => testRun.status === "passed")) {
    findings.push({
      severity: "high",
      category: "regression",
      title: "Passing regression evidence is missing",
      description: `${payload.reviewerRole} could not find a passing test command in the implementation evidence.`,
      evidence: `Tests run: ${testsRun.map((testRun) => `${testRun.command}:${testRun.status}`).join(", ") || "none recorded"}.`,
      filePath: changedFiles[0] ?? null,
      line: null,
      remediationClass: "test_gap"
    });
  }

  if (hasReviewRequiredVerification) {
    findings.push({
      severity: "high",
      category: "correctness",
      title: "Verification signals are not fully clean",
      description: `${payload.reviewerRole} sees at least one verification step that did not pass cleanly.`,
      evidence: externalSignals
        .filter((signal) => signal.findingType === "verification")
        .map((signal) => signal.title)
        .join("; ") || "A verification step reported follow-up work.",
      filePath: null,
      line: null,
      remediationClass: "manual_follow_up"
    });
  }

  if (payload.reviewerRole === "implementation_reviewer" && latestStoryReviewFindings.length > 0) {
    findings.push(
      ...latestStoryReviewFindings.map((finding) => ({
        severity: finding.severity === "critical" || finding.severity === "high" ? "medium" : finding.severity,
        category: finding.category === "security" ? "security" : "maintainability",
        title: `Carry forward story-review concern: ${finding.title}`,
        description: finding.description,
        evidence: finding.evidence,
        filePath: finding.filePath ?? null,
        line: finding.line ?? null,
        remediationClass: "safe_code_fix"
      }))
    );
  }

  const overallStatus = findings.some((finding) => finding.severity === "critical")
    ? "failed"
    : findings.some((finding) => finding.severity === "high")
      ? "review_required"
      : "passed";

  return {
    output: {
      overallStatus,
      summary:
        overallStatus === "passed"
          ? `${payload.reviewerRole} found the implementation ready.`
          : `${payload.reviewerRole} found ${findings.length} follow-up issue(s).`,
      findings,
      assumptions: ["The local stub only reviews persisted execution evidence, not live repository diffs."],
      recommendations:
        findings.length > 0
          ? ["Address the structured findings and rerun implementation review after remediation."]
          : ["No additional implementation-review follow-up is required in the local stub."]
    }
  };
}

let result;
if (payload.interactionType === "brainstorm_chat") {
  result = brainstormChat(payload);
} else if (payload.interactionType === "planning_review") {
  result = planningReview(payload);
} else if (payload.interactionType === "implementation_review") {
  result = implementationReview(payload);
} else if (payload.interactionType === "story_review_chat") {
  result = storyReviewChat(payload);
} else if (payload.interactionType === "workspace_setup_assist") {
  result = workspaceSetupAssist(payload);
} else if (payload.stageKey === "brainstorm") {
  result = brainstorming(payload.item);
} else if (payload.stageKey === "requirements") {
  result = requirements(payload.project, payload.context);
} else if (payload.stageKey === "architecture") {
  result = architecture(payload.project, payload.context);
} else if (payload.stageKey === "planning") {
  result = planning(payload.project, payload.context);
} else if (payload.workerRole === "test-writer") {
  result = testPreparation(payload);
} else if (payload.workerRole === "ralph-verifier") {
  result = ralphVerification(payload);
} else if (payload.workerRole === "app-verifier") {
  result = appVerification(payload);
} else if (payload.workerRole === "story-reviewer") {
  result = storyReview(payload);
} else if (payload.workerRole === "qa-verifier") {
  result = qaVerification(payload);
} else if (payload.workerRole === "documentation-writer") {
  result = documentationWriter(payload);
} else if (payload.workerRole) {
  result = storyExecution(payload);
} else {
  console.error(`Unsupported payload`);
  process.exit(1);
}

process.stdout.write(JSON.stringify(result));
