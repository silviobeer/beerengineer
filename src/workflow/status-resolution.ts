export type CompactExecutionStoryEntry = {
  latestTestRun: { status: string } | null;
  latestExecution: { status: string } | null;
  latestAppVerificationRun: { status: string } | null;
  latestStoryReviewRun: { status: string } | null;
  blockers: string[];
};

export function resolveCompactExecutionStoryStatus(
  storyEntry: CompactExecutionStoryEntry
): "pending" | "blocked" | "running" | "review_required" | "failed" | "completed" {
  if (storyEntry.latestStoryReviewRun?.status === "passed") {
    return "completed";
  }
  if (storyEntry.latestStoryReviewRun?.status === "review_required") {
    return "review_required";
  }
  if (storyEntry.latestStoryReviewRun?.status === "failed") {
    return "failed";
  }
  if (storyEntry.latestAppVerificationRun?.status === "passed") {
    return "running";
  }
  if (storyEntry.latestAppVerificationRun?.status === "review_required") {
    return "review_required";
  }
  if (storyEntry.latestAppVerificationRun?.status === "failed") {
    return "failed";
  }
  if (storyEntry.latestExecution?.status === "completed") {
    return "completed";
  }
  if (storyEntry.latestExecution?.status === "review_required") {
    return "review_required";
  }
  if (storyEntry.latestExecution?.status === "failed") {
    return "failed";
  }
  if (storyEntry.latestExecution?.status === "running") {
    return "running";
  }
  if (storyEntry.latestTestRun?.status === "completed") {
    return "running";
  }
  if (storyEntry.latestTestRun?.status === "review_required") {
    return "review_required";
  }
  if (storyEntry.latestTestRun?.status === "failed") {
    return "failed";
  }
  if (storyEntry.latestTestRun?.status === "running") {
    return "running";
  }
  if (storyEntry.blockers.length > 0) {
    return "blocked";
  }
  return "pending";
}

export function resolveCompactExecutionStoryPhase(
  storyEntry: CompactExecutionStoryEntry
): "pending" | "blocked" | "test_preparation" | "execution" | "app_verification" | "story_review" {
  if (storyEntry.latestStoryReviewRun) {
    return "story_review";
  }
  if (storyEntry.latestAppVerificationRun) {
    return "app_verification";
  }
  if (storyEntry.latestExecution) {
    return "execution";
  }
  if (storyEntry.latestTestRun) {
    return "test_preparation";
  }
  if (storyEntry.blockers.length > 0) {
    return "blocked";
  }
  return "pending";
}
