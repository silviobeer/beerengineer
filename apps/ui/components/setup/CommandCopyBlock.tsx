"use client";

import { useState } from "react";

interface CommandCopyBlockProps {
  readonly command: string;
  readonly label?: string;
}

export function CommandCopyBlock({ command, label = "Command" }: Readonly<CommandCopyBlockProps>) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard?.writeText(command);
    setCopied(true);
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] uppercase text-zinc-500">{label}</span>
        <button type="button" onClick={copy} className="border border-zinc-700 px-2 py-1 text-xs text-amber-300">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="whitespace-pre-wrap break-words bg-zinc-950 p-3 font-mono text-xs text-zinc-200">{command}</pre>
    </div>
  );
}
