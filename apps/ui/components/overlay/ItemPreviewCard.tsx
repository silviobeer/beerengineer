import type { PreviewViewModel } from "@/lib/view-models";
import { DetailBlock } from "@/components/primitives/DetailBlock";
import { EmptyState } from "@/components/primitives/EmptyState";

/**
 * Body of the preview surface without the surrounding detail-block — reused
 * by both the overlay (wrapped) and the run console's preview tab (unwrapped).
 */
export function PreviewBody({ preview }: { preview: PreviewViewModel }) {
  if (preview.reachable && preview.previewUrl) {
    return (
      <div className="preview-card">
        <code>{preview.previewLabel ?? preview.previewUrl}</code>
        <a href={preview.previewUrl} target="_blank" rel="noreferrer" className="detail-action primary">
          Open in new tab
        </a>
        {preview.helperText ? <p className="muted">{preview.helperText}</p> : null}
      </div>
    );
  }
  return (
    <EmptyState
      title="Preview available on engine host only"
      detail={preview.helperText ?? "This UI session cannot reach the preview directly. Open it from the engine machine."}
    />
  );
}

export function ItemPreviewCard({ preview }: { preview: PreviewViewModel | null | undefined }) {
  if (!preview || !preview.available) return null;
  return (
    <DetailBlock kicker="Test preview" title="Preview target" className="preview-block">
      <PreviewBody preview={preview} />
    </DetailBlock>
  );
}
