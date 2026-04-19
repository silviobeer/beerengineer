import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { ClaudeCliAdapter } from "../../src/adapters/hosted/providers/claude-adapter.js";
import { CodexCliAdapter } from "../../src/adapters/hosted/providers/codex-adapter.js";
import type {
  InteractiveBrainstormAdapterRunRequest,
  InteractiveStoryReviewAdapterRunRequest,
  TestPreparationAdapterRunRequest
} from "../../src/adapters/types.js";

function buildBrainstormRequest(workspaceRoot: string): InteractiveBrainstormAdapterRunRequest {
  return {
    runtime: {
      provider: "codex",
      model: "gpt-5.4",
      workspaceRoot,
      policy: {
        autonomyMode: "yolo",
        approvalMode: "never",
        filesystemMode: "danger-full-access",
        networkMode: "enabled",
        interactionMode: "non_blocking"
      }
    },
    interactionType: "brainstorm_chat",
    prompt: "Summarize and patch the brainstorm draft.",
    session: {
      id: "brainstorm_session_1",
      status: "waiting_for_user",
      mode: "explore"
    },
    item: {
      id: "item_1",
      code: "ITEM-0001",
      title: "Interactive Brainstorm",
      description: "Clarify the concept collaboratively"
    },
    draft: {
      revision: 1,
      status: "draft",
      problem: null,
      coreOutcome: null,
      targetUsers: [],
      useCases: [],
      constraints: [],
      nonGoals: [],
      risks: [],
      openQuestions: [],
      candidateDirections: [],
      recommendedDirection: null,
      scopeNotes: null,
      assumptions: []
    },
    messages: [],
    userMessage: "problem: Need a shared review inbox",
    allowedActions: ["suggest_patch", "request_structured_follow_up", "suggest_promote"]
  };
}

function buildStoryReviewRequest(workspaceRoot: string): InteractiveStoryReviewAdapterRunRequest {
  return {
    runtime: {
      provider: "claude",
      model: "claude-sonnet",
      workspaceRoot,
      policy: {
        autonomyMode: "yolo",
        approvalMode: "never",
        filesystemMode: "danger-full-access",
        networkMode: "enabled",
        interactionMode: "non_blocking"
      }
    },
    interactionType: "story_review_chat",
    prompt: "Convert review feedback into entry updates.",
    session: {
      id: "interactive_review_session_1",
      status: "open",
      artifactType: "stories",
      reviewType: "human_in_loop"
    },
    item: {
      id: "item_1",
      code: "ITEM-0001",
      title: "Review Flow",
      description: "Story review"
    },
    project: {
      id: "project_1",
      code: "PRJ-0001",
      title: "Review Inbox",
      summary: "Summarize review state",
      goal: "Help teams inspect active sessions"
    },
    stories: [
      {
        id: "story_1",
        entryId: "story_1",
        code: "US-001",
        title: "List sessions",
        description: "Show sessions",
        priority: "high",
        status: "draft",
        acceptanceCriteria: []
      }
    ],
    entries: [
      {
        entryId: "story_1",
        title: "US-001 List sessions",
        status: "pending",
        summary: null,
        changeRequest: null,
        rationale: null,
        severity: null
      }
    ],
    messages: [],
    userMessage: "US-001 looks good and can be approved",
    allowedStatuses: ["pending", "accepted", "needs_revision", "rejected"],
    allowedActions: ["update_entries", "request_structured_follow_up", "suggest_resolution"]
  };
}

function buildTestPreparationRequest(workspaceRoot: string): TestPreparationAdapterRunRequest {
  return {
    runtime: {
      provider: "codex",
      model: "gpt-5.4",
      workspaceRoot,
      policy: {
        autonomyMode: "yolo",
        approvalMode: "never",
        filesystemMode: "danger-full-access",
        networkMode: "enabled",
        interactionMode: "non_blocking"
      }
    },
    workerRole: "test-writer",
    prompt: "Generate concrete test preparation output.",
    skills: [],
    item: {
      id: "item_1",
      code: "ITEM-0001",
      title: "Hello World App",
      description: "Minimal app"
    },
    project: {
      id: "project_1",
      code: "ITEM-0001-P01",
      title: "Hello World",
      summary: "Minimal project",
      goal: "Show hello world"
    },
    implementationPlan: {
      id: "plan_1",
      summary: "One wave",
      version: 1
    },
    wave: {
      id: "wave_1",
      code: "W01",
      goal: "Build the app",
      position: 0
    },
    story: {
      id: "story_1",
      code: "ITEM-0001-P01-US01",
      title: "View the hello world page",
      description: "See the page",
      actor: "user",
      goal: "See the page",
      benefit: "Know it works",
      priority: "high"
    },
    acceptanceCriteria: [
      {
        id: "ac_1",
        code: "ITEM-0001-P01-US01-AC01",
        text: "Shows Hello World",
        position: 0
      }
    ],
    architecture: {
      id: "architecture_1",
      summary: "Tiny server and static page",
      version: 1
    },
    projectExecutionContext: {
      relevantDirectories: ["src", "test"],
      relevantFiles: ["README.md"],
      integrationPoints: ["cli"],
      testLocations: ["test/unit"],
      repoConventions: ["minimal"],
      executionNotes: []
    },
    businessContextSnapshotJson: "{}",
    repoContextSnapshotJson: "{}"
  };
}

describe("hosted cli adapters", () => {
  it("wires codex exec with yolo flags and reads the output-last-message file", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-codex-adapter-"));
    const recordPath = join(root, "record.json");
    const workspaceRoot = join(root, "workspace");
    mkdirSync(workspaceRoot, { recursive: true });
    const stubPath = resolve("test/fixtures/provider-cli-stub.mjs");
    const adapter = new CodexCliAdapter([process.execPath, stubPath, "codex"], {
      STUB_OUTPUT: JSON.stringify({
        output: {
          assistantMessage: "Captured brainstorm updates.",
          draftPatch: {
            problem: "Need a shared review inbox"
          },
          needsStructuredFollowUp: false,
          followUpHint: null
        }
      }),
      STUB_RECORD_FILE: recordPath
    }, 10_000);

    try {
      const result = await adapter.runInteractiveBrainstorm(buildBrainstormRequest(workspaceRoot));
      const record = JSON.parse(readFileSync(recordPath, "utf8")) as { argv: string[]; cwd: string; stdin: string };

      expect(result.output.draftPatch.problem).toContain("shared review inbox");
      expect(record.cwd).toBe(workspaceRoot);
      expect(record.argv).toContain("exec");
      expect(record.argv).toContain("--dangerously-bypass-approvals-and-sandbox");
      expect(record.argv).toContain("--output-last-message");
      expect(record.stdin).toContain("You are the BeerEngineer provider backend.");
      expect(record.stdin).toContain("\"interactionType\": \"brainstorm_chat\"");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("wires claude print mode with bypass permissions and parses stdout json", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-claude-adapter-"));
    const recordPath = join(root, "record.json");
    const workspaceRoot = join(root, "workspace");
    mkdirSync(workspaceRoot, { recursive: true });
    const stubPath = resolve("test/fixtures/provider-cli-stub.mjs");
    const adapter = new ClaudeCliAdapter([process.execPath, stubPath, "claude"], {
      STUB_OUTPUT: JSON.stringify({
        output: {
          assistantMessage: "Captured 1 review update.",
          entryUpdates: [
            {
              entryId: "story_1",
              status: "accepted",
              summary: "Accepted from interactive review chat",
              changeRequest: null,
              rationale: null,
              severity: null
            }
          ],
          needsStructuredFollowUp: false,
          followUpHint: null,
          recommendedResolution: null
        }
      }),
      STUB_RECORD_FILE: recordPath
    }, 10_000);

    try {
      const result = await adapter.runInteractiveStoryReview(buildStoryReviewRequest(workspaceRoot));
      const record = JSON.parse(readFileSync(recordPath, "utf8")) as { argv: string[]; cwd: string; stdin: string };

      expect(result.output.entryUpdates[0]?.status).toBe("accepted");
      expect(record.cwd).toBe(workspaceRoot);
      expect(record.argv).toContain("--print");
      expect(record.argv).toContain("--permission-mode");
      expect(record.argv).toContain("bypassPermissions");
      expect(record.argv).toContain("--dangerously-skip-permissions");
      expect(record.stdin).toContain("\"interactionType\": \"story_review_chat\"");
      expect(record.stdin).toContain("Return exactly one JSON object");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("surfaces a sanitized execution error on non-zero exit", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-codex-adapter-"));
    const workspaceRoot = join(root, "workspace");
    mkdirSync(workspaceRoot, { recursive: true });
    const stubPath = resolve("test/fixtures/provider-cli-stub.mjs");
    const adapter = new CodexCliAdapter([process.execPath, stubPath, "codex"], {
      STUB_OUTPUT: "{}",
      STUB_EXIT_CODE: "2",
      STUB_STDERR: "authorization=secret-token very long provider failure"
    }, 10_000);

    try {
      await expect(adapter.runInteractiveBrainstorm(buildBrainstormRequest(workspaceRoot))).rejects.toThrow(
        /authorization=\[redacted\]/i
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("includes the explicit test preparation output contract in the hosted prompt", async () => {
    const root = mkdtempSync(join(tmpdir(), "beerengineer-codex-adapter-"));
    const recordPath = join(root, "record.json");
    const workspaceRoot = join(root, "workspace");
    mkdirSync(workspaceRoot, { recursive: true });
    const stubPath = resolve("test/fixtures/provider-cli-stub.mjs");
    const adapter = new CodexCliAdapter([process.execPath, stubPath, "codex"], {
      STUB_OUTPUT: JSON.stringify({
        output: {
          summary: "Prepared minimal test targets.",
          testFiles: [
            {
              path: "test/app.test.js",
              content: "test content",
              writeMode: "proposed"
            }
          ],
          testsGenerated: [
            {
              path: "test/app.test.js",
              intent: "Verifies the page renders Hello World."
            }
          ],
          assumptions: [],
          blockers: []
        }
      }),
      STUB_RECORD_FILE: recordPath
    }, 10_000);

    try {
      const result = await adapter.runStoryTestPreparation(buildTestPreparationRequest(workspaceRoot));
      const record = JSON.parse(readFileSync(recordPath, "utf8")) as { stdin: string };

      expect(result.output.testFiles[0]?.path).toBe("test/app.test.js");
      expect(record.stdin).toContain('"testFiles": Array<{ "path": string, "content": string, "writeMode": "proposed"|"written" }>');
      expect(record.stdin).toContain('"testsGenerated": Array<{ "path": string, "intent": string }>');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
