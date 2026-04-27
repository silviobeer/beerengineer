function engineBaseUrl(): string {
  const url =
    process.env.BEERENGINEER_ENGINE_URL ||
    process.env.NEXT_PUBLIC_ENGINE_URL ||
    "http://127.0.0.1:4100";
  return url.replace(/\/$/, "");
}

export async function proxyEngineMutation(
  path: string,
  body: unknown
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token = process.env.BEERENGINEER_API_TOKEN;
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
