import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

const pushMock = vi.fn();
let pathnameMock = "/w/ws-alpha";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => pathnameMock,
}));

import { Topbar } from "@/components/Topbar";
import { UnknownWorkspaceGuard } from "@/components/UnknownWorkspace";
import { WorkspaceProvider } from "@/lib/context/WorkspaceContext";
import {
  FIXTURE_MULTI_WORKSPACES,
  FIXTURE_EMPTY_WORKSPACES,
} from "@/lib/fixtures";
import { fetchWorkspaces, fetchWorkspacesResult } from "@/lib/api";

function renderTopbar(
  currentKey: string,
  workspaces = FIXTURE_MULTI_WORKSPACES,
  fetchError = false
) {
  return render(
    <WorkspaceProvider
      workspaces={workspaces}
      currentKey={currentKey}
      fetchError={fetchError}
    >
      <Topbar />
    </WorkspaceProvider>
  );
}

describe("US-2: Workspace switcher edge cases", () => {
  beforeEach(() => {
    pushMock.mockClear();
    pathnameMock = "/w/ws-alpha";
  });

  describe("TC-2.4: empty workspaces array", () => {
    it("TC-2.4a: shows 'no workspaces' placeholder when GET /workspaces returns []", () => {
      renderTopbar("ws-alpha", FIXTURE_EMPTY_WORKSPACES);
      const combo = screen.getByRole("combobox", { name: /workspace/i });
      expect(combo).toBeInTheDocument();
      const placeholder = within(combo).getByText(/no workspaces/i);
      expect(placeholder).toBeInTheDocument();
    });

    it("TC-2.4b: page does not crash and Topbar remains visible with empty list", () => {
      renderTopbar("ws-alpha", FIXTURE_EMPTY_WORKSPACES);
      expect(screen.getByTestId("topbar")).toBeInTheDocument();
      expect(
        screen.getByRole("combobox", { name: /workspace/i })
      ).toBeInTheDocument();
    });
  });

  describe("TC-2.5: unknown workspace key", () => {
    it("TC-2.5a: renders a 'workspace not found' error state", () => {
      pathnameMock = "/w/does-not-exist";
      render(
        <WorkspaceProvider
          workspaces={FIXTURE_MULTI_WORKSPACES}
          currentKey="does-not-exist"
        >
          <Topbar />
          <UnknownWorkspaceGuard>
            <div data-testid="board-area">Board</div>
          </UnknownWorkspaceGuard>
        </WorkspaceProvider>
      );
      expect(screen.getByText(/workspace not found/i)).toBeInTheDocument();
      expect(screen.queryByTestId("board-area")).not.toBeInTheDocument();
    });

    it("TC-2.5b: switcher remains interactive on error page", () => {
      pathnameMock = "/w/does-not-exist";
      render(
        <WorkspaceProvider
          workspaces={FIXTURE_MULTI_WORKSPACES}
          currentKey="does-not-exist"
        >
          <Topbar />
          <UnknownWorkspaceGuard>
            <div data-testid="board-area">Board</div>
          </UnknownWorkspaceGuard>
        </WorkspaceProvider>
      );
      const combo = screen.getByRole("combobox", { name: /workspace/i });
      expect(combo).toBeInTheDocument();
      expect(combo).not.toBeDisabled();
    });
  });

  describe("TC-2.3a: navigation drops items segment", () => {
    it("from item-detail route, switching navigates to /w/[newKey] without /items/", () => {
      pathnameMock = "/w/ws-alpha/items/item-42";
      renderTopbar("ws-alpha");
      const combo = screen.getByRole("combobox", {
        name: /workspace/i,
      }) as HTMLSelectElement;
      fireEvent.change(combo, { target: { value: "ws-gamma" } });
      expect(pushMock).toHaveBeenCalledWith("/w/ws-gamma");
      const arg = String(pushMock.mock.calls[0]?.[0] ?? "");
      expect(arg).not.toContain("/items/");
    });
  });

  describe("TC-2.2b: active workspace indicator", () => {
    it("active option carries data-active=true; non-active options do not", () => {
      pathnameMock = "/w/ws-beta";
      renderTopbar("ws-beta");
      const combo = screen.getByRole("combobox", {
        name: /workspace/i,
      });
      const options = within(combo).getAllByRole(
        "option"
      ) as HTMLOptionElement[];
      const activeOptions = options.filter(
        (o) => o.dataset.active === "true"
      );
      expect(activeOptions).toHaveLength(1);
      expect(activeOptions[0]?.value).toBe("ws-beta");
      expect(activeOptions[0]?.textContent).toBe("Beta Cellar");
    });
  });

  describe("TC-2.3d: rapid succession switching", () => {
    it("each selection drives a router.push call with the latest key", () => {
      pathnameMock = "/w/ws-alpha";
      renderTopbar("ws-alpha");
      const combo = screen.getByRole("combobox", {
        name: /workspace/i,
      }) as HTMLSelectElement;
      fireEvent.change(combo, { target: { value: "ws-beta" } });
      fireEvent.change(combo, { target: { value: "ws-gamma" } });
      expect(pushMock).toHaveBeenCalledTimes(2);
      expect(pushMock.mock.calls[0]?.[0]).toBe("/w/ws-beta");
      expect(pushMock.mock.calls[1]?.[0]).toBe("/w/ws-gamma");
    });
  });

  describe("TC-2.6: GET /workspaces fetch error renders an error state", () => {
    it("renders the workspace switcher with a visible error indicator and does not crash", () => {
      pathnameMock = "/w/ws-alpha";
      renderTopbar("ws-alpha", [], true);
      expect(screen.getByTestId("topbar")).toBeInTheDocument();
      expect(
        screen.getByRole("combobox", { name: /workspace/i })
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("workspace-switcher-error-text")
      ).toBeInTheDocument();
      expect(
        screen.getByText(/failed to load workspaces/i)
      ).toBeInTheDocument();
    });
  });
});

describe("US-2: fetchWorkspaces resilience (TC-2.6)", () => {
  let originalFetch: typeof globalThis.fetch | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  it("returns [] when GET /workspaces responds with HTTP 500", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as unknown as Response);
    const result = await fetchWorkspaces();
    expect(result).toEqual([]);
  });

  it("returns [] when GET /workspaces network call rejects", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("network down"));
    const result = await fetchWorkspaces();
    expect(result).toEqual([]);
  });

  it("fetchWorkspacesResult flags error=true on HTTP 500", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as unknown as Response);
    const result = await fetchWorkspacesResult();
    expect(result.error).toBe(true);
    expect(result.workspaces).toEqual([]);
  });

  it("fetchWorkspacesResult flags error=true on network reject", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("network down"));
    const result = await fetchWorkspacesResult();
    expect(result.error).toBe(true);
    expect(result.workspaces).toEqual([]);
  });

  it("fetchWorkspacesResult flags error=false on a legit empty array", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [],
    } as unknown as Response);
    const result = await fetchWorkspacesResult();
    expect(result.error).toBe(false);
    expect(result.workspaces).toEqual([]);
  });
});
