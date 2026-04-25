import type { BoardCardDTO, BoardColumn, ItemDetailDTO } from "./types";

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
