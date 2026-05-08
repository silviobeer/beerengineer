import type { StageAgentAdapter, StageAgentInput, StageAgentResponse } from "../../core/adapters.js"
import type { QaArtifact, QaState, QaVerdict } from "../../stages/qa/types.js"
import type { Finding } from "../../types/review.js"

async function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

function findingsForLoop(loop: number): Finding[] {
  if (loop === 1) {
    return [
      { source: "qa-llm", severity: "medium", message: "Missing loading states in list view" },
      { source: "qa-llm", severity: "low", message: "Inconsistent button labels" },
    ]
  }
  return []
}

function verdictsFor(findings: Finding[]): QaVerdict[] {
  return [
    {
      requirement: "fake-qa-smoke",
      status: findings.length === 0 ? "passed" : "failed",
      evidence: findings.length === 0 ? "Fake QA found no open findings." : "Fake QA produced open findings.",
    },
  ]
}

export class FakeQaStageAdapter implements StageAgentAdapter<QaState, QaArtifact> {
  async step(input: StageAgentInput<QaState>): Promise<StageAgentResponse<QaArtifact>> {
    const state = input.state

    if (input.kind === "begin") {
      await delay(700)
      state.loop = 1
      state.findings = findingsForLoop(state.loop)
      if (state.findings.length === 0) {
        return { kind: "artifact", artifact: { accepted: true, loops: state.loop, verdicts: verdictsFor([]), findings: [] } }
      }
      const findingsSummary = state.findings.map(f => `[${f.source}/${f.severity}] ${f.message}`).join("; ")
      const message = `Reviewer findings: ${findingsSummary}. Fix or accept? [fix/accept]`
      return { kind: "message", message }
    }

    if (input.kind === "user-message") {
      const decision = input.userMessage.trim().toLowerCase()
      if (decision === "accept") {
        return {
          kind: "artifact",
          artifact: { accepted: true, loops: state.loop, verdicts: verdictsFor(state.findings), findings: state.findings },
        }
      }

      await delay(500)
      state.loop++
      state.findings = findingsForLoop(state.loop)
      if (state.findings.length === 0) {
        return { kind: "artifact", artifact: { accepted: false, loops: state.loop, verdicts: verdictsFor([]), findings: [] } }
      }
      const findingsSummary = state.findings.map(f => `[${f.source}/${f.severity}] ${f.message}`).join("; ")
      const message = `Reviewer findings: ${findingsSummary}. Fix or accept? [fix/accept]`
      return { kind: "message", message }
    }

    return {
      kind: "artifact",
      artifact: {
        accepted: state.findings.length === 0,
        loops: state.loop,
        verdicts: verdictsFor(state.findings),
        findings: state.findings,
      },
    }
  }
}
