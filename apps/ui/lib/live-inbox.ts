import "server-only";

import Database from "better-sqlite3";
import { resolve } from "node:path";
import { homedir } from "node:os";
import type {
  InboxRowViewModel,
  InboxViewModel,
  ShellViewModel,
  WorkspaceSummary
} from "@/lib/view-models";

type WorkspaceRow = {
  id: string;
  key: string;
  name: string;
};

type ItemCodeRow = { id: string; code: string; title: string };
type RunRow = {
  id: string;
  workspace_id: string;
  item_id: string;
  title: string | null;
  status: string;
  recovery_status: "blocked" | "failed" | null;
  current_stage: string | null;
  updated_at: number;
};
type PromptRow = {
  id: string;
  run_id: string;
  prompt: string;
  created_at: number;
  item_id: string;
  item_code: string;
  item_title: string;
};
type ItemRow = {
  id: string;
  code: string;
  title: string;
  current_column: string;
  phase_status: string;
};

function resolveDbPath(): string {
  return process.env.BEERENGINEER_UI_DB_PATH ?? resolve(homedir(), ".local", "share", "beerengineer", "beerengineer.sqlite");
}

function buildItemHref(itemCode: string, workspaceKey?: string | null): string {
  const params = new URLSearchParams();
  if (workspaceKey) params.set("workspace", workspaceKey);
  params.set("item", itemCode);
  return `/?${params.toString()}`;
}

function isGenericPrompt(prompt: string | null | undefined): boolean {
  if (!prompt) return true;
  return /^\s*you\s*>\s*$/i.test(prompt);
}

export type LiveInboxState =
  | { kind: "ready"; inbox: InboxViewModel; workspaces: WorkspaceSummary[]; activeWorkspace: WorkspaceSummary }
  | { kind: "fallback"; reason: string };

export function getLiveInboxState(workspaceKey?: string | null): LiveInboxState {
  const dbPath = resolveDbPath();
  let connection: Database.Database | null = null;
  try {
    connection = new Database(dbPath, { readonly: true, fileMustExist: true });

    const workspaces = connection
      .prepare("select id, key, name from workspaces order by created_at asc, id asc")
      .all() as WorkspaceRow[];
    if (workspaces.length === 0) return { kind: "fallback", reason: "no workspaces" };

    const activeWorkspace =
      (workspaceKey && workspaces.find((w) => w.key === workspaceKey)) || workspaces[0]!;

    const items = connection
      .prepare(
        `select id, code, title, current_column, phase_status
           from items where workspace_id = ?`
      )
      .all(activeWorkspace.id) as ItemRow[];
    const itemById = new Map(items.map((i) => [i.id, i]));

    const runs = connection
      .prepare(
        `select id, workspace_id, item_id, title, status,
                ${tableHasColumn(connection, "runs", "recovery_status") ? "recovery_status" : "null as recovery_status"} as recovery_status,
                current_stage, updated_at
           from runs where workspace_id = ?`
      )
      .all(activeWorkspace.id) as RunRow[];

    const prompts = connection
      .prepare(
        `select pp.id, pp.run_id, pp.prompt, pp.created_at,
                r.item_id, i.code as item_code, i.title as item_title
           from pending_prompts pp
           join runs r on r.id = pp.run_id
           join items i on i.id = r.item_id
          where r.workspace_id = ? and pp.answer is null
          order by pp.created_at asc`
      )
      .all(activeWorkspace.id) as PromptRow[];

    const latestQuestionByRun = new Map<string, string>();
    const chatRows = connection
      .prepare(
        `select run_id, message
           from stage_logs
          where run_id in (select id from runs where workspace_id = ?)
            and event_type = 'chat_message'
          order by created_at desc, rowid desc`
      )
      .all(activeWorkspace.id) as Array<{ run_id: string; message: string }>;
    for (const row of chatRows) {
      if (!latestQuestionByRun.has(row.run_id) && row.message.trim().length > 0) {
        latestQuestionByRun.set(row.run_id, row.message);
      }
    }

    const rows: InboxRowViewModel[] = [];

    for (const prompt of prompts) {
      const promptText =
        isGenericPrompt(prompt.prompt)
          ? latestQuestionByRun.get(prompt.run_id) ?? prompt.prompt
          : prompt.prompt;
      rows.push({
        kind: "prompt_waiting",
        title: `${prompt.item_code} · ${prompt.item_title}`,
        priority: "P1",
        status: "awaiting answer",
        primaryAction: "Open run",
        detail: promptText.slice(0, 140),
        href: `/runs/${prompt.run_id}`,
        prompt: { runId: prompt.run_id, promptId: prompt.id, prompt: promptText }
      });
    }
    for (const run of runs) {
      if (run.recovery_status === "blocked") {
        const item = itemById.get(run.item_id);
        rows.push({
          kind: "blocked_run",
          title: `${item?.code ?? "—"} · ${run.title ?? item?.title ?? "Run"}`,
          priority: "P1",
          status: "blocked",
          primaryAction: "Open run",
          detail: `Run is blocked at stage ${run.current_stage ?? "—"}.`,
          href: `/runs/${run.id}`
        });
      } else if (run.recovery_status === "failed") {
        const item = itemById.get(run.item_id);
        rows.push({
          kind: "failed_run",
          title: `${item?.code ?? "—"} · ${run.title ?? item?.title ?? "Run"}`,
          priority: "P1",
          status: "failed",
          primaryAction: "Open run",
          detail: `Run failed at stage ${run.current_stage ?? "—"}.`,
          href: `/runs/${run.id}`
        });
      }
    }
    for (const item of items) {
      if (item.phase_status === "review_required") {
        rows.push({
          kind: "review_required",
          title: `${item.code} · ${item.title}`,
          priority: "P2",
          status: "review",
          primaryAction: "Open item",
          detail: "Review required before promotion.",
          href: buildItemHref(item.code, activeWorkspace.key)
        });
      }
      if (item.current_column === "implementation" && item.phase_status === "completed") {
        rows.push({
          kind: "ready_to_test",
          title: `${item.code} · ${item.title}`,
          priority: "P2",
          status: "ready to test",
          primaryAction: "Open preview",
          detail: "Implementation completed. Run the preview to validate.",
          href: buildItemHref(item.code, activeWorkspace.key)
        });
      }
    }

    return {
      kind: "ready",
      inbox: {
        heading: "Operational inbox",
        description: "Prompts, blocked runs, reviews, merge candidates, and ready-to-test items for this workspace.",
        filters: ["all", "prompts", "blocked", "review", "ready"],
        rows
      },
      workspaces: workspaces.map((w) => ({ key: w.key, name: w.name, descriptor: "BeerEngineer workspace" })),
      activeWorkspace: { key: activeWorkspace.key, name: activeWorkspace.name, descriptor: "BeerEngineer workspace" }
    };
  } catch (error) {
    return { kind: "fallback", reason: error instanceof Error ? error.message : "unknown" };
  } finally {
    connection?.close();
  }
}

const cache = new Map<string, boolean>();
function tableHasColumn(db: Database.Database, table: string, column: string): boolean {
  const k = `${table}.${column}`;
  if (cache.has(k)) return cache.get(k)!;
  try {
    const rows = db.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>;
    const exists = rows.some((r) => r.name === column);
    cache.set(k, exists);
    return exists;
  } catch {
    cache.set(k, false);
    return false;
  }
}

export function buildInboxShell(active: WorkspaceSummary, workspaces: WorkspaceSummary[], counts: { prompts: number; blocked: number; review: number }): ShellViewModel {
  return {
    title: "Inbox",
    subtitle: `${active.name} · operator queue.`,
    activeWorkspace: active,
    availableWorkspaces: workspaces,
    navItems: [
      { href: "/", label: "Board" },
      { href: "/inbox", label: "Inbox" },
      { href: "/runs", label: "Runs" },
      { href: "/artifacts", label: "Artifacts" }
    ],
    globalSignals: [
      { label: "prompts", value: String(counts.prompts), tone: counts.prompts > 0 ? "gold" : "neutral", signalKey: "awaiting_answer", href: "/inbox" },
      { label: "blocked", value: String(counts.blocked), tone: counts.blocked > 0 ? "danger" : "neutral", signalKey: "blocked", href: "/inbox" },
      { label: "review", value: String(counts.review), tone: counts.review > 0 ? "gold" : "neutral", signalKey: "review_required", href: "/inbox" }
    ],
    actions: []
  };
}
