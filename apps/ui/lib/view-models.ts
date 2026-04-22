export type NavItem = {
  href: string;
  label: string;
  badge?: string;
};

export type SignalTone = "neutral" | "petrol" | "gold" | "danger" | "success";

export type GlobalSignal = {
  label: string;
  value: string;
  tone?: SignalTone;
};

export type WorkspaceSummary = {
  key: string;
  name: string;
  descriptor: string;
};

export type ShellViewModel = {
  title: string;
  subtitle: string;
  activeWorkspace: WorkspaceSummary;
  availableWorkspaces?: WorkspaceSummary[];
  navItems: NavItem[];
  globalSignals: GlobalSignal[];
  actions: Array<{ label: string; href: string; primary?: boolean }>;
};

export type AttentionState = "waiting" | "review" | "failed" | "done" | "idle";
export type ItemMode = "manual" | "assisted" | "auto";

export type CardMeta = {
  label: string;
  value: string;
};

export type BoardCardViewModel = {
  itemCode: string;
  title: string;
  summary: string;
  mode: ItemMode;
  attention: AttentionState;
  meta: CardMeta[];
  selected?: boolean;
};

export type BoardColumnViewModel = {
  key: string;
  title: string;
  cards: BoardCardViewModel[];
};

export type BoardViewModel = {
  heading: string;
  description: string;
  filters: Array<{ label: string; tone?: SignalTone }>;
  columns: BoardColumnViewModel[];
};

export type ProgressRowViewModel = {
  stage: string;
  status: string;
  note: string;
};

export type ActionViewModel = {
  label: string;
  detail: string;
  primary?: boolean;
};

export type ChatMessageViewModel = {
  role: "system" | "assistant" | "user";
  author: string;
  message: string;
};

export type ItemOverlayViewModel = {
  itemCode: string;
  /** Persisted item id (UUID). Required for backend actions. */
  itemId?: string;
  /** Current board column for this item. */
  currentColumn?: "idea" | "brainstorm" | "requirements" | "implementation" | "done";
  /** Current phase status for this item. */
  currentPhase?: "draft" | "running" | "review_required" | "completed" | "failed";
  title: string;
  summary: string;
  mode: ItemMode;
  attention: AttentionState;
  progress: ProgressRowViewModel[];
  actions: ActionViewModel[];
  chatPreview: ChatMessageViewModel[];
};

export type InboxRowViewModel = {
  kind: string;
  title: string;
  priority: "P1" | "P2" | "P3";
  status: string;
  primaryAction: string;
  detail: string;
};

export type InboxViewModel = {
  heading: string;
  description: string;
  filters: string[];
  rows: InboxRowViewModel[];
};

export type SetupCheckViewModel = {
  name: string;
  status: "ok" | "warning" | "missing" | "blocked" | "not_applicable";
  detail: string;
};

export type SetupCategoryViewModel = {
  title: string;
  summary: string;
  checks: SetupCheckViewModel[];
};

export type SetupViewModel = {
  heading: string;
  description: string;
  overallStatus: string;
  suggestedActions: string[];
  autoFixes: string[];
  categories: SetupCategoryViewModel[];
};
