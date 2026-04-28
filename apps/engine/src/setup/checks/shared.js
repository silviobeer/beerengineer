import { spawn } from "node:child_process";
const TOOL_TIMEOUT_MS = 3_000;
export function createCheck(id, label, status, detail, extra = {}) {
    return { id, label, status, detail, ...extra };
}
export function remedyForTool(tool) {
    const platform = process.platform;
    let ghRemedy;
    if (platform === "darwin") {
        ghRemedy = { hint: "Install GitHub CLI with Homebrew.", command: "brew install gh" };
    }
    else if (platform === "win32") {
        ghRemedy = { hint: "Install GitHub CLI with winget.", command: "winget install GitHub.cli" };
    }
    else {
        ghRemedy = { hint: "Install GitHub CLI from the official docs.", url: "https://cli.github.com/" };
    }
    const sonarScannerRemedy = platform === "darwin"
        ? { hint: "Install sonar-scanner with Homebrew.", command: "brew install sonar-scanner" }
        : { hint: "Install sonar-scanner from SonarSource docs.", url: "https://docs.sonarsource.com/sonarqube-cloud/advanced-setup/analysis-scanner-configuration/" };
    const sonarInstallCommand = platform === "win32"
        ? "irm https://raw.githubusercontent.com/SonarSource/sonarqube-cli/refs/heads/master/user-scripts/install.ps1 | iex"
        : "curl -o- https://raw.githubusercontent.com/SonarSource/sonarqube-cli/refs/heads/master/user-scripts/install.sh | bash";
    return {
        gh: ghRemedy,
        claude: { hint: "Install Claude Code globally with npm.", command: "npm i -g @anthropic-ai/claude-code" },
        codex: { hint: "Install Codex globally with npm.", command: "npm i -g @openai/codex" },
        opencode: { hint: "Install OpenCode per the official install docs.", url: "https://opencode.ai/docs/install" },
        playwright: { hint: "Install Playwright CLI and browser binaries from the official docs.", url: "https://playwright.dev/docs/intro" },
        "agent-browser": { hint: "Install agent-browser per the official repository.", url: "https://github.com/vercel-labs/agent-browser" },
        coderabbit: { hint: "Install CodeRabbit CLI globally with npm.", command: "npm i -g @coderabbit/cli" },
        "sonar-scanner": sonarScannerRemedy,
        sonar: {
            hint: "Install sonarqube-cli from SonarSource (installs the `sonar` binary).",
            command: sonarInstallCommand,
        },
    }[tool];
}
export function probeCommand(command, args = []) {
    return new Promise(resolve => {
        const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
        const stdoutChunks = [];
        const stderrChunks = [];
        const timer = setTimeout(() => {
            child.kill("SIGKILL");
            resolve({ ok: false, detail: `timed out after ${TOOL_TIMEOUT_MS}ms` });
        }, TOOL_TIMEOUT_MS);
        child.stdout.on("data", chunk => stdoutChunks.push(chunk));
        child.stderr.on("data", chunk => stderrChunks.push(chunk));
        child.on("error", err => {
            clearTimeout(timer);
            resolve({ ok: false, detail: err.message });
        });
        child.on("exit", code => {
            clearTimeout(timer);
            const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
            const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
            const outputLine = (stdout || stderr).split(/\r?\n/)[0];
            resolve({
                ok: code === 0,
                version: outputLine || undefined,
                detail: code === 0 ? undefined : outputLine || `exit ${code ?? "unknown"}`,
                stdout: stdout || undefined,
                stderr: stderr || undefined,
            });
        });
    });
}
export function statusIsOk(status) {
    return status === "ok";
}
