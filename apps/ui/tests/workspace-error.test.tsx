import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/w/no-such-ws",
}));

import { WorkspaceProvider } from "@/lib/context/WorkspaceContext";
import { Topbar } from "@/components/Topbar";
import { UnknownWorkspaceGuard } from "@/components/UnknownWorkspace";
import { Board } from "@/components/Board";
import { fullBoardFixture, FIXTURE_MULTI_WORKSPACES } from "@/lib/fixtures";

describe("Unknown workspace key error state (US-06 / TC-09)", () => {
  it("renders an explicit error and no board content when the route key is not registered", () => {
    render(
      <WorkspaceProvider
        workspaces={FIXTURE_MULTI_WORKSPACES}
        currentKey="no-such-ws"
      >
        <Topbar />
        <UnknownWorkspaceGuard>
          <Board
            workspaceKey="no-such-ws"
            initialItems={fullBoardFixture}
            sseUrl={null}
          />
        </UnknownWorkspaceGuard>
      </WorkspaceProvider>
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByTestId("board")).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("board-column")).toHaveLength(0);
    expect(screen.queryAllByTestId("column-header")).toHaveLength(0);
    expect(screen.queryAllByTestId("item-card")).toHaveLength(0);
  });

  it("still renders the workspace switcher so the operator can recover", () => {
    render(
      <WorkspaceProvider
        workspaces={FIXTURE_MULTI_WORKSPACES}
        currentKey="no-such-ws"
      >
        <Topbar />
        <UnknownWorkspaceGuard>
          <Board
            workspaceKey="no-such-ws"
            initialItems={fullBoardFixture}
            sseUrl={null}
          />
        </UnknownWorkspaceGuard>
      </WorkspaceProvider>
    );
    expect(
      screen.getByRole("combobox", { name: /workspace/i })
    ).toBeInTheDocument();
  });
});
