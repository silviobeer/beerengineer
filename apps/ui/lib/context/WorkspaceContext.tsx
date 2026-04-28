"use client";

import { createContext, useContext, useMemo } from "react";
import type { Workspace } from "../types";

export interface WorkspaceContextValue {
  workspaces: Workspace[];
  currentKey: string;
  currentWorkspace: Workspace | null;
  isKnownWorkspace: boolean;
  fetchError: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

interface WorkspaceProviderProps {
  workspaces: Workspace[];
  currentKey: string;
  fetchError?: boolean;
  children: React.ReactNode;
}

export function WorkspaceProvider({
  workspaces,
  currentKey,
  fetchError = false,
  children,
}: Readonly<WorkspaceProviderProps>) {
  const value = useMemo<WorkspaceContextValue>(() => {
    const current = workspaces.find((w) => w.key === currentKey) ?? null;
    return {
      workspaces,
      currentKey,
      currentWorkspace: current,
      isKnownWorkspace: current !== null,
      fetchError,
    };
  }, [workspaces, currentKey, fetchError]);
  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspaceContext(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error(
      "useWorkspaceContext must be used inside a <WorkspaceProvider>"
    );
  }
  return ctx;
}
