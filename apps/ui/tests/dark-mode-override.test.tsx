import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render } from "@testing-library/react";
import RootLayout from "@/app/layout";
import { Board } from "@/components/Board";
import { fullBoardFixture } from "@/lib/fixtures";
import { renderToStaticMarkup } from "react-dom/server";

describe("Dark mode is not overridden by OS light preference (TC-24)", () => {
  let originalMatchMedia: typeof window.matchMedia | undefined;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    // Force prefers-color-scheme: light to be reported by the environment.
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("light"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    if (originalMatchMedia) window.matchMedia = originalMatchMedia;
  });

  it("html still has dark class and data-theme=dark even when light is preferred", () => {
    const markup = renderToStaticMarkup(
      <RootLayout>
        <div>child</div>
      </RootLayout>
    );
    expect(markup).toMatch(/<html[^>]*class="[^"]*\bdark\b[^"]*"/);
    expect(markup).toMatch(/<html[^>]*data-theme="dark"/);
    expect(markup).not.toMatch(/data-theme="light"/);
    expect(markup).not.toMatch(/class="[^"]*\blight\b[^"]*"/);
  });

  it("Board does not render any light-mode class or data-theme on its tree", () => {
    const { container } = render(
      <Board workspaceKey="demo" initialItems={fullBoardFixture} sseUrl={null} />
    );
    expect(container.querySelector('[data-theme="light"]')).toBeNull();
    expect(container.querySelector('.light')).toBeNull();
  });
});
