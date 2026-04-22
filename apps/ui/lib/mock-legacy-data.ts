import type {
  BoardViewModel,
  ChatMessageViewModel,
  InboxViewModel,
  ItemOverlayViewModel,
  SetupViewModel,
  ShellViewModel
} from "@/lib/view-models";

export const shellViewModel: ShellViewModel = {
  title: "Workspace-first shell without sidebar",
  subtitle: "Workspace, navigation, and global state live at the top. The board stays the primary surface.",
  activeWorkspace: {
    key: "beerengineer-cli-ui-prep",
    name: "beerengineer-cli-ui-prep",
    descriptor: "Repo root · assisted default · local DB"
  },
  navItems: [
    { href: "/", label: "Board" },
    { href: "/inbox", label: "Inbox", badge: "2" },
    { href: "/runs", label: "Runs" },
    { href: "/artifacts", label: "Artifacts" },
    { href: "/settings", label: "Settings" },
    { href: "/setup", label: "Setup" },
    { href: "/showcase", label: "Showcase" }
  ],
  globalSignals: [
    { label: "Mode", value: "assisted default", tone: "petrol" },
    { label: "Waiting", value: "2", tone: "gold" },
    { label: "Review", value: "5", tone: "neutral" },
    { label: "Failed", value: "1", tone: "danger" }
  ],
  actions: [
    { label: "Sitemap", href: "/setup" },
    { label: "Inbox", href: "/inbox" },
    { label: "Chat Focus", href: "/showcase", primary: true }
  ]
};

export const boardViewModel: BoardViewModel = {
  heading: "beerengineer-cli-ui-prep",
  description: "Items of this codebase. Details open contextually as a right-side overlay.",
  filters: [
    { label: "all items" },
    { label: "requirements focus", tone: "petrol" },
    { label: "needs input", tone: "gold" }
  ],
  columns: [
    {
      key: "idea",
      title: "Idea",
      cards: [
        {
          itemCode: "ITM-008",
          title: "Workspace bootstrap assistant",
          summary: "No run yet. Ready for brainstorm start in this workspace.",
          mode: "manual",
          attention: "idle",
          meta: [
            { label: "phase", value: "draft" },
            { label: "scope", value: "setup" }
          ]
        }
      ]
    },
    {
      key: "brainstorm",
      title: "Brainstorm",
      cards: [
        {
          itemCode: "ITM-006",
          title: "Quality dashboard for integrations",
          summary: "Session paused on target-audience clarification.",
          mode: "assisted",
          attention: "waiting",
          meta: [
            { label: "session", value: "open" },
            { label: "owner", value: "planning" }
          ]
        }
      ]
    },
    {
      key: "requirements",
      title: "Requirements",
      cards: [
        {
          itemCode: "ITM-007",
          title: "Workspace-first shell without sidebar",
          summary: "Board-first shell with overlay item detail and top-level workspace switching.",
          mode: "assisted",
          attention: "review",
          selected: true,
          meta: [
            { label: "stories", value: "4" },
            { label: "review", value: "pending" }
          ]
        },
        {
          itemCode: "ITM-009",
          title: "Story review inbox aggregation",
          summary: "Aggregate waiting, blocked and review-required sessions into one operational inbox.",
          mode: "auto",
          attention: "review",
          meta: [
            { label: "runs", value: "2" },
            { label: "priority", value: "P2" }
          ]
        }
      ]
    },
    {
      key: "implementation",
      title: "Implementation",
      cards: [
        {
          itemCode: "ITM-010",
          title: "Board workspace query service",
          summary: "Thin UI-facing read model over workflowService.getBoardView().",
          mode: "auto",
          attention: "failed",
          meta: [
            { label: "run", value: "failed" },
            { label: "retry", value: "available" }
          ]
        },
        {
          itemCode: "ITM-011",
          title: "Workspace setup diagnostics",
          summary: "Doctor-backed setup dashboard with repair actions and assist planning.",
          mode: "assisted",
          attention: "waiting",
          meta: [
            { label: "doctor", value: "warning" },
            { label: "assist", value: "open" }
          ]
        }
      ]
    },
    {
      key: "done",
      title: "Done",
      cards: [
        {
          itemCode: "ITM-005",
          title: "Planning review improvement pass",
          summary: "Interactive follow-up loop and readiness synthesis shipped.",
          mode: "auto",
          attention: "done",
          meta: [
            { label: "qa", value: "passed" },
            { label: "docs", value: "done" }
          ]
        }
      ]
    }
  ]
};

export const overlayViewModel: ItemOverlayViewModel = {
  itemCode: "ITM-007",
  title: "Workspace-first shell without sidebar",
  summary: "Overlay detail keeps the board wide while still surfacing progress, actions, and recent chat.",
  mode: "assisted",
  attention: "review",
  progress: [
    { stage: "brainstorm", status: "completed", note: "Workspace-first direction approved." },
    { stage: "requirements", status: "in review", note: "Waiting on story collection approval." },
    { stage: "architecture", status: "queued", note: "Starts once requirements resolve." }
  ],
  actions: [
    { label: "Open Chat", detail: "Continue requirements review dialog.", primary: true },
    { label: "Approve Stories", detail: "Promote accepted stories to architecture." },
    { label: "Open Plan", detail: "Inspect implementation-plan draft." }
  ],
  chatPreview: [
    { role: "system", author: "system", message: "Interactive review session for project stories." },
    { role: "assistant", author: "assistant", message: "Should the board stay item-centric or switch to projects?" },
    { role: "user", author: "operator", message: "Keep it item-centric. Use the overlay for project detail depth." }
  ]
};

export const inboxViewModel: InboxViewModel = {
  heading: "Operational inbox",
  description: "Waiting sessions, blocked reviews, and failed work ordered by urgency.",
  filters: ["all", "waiting", "review", "failed"],
  rows: [
    {
      kind: "review",
      title: "ITM-007 story collection requires approval",
      priority: "P1",
      status: "waiting_for_user",
      primaryAction: "Open review",
      detail: "Requirements review is ready to approve and unlock architecture."
    },
    {
      kind: "execution",
      title: "ITM-010 board query service failed on retry",
      priority: "P1",
      status: "failed",
      primaryAction: "Retry run",
      detail: "Implementation worker stopped on missing read-model contract."
    },
    {
      kind: "assist",
      title: "Workspace setup assist has open planning session",
      priority: "P2",
      status: "questions_only",
      primaryAction: "Resume assist",
      detail: "Doctor found git and runtime warnings that can be repaired safely."
    }
  ]
};

export const setupViewModel: SetupViewModel = {
  heading: "Workspace setup overview",
  description: "Doctor-backed readiness, explicit repair actions, and assisted planning for greenfield and brownfield repos.",
  overallStatus: "warning",
  suggestedActions: [
    "Repair workspace root metadata",
    "Initialize BeerEngineer-owned directories",
    "Bootstrap starter files once runtime is green"
  ],
  autoFixes: [
    "workspace:init --create-root",
    "workspace:init --init-git",
    "workspace:bootstrap --stack node-ts"
  ],
  categories: [
    {
      title: "Filesystem",
      summary: "Root path exists but BeerEngineer-owned directories are incomplete.",
      checks: [
        { name: "workspace root", status: "ok", detail: "Workspace root resolves inside the repo." },
        { name: "runtime dirs", status: "missing", detail: ".beerengineer workspace folders need initialization." }
      ]
    },
    {
      title: "Git",
      summary: "Git metadata is present, but starter defaults are not configured.",
      checks: [
        { name: "git repo", status: "ok", detail: "Repository already initialized." },
        { name: "git defaults", status: "warning", detail: "Workspace git defaults are still empty." }
      ]
    },
    {
      title: "Integrations",
      summary: "Quality and review integrations are only partially configured.",
      checks: [
        { name: "CodeRabbit", status: "warning", detail: "Project instructions exist, starter assist can refine them." },
        { name: "Sonar", status: "not_applicable", detail: "No project token configured yet." }
      ]
    }
  ]
};

export const conversationMessages: ChatMessageViewModel[] = [
  { role: "system", author: "system", message: "Interactive setup assist session for workspace." },
  {
    role: "assistant",
    author: "assistant",
    message: "The workspace root is valid. Do you want me to initialize BeerEngineer-managed directories and git defaults?"
  },
  { role: "user", author: "operator", message: "Initialize the directories first. Keep git changes explicit." }
];
