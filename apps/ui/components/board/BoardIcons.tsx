import type { AttentionState, ItemMode } from "@/lib/view-models";

type SvgProps = { className?: string };

function BaseIcon({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={className ? `icon ${className}` : "icon"} aria-hidden="true">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4}>
        {children}
      </svg>
    </span>
  );
}

export function ModeManualIcon(props: SvgProps) {
  return (
    <BaseIcon className={props.className}>
      <path d="M5.5 8V4.5a1 1 0 0 1 2 0V7m0-3a1 1 0 1 1 2 0v3m0-2a1 1 0 1 1 2 0v4.5a2 2 0 0 1-.6 1.4l-1 1a2 2 0 0 1-1.4.6H8a3 3 0 0 1-2.1-.9L3.6 10.3a1 1 0 0 1 1.4-1.4L5.5 9.4" />
    </BaseIcon>
  );
}

export function ModeAssistedIcon(props: SvgProps) {
  return (
    <BaseIcon className={props.className}>
      <path d="M8 2.5 10 6l3.5 1-2.4 2.4.5 3.6L8 11.2 4.4 13l.5-3.6L2.5 7 6 6 8 2.5Z" />
    </BaseIcon>
  );
}

export function ModeAutoIcon(props: SvgProps) {
  return (
    <BaseIcon className={props.className}>
      <path d="M3.5 4.5 8 8l-4.5 3.5v-7Z" />
      <path d="M8 4.5 12.5 8 8 11.5v-7Z" />
    </BaseIcon>
  );
}

export function InboxIcon(props: SvgProps) {
  return (
    <BaseIcon className={props.className}>
      <path d="M3 4h10v7H6l-3 2V4z" />
    </BaseIcon>
  );
}

export function ShieldCheckIcon(props: SvgProps) {
  return (
    <BaseIcon className={props.className}>
      <path d="M8 2.5 13 5v6L8 13.5 3 11V5l5-2.5Z" />
      <path d="M5.5 8l1.5 1.5L10.5 6" />
    </BaseIcon>
  );
}

export function AlertTriangleIcon(props: SvgProps) {
  return (
    <BaseIcon className={props.className}>
      <path d="M8 2.5 13.5 12h-11L8 2.5Z" />
      <path d="M8 6v3.5M8 11.8h.01" />
    </BaseIcon>
  );
}

export function CheckIcon(props: SvgProps) {
  return (
    <BaseIcon className={props.className}>
      <path d="M3.5 8 6.5 11 12.5 5" />
    </BaseIcon>
  );
}

export function ArrowRightIcon(props: SvgProps) {
  return (
    <BaseIcon className={props.className}>
      <path d="M4 8h8M8 4l4 4-4 4" />
    </BaseIcon>
  );
}

export function PlusIcon(props: SvgProps) {
  return (
    <BaseIcon className={props.className}>
      <path d="M8 2v12M2 8h12" />
    </BaseIcon>
  );
}

export function ModeIcon({ mode }: { mode: ItemMode }) {
  if (mode === "auto") return <ModeAutoIcon />;
  if (mode === "assisted") return <ModeAssistedIcon />;
  return <ModeManualIcon />;
}

export function AttentionIcon({ attention }: { attention: AttentionState }) {
  switch (attention) {
    case "waiting":
      return <InboxIcon />;
    case "review":
      return <ShieldCheckIcon />;
    case "failed":
      return <AlertTriangleIcon />;
    case "done":
      return <CheckIcon />;
    default:
      return null;
  }
}
