import { readFileSync } from "node:fs";

const payload = JSON.parse(readFileSync(process.argv[2], "utf8"));

function normalizeEntries(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = `${value}`.replace(/\s+/g, " ").trim();
    const dedupeKey = normalized.toLowerCase();
    if (!normalized || seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    result.push(normalized);
  }
  return result;
}

function splitEntries(value) {
  return normalizeEntries(`${value}`.split(/\n|;|,/g));
}

function parseLabeledBrainstormMessage(message) {
  const result = {
    targetUsers: [],
    useCases: [],
    constraints: [],
    nonGoals: [],
    risks: [],
    openQuestions: [],
    candidateDirections: [],
    assumptions: [],
    unlabeled: []
  };
  const lines = `${message}`
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean);

  for (const line of lines) {
    const match = line.match(/^([a-z ]+):\s*(.+)$/i);
    if (!match) {
      result.unlabeled.push(line);
      continue;
    }
    const label = match[1].trim().toLowerCase();
    const value = match[2].trim();
    if (!value) {
      continue;
    }
    if (label === "problem") {
      result.problem = value;
      continue;
    }
    if (label === "outcome" || label === "core outcome" || label === "goal") {
      result.coreOutcome = value;
      continue;
    }
    if (label === "user" || label === "users" || label === "target user" || label === "target users" || label === "actor") {
      result.targetUsers.push(...splitEntries(value));
      continue;
    }
    if (label === "use case" || label === "use cases") {
      result.useCases.push(...splitEntries(value));
      continue;
    }
    if (label === "constraint" || label === "constraints") {
      result.constraints.push(...splitEntries(value));
      continue;
    }
    if (label === "non-goal" || label === "non-goals") {
      result.nonGoals.push(...splitEntries(value));
      continue;
    }
    if (label === "risk" || label === "risks") {
      result.risks.push(...splitEntries(value));
      continue;
    }
    if (label === "question" || label === "questions" || label === "open question" || label === "open questions") {
      result.openQuestions.push(...splitEntries(value));
      continue;
    }
    if (label === "direction" || label === "directions" || label === "candidate direction" || label === "candidate directions") {
      result.candidateDirections.push(...splitEntries(value));
      continue;
    }
    if (label === "recommended direction" || label === "recommendation") {
      result.recommendedDirection = value;
      continue;
    }
    if (label === "assumption" || label === "assumptions") {
      result.assumptions.push(...splitEntries(value));
      continue;
    }
    if (label === "scope notes" || label === "scope") {
      result.scopeNotes = value;
      continue;
    }
    result.unlabeled.push(line);
  }
  return result;
}

function brainstormChat(payload) {
  const parsed = parseLabeledBrainstormMessage(payload.userMessage);
  const draftPatch = {};
  if (parsed.problem !== undefined) {
    draftPatch.problem = parsed.problem;
  }
  if (parsed.coreOutcome !== undefined) {
    draftPatch.coreOutcome = parsed.coreOutcome;
  }
  if (parsed.targetUsers.length > 0) {
    draftPatch.targetUsers = normalizeEntries([...payload.draft.targetUsers, ...parsed.targetUsers]);
  }
  if (parsed.useCases.length > 0) {
    draftPatch.useCases = normalizeEntries([...payload.draft.useCases, ...parsed.useCases]);
  }
  if (parsed.constraints.length > 0) {
    draftPatch.constraints = normalizeEntries([...payload.draft.constraints, ...parsed.constraints]);
  }
  if (parsed.nonGoals.length > 0) {
    draftPatch.nonGoals = normalizeEntries([...payload.draft.nonGoals, ...parsed.nonGoals]);
  }
  if (parsed.risks.length > 0) {
    draftPatch.risks = normalizeEntries([...payload.draft.risks, ...parsed.risks]);
  }
  if (parsed.openQuestions.length > 0) {
    draftPatch.openQuestions = normalizeEntries([...payload.draft.openQuestions, ...parsed.openQuestions]);
  }
  if (parsed.candidateDirections.length > 0) {
    draftPatch.candidateDirections = normalizeEntries([...payload.draft.candidateDirections, ...parsed.candidateDirections]);
  }
  if (parsed.assumptions.length > 0) {
    draftPatch.assumptions = normalizeEntries([...payload.draft.assumptions, ...parsed.assumptions]);
  }
  if (parsed.recommendedDirection !== undefined) {
    draftPatch.recommendedDirection = parsed.recommendedDirection;
  } else if (parsed.candidateDirections.length > 0 && !payload.draft.recommendedDirection) {
    draftPatch.recommendedDirection = parsed.candidateDirections[0];
  }
  if (parsed.scopeNotes !== undefined) {
    draftPatch.scopeNotes = parsed.scopeNotes;
  } else if (parsed.unlabeled.length > 0) {
    const previousNotes = payload.draft.scopeNotes ? [payload.draft.scopeNotes] : [];
    draftPatch.scopeNotes = normalizeEntries([...previousNotes, ...parsed.unlabeled]).join("\n");
  }

  const needsStructuredFollowUp = Object.keys(draftPatch).length === 0;
  return {
    output: {
      assistantMessage: needsStructuredFollowUp
        ? "I could not safely extract a structured brainstorm change. Use labeled fields or `brainstorm:draft:update` for precise edits."
        : `Captured brainstorm updates for ${payload.item.code}. Review the draft and continue refining or promote when ready.`,
      draftPatch,
      needsStructuredFollowUp,
      followUpHint: needsStructuredFollowUp
        ? "Use labels like `problem:`, `users:`, `use cases:` or switch to `brainstorm:draft:update`."
        : null
    }
  };
}

function messageIncludesPositiveSignal(message, signal) {
  const escapedSignal = signal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const negativePrefixes = ["do not", "don't", "dont", "no", "not", "never", "avoid", "skip"];
  if (negativePrefixes.some((prefix) => new RegExp(`\\b${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+${escapedSignal}\\b`).test(message))) {
    return false;
  }
  return new RegExp(`\\b${escapedSignal}\\b`).test(message);
}

function storyReviewChat(payload) {
  const normalized = payload.userMessage.toLowerCase();
  const revisionSignals = ["needs revision", "need revision", "revise", "revision", "change", "fix", "ueberarbeiten"];
  const rejectSignals = ["reject", "rejected", "ablehnen"];
  const approveSignals = ["approve", "approved", "looks good", "ok", "passt", "freigeben"];
  const severitySignals = [
    { severity: "critical", keywords: ["critical"] },
    { severity: "high", keywords: ["high"] },
    { severity: "medium", keywords: ["medium"] },
    { severity: "low", keywords: ["low"] }
  ];
  const status = rejectSignals.some((signal) => messageIncludesPositiveSignal(normalized, signal))
    ? "rejected"
    : revisionSignals.some((signal) => messageIncludesPositiveSignal(normalized, signal))
      ? "needs_revision"
      : approveSignals.some((signal) => messageIncludesPositiveSignal(normalized, signal))
        ? "accepted"
        : null;
  const severity = severitySignals.find((candidate) => candidate.keywords.some((keyword) => normalized.includes(keyword)))?.severity ?? null;
  const matchedStories = payload.stories.filter(
    (story) => normalized.includes(story.code.toLowerCase()) || normalized.includes(story.title.toLowerCase())
  );
  const entryUpdates = status
    ? matchedStories.map((story) => ({
        entryId: story.entryId,
        status,
        summary:
          status === "accepted"
            ? "Accepted from interactive review chat"
            : status === "needs_revision"
              ? "Revision requested from interactive review chat"
              : "Rejected from interactive review chat",
        changeRequest: status === "accepted" ? null : payload.userMessage,
        rationale: null,
        severity
      }))
    : [];
  const needsStructuredFollowUp = entryUpdates.length === 0;
  return {
    output: {
      assistantMessage: needsStructuredFollowUp
        ? `I could not safely map that feedback to a specific story in ${payload.project.code}. Use the story code/title or switch to \`review:entry:update\` / \`review:story:edit\`.`
        : `Captured ${entryUpdates.length} structured review update(s) for ${payload.project.code}.`,
      entryUpdates,
      needsStructuredFollowUp,
      followUpHint: needsStructuredFollowUp ? "Reference a specific story code or use the structured review commands." : null,
      recommendedResolution: null
    }
  };
}

function workspaceSetupAssist(payload) {
  const normalizedMessage = `${payload.userMessage}`.trim().toLowerCase();
  const plan = {
    ...payload.currentPlan,
    generatedAt: Date.now()
  };
  const rationale = [];
  const warnings = [];

  if (normalizedMessage.includes("brownfield") || normalizedMessage.includes("existing project")) {
    plan.mode = "brownfield";
    plan.scaffoldProjectFiles = false;
    rationale.push("The request points to an existing project, so starter scaffold files stay disabled.");
  }

  if (normalizedMessage.includes("greenfield") || normalizedMessage.includes("new project")) {
    plan.mode = "greenfield";
    plan.scaffoldProjectFiles = true;
    rationale.push("The request points to a new project, so starter scaffold files stay enabled.");
  }

  if (normalizedMessage.includes("install deps") || normalizedMessage.includes("install dependencies")) {
    plan.installDeps = true;
    rationale.push("The user explicitly asked to install dependencies.");
  }

  if (normalizedMessage.includes("no sonar") || normalizedMessage.includes("without sonar")) {
    plan.withSonar = false;
    rationale.push("The user explicitly disabled Sonar bootstrap.");
  }

  if (normalizedMessage.includes("no coderabbit") || normalizedMessage.includes("without coderabbit")) {
    plan.withCoderabbit = false;
    rationale.push("The user explicitly disabled CodeRabbit bootstrap.");
  }

  if (payload.doctor.status === "blocked") {
    warnings.push("The doctor report is blocked. Resolve the blocking setup issues before executing the plan.");
  }

  return {
    output: {
      assistantMessage:
        plan.mode === "brownfield"
          ? `Prepared a brownfield setup plan for ${payload.workspace.key}. Existing project files remain authoritative.`
          : `Prepared a greenfield setup plan for ${payload.workspace.key}. Starter files can be scaffolded deterministically.`,
      plan,
      rationale,
      warnings,
      needsUserInput: false,
      followUpHint: null
    }
  };
}

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

function appVerification(payload) {
  const storyText = `${payload.story.title} ${payload.story.description} ${payload.story.goal}`.toLowerCase();
  const hasConfig = Boolean(payload.projectAppTestContext?.baseUrl);
  const runner = payload.preparedSession?.runner ?? payload.projectAppTestContext?.runnerPreference?.[0] ?? "agent_browser";
  const resolvedStartUrl = payload.preparedSession?.resolvedStartUrl ?? payload.projectAppTestContext?.baseUrl ?? null;

  let overallStatus = "passed";
  let failureSummary = null;
  if (!hasConfig) {
    overallStatus = "failed";
    failureSummary = "App test configuration is missing a baseUrl.";
  } else if (storyText.includes("browser infra fail") || storyText.includes("app infra fail")) {
    overallStatus = "failed";
    failureSummary = `The local browser runner could not prepare ${payload.story.code}.`;
  } else if (storyText.includes("browser fail") || storyText.includes("ui fail") || storyText.includes("app review required")) {
    overallStatus = "review_required";
    failureSummary = `The local browser flow exposed a product issue for ${payload.story.code}.`;
  }

  return {
    output: {
      storyCode: payload.story.code,
      runner,
      overallStatus,
      summary:
        overallStatus === "passed"
          ? `App verification passed for ${payload.story.code}.`
          : overallStatus === "review_required"
            ? `App verification found a product issue for ${payload.story.code}.`
            : `App verification failed to prepare the browser session for ${payload.story.code}.`,
      resolvedStartUrl,
      checks: payload.storyAppVerificationContext.checks.map((check, index) => ({
        id: check.id || `check-${index + 1}`,
        description: check.description,
        status: overallStatus,
        evidence:
          overallStatus === "passed"
            ? `Observed expected product signal at ${resolvedStartUrl ?? payload.projectAppTestContext.baseUrl}.`
            : overallStatus === "review_required"
              ? `The UI flow did not satisfy the expected outcome: ${check.expectedOutcome}.`
              : failureSummary ?? "Browser session preparation failed before the story flow could be executed."
      })),
      artifacts: [
        {
          kind: "report",
          path: `artifacts/app-verification/${payload.story.code.toLowerCase()}.json`,
          label: `${payload.story.code} app verification report`,
          contentType: "application/json"
        }
      ],
      failureSummary
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
    const changedFiles = implementation?.changedFiles ?? story.latestExecution?.changedFiles ?? [];
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
  const changedFiles = payload.implementation?.changedFiles ?? [];
  const testsRun = payload.implementation?.testsRun ?? [];
  const hasTargetedTests = testsRun.some((testRun) => testRun.status === "passed");

  if (!hasTargetedTests) {
    findings.push({
      severity: "high",
      category: "correctness",
      title: `No passing test evidence recorded for ${payload.story.code}`,
      description: `${payload.story.code} reached story review without any passing test command in the implementation output.`,
      evidence: `Implementation tests: ${testsRun.map((testRun) => `${testRun.command}:${testRun.status}`).join(", ") || "none recorded"}.`,
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

function documentationWriter(payload) {
  let qaSummary = null;
  try {
    qaSummary = payload.latestQaRun.summaryJson ? JSON.parse(payload.latestQaRun.summaryJson) : null;
  } catch {
    qaSummary = null;
  }
  const qaOpenFindings = payload.openQaFindings.length;
  const changedAreas = Array.from(
    new Set(payload.stories.flatMap((story) => story.latestExecution.changedFiles ?? []))
  );
  const technicalReviewCounts = payload.stories.flatMap((story) => story.latestStoryReview.findings).reduce(
    (acc, finding) => {
      acc[finding.severity] += finding.status === "open" ? 1 : 0;
      return acc;
    },
    { critical: 0, high: 0, medium: 0, low: 0 }
  );
  const overallStatus = payload.latestQaRun.status === "review_required" ? "review_required" : "completed";
  const reportMarkdown = `# ${payload.project.code} Delivery Report

## Outcome Summary
${payload.project.title} completed through execution, QA, and documentation with status \`${overallStatus}\`.

## Original Scope
${payload.concept?.summary ?? `Deliver the first usable slice for ${payload.project.title}.`}

## Delivered Scope
${payload.stories.map((story) => `- ${story.code}: ${story.title}`).join("\n")}

## Architecture Snapshot
${payload.architecture?.summary ?? "No separate architecture summary was stored."}

## Execution Summary By Wave
${payload.waves.map((wave) => `- ${wave.code}: ${wave.goal} (${wave.storiesDelivered.join(", ")})`).join("\n")}

## Test And Verification Summary
- Ralph passed for ${payload.stories.map((story) => story.code).join(", ")}
- QA status: ${payload.latestQaRun.status}

## Technical Review Summary
- Reviewed stories: ${payload.stories.map((story) => story.code).join(", ")}
- Open technical findings: critical ${technicalReviewCounts.critical}, high ${technicalReviewCounts.high}, medium ${technicalReviewCounts.medium}, low ${technicalReviewCounts.low}

## QA Summary
${qaSummary?.summary ?? `QA found ${qaOpenFindings} open finding(s).`}

## Open Follow-Ups
${qaOpenFindings > 0 ? payload.openQaFindings.map((finding) => `- ${finding.title}`).join("\n") : "- None."}

## Key Changed Areas
${changedAreas.length > 0 ? changedAreas.map((area) => `- ${area}`).join("\n") : "- No changed areas were recorded."}
`;

  return {
    output: {
      projectCode: payload.project.code,
      overallStatus,
      summary:
        overallStatus === "completed"
          ? `Documentation completed for ${payload.project.code}.`
          : `Documentation completed with open follow-ups for ${payload.project.code}.`,
      originalScope: payload.concept?.summary ?? `Deliver the first usable slice for ${payload.project.title}.`,
      deliveredScope: `Delivered ${payload.stories.length} stories across ${payload.waves.length} waves.`,
      architectureSnapshot: payload.architecture?.summary ?? "No architecture summary was stored.",
      waves: payload.waves.map((wave) => ({
        waveCode: wave.code,
        goal: wave.goal,
        storiesDelivered: wave.storiesDelivered
      })),
      storiesDelivered: payload.stories.map((story) => ({
        storyCode: story.code,
        summary: story.latestExecution.summary
      })),
      verificationSummary: {
        ralphPassedStoryCodes: payload.stories.map((story) => story.code),
        storyReviewPassedStoryCodes: payload.stories
          .filter((story) => story.latestStoryReview.status === "passed")
          .map((story) => story.code),
        qaStatus: payload.latestQaRun.status,
        qaOpenFindingCount: qaOpenFindings
      },
      technicalReviewSummary: {
        reviewedStoryCodes: payload.stories.map((story) => story.code),
        openFindingCounts: technicalReviewCounts
      },
      qaSummary: {
        status: payload.latestQaRun.status,
        summary: qaSummary?.summary ?? `QA found ${qaOpenFindings} open finding(s).`,
        openFindings: qaOpenFindings
      },
      openFollowUps:
        qaOpenFindings > 0
          ? payload.openQaFindings.map((finding) => finding.title)
          : ["No open follow-ups remain in the local documentation stub."],
      keyChangedAreas: changedAreas,
      reportMarkdown
    }
  };
}

function planningReview(payload) {
  const findings = [];
  const missingInformation = [];
  const recommendedNextEvidence = [];
  const assumptionsDetected = normalizeEntries(payload.artifact.assumptions ?? []);
  const clarificationAnswers = payload.artifact.clarificationAnswers ?? [];

  const roleLabel =
    payload.reviewerRole === "implementation_reviewer"
      ? "implementation"
      : payload.reviewerRole === "architecture_challenger"
        ? "architecture"
        : payload.reviewerRole === "decision_auditor"
          ? "decision"
          : payload.reviewerRole;

  const hasClarificationFor = (keywords) =>
    clarificationAnswers.some(
      (entry) =>
        entry.answer &&
        keywords.some((keyword) => `${entry.question} ${entry.answer}`.toLowerCase().includes(keyword.toLowerCase()))
    );

  const requireField = (value, label, question, keywords = []) => {
    if ((!value || `${value}`.trim().length === 0) && keywords.length > 0 && hasClarificationFor(keywords)) {
      assumptionsDetected.push(`Clarification answers partially cover missing ${label}.`);
      return;
    }
    if (value && `${value}`.trim().length > 0) {
      return;
    }
    findings.push({
      type: "blocker",
      title: `${label} is missing`,
      detail: `${roleLabel} review cannot validate the artifact without an explicit ${label}.`,
      evidence: null
    });
    missingInformation.push(question);
  };

  requireField(payload.artifact.problem, "problem statement", "What exact user or delivery problem is being solved?", ["problem"]);
  requireField(payload.artifact.goal, "goal", "What concrete outcome defines success for this artifact?", ["goal", "success"]);
  requireField(payload.artifact.proposal, "proposal", "What is the currently preferred approach?", ["proposal", "approach", "direction"]);

  if ((payload.artifact.risks ?? []).length === 0) {
    findings.push({
      type: "major_concern",
      title: "Risks are missing",
      detail: `${roleLabel} review has no explicit risk register to validate tradeoffs or rollout safety.`,
      evidence: null
    });
    recommendedNextEvidence.push("List the main delivery, migration, and operational risks explicitly.");
  }

  if (payload.step === "plan_writing" && (payload.artifact.testPlan ?? []).length === 0 && !hasClarificationFor(["test", "verification"])) {
    findings.push({
      type: "question",
      title: "Test plan is missing",
      detail: "Implementation readiness depends on a credible test path.",
      evidence: null
    });
    missingInformation.push("Which tests or verification steps will prove the plan is complete?");
  }

  if (payload.step === "plan_writing" && (payload.artifact.rolloutPlan ?? []).length === 0 && !hasClarificationFor(["rollout", "deploy", "rollback"])) {
    findings.push({
      type: "question",
      title: "Rollout plan is missing",
      detail: "The plan has no explicit rollout or rollback path.",
      evidence: null
    });
    recommendedNextEvidence.push("Add a rollout and rollback outline for production-facing changes.");
  }

  if (payload.reviewMode === "alternatives" && (payload.artifact.alternatives ?? []).length === 0) {
    findings.push({
      type: "major_concern",
      title: "Alternatives are not documented",
      detail: "The current proposal converged without any explicit alternative analysis.",
      evidence: null
    });
  }

  if ((payload.artifact.openQuestions ?? []).length > 0) {
    findings.push({
      type: "question",
      title: "Open questions remain",
      detail: `The artifact still lists ${payload.artifact.openQuestions.length} unresolved question(s).`,
      evidence: payload.artifact.openQuestions.join("; ")
    });
  }

  if ((payload.artifact.clarificationAnswers ?? []).length > 0) {
    recommendedNextEvidence.push(
      `Incorporate ${payload.artifact.clarificationAnswers.length} clarification answer(s) back into the source artifact.`
    );
  }

  const hasBlocker = findings.some((finding) => finding.type === "blocker");
  const hasQuestion = findings.some((finding) => finding.type === "question");
  const hasMajorConcern = findings.some((finding) => finding.type === "major_concern");

  return {
    output: {
      status: hasBlocker ? "needs_clarification" : hasQuestion ? "needs_clarification" : hasMajorConcern ? "in_review" : "ready",
      readiness: hasBlocker ? "needs_evidence" : hasQuestion ? "needs_evidence" : hasMajorConcern ? "ready_with_assumptions" : "ready",
      summary: hasBlocker
        ? `${roleLabel} review found blocking gaps in the artifact.`
        : hasQuestion || hasMajorConcern
          ? `${roleLabel} review found follow-up work but no hard blocker.`
          : `${roleLabel} review found the artifact ready to proceed.`,
      findings,
      missingInformation: normalizeEntries(missingInformation),
      recommendedNextEvidence: normalizeEntries(recommendedNextEvidence),
      assumptionsDetected
    }
  };
}

let result;
if (payload.interactionType === "brainstorm_chat") {
  result = brainstormChat(payload);
} else if (payload.interactionType === "planning_review") {
  result = planningReview(payload);
} else if (payload.interactionType === "story_review_chat") {
  result = storyReviewChat(payload);
} else if (payload.interactionType === "workspace_setup_assist") {
  result = workspaceSetupAssist(payload);
} else if (payload.stageKey === "brainstorm") {
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
} else if (payload.workerRole === "app-verifier") {
  result = appVerification(payload);
} else if (payload.workerRole === "story-reviewer") {
  result = storyReview(payload);
} else if (payload.workerRole === "qa-verifier") {
  result = qaVerification(payload);
} else if (payload.workerRole === "documentation-writer") {
  result = documentationWriter(payload);
} else if (payload.workerRole) {
  result = storyExecution(payload);
} else {
  console.error(`Unsupported payload`);
  process.exit(1);
}

process.stdout.write(JSON.stringify(result));
