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

export async function proxyEngineMutation(
  path: string,
  body: unknown
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token = readToken();
  if (token) {
    headers["x-beerengineer-token"] = token;
  }
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
