async function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}
function findingsForLoop(loop) {
    if (loop === 1) {
        return [
            { source: "qa-llm", severity: "medium", message: "Missing loading states in list view" },
            { source: "qa-llm", severity: "low", message: "Inconsistent button labels" },
        ];
    }
    return [];
}
export class FakeQaStageAdapter {
    async step(input) {
        const state = input.state;
        if (input.kind === "begin") {
            await delay(700);
            state.loop = 1;
            state.findings = findingsForLoop(state.loop);
            if (state.findings.length === 0) {
                return { kind: "artifact", artifact: { accepted: true, loops: state.loop, findings: [] } };
            }
            const findingsSummary = state.findings.map(f => `[${f.source}/${f.severity}] ${f.message}`).join("; ");
            const message = `Reviewer findings: ${findingsSummary}. Fix or accept? [fix/accept]`;
            return { kind: "message", message };
        }
        if (input.kind === "user-message") {
            const decision = input.userMessage.trim().toLowerCase();
            if (decision === "accept") {
                return {
                    kind: "artifact",
                    artifact: { accepted: true, loops: state.loop, findings: state.findings },
                };
            }
            await delay(500);
            state.loop++;
            state.findings = findingsForLoop(state.loop);
            if (state.findings.length === 0) {
                return { kind: "artifact", artifact: { accepted: false, loops: state.loop, findings: [] } };
            }
            const findingsSummary = state.findings.map(f => `[${f.source}/${f.severity}] ${f.message}`).join("; ");
            const message = `Reviewer findings: ${findingsSummary}. Fix or accept? [fix/accept]`;
            return { kind: "message", message };
        }
        return {
            kind: "artifact",
            artifact: { accepted: state.findings.length === 0, loops: state.loop, findings: state.findings },
        };
    }
}
