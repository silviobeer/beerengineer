import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import ItemDetail from "../ItemDetail";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (err: unknown) => void;
};
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const populatedItem = {
  id: "item-1",
  title: "Item A",
  status: "active",
  currentRunId: null,
};

const originalFetch = globalThis.fetch;

function installFetchMock(impl: () => Promise<Response>) {
  const fn = vi.fn(impl);
  (globalThis as unknown as { fetch: typeof fetch }).fetch =
    fn as unknown as typeof fetch;
  return fn;
}

afterEach(() => {
  (globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("ItemDetail", () => {
  // TC-07
  it("shows only the loading indicator while GET /items/:id is in flight", () => {
    const d = deferred<Response>();
    installFetchMock(() => d.promise);

    render(<ItemDetail itemId="item-1" />);

    expect(screen.getByTestId("item-detail-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("item-detail-content")).toBeNull();
    expect(screen.queryByTestId("item-detail-error")).toBeNull();
    expect(screen.queryByTestId("item-detail-title")).toBeNull();
  });

  // TC-08
  it("shows the error state when GET /items/:id returns 404", async () => {
    installFetchMock(() =>
      Promise.resolve(jsonResponse({ error: "not found" }, 404))
    );

    render(<ItemDetail itemId="missing" />);

    await waitFor(() =>
      expect(screen.getByTestId("item-detail-error")).toBeInTheDocument()
    );
    expect(screen.queryByTestId("item-detail-loading")).toBeNull();
    expect(screen.queryByTestId("item-detail-content")).toBeNull();
    const error = screen.getByTestId("item-detail-error");
    expect(error.getAttribute("data-variant")).toBe("not_found");
  });

  // TC-09
  it("shows the error state when GET /items/:id returns 500", async () => {
    installFetchMock(() => Promise.resolve(jsonResponse({}, 500)));

    render(<ItemDetail itemId="item-1" />);

    await waitFor(() =>
      expect(screen.getByTestId("item-detail-error")).toBeInTheDocument()
    );
    expect(screen.queryByTestId("item-detail-loading")).toBeNull();
    expect(screen.queryByTestId("item-detail-content")).toBeNull();
    expect(screen.queryByTestId("item-detail-title")).toBeNull();
  });

  // TC-10
  it("shows the error state when fetch rejects with a network error", async () => {
    installFetchMock(() => Promise.reject(new TypeError("Failed to fetch")));

    render(<ItemDetail itemId="item-1" />);

    await waitFor(() =>
      expect(screen.getByTestId("item-detail-error")).toBeInTheDocument()
    );
    expect(screen.queryByTestId("item-detail-loading")).toBeNull();
    expect(screen.getByTestId("item-detail-error").getAttribute("data-variant")).toBe(
      "network"
    );
  });

  // TC-11
  it("loading and error states are mutually exclusive across renders", async () => {
    // loading render
    {
      const d = deferred<Response>();
      installFetchMock(() => d.promise);
      const { unmount, container } = render(<ItemDetail itemId="item-1" />);
      expect(screen.getByTestId("item-detail-loading")).toBeInTheDocument();
      expect(screen.queryByTestId("item-detail-error")).toBeNull();
      const loadingText = (container.textContent ?? "").trim();
      unmount();
      (globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch;

      // error render
      installFetchMock(() => Promise.resolve(jsonResponse({}, 500)));
      const { container: errorContainer } = render(
        <ItemDetail itemId="item-1" />
      );
      await waitFor(() =>
        expect(screen.getByTestId("item-detail-error")).toBeInTheDocument()
      );
      expect(screen.queryByTestId("item-detail-loading")).toBeNull();
      const errorText = (errorContainer.textContent ?? "").trim();
      expect(errorText).not.toBe(loadingText);
    }
  });

  // TC-13: full state matrix
  it("state matrix is mutually exclusive across loading, error, and content", async () => {
    const ids = [
      "item-detail-loading",
      "item-detail-error",
      "item-detail-content",
    ] as const;
    const present = () => ids.filter((id) => screen.queryByTestId(id) != null);

    // loading
    {
      const d = deferred<Response>();
      installFetchMock(() => d.promise);
      const { unmount } = render(<ItemDetail itemId="item-1" />);
      expect(present()).toEqual(["item-detail-loading"]);
      unmount();
      (globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch;
    }

    // error
    {
      installFetchMock(() => Promise.resolve(jsonResponse({}, 404)));
      const { unmount } = render(<ItemDetail itemId="item-1" />);
      await waitFor(() =>
        expect(screen.getByTestId("item-detail-error")).toBeInTheDocument()
      );
      expect(present()).toEqual(["item-detail-error"]);
      unmount();
      (globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch;
    }

    // content
    {
      installFetchMock(() => Promise.resolve(jsonResponse(populatedItem)));
      const { unmount } = render(<ItemDetail itemId="item-1" />);
      await waitFor(() =>
        expect(screen.getByTestId("item-detail-content")).toBeInTheDocument()
      );
      expect(present()).toEqual(["item-detail-content"]);
      unmount();
    }
  });

  // TC-18
  it("transitions from loading to content when fetch resolves successfully", async () => {
    const d = deferred<Response>();
    installFetchMock(() => d.promise);

    render(<ItemDetail itemId="item-1" />);
    expect(screen.getByTestId("item-detail-loading")).toBeInTheDocument();

    await act(async () => {
      d.resolve(jsonResponse(populatedItem));
    });

    await waitFor(() =>
      expect(screen.getByTestId("item-detail-content")).toBeInTheDocument()
    );
    expect(screen.queryByTestId("item-detail-loading")).toBeNull();
    expect(screen.getByTestId("item-detail-title")).toHaveTextContent("Item A");
  });

  // TC-19
  it("transitions from loading to error when fetch returns 500", async () => {
    const d = deferred<Response>();
    installFetchMock(() => d.promise);

    render(<ItemDetail itemId="item-1" />);
    expect(screen.getByTestId("item-detail-loading")).toBeInTheDocument();

    await act(async () => {
      d.resolve(jsonResponse({}, 500));
    });

    await waitFor(() =>
      expect(screen.getByTestId("item-detail-error")).toBeInTheDocument()
    );
    expect(screen.queryByTestId("item-detail-loading")).toBeNull();
    expect(screen.queryByTestId("item-detail-content")).toBeNull();
    expect(screen.queryByTestId("item-detail-title")).toBeNull();
  });
});
