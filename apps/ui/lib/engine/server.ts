import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ItemDetailDTO } from "./types";

function engineBaseUrl(): string {
  return process.env.ENGINE_URL ?? "http://localhost:4100";
}

function tokenPath(): string {
  const envPath = process.env.BEERENGINEER_API_TOKEN_FILE;
  if (envPath) return resolve(envPath);
  const xdgState = process.env.XDG_STATE_HOME;
  const base = xdgState ? resolve(xdgState) : join(homedir(), ".local", "state");
  return join(base, "beerengineer", "api.token");
}

function readToken(): string | null {
  const direct = process.env.BEERENGINEER_API_TOKEN;
  if (direct) return direct;
  try {
    const raw = readFileSync(tokenPath(), "utf8").trim();
    return raw || null;
  } catch {
    return null;
  }
}

export async function fetchItem(itemId: string): Promise<ItemDetailDTO> {
  const url = `${engineBaseUrl()}/items/${encodeURIComponent(itemId)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`engine_get_item_failed_${res.status}`);
  const raw = (await res.json()) as Record<string, unknown>;
  return normalizeItem(itemId, raw);
}

function normalizeItem(fallbackId: string, raw: Record<string, unknown>): ItemDetailDTO {
  const itemId = pickString(raw, ["id", "itemId"]) ?? fallbackId;
  const itemCode =
    pickString(raw, ["itemCode", "item_code", "code"]) ?? itemId;
  return {
    itemId,
    itemCode,
    title: pickString(raw, ["title"]) ?? "",
    phase_status: pickString(raw, ["phase_status", "phaseStatus"]) ?? "",
    current_stage: pickString(raw, ["current_stage", "currentStage"]) ?? null,
    currentRunId: pickString(raw, ["currentRunId", "current_run_id"]) ?? null,
    allowedActions: (() => {
      if (Array.isArray(raw.allowedActions)) {
        return (raw.allowedActions as unknown[]).filter((a): a is string => typeof a === "string")
      }
      if (Array.isArray((raw as { allowed_actions?: unknown }).allowed_actions)) {
        return ((raw as { allowed_actions: unknown[] }).allowed_actions).filter((a): a is string => typeof a === "string")
      }
      return []
    })(),
  };
}

function pickString(
  raw: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

export async function postItemAction(
  itemId: string,
  action: string,
  body: Record<string, string> = {},
): Promise<{ ok: boolean; status: number; error: string | null }> {
  const url = `${engineBaseUrl()}/items/${encodeURIComponent(itemId)}/actions/${encodeURIComponent(action)}`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = readToken();
  if (token) headers["x-beerengineer-token"] = token;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (res.ok) return { ok: true, status: res.status, error: null };
  let error = `engine_${res.status}`;
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.length > 0) error = body.error;
  } catch {
    // body was not JSON; keep generic error
  }
  return { ok: false, status: res.status, error };
}
