import "server-only";

import Database from "better-sqlite3";
import { resolve } from "node:path";
import { homedir } from "node:os";
import type {
  BoardViewModel,
  ItemMode,
  ItemOverlayViewModel,
  ShellViewModel,
  WorkspaceSummary
} from "@/lib/view-models";
import { shellViewModel as legacyShellViewModel } from "@/lib/mock-legacy-data";

type WorkspaceRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
};

type ItemRow = {
  id: string;
  workspace_id: string;
  code: string;
  title: string;
  description: string;
  current_column: "idea" | "brainstorm" | "requirements" | "implementation" | "done";
  phase_status: "draft" | "running" | "review_required" | "completed" | "failed";
};

type ProjectCountRow = {
  item_id: string;
  count: number;
};

type WorkspaceItemCountRow = {
  workspace_id: string;
  count: number;
};

type LiveBoardReadyState = {
  kind: "ready";
  shell: ShellViewModel;
  board: BoardViewModel;
  overlay: ItemOverlayViewModel;
};

type LiveBoardEmptyState = {
  kind: "empty";
  shell: ShellViewModel;
  title: string;
  detail: string;
};

type LiveBoardFailureState = {
  kind: "failure";
  shell: ShellViewModel;
  title: string;
  detail: string;
};

export type LiveBoardState = LiveBoardReadyState | LiveBoardEmptyState | LiveBoardFailureState;

const boardColumnTitles = {
  idea: "Idea",
  brainstorm: "Brainstorm",
  requirements: "Requirements",
  implementation: "Implementation",
  done: "Done"
} as const;

const orderedBoardColumns = ["idea", "brainstorm", "requirements", "implementation", "done"] as const;

function resolveDbPath(): string {
  return process.env.BEERENGINEER_UI_DB_PATH ?? resolve(homedir(), ".local", "share", "beerengineer", "beerengineer.sqlite");
}

function resolveWorkspaceSummaries(workspaces: WorkspaceRow[]): WorkspaceSummary[] {
  return workspaces.map((workspace) => ({
    key: workspace.key,
    name: workspace.name,
    descriptor: workspace.description ?? "BeerEngineer workspace"
  }));
}

function buildFallbackShell(workspaces: WorkspaceSummary[], activeWorkspace: WorkspaceSummary): ShellViewModel {
  return {
    ...legacyShellViewModel,
    title: "Workspace board",
    subtitle: `${activeWorkspace.name} · live BeerEngineer board view.`,
    activeWorkspace,
    availableWorkspaces: workspaces,
    globalSignals: [
      { label: "source", value: "live sqlite", tone: "petrol" },
      { label: "mode", value: "workspace board" }
    ],
    actions: [
      { label: "Open runs", href: "/runs", primary: true },
      { label: "Inspect artifacts", href: "/artifacts" }
    ]
  };
}

function mapItemMode(item: ItemRow): ItemMode {
  if (item.phase_status === "completed" || item.current_column === "done") {
    return "auto";
  }
  if (item.phase_status === "running" || item.phase_status === "review_required") {
    return "assisted";
  }
  return "manual";
}

function mapAttention(item: ItemRow): "waiting" | "review" | "failed" | "done" | "idle" {
  switch (item.phase_status) {
    case "running":
      return "waiting";
    case "review_required":
      return "review";
    case "failed":
      return "failed";
    case "completed":
      return "done";
    default:
      return "idle";
  }
}

function buildBoardViewModel(items: ItemRow[], projectCounts: Map<string, number>): BoardViewModel {
  return {
    heading: "Workspace board",
    description: "Live BeerEngineer items grouped by their persisted workflow column for the active workspace.",
    filters: [
      { label: "live data", tone: "petrol" },
      { label: "workspace scoped" },
      { label: "real item state", tone: "success" }
    ],
    columns: orderedBoardColumns.map((column) => ({
      key: column,
      title: boardColumnTitles[column],
      cards: items
        .filter((item) => item.current_column === column)
        .map((item) => ({
          itemCode: item.code,
          title: item.title,
          summary: item.description,
          mode: mapItemMode(item),
          attention: mapAttention(item),
          selected: item.id === items[0]?.id,
          meta: [
            { label: "phase", value: item.phase_status },
            { label: "projects", value: String(projectCounts.get(item.id) ?? 0) }
          ]
        }))
    }))
  };
}

function buildOverlayViewModel(item: ItemRow, projectCount: number): ItemOverlayViewModel {
  return {
    itemCode: item.code,
    title: item.title,
    summary: item.description,
    mode: mapItemMode(item),
    attention: mapAttention(item),
    progress: [
      {
        stage: "idea",
        status: item.current_column === "idea" ? "active" : "completed",
        note: "Item is persisted in the workspace board."
      },
      {
        stage: "implementation",
        status: item.current_column === "implementation" ? "active" : item.current_column === "done" ? "completed" : "pending",
        note: "Board placement comes from the persisted workflow column."
      },
      {
        stage: "status",
        status: item.phase_status,
        note: `Current phase status is ${item.phase_status}.`
      }
    ],
    actions: [
      { label: "Open runs", detail: "Inspect latest execution activity for this workspace.", primary: true },
      { label: "View artifacts", detail: "Review generated plan, QA, and documentation artifacts." }
    ],
    chatPreview: [
      {
        role: "system",
        author: "system",
        message: "Board overlay currently follows the first visible live item in the active workspace."
      },
      {
        role: "assistant",
        author: "board",
        message: projectCount > 0 ? `Linked projects: ${projectCount}` : "No linked projects are persisted yet for this item."
      },
      {
        role: "user",
        author: "operator",
        message: "Follow-on work should make overlay selection explicit instead of defaulting to the first card."
      }
    ]
  };
}

export function getLiveBoardState(workspaceKey?: string | null): LiveBoardState {
  const dbPath = resolveDbPath();
  let connection: Database.Database | null = null;

  try {
    connection = new Database(dbPath, { readonly: true, fileMustExist: true });

    const workspaces = connection
      .prepare("select id, key, name, description from workspaces order by created_at asc, id asc")
      .all() as WorkspaceRow[];

    if (workspaces.length === 0) {
      const fallbackWorkspace = {
        key: "default",
        name: "Default Workspace",
        descriptor: "No workspace records found"
      };
      return {
        kind: "failure",
        shell: buildFallbackShell([fallbackWorkspace], fallbackWorkspace),
        title: "Live data unavailable",
        detail: "BeerEngineer has no persisted workspaces yet."
      };
    }

    const workspaceItemCounts = new Map<string, number>(
      (
        connection
          .prepare(
            `select workspace_id, count(*) as count
             from items
             group by workspace_id`
          )
          .all() as WorkspaceItemCountRow[]
      ).map((row) => [row.workspace_id, row.count])
    );
    const workspaceSummaries = resolveWorkspaceSummaries(workspaces);
    const activeWorkspaceRecord = workspaceKey
      ? workspaces.find((workspace) => workspace.key === workspaceKey) ?? null
      : workspaces.find((workspace) => (workspaceItemCounts.get(workspace.id) ?? 0) > 0) ?? workspaces[0]!;

    if (!activeWorkspaceRecord) {
      const fallbackWorkspace = workspaceSummaries[0]!;
      return {
        kind: "failure",
        shell: buildFallbackShell(workspaceSummaries, fallbackWorkspace),
        title: "Live data unavailable",
        detail: `Workspace "${workspaceKey}" was not found.`
      };
    }

    if (process.env.BEERENGINEER_UI_FAIL_WORKSPACE_KEY === activeWorkspaceRecord.key) {
      throw new Error(`Workspace ${activeWorkspaceRecord.key} is configured to simulate a live-data outage.`);
    }

    const activeWorkspace =
      workspaceSummaries.find((workspace) => workspace.key === activeWorkspaceRecord.key) ?? workspaceSummaries[0]!;

    const items = connection
      .prepare(
        `select id, workspace_id, code, title, description, current_column, phase_status
         from items
         where workspace_id = ?
         order by created_at asc, id asc`
      )
      .all(activeWorkspaceRecord.id) as ItemRow[];

    const projectCounts = new Map<string, number>(
      (
        connection
          .prepare(
            `select item_id, count(*) as count
             from projects
             where item_id in (select id from items where workspace_id = ?)
             group by item_id`
          )
          .all(activeWorkspaceRecord.id) as ProjectCountRow[]
      ).map((row) => [row.item_id, row.count])
    );

    const shell = {
      ...buildFallbackShell(workspaceSummaries, activeWorkspace),
      subtitle: `${activeWorkspace.name} · real BeerEngineer board data for the active workspace.`,
      globalSignals: [
        { label: "items", value: String(items.length), tone: "petrol" },
        { label: "projects", value: String(Array.from(projectCounts.values()).reduce((sum, value) => sum + value, 0)) },
        {
          label: "review needed",
          value: String(items.filter((item) => item.phase_status === "review_required").length),
          tone: "gold"
        }
      ]
    } satisfies ShellViewModel;

    if (items.length === 0) {
      return {
        kind: "empty",
        shell,
        title: "No items",
        detail: "This workspace has no board items yet."
      };
    }

    const board = buildBoardViewModel(items, projectCounts);
    const leadItem = items[0]!;

    return {
      kind: "ready",
      shell,
      board,
      overlay: buildOverlayViewModel(leadItem, projectCounts.get(leadItem.id) ?? 0)
    };
  } catch (error) {
    const fallbackWorkspace = {
      key: workspaceKey ?? "default",
      name: workspaceKey ?? "Default Workspace",
      descriptor: "Live board unavailable"
    };
    return {
      kind: "failure",
      shell: buildFallbackShell([fallbackWorkspace], fallbackWorkspace),
      title: "Live data unavailable",
      detail: error instanceof Error ? error.message : String(error)
    };
  } finally {
    connection?.close();
  }
}
