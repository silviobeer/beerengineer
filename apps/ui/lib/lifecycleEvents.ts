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

export function lifecycleStepsFromBranchState(lifecycleState?: string | null): LifecycleStepState[] {
  const steps = emptyLifecycleSteps();
  const set = (id: LifecycleStepId, status: LifecycleStepStatus, reason?: string) => {
    const step = steps.find(candidate => candidate.id === id);
    if (step) {
      step.status = status;
      step.reason = status === "passed" ? undefined : reason;
    }
  };
  switch (lifecycleState) {
    case "provisioning":
      set("branch_creation", "in_progress");
      break;
    case "ready":
      set("branch_creation", "passed");
      break;
    case "validating":
      set("branch_creation", "passed");
      set("migrations", "in_progress");
      break;
    case "validated":
      set("branch_creation", "passed");
      set("migrations", "passed");
      set("seed", "passed");
      set("db_tests", "passed");
      break;
    case "retained-pending-cleanup":
      set("branch_creation", "passed");
      set("migrations", "passed");
      set("seed", "passed");
      set("db_tests", "passed");
      set("cleanup", "retained", "cleanup pending");
      break;
    case "destroying":
      set("branch_creation", "passed");
      set("migrations", "passed");
      set("seed", "passed");
      set("db_tests", "passed");
      set("cleanup", "in_progress");
      break;
    case "destroyed":
      set("branch_creation", "passed");
      set("migrations", "passed");
      set("seed", "passed");
      set("db_tests", "passed");
      set("cleanup", "passed");
      break;
    case "failed":
    case "retained-for-diagnosis":
    case "quota-exceeded":
      set("branch_creation", "passed");
      set("db_tests", "retained", lifecycleState);
      set("cleanup", "retained", "retained for diagnosis");
      break;
  }
  return steps;
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
