import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// next/font/google reaches out to Google Fonts at build time. In a jsdom
// test env there's no Next bundler, so the loader throws on import. Mock
// every loader our code uses to a no-op that returns the className /
// variable / style shape the real loader produces.
vi.mock("next/font/google", () => {
  const stub = () => ({
    className: "mock-font",
    variable: "",
    style: { fontFamily: "mock-font" },
  });
  return {
    Inter: stub,
    JetBrains_Mono: stub,
    Space_Grotesk: stub,
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT: ${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  }),
}));

afterEach(() => {
  cleanup();
});
