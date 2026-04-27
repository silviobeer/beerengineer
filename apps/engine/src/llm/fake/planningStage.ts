import type { StageAgentAdapter, StageAgentInput, StageAgentResponse } from "../../core/adapters.js"
import type { ImplementationPlanArtifact, PlanningState } from "../../stages/planning/types.js"
import type { Project } from "../../types/domain.js"

function buildArtifact(project: Project, state: PlanningState): ImplementationPlanArtifact {
  return {
    project: {
      id: project.id,
      name: project.name,
    },
    conceptSummary: project.concept.summary,
    architectureSummary: state.architectureSummary.summary,
    plan: {
      summary: "Implementation plan with a setup wave, a core wave, and an expansion wave.",
      assumptions: ["PRD and architecture are stable enough"],
      sequencingNotes: [
        "Setup wave provisions package.json + design-tokens.css before any story runs",
        "Core flow first, then overviews and expansion",
      ],
      dependencies: ["Setup before any feature work", "API foundation before list view", "Persistence before edit features"],
      risks: state.lastReviewFeedback ? [state.lastReviewFeedback] : ["Wave 3 could become too large"],
      waves: [
        // Project-scaffold setup wave — owns package.json, design-tokens.css,
        // .gitignore, tsconfig if applicable, and the canonical src/ + tests/
        // layout. Subsequent feature waves *add to* this scaffold via additive
        // JSON edits only; they must not redefine the same files.
        {
          id: "W1",
          number: 1,
          goal: "Initialize project scaffold (package.json, design-tokens.css, layout)",
          kind: "setup",
          stories: [],
          tasks: [
            {
              id: "scaffold-project",
              title: "Scaffold the project's build/test/runtime baseline",
              sharedFiles: [
                "package.json",
                "package-lock.json",
                "tsconfig.json",
                ".gitignore",
                "apps/ui/app/design-tokens.css",
              ],
              // The fake planner is used by both the in-memory engine
              // tests (no coder, no real worktree) and as a starting
              // point for snapshot-comparable plans. Keep the contract
              // trivially satisfiable: a real planner LLM is expected
              // to populate expectedFiles/requiredScripts based on the
              // architecture's chosen stack. The setup-wave runner
              // verifies the contract; an empty contract passes
              // immediately even when no coder ran.
              contract: {
                expectedFiles: [],
                requiredScripts: [],
                postChecks: [],
              },
            },
          ],
          internallyParallelizable: false,
          dependencies: [],
          exitCriteria: [
            "package.json with `test` script exists",
            "design-tokens.css copied into the worktree",
            "Canonical src/ and tests/ layout in place",
          ],
        },
        {
          id: "W2",
          number: 2,
          goal: "Deliver core workflow",
          kind: "feature",
          stories: state.prd.stories.slice(0, 1).map(story => ({
            id: story.id,
            title: story.title,
            // Per-story file ownership — declared so the planner
            // post-validator can prove story-pair disjointness.
            sharedFiles: [`apps/engine/stories/${story.id}.ts`],
          })),
          internallyParallelizable: false,
          dependencies: ["W1"],
          exitCriteria: ["Core workflow works"],
        },
        {
          id: "W3",
          number: 3,
          goal: "Finish overview and edit features",
          kind: "feature",
          stories: state.prd.stories.slice(1).map(story => ({
            id: story.id,
            title: story.title,
            sharedFiles: [`apps/engine/stories/${story.id}.ts`],
          })),
          internallyParallelizable: true,
          dependencies: ["W2"],
          exitCriteria: ["Lists and editing work"],
        },
      ],
    },
  }
}

export class FakePlanningStageAdapter implements StageAgentAdapter<PlanningState, ImplementationPlanArtifact> {
  constructor(private readonly project: Project) {}

  async step(input: StageAgentInput<PlanningState>): Promise<StageAgentResponse<ImplementationPlanArtifact>> {
    if (input.kind === "user-message") {
      throw new Error("Planning stage does not accept user messages")
    }
    if (input.kind === "review-feedback") {
      input.state.lastReviewFeedback = input.reviewFeedback
      input.state.revisionCount++
    }
    return { kind: "artifact", artifact: buildArtifact(this.project, input.state) }
  }
}
