import type { OpenPromptPreview } from "@/lib/view-models";
import { DetailBlock } from "@/components/primitives/DetailBlock";
import { PromptComposer } from "@/components/primitives/PromptComposer";

export function ItemQuickPrompt({ prompt }: { prompt: OpenPromptPreview | null | undefined }) {
  if (!prompt) return null;
  return (
    <DetailBlock kicker="Open prompt" title="Answer now" className="prompt-block">
      <PromptComposer
        runId={prompt.runId}
        promptId={prompt.promptId}
        prompt={prompt.prompt}
        variant="compact"
        secondaryHref={`/runs/${prompt.runId}`}
        secondaryLabel="Open full run"
      />
    </DetailBlock>
  );
}
