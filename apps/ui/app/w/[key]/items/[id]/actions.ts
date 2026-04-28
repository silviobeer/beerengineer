"use server";

import { ITEM_ACTIONS, type ActionResult, type ItemAction } from "@/lib/engine/types";
import { postItemAction } from "@/lib/engine/server";

export async function performItemAction(
  itemId: string,
  action: ItemAction,
): Promise<ActionResult> {
  if (!ITEM_ACTIONS.includes(action)) {
    return { ok: false, status: 400, error: "unknown_action" };
  }
  const result = await postItemAction(itemId, action);
  if (result.ok) return { ok: true, status: result.status };
  return {
    ok: false,
    status: result.status,
    error: result.error ?? "request_failed",
  };
}
