import { describe, it, expect, beforeEach } from "vitest";
import { act } from "react";
import { render, screen, within } from "@testing-library/react";
import { Board } from "@/components/Board";
import { makeItem, implementationItemFixture } from "@/lib/fixtures";
import {
  MockEventSource,
  makeMockEventSourceFactory,
} from "./MockEventSource";

beforeEach(() => {
  MockEventSource.reset();
});

function getCard(itemId: string) {
  return document.querySelector(`[data-item-id="${itemId}"]`)!;
}

describe("SSE live updates (TC-13..TC-18)", () => {
  it("updates the status chip when an SSE state-change event arrives", () => {
    const items = [makeItem({ id: "a", pipelineState: "idle" })];
    render(
      <Board
        workspaceKey="demo"
        initialItems={items}
        sseUrl="/events"
        eventSourceFactory={makeMockEventSourceFactory()}
      />
    );
    const beforeUrl = window.location.href;
    expect(
      within(getCard("a") as HTMLElement).getByTestId("status-chip").dataset.state
    ).toBe("idle");

    act(() => {
      MockEventSource.last()!.emit("message", {
        itemId: "a",
        pipelineState: "running",
      });
    });

    expect(
      within(getCard("a") as HTMLElement).getByTestId("status-chip").dataset.state
    ).toBe("running");
    expect(window.location.href).toBe(beforeUrl);
  });

  it("toggles attention-dot for the affected card only", () => {
    const items = [
      makeItem({ id: "a", pipelineState: "idle" }),
      makeItem({ id: "b", pipelineState: "idle" }),
    ];
    render(
      <Board
        workspaceKey="demo"
        initialItems={items}
        sseUrl="/events"
        eventSourceFactory={makeMockEventSourceFactory()}
      />
    );
    expect(
      within(getCard("a") as HTMLElement).queryByTestId("attention-dot")
    ).not.toBeInTheDocument();

    act(() => {
      MockEventSource.last()!.emit("message", {
        itemId: "a",
        pipelineState: "openPrompt",
      });
    });

    expect(
      within(getCard("a") as HTMLElement).getByTestId("attention-dot")
    ).toBeInTheDocument();
    expect(
      within(getCard("b") as HTMLElement).queryByTestId("attention-dot")
    ).not.toBeInTheDocument();
  });

  it("does not show speculative state before the SSE event arrives", async () => {
    const items = [makeItem({ id: "a", pipelineState: "idle" })];
    render(
      <Board
        workspaceKey="demo"
        initialItems={items}
        sseUrl="/events"
        eventSourceFactory={makeMockEventSourceFactory()}
      />
    );
    // Pre-event snapshot must be the initial state
    expect(
      within(getCard("a") as HTMLElement).getByTestId("status-chip").dataset.state
    ).toBe("idle");

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      within(getCard("a") as HTMLElement).getByTestId("status-chip").dataset.state
    ).toBe("idle");

    act(() => {
      MockEventSource.last()!.emit("message", {
        itemId: "a",
        pipelineState: "running",
      });
    });
    expect(
      within(getCard("a") as HTMLElement).getByTestId("status-chip").dataset.state
    ).toBe("running");
  });

  it("updates the mini-stepper for an Implementation item on state change", () => {
    render(
      <Board
        workspaceKey="demo"
        initialItems={[implementationItemFixture]}
        sseUrl="/events"
        eventSourceFactory={makeMockEventSourceFactory()}
      />
    );
    const cardEl = getCard(implementationItemFixture.id) as HTMLElement;
    const stepperBefore = within(cardEl).getByTestId("mini-stepper");
    const beforeText = stepperBefore.textContent ?? "";
    expect(stepperBefore.dataset.state).toBe("idle");

    act(() => {
      MockEventSource.last()!.emit("message", {
        itemId: implementationItemFixture.id,
        pipelineState: "running",
      });
    });

    const stepperAfter = within(cardEl).getByTestId("mini-stepper");
    expect(stepperAfter.dataset.state).toBe("running");
    expect(stepperAfter.textContent).not.toBe(beforeText);
  });

  it("ignores SSE events for unknown itemIds without throwing or creating phantom cards", () => {
    const items = [
      makeItem({ id: "a" }),
      makeItem({ id: "b" }),
    ];
    render(
      <Board
        workspaceKey="demo"
        initialItems={items}
        sseUrl="/events"
        eventSourceFactory={makeMockEventSourceFactory()}
      />
    );
    const before = screen.getAllByTestId("item-card").length;

    expect(() => {
      act(() => {
        MockEventSource.last()!.emit("message", {
          itemId: "ghost",
          pipelineState: "running",
        });
      });
    }).not.toThrow();

    expect(screen.getAllByTestId("item-card").length).toBe(before);
  });

  it("converges on the last event when multiple rapid events arrive for the same item", () => {
    const items = [makeItem({ id: "a", pipelineState: "idle" })];
    render(
      <Board
        workspaceKey="demo"
        initialItems={items}
        sseUrl="/events"
        eventSourceFactory={makeMockEventSourceFactory()}
      />
    );
    act(() => {
      const es = MockEventSource.last()!;
      es.emit("message", { itemId: "a", pipelineState: "stateA" });
      es.emit("message", { itemId: "a", pipelineState: "stateB" });
      es.emit("message", { itemId: "a", pipelineState: "stateC" });
    });
    expect(
      within(getCard("a") as HTMLElement).getByTestId("status-chip")
    ).toHaveTextContent("stateC");
  });
});
