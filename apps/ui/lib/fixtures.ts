import type { Item, Phase, Workspace } from "./types";
import { PHASES } from "./types";

export const FIXTURE_MULTI_WORKSPACES: Workspace[] = [
  { key: "ws-alpha", name: "Alpha Brewery" },
  { key: "ws-beta", name: "Beta Cellar" },
  { key: "ws-gamma", name: "Gamma Taproom" },
];

export const FIXTURE_SINGLE_WORKSPACE: Workspace[] = [
  { key: "ws-solo", name: "Solo Workshop" },
];

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

export const fullBoardFixture: Item[] = PHASES.flatMap((phase, phaseIdx) => [
  makeItem({
    id: `${phaseIdx}a`,
    itemCode: `UI-${phaseIdx}A`,
    title: `${phase} Item A`,
    phase: phase as Phase,
    pipelineState: "idle",
    summary: `Summary for ${phase} A`,
  }),
  makeItem({
    id: `${phaseIdx}b`,
    itemCode: `UI-${phaseIdx}B`,
    title: `${phase} Item B`,
    phase: phase as Phase,
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
    phase: phase as Phase,
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
