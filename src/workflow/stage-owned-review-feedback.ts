import type { AdapterRunRequest } from "../adapters/types.js";

export type StageOwnedReviewFeedback = NonNullable<NonNullable<AdapterRunRequest["context"]>["reviewFeedback"]>[number];
