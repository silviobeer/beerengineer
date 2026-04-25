import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Board } from "@/components/Board";
import { fullBoardFixture, emptyBoardFixture } from "@/lib/fixtures";

describe("Board layout (TC-01, TC-02, TC-19, TC-20)", () => {
  it("renders exactly six column headers", () => {
    render(
      <Board workspaceKey="demo" initialItems={fullBoardFixture} sseUrl={null} />
    );
    const headers = screen.getAllByTestId("column-header");
    expect(headers).toHaveLength(6);
  });

  it("renders the six columns in left-to-right order: Idea, Frontend, Requirements, Implementation, Test, Merge", () => {
    render(
      <Board workspaceKey="demo" initialItems={fullBoardFixture} sseUrl={null} />
    );
    const headers = screen.getAllByTestId("column-header");
    expect(headers.map((h) => h.textContent)).toEqual([
      "Idea",
      "Frontend",
      "Requirements",
      "Implementation",
      "Test",
      "Merge",
    ]);
  });

  it("renders an empty placeholder when a column has no items", () => {
    const onlyIdea = fullBoardFixture.filter((i) => i.phase === "Idea");
    render(<Board workspaceKey="demo" initialItems={onlyIdea} sseUrl={null} />);
    const frontendCol = screen
      .getAllByTestId("board-column")
      .find((el) => el.dataset.phase === "Frontend")!;
    expect(frontendCol).toBeInTheDocument();
    expect(frontendCol.textContent).toContain("No items");
  });

  it("keeps all six columns in the DOM when there are zero items", () => {
    render(
      <Board workspaceKey="demo" initialItems={emptyBoardFixture} sseUrl={null} />
    );
    const cols = screen.getAllByTestId("board-column");
    expect(cols).toHaveLength(6);
    for (const col of cols) {
      expect(col).toBeInTheDocument();
    }
  });
});
