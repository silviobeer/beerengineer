import type { ReviewAgentResponse, StageAgentResponse } from "../../core/adapters.js"

export type HostedStageOutputEnvelope<A> = {
  kind: "artifact" | "message"
  artifact?: A
  message?: string | null
  needsUserInput?: boolean
  userInputQuestion?: string | null
  followUpHint?: string | null
}

export type HostedReviewOutputEnvelope =
  | { kind: "pass" }
  | { kind: "revise"; feedback: string }
  | { kind: "block"; reason: string }

export function mapStageEnvelopeToResponse<A>(envelope: HostedStageOutputEnvelope<A>): StageAgentResponse<A> {
  if (envelope.kind === "artifact") {
    if (envelope.artifact === undefined) {
      throw new Error("Hosted stage response declared kind=artifact without an artifact payload")
    }
    return { kind: "artifact", artifact: envelope.artifact }
  }
  if (typeof envelope.message !== "string" || envelope.message.trim().length === 0) {
    throw new Error("Hosted stage response declared kind=message without a non-empty message")
  }
  return { kind: "message", message: envelope.message }
}

export function mapReviewEnvelopeToResponse(envelope: HostedReviewOutputEnvelope): ReviewAgentResponse {
  switch (envelope.kind) {
    case "pass":
      return { kind: "pass" }
    case "revise":
      if (!envelope.feedback?.trim()) throw new Error("Hosted review response is missing feedback")
      return { kind: "revise", feedback: envelope.feedback }
    case "block":
      if (!envelope.reason?.trim()) throw new Error("Hosted review response is missing a block reason")
      return { kind: "block", reason: envelope.reason }
  }
}
