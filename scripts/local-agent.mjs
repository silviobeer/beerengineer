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
} else if (payload.workerRole) {
  result = storyExecution(payload);
} else {
  console.error(`Unsupported payload`);
  process.exit(1);
}

process.stdout.write(JSON.stringify(result));
