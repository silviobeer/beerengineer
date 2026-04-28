import { branchNameStory } from "../../core/branchNames.js";
import { computeScreenOwners } from "../../core/screenOwners.js";
import { projectDesignGuidance } from "../../core/designPrep.js";
import { renderArchitectureSummary } from "../../render/artifactDigests.js";
function requireField(value, name) {
    if (value === undefined || value === null) {
        throw new Error(`WorkflowContext.${name} is required during execution stage`);
    }
    return value;
}
export function executionStageLlmForStory(llm, worktreeRoot) {
    return llm && worktreeRoot ? { ...llm, workspaceRoot: worktreeRoot } : llm;
}
export function buildStoryExecutionContext(ctx, wave, architecture, testPlan, opts) {
    return {
        kind: opts.kind ?? "feature",
        item: {
            slug: requireField(ctx.itemSlug, "itemSlug"),
            baseBranch: requireField(ctx.baseBranch, "baseBranch"),
        },
        primaryWorkspaceRoot: ctx.workspaceRoot,
        project: { id: ctx.project.id, name: ctx.project.name },
        conceptSummary: ctx.project.concept.summary,
        story: {
            id: testPlan.story.id,
            title: testPlan.story.title,
            acceptanceCriteria: testPlan.acceptanceCriteria,
        },
        setupContract: opts.setupContract,
        architectureSummary: renderArchitectureSummary(architecture),
        wave: {
            id: wave.id,
            number: wave.number,
            goal: wave.goal,
            dependencies: wave.dependencies,
        },
        storyBranch: branchNameStory(ctx, ctx.project.id, wave.number, testPlan.story.id),
        worktreeRoot: opts.worktreeRoot,
        design: opts.kind === "setup" ? ctx.design : projectDesignGuidance(ctx.design),
        mockupHtmlByScreen: resolveStoryMockups(ctx, wave, testPlan.story.id, opts.screenOwners),
        references: opts.references,
        testPlan,
    };
}
function resolveStoryMockups(ctx, wave, storyId, owners) {
    const mockups = ctx.design?.mockupHtmlPerScreen;
    if (!mockups)
        return undefined;
    const plannedStory = wave.stories.find(entry => entry.id === storyId);
    const ownedScreens = (plannedStory?.screenIds ?? [])
        .filter(screenId => owners[screenId] === storyId && mockups[screenId])
        .slice(0, 3);
    if (ownedScreens.length === 0)
        return undefined;
    return Object.fromEntries(ownedScreens.flatMap(screenId => {
        const mockup = mockups[screenId];
        return mockup === undefined ? [] : [[screenId, mockup]];
    }));
}
export function createScreenOwners(ctx) {
    return computeScreenOwners(ctx.prd, ctx.plan, ctx.wireframes);
}
