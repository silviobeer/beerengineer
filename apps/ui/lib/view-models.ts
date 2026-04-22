export type NavItem = {
  href: string;
  label: string;
  badge?: string;
};

export type SignalTone = "neutral" | "petrol" | "gold" | "danger" | "success";

export type AttentionTone = "muted" | "gold" | "warn" | "bad" | "petrol" | "good";

export type WorkspaceSignalKey =
  | "awaiting_answer"
  | "blocked"
  | "merge_ready"
  | "ready_to_test"
  | "review_required";

export type WorkspaceSignalEntry = {
  key: WorkspaceSignalKey;
  label: string;
  count: number;
  href: string;
  tone?: SignalTone;
};

export type GlobalSignal = {
  label: string;
  value: string;
  tone?: SignalTone;
  href?: string;
  signalKey?: WorkspaceSignalKey;
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
  signalEntries?: WorkspaceSignalEntry[];
  actions: Array<{ label: string; href: string; primary?: boolean }>;
};

/**
 * Operator attention dimension. Extends the original five-state union with
 * the cockpit-level states. `running` is motion-only (never a badge); see
 * Motion Specification in docs/frontend-operator-cockpit-plan.md.
 */
export type AttentionState =
  | "idle"
  | "waiting"
  | "review"
  | "failed"
  | "done"
  | "awaiting_answer"
  | "blocked"
  | "review_required"
  | "merge_ready"
  | "ready_to_test"
  | "running";

export type ItemMode = "manual" | "assisted" | "auto";

export type CardMeta = {
  label: string;
  value: string;
};

export type BoardCardViewModel = {
  itemCode: string;
  itemId?: string;
  title: string;
  summary: string;
  mode: ItemMode;
  attention: AttentionState;
  meta: CardMeta[];
  selected?: boolean;
  recoveryStatus?: "blocked" | "failed" | null;
  /** Engine activity dot. Cards with `running=true` get a calm pulse. */
  running?: boolean;
  /** Open-prompt count if any. Drives Tier 2 MetricPill on selected/hover. */
  openPrompts?: number;
  /** Stage label shown in Tier 2. */
  currentStage?: string | null;
  /** Deep link target for the card. */
  href?: string;
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
  selectedItemCode?: string | null;
};

export type ProgressRowViewModel = {
  stage: string;
  status: string;
  note: string;
  /** Substage marker for the implementation ladder. */
  marker?: "current" | "complete" | "failed" | "skipped" | "pending";
};

export type ActionViewModel = {
  label: string;
  detail: string;
  primary?: boolean;
  href?: string;
};

export type ChatMessageViewModel = {
  role: "system" | "assistant" | "user";
  author: string;
  message: string;
};

export type BranchStatus = "active" | "merged" | "open_candidate" | "abandoned";

export type BranchRowViewModel = {
  scope: "main" | "project" | "story" | "candidate";
  name: string;
  base?: string | null;
  status: BranchStatus;
  /** Free-text label e.g. project key, story id. */
  detail?: string;
};

export type ItemTreeNode = {
  id: string;
  kind: "project" | "wave" | "story";
  label: string;
  status?: string;
  stage?: string;
  branch?: string | null;
  reviewState?: string;
  hasArtifacts?: boolean;
  children?: ItemTreeNode[];
};

export type RunSummaryViewModel = {
  runId: string;
  status: string;
  currentStage?: string | null;
  startedAt?: number | null;
  lastEventAt?: number | null;
};

export type RunHistoryEntry = {
  runId: string;
  status: string;
  startedAt?: number | null;
  endedAt?: number | null;
};

export type OpenPromptPreview = {
  runId: string;
  promptId: string;
  prompt: string;
};

export type MergePanelViewModel = {
  candidateBranch?: string | null;
  baseBranch?: string | null;
  checklistSummary?: string;
  validationStatus?: string;
  /** When false the UI renders aria-disabled buttons + helper note. */
  backendReady: boolean;
};

export type PreviewOriginType = "local-host" | "network-url" | "proxied-url";

export type PreviewViewModel = {
  available: boolean;
  previewLabel?: string;
  previewOriginType?: PreviewOriginType;
  previewUrl?: string;
  sourceHost?: string;
  expiresAt?: number;
  /** When false the UI renders helper text rather than a raw localhost link. */
  reachable?: boolean;
  helperText?: string;
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
  /** Active and historical runs. */
  runSummary?: RunSummaryViewModel | null;
  runHistory?: RunHistoryEntry[];
  /** Pending prompt routed for the quick PromptComposer in the overlay. */
  openPrompt?: OpenPromptPreview | null;
  /** Branch list rendered via BranchRow primitives. */
  branches?: BranchRowViewModel[];
  /** Hierarchical item tree (projects → waves → stories). */
  tree?: ItemTreeNode[];
  /** Mock or real merge state. */
  merge?: MergePanelViewModel | null;
  /** Mock or real preview state. */
  preview?: PreviewViewModel | null;
};

export type InboxRowKind =
  | "prompt_waiting"
  | "blocked_run"
  | "failed_run"
  | "review_required"
  | "merge_ready"
  | "ready_to_test"
  | string;

export type InboxRowViewModel = {
  kind: InboxRowKind;
  title: string;
  priority: "P1" | "P2" | "P3";
  status: string;
  primaryAction: string;
  detail: string;
  /** Deep-link target into the exact context. */
  href?: string;
  /** When set, the row can expand inline to reveal a PromptComposer. */
  prompt?: OpenPromptPreview | null;
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
