import type { ConversationEntry, OpenPrompt } from "../ConversationPanel";

export const emptyConversation: ConversationEntry[] = [];

export const mixedConversation: ConversationEntry[] = [
  { id: "e1", role: "system", text: "Run started." },
  { id: "e2", role: "engine", type: "message", text: "Beginne mit Analyse." },
  { id: "e3", role: "operator", text: "Bitte fortfahren." },
  { id: "e4", role: "engine", type: "message", text: "Analyse abgeschlossen." },
];

export const unansweredReviewGateEntry: ConversationEntry = {
  id: "rg-1",
  role: "engine",
  type: "review-gate",
  text: "Architecture proposal ready for review.",
  promptId: "p-1",
  actions: [
    { label: "Approve", value: "approve" },
    { label: "Revise", value: "revise" },
  ],
  answered: false,
};

export const answeredReviewGateEntry: ConversationEntry = {
  ...unansweredReviewGateEntry,
  answered: true,
};

export const conversationWithUnansweredReviewGate: ConversationEntry[] = [
  { id: "s1", role: "system", text: "Run started." },
  unansweredReviewGateEntry,
];

export const conversationWithAnsweredReviewGate: ConversationEntry[] = [
  { id: "s1", role: "system", text: "Run started." },
  answeredReviewGateEntry,
];

export const conversationWithMultipleAnsweredReviewGates: ConversationEntry[] = [
  {
    id: "rg-a",
    role: "engine",
    type: "review-gate",
    text: "First gate.",
    promptId: "p-a",
    actions: [
      { label: "Approve", value: "approve" },
      { label: "Revise", value: "revise" },
    ],
    answered: true,
  },
  {
    id: "rg-b",
    role: "engine",
    type: "review-gate",
    text: "Second gate.",
    promptId: "p-b",
    actions: [
      { label: "Approve", value: "approve" },
      { label: "Revise", value: "revise" },
    ],
    answered: true,
  },
];

export const conversationWithEmptyActions: ConversationEntry[] = [
  {
    id: "rg-empty",
    role: "engine",
    type: "review-gate",
    text: "Gate without actions.",
    promptId: "p-empty",
    actions: [],
    answered: false,
  },
];

export const conversationWithPlainEngineMessage: ConversationEntry[] = [
  { id: "e1", role: "engine", type: "message", text: "Just a plain message." },
];

export const reviewGateOpenPrompt: OpenPrompt = {
  type: "review-gate",
  promptId: "p-1",
};

export const clarificationOpenPrompt: OpenPrompt = {
  type: "clarification",
  promptId: "p-2",
};

export const noOpenPrompt: OpenPrompt = null;
