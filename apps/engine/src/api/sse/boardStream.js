import { writeSse } from "../http.js";
import { messagingLevelFromQuery } from "../../core/messagingLevel.js";
import { projectStageLogRow } from "../../core/messagingProjection.js";
import { tailStageLogs } from "./tailStageLogs.js";
/**
 * Workspace-scoped SSE stream. Tails `stage_logs` for a small set of
 * lifecycle events and fans them out to connected UI tabs. `item_column_
 * changed` is pushed in directly by the item-actions service — it doesn't
 * write to `stage_logs`.
 *
 * The poller is started once when this factory is called; the returned
 * `dispose()` tears it down along with all live clients.
 */
export function createBoardStream(repos, db) {
    const clients = new Set();
    const resolveEventWorkspace = (data) => {
        const payload = data;
        if (payload?.itemId)
            return repos.getItem(payload.itemId)?.workspace_id ?? null;
        if (payload?.runId)
            return repos.getRun(payload.runId)?.workspace_id ?? null;
        return null;
    };
    const broadcast = (event, data, level) => {
        const workspaceId = resolveEventWorkspace(data);
        for (const client of clients) {
            if (client.workspaceId && workspaceId && client.workspaceId !== workspaceId)
                continue;
            if (level !== undefined && level < client.level)
                continue;
            try {
                writeSse(client.res, event, data);
            }
            catch {
                clients.delete(client);
            }
        }
    };
    const tail = tailStageLogs(repos, { scope: { kind: "workspace", workspaceId: null } }, row => {
        const entry = projectStageLogRow(row);
        if (!entry)
            return;
        broadcast(entry.type, { ...entry, itemId: row.item_id }, entry.level);
    });
    return {
        handle(req, res) {
            const url = new URL(req.url ?? "/events", "http://127.0.0.1");
            const workspaceKey = url.searchParams.get("workspace");
            const workspaceId = workspaceKey
                ? db.prepare("SELECT id FROM workspaces WHERE key = ?").get(workspaceKey)?.id
                    ?? "__missing__"
                : null;
            const level = messagingLevelFromQuery(url.searchParams.get("level"), 2);
            res.writeHead(200, {
                "content-type": "text/event-stream",
                "cache-control": "no-cache",
                connection: "keep-alive",
            });
            res.write(`event: hello\ndata: ${JSON.stringify({ at: Date.now(), workspace: workspaceKey })}\n\n`);
            const client = { res, id: Math.random().toString(36).slice(2), workspaceId, level };
            clients.add(client);
            const keepAlive = setInterval(() => {
                try {
                    res.write(":keepalive\n\n");
                }
                catch {
                    clearInterval(keepAlive);
                    clients.delete(client);
                }
            }, 25_000);
            keepAlive.unref?.();
            res.on("close", () => {
                clearInterval(keepAlive);
                clients.delete(client);
            });
        },
        broadcastItemColumnChanged(event) {
            broadcast("item_column_changed", event);
        },
        dispose() {
            tail.stop();
            clients.clear();
        },
    };
}
