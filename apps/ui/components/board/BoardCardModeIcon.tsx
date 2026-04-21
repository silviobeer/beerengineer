import type { ItemMode } from "@/lib/view-models";

export function BoardCardModeIcon({ mode }: { mode: ItemMode }) {
  return <span className={`mode-icon mode-${mode}`}>{mode === "auto" ? "A" : mode === "assisted" ? "S" : "M"}</span>;
}
