const QUESTIONS = [
    "What problem should the product solve?",
    "Who is the primary target audience?",
    "What is the core value proposition in one sentence?",
    "What constraints or boundary conditions apply?",
    "Why are existing alternatives not good enough?",
];
function pickQuestion(state) {
    return QUESTIONS[state.questionsAsked % QUESTIONS.length];
}
function buildArtifact(state) {
    const userMessages = state.history
        .filter(message => message.role === "user")
        .map(message => message.text);
    const summary = userMessages.slice(0, 2).join(" / ") || state.item.title;
    return {
        concept: {
            summary: `${state.item.title}: ${summary}`,
            problem: userMessages[0] ?? "Problem still vaguely described.",
            users: [userMessages[1] ?? "Primary target audience unclear"],
            constraints: [userMessages[2] ?? "No explicit constraints provided"],
            hasUi: true,
        },
        projects: [
            {
                id: "P01",
                name: `${state.item.title} — Core`,
                description: "Core functionality",
                hasUi: true,
                concept: {
                    summary: `${state.item.title}: ${summary}`,
                    problem: userMessages[0] ?? "Problem still vaguely described.",
                    users: [userMessages[1] ?? "Primary target audience unclear"],
                    constraints: [userMessages[2] ?? "No explicit constraints provided"],
                },
            },
        ],
    };
}
export class FakeBrainstormStageAdapter {
    async step(input) {
        const state = input.state;
        if (input.kind === "begin") {
            return { kind: "message", message: pickQuestion(state) };
        }
        if (input.kind === "user-message") {
            state.history.push({ role: "user", text: input.userMessage });
            state.questionsAsked++;
            if (state.questionsAsked < state.targetQuestions) {
                return { kind: "message", message: pickQuestion(state) };
            }
            return { kind: "artifact", artifact: buildArtifact(state) };
        }
        return {
            kind: "message",
            message: "What constraints or boundary conditions apply?",
        };
    }
}
