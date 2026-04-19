import { execFileSync } from "node:child_process";

import type { GitBranchMetadata } from "../domain/types.js";

type GitWorkflowContext = {
  workspaceRoot: string;
  projectCode: string;
  storyCode?: string;
  findingRunId?: string;
};

function sanitizeRefSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._/-]+/g, "-");
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
      projectCode
    });
  }

  public ensureStoryBranch(projectCode: string, storyCode: string): GitBranchMetadata {
    return this.ensureBranch({
      workspaceRoot: this.workspaceRoot,
      projectCode,
      storyCode
    });
  }

  public ensureStoryRemediationBranch(projectCode: string, storyCode: string, findingRunId: string): GitBranchMetadata {
    return this.ensureBranch({
      workspaceRoot: this.workspaceRoot,
      projectCode,
      storyCode,
      findingRunId
    });
  }

  private ensureBranch(context: GitWorkflowContext): GitBranchMetadata {
    const baseRef = context.storyCode ? this.describeProjectBranch(context.projectCode) : "main";
    const branchName = context.findingRunId
      ? this.describeStoryRemediationBranch(context.storyCode!, context.findingRunId)
      : context.storyCode
        ? this.describeStoryBranch(context.projectCode, context.storyCode)
        : this.describeProjectBranch(context.projectCode);

    if (!this.isGitRepository()) {
      return this.simulatedMetadata(context.workspaceRoot, baseRef, branchName, this.currentHeadOrNull(), "workspace is not a git repository");
    }

    const dirty = this.hasUncommittedChanges();
    const headBefore = this.currentHeadOrNull();
    if (dirty) {
      return this.simulatedMetadata(context.workspaceRoot, baseRef, branchName, headBefore, "workspace has uncommitted changes");
    }

    try {
      this.ensureBaseRefExists(baseRef);
      this.runGit(["branch", "--force", branchName, baseRef]);
      return {
        branchRole: context.findingRunId ? "story-remediation" : context.storyCode ? "story" : "project",
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
        context.workspaceRoot,
        baseRef,
        branchName,
        headBefore,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private simulatedMetadata(
    workspaceRoot: string,
    baseRef: string,
    branchName: string,
    headBefore: string | null,
    reason: string
  ): GitBranchMetadata {
    return {
      branchRole: branchName.startsWith("fix/") ? "story-remediation" : branchName.startsWith("story/") ? "story" : "project",
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
    return this.runGit(["status", "--porcelain"]).trim().length > 0;
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

  private runGit(args: string[]): string {
    return execFileSync("git", args, {
      cwd: this.workspaceRoot,
      encoding: "utf8"
    }).trim();
  }
}
