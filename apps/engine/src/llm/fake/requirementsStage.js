const QUESTIONS = [
    "Which feature is most important for the first release?",
    "Which action must be fastest for the user?",
    "Which important boundary conditions must the stories cover?",
];
function ac(id, text, category, priority = "must") {
    return { id, text, category, priority };
}
function buildArtifact(state) {
    const userMessages = state.history.filter(message => message.role === "user").map(message => message.text);
    return {
        concept: state.concept,
        prd: {
            stories: [
                {
                    id: "US-01",
                    title: "User sees the core workflow as a guided input form",
                    acceptanceCriteria: [
                        ac("AC-01", "Form is present", "ui"),
                        ac("AC-02", "Required fields validated", "validation"),
                        ac("AC-03", "Errors clearly visible", "error"),
                    ],
                },
                {
                    id: "US-02",
                    title: "User sees an overview of existing entries",
                    acceptanceCriteria: [
                        ac("AC-01", "List shows all relevant entries", "functional"),
                        ac("AC-02", userMessages[0] ? `Filter considers: ${userMessages[0]}` : "Filter and sorting available", "functional"),
                        ac("AC-03", "Status of each entry is visible", "state"),
                    ],
                },
                {
                    id: "US-03",
                    title: "User can create and save an entry",
                    acceptanceCriteria: [
                        ac("AC-01", "Saving is possible", "functional"),
                        ac("AC-02", userMessages[1] ? `Save respects: ${userMessages[1]}` : "Validation before save", "validation"),
                        ac("AC-03", "Confirmation after successful save", "ui"),
                    ],
                },
            ],
        },
    };
}
export class FakeRequirementsStageAdapter {
    async step(input) {
        const state = input.state;
        if (input.kind === "begin") {
            if (state.maxClarifications === 0) {
                return { kind: "artifact", artifact: buildArtifact(state) };
            }
            return { kind: "message", message: QUESTIONS[state.clarificationCount % QUESTIONS.length] };
        }
        if (input.kind === "user-message") {
            state.history.push({ role: "user", text: input.userMessage });
            state.clarificationCount++;
            if (state.clarificationCount < state.maxClarifications) {
                return { kind: "message", message: QUESTIONS[state.clarificationCount % QUESTIONS.length] };
            }
            return { kind: "artifact", artifact: buildArtifact(state) };
        }
        state.lastReviewFeedback = input.reviewFeedback;
        return {
            kind: "message",
            message: "Which story or AC should I sharpen based on the feedback?",
        };
    }
}
