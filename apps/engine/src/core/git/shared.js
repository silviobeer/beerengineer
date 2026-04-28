import { spawnSync } from "node:child_process";
export function runGit(workspaceRoot, args) {
    const result = spawnSync("git", args, { cwd: workspaceRoot, encoding: "utf8" });
    return {
        ok: result.status === 0,
        stdout: (result.stdout ?? "").trim(),
        stderr: (result.stderr ?? "").trim(),
    };
}
export function branchExists(workspaceRoot, branch) {
    return runGit(workspaceRoot, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).ok;
}
export function currentBranch(workspaceRoot) {
    return runGit(workspaceRoot, ["branch", "--show-current"]).stdout;
}
export function itemRoot(mode) {
    return mode.itemWorktreeRoot;
}
