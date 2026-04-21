import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { GitBranchMetadata } from "../domain/types.js";

type GitWorkflowContext = {
  workspaceRoot: string;
  projectCode: string;
  storyCode?: string;
  findingRunId?: string;
  branchRole: GitBranchMetadata["branchRole"];
  allowDirtyWorkspace?: boolean;
};

function sanitizeRefSegment(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9._/-]+/g, "-");
}

export class GitWorkflowService {
  public constructor(
    private readonly workspaceRoot: string,
    private readonly workspaceKey: string
  ) {}

  public managedWorktreeRoot(): string {
    return resolve(this.workspaceRoot, ".beerengineer", "workspaces", sanitizeRefSegment(this.workspaceKey), "worktrees");
  }

  public legacyManagedWorktreeRoot(): string {
    return resolve(this.workspaceRoot, ".beerengineer", "worktrees");
  }

  public describeProjectBranch(projectCode: string): string {
    return `proj/${sanitizeRefSegment(projectCode)}`;
  }

  public describeStoryBranch(projectCode: string, storyCode: string): string {
    return `story/${sanitizeRefSegment(projectCode)}/${sanitizeRefSegment(storyCode)}`;
  }

  public describeStoryRemediationBranch(storyCode: string, findingRunId: string): string {
    return `fix/${sanitizeRefSegment(storyCode)}/${sanitizeRefSegment(findingRunId)}`;
  }

  public describeStoryWorktreePath(storyCode: string): string {
    return resolve(this.managedWorktreeRoot(), sanitizeRefSegment(storyCode));
  }

  public describeStoryRemediationWorktreePath(storyCode: string, findingRunId: string): string {
    return resolve(this.managedWorktreeRoot(), `${sanitizeRefSegment(storyCode)}-fix-${sanitizeRefSegment(findingRunId)}`);
  }

  public describeMergeWorktreePath(mergeKey: string): string {
    return resolve(this.managedWorktreeRoot(), "_merge", sanitizeRefSegment(mergeKey));
  }

  public ensureProjectBranch(projectCode: string): GitBranchMetadata {
    return this.ensureBranch({
      workspaceRoot: this.workspaceRoot,
      projectCode,
      branchRole: "project",
      allowDirtyWorkspace: true
    });
  }

  public ensureStoryBranch(projectCode: string, storyCode: string): GitBranchMetadata {
    return this.ensureBranch({
      workspaceRoot: this.workspaceRoot,
      projectCode,
      storyCode,
      branchRole: "story",
      allowDirtyWorkspace: true
    });
  }

  public ensureStoryRemediationBranch(projectCode: string, storyCode: string, findingRunId: string): GitBranchMetadata {
    return this.ensureBranch({
      workspaceRoot: this.workspaceRoot,
      projectCode,
      storyCode,
      findingRunId,
      branchRole: "story-remediation",
      allowDirtyWorkspace: true
    });
  }

  public worktreeAdd(worktreePath: string, branchName: string): void {
    const knownWorktrees = new Set(this.worktreeList());
    if (knownWorktrees.has(worktreePath)) {
      return;
    }
    if (existsSync(worktreePath)) {
      throw new Error(`Refusing to add worktree at ${worktreePath}; path already exists but is not registered as a git worktree`);
    }
    mkdirSync(dirname(worktreePath), { recursive: true });
    this.runGit(["worktree", "add", worktreePath, branchName]);
  }

  public worktreeRemove(worktreePath: string): void {
    const knownWorktrees = new Set(this.worktreeList());
    if (!knownWorktrees.has(worktreePath)) {
      return;
    }
    this.runGit(["worktree", "remove", worktreePath, "--force"]);
  }

  public worktreeList(): string[] {
    const output = this.runGitAllowEmpty(["worktree", "list", "--porcelain"]);
    if (output.length === 0) {
      return [];
    }
    return output
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length).trim());
  }

  public pruneWorktrees(): void {
    if (!this.isGitRepository()) {
      return;
    }
    this.runGit(["worktree", "prune"]);
  }

  public branchExists(branchName: string): boolean {
    try {
      this.runGit(["rev-parse", "--verify", branchName]);
      return true;
    } catch {
      return false;
    }
  }

  public mergeBranch(sourceBranch: string, targetBranch: string, mergeKey: string): string {
    this.ensureBaseRefExists(sourceBranch);
    this.ensureBaseRefExists(targetBranch);
    const mergeWorktreePath = this.describeMergeWorktreePath(mergeKey);
    this.worktreeRemove(mergeWorktreePath);
    if (existsSync(mergeWorktreePath)) {
      throw new Error(`Cannot create merge worktree at ${mergeWorktreePath}; path exists unexpectedly`);
    }

    mkdirSync(dirname(mergeWorktreePath), { recursive: true });
    try {
      this.runGit(["worktree", "add", "--detach", mergeWorktreePath, targetBranch]);
      this.runGitInWorktree(mergeWorktreePath, ["merge", "--no-ff", "--no-edit", sourceBranch]);
      const mergedCommitSha = this.runGitInWorktree(mergeWorktreePath, ["rev-parse", "HEAD"]);
      this.runGit(["update-ref", `refs/heads/${targetBranch}`, mergedCommitSha]);
      return mergedCommitSha;
    } finally {
      if (existsSync(mergeWorktreePath) || this.worktreeList().includes(mergeWorktreePath)) {
        this.runGit(["worktree", "remove", mergeWorktreePath, "--force"]);
      }
    }
  }

  public mergeIntoWorktree(worktreePath: string, sourceBranch: string): string {
    this.ensureBaseRefExists(sourceBranch);
    this.runGitInWorktree(worktreePath, ["merge", "--no-ff", "--no-edit", sourceBranch]);
    return this.runGitInWorktree(worktreePath, ["rev-parse", "HEAD"]);
  }

  public deleteBranch(branchName: string): void {
    try {
      this.runGit(["rev-parse", "--verify", branchName]);
    } catch {
      return;
    }
    this.runGit(["branch", "-d", branchName]);
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
    if (dirty && !context.allowDirtyWorkspace) {
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
        worktreePath: null,
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
      worktreePath: null,
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

  private runGitAllowEmpty(args: string[]): string {
    try {
      return this.runGit(args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("not a git repository")) {
        return "";
      }
      throw error;
    }
  }

  private runGitInWorktree(cwd: string, args: string[]): string {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  }
}
