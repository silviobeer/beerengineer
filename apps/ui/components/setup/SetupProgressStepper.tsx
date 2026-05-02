import { SETUP_STEP_LABELS, type SetupReport, type WizardStepState, deriveCurrentStep } from "@/lib/setup/types";

interface SetupProgressStepperProps {
  readonly report: SetupReport | null;
  readonly checking?: boolean;
}

function stateFor(args: {
  step: number;
  current: number;
  checking: boolean;
  complete: boolean;
  isLast: boolean;
}): WizardStepState {
  if (args.complete) return args.isLast ? "finished" : "done";
  if (args.step < args.current) return "done";
  if (args.step === args.current) return args.checking ? "checking" : "blocked";
  return "locked";
}

export function SetupProgressStepper({ report, checking = false }: Readonly<SetupProgressStepperProps>) {
  const current = deriveCurrentStep(report);
  const complete = report?.overall === "ok";
  return (
    <section aria-label="Setup progress" className="space-y-3" data-testid="setup-stepper">
      <p className="font-mono text-xs uppercase text-amber-300">
        Step {complete ? SETUP_STEP_LABELS.length : current} of {SETUP_STEP_LABELS.length}
      </p>
      <ol className="grid gap-2 sm:grid-cols-5">
        {SETUP_STEP_LABELS.map((label, i) => {
          const step = i + 1;
          const state = stateFor({ step, current, checking, complete, isLast: i === SETUP_STEP_LABELS.length - 1 });
          return (
            <li
              key={label}
              data-testid="setup-step"
              data-state={state}
              aria-current={step === current && !complete ? "step" : undefined}
              className="min-w-0 border border-zinc-800 bg-zinc-900 px-3 py-2"
            >
              <span className="block font-mono text-[11px] uppercase text-zinc-500">0{step}</span>
              <span className="block truncate text-sm text-zinc-100">{label}</span>
              <span className="block font-mono text-[11px] uppercase text-zinc-400">{state}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
