import { NextResponse } from "next/server";
import { fetchItem } from "@/lib/engine/server";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    return NextResponse.json(await fetchItem(id));
  } catch {
    return NextResponse.json({ error: "engine_get_item_failed" }, { status: 502 });
  }
}
