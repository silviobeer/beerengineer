import { StatusChip } from "@/components/StatusChip";

export type MergeGateState = {
  status: "pass" | "block" | "pending" | "skipped";
  reason: string;
  operations?: Array<{ kind: string; file: string; line: number; redactedSnippet: string }>;
};

export type MergeGatePanelProps = {
  gates: {
    finalValidation: MergeGateState;
    protectionSwitch: MergeGateState;
    destructiveConfirmation: MergeGateState;
    productionMigration: MergeGateState;
  };
  onAcknowledgeDestructive?: () => Promise<void> | void;
};

const GATE_ROWS: Array<{ key: keyof MergeGatePanelProps["gates"]; label: string }> = [
  { key: "finalValidation", label: "Final validation" },
  { key: "protectionSwitch", label: "Protection switch" },
  { key: "destructiveConfirmation", label: "Destructive confirmation" },
  { key: "productionMigration", label: "Production migration" },
];

export function MergeGatePanel({ gates, onAcknowledgeDestructive }: Readonly<MergeGatePanelProps>) {
  return (
    <section className="space-y-3 border border-zinc-800 bg-zinc-950 p-4" data-testid="merge-gate-panel">
      {GATE_ROWS.map(({ key, label }) => {
        const gate = gates[key];
        return (
          <div key={key} className="space-y-2 border-b border-zinc-900 pb-3 last:border-b-0 last:pb-0">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium text-zinc-100">{label}</h3>
              <StatusChip state={gate.status} />
            </div>
            <p className="text-sm text-zinc-300">{gate.reason}</p>
            {key === "protectionSwitch" && gate.status === "block" ? <a className="text-sm text-amber-200 underline" href="/settings#supabase">Open settings</a> : null}
            {key === "destructiveConfirmation" && gate.operations?.length ? (
              <div className="space-y-2">
                <ul className="space-y-1 text-xs text-zinc-300">
                  {gate.operations.map(op => <li key={`${op.file}:${op.line}:${op.kind}`}><span className="font-mono">{op.file}:{op.line}</span> {op.kind} {op.redactedSnippet}</li>)}
                </ul>
                {gate.status === "block" ? <button type="button" className="border border-amber-700 px-3 py-2 text-sm text-amber-100" onClick={() => void onAcknowledgeDestructive?.()}>Acknowledge</button> : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
