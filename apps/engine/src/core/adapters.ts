export type StageAgentResponse<A> =
  | { kind: "message"; message: string }
  | { kind: "artifact"; artifact: A }

export type StageContext = {
  turnCount: number
  turnLimit?: number
  phase: "begin" | "user-message" | "review-feedback"
  priorFeedback?: Array<{ cycle: number; outcome: string; text: string }>
}

export type ReviewContext = {
  cycle: number
  maxReviews: number
  isFinalCycle: boolean
  priorFeedback: Array<{ cycle: number; outcome: "revise" | "block"; text: string }>
}

export type ReviewAgentResponse =
  | { kind: "pass" }
  | { kind: "revise"; feedback: string }
  | { kind: "block"; reason: string }

export type StageAgentInput<S> =
  | { kind: "begin"; state: S; stageContext?: StageContext }
  | { kind: "user-message"; state: S; userMessage: string; stageContext?: StageContext }
  | { kind: "review-feedback"; state: S; reviewFeedback: string; stageContext?: StageContext }

export interface StageAgentAdapter<S, A> {
  step(input: StageAgentInput<S>): Promise<StageAgentResponse<A>>
  getSessionId?(): string | null
  setSessionId?(sessionId: string | null): void
}

export interface ReviewAgentAdapter<S, A> {
  review(input?: { artifact: A; state: S; reviewContext?: ReviewContext }): Promise<ReviewAgentResponse>
  getSessionId?(): string | null
  setSessionId?(sessionId: string | null): void
}
