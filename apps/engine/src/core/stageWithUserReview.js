import { stagePresent } from "./stagePresentation.js";
import { runStage } from "./stageRuntime.js";
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
export async function runStageWithUserReview(opts) {
    const maxRounds = opts.maxUserReviewRounds ?? 3;
    let pendingRevisionFeedback;
    let userReviewRound = 0;
    let priorState;
    while (true) {
        const revisionFeedback = pendingRevisionFeedback;
        const reviewRound = userReviewRound;
        const definition = {
            stageId: opts.stageId,
            stageAgentLabel: opts.stageAgentLabel,
            reviewerLabel: opts.reviewerLabel,
            workspaceId: opts.workspaceId,
            workspaceRoot: opts.workspaceRoot,
            runId: reviewRound === 0 ? opts.baseRunId : `${opts.baseRunId}-rev${reviewRound}`,
            createInitialState: () => {
                if (priorState) {
                    return {
                        ...priorState,
                        pendingRevisionFeedback: revisionFeedback,
                        userReviewRound: reviewRound,
                        clarificationCount: priorState.maxClarifications,
                    };
                }
                return opts.buildFreshState({ revisionFeedback, reviewRound });
            },
            stageAgent: opts.stageAgent,
            reviewer: opts.reviewer,
            askUser: opts.askUser,
            persistArtifacts: opts.persistArtifacts,
            async onApproved(artifact, run) {
                priorState = run.state;
                return artifact;
            },
            maxReviews: opts.maxReviews,
        };
        const { result: artifact, run } = await runStage(definition);
        const userReply = (await opts.askUser(opts.buildGatePrompt({ artifact, run }))).trim();
        if (/^approve$/i.test(userReply)) {
            return await opts.onUserApprove({ artifact, run });
        }
        if (/^revise:/i.test(userReply)) {
            userReviewRound++;
            if (userReviewRound > maxRounds) {
                throw new Error(`${opts.stageId}: post-artifact review cap reached (${maxRounds} rounds). ` +
                    "Approve the artifact or restart the stage with updated references.");
            }
            pendingRevisionFeedback = userReply.replace(/^revise:\s*/i, "").trim();
            stagePresent.step(`User revision round ${userReviewRound}: ${pendingRevisionFeedback}`);
            continue;
        }
        stagePresent.warn(`Unrecognised reply "${userReply}" — treating as approve.`);
        return await opts.onUserApprove({ artifact, run });
    }
}
