import { describe, it, expect, vi, beforeEach } from "vitest";
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
import { WorkspaceProvider } from "@/lib/context/WorkspaceContext";
import {
  FIXTURE_MULTI_WORKSPACES,
  FIXTURE_SINGLE_WORKSPACE,
} from "@/lib/fixtures";

function renderTopbar(currentKey: string, workspaces = FIXTURE_MULTI_WORKSPACES) {
  return render(
    <WorkspaceProvider workspaces={workspaces} currentKey={currentKey}>
      <Topbar />
    </WorkspaceProvider>
  );
}

describe("WorkspaceSwitcher (US-06)", () => {
  beforeEach(() => {
    pushMock.mockClear();
    pathnameMock = "/w/ws-alpha";
  });

  it("TC-01: renders the switcher inside the Topbar on the Board route", () => {
    pathnameMock = "/w/ws-alpha";
    renderTopbar("ws-alpha");
    const combo = screen.getByRole("combobox", { name: /workspace/i });
    expect(combo).toBeInTheDocument();
    expect(combo).not.toBeDisabled();
  });

  it("TC-02: renders the switcher inside the Topbar on the Item-Detail route", () => {
    pathnameMock = "/w/ws-alpha/items/item-42";
    renderTopbar("ws-alpha");
    const combo = screen.getByRole("combobox", { name: /workspace/i });
    expect(combo).toBeInTheDocument();
    expect(combo).not.toBeDisabled();
  });

  it("TC-03: dropdown lists every registered workspace by name", () => {
    renderTopbar("ws-alpha");
    const combo = screen.getByRole("combobox", { name: /workspace/i });
    const optionTexts = within(combo)
      .getAllByRole("option")
      .map((o) => o.textContent);
    for (const w of FIXTURE_MULTI_WORKSPACES) {
      expect(optionTexts).toContain(w.name);
    }
  });

  it("TC-04: pre-selects the active workspace on Board route", () => {
    pathnameMock = "/w/ws-beta";
    renderTopbar("ws-beta");
    const combo = screen.getByRole("combobox", {
      name: /workspace/i,
    }) as HTMLSelectElement;
    expect(combo.value).toBe("ws-beta");
  });

  it("TC-05: pre-selects the active workspace on Item-Detail route", () => {
    pathnameMock = "/w/ws-beta/items/item-42";
    renderTopbar("ws-beta");
    const combo = screen.getByRole("combobox", {
      name: /workspace/i,
    }) as HTMLSelectElement;
    expect(combo.value).toBe("ws-beta");
  });

  it("TC-06: selecting another workspace from the Board navigates to /w/[newKey]", () => {
    pathnameMock = "/w/ws-alpha";
    renderTopbar("ws-alpha");
    const combo = screen.getByRole("combobox", {
      name: /workspace/i,
    }) as HTMLSelectElement;
    fireEvent.change(combo, { target: { value: "ws-beta" } });
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith("/w/ws-beta");
  });

  it("TC-07: selecting another workspace from Item-Detail drops the item segment", () => {
    pathnameMock = "/w/ws-alpha/items/item-42";
    renderTopbar("ws-alpha");
    const combo = screen.getByRole("combobox", {
      name: /workspace/i,
    }) as HTMLSelectElement;
    fireEvent.change(combo, { target: { value: "ws-beta" } });
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith("/w/ws-beta");
    const onlyArg = String(pushMock.mock.calls[0]?.[0] ?? "");
    expect(onlyArg).not.toContain("/items/");
  });

  it("TC-08: with a single workspace, the switcher still renders, is interactable, and the lone option is selected", () => {
    pathnameMock = "/w/ws-solo";
    renderTopbar("ws-solo", FIXTURE_SINGLE_WORKSPACE);
    const combo = screen.getByRole("combobox", {
      name: /workspace/i,
    }) as HTMLSelectElement;
    expect(combo).toBeInTheDocument();
    expect(combo).not.toBeDisabled();
    const options = within(combo).getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(combo.value).toBe("ws-solo");
    expect(options[0]?.textContent).toBe("Solo Workshop");
  });
});
