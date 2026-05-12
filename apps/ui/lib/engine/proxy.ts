import { engineBaseUrl } from "./baseUrl";

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return extra ? { ...extra } : {};
}

function jsonResponse(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

function originFromHost(request: Request, host: string | null): string | null {
  if (!host) return null;
  const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(/:$/, "");
  return `${proto}://${host}`;
}

function requestOrigins(request: Request): Set<string> {
  const url = new URL(request.url);
  return new Set(
    [
      url.origin,
      originFromHost(request, request.headers.get("host")),
      originFromHost(request, request.headers.get("x-forwarded-host")),
    ].filter((origin): origin is string => Boolean(origin))
  );
}

function validateProxyMutationRequest(request: Request): Response | null {
  const expectedOrigins = requestOrigins(request);
  const origin = request.headers.get("origin");
  if (origin && !expectedOrigins.has(origin)) return jsonResponse("csrf_token_required", 403);

  const referer = request.headers.get("referer");
  if (!origin && referer) {
    try {
      if (!expectedOrigins.has(new URL(referer).origin)) return jsonResponse("csrf_token_required", 403);
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
