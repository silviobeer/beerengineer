import type { ReactNode } from "react";
import { SSEContext, type SSEContextValue } from "@/app/lib/sse/SSEContext";

/**
 * Test-only wrapper that provides an empty `SSEContext` so components calling
 * `useSSE()` (e.g. `<Board>`) don't crash. The default value is fully inert:
 * no items, no listeners. Tests that need to drive item-state updates can
 * pass `value` with a populated `itemState` map or stubbed registrar
 * functions.
 */
export const noopSSEContext: SSEContextValue = {
  isOffline: false,
  itemState: {},
  setRunId: () => {},
  registerConversationListener: () => () => {},
  registerLogListener: () => () => {},
  registerItemListener: () => () => {},
};

export function SSETestProvider({
  children,
  value = noopSSEContext,
}: {
  children: ReactNode;
  value?: SSEContextValue;
}) {
  return <SSEContext.Provider value={value}>{children}</SSEContext.Provider>;
}
