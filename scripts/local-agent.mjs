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
      summary: `Local execution worker prepared ${payload.story.code} with role ${payload.workerRole}.`,
      changedFiles: targetFiles,
      testsRun: [
        {
          command: "npm test",
          status: "passed"
        }
      ],
      implementationNotes: [
        `Story ${payload.story.code} executed with curated repo context.`,
        `Wave ${payload.wave.code} remains engine-orchestrated.`
      ],
      blockers: []
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
} else if (payload.workerRole) {
  result = storyExecution(payload);
} else {
  console.error(`Unsupported payload`);
  process.exit(1);
}

process.stdout.write(JSON.stringify(result));
