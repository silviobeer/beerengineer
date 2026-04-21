import type { StageAgentAdapter, StageAgentInput, StageAgentResponse } from "../../core/adapters.js"
import type { BrainstormArtifact, BrainstormState } from "../../stages/brainstorm/types.js"

const QUESTIONS = [
  "Welches Problem soll das Produkt loesen?",
  "Wer ist die wichtigste Zielgruppe?",
  "Was ist das Kernversprechen in einem Satz?",
  "Welche Einschraenkungen oder Rahmenbedingungen gibt es?",
  "Warum sind bestehende Alternativen nicht gut genug?",
]

function pickQuestion(state: BrainstormState): string {
  return QUESTIONS[state.questionsAsked % QUESTIONS.length]
}

function buildArtifact(state: BrainstormState): BrainstormArtifact {
  const userMessages = state.history
    .filter(message => message.role === "user")
    .map(message => message.text)

  const summary = userMessages.slice(0, 2).join(" / ") || state.item.title

  return {
    concept: {
      summary: `${state.item.title}: ${summary}`,
      problem: userMessages[0] ?? "Noch unscharf beschriebenes Problem.",
      users: [userMessages[1] ?? "Primaere Zielgruppe unklar"],
      constraints: [userMessages[2] ?? "Keine expliziten Constraints genannt"],
    },
    projects: [
      {
        id: "P01",
        name: `${state.item.title} — Core`,
        description: "Kern-Funktionalitaet",
        concept: {
          summary: `${state.item.title}: ${summary}`,
          problem: userMessages[0] ?? "Noch unscharf beschriebenes Problem.",
          users: [userMessages[1] ?? "Primaere Zielgruppe unklar"],
          constraints: [userMessages[2] ?? "Keine expliziten Constraints genannt"],
        },
      },
    ],
  }
}

export class FakeBrainstormStageAdapter implements StageAgentAdapter<BrainstormState, BrainstormArtifact> {
  async step(input: StageAgentInput<BrainstormState>): Promise<StageAgentResponse<BrainstormArtifact>> {
    const state = input.state

    if (input.kind === "begin") {
      return { kind: "message", message: pickQuestion(state) }
    }

    if (input.kind === "user-message") {
      state.history.push({ role: "user", text: input.userMessage })
      state.questionsAsked++
      if (state.questionsAsked < state.targetQuestions) {
        return { kind: "message", message: pickQuestion(state) }
      }
      return { kind: "artifact", artifact: buildArtifact(state) }
    }

    return {
      kind: "message",
      message: "Welche Einschraenkungen oder Rahmenbedingungen gibt es?",
    }
  }
}
