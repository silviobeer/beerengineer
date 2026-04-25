import type { BoardCardDTO, BoardColumn } from "./types";

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
