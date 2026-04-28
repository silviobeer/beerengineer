const CLARIFICATION_QUESTIONS = [
    "Do you already have wireframes or mockups you'd like to reference?",
    "Which screens are highest priority — dashboard, settings, or something else?",
    "Any accessibility or responsive-breakpoint constraints we should plan for?",
];
function pickQuestion(state) {
    return CLARIFICATION_QUESTIONS[state.clarificationCount % CLARIFICATION_QUESTIONS.length];
}
function buildScreenHtml(screenId, screenName, purpose) {
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${screenName} — Wireframe</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: monospace; background: #f5f5f5; padding: 20px; }
      .frame { border: 2px solid #333; background: white; max-width: 900px; margin: 0 auto; }
      .box { border: 1px dashed #999; padding: 8px; margin: 4px; background: #fafafa; }
      .label { font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 0.08em; }
      .placeholder { background: #eee; padding: 12px; text-align: center; color: #999; }
      .row { display: flex; gap: 4px; }
      .col { flex: 1; }
      h3 { padding: 8px; background: #333; color: white; font-size: 14px; letter-spacing: 0.08em; }
    </style>
  </head>
  <body>
    <div class="frame">
      <h3>${screenName.toUpperCase()}</h3>
      <div class="box">
        <span class="label">purpose</span>
        <p class="placeholder">[ ${purpose} ]</p>
      </div>
      <div class="box">
        <span class="label">screen-id: ${screenId}</span>
        <div class="row">
          <div class="col box"><p class="placeholder">[ Region: Header ]</p></div>
        </div>
        <div class="row">
          <div class="col box"><p class="placeholder">[ Region: Main Content ]</p></div>
          <div class="col box"><p class="placeholder">[ Region: Sidebar ]</p></div>
        </div>
        <div class="row">
          <div class="col box"><p class="placeholder">[ Region: Footer ]</p></div>
        </div>
      </div>
      <div class="box">
        <span class="label">states</span>
        <div class="row">
          <div class="col box"><p class="placeholder">[ Normal ]</p></div>
          <div class="col box"><p class="placeholder">[ Empty ]</p></div>
          <div class="col box"><p class="placeholder">[ Loading ]</p></div>
        </div>
      </div>
    </div>
  </body>
</html>`;
}
function buildArtifact(state) {
    const uiProjects = state.input.projects.filter(project => project.hasUi);
    const screens = uiProjects.map((project, index) => ({
        id: `screen-${index + 1}`,
        name: `${project.name} Workspace`,
        purpose: `Primary screen for ${project.name}`,
        projectIds: [project.id],
        layout: {
            kind: index % 2 === 0 ? "sidebar-main" : "single-column",
            regions: [
                { id: "header", label: "Header" },
                { id: "main", label: "Main" },
                { id: "aside", label: "Aside" },
            ],
        },
        elements: [
            { id: "heading", region: "header", kind: "heading", label: `${project.name} title` },
            { id: "summary", region: "main", kind: "card", label: project.concept.summary },
            { id: "cta", region: "main", kind: "button", label: "Primary action" },
            { id: "support", region: "aside", kind: "list", label: "Secondary tools" },
        ],
    }));
    const wireframeHtmlPerScreen = {};
    for (const screen of screens) {
        wireframeHtmlPerScreen[screen.id] = buildScreenHtml(screen.id, screen.name, screen.purpose);
    }
    return {
        screens,
        navigation: {
            entryPoints: screens.map(screen => ({ screenId: screen.id, projectId: screen.projectIds[0] ?? "unknown" })),
            flows: screens.slice(1).map((screen, index) => ({
                id: `flow-${index + 1}`,
                from: screens[index].id,
                to: screen.id,
                trigger: "Continue",
                projectIds: [screens[index].projectIds[0] ?? "unknown", screen.projectIds[0] ?? "unknown"],
            })),
        },
        inputMode: state.inputMode,
        conceptAmendments: [],
        wireframeHtmlPerScreen,
    };
}
export class FakeVisualCompanionStageAdapter {
    async step(input) {
        const state = input.state;
        if (input.kind === "begin") {
            // If a revision feedback is pending from the user review gate, acknowledge
            // and go straight to a new artifact on the next user-message. For begin,
            // we still ask the first clarification question but include the feedback
            // context in the message so the real LLM adapter can see it too.
            if (state.pendingRevisionFeedback) {
                return {
                    kind: "message",
                    message: `Noted: "${state.pendingRevisionFeedback}". Let me address that — ${pickQuestion(state)}`,
                };
            }
            return { kind: "message", message: pickQuestion(state) };
        }
        if (input.kind === "user-message") {
            const reply = String(input.userMessage ?? "").trim();
            state.history.push({ role: "user", text: reply });
            state.clarificationCount++;
            // Ask follow-up questions until we reach maxClarifications
            if (state.clarificationCount < state.maxClarifications) {
                return { kind: "message", message: pickQuestion(state) };
            }
            // Enough context — produce the artifact
            state.inputMode = /^no\b/i.test(state.history[0]?.text ?? "") || state.history.length === 0
                ? "none"
                : "references";
            return { kind: "artifact", artifact: buildArtifact(state) };
        }
        // review-feedback: LLM reviewer asked for a revision — produce updated artifact
        if (input.kind === "review-feedback") {
            return { kind: "artifact", artifact: buildArtifact(state) };
        }
        return { kind: "artifact", artifact: buildArtifact(state) };
    }
}
