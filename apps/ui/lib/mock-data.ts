import type { BoardViewModel, ItemOverlayViewModel, ShellViewModel, WorkspaceSummary } from "@/lib/view-models";
import { shellViewModel as legacyShellViewModel } from "@/lib/mock-legacy-data";

type WorkspaceBoardSeed = {
  workspace: WorkspaceSummary;
  shellTitle: string;
  shellSubtitle: string;
  board: BoardViewModel;
  overlay: ItemOverlayViewModel;
};

const workspaceBoardSeeds: Record<string, WorkspaceBoardSeed> = {
  alpha: {
    workspace: {
      key: "alpha",
      name: "Alpha Workspace",
      descriptor: "Primary delivery scope"
    },
    shellTitle: "Workspace board",
    shellSubtitle: "Alpha Workspace · workspace-scoped item board for the current operational slice.",
    board: {
      heading: "Alpha Workspace",
      description: "Real domain columns for the active workspace.",
      filters: [
        { label: "all items" },
        { label: "review focus", tone: "petrol" },
        { label: "attention only", tone: "gold" }
      ],
      columns: [
        {
          key: "idea",
          title: "Idea",
          cards: [
            {
              itemCode: "ITEM-0100",
              title: "Board shell concept",
              summary: "Initial UI shell concept ready for structured brainstorming.",
              mode: "manual",
              attention: "idle",
              meta: [
                { label: "project", value: "P01" },
                { label: "scope", value: "ui" }
              ]
            }
          ]
        },
        {
          key: "brainstorm",
          title: "Brainstorm",
          cards: [
            {
              itemCode: "ITEM-0101",
              title: "Board interaction patterns",
              summary: "Exploring top-bar switching and overlay-driven item detail.",
              mode: "assisted",
              attention: "waiting",
              meta: [
                { label: "notes", value: "4" },
                { label: "owner", value: "product" }
              ]
            }
          ]
        },
        {
          key: "requirements",
          title: "Requirements",
          cards: [
            {
              itemCode: "ITEM-0102",
              title: "Board workspace acceptance pack",
              summary: "Acceptance criteria drafted for workspace switching and board grouping.",
              mode: "assisted",
              attention: "review",
              meta: [
                { label: "stories", value: "3" },
                { label: "review", value: "pending" }
              ]
            }
          ]
        },
        {
          key: "implementation",
          title: "Implementation",
          cards: [
            {
              itemCode: "ITEM-0103",
              title: "Board workspace query service",
              summary: "Thin UI-facing read model over workflowService.getBoardView().",
              mode: "auto",
              attention: "failed",
              selected: true,
              meta: [
                { label: "run", value: "failed" },
                { label: "retry", value: "available" }
              ]
            }
          ]
        },
        {
          key: "done",
          title: "Done",
          cards: [
            {
              itemCode: "ITEM-0104",
              title: "Board shell baseline tokens",
              summary: "Shared shell styling and primitives shipped for the first UI slice.",
              mode: "auto",
              attention: "done",
              meta: [
                { label: "qa", value: "passed" },
                { label: "docs", value: "done" }
              ]
            }
          ]
        }
      ]
    },
    overlay: {
      itemCode: "ITEM-0103",
      title: "Board workspace query service",
      summary: "Workspace-aware read model contract for the main board and top-level shell context.",
      mode: "auto",
      attention: "failed",
      progress: [
        { stage: "brainstorm", status: "completed", note: "Workspace-first board scope confirmed." },
        { stage: "requirements", status: "completed", note: "Acceptance criteria mapped to an e2e board flow." },
        { stage: "implementation", status: "failed", note: "Workspace-aware board data is not wired into the UI shell yet." }
      ],
      actions: [
        { label: "Retry implementation", detail: "Re-run the bounded worker with the missing read model.", primary: true },
        { label: "Inspect failure", detail: "Open the last execution output for the failed board slice." },
        { label: "View story", detail: "Inspect the active story and acceptance criteria." }
      ],
      chatPreview: [
        { role: "system", author: "system", message: "Execution run for ITEM-0103 is waiting on a UI-side read model." },
        { role: "assistant", author: "worker", message: "Board columns and workspace switching still use static mock data." },
        { role: "user", author: "operator", message: "Wire the board to a deterministic workspace dataset first." }
      ]
    }
  },
  beta: {
    workspace: {
      key: "beta",
      name: "Beta Workspace",
      descriptor: "Secondary validation scope"
    },
    shellTitle: "Workspace board",
    shellSubtitle: "Beta Workspace · workspace-scoped item board for the current operational slice.",
    board: {
      heading: "Beta Workspace",
      description: "A second seeded workspace proves that switching updates the whole board scope.",
      filters: [
        { label: "all items" },
        { label: "delivery focus", tone: "petrol" },
        { label: "healthy runs", tone: "success" }
      ],
      columns: [
        {
          key: "idea",
          title: "Idea",
          cards: [
            {
              itemCode: "ITEM-0200",
              title: "Beta board seed",
              summary: "Secondary workspace item used to validate global workspace switching.",
              mode: "manual",
              attention: "idle",
              meta: [
                { label: "project", value: "P02" },
                { label: "scope", value: "validation" }
              ]
            }
          ]
        },
        {
          key: "brainstorm",
          title: "Brainstorm",
          cards: [
            {
              itemCode: "ITEM-0201",
              title: "Beta interaction review",
              summary: "Switching and visibility checks are ready for walkthrough.",
              mode: "assisted",
              attention: "waiting",
              meta: [
                { label: "notes", value: "2" },
                { label: "owner", value: "qa" }
              ]
            }
          ]
        },
        {
          key: "requirements",
          title: "Requirements",
          cards: [
            {
              itemCode: "ITEM-0202",
              title: "Beta acceptance snapshot",
              summary: "Workspace-specific acceptance set drafted for validation.",
              mode: "assisted",
              attention: "review",
              meta: [
                { label: "stories", value: "1" },
                { label: "review", value: "active" }
              ]
            }
          ]
        },
        {
          key: "implementation",
          title: "Implementation",
          cards: [
            {
              itemCode: "ITEM-0203",
              title: "Beta board projection",
              summary: "Projection layer is running cleanly in the validation workspace.",
              mode: "auto",
              attention: "done",
              selected: true,
              meta: [
                { label: "run", value: "passed" },
                { label: "retry", value: "none" }
              ]
            }
          ]
        },
        {
          key: "done",
          title: "Done",
          cards: [
            {
              itemCode: "ITEM-0204",
              title: "Beta setup validation",
              summary: "Secondary workspace shell bootstrapping already completed.",
              mode: "auto",
              attention: "done",
              meta: [
                { label: "qa", value: "passed" },
                { label: "docs", value: "captured" }
              ]
            }
          ]
        }
      ]
    },
    overlay: {
      itemCode: "ITEM-0203",
      title: "Beta board projection",
      summary: "Reference projection for the validation workspace after the scope switch.",
      mode: "auto",
      attention: "done",
      progress: [
        { stage: "brainstorm", status: "completed", note: "Switching behavior aligned." },
        { stage: "requirements", status: "completed", note: "Validation criteria are stable." },
        { stage: "implementation", status: "completed", note: "Workspace board projection is healthy." }
      ],
      actions: [
        { label: "Open artifacts", detail: "Inspect the validation workspace artifacts.", primary: true },
        { label: "Review board", detail: "Check board placement and card metadata." }
      ],
      chatPreview: [
        { role: "system", author: "system", message: "Beta workspace validation is complete." },
        { role: "assistant", author: "worker", message: "Board projection updated correctly after the workspace switch." },
        { role: "user", author: "operator", message: "Use this workspace to confirm global scope switching." }
      ]
    }
  }
};

export const workspaceBoardOrder = Object.values(workspaceBoardSeeds).map((seed) => seed.workspace);
export const defaultWorkspaceKey = workspaceBoardOrder[0]?.key ?? "alpha";

export function getWorkspaceBoardState(workspaceKey: string) {
  const seed = workspaceBoardSeeds[workspaceKey];
  if (!seed) {
    throw new Error(`Unknown workspace key "${workspaceKey}" in workspace board seeds.`);
  }

  return {
    shell: {
      ...legacyShellViewModel,
      title: seed.shellTitle,
      subtitle: seed.shellSubtitle,
      activeWorkspace: seed.workspace,
      availableWorkspaces: workspaceBoardOrder
    } satisfies ShellViewModel,
    board: seed.board,
    overlay: seed.overlay
  };
}
