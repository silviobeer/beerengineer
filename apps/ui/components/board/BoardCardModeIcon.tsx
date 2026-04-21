import type { ItemMode } from "@/lib/view-models";
import { ModeIcon } from "@/components/board/BoardIcons";

export function BoardCardModeIcon({ mode }: { mode: ItemMode }) {
  return (
    <span aria-label={`Mode: ${mode}`} title={mode} className={`mode-icon mode-${mode}`}>
      <ModeIcon mode={mode} />
    </span>
  );
}
