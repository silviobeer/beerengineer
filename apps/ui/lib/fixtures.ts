import type {
  BoardCardDTO,
  BoardColumn,
  ImplementationStage,
  ItemDetailDTO,
} from "./types";

const LONG_LATIN =
  "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod " +
  "tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim " +
  "veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea " +
  "commodo consequat. Duis aute irure dolor in reprehenderit in voluptate " +
  "velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint " +
  "occaecat cupidatat non proident sunt in culpa qui officia deserunt.";

export function fullBoardItems(): BoardCardDTO[] {
  return [
    {
      id: "card_idea",
      itemCode: "UI-IDEA",
      title: "Idea card title",
      summary: "Idea card summary",
      column: "idea",
      phase_status: "open",
      hasOpenPrompt: false,
      hasReviewGateWaiting: false,
      hasBlockedRun: false,
      current_stage: null,
    },
    {
      id: "card_frontend",
      itemCode: "UI-FE",
      title: "Frontend card title",
      summary: "Frontend card summary",
      column: "frontend",
      phase_status: "in_progress",
      hasOpenPrompt: false,
      hasReviewGateWaiting: false,
      hasBlockedRun: false,
      current_stage: null,
    },
    {
      id: "card_requirements",
      itemCode: "UI-REQ",
      title: "Requirements card title",
      summary: "Requirements card summary",
      column: "requirements",
      phase_status: "ready",
      hasOpenPrompt: false,
      hasReviewGateWaiting: false,
      hasBlockedRun: false,
      current_stage: null,
    },
    {
      id: "card_implementation",
      itemCode: "UI-IMPL",
      title: "Implementation card title",
      summary: "Implementation card summary",
      column: "implementation",
      phase_status: "running",
      hasOpenPrompt: false,
      hasReviewGateWaiting: false,
      hasBlockedRun: false,
      current_stage: "exec",
    },
    {
      id: "card_test",
      itemCode: "UI-TEST",
      title: "Test card title",
      summary: "Test card summary",
      column: "test",
      phase_status: "running",
      hasOpenPrompt: false,
      hasReviewGateWaiting: false,
      hasBlockedRun: false,
      current_stage: null,
    },
    {
      id: "card_merge",
      itemCode: "UI-MRG",
      title: "Merge card title",
      summary: "Merge card summary",
      column: "merge",
      phase_status: "done",
      hasOpenPrompt: false,
      hasReviewGateWaiting: false,
      hasBlockedRun: false,
      current_stage: null,
    },
  ];
}

export function attentionFlagCard(
  flag: "open" | "review" | "blocked" | "none"
): BoardCardDTO {
  return {
    id: `card_attn_${flag}`,
    itemCode: `UI-${flag.toUpperCase()}`,
    title: `${flag} card`,
    summary: "summary",
    column: "idea",
    phase_status: "open",
    hasOpenPrompt: flag === "open",
    hasReviewGateWaiting: flag === "review",
    hasBlockedRun: flag === "blocked",
    current_stage: null,
  };
}

export function implementationCardWithStage(
  stage: ImplementationStage | null
): BoardCardDTO {
  return {
    id: `card_impl_${stage ?? "null"}`,
    itemCode: `UI-IMPL-${stage ?? "NULL"}`,
    title: `Implementation ${stage ?? "no-stage"}`,
    summary: "summary",
    column: "implementation",
    phase_status: "running",
    hasOpenPrompt: false,
    hasReviewGateWaiting: false,
    hasBlockedRun: false,
    current_stage: stage,
  };
}

export const emptyBoardItems = (): BoardCardDTO[] => [];

export function longSummaryCard(): BoardCardDTO {
  return {
    id: "card_long_summary",
    itemCode: "UI-LONG",
    title: "Long summary",
    summary: LONG_LATIN,
    column: "idea",
    phase_status: "open",
    hasOpenPrompt: false,
    hasReviewGateWaiting: false,
    hasBlockedRun: false,
    current_stage: null,
  };
}

export function implementationCard(
  stage: string | null | undefined,
  overrides: Partial<BoardCardDTO> = {}
): BoardCardDTO {
  return {
    id: "card_impl",
    itemCode: "UI-01",
    title: "Implementation card",
    column: "implementation",
    current_stage: stage,
    ...overrides,
  };
}

export const implementationCardMissingStage = (
  variant: "null" | "undefined" = "null"
): BoardCardDTO =>
  implementationCard(variant === "null" ? null : undefined, {
    id: `card_impl_missing_${variant}`,
  });

export function itemWithActiveRunAndConversation(): ItemDetailDTO {
  return {
    id: "item-42",
    itemCode: "UI-42",
    title: "Active item",
    activeRunId: "run-42",
    conversation: [
      { id: "e1", type: "system", text: "alpha" },
      { id: "e2", type: "agent", text: "beta" },
      { id: "e3", type: "user", text: "gamma" },
      {
        id: "e4",
        type: "review-gate",
        text: "review-prompt",
        promptId: "p-7",
        actions: ["Approve", "Revise"],
      },
    ],
  };
}

export function itemWithActiveRunEmptyConversation(): ItemDetailDTO {
  return {
    id: "item-42",
    itemCode: "UI-42",
    title: "Active item",
    activeRunId: "run-42",
    conversation: [],
  };
}

export function itemWithNoActiveRun(): ItemDetailDTO {
  return {
    id: "item-42",
    itemCode: "UI-42",
    title: "Inactive item",
    activeRunId: null,
    conversation: [],
  };
}

export function itemWithDistinctRunId(): ItemDetailDTO {
  return {
    id: "item-99",
    itemCode: "UI-99",
    title: "Distinct run",
    activeRunId: "run-99",
    conversation: [{ id: "e1", type: "user", text: "fixture-message-99" }],
  };
}

export function nonImplementationCard(
  column: Exclude<BoardColumn, "implementation">,
  overrides: Partial<BoardCardDTO> = {}
): BoardCardDTO {
  return {
    id: `card_${column}`,
    itemCode: `UI-${column.toUpperCase()}`,
    title: `${column} card`,
    column,
    current_stage: "exec",
    ...overrides,
  };
}
