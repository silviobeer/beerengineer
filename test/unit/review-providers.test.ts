import { describe, expect, it } from "vitest";

import { CoderabbitReviewProvider } from "../../src/review/providers/coderabbit-review-provider.js";

describe("CoderabbitReviewProvider", () => {
  it("returns no findings when Coderabbit is not configured", () => {
    const provider = new CoderabbitReviewProvider({
      coderabbitService: {
        preflight: () => ({
          config: { configured: false },
          warnings: [],
          errors: [],
          checks: { gitAvailable: true, tokenAvailable: false, repositoryConfigured: false },
          ready: false
        })
      },
      qualityKnowledgeService: {
        listRelevantForStory: () => {
          throw new Error("quality knowledge should not be queried without Coderabbit config");
        }
      }
    } as never);

    expect(
      provider.provide({
        projectId: "project_1",
        waveId: "wave_1",
        storyId: "story_1",
        filePaths: ["src/app.ts"],
        modules: ["src/app"]
      })
    ).toEqual({
      providerId: "coderabbit",
      sourceSystem: "coderabbit",
      findings: []
    });
  });

  it("replays coderabbit quality knowledge when Coderabbit is configured", () => {
    const provider = new CoderabbitReviewProvider({
      coderabbitService: {
        preflight: () => ({
          config: { configured: true },
          warnings: [],
          errors: [],
          checks: { gitAvailable: true, tokenAvailable: true, repositoryConfigured: true },
          ready: true
        })
      },
      qualityKnowledgeService: {
        listRelevantForStory: () => [
          {
            source: "coderabbit",
            kind: "recurring_issue",
            status: "open",
            summary: "Avoid broad exception swallowing",
            evidence: { detail: "Previous review flagged an overly broad catch block." },
            scopeType: "file",
            scopeId: "src/app.ts"
          },
          {
            source: "sonarcloud",
            kind: "recurring_issue",
            status: "open",
            summary: "This should be filtered out",
            evidence: { detail: "Not a coderabbit entry." },
            scopeType: "file",
            scopeId: "src/other.ts"
          }
        ]
      }
    } as never);

    const result = provider.provide({
      projectId: "project_1",
      waveId: "wave_1",
      storyId: "story_1",
      filePaths: ["src/app.ts"],
      modules: ["src/app"]
    });

    expect(result.providerId).toBe("coderabbit");
    expect(result.sourceSystem).toBe("coderabbit");
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
  });
});
