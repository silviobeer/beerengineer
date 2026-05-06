import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

function engineBaseUrl(): string {
  const url =
    process.env.BEERENGINEER_ENGINE_URL ||
    process.env.ENGINE_URL ||
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
  const headers: Record<string, string> = extra ? { ...extra } : {};
  const token = readToken();
  if (token) {
    headers["x-beerengineer-token"] = token;
  }
  return headers;
}

function jsonResponse(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

function requestOrigin(request: Request): string {
  return new URL(request.url).origin;
}

function validateProxyMutationRequest(request: Request): Response | null {
  const expectedOrigin = requestOrigin(request);
  const origin = request.headers.get("origin");
  if (origin && origin !== expectedOrigin) return jsonResponse("csrf_token_required", 403);

  const referer = request.headers.get("referer");
  if (!origin && referer) {
    try {
      if (new URL(referer).origin !== expectedOrigin) return jsonResponse("csrf_token_required", 403);
    } catch {
      return jsonResponse("csrf_token_required", 403);
    }
  }

  return null;
}

export async function readProxyMutationBody(request: Request): Promise<
  | { ok: true; body: unknown }
  | { ok: false; response: Response }
> {
  const blocked = validateProxyMutationRequest(request);
  if (blocked) return { ok: false, response: blocked };

  const contentType = request.headers.get("content-type");
  const contentLength = request.headers.get("content-length");
  if (contentLength === "0" || (!contentType && !contentLength)) {
    return { ok: true, body: {} };
  }
  if (contentType && !contentType.toLowerCase().includes("application/json")) {
    return { ok: false, response: jsonResponse("unsupported_content_type", 415) };
  }

  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false, response: jsonResponse("malformed_json", 400) };
  }
}

export async function proxyEngineMutation(
  request: Request,
  path: string,
  body?: unknown
): Promise<Response> {
  return proxyEngineJson(request, "POST", path, body);
}

export async function proxyEnginePatch(
  request: Request,
  path: string,
  body?: unknown
): Promise<Response> {
  return proxyEngineJson(request, "PATCH", path, body);
}

async function proxyEngineJson(
  request: Request,
  method: "POST" | "PATCH",
  path: string,
  body?: unknown
): Promise<Response> {
  const blocked = validateProxyMutationRequest(request);
  if (blocked) return blocked;
  const payload = body === undefined ? await readProxyMutationBody(request) : { ok: true as const, body };
  if (!payload.ok) return payload.response;
  const headers = authHeaders({
    "Content-Type": "application/json",
  });
  const upstream = await fetch(`${engineBaseUrl()}${path}`, {
    method,
    headers,
    body: JSON.stringify(payload.body ?? {}),
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
