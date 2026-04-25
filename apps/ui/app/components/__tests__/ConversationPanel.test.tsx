import { describe, it, expect, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConversationPanel, {
  type ConversationEntry,
  type OpenPrompt,
  type PostAnswerArgs,
} from "../ConversationPanel";
import {
  answeredReviewGateEntry,
  clarificationOpenPrompt,
  conversationWithAnsweredReviewGate,
  conversationWithEmptyActions,
  conversationWithMultipleAnsweredReviewGates,
  conversationWithPlainEngineMessage,
  conversationWithUnansweredReviewGate,
  emptyConversation,
  mixedConversation,
  noOpenPrompt,
  reviewGateOpenPrompt,
  unansweredReviewGateEntry,
} from "./conversationFixtures";

const RUN_ID = "run-123";

type PostAnswerMock = ReturnType<typeof vi.fn<(args: PostAnswerArgs) => Promise<unknown>>>;

function renderPanel(props: {
  entries?: ConversationEntry[];
  openPrompt?: OpenPrompt;
  postAnswer?: PostAnswerMock;
  runId?: string;
}) {
  const postAnswer: PostAnswerMock =
    props.postAnswer ??
    vi.fn<(args: PostAnswerArgs) => Promise<unknown>>().mockResolvedValue({ ok: true });
  const entries = props.entries ?? [];
  const openPrompt = props.openPrompt ?? null;
  const utils = render(
    <ConversationPanel
      runId={props.runId ?? RUN_ID}
      entries={entries}
      openPrompt={openPrompt}
      postAnswer={postAnswer}
    />,
  );
  return { ...utils, postAnswer };
}

describe("ConversationPanel", () => {
  // TC-01
  it("renders system entry with 'S:' label and not other speaker labels", () => {
    const entries: ConversationEntry[] = [
      { id: "s1", role: "system", text: "system message" },
    ];
    renderPanel({ entries, openPrompt: noOpenPrompt });
    const bubble = screen.getByTestId("conversation-bubble");
    expect(bubble).toHaveTextContent("S:");
    expect(bubble).not.toHaveTextContent("You:");
    expect(bubble).not.toHaveTextContent("Beerengineer:");
  });

  // TC-02
  it("renders operator entry with 'You:' label and no other speaker label", () => {
    const entries: ConversationEntry[] = [
      { id: "o1", role: "operator", text: "operator message" },
    ];
    renderPanel({ entries, openPrompt: noOpenPrompt });
    const bubble = screen.getByTestId("conversation-bubble");
    const label = within(bubble).getByTestId("conversation-bubble-label");
    expect(label).toHaveTextContent("You:");
    expect(label).not.toHaveTextContent("S:");
    expect(label).not.toHaveTextContent("Beerengineer:");
  });

  // TC-03
  it("renders engine entry with 'Beerengineer:' label and no other speaker label", () => {
    const entries: ConversationEntry[] = [
      { id: "e1", role: "engine", type: "message", text: "engine message" },
    ];
    renderPanel({ entries, openPrompt: noOpenPrompt });
    const bubble = screen.getByTestId("conversation-bubble");
    const label = within(bubble).getByTestId("conversation-bubble-label");
    expect(label).toHaveTextContent("Beerengineer:");
    expect(label).not.toHaveTextContent("You:");
    // 'Beerengineer:' contains the substring 'B' but not 'S:'
    expect(label.textContent?.includes("S:")).toBe(false);
  });

  // TC-04
  it("renders mixed conversation with three labels in order", () => {
    renderPanel({ entries: mixedConversation, openPrompt: noOpenPrompt });
    const bubbles = screen.getAllByTestId("conversation-bubble");
    expect(bubbles).toHaveLength(4);
    const labels = bubbles.map(
      (b) => within(b).getByTestId("conversation-bubble-label").textContent,
    );
    expect(labels).toEqual(["S:", "Beerengineer:", "You:", "Beerengineer:"]);
  });

  // TC-05
  it("review-gate engine bubble contains exactly the inline action buttons", () => {
    renderPanel({
      entries: conversationWithUnansweredReviewGate,
      openPrompt: reviewGateOpenPrompt,
    });
    const bubbles = screen.getAllByTestId("conversation-bubble");
    const reviewBubble = bubbles.find(
      (b) => b.getAttribute("data-entry-id") === "rg-1",
    );
    expect(reviewBubble).toBeTruthy();
    const buttons = within(reviewBubble!).getAllByRole("button");
    expect(buttons).toHaveLength(2);
    const labels = buttons.map((b) => b.textContent?.trim());
    expect(labels).toEqual(["Approve", "Revise"]);
  });

  // TC-06
  it("non-review-gate engine bubble has no inline action buttons", () => {
    renderPanel({
      entries: conversationWithPlainEngineMessage,
      openPrompt: noOpenPrompt,
    });
    const bubble = screen.getByTestId("conversation-bubble");
    expect(within(bubble).queryByRole("button")).toBeNull();
  });

  // TC-07
  it("clicking review-gate button calls Server Action with promptId and answer", async () => {
    const user = userEvent.setup();
    const postAnswer = vi.fn().mockResolvedValue({ ok: true });
    renderPanel({
      entries: conversationWithUnansweredReviewGate,
      openPrompt: reviewGateOpenPrompt,
      postAnswer,
    });
    const buttons = screen.getAllByRole("button", { name: /Approve|Revise/ });
    const approveBtn = buttons.find((b) => b.textContent?.trim() === "Approve");
    expect(approveBtn).toBeTruthy();
    await user.click(approveBtn!);
    expect(postAnswer).toHaveBeenCalledTimes(1);
    expect(postAnswer).toHaveBeenCalledWith({
      runId: RUN_ID,
      promptId: "p-1",
      answer: "approve",
    } satisfies PostAnswerArgs);
  });

  // TC-08
  it("answered review-gate buttons are non-interactive (absent or disabled)", async () => {
    const user = userEvent.setup();
    const postAnswer = vi.fn().mockResolvedValue({ ok: true });
    renderPanel({
      entries: conversationWithAnsweredReviewGate,
      openPrompt: noOpenPrompt,
      postAnswer,
    });

    const reviewBubble = screen
      .getAllByTestId("conversation-bubble")
      .find((b) => b.getAttribute("data-entry-id") === answeredReviewGateEntry.id);
    expect(reviewBubble).toBeTruthy();

    const buttons = within(reviewBubble!).queryAllByRole("button");
    if (buttons.length > 0) {
      for (const btn of buttons) {
        expect(btn).toBeDisabled();
      }
      await user.click(buttons[0]);
    }
    expect(postAnswer).not.toHaveBeenCalled();
  });

  // TC-09
  it("review-gate open prompt suppresses textarea and Send", () => {
    renderPanel({
      entries: conversationWithUnansweredReviewGate,
      openPrompt: reviewGateOpenPrompt,
    });
    expect(screen.queryByTestId("conversation-textarea")).toBeNull();
    expect(screen.queryByTestId("conversation-send")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  // TC-10
  it("clarification open prompt shows textarea+Send and clarification entry has no inline buttons", () => {
    const entries: ConversationEntry[] = [
      { id: "s1", role: "system", text: "Run started." },
      {
        id: "cp",
        role: "engine",
        type: "message",
        text: "Need clarification: what version?",
      },
    ];
    renderPanel({ entries, openPrompt: clarificationOpenPrompt });
    expect(screen.getByTestId("conversation-textarea")).toBeInTheDocument();
    expect(screen.getByTestId("conversation-send")).toBeInTheDocument();

    const bubbles = screen.getAllByTestId("conversation-bubble");
    const clarificationBubble = bubbles.find(
      (b) => b.getAttribute("data-entry-id") === "cp",
    );
    expect(clarificationBubble).toBeTruthy();
    expect(within(clarificationBubble!).queryByRole("button")).toBeNull();
  });

  // TC-11
  it("Send button is disabled when textarea is empty", () => {
    renderPanel({ entries: emptyConversation, openPrompt: clarificationOpenPrompt });
    const send = screen.getByTestId("conversation-send");
    expect(send).toBeDisabled();
  });

  // TC-12
  it("Send button stays disabled with whitespace-only textarea content", async () => {
    const user = userEvent.setup();
    renderPanel({ entries: emptyConversation, openPrompt: clarificationOpenPrompt });
    const textarea = screen.getByTestId("conversation-textarea") as HTMLTextAreaElement;
    await user.type(textarea, "   \n\t ");
    expect(textarea.value).toBe("   \n\t ");
    const send = screen.getByTestId("conversation-send");
    expect(send).toBeDisabled();
  });

  // TC-13
  it("submitting non-empty textarea invokes Server Action with the entered text", async () => {
    const user = userEvent.setup();
    const postAnswer = vi.fn().mockResolvedValue({ ok: true });
    renderPanel({
      entries: emptyConversation,
      openPrompt: clarificationOpenPrompt,
      postAnswer,
    });
    const textarea = screen.getByTestId("conversation-textarea");
    await user.type(textarea, "Please confirm");
    await user.click(screen.getByTestId("conversation-send"));

    await waitFor(() => expect(postAnswer).toHaveBeenCalledTimes(1));
    expect(postAnswer).toHaveBeenCalledWith({
      runId: RUN_ID,
      promptId: "p-2",
      answer: "Please confirm",
    } satisfies PostAnswerArgs);
  });

  // TC-14
  it("on success, You: bubble appears with submitted text and textarea clears", async () => {
    const user = userEvent.setup();
    const postAnswer = vi.fn().mockResolvedValue({ ok: true });
    renderPanel({
      entries: emptyConversation,
      openPrompt: clarificationOpenPrompt,
      postAnswer,
    });
    const textarea = screen.getByTestId("conversation-textarea") as HTMLTextAreaElement;
    await user.type(textarea, "My answer");
    await user.click(screen.getByTestId("conversation-send"));

    await waitFor(() => {
      const bubbles = screen.getAllByTestId("conversation-bubble");
      const last = bubbles[bubbles.length - 1];
      expect(within(last).getByTestId("conversation-bubble-label")).toHaveTextContent(
        "You:",
      );
      expect(within(last).getByTestId("conversation-bubble-text")).toHaveTextContent(
        "My answer",
      );
    });
    await waitFor(() => expect(textarea.value).toBe(""));
  });

  // TC-15
  it("with no open prompt, textarea and Send are absent or disabled and Server Action is never called", async () => {
    const user = userEvent.setup();
    const postAnswer = vi.fn().mockResolvedValue({ ok: true });
    renderPanel({
      entries: mixedConversation,
      openPrompt: noOpenPrompt,
      postAnswer,
    });
    const textarea = screen.queryByTestId("conversation-textarea");
    const send = screen.queryByTestId("conversation-send");
    if (textarea !== null) expect(textarea).toBeDisabled();
    if (send !== null) expect(send).toBeDisabled();

    // Try to interact: there should be nothing to click.
    if (send !== null) {
      await user.click(send);
    }
    expect(postAnswer).not.toHaveBeenCalled();
  });

  // TC-16
  it("Server Action failure shows visible error and preserves textarea content", async () => {
    const user = userEvent.setup();
    const postAnswer = vi.fn().mockRejectedValue(new Error("network failure"));
    renderPanel({
      entries: emptyConversation,
      openPrompt: clarificationOpenPrompt,
      postAnswer,
    });
    const textarea = screen.getByTestId("conversation-textarea") as HTMLTextAreaElement;
    await user.type(textarea, "Retryable answer");
    await user.click(screen.getByTestId("conversation-send"));

    const errorEl = await screen.findByTestId("conversation-error");
    expect(errorEl).toBeVisible();
    expect(errorEl.textContent?.length ?? 0).toBeGreaterThan(0);
    expect(textarea.value).toBe("Retryable answer");
  });

  // EC-02 — multiple answered review-gate entries each individually inert
  it("renders multiple answered review-gate bubbles all individually inert", async () => {
    const user = userEvent.setup();
    const postAnswer = vi.fn().mockResolvedValue({ ok: true });
    renderPanel({
      entries: conversationWithMultipleAnsweredReviewGates,
      openPrompt: noOpenPrompt,
      postAnswer,
    });
    const bubbles = screen.getAllByTestId("conversation-bubble");
    expect(bubbles).toHaveLength(2);
    for (const bubble of bubbles) {
      const buttons = within(bubble).queryAllByRole("button");
      for (const btn of buttons) {
        expect(btn).toBeDisabled();
        await user.click(btn);
      }
    }
    expect(postAnswer).not.toHaveBeenCalled();
  });

  // EC-03 — review-gate with empty actions array renders without crashing and shows no buttons
  it("review-gate entry with empty actions renders without buttons", () => {
    renderPanel({
      entries: conversationWithEmptyActions,
      openPrompt: reviewGateOpenPrompt,
    });
    const bubble = screen.getByTestId("conversation-bubble");
    expect(within(bubble).queryByRole("button")).toBeNull();
  });

  // EC-04 — Send clicked twice in rapid succession dispatches only one call
  it("rapid double-click on Send dispatches only one Server Action call", async () => {
    const user = userEvent.setup();
    let resolveFn: (value: unknown) => void = () => {};
    const postAnswer = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFn = resolve;
        }),
    );
    renderPanel({
      entries: emptyConversation,
      openPrompt: clarificationOpenPrompt,
      postAnswer,
    });
    const textarea = screen.getByTestId("conversation-textarea");
    await user.type(textarea, "Once");
    const send = screen.getByTestId("conversation-send");
    await user.click(send);
    // Second click while pending: button must be disabled
    expect(send).toBeDisabled();
    await user.click(send);

    resolveFn({ ok: true });
    await waitFor(() => expect(postAnswer).toHaveBeenCalledTimes(1));
  });

  // EC-05 — open clarification with no engine entries still shows textarea+Send
  it("clarification prompt with no engine entries still shows textarea+Send", () => {
    renderPanel({
      entries: emptyConversation,
      openPrompt: clarificationOpenPrompt,
    });
    expect(screen.getByTestId("conversation-textarea")).toBeInTheDocument();
    expect(screen.getByTestId("conversation-send")).toBeInTheDocument();
  });

  // EC-01 reaffirm: pure whitespace, mixed kinds
  it("various whitespace-only inputs all keep Send disabled", async () => {
    const user = userEvent.setup();
    renderPanel({ entries: emptyConversation, openPrompt: clarificationOpenPrompt });
    const textarea = screen.getByTestId("conversation-textarea") as HTMLTextAreaElement;
    const send = screen.getByTestId("conversation-send");
    await user.type(textarea, " ");
    expect(send).toBeDisabled();
    await user.type(textarea, "\t");
    expect(send).toBeDisabled();
    await user.type(textarea, "\n");
    expect(send).toBeDisabled();
  });
});
