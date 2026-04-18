import type { StageKey } from "../domain/types.js";

export type RunProfile = {
  stageKey: StageKey;
  promptPath: string;
  skillPaths: string[];
};

export const runProfiles: Record<StageKey, RunProfile> = {
  brainstorm: {
    stageKey: "brainstorm",
    promptPath: "prompts/system/brainstorm.md",
    skillPaths: ["skills/brainstorm-facilitation.md", "skills/project-extraction.md"]
  },
  requirements: {
    stageKey: "requirements",
    promptPath: "prompts/system/requirements.md",
    skillPaths: ["skills/requirements-engineer.md"]
  },
  architecture: {
    stageKey: "architecture",
    promptPath: "prompts/system/architecture.md",
    skillPaths: ["skills/architecture.md"]
  }
};
