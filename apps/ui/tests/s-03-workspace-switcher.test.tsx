import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

const pushMock = vi.fn();
let pathnameMock = "/w/alpha";

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

import WorkspaceLayout from "@/app/w/[key]/layout";
import { WorkspaceProvider } from "@/lib/context/WorkspaceContext";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";
import type { Workspace } from "@/lib/types";

function stubWorkspacesFetch(workspaces: Workspace[]) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/workspaces")) {
      return new Response(JSON.stringify({ workspaces }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`Unexpected fetch URL in test: ${url}`);
  });
}

describe("S-03: Workspace Switcher (integration via WorkspaceLayout)", () => {
  let originalFetch: typeof globalThis.fetch | undefined;

  beforeEach(() => {
    pushMock.mockClear();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  it("TC-01 (AC-S03-01): Board route shell renders a combobox in the header landmark", async () => {
    pathnameMock = "/w/alpha";
    globalThis.fetch = stubWorkspacesFetch([
      { key: "alpha", name: "Alpha" },
    ]) as unknown as typeof globalThis.fetch;

    const tree = await WorkspaceLayout({
      children: <main data-testid="board-placeholder">Board</main>,
      params: Promise.resolve({ key: "alpha" }),
    });
    render(tree);

    const banner = screen.getByRole("banner");
    const combobox = within(banner).getByRole("combobox", { name: /workspace/i });
    expect(combobox).toBeInTheDocument();
    expect(combobox).toBeVisible();
  });

  it("TC-02 (AC-S03-01): Item-detail route shell renders a combobox in the header landmark", async () => {
    pathnameMock = "/w/alpha/items/item-1";
    globalThis.fetch = stubWorkspacesFetch([
      { key: "alpha", name: "Alpha" },
    ]) as unknown as typeof globalThis.fetch;

    const tree = await WorkspaceLayout({
      children: (
        <article data-testid="item-detail-placeholder">Item Detail</article>
      ),
      params: Promise.resolve({ key: "alpha" }),
    });
    render(tree);

    const banner = screen.getByRole("banner");
    const combobox = within(banner).getByRole("combobox", { name: /workspace/i });
    expect(combobox).toBeInTheDocument();
    expect(combobox).toBeVisible();
    expect(screen.getByTestId("item-detail-placeholder")).toBeInTheDocument();
  });

  it("TC-03 (AC-S03-02): WorkspaceLayout fetches GET /workspaces and shows fetched workspaces with active key selected", async () => {
    pathnameMock = "/w/beta";
    globalThis.fetch = stubWorkspacesFetch([
      { key: "alpha", name: "Alpha" },
      { key: "beta", name: "Beta" },
    ]) as unknown as typeof globalThis.fetch;

    const tree = await WorkspaceLayout({
      children: <main>Board</main>,
      params: Promise.resolve({ key: "beta" }),
    });
    render(tree);

    const combobox = screen.getByRole("combobox", {
      name: /workspace/i,
    }) as HTMLSelectElement;
    const options = within(combobox).getAllByRole("option");
    const optionTexts = options.map((o) => o.textContent);
    expect(optionTexts).toEqual(expect.arrayContaining(["Alpha", "Beta"]));
    expect(combobox.value).toBe("beta");
  });
});

describe("S-03: WorkspaceSwitcher unit tests", () => {
  beforeEach(() => {
    pushMock.mockClear();
    pathnameMock = "/w/alpha";
  });

  it("TC-04 (AC-S03-03): selecting another workspace from Board calls router.push with /w/[newKey]", () => {
    pathnameMock = "/w/alpha";
    render(
      <WorkspaceProvider
        workspaces={[
          { key: "alpha", name: "Alpha" },
          { key: "beta", name: "Beta" },
        ]}
        currentKey="alpha"
      >
        <WorkspaceSwitcher />
      </WorkspaceProvider>
    );

    const combo = screen.getByRole("combobox", {
      name: /workspace/i,
    }) as HTMLSelectElement;
    fireEvent.change(combo, { target: { value: "beta" } });
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith("/w/beta");
  });

  it("TC-04 (AC-S03-03): direction-independent — selecting alpha from beta-active also pushes /w/alpha", () => {
    pathnameMock = "/w/beta";
    render(
      <WorkspaceProvider
        workspaces={[
          { key: "alpha", name: "Alpha" },
          { key: "beta", name: "Beta" },
        ]}
        currentKey="beta"
      >
        <WorkspaceSwitcher />
      </WorkspaceProvider>
    );

    const combo = screen.getByRole("combobox", {
      name: /workspace/i,
    }) as HTMLSelectElement;
    fireEvent.change(combo, { target: { value: "alpha" } });
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith("/w/alpha");
  });

  it("TC-05 (AC-S03-03): workspace key with URI-reserved characters is encoded in navigation target", () => {
    pathnameMock = "/w/hello%20world";
    render(
      <WorkspaceProvider
        workspaces={[
          { key: "hello world", name: "Hello World" },
          { key: "other", name: "Other" },
        ]}
        currentKey="other"
      >
        <WorkspaceSwitcher />
      </WorkspaceProvider>
    );

    const combo = screen.getByRole("combobox", {
      name: /workspace/i,
    }) as HTMLSelectElement;
    fireEvent.change(combo, { target: { value: "hello world" } });
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith("/w/hello%20world");
    const arg = String(pushMock.mock.calls[0]?.[0] ?? "");
    expect(arg).not.toContain("/w/hello world");
  });

  it("TC-06 (AC-S03-04): selecting from Item-Detail navigates to /w/[newKey] without preserving the item ID", () => {
    pathnameMock = "/w/alpha/items/42";
    render(
      <WorkspaceProvider
        workspaces={[
          { key: "alpha", name: "Alpha" },
          { key: "beta", name: "Beta" },
        ]}
        currentKey="alpha"
      >
        <WorkspaceSwitcher />
      </WorkspaceProvider>
    );

    const combo = screen.getByRole("combobox", {
      name: /workspace/i,
    }) as HTMLSelectElement;
    fireEvent.change(combo, { target: { value: "beta" } });
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith("/w/beta");
    const arg = String(pushMock.mock.calls[0]?.[0] ?? "");
    expect(arg).not.toContain("items");
    expect(arg).not.toContain("42");
  });

  it("TC-07 (AC-S03-05): single-workspace context renders exactly one selected option", () => {
    pathnameMock = "/w/alpha";
    render(
      <WorkspaceProvider
        workspaces={[{ key: "alpha", name: "Alpha" }]}
        currentKey="alpha"
      >
        <WorkspaceSwitcher />
      </WorkspaceProvider>
    );

    const combo = screen.getByRole("combobox", {
      name: /workspace/i,
    }) as HTMLSelectElement;
    const options = within(combo).getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(combo.value).toBe("alpha");
    expect(options[0]?.textContent).toBe("Alpha");
  });
});

describe("S-03: WorkspaceSwitcher edge cases", () => {
  beforeEach(() => {
    pushMock.mockClear();
    pathnameMock = "/w/alpha";
  });

  it("EC-01: active key not in fetched list still renders without crashing and does not select another workspace", () => {
    pathnameMock = "/w/unknown-key";
    render(
      <WorkspaceProvider
        workspaces={[
          { key: "alpha", name: "Alpha" },
          { key: "beta", name: "Beta" },
        ]}
        currentKey="unknown-key"
      >
        <WorkspaceSwitcher />
      </WorkspaceProvider>
    );

    const combo = screen.getByRole("combobox", {
      name: /workspace/i,
    }) as HTMLSelectElement;
    expect(combo).toBeInTheDocument();
    expect(combo.value).toBe("unknown-key");
    const options = within(combo).getAllByRole("option") as HTMLOptionElement[];
    const selected = options.filter((o) => o.value === combo.value);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.disabled).toBe(true);
  });

  it("EC-02: rapid successive option changes drive one router.push per change with the correct key", () => {
    pathnameMock = "/w/alpha";
    render(
      <WorkspaceProvider
        workspaces={[
          { key: "alpha", name: "Alpha" },
          { key: "beta", name: "Beta" },
          { key: "gamma", name: "Gamma" },
        ]}
        currentKey="alpha"
      >
        <WorkspaceSwitcher />
      </WorkspaceProvider>
    );

    const combo = screen.getByRole("combobox", {
      name: /workspace/i,
    }) as HTMLSelectElement;
    fireEvent.change(combo, { target: { value: "beta" } });
    fireEvent.change(combo, { target: { value: "gamma" } });

    expect(pushMock).toHaveBeenCalledTimes(2);
    expect(pushMock.mock.calls[0]?.[0]).toBe("/w/beta");
    expect(pushMock.mock.calls[1]?.[0]).toBe("/w/gamma");
  });
});
