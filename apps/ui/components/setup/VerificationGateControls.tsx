"use client";

interface VerificationGateControlsProps {
  readonly required: boolean;
  readonly optional?: boolean;
  readonly blocked: boolean;
  readonly checking: boolean;
  readonly onRecheck: () => void;
  readonly onSkip?: () => void;
  readonly onNext: () => void;
}

export function VerificationGateControls({
  required,
  optional = false,
  blocked,
  checking,
  onRecheck,
  onSkip,
  onNext,
}: Readonly<VerificationGateControlsProps>) {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => onSkip?.()}
        disabled={required || checking || !optional}
        className="border border-zinc-700 px-3 py-2 text-sm text-zinc-200 disabled:opacity-45"
      >
        {optional ? "Skip" : "Skip unavailable"}
      </button>
      <button
        type="button"
        onClick={onRecheck}
        disabled={checking}
        className="border border-amber-500 bg-amber-500 px-3 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50"
      >
        {checking ? "Checking" : "Re-check"}
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={checking || blocked}
        className="border border-emerald-500 px-3 py-2 text-sm font-medium text-emerald-300 disabled:opacity-45"
      >
        Next
      </button>
    </div>
  );
}
