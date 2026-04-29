import { NON_INTERACTIVE_NO_ANSWER_SENTINEL } from "./constants.js"
import { stagePresent } from "./stagePresentation.js"
import { runStage, type StageArtifactContent, type StageDefinition, type StageRun } from "./stageRuntime.js"
import type { ReviewAgentAdapter, StageAgentAdapter } from "./adapters.js"

/**
 * Every design-prep stage state (visual-companion, frontend-design) that uses a
 * post-artifact user review gate shares this shape. Keeping the constraint
 * explicit lets the helper below preserve the right fields across revise rounds
 * without knowing the stage-specific state otherwise.
 */
export interface RevisableState {
  history: unknown
  clarificationCount: number
  maxClarifications: number
  pendingRevisionFeedback?: string
  userReviewRound: number
}

export type UserReviewGateOptions<S extends RevisableState, A, R> = {
  stageId: string
  stageAgentLabel: string
  reviewerLabel: string
  workspaceId: string
  workspaceRoot: string
  baseRunId: string
  stageAgent: StageAgentAdapter<S, A>
  reviewer: ReviewAgentAdapter<S, A>
  askUser(prompt: string): Promise<string>
  buildFreshState(ctx: { revisionFeedback: string | undefined; reviewRound: number }): S
  persistArtifacts(run: StageRun<S, A>, artifact: A): Promise<StageArtifactContent[]>
  buildGatePrompt(ctx: { artifact: A; run: StageRun<S, A> }): string
  onUserApprove(ctx: { artifact: A; run: StageRun<S, A> }): Promise<R> | R
  maxReviews: number
  maxUserReviewRounds?: number
}

function buildInitialReviewState<S extends RevisableState, A, R>(
  opts: UserReviewGateOptions<S, A, R>,
  priorState: S | undefined,
  revisionFeedback: string | undefined,
  reviewRound: number,
): S {
  if (!priorState) return opts.buildFreshState({ revisionFeedback, reviewRound })
  return {
    ...priorState,
    pendingRevisionFeedback: revisionFeedback,
    userReviewRound: reviewRound,
    clarificationCount: priorState.maxClarifications,
  }
}

async function readUserReviewDecision<S extends RevisableState, A, R>(
  opts: UserReviewGateOptions<S, A, R>,
  artifact: A,
  run: StageRun<S, A>,
): Promise<{ kind: "approved"; value: R } | { kind: "revise"; feedback: string }> {
  while (true) {
    const userReply = (await opts.askUser(opts.buildGatePrompt({ artifact, run }))).trim()

    if (userReply === NON_INTERACTIVE_NO_ANSWER_SENTINEL) {
      throw new Error(
        `Stage "${opts.stageId}" reached the post-artifact review gate in a non-interactive run with no queued answer. ` +
        "Resume the run from the UI or API so the review gate emits a pending_prompt event, " +
        "then answer with \"approve\" or \"revise: <feedback>\".",
      )
    }

    if (/^approve$/i.test(userReply)) {
      return { kind: "approved", value: await opts.onUserApprove({ artifact, run }) }
    }

    if (/^revise:/i.test(userReply)) {
      return { kind: "revise", feedback: userReply.replace(/^revise:\s*/i, "").trim() }
    }

    stagePresent.warn(
      `Unrecognised reply "${userReply}". Reply with exactly "approve" or "revise: <feedback>".`,
    )
  }
}

/**
 * Runs a stage that produces an artifact, then gates it behind a user
 * "approve / revise: <feedback>" prompt. On revise, re-enters runStage with
 * the prior iteration's final state carried forward (history, references,
 * inputMode) so the stage agent does not re-ask questions it already has
 * answers for. `clarificationCount` is forced to `maxClarifications` so the
 * agent skips straight to artifact regeneration with the new feedback.
 *
 * Brainstorm is the template for the inner runStage call; this helper wraps
 * it with the identical user-review-gate that visual-companion and
 * frontend-design both needed.
 */
export async function runStageWithUserReview<S extends RevisableState, A, R>(
  opts: UserReviewGateOptions<S, A, R>,
): Promise<R> {
  const maxRounds = opts.maxUserReviewRounds ?? 3
  let pendingRevisionFeedback: string | undefined
  let userReviewRound = 0
  let priorState: S | undefined

  while (true) {
    const revisionFeedback = pendingRevisionFeedback
    const reviewRound = userReviewRound

    const definition: StageDefinition<S, A, A> = {
      stageId: opts.stageId,
      stageAgentLabel: opts.stageAgentLabel,
      reviewerLabel: opts.reviewerLabel,
      workspaceId: opts.workspaceId,
      workspaceRoot: opts.workspaceRoot,
      runId: reviewRound === 0 ? opts.baseRunId : `${opts.baseRunId}-rev${reviewRound}`,
      createInitialState: () => {
        return buildInitialReviewState(opts, priorState, revisionFeedback, reviewRound)
      },
      stageAgent: opts.stageAgent,
      reviewer: opts.reviewer,
      askUser: opts.askUser,
      persistArtifacts: opts.persistArtifacts,
      async onApproved(artifact, run) {
        priorState = run.state
        return artifact
      },
      maxReviews: opts.maxReviews,
    }

    const { result: artifact, run } = await runStage<S, A, A>(definition)
    const decision = await readUserReviewDecision(opts, artifact, run)
    if (decision.kind === "approved") return decision.value

    userReviewRound++
    if (userReviewRound > maxRounds) {
      throw new Error(
        `${opts.stageId}: post-artifact review cap reached (${maxRounds} rounds). ` +
        "Approve the artifact or restart the stage with updated references.",
      )
    }
    pendingRevisionFeedback = decision.feedback
    stagePresent.step(`User revision round ${userReviewRound}: ${pendingRevisionFeedback}`)
  }
}
