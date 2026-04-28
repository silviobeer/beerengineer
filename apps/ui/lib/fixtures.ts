import { PHASES, type BoardCardDTO, type BoardColumn, type ImplementationStage, type Item, type ItemDetailDTO, type Phase, type Workspace } from "./types";

const LONG_LATIN =
  "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod " +
  "tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim " +
  "veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea " +
  "commodo consequat. Duis aute irure dolor in reprehenderit in voluptate " +
  "velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint " +
  "occaecat cupidatat non proident sunt in culpa qui officia deserunt.";

export const FIXTURE_MULTI_WORKSPACES: Workspace[] = [
  { key: "ws-alpha", name: "Alpha Brewery" },
  { key: "ws-beta", name: "Beta Cellar" },
  { key: "ws-gamma", name: "Gamma Taproom" },
];

export const FIXTURE_SINGLE_WORKSPACE: Workspace[] = [
  { key: "ws-solo", name: "Solo Workshop" },
];

export const FIXTURE_EMPTY_WORKSPACES: Workspace[] = [];

export function makeItem(overrides: Partial<Item> & { id: string }): Item {
  return {
    itemCode: overrides.itemCode ?? `UI-${overrides.id}`,
    title: overrides.title ?? `Item ${overrides.id}`,
    summary: overrides.summary === undefined ? "Default summary" : overrides.summary,
    phase: overrides.phase ?? "Idea",
    pipelineState: overrides.pipelineState ?? "idle",
    ...overrides,
  };
}

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
      id: "card_brainstorm",
      itemCode: "UI-BRN",
      title: "Brainstorm card title",
      summary: "Brainstorm card summary",
      column: "brainstorm",
      phase_status: "running",
      hasOpenPrompt: false,
      hasReviewGateWaiting: false,
      hasBlockedRun: false,
      current_stage: null,
    },
    {
      id: "card_done",
      itemCode: "UI-DONE",
      title: "Done card title",
      summary: "Done card summary",
      column: "done",
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

export const fullBoardFixture: Item[] = PHASES.flatMap((phase, phaseIdx) => [
  makeItem({
    id: `${phaseIdx}a`,
    itemCode: `UI-${phaseIdx}A`,
    title: `${phase} Item A`,
    phase,
    pipelineState: "idle",
    summary: `Summary for ${phase} A`,
  }),
  makeItem({
    id: `${phaseIdx}b`,
    itemCode: `UI-${phaseIdx}B`,
    title: `${phase} Item B`,
    phase,
    pipelineState: "idle",
    summary: `Summary for ${phase} B`,
  }),
]);

export const emptyBoardFixture: Item[] = [];

export const attentionTriggerFixture: Item[] = [
  makeItem({
    id: "att-open",
    itemCode: "UI-OPEN",
    title: "Open Prompt Item",
    phase: "Idea",
    pipelineState: "openPrompt",
  }),
  makeItem({
    id: "att-review",
    itemCode: "UI-REVIEW",
    title: "Review Gate Item",
    phase: "Idea",
    pipelineState: "review-gate-waiting",
  }),
  makeItem({
    id: "att-blocked",
    itemCode: "UI-BLOCKED",
    title: "Blocked Run Item",
    phase: "Idea",
    pipelineState: "run-blocked",
  }),
];

export const noSummaryFixture: Item[] = PHASES.map((phase, idx) =>
  makeItem({
    id: `nosum-${idx}`,
    itemCode: `UI-NS${idx}`,
    title: `No summary ${phase}`,
    phase,
    summary: null,
  })
);

export const implementationItemFixture: Item = makeItem({
  id: "impl-1",
  itemCode: "UI-IMPL",
  title: "Implementation Item",
  phase: "Implementation",
  pipelineState: "idle",
});

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
        actions: [
          { label: "Approve", value: "approve" },
          { label: "Revise", value: "revise:" },
        ],
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
