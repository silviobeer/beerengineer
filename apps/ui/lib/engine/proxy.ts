import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

function engineBaseUrl(): string {
  const url =
    process.env.BEERENGINEER_ENGINE_URL ||
    process.env.NEXT_PUBLIC_ENGINE_URL ||
    "http://127.0.0.1:4100";
  return url.replace(/\/$/, "");
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

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) };
  const token = readToken();
  if (token) {
    headers["x-beerengineer-token"] = token;
  }
  return headers;
}

export async function proxyEngineMutation(
  path: string,
  body: unknown
): Promise<Response> {
  const headers = authHeaders({
    "Content-Type": "application/json",
  });
  const upstream = await fetch(`${engineBaseUrl()}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? {}),
  });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
    },
  });
}

export async function proxyEngineGet(path: string): Promise<Response> {
  const upstream = await fetch(`${engineBaseUrl()}${path}`, {
    method: "GET",
    headers: authHeaders(),
    cache: "no-store",
  });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
    },
  });
}

export async function proxyEngineStream(path: string): Promise<Response> {
  const upstream = await fetch(`${engineBaseUrl()}${path}`, {
    method: "GET",
    headers: authHeaders({
      Accept: "text/event-stream",
    }),
    cache: "no-store",
  });
  if (!upstream.body) {
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "text/plain",
      },
    });
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "text/event-stream",
      "Cache-Control": upstream.headers.get("Cache-Control") ?? "no-cache",
    },
  });
}
