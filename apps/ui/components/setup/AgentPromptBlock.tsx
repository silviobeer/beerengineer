"use client";

import { CommandCopyBlock } from "./CommandCopyBlock";

export function AgentPromptBlock({ prompt }: Readonly<{ prompt: string }>) {
  return <CommandCopyBlock label="Agent prompt" command={prompt} />;
}
