import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Board } from "@/components/Board";
import { emptyBoardItems, fullBoardItems } from "@/lib/fixtures";
import { SSETestProvider } from "./sseTestHarness";

function renderBoard(items: ReturnType<typeof fullBoardItems>) {
  return render(
    <SSETestProvider>
      <Board items={items} />
    </SSETestProvider>,
  );
}

describe("Board layout (TC-01, TC-02, TC-19, TC-20)", () => {
  it("renders exactly seven column headers", () => {
    renderBoard(fullBoardItems());
    const headers = screen.getAllByTestId("kanban-column-header");
    expect(headers).toHaveLength(7);
  });

  it("renders the seven columns in left-to-right order: Idea, Brainstorm, Frontend, Requirements, Implementation, Merge, Done", () => {
    renderBoard(fullBoardItems());
    const headers = screen.getAllByTestId("kanban-column-header");
    expect(headers.map((h) => h.textContent?.trim())).toEqual([
      "Idea",
      "Brainstorm",
      "Frontend",
      "Requirements",
      "Implementation",
      "Merge",
      "Done",
    ]);
  });

  it("renders an empty body when a column has no items", () => {
    const onlyIdea = fullBoardItems().filter((c) => c.column === "idea");
    renderBoard(onlyIdea);
    const frontendCol = screen
      .getAllByTestId("kanban-column")
      .find((el) => el.dataset.column === "frontend")!;
    expect(frontendCol).toBeInTheDocument();
    const body = within(frontendCol).getByTestId("kanban-column-body");
    expect(within(body).queryAllByTestId("board-card")).toHaveLength(0);
  });

  it("keeps all seven columns in the DOM when there are zero items", () => {
    renderBoard(emptyBoardItems());
    const cols = screen.getAllByTestId("kanban-column");
    expect(cols).toHaveLength(7);
    for (const col of cols) {
      expect(col).toBeInTheDocument();
    }
  });
});
