import "server-only";

import Database from "better-sqlite3";
import { resolve } from "node:path";
import { homedir } from "node:os";
import type {
  BoardViewModel,
  BranchRowViewModel,
  GlobalSignal,
  ItemMode,
  ItemOverlayViewModel,
  ItemTreeNode,
  MergePanelViewModel,
  OpenPromptPreview,
  PreviewViewModel,
  ProgressRowViewModel,
  RunHistoryEntry,
  RunSummaryViewModel,
  ShellViewModel,
  WorkspaceSignalEntry,
  WorkspaceSummary,
  AttentionState
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

type ProjectRow = {
  id: string;
  item_id: string;
  code: string | null;
  name: string | null;
  status: string | null;
};

type ProjectCountRow = {
  item_id: string;
  count: number;
};

type WorkspaceItemCountRow = {
  workspace_id: string;
  count: number;
};

type RunRow = {
  id: string;
  workspace_id: string;
  item_id: string;
  title: string | null;
  status: string;
  current_stage: string | null;
  recovery_status: "blocked" | "failed" | null;
  created_at: number;
  updated_at: number;
};

type StageRunRow = {
  id: string;
  run_id: string;
  stage_key: string;
  status: string;
  started_at: number | null;
  completed_at: number | null;
  error_message: string | null;
};

type PendingPromptRow = {
  id: string;
  run_id: string;
  prompt: string;
  answer: string | null;
  created_at: number;
  answered_at: number | null;
};

type LiveBoardReadyState = {
  kind: "ready";
  shell: ShellViewModel;
  board: BoardViewModel;
  overlay: ItemOverlayViewModel;
  selectedItemCode: string;
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

const implementationLadder = [
  "brainstorm",
  "requirements",
  "architecture",
  "planning",
  "execution",
  "project-review",
  "qa",
  "documentation",
  "done"
] as const;

function isGenericPrompt(prompt: string | null | undefined): boolean {
  if (!prompt) return true;
  return /^\s*you\s*>\s*$/i.test(prompt);
}

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

/**
 * Map persisted item state + run state into the cockpit AttentionState.
 * Signal hierarchy follows the plan: awaiting_answer > blocked/failed >
 * review_required > merge_ready > ready_to_test > running > done > idle.
 */
function mapAttention(
  item: ItemRow,
  runStatus: string | null,
  recovery: "blocked" | "failed" | null,
  hasOpenPrompt: boolean
): AttentionState {
  if (hasOpenPrompt) return "awaiting_answer";
  if (recovery === "blocked") return "blocked";
  if (recovery === "failed" || item.phase_status === "failed") return "failed";
  if (item.phase_status === "review_required") return "review_required";
  if (item.current_column === "implementation" && item.phase_status === "completed") return "ready_to_test";
  if (item.current_column === "done" || item.phase_status === "completed") return "done";
  if (runStatus === "running" || item.phase_status === "running") return "running";
  return "idle";
}

function isRunActive(status: string | null | undefined): boolean {
  if (!status) return false;
  return status === "running" || status === "pending" || status === "started";
}

function buildItemHref(itemCode: string, workspaceKey?: string | null): string {
  const params = new URLSearchParams();
  if (workspaceKey) params.set("workspace", workspaceKey);
  params.set("item", itemCode);
  return `/?${params.toString()}`;
}

function buildBoardViewModel(
  items: ItemRow[],
  projectCounts: Map<string, number>,
  recoveryByItem: Map<string, "blocked" | "failed" | null>,
  latestRunByItem: Map<string, RunRow | undefined>,
  promptsByItem: Map<string, number>,
  selectedItemCode: string,
  workspaceKey?: string | null
): BoardViewModel {
  return {
    heading: "Workspace board",
    description: "Live BeerEngineer items grouped by their persisted workflow column for the active workspace.",
    selectedItemCode,
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
        .map((item) => {
          const recovery = recoveryByItem.get(item.id) ?? null;
          const run = latestRunByItem.get(item.id);
          const openPrompts = promptsByItem.get(item.id) ?? 0;
          const attention = mapAttention(item, run?.status ?? null, recovery, openPrompts > 0);
          const running = isRunActive(run?.status ?? null);
          return {
            itemCode: item.code,
            itemId: item.id,
            title: item.title,
            summary: item.description,
            mode: mapItemMode(item),
            attention,
            running,
            openPrompts,
            currentStage: run?.current_stage ?? null,
            selected: item.code === selectedItemCode,
            recoveryStatus: recovery ?? null,
            href: buildItemHref(item.code, workspaceKey),
            meta: [
              { label: "phase", value: item.phase_status },
              { label: "projects", value: String(projectCounts.get(item.id) ?? 0) }
            ]
          };
        })
    }))
  };
}

function buildProgressRows(item: ItemRow, latestRun: RunRow | undefined, stageRuns: StageRunRow[]): ProgressRowViewModel[] {
  const stageStatusByKey = new Map<string, StageRunRow>();
  for (const stage of stageRuns) {
    const existing = stageStatusByKey.get(stage.stage_key);
    if (!existing || (stage.completed_at ?? 0) >= (existing.completed_at ?? 0)) {
      stageStatusByKey.set(stage.stage_key, stage);
    }
  }

  return implementationLadder.map((stageKey) => {
    const stage = stageStatusByKey.get(stageKey);
    let marker: ProgressRowViewModel["marker"] = "pending";
    let status = "pending";
    let note = "";

    if (latestRun?.current_stage === stageKey && (latestRun.status === "running" || latestRun.status === "pending")) {
      marker = "current";
      status = "active";
      note = `Active in run ${latestRun.id.slice(0, 8)}.`;
    } else if (stage) {
      if (stage.status === "completed" || stage.status === "succeeded") {
        marker = "complete";
        status = "completed";
      } else if (stage.status === "failed") {
        marker = "failed";
        status = "failed";
        note = stage.error_message ?? "Stage failed.";
      } else if (stage.status === "skipped") {
        marker = "skipped";
        status = "skipped";
      } else {
        marker = "current";
        status = stage.status;
      }
    }

    if (!note) {
      if (stageKey === "brainstorm" && item.current_column === "brainstorm") {
        note = "Brainstorm column on the board.";
      } else if (stageKey === "requirements" && item.current_column === "requirements") {
        note = "Requirements collection.";
      } else if (stageKey === "documentation" || stageKey === "qa") {
        note = "Implementation sub-stage.";
      }
    }

    return {
      stage: stageKey,
      status,
      note,
      marker
    };
  });
}

/**
 * Branch rows are derived from project rows for now. Story-level branches
 * land when the engine exposes the per-story tree. Always produces at least
 * a `main` row so the overlay communicates the branch model even when the
 * item has no projects yet.
 */
function buildBranches(projects: ProjectRow[], latestRun: RunRow | undefined): BranchRowViewModel[] {
  const rows: BranchRowViewModel[] = [];
  rows.push({ scope: "main", name: "main", status: "active", detail: "default base" });
  for (const project of projects) {
    const projectCode = project.code ?? project.id.slice(0, 6);
    rows.push({
      scope: "project",
      name: `feature/${projectCode}`,
      base: "main",
      status: "active",
      detail: project.name ?? projectCode
    });
  }
  if (latestRun?.recovery_status === "blocked") {
    rows.push({
      scope: "candidate",
      name: `candidate/${latestRun.id.slice(0, 8)}`,
      base: "main",
      status: "open_candidate",
      detail: "awaiting review"
    });
  }
  return rows;
}

function buildTree(projects: ProjectRow[]): ItemTreeNode[] {
  return projects.map((project) => ({
    id: project.id,
    kind: "project",
    label: project.name ?? project.code ?? project.id.slice(0, 8),
    branch: project.code ? `feature/${project.code}` : null,
    status: project.status ?? "draft",
    children: []
  }));
}

function buildOverlayViewModel(
  item: ItemRow,
  projects: ProjectRow[],
  latestRun: RunRow | undefined,
  stageRuns: StageRunRow[],
  prompt: PendingPromptRow | null,
  promptDisplayText: string | null,
  history: RunRow[]
): ItemOverlayViewModel {
  const recovery = latestRun?.recovery_status ?? null;
  const attention = mapAttention(item, latestRun?.status ?? null, recovery, Boolean(prompt));
  const branches = buildBranches(projects, latestRun);
  const tree = buildTree(projects);
  const progress = buildProgressRows(item, latestRun, stageRuns);

  const runSummary: RunSummaryViewModel | null = latestRun
    ? {
        runId: latestRun.id,
        status: latestRun.status,
        currentStage: latestRun.current_stage,
        startedAt: latestRun.created_at,
        lastEventAt: latestRun.updated_at
      }
    : null;

  const runHistory: RunHistoryEntry[] = history.map((row) => ({
    runId: row.id,
    status: row.status,
    startedAt: row.created_at,
    endedAt: row.status === "completed" || row.status === "failed" ? row.updated_at : null
  }));

  const openPrompt: OpenPromptPreview | null =
    prompt && latestRun
      ? { runId: latestRun.id, promptId: prompt.id, prompt: promptDisplayText ?? prompt.prompt }
      : null;

  // Phase E placeholder: the merge backend lands later. We surface the
  // structure now so the overlay/run workspace can render disabled buttons.
  const merge: MergePanelViewModel = {
    candidateBranch:
      branches.find((branch) => branch.scope === "candidate")?.name ?? null,
    baseBranch: "main",
    checklistSummary: latestRun?.recovery_status === "blocked" ? "Recovery pending" : "No merge candidate",
    validationStatus: "preview only",
    backendReady: false
  };

  // Phase F placeholder: preview metadata. Only marked reachable when we
  // know the engine and UI share a host (env hint).
  const previewUrl =
    process.env.BEERENGINEER_UI_PREVIEW_URL ??
    process.env.NEXT_PUBLIC_BEERENGINEER_UI_PREVIEW_URL ??
    undefined;
  const previewReachable =
    (process.env.BEERENGINEER_UI_PREVIEW_REACHABLE === "1" ||
      process.env.NEXT_PUBLIC_BEERENGINEER_UI_PREVIEW_REACHABLE === "1") &&
    Boolean(previewUrl);
  const preview: PreviewViewModel = {
    available: item.current_column === "implementation" || item.current_column === "done",
    previewLabel: latestRun ? `run/${latestRun.id.slice(0, 8)}` : "no preview",
    previewOriginType: previewReachable ? "network-url" : "proxied-url",
    previewUrl: previewReachable ? previewUrl : undefined,
    sourceHost: "engine host",
    reachable: previewReachable,
    helperText: previewReachable
      ? "Preview is browser-reachable on this host."
      : "Preview lives on the engine host. Open from the engine machine or wait for a proxied URL."
  };

  return {
    itemCode: item.code,
    itemId: item.id,
    currentColumn: item.current_column,
    currentPhase: item.phase_status,
    title: item.title,
    summary: item.description,
    mode: mapItemMode(item),
    attention,
    progress,
    actions: [
      { label: "Open live run", detail: "Inspect the active run for this item.", primary: Boolean(latestRun), href: latestRun ? `/runs/${latestRun.id}` : undefined },
      { label: "Open artifacts", detail: "Review generated plan, QA, and documentation artifacts.", href: "/artifacts" },
      { label: "Open test preview", detail: "Open the testable build for this item.", href: latestRun ? `/runs/${latestRun.id}?tab=preview` : undefined }
    ],
    chatPreview: [
      {
        role: "system",
        author: "system",
        message: latestRun
          ? `Latest run is ${latestRun.status}${latestRun.current_stage ? ` at stage ${latestRun.current_stage}` : ""}.`
          : "No runs yet for this item."
      },
      {
        role: "assistant",
        author: "board",
        message: projects.length > 0 ? `Linked projects: ${projects.length}` : "No linked projects are persisted yet for this item."
      }
    ],
    runSummary,
    runHistory,
    openPrompt,
    branches,
    tree,
    merge,
    preview
  };
}

function safeAll<T>(connection: Database.Database, sql: string, params: unknown[] = []): T[] {
  try {
    const stmt = connection.prepare(sql);
    return params.length > 0 ? (stmt.all(...params) as T[]) : (stmt.all() as T[]);
  } catch {
    return [];
  }
}

export function getLiveBoardState(workspaceKey?: string | null, selectedItemCode?: string | null): LiveBoardState {
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

    const allProjects = safeAll<ProjectRow>(
      connection,
      `select id, item_id, code, name, status
         from projects
         where item_id in (select id from items where workspace_id = ?)`,
      [activeWorkspaceRecord.id]
    );
    const projectsByItem = new Map<string, ProjectRow[]>();
    for (const project of allProjects) {
      const list = projectsByItem.get(project.item_id) ?? [];
      list.push(project);
      projectsByItem.set(project.item_id, list);
    }

    const runRows = safeAll<RunRow>(
      connection,
      `select id, workspace_id, item_id, title, status, current_stage,
              ${columnExists(connection, "runs", "recovery_status") ? "recovery_status" : "null as recovery_status"} as recovery_status,
              created_at, updated_at
         from runs
         where workspace_id = ?
         order by updated_at desc, created_at desc`,
      [activeWorkspaceRecord.id]
    );
    const latestRunByItem = new Map<string, RunRow | undefined>();
    const historyByItem = new Map<string, RunRow[]>();
    const recoveryByItem = new Map<string, "blocked" | "failed" | null>();
    for (const run of runRows) {
      if (!latestRunByItem.has(run.item_id)) {
        latestRunByItem.set(run.item_id, run);
        recoveryByItem.set(run.item_id, run.recovery_status);
      }
      const list = historyByItem.get(run.item_id) ?? [];
      list.push(run);
      historyByItem.set(run.item_id, list);
    }

    const promptRows = safeAll<PendingPromptRow & { item_id?: string }>(
      connection,
      `select pp.id, pp.run_id, pp.prompt, pp.answer, pp.created_at, pp.answered_at, r.item_id
         from pending_prompts pp
         join runs r on r.id = pp.run_id
         where r.workspace_id = ? and pp.answer is null
         order by pp.created_at asc`,
      [activeWorkspaceRecord.id]
    );
    const promptByItem = new Map<string, PendingPromptRow>();
    const promptsByItem = new Map<string, number>();
    for (const prompt of promptRows) {
      const itemId = prompt.item_id ?? "";
      promptsByItem.set(itemId, (promptsByItem.get(itemId) ?? 0) + 1);
      if (!promptByItem.has(itemId)) promptByItem.set(itemId, prompt);
    }

    const latestQuestionByRun = new Map<string, string>();
    const chatRows = safeAll<Array<{ run_id: string; message: string; created_at: number }>[number]>(
      connection,
      `select run_id, message, created_at
         from stage_logs
         where run_id in (
           select id from runs where workspace_id = ?
         )
           and event_type = 'chat_message'
         order by created_at desc, rowid desc`,
      [activeWorkspaceRecord.id]
    );
    for (const row of chatRows) {
      if (!latestQuestionByRun.has(row.run_id) && row.message.trim().length > 0) {
        latestQuestionByRun.set(row.run_id, row.message);
      }
    }

    if (items.length === 0) {
      const shell = {
        ...buildFallbackShell(workspaceSummaries, activeWorkspace),
        subtitle: `${activeWorkspace.name} · empty workspace.`,
        globalSignals: [{ label: "items", value: "0", tone: "petrol" }]
      } satisfies ShellViewModel;
      return {
        kind: "empty",
        shell,
        title: "No items",
        detail: "This workspace has no board items yet."
      };
    }

    // Resolve which item the overlay should describe. The URL `?item=<code>`
    // wins; otherwise we fall back to the first item that has an open prompt
    // and finally the first item in the workspace.
    const selectionTargetItem =
      (selectedItemCode && items.find((item) => item.code === selectedItemCode)) ||
      items.find((item) => promptsByItem.get(item.id)) ||
      items[0]!;

    const board = buildBoardViewModel(
      items,
      projectCounts,
      recoveryByItem,
      latestRunByItem,
      promptsByItem,
      selectionTargetItem.code,
      activeWorkspaceRecord.key
    );

    const selectedItem = selectionTargetItem;
    const selectedRun = latestRunByItem.get(selectedItem.id);
    const selectedPrompt = promptByItem.get(selectedItem.id) ?? null;
    const selectedPromptDisplayText =
      selectedPrompt && isGenericPrompt(selectedPrompt.prompt)
        ? latestQuestionByRun.get(selectedPrompt.run_id) ?? selectedPrompt.prompt
        : selectedPrompt?.prompt ?? null;
    const selectedStageRuns = selectedRun
      ? safeAll<StageRunRow>(
          connection,
          `select id, run_id, stage_key, status, started_at, completed_at, error_message
             from stage_runs
             where run_id = ?
             order by started_at asc, id asc`,
          [selectedRun.id]
        )
      : [];

    const overlay = buildOverlayViewModel(
      selectedItem,
      projectsByItem.get(selectedItem.id) ?? [],
      selectedRun,
      selectedStageRuns,
      selectedPrompt,
      selectedPromptDisplayText,
      historyByItem.get(selectedItem.id) ?? []
    );

    // Workspace-scoped signals power the SignalPopover in the top bar.
    const awaitingAnswerCount = promptRows.length;
    const blockedCount = runRows.filter((row) => row.recovery_status === "blocked").length;
    const failedCount = runRows.filter((row) => row.recovery_status === "failed").length;
    const reviewRequiredCount = items.filter((item) => item.phase_status === "review_required").length;

    const signalEntries: WorkspaceSignalEntry[] = [];
    for (const prompt of promptRows) {
      signalEntries.push({
        key: "awaiting_answer",
        label: `Prompt waiting · ${prompt.run_id.slice(0, 8)}`,
        count: 1,
        href: `/runs/${prompt.run_id}`,
        tone: "gold"
      });
    }
    for (const run of runRows.filter((row) => row.recovery_status === "blocked")) {
      signalEntries.push({
        key: "blocked",
        label: `Blocked · ${run.title ?? run.id.slice(0, 8)}`,
        count: 1,
        href: `/runs/${run.id}`,
        tone: "danger"
      });
    }
    for (const item of items.filter((row) => row.phase_status === "review_required")) {
      signalEntries.push({
        key: "review_required",
        label: `Review · ${item.code}`,
        count: 1,
        href: buildItemHref(item.code, activeWorkspaceRecord.key),
        tone: "gold"
      });
    }

    const globalSignals: GlobalSignal[] = [
      { label: "items", value: String(items.length), tone: "petrol" },
      { label: "prompts", value: String(awaitingAnswerCount), tone: awaitingAnswerCount > 0 ? "gold" : "neutral", signalKey: "awaiting_answer", href: "/inbox" },
      { label: "blocked", value: String(blockedCount), tone: blockedCount > 0 ? "danger" : "neutral", signalKey: "blocked", href: "/inbox" },
      { label: "review", value: String(reviewRequiredCount), tone: reviewRequiredCount > 0 ? "gold" : "neutral", signalKey: "review_required", href: "/inbox" }
    ];
    if (failedCount > 0) {
      globalSignals.push({ label: "failed", value: String(failedCount), tone: "danger", signalKey: "blocked", href: "/inbox" });
    }

    const shell = {
      ...buildFallbackShell(workspaceSummaries, activeWorkspace),
      subtitle: `${activeWorkspace.name} · real BeerEngineer board data for the active workspace.`,
      globalSignals,
      signalEntries
    } satisfies ShellViewModel;

    return {
      kind: "ready",
      shell,
      board,
      overlay,
      selectedItemCode: selectedItem.code
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

const columnCheckCache = new Map<string, boolean>();

function columnExists(connection: Database.Database, table: string, column: string): boolean {
  const cacheKey = `${table}.${column}`;
  if (columnCheckCache.has(cacheKey)) return columnCheckCache.get(cacheKey)!;
  try {
    const rows = connection.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>;
    const exists = rows.some((row) => row.name === column);
    columnCheckCache.set(cacheKey, exists);
    return exists;
  } catch {
    columnCheckCache.set(cacheKey, false);
    return false;
  }
}
