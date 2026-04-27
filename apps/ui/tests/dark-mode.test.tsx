import { describe, it, expect } from "vitest";
import RootLayout from "@/app/layout";
import { renderToStaticMarkup } from "react-dom/server";

describe("Dark mode (TC-23)", () => {
  it("applies dark class and data-theme=dark on the html element by default", () => {
    const markup = renderToStaticMarkup(
      <RootLayout>
        <div>child</div>
      </RootLayout>
    );
    expect(markup).toMatch(/<html[^>]*class="[^"]*\bdark\b[^"]*"/);
    expect(markup).toMatch(/<html[^>]*data-theme="dark"/);
  });
});
