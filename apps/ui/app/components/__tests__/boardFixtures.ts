import type { WorkspaceItem } from "../../lib/types";

function mk(id: string, attentionDot: boolean): WorkspaceItem {
  return {
    id,
    itemCode: id.toUpperCase(),
    title: `Item ${id}`,
    summary: `summary for ${id}`,
    attentionDot,
    phaseStatus: "in_progress",
  };
}

// FX-01: 5 items; items[0], items[2], items[4] attention=true. Count = 3.
export const fx01_itemsWithMixedAttention: WorkspaceItem[] = [
  mk("item-0", true),
  mk("item-1", false),
  mk("item-2", true),
  mk("item-3", false),
  mk("item-4", true),
];

// FX-01b: same 5 ids, only items[0] has attention=true. Count = 1.
export const fx01b_itemsOneAttention: WorkspaceItem[] = [
  mk("item-0", true),
  mk("item-1", false),
  mk("item-2", false),
  mk("item-3", false),
  mk("item-4", false),
];

// FX-02: 5 items, all attention=false. Count = 0.
export const fx02_itemsNoAttention: WorkspaceItem[] = [
  mk("item-0", false),
  mk("item-1", false),
  mk("item-2", false),
  mk("item-3", false),
  mk("item-4", false),
];

// FX-03: workspace key='test-ws' with one item id='item-42', attention=false.
export const fx03_workspaceKey = "test-ws";
export const fx03_singleItemWorkspace: WorkspaceItem[] = [mk("item-42", false)];

// FX-04: 3 items; items[0] attention=false, items[1] attention=true, items[2] attention=true.
export const fx04_firstNonAttentionThenTwo: WorkspaceItem[] = [
  mk("item-0", false),
  mk("item-1", true),
  mk("item-2", true),
];
