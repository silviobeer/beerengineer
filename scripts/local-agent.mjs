import { readFileSync } from "node:fs";

const payload = JSON.parse(readFileSync(process.argv[2], "utf8"));

function brainstorming(item) {
  const projectTitle = `${item.title} Core Flow`;
  return {
    markdownArtifacts: [
      {
        kind: "concept",
        content: `# ${item.title} Concept

## Item Code
${item.code}

## Summary
${item.description || "A locally orchestrated MVP item."}

## Proposed Projects
- ${projectTitle}`
      }
    ],
    structuredArtifacts: [
      {
        kind: "projects",
        content: {
          projects: [
            {
              title: projectTitle,
              summary: `Primary delivery track for ${item.title}.`,
              goal: `Deliver the first usable slice for ${item.title}.`
            }
          ]
        }
      }
    ]
  };
}

function requirements(project) {
  return {
    markdownArtifacts: [
      {
        kind: "stories-markdown",
        content: `# Stories for ${project.code} ${project.title}

- Draft stories generated locally for the MVP path.`
      }
    ],
    structuredArtifacts: [
      {
        kind: "stories",
        content: {
          stories: [
            {
              title: `Create ${project.title} workflow record`,
              description: `As an operator I want ${project.title} represented in the engine.`,
              actor: "operator",
              goal: `Manage ${project.title}`,
              benefit: "Traceable workflow execution",
              acceptanceCriteria: [
                "A project record exists",
                "The project can progress through requirements"
              ],
              priority: "high"
            },
            {
              title: `Approve ${project.title} stories`,
              description: `As an operator I want to approve stories before implementation.`,
              actor: "operator",
              goal: "Control quality gates",
              benefit: "Clean transition into implementation",
              acceptanceCriteria: [
                "Stories remain draft until approved",
                "Approved stories unlock implementation"
              ],
              priority: "medium"
            }
          ]
        }
      }
    ]
  };
}

function architecture(project) {
  return {
    markdownArtifacts: [
      {
        kind: "architecture-plan",
        content: `# Architecture Plan for ${project.code} ${project.title}

## Summary
Modular engine-first implementation with reproducible stage runs.`
      }
    ],
    structuredArtifacts: [
      {
        kind: "architecture-plan-data",
        content: {
          summary: `Modular architecture for ${project.title}`,
          decisions: [
            "Keep workflow logic in the domain layer",
            "Store stage runs and artifacts separately"
          ],
          risks: ["Prompt or skill files may drift without snapshots"],
          nextSteps: ["Continue into implementation waves after approval"]
        }
      }
    ]
  };
}

function planning(project, context) {
  const stories = context?.stories ?? [
    { code: `${project.code}-US01`, title: `Create ${project.title} workflow record` },
    { code: `${project.code}-US02`, title: `Approve ${project.title} stories` }
  ];
  const waves = stories.map((story, index) => ({
    waveCode: `W${String(index + 1).padStart(2, "0")}`,
    goal: index === 0 ? "Establish the first executable slice" : `Advance ${story.title}`,
    dependsOn: index === 0 ? [] : [`W${String(index).padStart(2, "0")}`],
    stories: [
      {
        storyCode: story.code,
        dependsOnStoryCodes: index === 0 ? [] : [stories[index - 1].code],
        parallelGroup: null
      }
    ]
  }));

  return {
    markdownArtifacts: [
      {
        kind: "implementation-plan",
        content: `# Implementation Plan for ${project.code} ${project.title}

## Summary
Locally generated wave plan grounded in the approved architecture.

## Waves
${waves.map((wave) => `- ${wave.waveCode}: ${wave.goal}`).join("\n")}`
      }
    ],
    structuredArtifacts: [
      {
        kind: "implementation-plan-data",
        content: {
          summary: `Incremental implementation plan for ${project.title}`,
          waves,
          risks: ["Later implementation may refine story-level sequencing inside each wave"],
          assumptions: ["The approved architecture remains the governing structure for execution"]
        }
      }
    ]
  };
}

function testPreparation(payload) {
  const baseName = payload.story.code.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const testPath = `test/generated/${baseName}.test.ts`;
  return {
    output: {
      summary: `Local test writer prepared a deterministic failing test plan for ${payload.story.code}.`,
      testFiles: [
        {
          path: testPath,
          content: `describe("${payload.story.code}", () => {\n  it("covers the planned acceptance criteria", () => {\n    throw new Error("Generated failing test placeholder");\n  });\n});\n`,
          writeMode: "proposed"
        }
      ],
      testsGenerated: payload.acceptanceCriteria.map((criterion) => ({
        path: testPath,
        intent: `Verify ${criterion.code}: ${criterion.text}`
      })),
      assumptions: [
        "The generated tests are stored as structured output before repo mutation is enforced.",
        "The implementer receives these test targets as the success contract."
      ],
      blockers: []
    }
  };
}

function storyExecution(payload) {
  const targetFiles = [];
  const storyText = `${payload.story.title} ${payload.story.description} ${payload.story.goal}`.toLowerCase();

  if (storyText.includes("workflow")) {
    targetFiles.push("src/workflow/workflow-service.ts");
  }
  if (storyText.includes("cli")) {
    targetFiles.push("src/cli/main.ts");
  }
  if (targetFiles.length === 0) {
    targetFiles.push("src/domain/types.ts");
  }

  return {
    output: {
      summary: `Local execution worker prepared ${payload.story.code} with role ${payload.workerRole} against ${payload.testPreparation.testFiles.length} prewritten test target(s).`,
      changedFiles: targetFiles,
      testsRun: [
        {
          command: `npm test -- ${payload.testPreparation.testFiles[0].path}`,
          status: "passed"
        }
      ],
      implementationNotes: [
        `Story ${payload.story.code} executed with curated repo context.`,
        `Wave ${payload.wave.code} remains engine-orchestrated.`,
        `Implementation used prewritten tests from test preparation ${payload.testPreparation.id}.`
      ],
      blockers: []
    }
  };
}

function ralphVerification(payload) {
  const status = payload.basicVerification.status === "failed"
    ? "failed"
    : payload.basicVerification.status === "review_required"
      ? "review_required"
      : "passed";

  return {
    output: {
      storyCode: payload.story.code,
      overallStatus: status,
      summary:
        status === "passed"
          ? `Ralph verification passed for ${payload.story.code}.`
          : `Ralph verification requires follow-up for ${payload.story.code}.`,
      acceptanceCriteriaResults: payload.acceptanceCriteria.map((criterion) => ({
        acceptanceCriterionId: criterion.id,
        acceptanceCriterionCode: criterion.code,
        status,
        evidence:
          status === "passed"
            ? `Observed in ${payload.implementation.testsRun.map((testRun) => testRun.command).join(", ")} and implementation summary.`
            : `Basic verification status was ${payload.basicVerification.status}; acceptance criterion cannot be considered complete.`,
        notes:
          status === "passed"
            ? `Criterion ${criterion.code} is covered by the stored test and implementation evidence.`
            : `Criterion ${criterion.code} needs follow-up before completion.`
      })),
      blockers: status === "passed" ? [] : payload.implementation.blockers
    }
  };
}

function qaVerification(payload) {
  const findings = [];

  for (const story of payload.stories) {
    let implementation = null;
    try {
      implementation = story.latestExecution.outputSummaryJson
        ? JSON.parse(story.latestExecution.outputSummaryJson)
        : null;
    } catch {
      implementation = null;
    }
    const changedFiles = implementation?.changedFiles ?? [];
    const hasPassingTestEvidence = (implementation?.testsRun ?? []).some((testRun) => testRun.status === "passed");
    if (!changedFiles.some((path) => path.includes("test")) && !hasPassingTestEvidence) {
      findings.push({
        severity: "medium",
        category: "regression",
        title: `No concrete test file mutation recorded for ${story.code}`,
        description: `${story.code} completed without a changed file path under test/, which is a regression risk at project level.`,
        evidence: `Changed files: ${changedFiles.join(", ") || "none recorded"}.`,
        reproSteps: [
          "Inspect the implementation output for the completed story",
          "Confirm that only source files were reported as changed"
        ],
        suggestedFix: "Persist at least one concrete test file mutation or extend the generated execution output to show the committed test artifact.",
        storyCode: story.code,
        acceptanceCriterionCode: null
      });
    }
  }

  const highestSeverity = findings.some((finding) => finding.severity === "critical" || finding.severity === "high")
    ? "failed"
    : findings.length > 0
      ? "review_required"
      : "passed";

  return {
    output: {
      projectCode: payload.project.code,
      overallStatus: highestSeverity,
      summary:
        highestSeverity === "passed"
          ? `QA passed for ${payload.project.code} with no project-level findings.`
          : `QA found ${findings.length} project-level issue(s) for ${payload.project.code}.`,
      findings,
      recommendations:
        findings.length > 0
          ? ["Tighten the implementation output so QA can trace concrete test file mutations per story."]
          : ["No additional QA follow-up is required in the local stub."]
    }
  };
}

function storyReview(payload) {
  const findings = [];
  const changedFiles = payload.implementation.changedFiles ?? [];
  const hasTargetedTests = payload.implementation.testsRun.some((testRun) => testRun.status === "passed");

  if (!hasTargetedTests) {
    findings.push({
      severity: "high",
      category: "correctness",
      title: `No passing test evidence recorded for ${payload.story.code}`,
      description: `${payload.story.code} reached story review without any passing test command in the implementation output.`,
      evidence: `Implementation tests: ${payload.implementation.testsRun.map((testRun) => `${testRun.command}:${testRun.status}`).join(", ") || "none recorded"}.`,
      filePath: changedFiles[0] ?? null,
      line: null,
      suggestedFix: "Ensure the implementation worker records at least one passing test command before story review."
    });
  }

  const overallStatus = findings.some((finding) => finding.severity === "critical" || finding.severity === "high")
    ? "failed"
    : findings.length > 0
      ? "review_required"
      : "passed";

  return {
    output: {
      storyCode: payload.story.code,
      overallStatus,
      summary:
        overallStatus === "passed"
          ? `No technical risks were found in the bounded story review for ${payload.story.code}.`
          : `Story review found ${findings.length} technical issue(s) for ${payload.story.code}.`,
      findings,
      recommendations:
        findings.length > 0
          ? ["Tighten the implementation evidence and re-run the story after addressing the review findings."]
          : ["No additional story-review follow-up is required in the local stub."]
    }
  };
}

let result;
if (payload.stageKey === "brainstorm") {
  result = brainstorming(payload.item);
} else if (payload.stageKey === "requirements") {
  result = requirements(payload.project);
} else if (payload.stageKey === "architecture") {
  result = architecture(payload.project);
} else if (payload.stageKey === "planning") {
  result = planning(payload.project, payload.context);
} else if (payload.workerRole === "test-writer") {
  result = testPreparation(payload);
} else if (payload.workerRole === "ralph-verifier") {
  result = ralphVerification(payload);
} else if (payload.workerRole === "story-reviewer") {
  result = storyReview(payload);
} else if (payload.workerRole === "qa-verifier") {
  result = qaVerification(payload);
} else if (payload.workerRole) {
  result = storyExecution(payload);
} else {
  console.error(`Unsupported payload`);
  process.exit(1);
}

process.stdout.write(JSON.stringify(result));
