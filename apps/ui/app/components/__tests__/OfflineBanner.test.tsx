import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import OfflineBanner, { OFFLINE_BANNER_TEXT } from "../OfflineBanner";

describe("OfflineBanner", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // TC-10
  it("renders the exact spec banner text byte-for-byte", () => {
    render(<OfflineBanner />);
    const el = screen.getByTestId("offline-banner");
    expect(el.textContent).toBe(OFFLINE_BANNER_TEXT);
    expect(OFFLINE_BANNER_TEXT).toBe(
      "[OFFLINE] Live-Updates pausiert — Seite neu laden zum wiederverbinden"
    );
  });

  // TC-11 — no loading-indicator semantics
  it("carries no loading-indicator semantics", () => {
    const { container } = render(<OfflineBanner />);
    expect(container.querySelectorAll("[role='progressbar']").length).toBe(0);
    expect(container.querySelectorAll("[aria-busy='true']").length).toBe(0);
    // role='status' is acceptable only if aria-live is 'off' — we don't render either at all.
    const statusEls = container.querySelectorAll("[role='status']");
    for (const el of Array.from(statusEls)) {
      const live = el.getAttribute("aria-live");
      expect(live === null || live === "off").toBe(true);
    }
    const imgs = container.querySelectorAll("img, svg");
    for (const el of Array.from(imgs)) {
      const name = (el.getAttribute("aria-label") ?? "").toLowerCase();
      expect(name.includes("loading")).toBe(false);
      expect(name.includes("spinner")).toBe(false);
      expect(name.includes("connecting")).toBe(false);
    }
  });

  // TC-12 — no self-dismiss / animation
  it("text is immediately visible and stays after fake-timer advance", () => {
    vi.useFakeTimers();
    render(<OfflineBanner />);
    const el = screen.getByTestId("offline-banner");
    expect(el).toBeInTheDocument();
    expect(el.textContent).toBe(OFFLINE_BANNER_TEXT);

    vi.advanceTimersByTime(10_000);

    const after = screen.getByTestId("offline-banner");
    expect(after).toBeInTheDocument();
    expect(after.textContent).toBe(OFFLINE_BANNER_TEXT);
  });
});
