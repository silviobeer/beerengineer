export function renderArchitectureSummary(architecture) {
    return {
        summary: architecture.architecture.summary,
        systemShape: architecture.architecture.systemShape,
        constraints: architecture.architecture.constraints,
        relevantComponents: architecture.architecture.components.map(component => ({
            name: component.name,
            responsibility: component.responsibility,
        })),
        decisions: architecture.architecture.decisions ?? [],
    };
}
export function renderPrdDigest(prd, projectId) {
    return {
        projectId,
        storyCount: prd.stories.length,
        acCountByStory: Object.fromEntries(prd.stories.map(story => [story.id, story.acceptanceCriteria.length])),
        criticalAcs: prd.stories.flatMap(story => story.acceptanceCriteria
            .filter(ac => ac.priority === "must")
            .map(ac => ({
            storyId: story.id,
            acId: ac.id,
            text: ac.text,
        }))),
    };
}
export function renderPlanSummary(plan) {
    return {
        waveCount: plan.plan.waves.length,
        waves: plan.plan.waves.map(wave => ({
            id: wave.id,
            kind: wave.kind ?? "feature",
            goal: wave.goal,
            storyIds: wave.kind === "setup"
                ? (wave.tasks ?? []).map(task => task.id)
                : wave.stories.map(story => story.id),
            exitCriteria: wave.exitCriteria,
        })),
        risks: plan.plan.risks,
    };
}
