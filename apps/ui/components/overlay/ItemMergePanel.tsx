import type { MergePanelViewModel } from "@/lib/view-models";
import { DetailBlock } from "@/components/primitives/DetailBlock";

/**
 * Phase E mock surface. Renders the merge controls with `aria-disabled`
 * when the backend is not yet wired so we never show phantom affordances.
 */
export function ItemMergePanel({ merge }: { merge: MergePanelViewModel | null | undefined }) {
  if (!merge) return null;
  const disabled = !merge.backendReady;
  return (
    <DetailBlock kicker="Merge to main" title="Handoff candidate" className="merge-block">
      <dl className="merge-summary">
        <div>
          <dt>candidate</dt>
          <dd>{merge.candidateBranch ? <code>{merge.candidateBranch}</code> : <span className="muted">none</span>}</dd>
        </div>
        <div>
          <dt>base</dt>
          <dd><code>{merge.baseBranch ?? "main"}</code></dd>
        </div>
        <div>
          <dt>checks</dt>
          <dd>{merge.checklistSummary ?? "—"}</dd>
        </div>
        <div>
          <dt>validation</dt>
          <dd>{merge.validationStatus ?? "—"}</dd>
        </div>
      </dl>
      <div className="detail-actions">
        <button
          type="button"
          className="detail-action"
          aria-disabled={disabled || undefined}
          disabled={disabled}
          title={disabled ? "Merge endpoint lands in Phase 2" : undefined}
          data-merge-action="test"
        >
          Test candidate
        </button>
        <button
          type="button"
          className="detail-action primary"
          aria-disabled={disabled || undefined}
          disabled={disabled}
          title={disabled ? "Merge endpoint lands in Phase 2" : undefined}
          data-merge-action="merge"
        >
          Merge to main
        </button>
        <button
          type="button"
          className="detail-action"
          aria-disabled={disabled || undefined}
          disabled={disabled}
          title={disabled ? "Merge endpoint lands in Phase 2" : undefined}
          data-merge-action="reject"
        >
          Reject candidate
        </button>
      </div>
      {disabled ? <p className="merge-helper muted">Backend pending — preview only</p> : null}
    </DetailBlock>
  );
}
