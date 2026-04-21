export type StageAgentResponse<A> =
  | { kind: "message"; message: string }
  | { kind: "artifact"; artifact: A }

export type ReviewAgentResponse =
  | { kind: "pass" }
  | { kind: "revise"; feedback: string }
  | { kind: "block"; reason: string }

export type StageAgentInput<S> =
  | { kind: "begin"; state: S }
  | { kind: "user-message"; state: S; userMessage: string }
  | { kind: "review-feedback"; state: S; reviewFeedback: string }

export interface StageAgentAdapter<S, A> {
  step(input: StageAgentInput<S>): Promise<StageAgentResponse<A>>
}

export interface ReviewAgentAdapter<S, A> {
  review(input: { artifact: A; state: S }): Promise<ReviewAgentResponse>
}
