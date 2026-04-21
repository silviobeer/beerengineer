import { print } from "../print.js"

export async function parallelReview<T>(
  label: string,
  reviewers: Array<() => Promise<T>>,
): Promise<T[]> {
  print.step(label)
  return Promise.all(reviewers.map(reviewer => reviewer()))
}
