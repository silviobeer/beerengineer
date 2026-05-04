export type LifecycleStepId = "branch_creation" | "migrations" | "seed" | "db_tests" | "cleanup";
export type LifecycleStepStatus = "idle" | "in_progress" | "passed" | "failed" | "retained";

export type LifecycleStepState = {
  id: LifecycleStepId;
  label: string;
  status: LifecycleStepStatus;
  lastUpdateAt?: string;
  reason?: string;
};

export type LifecycleStateByWave = Record<string, LifecycleStepState[]>;

export const LIFECYCLE_STEPS: Array<{ id: LifecycleStepId; label: string }> = [
  { id: "branch_creation", label: "Branch creation" },
  { id: "migrations", label: "Migrations" },
  { id: "seed", label: "Seed" },
  { id: "db_tests", label: "DB tests" },
  { id: "cleanup", label: "Cleanup" },
];

export function emptyLifecycleSteps(): LifecycleStepState[] {
  return LIFECYCLE_STEPS.map(step => ({ ...step, status: "idle" }));
}

type SupabaseLifecycleEnvelope = {
  type?: string;
  ts?: string;
  payload?: {
    rawType?: string;
    waveId?: string | null;
    branchRef?: string | null;
    step?: string;
    status?: string;
    reason?: string;
    timestamp?: number;
  };
};

function parseStatus(value: unknown): LifecycleStepStatus | null {
  return value === "idle" || value === "in_progress" || value === "passed" || value === "failed" || value === "retained" ? value : null;
}

function parseStep(value: unknown): LifecycleStepId | null {
  return value === "branch_creation" || value === "migrations" || value === "seed" || value === "db_tests" || value === "cleanup" ? value : null;
}

export function applyLifecycleEvent(state: LifecycleStateByWave, envelope: SupabaseLifecycleEnvelope): LifecycleStateByWave {
  if (!envelope.type?.startsWith("supabase.branch.")) return state;
  const waveId = envelope.payload?.waveId ?? "default";
  const stepId = parseStep(envelope.payload?.step);
  const status = parseStatus(envelope.payload?.status);
  if (!stepId || !status) return state;
  const existing = state[waveId] ?? emptyLifecycleSteps();
  return {
    ...state,
    [waveId]: existing.map(step => step.id === stepId
      ? {
          ...step,
          status,
          lastUpdateAt: envelope.ts ?? (typeof envelope.payload?.timestamp === "number" ? new Date(envelope.payload.timestamp).toISOString() : undefined),
          reason: status === "passed" ? undefined : envelope.payload?.reason,
        }
      : step),
  };
}

export function rebuildLifecycleFromReplay(events: SupabaseLifecycleEnvelope[]): LifecycleStateByWave {
  return events.reduce((state, event) => applyLifecycleEvent(state, event), {} as LifecycleStateByWave);
}
