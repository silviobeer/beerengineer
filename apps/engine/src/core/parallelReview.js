import { stagePresent } from "./stagePresentation.js";
export async function parallelReview(label, reviewers) {
    stagePresent.step(label);
    return Promise.all(reviewers.map(reviewer => reviewer()));
}
