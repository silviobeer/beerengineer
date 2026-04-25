interface MiniStepperProps {
  pipelineState: string;
}

const STEPS = ["arch", "plan", "exec", "review"];

function activeIndex(state: string): number {
  if (state === "running") return 2;
  if (state === "review-gate-waiting") return 3;
  if (state === "openPrompt") return 1;
  if (state === "run-blocked") return 2;
  return 0;
}

export function MiniStepper({ pipelineState }: MiniStepperProps) {
  const idx = activeIndex(pipelineState);
  return (
    <div
      data-testid="mini-stepper"
      data-state={pipelineState}
      className="flex items-center gap-1 mt-1"
    >
      {STEPS.map((step, i) => (
        <span
          key={step}
          data-step={step}
          data-active={i === idx ? "true" : "false"}
          className={`inline-block h-1.5 w-1.5 rounded-full ${
            i <= idx ? "bg-emerald-400" : "bg-zinc-700"
          }`}
        />
      ))}
      <span className="ml-1 text-[10px] text-zinc-500 uppercase tracking-wider">
        {STEPS[idx]}
      </span>
    </div>
  );
}
