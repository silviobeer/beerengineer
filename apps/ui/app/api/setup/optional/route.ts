export async function POST(request: Request): Promise<Response> {
  let group = "optional";
  try {
    const body = (await request.json()) as { group?: unknown };
    if (typeof body.group === "string" && body.group.trim()) group = body.group.trim();
  } catch {
    // Empty bodies are accepted as a local defer action.
  }
  if (/^(core|llm|git|vcs)$/i.test(group)) {
    return Response.json({ ok: false, error: "required_group_cannot_be_skipped", group }, { status: 400 });
  }
  return Response.json({ ok: true, status: "skipped", group });
}
