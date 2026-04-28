"use client";

import { createContext, useContext, type ReactNode } from "react";

export type SSELogEntry = {
  id?: string;
  severity: string;
  timestamp: string;
  message: string;
};

export type SSELogEvent = {
  type: "log";
  data: SSELogEntry;
};

export type LogStreamSubscriber = (event: SSELogEvent) => void;

export type LogStreamContextValue = {
  subscribe: (subscriber: LogStreamSubscriber) => () => void;
};

const LogStreamContext = createContext<LogStreamContextValue | null>(null);

export function LogStreamProvider({
  value,
  children,
}: Readonly<{
  value: LogStreamContextValue | null;
  children: ReactNode;
}>) {
  return (
    <LogStreamContext.Provider value={value}>
      {children}
    </LogStreamContext.Provider>
  );
}

export function useLogStream(): LogStreamContextValue | null {
  return useContext(LogStreamContext);
}

export function createFakeLogStream(): LogStreamContextValue & {
  emit: (event: SSELogEvent) => void;
  subscriberCount: () => number;
} {
  const subscribers = new Set<LogStreamSubscriber>();
  return {
    subscribe(subscriber) {
      subscribers.add(subscriber);
      return () => {
        subscribers.delete(subscriber);
      };
    },
    emit(event) {
      for (const subscriber of subscribers) subscriber(event);
    },
    subscriberCount() {
      return subscribers.size;
    },
  };
}
