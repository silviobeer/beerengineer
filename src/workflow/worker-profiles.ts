export const workerProfiles = {
  testPreparation: {
    promptPath: "prompts/workers/test-preparation.md",
    skillPaths: ["skills/test-writer.md"]
  },
  execution: {
    promptPath: "prompts/workers/execution.md",
    skillPaths: ["skills/execution-implementer.md"]
  },
  ralph: {
    promptPath: "prompts/workers/ralph.md",
    skillPaths: ["skills/ralph-verifier.md"]
  },
  storyReview: {
    promptPath: "prompts/workers/story-review.md",
    skillPaths: ["skills/story-reviewer.md"]
  },
  qa: {
    promptPath: "prompts/workers/qa.md",
    skillPaths: ["skills/qa-verifier.md"]
  }
} as const;

export type WorkerProfileKey = keyof typeof workerProfiles;
