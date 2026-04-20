import { describe, expect, it } from "vitest";

import { CoderabbitReviewProvider } from "../../src/review/providers/coderabbit-review-provider.js";

describe("CoderabbitReviewProvider", () => {
  it("maps live CodeRabbit findings into review findings", () => {
    const provider = new CoderabbitReviewProvider({
      coderabbitService: {
        review: () => ({
          config: {
            authSource: "coderabbit_cli",
            repositorySource: "db"
          },
          findings: [
            {
              reviewerRole: "coderabbit",
              findingType: "live_review",
              normalizedSeverity: "high",
              sourceSeverity: "major",
              title: "Avoid broad catch blocks",
              detail: "Catch specific error types instead of swallowing exceptions.",
              evidence: JSON.stringify({ type: "finding" }),
              filePath: "src/app.ts",
              line: 18,
              fieldPath: null,
              suggestions: ["narrow the catch clause"],
              codegenInstructions: ["replace `catch (error)` with domain-specific handling"],
              source: "live"
            }
          ],
          execution: {
            mode: "live",
            executed: true,
            analysisTarget: "branch",
            attemptedLiveReview: true,
            fallbackReason: null
          }
        })
      }
    } as never);

    const result = provider.provide({
      projectId: "project_1",
      waveId: "wave_1",
      storyId: "story_1",
      storyCode: "ITEM-0001-US01",
      filePaths: ["src/app.ts"],
      modules: ["src/app"]
    });

    expect(result.providerId).toBe("coderabbit");
    expect(result.sourceSystem).toBe("coderabbit");
    expect(result.findings).toEqual([
      {
        reviewerRole: "coderabbit",
        findingType: "live_review",
        normalizedSeverity: "high",
        sourceSeverity: "major",
        title: "Avoid broad catch blocks",
        detail: "Catch specific error types instead of swallowing exceptions.",
        evidence: JSON.stringify({ type: "finding" }),
        filePath: "src/app.ts",
        line: 18,
        fieldPath: null
      }
    ]);
    expect(result.providerMetadata).toEqual({
      execution: {
        mode: "live",
        executed: true,
        analysisTarget: "branch",
        attemptedLiveReview: true,
        fallbackReason: null
      },
      authSource: "coderabbit_cli",
      repositorySource: "db"
    });
  });

  it("falls back to persisted CodeRabbit quality knowledge when live review is unavailable", () => {
    const provider = new CoderabbitReviewProvider({
      coderabbitService: {
        review: () => ({
          config: {
            authSource: "none",
            repositorySource: "git"
          },
          findings: [
            {
              reviewerRole: "coderabbit",
              findingType: "recurring_issue",
              normalizedSeverity: "medium",
              sourceSeverity: "open",
              title: "Avoid broad exception swallowing",
              detail: "Previous review flagged an overly broad catch block.",
              evidence: JSON.stringify({ detail: "Previous review flagged an overly broad catch block." }),
              filePath: "src/app.ts",
              line: null,
              fieldPath: null,
              suggestions: [],
              codegenInstructions: [],
              source: "quality_knowledge"
            }
          ],
          execution: {
            mode: "quality_knowledge",
            executed: true,
            analysisTarget: "branch",
            attemptedLiveReview: true,
            fallbackReason: "CodeRabbit CLI is not available"
          }
        })
      }
    } as never);

    const result = provider.provide({
      projectId: "project_1",
      waveId: "wave_1",
      storyId: "story_1",
      storyCode: "ITEM-0001-US01",
      filePaths: ["src/app.ts"],
      modules: ["src/app"]
    });

    expect(result.findings).toEqual([
      {
        reviewerRole: "coderabbit",
        findingType: "recurring_issue",
        normalizedSeverity: "medium",
        sourceSeverity: "open",
        title: "Avoid broad exception swallowing",
        detail: "Previous review flagged an overly broad catch block.",
        evidence: JSON.stringify({ detail: "Previous review flagged an overly broad catch block." }),
        filePath: "src/app.ts",
        line: null,
        fieldPath: null
      }
    ]);
    expect(result.providerMetadata).toEqual({
      execution: {
        mode: "quality_knowledge",
        executed: true,
        analysisTarget: "branch",
        attemptedLiveReview: true,
        fallbackReason: "CodeRabbit CLI is not available"
      },
      authSource: "none",
      repositorySource: "git"
    });
  });
});
