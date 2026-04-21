"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { MonoLabel } from "@/components/primitives/MonoLabel";
import type { WorkspaceSummary } from "@/lib/view-models";

type WorkspaceSwitcherProps = {
  workspace: WorkspaceSummary;
  workspaces?: WorkspaceSummary[];
  onWorkspaceChange?: (workspaceKey: string) => void;
};

export function WorkspaceSwitcher({ workspace, workspaces, onWorkspaceChange }: WorkspaceSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listboxRef = useRef<HTMLDivElement | null>(null);
  const triggerId = useId();
  const listboxId = useId();
  const optionIdPrefix = useId();
  const options = useMemo(() => workspaces ?? [workspace], [workspace, workspaces]);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.key === workspace.key)
  );
  const canSwitch = Boolean(onWorkspaceChange && options.length > 1);

  useEffect(() => {
    setActiveIndex(selectedIndex);
  }, [selectedIndex]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    listboxRef.current?.focus();

    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen]);

  const openListbox = (index = selectedIndex) => {
    setActiveIndex(index);
    setIsOpen(true);
  };

  const closeListbox = () => {
    setIsOpen(false);
    setActiveIndex(selectedIndex);
  };

  const commitSelection = (index: number) => {
    const option = options[index];
    if (!option) {
      return;
    }
    onWorkspaceChange?.(option.key);
    setActiveIndex(index);
    setIsOpen(false);
  };

  const moveActiveIndex = (delta: number) => {
    const nextIndex = (activeIndex + delta + options.length) % options.length;
    setActiveIndex(nextIndex);
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!canSwitch) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      openListbox(selectedIndex === options.length - 1 ? 0 : selectedIndex + 1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      openListbox(selectedIndex === 0 ? options.length - 1 : selectedIndex - 1);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (isOpen) {
        closeListbox();
      } else {
        openListbox();
      }
    }
  };

  const handleListboxKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActiveIndex(1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActiveIndex(-1);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(options.length - 1);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      commitSelection(activeIndex);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeListbox();
    }
  };

  if (!canSwitch) {
    return (
      <div ref={rootRef} className="workspace-switcher">
        <MonoLabel>Active workspace</MonoLabel>
        <strong>{workspace.name}</strong>
        <span>{workspace.descriptor}</span>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="workspace-switcher">
      <MonoLabel>Active workspace</MonoLabel>
      <button
        id={triggerId}
        type="button"
        className="workspace-switcher-button"
        aria-label="Workspace"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        onClick={() => (isOpen ? closeListbox() : openListbox())}
        onKeyDown={handleTriggerKeyDown}
      >
        <strong>{workspace.name}</strong>
        <span>{workspace.descriptor}</span>
      </button>
      {isOpen ? (
        <div
          id={listboxId}
          ref={listboxRef}
          role="listbox"
          tabIndex={-1}
          aria-labelledby={triggerId}
          aria-activedescendant={`${optionIdPrefix}-${activeIndex}`}
          className="workspace-switcher-options"
          onKeyDown={handleListboxKeyDown}
        >
          {options.map((option, index) => {
            const selected = option.key === workspace.key;
            const active = index === activeIndex;

            return (
              <div
                key={option.key}
                id={`${optionIdPrefix}-${index}`}
                role="option"
                aria-selected={selected}
                className={active ? "workspace-option active" : "workspace-option"}
                onClick={() => commitSelection(index)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <strong>{option.name}</strong>
                <span>{option.descriptor}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
