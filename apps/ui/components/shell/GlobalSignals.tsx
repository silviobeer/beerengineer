import type { GlobalSignal, WorkspaceSignalEntry } from "@/lib/view-models";
import { MetricPill } from "@/components/primitives/MetricPill";
import { SignalPopover } from "@/components/shell/SignalPopover";

type Props = {
  signals: GlobalSignal[];
  entries?: WorkspaceSignalEntry[];
};

/**
 * Static signals render as plain pills. Signals carrying a `signalKey` get
 * the SignalPopover treatment with deep links into the inbox/run/merge
 * targets owned by `entries`.
 */
export function GlobalSignals({ signals, entries }: Props) {
  return (
    <div className="header-signals">
      {signals.map((signal) => {
        if (signal.signalKey) {
          const matching = entries?.filter((entry) => entry.key === signal.signalKey) ?? [];
          return (
            <SignalPopover
              key={signal.label}
              signal={signal}
              entries={matching}
            />
          );
        }
        return (
          <div key={signal.label} className={`global-signal tone-${signal.tone ?? "neutral"}`}>
            <MetricPill label={signal.label} value={signal.value} />
          </div>
        );
      })}
    </div>
  );
}
