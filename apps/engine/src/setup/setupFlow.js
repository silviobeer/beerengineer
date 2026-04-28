import { mkdirSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { initDatabase } from "../db/connection.js";
import { normalizePublicBaseUrl, readConfigFile, resolveConfigPath, resolveConfiguredDbPath, resolveMergedConfig, resolveOverrides, writeConfigFile, } from "./config.js";
import { doctorExitCode, printDoctorReport } from "./doctorOutput.js";
import { generateSetupReport } from "./doctor.js";
export function needsInitialization(report) {
    return report.groups.some(group => group.id === "core" && group.checks.some(check => check.status === "uninitialized"));
}
export async function runSetupFlow(options = {}) {
    const resolved = resolveOverrides(options.overrides);
    const configPath = resolveConfigPath(resolved);
    let report = await refreshSetupReport(options);
    if (needsInitialization(report)) {
        const initialized = initializeProvisionedState(options.overrides);
        if (!initialized.ok)
            return 1;
        console.log("  App setup initialized config, data dir, and database.");
        report = await refreshSetupReport(options);
    }
    const interactive = !options.noInteractive && Boolean(process.stdin.isTTY && process.stdout.isTTY);
    if (interactive && (!options.group || options.group === "notifications")) {
        await maybeConfigureTelegramInteractive(configPath, buildProvisionedConfig(resolved));
        report = await refreshSetupReport(options);
    }
    while (interactive && report.overall === "blocked") {
        const requiredSatisfied = report.groups.filter(group => group.level === "required").every(group => group.satisfied);
        const action = await promptRetryAction(requiredSatisfied);
        if (action === "quit")
            return doctorExitCode(report);
        if (action === "skip")
            break;
        const next = await generateSetupReport(options);
        diffPrint(report, next);
        report = next;
    }
    if (report.overall !== "blocked")
        console.log("  Next: beerengineer workspace add <path>");
    return doctorExitCode(report);
}
class InvalidConfigError extends Error {
    path;
    reason;
    constructor(path, reason) {
        super(`config at ${path} is invalid: ${reason}`);
        this.path = path;
        this.reason = reason;
    }
}
function buildProvisionedConfig(overrides = {}) {
    const resolved = resolveOverrides(overrides);
    const state = readConfigFile(resolveConfigPath(resolved));
    if (state.kind === "invalid")
        throw new InvalidConfigError(state.path, state.error);
    return resolveMergedConfig(state, resolved);
}
function ensureProvisionedState(overrides = {}) {
    const resolved = resolveOverrides(overrides);
    const configPath = resolveConfigPath(resolved);
    const config = buildProvisionedConfig(resolved);
    mkdirSync(config.dataDir, { recursive: true });
    initDatabase(resolveConfiguredDbPath(config)).close();
    writeConfigFile(configPath, config);
    return config;
}
function initializeProvisionedState(overrides) {
    try {
        ensureProvisionedState(overrides);
        return { ok: true };
    }
    catch (err) {
        if (err instanceof InvalidConfigError) {
            console.error(`  Refusing to overwrite invalid config at ${err.path}: ${err.reason}`);
            console.error("  Fix the file by hand or remove it, then re-run `beerengineer setup`.");
            return { ok: false };
        }
        throw err;
    }
}
async function refreshSetupReport(options) {
    const report = await generateSetupReport(options);
    printDoctorReport(report, { installHints: true });
    return report;
}
async function promptRetryAction(requiredSatisfied) {
    const rl = createInterface({ input, output });
    try {
        const answer = (await rl.question("  [r] retry failed  [a] retry all  [s] skip & continue  [q] quit: ")).trim().toLowerCase();
        if (answer === "r")
            return "retry-failed";
        if (answer === "a")
            return "retry-all";
        if (answer === "q")
            return "quit";
        if (answer === "s" && !requiredSatisfied) {
            const confirm = (await rl.question("  You haven't met a required minimum. Continue anyway? [y/N] ")).trim().toLowerCase();
            return confirm === "y" ? "skip" : "retry-failed";
        }
        return "skip";
    }
    finally {
        rl.close();
    }
}
function diffPrint(previous, next) {
    const previousStatuses = new Map(previous.groups.flatMap(group => group.checks.map(check => [check.id, check.status])));
    for (const group of next.groups) {
        for (const check of group.checks) {
            const before = previousStatuses.get(check.id);
            if (before && before !== "ok" && check.status === "ok")
                console.log(`  + ${check.id} now ok`);
        }
    }
}
async function maybeConfigureTelegramInteractive(configPath, config) {
    if (!(process.stdin.isTTY && process.stdout.isTTY))
        return config;
    const rl = createInterface({ input, output });
    try {
        console.log("");
        console.log("  Telegram can deliver outbound notifications and optional inbound prompt replies.");
        console.log("  Outbound runs on messaging levels: L2 milestones, L1 operational detail, L0 debug detail.");
        console.log("  Inbound is limited to replying to beerengineer_ prompts when enabled.");
        console.log("");
        console.log("  Setup steps:");
        console.log("    1. Open Telegram and talk to @BotFather.");
        console.log("    2. Create a bot and copy its token.");
        console.log("    3. Put that token in an environment variable.");
        console.log("    4. Start a chat with the bot or add it to a group, then send one message.");
        console.log("    5. Find the target chat id.");
        console.log("    6. Set publicBaseUrl to the Tailscale-reachable UI address, never localhost.");
        console.log("");
        const enabled = ["y", "yes"].includes((await rl.question("  Enable Telegram notifications? [y/N] ")).trim().toLowerCase());
        const next = {
            ...config,
            notifications: {
                telegram: {
                    enabled,
                    botTokenEnv: config.notifications?.telegram?.botTokenEnv,
                    defaultChatId: config.notifications?.telegram?.defaultChatId,
                    level: config.notifications?.telegram?.level ?? 2,
                    inbound: {
                        enabled: config.notifications?.telegram?.inbound?.enabled ?? false,
                        webhookSecretEnv: config.notifications?.telegram?.inbound?.webhookSecretEnv,
                    },
                },
            },
        };
        const telegram = next.notifications.telegram;
        if (!enabled) {
            writeConfigFile(configPath, next);
            return next;
        }
        next.publicBaseUrl = await promptTelegramPublicBaseUrl(rl, next.publicBaseUrl);
        const tokenEnvAnswer = (await rl.question(`  Telegram bot token env var [${telegram.botTokenEnv ?? "TELEGRAM_BOT_TOKEN"}]: `)).trim();
        next.notifications.telegram = {
            ...telegram,
            enabled: true,
            botTokenEnv: tokenEnvAnswer || telegram.botTokenEnv || "TELEGRAM_BOT_TOKEN",
        };
        await promptTelegramLevel(rl, next);
        await promptTelegramChatId(rl, next);
        const configuredTelegram = next.notifications?.telegram;
        if (!configuredTelegram)
            throw new Error("Telegram config missing during interactive setup");
        configuredTelegram.inbound = {
            ...configuredTelegram.inbound,
            enabled: await promptTelegramInboundEnabled(rl, configuredTelegram),
        };
        if (configuredTelegram.inbound.enabled) {
            const secretEnvAnswer = (await rl.question(`  Telegram webhook secret env var [${configuredTelegram.inbound?.webhookSecretEnv ?? "TELEGRAM_WEBHOOK_SECRET"}]: `)).trim();
            if (!configuredTelegram.inbound)
                throw new Error("Telegram inbound config missing during interactive setup");
            configuredTelegram.inbound.webhookSecretEnv = secretEnvAnswer || configuredTelegram.inbound.webhookSecretEnv || "TELEGRAM_WEBHOOK_SECRET";
        }
        writeConfigFile(configPath, next);
        console.log("");
        console.log("  Next steps:");
        console.log(`    export ${configuredTelegram.botTokenEnv ?? "TELEGRAM_BOT_TOKEN"}=<telegram-bot-token>`);
        if (configuredTelegram.inbound?.enabled && configuredTelegram.inbound?.webhookSecretEnv) {
            console.log(`    export ${configuredTelegram.inbound.webhookSecretEnv}=<telegram-webhook-secret>`);
        }
        console.log(`    publicBaseUrl is set to ${next.publicBaseUrl}`);
        console.log(`    Telegram level is L${configuredTelegram.level ?? 2}`);
        console.log("    Start the UI on the same host/port so Telegram links stay reachable over Tailscale.");
        console.log("");
        return next;
    }
    finally {
        rl.close();
    }
}
async function promptTelegramPublicBaseUrl(rl, current) {
    while (true) {
        const candidate = (await rl.question(`  Public base URL [${current ?? "http://100.x.y.z:3100"}]: `)).trim() || current || "http://100.x.y.z:3100";
        try {
            return normalizePublicBaseUrl(candidate);
        }
        catch (err) {
            console.log(`  ${String(err.message)}`);
        }
    }
}
async function promptTelegramLevel(rl, config) {
    while (true) {
        const configuredTelegram = config.notifications?.telegram;
        if (!configuredTelegram)
            throw new Error("Telegram config missing during interactive setup");
        const currentLevel = configuredTelegram.level ?? 2;
        const candidate = (await rl.question(`  Telegram message level [${currentLevel}] (0=debug, 1=ops, 2=milestones): `)).trim() || String(currentLevel);
        if (candidate === "0" || candidate === "1" || candidate === "2") {
            configuredTelegram.level = Number(candidate);
            return;
        }
        console.log("  Telegram message level must be 0, 1, or 2.");
    }
}
async function promptTelegramChatId(rl, config) {
    while (true) {
        const currentTelegram = config.notifications?.telegram;
        if (!currentTelegram)
            throw new Error("Telegram config missing during interactive setup");
        const chatId = (await rl.question(`  Telegram chat id [${currentTelegram.defaultChatId ?? ""}]: `)).trim() || currentTelegram.defaultChatId;
        if (chatId) {
            currentTelegram.defaultChatId = chatId;
            return;
        }
        console.log("  Telegram chat id is required when notifications are enabled.");
    }
}
async function promptTelegramInboundEnabled(rl, configuredTelegram) {
    const answer = (await rl.question(`  Enable Telegram inbound prompt replies? [${configuredTelegram.inbound?.enabled ? "Y/n" : "y/N"}] `)).trim().toLowerCase();
    return answer === "" ? configuredTelegram.inbound?.enabled === true : answer === "y" || answer === "yes";
}
