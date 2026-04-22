import { stagePresent } from "./stagePresentation.js"

export async function parallelReview<T>(
  label: string,
  reviewers: Array<() => Promise<T>>,
): Promise<T[]> {
  stagePresent.step(label)
  return Promise.all(reviewers.map(reviewer => reviewer()))
}
