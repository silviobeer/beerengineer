import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
function runShell(command, cwd) {
    const result = spawnSync("bash", ["-lc", command], { cwd, encoding: "utf8" });
    return {
        ok: result.status === 0,
        output: [result.stdout, result.stderr].filter(Boolean).join("\n").trim(),
    };
}
export function verifySetupContract(workspaceRoot, contract) {
    return [
        ...verifyExpectedFiles(workspaceRoot, contract.expectedFiles),
        ...verifyRequiredScripts(workspaceRoot, contract.requiredScripts),
        ...verifyPostChecks(workspaceRoot, contract.postChecks),
    ];
}
function verifyExpectedFiles(workspaceRoot, expectedFiles) {
    const failures = [];
    for (const expectedFile of expectedFiles) {
        if (/\s/.test(expectedFile))
            continue;
        if (!existsSync(join(workspaceRoot, expectedFile))) {
            failures.push(`missing expected file: ${expectedFile}`);
        }
    }
    return failures;
}
function verifyRequiredScripts(workspaceRoot, requiredScripts) {
    if (requiredScripts.length === 0)
        return [];
    const packageJsonPath = join(workspaceRoot, "package.json");
    if (!existsSync(packageJsonPath)) {
        return ["missing package.json required to verify setup scripts"];
    }
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    const failures = [];
    for (const script of requiredScripts) {
        if (!packageJson.scripts?.[script]) {
            failures.push(`missing required package.json script: ${script}`);
            continue;
        }
        const run = runShell(`npm run ${script}`, workspaceRoot);
        if (!run.ok) {
            failures.push(`script failed: npm run ${script}${formatCommandOutput(run.output)}`);
        }
    }
    return failures;
}
function verifyPostChecks(workspaceRoot, postChecks) {
    const failures = [];
    for (const postCheck of postChecks) {
        const cmd = shellCommandFromPostCheck(postCheck);
        if (!cmd)
            continue;
        const run = runShell(cmd, workspaceRoot);
        if (!run.ok) {
            failures.push(`post-check failed: ${cmd}${formatCommandOutput(run.output)}`);
        }
    }
    return failures;
}
function shellCommandFromPostCheck(postCheck) {
    const trimmed = postCheck.trim();
    if (!trimmed.startsWith("$ ") && !trimmed.startsWith("sh: "))
        return null;
    return trimmed.replace(/^\$\s+|^sh:\s+/, "");
}
function formatCommandOutput(output) {
    return output ? `\n${output}` : "";
}
