import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import Board from "../Board";

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

const populatedBoard = { board: { id: "ws-1", name: "Test WS" } };
const populatedItems = [
  { id: "item-1", title: "Item A", status: "active" },
];

type Routes = {
  board?: () => Promise<Response>;
  items?: () => Promise<Response>;
};

const originalFetch = globalThis.fetch;

function installFetchMock(routes: Routes) {
  const fn = vi.fn(async (input: unknown) => {
    const url =
      typeof input === "string"
        ? input
        : input && typeof input === "object" && "url" in input
          ? String((input as { url: string }).url)
          : String(input);
    if (url.includes("/items"))
      return routes.items
        ? routes.items()
        : Promise.resolve(jsonResponse(populatedItems));
    if (url.includes("/board"))
      return routes.board
        ? routes.board()
        : Promise.resolve(jsonResponse(populatedBoard));
    throw new Error(`unexpected url ${url}`);
  });
  (globalThis as unknown as { fetch: typeof fetch }).fetch =
    fn as unknown as typeof fetch;
  return fn;
}

afterEach(() => {
  (globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("Board", () => {
  // TC-01
  it("shows only the loading indicator while both fetches are pending", () => {
    const dB = deferred<Response>();
    const dI = deferred<Response>();
    installFetchMock({ board: () => dB.promise, items: () => dI.promise });

    render(<Board workspaceKey="ws-1" />);

    expect(screen.getByTestId("board-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("board-content")).toBeNull();
    expect(screen.queryByTestId("board-empty")).toBeNull();
    expect(screen.queryByTestId("board-error")).toBeNull();
  });

  // TC-02
  it("renders content and hides loading after both fetches resolve", async () => {
    installFetchMock({
      board: () => Promise.resolve(jsonResponse(populatedBoard)),
      items: () => Promise.resolve(jsonResponse(populatedItems)),
    });

    render(<Board workspaceKey="ws-1" />);

    await waitFor(() =>
      expect(screen.getByTestId("board-content")).toBeInTheDocument()
    );
    expect(screen.getAllByTestId("board-item").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("board-loading")).toBeNull();
    expect(screen.queryByTestId("board-empty")).toBeNull();
    expect(screen.queryByTestId("board-error")).toBeNull();
  });

  // TC-03
  it("shows the empty state when /items returns []", async () => {
    installFetchMock({
      board: () => Promise.resolve(jsonResponse(populatedBoard)),
      items: () => Promise.resolve(jsonResponse([])),
    });

    render(<Board workspaceKey="ws-1" />);

    await waitFor(() =>
      expect(screen.getByTestId("board-empty")).toBeInTheDocument()
    );
    expect(screen.queryByTestId("board-content")).toBeNull();
    expect(screen.queryByTestId("board-loading")).toBeNull();
    expect(screen.queryByTestId("board-error")).toBeNull();
    expect(screen.queryAllByTestId("board-item")).toHaveLength(0);
  });

  // TC-04
  it("shows error state when GET /board returns 503", async () => {
    installFetchMock({
      board: () => Promise.resolve(jsonResponse({}, 503)),
      items: () => Promise.resolve(jsonResponse([])),
    });

    render(<Board workspaceKey="ws-1" />);

    await waitFor(() =>
      expect(screen.getByTestId("board-error")).toBeInTheDocument()
    );
    expect(screen.queryByTestId("board-loading")).toBeNull();
    expect(screen.queryByTestId("board-empty")).toBeNull();
    expect(screen.queryByTestId("board-content")).toBeNull();
  });

  // TC-05
  it("shows error state when GET /items returns 500 even though /board is ok", async () => {
    installFetchMock({
      board: () => Promise.resolve(jsonResponse(populatedBoard)),
      items: () => Promise.resolve(jsonResponse({ error: "boom" }, 500)),
    });

    render(<Board workspaceKey="ws-1" />);

    await waitFor(() =>
      expect(screen.getByTestId("board-error")).toBeInTheDocument()
    );
    expect(screen.queryByTestId("board-content")).toBeNull();
    expect(screen.queryByTestId("board-loading")).toBeNull();
  });

  // TC-06
  it("shows error state when /items rejects with a network failure", async () => {
    installFetchMock({
      board: () => Promise.resolve(jsonResponse(populatedBoard)),
      items: () => Promise.reject(new TypeError("Failed to fetch")),
    });

    render(<Board workspaceKey="ws-1" />);

    await waitFor(() =>
      expect(screen.getByTestId("board-error")).toBeInTheDocument()
    );
    expect(screen.queryByTestId("board-loading")).toBeNull();
  });

  // TC-12: state matrix mutual exclusivity
  it("state matrix is mutually exclusive across loading, empty, error, and content", async () => {
    const ids = [
      "board-loading",
      "board-empty",
      "board-error",
      "board-content",
    ] as const;
    const present = () => ids.filter((id) => screen.queryByTestId(id) != null);

    // loading
    {
      const dB = deferred<Response>();
      const dI = deferred<Response>();
      installFetchMock({ board: () => dB.promise, items: () => dI.promise });
      const { unmount } = render(<Board workspaceKey="ws-1" />);
      expect(present()).toEqual(["board-loading"]);
      unmount();
      (globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch;
    }

    // empty
    {
      installFetchMock({
        board: () => Promise.resolve(jsonResponse(populatedBoard)),
        items: () => Promise.resolve(jsonResponse([])),
      });
      const { unmount } = render(<Board workspaceKey="ws-1" />);
      await waitFor(() =>
        expect(screen.getByTestId("board-empty")).toBeInTheDocument()
      );
      expect(present()).toEqual(["board-empty"]);
      unmount();
      (globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch;
    }

    // error
    {
      installFetchMock({
        board: () => Promise.resolve(jsonResponse({}, 500)),
        items: () => Promise.resolve(jsonResponse([])),
      });
      const { unmount } = render(<Board workspaceKey="ws-1" />);
      await waitFor(() =>
        expect(screen.getByTestId("board-error")).toBeInTheDocument()
      );
      expect(present()).toEqual(["board-error"]);
      unmount();
      (globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch;
    }

    // content
    {
      installFetchMock({
        board: () => Promise.resolve(jsonResponse(populatedBoard)),
        items: () => Promise.resolve(jsonResponse(populatedItems)),
      });
      const { unmount } = render(<Board workspaceKey="ws-1" />);
      await waitFor(() =>
        expect(screen.getByTestId("board-content")).toBeInTheDocument()
      );
      expect(present()).toEqual(["board-content"]);
      unmount();
    }
  });

  // TC-14: partial resolution — /board done, /items still pending
  it("stays in loading when /board resolves but /items is still pending", async () => {
    const dItems = deferred<Response>();
    installFetchMock({
      board: () => Promise.resolve(jsonResponse(populatedBoard)),
      items: () => dItems.promise,
    });

    render(<Board workspaceKey="ws-1" />);

    // Flush microtasks so the /board fetch resolution is observed.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("board-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("board-content")).toBeNull();
    expect(screen.queryByTestId("board-empty")).toBeNull();
    expect(screen.queryByTestId("board-error")).toBeNull();
  });

  // TC-15
  it("transitions from loading to loaded after both fetches settle", async () => {
    const dB = deferred<Response>();
    const dI = deferred<Response>();
    installFetchMock({ board: () => dB.promise, items: () => dI.promise });

    render(<Board workspaceKey="ws-1" />);
    expect(screen.getByTestId("board-loading")).toBeInTheDocument();

    await act(async () => {
      dB.resolve(jsonResponse(populatedBoard));
      dI.resolve(jsonResponse(populatedItems));
    });

    await waitFor(() =>
      expect(screen.getByTestId("board-content")).toBeInTheDocument()
    );
    expect(screen.queryByTestId("board-loading")).toBeNull();
  });

  // TC-16
  it("transitions from loading to error when /board returns 500", async () => {
    const dB = deferred<Response>();
    const dI = deferred<Response>();
    installFetchMock({ board: () => dB.promise, items: () => dI.promise });

    render(<Board workspaceKey="ws-1" />);
    expect(screen.getByTestId("board-loading")).toBeInTheDocument();

    await act(async () => {
      dB.resolve(jsonResponse({}, 500));
      dI.resolve(jsonResponse([]));
    });

    await waitFor(() =>
      expect(screen.getByTestId("board-error")).toBeInTheDocument()
    );
    expect(screen.queryByTestId("board-loading")).toBeNull();
    expect(screen.queryByTestId("board-content")).toBeNull();
    expect(screen.queryByTestId("board-empty")).toBeNull();
  });

  // TC-17
  it("transitions from loading to empty when /items returns []", async () => {
    const dB = deferred<Response>();
    const dI = deferred<Response>();
    installFetchMock({ board: () => dB.promise, items: () => dI.promise });

    render(<Board workspaceKey="ws-1" />);
    expect(screen.getByTestId("board-loading")).toBeInTheDocument();

    await act(async () => {
      dB.resolve(jsonResponse(populatedBoard));
      dI.resolve(jsonResponse([]));
    });

    await waitFor(() =>
      expect(screen.getByTestId("board-empty")).toBeInTheDocument()
    );
    expect(screen.queryByTestId("board-content")).toBeNull();
    expect(screen.queryByTestId("board-error")).toBeNull();
  });
});
