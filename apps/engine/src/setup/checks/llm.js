import { createCheck, probeCommand, remedyForTool } from "./shared.js";
export function getActiveLlmGroup(config) {
    return config ? `llm.${config.llm.provider}` : null;
}
export async function runLlmChecks(provider, config) {
    const defs = {
        anthropic: {
            cliId: "llm.anthropic.cli",
            authId: "llm.anthropic.auth",
            label: "Anthropic / Claude Code",
            command: "claude",
            apiKeyRef: config.llm.apiKeyRef || "ANTHROPIC_API_KEY",
        },
        openai: {
            cliId: "llm.openai.cli",
            authId: "llm.openai.auth",
            label: "OpenAI / Codex",
            command: "codex",
            apiKeyRef: config.llm.apiKeyRef || "OPENAI_API_KEY",
        },
        opencode: {
            cliId: "llm.opencode.cli",
            authId: "llm.opencode.auth",
            label: "OpenCode",
            command: "opencode",
            apiKeyRef: config.llm.apiKeyRef || "OPENCODE_API_KEY",
        },
    };
    const def = defs[provider];
    const cli = await probeCommand(def.command, ["--version"]);
    const cliCheck = createCheck(def.cliId, `${def.label} CLI`, cli.ok ? "ok" : "missing", cli.version ?? cli.detail, {
        remedy: cli.ok ? undefined : remedyForTool(def.command),
    });
    if (!cli.ok) {
        return [cliCheck, createCheck(def.authId, `${def.label} auth`, "skipped", `${def.command} CLI is not available`)];
    }
    if (provider === "anthropic")
        return runClaudeChecks(def.apiKeyRef, cliCheck);
    if (provider === "openai")
        return runCodexChecks(def.apiKeyRef, cliCheck);
    const present = Boolean(process.env[def.apiKeyRef]);
    return [
        cliCheck,
        createCheck(def.authId, `${def.label} auth`, present ? "ok" : "missing", present ? `${def.apiKeyRef} is set` : `${def.apiKeyRef} is not set`, present ? {} : { remedy: { hint: `Export ${def.apiKeyRef} before running beerengineer_.` } }),
    ];
}
async function runCodexChecks(apiKeyRef, cliCheck) {
    if (process.env[apiKeyRef]) {
        return [cliCheck, createCheck("llm.openai.auth", "OpenAI / Codex auth", "ok", `${apiKeyRef} is set`)];
    }
    const auth = await probeCommand("codex", ["login", "status"]);
    if (auth.ok) {
        const detail = (auth.stdout ?? auth.version ?? "Codex auth available").split(/\r?\n/)[0];
        return [cliCheck, createCheck("llm.openai.auth", "OpenAI / Codex auth", "ok", detail)];
    }
    return [
        cliCheck,
        createCheck("llm.openai.auth", "OpenAI / Codex auth", "missing", "Codex is not logged in and OPENAI_API_KEY is not set", { remedy: { hint: "Run `codex login`, or export OPENAI_API_KEY before running beerengineer_." } }),
    ];
}
async function runClaudeChecks(apiKeyRef, cliCheck) {
    if (process.env[apiKeyRef]) {
        return [cliCheck, createCheck("llm.anthropic.auth", "Anthropic / Claude Code auth", "ok", `${apiKeyRef} is set`)];
    }
    const auth = await probeCommand("claude", ["auth", "status"]);
    if (!auth.ok) {
        return [
            cliCheck,
            createCheck("llm.anthropic.auth", "Anthropic / Claude Code auth", "missing", "Claude Code is not logged in and ANTHROPIC_API_KEY is not set", { remedy: { hint: "Run `claude`, complete `/login`, or export ANTHROPIC_API_KEY before running beerengineer_." } }),
        ];
    }
    try {
        const parsed = JSON.parse(auth.stdout ?? auth.version ?? "{}");
        if (parsed.loggedIn) {
            const via = parsed.authMethod ? ` via ${parsed.authMethod}` : "";
            const plan = parsed.subscriptionType ? ` (${parsed.subscriptionType})` : "";
            return [cliCheck, createCheck("llm.anthropic.auth", "Anthropic / Claude Code auth", "ok", `Logged in${via}${plan}`)];
        }
    }
    catch {
        // Fall through to a generic success detail when the CLI output is not JSON.
    }
    return [cliCheck, createCheck("llm.anthropic.auth", "Anthropic / Claude Code auth", "ok", auth.version ?? "Claude Code auth available")];
}
