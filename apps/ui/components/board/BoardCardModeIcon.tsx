import type { ItemMode } from "@/lib/view-models";

export function BoardCardModeIcon({ mode }: { mode: ItemMode }) {
  return (
    <span aria-label="Mode" className={`mode-icon mode-${mode}`}>
      {mode}
    </span>
  );
}
