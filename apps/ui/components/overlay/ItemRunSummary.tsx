import Link from "next/link";
import type { ItemOverlayViewModel, SignalTone } from "@/lib/view-models";
import { DetailBlock } from "@/components/primitives/DetailBlock";
import { StatusChip } from "@/components/primitives/StatusChip";

function formatRelative(timestamp: number | null | undefined): string {
  if (!timestamp) return "—";
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} h ago`;
  return `${Math.round(diff / 86_400_000)} d ago`;
}

function statusTone(status: string): SignalTone {
  if (status === "completed" || status === "succeeded") return "success";
  if (status === "running" || status === "pending") return "petrol";
  if (status === "failed") return "danger";
  if (status === "blocked") return "gold";
  return "neutral";
}

export function ItemRunSummary({ overlay }: { overlay: ItemOverlayViewModel }) {
  const summary = overlay.runSummary;
  const history = overlay.runHistory ?? [];

  if (!summary && history.length === 0) return null;

  return (
    <DetailBlock kicker="Run summary" title="Active and recent runs">
      {summary ? (
        <div className="run-summary">
          <Link href={`/runs/${summary.runId}`} className="run-summary-link">
            <strong>run/{summary.runId.slice(0, 8)}</strong>
            <StatusChip label={summary.status} tone={statusTone(summary.status)} />
          </Link>
          <div className="run-summary-meta">
            <span>stage · {summary.currentStage ?? "—"}</span>
            <span>started · {formatRelative(summary.startedAt)}</span>
            <span>last event · {formatRelative(summary.lastEventAt)}</span>
          </div>
        </div>
      ) : (
        <p className="muted">No active run.</p>
      )}
      {history.length > 1 ? (
        <ul className="run-history">
          {history.slice(1, 6).map((entry) => (
            <li key={entry.runId}>
              <Link href={`/runs/${entry.runId}`}>
                <span className="mono-label">run/{entry.runId.slice(0, 8)}</span>
                <StatusChip label={entry.status} tone={statusTone(entry.status)} />
                <span className="muted">{formatRelative(entry.endedAt ?? entry.startedAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </DetailBlock>
  );
}
