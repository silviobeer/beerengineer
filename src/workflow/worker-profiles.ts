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
  storyReviewRemediation: {
    // Remediation stays implementation-shaped on purpose; the engine already narrows scope to selected findings.
    promptPath: "prompts/workers/story-review-remediation.md",
    skillPaths: ["skills/execution-implementer.md"]
  },
  qa: {
    promptPath: "prompts/workers/qa.md",
    skillPaths: ["skills/qa-verifier.md"]
  },
  documentation: {
    promptPath: "prompts/workers/documentation.md",
    skillPaths: ["skills/documentation-writer.md"]
  }
} as const;

export type WorkerProfileKey = keyof typeof workerProfiles;
