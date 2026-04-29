import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatPanel } from "@/components/ChatPanel";
import { ItemDetailChatLoader } from "@/components/ItemDetailChatLoader";
import {
  itemWithActiveRunAndConversation,
  itemWithActiveRunEmptyConversation,
  itemWithDistinctRunId,
  itemWithNoActiveRun,
} from "@/lib/fixtures";
import type { ConversationEntry } from "@/lib/types";

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

interface FetchCall {
  url: string;
  init?: FetchInit;
}

function urlOf(input: FetchInput): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (input instanceof Request) return input.url;
  return String(input);
}

function jsonResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface MockFetchOptions {
  defaultStatus?: number;
  defaultBody?: unknown;
  pending?: boolean;
  reject?: Error;
  byUrl?: Array<{
    match: (url: string) => boolean;
    status?: number;
    body?: unknown;
    pending?: boolean;
    reject?: Error;
  }>;
}

function installMockFetch(opts: MockFetchOptions = {}): {
  fetchSpy: ReturnType<typeof vi.fn>;
  calls: FetchCall[];
  resolvePending: () => void;
} {
  const calls: FetchCall[] = [];
  let pendingResolve: (value: Response) => void = () => {};
  const fetchSpy = vi.fn(async (input: FetchInput, init?: FetchInit) => {
    const url = urlOf(input);
    calls.push({ url, init });
    if (opts.byUrl) {
      const match = opts.byUrl.find((rule) => rule.match(url));
      if (match) {
        if (match.reject) throw match.reject;
        if (match.pending) {
          return new Promise<Response>((resolve) => {
            pendingResolve = resolve;
          });
        }
        return jsonResponse(match.status ?? 200, match.body ?? {});
      }
    }
    if (opts.reject) throw opts.reject;
    if (opts.pending) {
      return new Promise<Response>((resolve) => {
        pendingResolve = resolve;
      });
    }
    return jsonResponse(opts.defaultStatus ?? 200, opts.defaultBody ?? {});
  });
  (globalThis as unknown as { fetch: typeof fetch }).fetch =
    fetchSpy as unknown as typeof fetch;
  return {
    fetchSpy,
    calls,
    resolvePending: () => pendingResolve(jsonResponse(200)),
  };
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ChatPanel rendering (US-5)", () => {
  it("TC-5.1a: renders newest entries first", () => {
    const item = itemWithActiveRunAndConversation();
    render(
      <ChatPanel activeRunId={item.activeRunId} conversation={item.conversation} />
    );
    const history = screen.getByTestId("chat-history");
    const text = history.textContent ?? "";
    const positions = ["alpha", "beta", "gamma"].map((token) => text.indexOf(token));
    expect(positions[0]).toBeGreaterThanOrEqual(0);
    expect(positions[2]).toBeLessThan(positions[1]);
    expect(positions[1]).toBeLessThan(positions[0]);
  });

  it("TC-5.1b: each entry carries the correct speaker label prefix", () => {
    const conversation: ConversationEntry[] = [
      { id: "s", type: "system", text: "sys" },
      { id: "a", type: "agent", text: "agent" },
      { id: "u", type: "user", text: "user" },
    ];
    render(<ChatPanel activeRunId="run-42" conversation={conversation} />);
    const entries = screen.getAllByTestId("chat-entry");
    expect(within(entries[0]).getByTestId("chat-entry-label")).toHaveTextContent("You:");
    expect(within(entries[1]).getByTestId("chat-entry-label")).toHaveTextContent(
      "Beerengineer:"
    );
    expect(within(entries[2]).getByTestId("chat-entry-label")).toHaveTextContent("System:");
  });

  it("TC-5.1b extra: an unknown role does not render any of the known labels", () => {
    const conversation: ConversationEntry[] = [
      { id: "x", type: "weird-role", text: "mystery" },
    ];
    render(<ChatPanel activeRunId="run-42" conversation={conversation} />);
    const entry = screen.getByTestId("chat-entry");
    expect(within(entry).queryByText(/^(System:|You:|Beerengineer:)$/)).toBeNull();
  });

  it("TC-5.2: review-gate entry renders inline action buttons after the prompt text", () => {
    const item = itemWithActiveRunAndConversation();
    render(
      <ChatPanel activeRunId={item.activeRunId} conversation={item.conversation} />
    );
    const reviewActions = screen.getByTestId("review-gate-actions");
    const buttons = within(reviewActions).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Approve", "Revise"]);
    const promptEntry = buttons[0].closest("[data-entry-type='review-gate']") as HTMLElement;
    const promptText = within(promptEntry).getByTestId("chat-entry-text");
    expect(promptEntry.textContent ?? "").toContain("review-prompt");
    expect(
      (promptEntry.textContent ?? "").indexOf("review-prompt")
    ).toBeLessThan((promptEntry.textContent ?? "").indexOf("Approve"));
    expect(promptText).toBeInTheDocument();
  });

  it("TC-5.2 extra: non-review-gate entry renders no inline action buttons", () => {
    const conversation: ConversationEntry[] = [
      { id: "u", type: "user", text: "hello" },
    ];
    render(<ChatPanel activeRunId="run-42" conversation={conversation} />);
    expect(screen.queryByTestId("review-gate-actions")).toBeNull();
  });
});

describe("ChatPanel review-gate actions", () => {
  it("TC-5.3a: clicking review-gate action POSTs to /api/runs/:id/answer with promptId and answer", async () => {
    const item = itemWithActiveRunAndConversation();
    const { calls } = installMockFetch({ defaultStatus: 200 });
    const user = userEvent.setup();
    render(
      <ChatPanel activeRunId={item.activeRunId} conversation={item.conversation} />
    );
    await user.click(screen.getByTestId("chat-review-approve"));
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1));
    const last = calls.at(-1)!;
    expect(last.url).toBe("/api/runs/run-42/answer");
    expect(last.init?.method).toBe("POST");
    const body = JSON.parse(String(last.init?.body));
    expect(body).toEqual({ promptId: "p-7", answer: "approve" });
  });

  it("TC-5.3a.extra: active review banner is rendered for an open review gate", () => {
    const item = itemWithActiveRunAndConversation();
    render(
      <ChatPanel activeRunId={item.activeRunId} conversation={item.conversation} />
    );
    expect(screen.getByTestId("chat-review-gate-banner")).toBeInTheDocument();
    expect(screen.getByTestId("chat-review-feedback")).toBeInTheDocument();
    expect(screen.getByTestId("chat-review-approve")).toBeInTheDocument();
    expect(screen.getByTestId("chat-review-revise")).toBeInTheDocument();
  });

  it("TC-5.3a.targets: review banner promotes mockup URLs into review targets", () => {
    const conversation: ConversationEntry[] = [
      {
        id: "r1",
        type: "review-gate",
        promptId: "p-1",
        text:
          'Design summary\n\nHigh-fidelity mockups (open in browser):\n' +
          '  http://localhost:4100/runs/run-42/artifacts/stages/frontend-design/artifacts/mockups/home.html\n' +
          '  http://localhost:4100/runs/run-42/artifacts/stages/frontend-design/artifacts/mockups/workflow.html\n\n' +
          'Type "approve" to commit, or "revise: <feedback>" to adjust.',
        actions: [
          { label: "Approve", value: "approve" },
          { label: "Revise", value: "revise:" },
        ],
      },
    ];

    render(<ChatPanel activeRunId="run-42" conversation={conversation} />);

    expect(screen.getAllByTestId("chat-review-target")).toHaveLength(2);
    expect(screen.getByTestId("chat-review-open-link")).toHaveAttribute(
      "href",
      "/api/runs/run-42/artifacts/stages/frontend-design/artifacts/mockups/home.html"
    );
    expect(screen.getByTestId("chat-review-iframe")).toHaveAttribute(
      "src",
      "/api/runs/run-42/artifacts/stages/frontend-design/artifacts/mockups/home.html"
    );
  });

  it("TC-5.3b: no speculative bubble appears before the answer fetch resolves", async () => {
    const item = itemWithActiveRunAndConversation();
    const { resolvePending } = installMockFetch({ pending: true });
    const user = userEvent.setup();
    render(
      <ChatPanel activeRunId={item.activeRunId} conversation={item.conversation} />
    );
    const beforeCount = screen.getAllByTestId("chat-entry").length;
    await user.click(screen.getByTestId("chat-review-approve"));
    expect(screen.getAllByTestId("chat-entry")).toHaveLength(beforeCount);
    await act(async () => {
      resolvePending();
    });
  });

  it("TC-5.3c: clicking Revise without feedback does not send and shows validation", async () => {
    const item = itemWithActiveRunAndConversation();
    const { calls } = installMockFetch({ defaultStatus: 200 });
    const user = userEvent.setup();
    render(
      <ChatPanel activeRunId={item.activeRunId} conversation={item.conversation} />
    );
    await user.click(screen.getByTestId("chat-review-revise"));
    expect(calls).toHaveLength(0);
    expect(screen.getByTestId("chat-review-validation")).toBeInTheDocument();
  });

  it("TC-5.3c.extra: banner revise sends engine-valid feedback answer", async () => {
    const item = itemWithActiveRunAndConversation();
    const { calls } = installMockFetch({ defaultStatus: 200 });
    const user = userEvent.setup();
    render(
      <ChatPanel activeRunId={item.activeRunId} conversation={item.conversation} />
    );
    await user.type(screen.getByTestId("chat-review-feedback"), "tighten spacing");
    await user.click(screen.getByTestId("chat-review-revise"));
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1));
    const last = calls.at(-1)!;
    const body = JSON.parse(String(last.init?.body));
    expect(body).toEqual({ promptId: "p-7", answer: "revise: tighten spacing" });
  });

  it("TC-5.3d: answered review-gate buttons become inert immediately after a successful answer POST", async () => {
    const item = itemWithActiveRunAndConversation();
    const { calls } = installMockFetch({ defaultStatus: 200 });
    const user = userEvent.setup();
    render(
      <ChatPanel activeRunId={item.activeRunId} conversation={item.conversation} />
    );
    const approve = screen.getByTestId("chat-review-approve");
    const revise = screen.getByTestId("chat-review-revise");
    await user.click(approve);
    await waitFor(() => expect(calls.length).toBe(1));
    expect(approve).toBeDisabled();
    expect(revise).toBeDisabled();
    await user.click(approve);
    await user.click(revise);
    expect(calls).toHaveLength(1);
  });
});

describe("ChatPanel free-form messages", () => {
  it("TC-5.4a: renders textarea and Send button when activeRunId is present", () => {
    const item = itemWithActiveRunEmptyConversation();
    render(
      <ChatPanel activeRunId={item.activeRunId} conversation={item.conversation} />
    );
    expect(screen.getByTestId("chat-textarea")).toBeInTheDocument();
    expect(screen.getByTestId("chat-send")).toBeInTheDocument();
  });

  it("TC-5.4a.extra: open non-review prompt turns the composer into a prompt-answer form", async () => {
    const { calls } = installMockFetch({ defaultStatus: 200 });
    const user = userEvent.setup();
    const conversation: ConversationEntry[] = [
      { id: "q1", type: "agent", promptId: "p-1", text: "Which screens are highest priority?" },
    ];
    render(<ChatPanel activeRunId="run-42" conversation={conversation} />);
    expect(screen.getByTestId("chat-prompt-banner")).toBeInTheDocument();
    expect(screen.getByTestId("chat-send")).toHaveTextContent("Answer Prompt");
    await user.type(screen.getByTestId("chat-textarea"), "Home and workflow");
    await user.click(screen.getByTestId("chat-send"));
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1));
    const last = calls.at(-1)!;
    expect(last.url).toBe("/api/runs/run-42/answer");
    expect(JSON.parse(String(last.init?.body))).toEqual({
      promptId: "p-1",
      answer: "Home and workflow",
    });
  });

  it("TC-5.4a.sync: successful prompt answer adopts returned conversation immediately", async () => {
    const synced = vi.fn();
    const { calls } = installMockFetch({
      defaultStatus: 200,
      defaultBody: {
        runId: "run-42",
        updatedAt: "2026-04-28T15:00:00.000Z",
        entries: [
          {
            id: "a-1",
            runId: "run-42",
            stageKey: "visual-companion",
            kind: "answer",
            actor: "user",
            text: "none",
            createdAt: "2026-04-28T15:00:00.000Z",
            answerTo: "p-1",
          },
        ],
        openPrompt: null,
      },
    });
    const user = userEvent.setup();
    const conversation: ConversationEntry[] = [
      { id: "q1", type: "agent", promptId: "p-1", text: "Which screens are highest priority?" },
    ];
    render(
      <ChatPanel
        activeRunId="run-42"
        conversation={conversation}
        onConversationSync={synced}
      />
    );
    await user.type(screen.getByTestId("chat-textarea"), "none");
    await user.click(screen.getByTestId("chat-send"));
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1));
    expect(synced).toHaveBeenCalledTimes(1);
    expect(synced).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-42",
        openPrompt: null,
      })
    );
  });

  it("TC-5.4b: typing and clicking Send POSTs to /api/runs/:id/messages with body", async () => {
    const { calls } = installMockFetch({ defaultStatus: 200 });
    const user = userEvent.setup();
    render(<ChatPanel activeRunId="run-42" conversation={[]} />);
    await user.type(screen.getByTestId("chat-textarea"), "Hello engine");
    await user.click(screen.getByTestId("chat-send"));
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1));
    const last = calls.at(-1)!;
    expect(last.url).toBe("/api/runs/run-42/messages");
    expect(last.init?.method).toBe("POST");
    expect(JSON.parse(String(last.init?.body))).toEqual({ text: "Hello engine" });
  });

  it("TC-5.5a: empty textarea on Send shows validation hint and sends no request", async () => {
    const { calls } = installMockFetch({ defaultStatus: 200 });
    const user = userEvent.setup();
    render(<ChatPanel activeRunId="run-42" conversation={[]} />);
    await user.click(screen.getByTestId("chat-send"));
    expect(screen.getByTestId("chat-validation")).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it("TC-5.5b: whitespace-only textarea on Send shows validation hint and sends no request", async () => {
    const { calls } = installMockFetch({ defaultStatus: 200 });
    const user = userEvent.setup();
    render(<ChatPanel activeRunId="run-42" conversation={[]} />);
    await user.type(screen.getByTestId("chat-textarea"), "   \t  ");
    await user.click(screen.getByTestId("chat-send"));
    expect(screen.getByTestId("chat-validation")).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it("EC-3: single-space textarea is treated as whitespace-only", async () => {
    const { calls } = installMockFetch({ defaultStatus: 200 });
    const user = userEvent.setup();
    render(<ChatPanel activeRunId="run-42" conversation={[]} />);
    await user.type(screen.getByTestId("chat-textarea"), " ");
    await user.click(screen.getByTestId("chat-send"));
    expect(screen.getByTestId("chat-validation")).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });
});

describe("ChatPanel placeholders and edge cases", () => {
  it("TC-5.6a/b: no activeRunId hides input and prompt buttons and shows placeholder", () => {
    const item = itemWithNoActiveRun();
    render(
      <ChatPanel activeRunId={item.activeRunId} conversation={item.conversation} />
    );
    expect(screen.getByTestId("chat-no-active-run")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-textarea")).toBeNull();
    expect(screen.queryByTestId("chat-send")).toBeNull();
    expect(screen.queryByTestId("review-gate-actions")).toBeNull();
  });

  it("TC-5.7: active run with empty conversation shows empty-state placeholder", () => {
    const item = itemWithActiveRunEmptyConversation();
    render(
      <ChatPanel activeRunId={item.activeRunId} conversation={item.conversation} />
    );
    expect(screen.getByTestId("chat-empty-state")).toBeInTheDocument();
  });
});

describe("ChatPanel optimistic-bubble guards", () => {
  it("TC-5.8: no optimistic bubble while POST /messages is in-flight", async () => {
    const { resolvePending } = installMockFetch({ pending: true });
    const user = userEvent.setup();
    const conversation: ConversationEntry[] = [
      { id: "u", type: "user", text: "existing" },
    ];
    render(<ChatPanel activeRunId="run-42" conversation={conversation} />);
    const before = screen.getAllByTestId("chat-entry").length;
    await user.type(screen.getByTestId("chat-textarea"), "queued");
    await user.click(screen.getByTestId("chat-send"));
    expect(screen.getAllByTestId("chat-entry")).toHaveLength(before);
    await act(async () => {
      resolvePending();
    });
  });
});

describe("ChatPanel error handling", () => {
  it("TC-5.9a: 4xx on /answer keeps draft, shows inline error, no new bubble", async () => {
    const item = itemWithActiveRunAndConversation();
    const { calls } = installMockFetch({ defaultStatus: 422 });
    const user = userEvent.setup();
    render(
      <ChatPanel activeRunId={item.activeRunId} conversation={item.conversation} />
    );
    const before = screen.getAllByTestId("chat-entry").length;
    const textarea = screen.getByTestId("chat-textarea") as HTMLTextAreaElement;
    await user.type(textarea, "draft-text");
    await user.click(screen.getByTestId("chat-review-approve"));
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1));
    expect(screen.getAllByTestId("chat-entry")).toHaveLength(before);
    expect(textarea.value).toBe("draft-text");
    await waitFor(() =>
      expect(screen.getByTestId("chat-error")).toBeInTheDocument()
    );
  });

  it("TC-5.9b: 4xx on /messages keeps draft, shows inline error, no new bubble", async () => {
    const { calls } = installMockFetch({ defaultStatus: 400 });
    const user = userEvent.setup();
    const conversation: ConversationEntry[] = [
      { id: "u", type: "user", text: "existing" },
    ];
    render(<ChatPanel activeRunId="run-42" conversation={conversation} />);
    const before = screen.getAllByTestId("chat-entry").length;
    const textarea = screen.getByTestId("chat-textarea") as HTMLTextAreaElement;
    await user.type(textarea, "draft-msg");
    await user.click(screen.getByTestId("chat-send"));
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1));
    expect(screen.getAllByTestId("chat-entry")).toHaveLength(before);
    expect(textarea.value).toBe("draft-msg");
    await waitFor(() =>
      expect(screen.getByTestId("chat-error")).toBeInTheDocument()
    );
  });

  it("TC-5.9c: network error on /messages keeps draft, shows inline error", async () => {
    const { calls } = installMockFetch({ reject: new TypeError("network") });
    const user = userEvent.setup();
    const conversation: ConversationEntry[] = [
      { id: "u", type: "user", text: "existing" },
    ];
    render(<ChatPanel activeRunId="run-42" conversation={conversation} />);
    const before = screen.getAllByTestId("chat-entry").length;
    const textarea = screen.getByTestId("chat-textarea") as HTMLTextAreaElement;
    await user.type(textarea, "draft-msg");
    await user.click(screen.getByTestId("chat-send"));
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1));
    expect(screen.getAllByTestId("chat-entry")).toHaveLength(before);
    expect(textarea.value).toBe("draft-msg");
    await waitFor(() =>
      expect(screen.getByTestId("chat-error")).toBeInTheDocument()
    );
  });

  it("TC-5.9d: network error on /answer keeps any draft, shows inline error", async () => {
    const item = itemWithActiveRunAndConversation();
    const { calls } = installMockFetch({ reject: new TypeError("network") });
    const user = userEvent.setup();
    render(
      <ChatPanel activeRunId={item.activeRunId} conversation={item.conversation} />
    );
    const before = screen.getAllByTestId("chat-entry").length;
    const textarea = screen.getByTestId("chat-textarea") as HTMLTextAreaElement;
    await user.type(textarea, "draft-while-approve");
    await user.click(screen.getByTestId("chat-review-approve"));
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1));
    expect(screen.getAllByTestId("chat-entry")).toHaveLength(before);
    expect(textarea.value).toBe("draft-while-approve");
    await waitFor(() =>
      expect(screen.getByTestId("chat-error")).toBeInTheDocument()
    );
  });
});

describe("ChatPanel rapid double-click", () => {
  it("EC-4: rapid double-click of Send dispatches only one POST while pending", async () => {
    const { calls, resolvePending } = installMockFetch({ pending: true });
    const user = userEvent.setup();
    render(<ChatPanel activeRunId="run-42" conversation={[]} />);
    await user.type(screen.getByTestId("chat-textarea"), "Hello");
    const send = screen.getByTestId("chat-send");
    await user.click(send);
    await user.click(send);
    expect(calls).toHaveLength(1);
    await act(async () => {
      resolvePending();
    });
  });
});

describe("ItemDetailChatLoader integration (TC-5.0)", () => {
  it("TC-5.0: GET /items/:id payload drives history rendering and the run ID used for sends", async () => {
    const itemPayload = itemWithDistinctRunId();
    const { calls } = installMockFetch({
      byUrl: [
        {
          match: (url) => url.includes("/items/item-99"),
          status: 200,
          body: itemPayload,
        },
        {
          match: (url) => url.includes("/api/runs/run-99/messages"),
          status: 200,
          body: {},
        },
      ],
    });
    const user = userEvent.setup();
    render(<ItemDetailChatLoader itemId="item-99" />);
    await waitFor(() =>
      expect(screen.getByText("fixture-message-99")).toBeInTheDocument()
    );
    await user.type(screen.getByTestId("chat-textarea"), "ping");
    await user.click(screen.getByTestId("chat-send"));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.endsWith("/api/runs/run-99/messages"))
      ).toBe(true)
    );
  });

  it("EC-5: activeRunId transitioning from null to a value reveals input without reload", async () => {
    const initial = itemWithNoActiveRun();
    const updated = { ...itemWithActiveRunEmptyConversation() };
    const { rerender } = render(
      <ChatPanel activeRunId={initial.activeRunId} conversation={initial.conversation} />
    );
    expect(screen.queryByTestId("chat-textarea")).toBeNull();
    rerender(
      <ChatPanel activeRunId={updated.activeRunId} conversation={updated.conversation} />
    );
    expect(screen.getByTestId("chat-textarea")).toBeInTheDocument();
  });
});
