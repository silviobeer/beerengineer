export function renderPrdMarkdown(artifact) {
    return [
        "# PRD",
        "",
        "## Concept Summary",
        artifact.concept.summary,
        "",
        "## User Stories",
        ...artifact.prd.stories.flatMap(story => [
            `### ${story.id} ${story.title}`,
            ...story.acceptanceCriteria.map(ac => `- ${ac.id} [${ac.priority}/${ac.category}] ${ac.text}`),
            "",
        ]),
    ].join("\n");
}
