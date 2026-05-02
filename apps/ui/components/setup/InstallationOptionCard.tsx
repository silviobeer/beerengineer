import type { SetupCheck } from "@/lib/setup/types";
import { AgentPromptBlock } from "./AgentPromptBlock";
import { CommandCopyBlock } from "./CommandCopyBlock";

interface InstallationOptionCardProps {
  readonly check: SetupCheck;
}

export function InstallationOptionCard({ check }: Readonly<InstallationOptionCardProps>) {
  const command = check.remedy?.command;
  const prompt = `Inspect the local beerengineer setup blocker "${check.label}" and suggest the smallest manual fix. Do not install external tools automatically.`;
  return (
    <article className="space-y-3 border border-zinc-800 bg-zinc-900 p-4" data-testid="installation-option">
      <div>
        <h3 className="text-sm font-medium text-zinc-100">{check.label}</h3>
        <p className="text-sm text-zinc-400">{check.remedy?.hint ?? check.detail ?? "Review this setup check manually."}</p>
        {check.remedy?.url ? (
          <a className="text-sm text-amber-300 underline" href={check.remedy.url} target="_blank" rel="noopener noreferrer">
            Source documentation
          </a>
        ) : null}
      </div>
      {command ? <CommandCopyBlock command={command} /> : null}
      <AgentPromptBlock prompt={prompt} />
    </article>
  );
}
