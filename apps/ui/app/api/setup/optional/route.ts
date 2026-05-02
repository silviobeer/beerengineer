export async function POST(request: Request): Promise<Response> {
  let group = "optional";
  try {
    const body = (await request.json()) as { group?: unknown };
    if (typeof body.group === "string" && body.group.trim()) group = body.group.trim();
  } catch {
    // Empty bodies are accepted as a local defer action.
  }
  return Response.json({ ok: true, status: "skipped", group });
}
