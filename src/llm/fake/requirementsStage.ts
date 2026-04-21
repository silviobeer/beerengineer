import type { StageAgentAdapter, StageAgentInput, StageAgentResponse } from "../../core/adapters.js"
import type { RequirementsArtifact, RequirementsState } from "../../stages/requirements/types.js"
import type { AcceptanceCriterion } from "../../types/domain.js"

const QUESTIONS = [
  "Welche Funktion ist fuer den ersten Release am wichtigsten?",
  "Welche Aktion muss fuer den Nutzer am schnellsten moeglich sein?",
  "Welche wichtigen Randbedingungen muessen die Stories abdecken?",
]

function ac(
  id: string,
  text: string,
  category: AcceptanceCriterion["category"],
  priority: AcceptanceCriterion["priority"] = "must",
): AcceptanceCriterion {
  return { id, text, category, priority }
}

function buildArtifact(state: RequirementsState): RequirementsArtifact {
  const userMessages = state.history.filter(message => message.role === "user").map(message => message.text)

  return {
    concept: state.concept,
    prd: {
      stories: [
        {
          id: "US-01",
          title: "Nutzer sieht den Kern-Workflow als gefuehrte Eingabemaske",
          acceptanceCriteria: [
            ac("AC-01", "Formular vorhanden", "ui"),
            ac("AC-02", "Pflichtfelder validiert", "validation"),
            ac("AC-03", "Fehler klar sichtbar", "error"),
          ],
        },
        {
          id: "US-02",
          title: "Nutzer sieht eine Uebersicht ueber bestehende Eintraege",
          acceptanceCriteria: [
            ac("AC-01", "Liste zeigt alle relevanten Eintraege", "functional"),
            ac(
              "AC-02",
              userMessages[0] ? `Filter beruecksichtigt: ${userMessages[0]}` : "Filter und Sortierung vorhanden",
              "functional",
            ),
            ac("AC-03", "Status jedes Eintrags ist sichtbar", "state"),
          ],
        },
        {
          id: "US-03",
          title: "Nutzer kann einen Eintrag anlegen und speichern",
          acceptanceCriteria: [
            ac("AC-01", "Speichern ist moeglich", "functional"),
            ac(
              "AC-02",
              userMessages[1] ? `Speichern respektiert: ${userMessages[1]}` : "Validierung vor dem Speichern",
              "validation",
            ),
            ac("AC-03", "Bestaetigung nach erfolgreichem Speichern", "ui"),
          ],
        },
      ],
    },
  }
}

export class FakeRequirementsStageAdapter implements StageAgentAdapter<RequirementsState, RequirementsArtifact> {
  async step(input: StageAgentInput<RequirementsState>): Promise<StageAgentResponse<RequirementsArtifact>> {
    const state = input.state

    if (input.kind === "begin") {
      if (state.maxClarifications === 0) {
        return { kind: "artifact", artifact: buildArtifact(state) }
      }
      return { kind: "message", message: QUESTIONS[state.clarificationCount % QUESTIONS.length] }
    }

    if (input.kind === "user-message") {
      state.history.push({ role: "user", text: input.userMessage })
      state.clarificationCount++
      if (state.clarificationCount < state.maxClarifications) {
        return { kind: "message", message: QUESTIONS[state.clarificationCount % QUESTIONS.length] }
      }
      return { kind: "artifact", artifact: buildArtifact(state) }
    }

    state.lastReviewFeedback = input.reviewFeedback
    return {
      kind: "message",
      message: "Welche Story oder welches AC soll ich auf Basis des Feedbacks noch schaerfen?",
    }
  }
}
