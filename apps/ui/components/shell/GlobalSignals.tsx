import type { GlobalSignal } from "@/lib/view-models";
import { MetricPill } from "@/components/primitives/MetricPill";

export function GlobalSignals({ signals }: { signals: GlobalSignal[] }) {
  return (
    <div className="header-signals">
      {signals.map((signal) => (
        <div key={signal.label} className={`global-signal tone-${signal.tone ?? "neutral"}`}>
          <MetricPill label={signal.label} value={signal.value} />
        </div>
      ))}
    </div>
  );
}
