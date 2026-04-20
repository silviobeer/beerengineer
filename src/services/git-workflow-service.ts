import { execFileSync } from "node:child_process";

import type { GitBranchMetadata } from "../domain/types.js";

type GitWorkflowContext = {
  workspaceRoot: string;
  projectCode: string;
  storyCode?: string;
  findingRunId?: string;
  branchRole: GitBranchMetadata["branchRole"];
};

function sanitizeRefSegment(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9._/-]+/g, "-");
}

export class GitWorkflowService {
  public constructor(private readonly workspaceRoot: string) {}

  public describeProjectBranch(projectCode: string): string {
    return `proj/${sanitizeRefSegment(projectCode)}`;
  }

  public describeStoryBranch(projectCode: string, storyCode: string): string {
    return `story/${sanitizeRefSegment(projectCode)}/${sanitizeRefSegment(storyCode)}`;
  }

  public describeStoryRemediationBranch(storyCode: string, findingRunId: string): string {
    return `fix/${sanitizeRefSegment(storyCode)}/${sanitizeRefSegment(findingRunId)}`;
  }

  public ensureProjectBranch(projectCode: string): GitBranchMetadata {
    return this.ensureBranch({
      workspaceRoot: this.workspaceRoot,
      projectCode,
      branchRole: "project"
    });
  }

  public ensureStoryBranch(projectCode: string, storyCode: string): GitBranchMetadata {
    return this.ensureBranch({
      workspaceRoot: this.workspaceRoot,
      projectCode,
      storyCode,
      branchRole: "story"
    });
  }

  public ensureStoryRemediationBranch(projectCode: string, storyCode: string, findingRunId: string): GitBranchMetadata {
    return this.ensureBranch({
      workspaceRoot: this.workspaceRoot,
      projectCode,
      storyCode,
      findingRunId,
      branchRole: "story-remediation"
    });
  }

  private ensureBranch(context: GitWorkflowContext): GitBranchMetadata {
    const baseRef = context.storyCode ? this.describeProjectBranch(context.projectCode) : "main";
    const branchName = this.describeBranchName(context);

    if (!this.isGitRepository()) {
      return this.simulatedMetadata(
        context.branchRole,
        context.workspaceRoot,
        baseRef,
        branchName,
        this.currentHeadOrNull(),
        "workspace is not a git repository"
      );
    }

    const dirty = this.hasUncommittedChanges();
    const headBefore = this.currentHeadOrNull();
    if (dirty) {
      return this.simulatedMetadata(context.branchRole, context.workspaceRoot, baseRef, branchName, headBefore, "workspace has uncommitted changes");
    }

    try {
      this.ensureBaseRefExists(baseRef);
      this.ensureBranchRef(branchName, baseRef);
      return {
        branchRole: context.branchRole,
        baseRef,
        branchName,
        workspaceRoot: context.workspaceRoot,
        headBefore,
        headAfter: this.currentHeadOrNull(),
        commitSha: null,
        mergedIntoRef: null,
        mergedCommitSha: null,
        strategy: "applied",
        reason: null
      };
    } catch (error) {
      return this.simulatedMetadata(
        context.branchRole,
        context.workspaceRoot,
        baseRef,
        branchName,
        headBefore,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private describeBranchName(context: GitWorkflowContext): string {
    if (context.findingRunId && context.storyCode) {
      return this.describeStoryRemediationBranch(context.storyCode, context.findingRunId);
    }
    if (context.storyCode) {
      return this.describeStoryBranch(context.projectCode, context.storyCode);
    }
    return this.describeProjectBranch(context.projectCode);
  }

  private simulatedMetadata(
    branchRole: GitBranchMetadata["branchRole"],
    workspaceRoot: string,
    baseRef: string,
    branchName: string,
    headBefore: string | null,
    reason: string
  ): GitBranchMetadata {
    return {
      branchRole,
      baseRef,
      branchName,
      workspaceRoot,
      headBefore,
      headAfter: headBefore,
      commitSha: null,
      mergedIntoRef: null,
      mergedCommitSha: null,
      strategy: "simulated",
      reason
    };
  }

  private isGitRepository(): boolean {
    try {
      return this.runGit(["rev-parse", "--is-inside-work-tree"]) === "true";
    } catch {
      return false;
    }
  }

  private hasUncommittedChanges(): boolean {
    return (
      this.runGit([
        "status",
        "--porcelain",
        "--",
        ".",
        ":(exclude).beerengineer",
        ":(exclude)artifacts/app-verification"
      ]).trim().length > 0
    );
  }

  private currentHeadOrNull(): string | null {
    try {
      return this.runGit(["rev-parse", "HEAD"]);
    } catch {
      return null;
    }
  }

  private ensureBaseRefExists(baseRef: string): void {
    try {
      this.runGit(["rev-parse", "--verify", baseRef]);
      return;
    } catch {
      const head = this.currentHeadOrNull();
      if (!head) {
        throw new Error(`Cannot create base ref ${baseRef} without an existing HEAD`);
      }
      this.runGit(["branch", baseRef, head]);
    }
  }

  private ensureBranchRef(branchName: string, baseRef: string): void {
    try {
      const existingRef = this.runGit(["rev-parse", "--verify", branchName]);
      const targetRef = this.runGit(["rev-parse", "--verify", baseRef]);
      if (existingRef !== targetRef) {
        throw new Error(`Refusing to move existing branch ${branchName}; it already points to ${existingRef}`);
      }
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("Needed a single revision") && !message.includes("unknown revision")) {
        throw error instanceof Error ? error : new Error(message);
      }
    }
    this.runGit(["branch", branchName, baseRef]);
  }

  private runGit(args: string[]): string {
    return execFileSync("git", args, {
      cwd: this.workspaceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  }
}
