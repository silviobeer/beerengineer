import { spawnSync } from "node:child_process";

import type { PlanningReviewConfidenceLevel, PlanningReviewExecutionMode, PlanningReviewGateEligibility } from "../domain/types.js";
import type { AgentRuntimeResolver } from "../adapters/runtime.js";
import { AppError } from "../shared/errors.js";

export type ReviewAssignment<TRole extends string> = {
  providerKey: string;
  role: TRole;
};

export type ReviewCapabilityPlan<TRole extends string> = {
  requestedMode: PlanningReviewExecutionMode;
  actualMode: PlanningReviewExecutionMode;
  assignments: ReviewAssignment<TRole>[];
  providersUsed: string[];
  missingCapabilities: string[];
  confidence: PlanningReviewConfidenceLevel;
  gateEligibility: PlanningReviewGateEligibility;
};

export class ReviewExecutionPlanner {
  private readonly providerAvailabilityCache = new Map<string, boolean>();

  public constructor(
    private readonly runtimeResolver: AgentRuntimeResolver,
    private readonly workspaceRoot: string
  ) {}

  public planDualRoleReview<TRole extends string>(input: {
    roles: [TRole, TRole];
    preferCodexFor?: TRole[];
    preferClaudeFor?: TRole[];
    unavailableCode?: string;
  }): ReviewCapabilityPlan<TRole> {
    const configuredProviders = Object.entries(this.runtimeResolver.config.providers).filter(([_, config]) =>
      this.isProviderAvailable(config.adapterKey, config.command[0] ?? null)
    );
    const localProvider = configuredProviders.find(([_, config]) => config.adapterKey === "local-cli")?.[0] ?? null;
    const nonLocalProviders = configuredProviders.filter(([_, config]) => config.adapterKey !== "local-cli");
    const preferredAutonomousProvider = this.runtimeResolver.resolveDefault("autonomous");
    const preferDeterministicLocal = preferredAutonomousProvider.adapterKey === "local-cli" && localProvider !== null;
    const providerByAdapterKey = new Map<string, string>(
      nonLocalProviders.map(([providerKey, config]) => [config.adapterKey, providerKey])
    );
    const codexProvider = providerByAdapterKey.get("codex");
    const claudeProvider = providerByAdapterKey.get("claude");

    if (preferDeterministicLocal) {
      return {
        requestedMode: "single_model_multi_role",
        actualMode: "single_model_multi_role",
        assignments: input.roles.map((role) => ({ providerKey: localProvider!, role })),
        providersUsed: [localProvider],
        missingCapabilities: ["independent_second_reviewer"],
        confidence: "reduced",
        gateEligibility: "advisory_only"
      };
    }

    if (codexProvider && claudeProvider) {
      const preferredProviders = input.roles.map((role) => {
        if (input.preferCodexFor?.includes(role)) {
          return codexProvider;
        }
        if (input.preferClaudeFor?.includes(role)) {
          return claudeProvider;
        }
        return null;
      }) as [string | null, string | null];

      const assignments: ReviewAssignment<TRole>[] = input.roles.map((role, index) => ({
        providerKey:
          preferredProviders[index] ??
          (index === 0 ? codexProvider : claudeProvider),
        role
      }));

      if (assignments[0].providerKey === assignments[1].providerKey) {
        assignments[1] = {
          providerKey: assignments[0].providerKey === codexProvider ? claudeProvider : codexProvider,
          role: input.roles[1]
        };
      }

      return {
        requestedMode: "full_dual_review",
        actualMode: "full_dual_review",
        assignments,
        providersUsed: Array.from(new Set(assignments.map((assignment) => assignment.providerKey))),
        missingCapabilities: [],
        confidence: "high",
        gateEligibility: "advisory"
      };
    }

    if (nonLocalProviders.length >= 2) {
      return {
        requestedMode: "degraded_dual_review",
        actualMode: "degraded_dual_review",
        assignments: [
          { providerKey: nonLocalProviders[0]![0], role: input.roles[0] },
          { providerKey: nonLocalProviders[1]![0], role: input.roles[1] }
        ],
        providersUsed: [nonLocalProviders[0]![0], nonLocalProviders[1]![0]],
        missingCapabilities: codexProvider || claudeProvider ? [] : ["preferred_codex_claude_pair"],
        confidence: "medium",
        gateEligibility: "advisory"
      };
    }

    if (localProvider) {
      return {
        requestedMode: "single_model_multi_role",
        actualMode: "single_model_multi_role",
        assignments: input.roles.map((role) => ({ providerKey: localProvider, role })),
        providersUsed: [localProvider],
        missingCapabilities: ["independent_second_reviewer"],
        confidence: "reduced",
        gateEligibility: "advisory_only"
      };
    }

    if (nonLocalProviders.length === 1) {
      return {
        requestedMode: "minimal_review",
        actualMode: "minimal_review",
        assignments: [{ providerKey: nonLocalProviders[0]![0], role: input.roles[0] }],
        providersUsed: [nonLocalProviders[0]![0]],
        missingCapabilities: ["independent_second_reviewer", "cross_role_challenge"],
        confidence: "low",
        gateEligibility: "advisory_only"
      };
    }

    throw new AppError(input.unavailableCode ?? "REVIEW_PROVIDER_UNAVAILABLE", "No review provider is configured");
  }

  public planSingleProviderMultiRoleReview<TRole extends string>(input: {
    roles: TRole[];
    preferredAdapterKeys?: string[];
    unavailableCode?: string;
  }): ReviewCapabilityPlan<TRole> {
    const configuredProviders = Object.entries(this.runtimeResolver.config.providers).filter(([_, config]) =>
      this.isProviderAvailable(config.adapterKey, config.command[0] ?? null)
    );
    const localProvider = configuredProviders.find(([_, config]) => config.adapterKey === "local-cli")?.[0] ?? null;
    const nonLocalProviders = configuredProviders.filter(([_, config]) => config.adapterKey !== "local-cli");
    const providerByAdapterKey = new Map<string, string>(
      nonLocalProviders.map(([providerKey, config]) => [config.adapterKey, providerKey])
    );
    const preferredAutonomousProvider = this.runtimeResolver.resolveDefault("autonomous");

    const preferredProvider =
      input.preferredAdapterKeys
        ?.map((adapterKey) => providerByAdapterKey.get(adapterKey))
        .find((providerKey): providerKey is string => Boolean(providerKey))
      ?? (nonLocalProviders.some(([providerKey]) => providerKey === preferredAutonomousProvider.providerKey)
        ? preferredAutonomousProvider.providerKey
        : nonLocalProviders[0]?.[0] ?? null);

    if (preferredProvider) {
      return {
        requestedMode: "single_model_multi_role",
        actualMode: "single_model_multi_role",
        assignments: input.roles.map((role) => ({ providerKey: preferredProvider, role })),
        providersUsed: [preferredProvider],
        missingCapabilities: ["independent_second_reviewer"],
        confidence: "medium",
        gateEligibility: "advisory_only"
      };
    }

    if (localProvider) {
      return {
        requestedMode: "single_model_multi_role",
        actualMode: "single_model_multi_role",
        assignments: input.roles.map((role) => ({ providerKey: localProvider, role })),
        providersUsed: [localProvider],
        missingCapabilities: ["independent_second_reviewer"],
        confidence: "reduced",
        gateEligibility: "advisory_only"
      };
    }

    throw new AppError(input.unavailableCode ?? "REVIEW_PROVIDER_UNAVAILABLE", "No review provider is configured");
  }

  private isProviderAvailable(adapterKey: string, command: string | null): boolean {
    if (adapterKey === "local-cli") {
      return true;
    }
    if (!command) {
      return false;
    }
    const cacheKey = `${adapterKey}::${command}`;
    const cached = this.providerAvailabilityCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const lookupCommand = process.platform === "win32" ? "where" : "which";
    const result = spawnSync(lookupCommand, [command], { cwd: this.workspaceRoot, encoding: "utf8" });
    const available = result.status === 0;
    this.providerAvailabilityCache.set(cacheKey, available);
    return available;
  }
}
