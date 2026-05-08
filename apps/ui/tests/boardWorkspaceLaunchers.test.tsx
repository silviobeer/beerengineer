import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routerRefreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: routerRefreshMock,
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
}));

import { Board } from "@/components/Board";
import { BoardImportLauncher } from "@/components/BoardImportLauncher";
import { CreateIdeaLauncher } from "@/components/CreateIdeaLauncher";
import { fullBoardItems } from "@/lib/fixtures";
import { SSETestProvider } from "./sseTestHarness";

function renderBoard(workspaceKey?: string) {
  return render(
    <SSETestProvider>
      <Board
        items={fullBoardItems()}
        workspaceKey={workspaceKey}
        renderLauncher={(context) => (
          <>
            <CreateIdeaLauncher {...context} />
            <BoardImportLauncher {...context} />
          </>
        )}
      />
    </SSETestProvider>,
  );
}

describe("Board workspace launchers", () => {
  beforeEach(() => {
    routerRefreshMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows two actionable top-level launchers when a workspace is selected", async () => {
    const user = userEvent.setup();
    renderBoard("alpha");

    const createIdea = screen.getByRole("button", { name: "Create idea" });
    const importFeature = screen.getByRole("button", { name: "Import feature" });

    expect(createIdea).toBeEnabled();
    expect(importFeature).toBeEnabled();

    await user.click(createIdea);
    expect(screen.getByLabelText("Idea content")).toBeInTheDocument();

    await user.click(importFeature);
    expect(screen.getByLabelText("Local folder path")).toBeInTheDocument();
  });

  it("shows gated non-actionable launchers with a workspace-selection reason when no workspace is selected", async () => {
    const user = userEvent.setup();
    renderBoard();

    const createIdea = screen.getByRole("button", { name: "Create idea" });
    const importFeature = screen.getByRole("button", { name: "Import feature" });

    expect(createIdea).toBeDisabled();
    expect(importFeature).toBeDisabled();
    expect(
      screen.getByText("Select a workspace before starting new work."),
    ).toBeInTheDocument();

    await user.click(createIdea);
    await user.click(importFeature);

    expect(screen.queryByLabelText("Idea content")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Local folder path")).not.toBeInTheDocument();
  });

  it("updates launcher gating immediately when workspace selection changes", async () => {
    const user = userEvent.setup();
    const view = renderBoard("alpha");

    await user.click(screen.getByRole("button", { name: "Create idea" }));
    await user.click(screen.getByRole("button", { name: "Import feature" }));
    expect(screen.getByLabelText("Idea content")).toBeInTheDocument();
    expect(screen.getByLabelText("Local folder path")).toBeInTheDocument();

    view.rerender(
      <SSETestProvider>
        <Board
          items={fullBoardItems()}
          renderLauncher={(context) => (
            <>
              <CreateIdeaLauncher {...context} />
              <BoardImportLauncher {...context} />
            </>
          )}
        />
      </SSETestProvider>,
    );

    expect(screen.getByRole("button", { name: "Create idea" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Import feature" })).toBeDisabled();
    expect(
      screen.getByText("Select a workspace before starting new work."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Idea content")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Local folder path")).not.toBeInTheDocument();

    view.rerender(
      <SSETestProvider>
        <Board
          items={fullBoardItems()}
          workspaceKey="alpha"
          renderLauncher={(context) => (
            <>
              <CreateIdeaLauncher {...context} />
              <BoardImportLauncher {...context} />
            </>
          )}
        />
      </SSETestProvider>,
    );

    expect(screen.getByRole("button", { name: "Create idea" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Import feature" })).toBeEnabled();
    expect(
      screen.queryByText("Select a workspace before starting new work."),
    ).not.toBeInTheDocument();
  });
});
