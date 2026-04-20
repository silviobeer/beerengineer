// @ts-nocheck

import { execFileSync, spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadAgentRuntimeConfig } from "../adapters/runtime.js";
import { workspaceSetupAssistOutputSchema } from "../schemas/output-contracts.js";
import { AppError } from "../shared/errors.js";
import { parseDotEnv } from "./env-config.js";
const beerengineerOwnedDirectories = [".beerengineer", ".beerengineer/artifacts"];
const beerengineerGitignoreEntry = "# beerengineer worktrees (managed by beerengineer CLI)\n.beerengineer/worktrees/\n";
const supportedProjectManifestFiles = ["package.json", "pyproject.toml", "requirements.txt", "go.mod", "Cargo.toml"];
const setupAutonomyOrder = {
    safe: 0,
    "workspace-write": 1,
    "setup-capable": 2
};
export class WorkspaceSetupService {
    input;
    constructor(input) {
        this.input = input;
    }
    doctor() {
        const checks = {
            agentHarness: [],
            filesystem: [],
            git: [],
            runtime: [],
            quality: [],
            integrations: []
        };
        const missing = [];
        const suggestedActions = [];
        const autoFixable = [];
        const runtimeDetection = this.detectRuntimeConfig();
        const harnesses = this.detectHarnesses(runtimeDetection);
        checks.agentHarness.push(...this.buildAgentHarnessChecks(runtimeDetection, harnesses));
        checks.filesystem.push(...this.buildFilesystemChecks());
        checks.git.push(...this.buildGitChecks());
        checks.runtime.push(...this.buildRuntimeChecks());
        checks.quality.push(...this.buildQualityChecks());
        checks.integrations.push(...this.buildIntegrationChecks());
        for (const check of Object.values(checks).flat()) {
            if (check.status === "missing" || check.status === "blocked") {
                missing.push(check.message);
            }
            if (check.status === "missing" || check.status === "blocked" || check.status === "warning") {
                const action = this.suggestActionForCheck(check.id);
                if (action) {
                    suggestedActions.push(action);
                }
                const autoFix = this.autoFixForCheck(check.id);
                if (autoFix) {
                    autoFixable.push(autoFix);
                }
            }
        }
        return {
            workspace: {
                key: this.input.workspace.key,
                name: this.input.workspace.name,
                rootPath: this.input.workspaceRoot,
                rootPathSource: this.input.rootPathSource,
                agentRuntimeConfigPath: this.input.agentRuntimeConfigPath
            },
            status: this.deriveOverallStatus(runtimeDetection, harnesses, checks),
            checks: this.deduplicateCheckLists(checks),
            harnesses,
            missing: Array.from(new Set(missing)),
            suggestedActions: Array.from(new Set(suggestedActions)),
            autoFixable: Array.from(new Set(autoFixable))
        };
    }
    init(input) {
        const workspaceRoot = this.requireWorkspaceRoot();
        const actions = [];
        const rootExists = existsSync(workspaceRoot);
        if (!rootExists && !input.createRoot) {
            throw new AppError("WORKSPACE_ROOT_MISSING", `Workspace root ${workspaceRoot} does not exist. Use --create-root to create it.`);
        }
        if (!rootExists && input.createRoot) {
            actions.push(input.dryRun
                ? { id: "create-root", status: "simulated", message: `Would create workspace root ${workspaceRoot}.`, path: workspaceRoot }
                : this.createDirectoryAction("create-root", workspaceRoot, `Created workspace root ${workspaceRoot}.`));
        }
        for (const relativePath of beerengineerOwnedDirectories) {
            const absolutePath = resolve(workspaceRoot, relativePath);
            const id = `ensure-${relativePath.replaceAll("/", "-")}`;
            if (existsSync(absolutePath)) {
                actions.push({ id, status: "skipped", message: `${absolutePath} already exists.`, path: absolutePath });
                continue;
            }
            actions.push(input.dryRun
                ? { id, status: "simulated", message: `Would create ${absolutePath}.`, path: absolutePath }
                : this.createDirectoryAction(id, absolutePath, `Created ${absolutePath}.`));
        }
        actions.push(...this.ensureGitignoreContains({
            id: "ensure-beerengineer-worktrees-gitignore",
            path: resolve(workspaceRoot, ".gitignore"),
            entry: beerengineerGitignoreEntry,
            dryRun: input.dryRun
        }));
        const gitRepoCheck = this.isGitRepository(workspaceRoot);
        if (input.initGit && !gitRepoCheck.isRepository) {
            actions.push(input.dryRun
                ? { id: "git-init", status: "simulated", message: `Would initialize a git repository in ${workspaceRoot}.`, command: ["git", "init", "-b", "main"] }
                : this.gitInitAction(workspaceRoot));
        }
        else if (gitRepoCheck.isRepository) {
            actions.push({
                id: "git-init",
                status: "skipped",
                message: `${workspaceRoot} is already a git repository.`,
                command: ["git", "init", "-b", "main"]
            });
        }
        return {
            workspace: { key: this.input.workspace.key, rootPath: workspaceRoot },
            dryRun: input.dryRun,
            actions
        };
    }
    async startOrReuseAssistSession(input) {
        const existing = this.requireAssistSessionRepository().findOpenByWorkspaceId(this.input.workspace.id);
        if (existing) {
            return this.showAssistSession(existing.id);
        }
        return this.createAssistSession(input);
    }
    showAssistSession(sessionId) {
        const sessionRepository = this.requireAssistSessionRepository();
        const messageRepository = this.requireAssistMessageRepository();
        const session = sessionId
            ? sessionRepository.getById(sessionId)
            : sessionRepository.getLatestByWorkspaceId(this.input.workspace.id);
        if (!session) {
            throw new AppError("WORKSPACE_ASSIST_SESSION_NOT_FOUND", "No workspace assist session was found.");
        }
        return {
            session,
            messages: messageRepository.listBySessionId(session.id),
            currentPlan: this.parseStoredPlan(session.currentPlanJson),
            recommendedNextCommand: this.formatNextAssistCommand(session)
        };
    }
    listAssistSessions() {
        const sessionRepository = this.requireAssistSessionRepository();
        const messageRepository = this.requireAssistMessageRepository();
        const sessions = sessionRepository.listByWorkspaceId(this.input.workspace.id);
        const latestSessionId = sessions[0]?.id ?? null;
        const openSessionId = sessionRepository.findOpenByWorkspaceId(this.input.workspace.id)?.id ?? null;
        return sessions.map((session) => ({
            session,
            currentPlan: this.parseStoredPlan(session.currentPlanJson),
            messageCount: messageRepository.listBySessionId(session.id).length,
            isLatest: session.id === latestSessionId,
            isOpen: session.status === "open",
            recommendedForBootstrap: session.id === openSessionId,
            recommendedNextCommand: session.id === openSessionId ? this.formatBootstrapCommand(session.id) : null
        }));
    }
    async chatAssistSession(input) {
        const sessionRepository = this.requireAssistSessionRepository();
        const messageRepository = this.requireAssistMessageRepository();
        const session = sessionRepository.getById(input.sessionId);
        if (!session) {
            throw new AppError("WORKSPACE_ASSIST_SESSION_NOT_FOUND", `Workspace assist session ${input.sessionId} not found.`);
        }
        const userMessage = messageRepository.create({
            sessionId: session.id,
            role: "user",
            content: input.message,
            structuredPayloadJson: null,
            derivedPlanJson: null
        });
        sessionRepository.update(session.id, { lastUserMessageId: userMessage.id });
        const assisted = await this.assistWithAgent({
            runtime: input.runtime,
            userMessage: input.message,
            currentPlan: this.parseStoredPlan(session.currentPlanJson)
        });
        const assistantMessage = messageRepository.create({
            sessionId: session.id,
            role: "assistant",
            content: assisted.assistantMessage,
            structuredPayloadJson: JSON.stringify({
                rationale: assisted.rationale,
                warnings: assisted.warnings,
                needsUserInput: assisted.needsUserInput,
                followUpHint: assisted.followUpHint,
                runtime: assisted.runtime
            }, null, 2),
            derivedPlanJson: JSON.stringify(assisted.plan, null, 2)
        });
        sessionRepository.update(session.id, {
            currentPlanJson: JSON.stringify(assisted.plan, null, 2),
            lastAssistantMessageId: assistantMessage.id
        });
        return this.showAssistSession(session.id);
    }
    resolveAssistSession(input) {
        const sessionRepository = this.requireAssistSessionRepository();
        const session = sessionRepository.getById(input.sessionId);
        if (!session) {
            throw new AppError("WORKSPACE_ASSIST_SESSION_NOT_FOUND", `Workspace assist session ${input.sessionId} not found.`);
        }
        if (session.status !== "open") {
            throw new AppError("WORKSPACE_ASSIST_SESSION_NOT_OPEN", `Workspace assist session ${input.sessionId} is already ${session.status}.`);
        }
        sessionRepository.update(session.id, { status: "resolved", resolvedAt: Date.now() });
        return this.showAssistSession(session.id);
    }
    cancelAssistSession(input) {
        const sessionRepository = this.requireAssistSessionRepository();
        const session = sessionRepository.getById(input.sessionId);
        if (!session) {
            throw new AppError("WORKSPACE_ASSIST_SESSION_NOT_FOUND", `Workspace assist session ${input.sessionId} not found.`);
        }
        if (session.status !== "open") {
            throw new AppError("WORKSPACE_ASSIST_SESSION_NOT_OPEN", `Workspace assist session ${input.sessionId} is already ${session.status}.`);
        }
        sessionRepository.update(session.id, { status: "cancelled", resolvedAt: Date.now() });
        return this.showAssistSession(session.id);
    }
    bootstrap(input) {
        if (input.stack !== "node-ts" && input.stack !== "python") {
            throw new AppError("UNSUPPORTED_WORKSPACE_STACK", `Workspace bootstrap stack ${input.stack} is not supported.`);
        }
        if (input.installDeps && !this.findSetupCapableHarness(this.doctor().harnesses)) {
            throw new AppError("WORKSPACE_BOOTSTRAP_SETUP_CAPABILITY_REQUIRED", "workspace:bootstrap --install-deps requires a setup-capable Codex or Claude runtime policy.");
        }
        const initResult = this.init({ createRoot: input.createRoot, initGit: input.initGit, dryRun: input.dryRun });
        const workspaceRoot = this.requireWorkspaceRoot();
        const actions = [...initResult.actions];
        const packageName = this.toPackageName(this.input.workspace.key);
        if (input.scaffoldProjectFiles) {
            actions.push(...this.ensureFile({
                id: "bootstrap-readme",
                path: resolve(workspaceRoot, "README.md"),
                content: `# ${this.input.workspace.name}\n\nBootstrapped by BeerEngineer.\n`,
                dryRun: input.dryRun
            }));
            if (input.stack === "node-ts") {
                actions.push(...this.ensureFile({
                    id: "bootstrap-gitignore",
                    path: resolve(workspaceRoot, ".gitignore"),
                    content: "node_modules/\ndist/\ncoverage/\n.beerengineer/\n.env.local\n",
                    dryRun: input.dryRun
                }), ...this.ensureFile({
                    id: "bootstrap-package-json",
                    path: resolve(workspaceRoot, "package.json"),
                    content: `${JSON.stringify({
                        name: packageName,
                        version: "0.1.0",
                        private: true,
                        type: "module",
                        scripts: { build: "tsc -p tsconfig.json", start: "node dist/index.js" },
                        devDependencies: { "@types/node": "^24.6.0", typescript: "^5.9.3" }
                    }, null, 2)}\n`,
                    dryRun: input.dryRun
                }), ...this.ensureFile({
                    id: "bootstrap-tsconfig-json",
                    path: resolve(workspaceRoot, "tsconfig.json"),
                    content: `${JSON.stringify({
                        compilerOptions: {
                            target: "ES2022",
                            module: "NodeNext",
                            moduleResolution: "NodeNext",
                            rootDir: "src",
                            outDir: "dist",
                            strict: true,
                            noEmitOnError: true,
                            esModuleInterop: true,
                            forceConsistentCasingInFileNames: true,
                            skipLibCheck: true,
                            types: ["node"]
                        },
                        include: ["src/**/*.ts"],
                        exclude: ["dist", "node_modules"]
                    }, null, 2)}\n`,
                    dryRun: input.dryRun
                }), ...this.ensureFile({
                    id: "bootstrap-src-index",
                    path: resolve(workspaceRoot, "src", "index.ts"),
                    content: `export function main(): void {\n  console.log("Hello from ${packageName}");\n}\n\nmain();\n`,
                    dryRun: input.dryRun,
                    ensureParentDirectory: true
                }));
            }
            else {
                actions.push(...this.ensureFile({
                    id: "bootstrap-gitignore",
                    path: resolve(workspaceRoot, ".gitignore"),
                    content: "__pycache__/\n.pytest_cache/\n.venv/\n.beerengineer/\n.env\n",
                    dryRun: input.dryRun
                }), ...this.ensureFile({
                    id: "bootstrap-pyproject-toml",
                    path: resolve(workspaceRoot, "pyproject.toml"),
                    content: `[project]\nname = "${packageName}"\nversion = "0.1.0"\ndescription = "${this.input.workspace.name}"\nrequires-python = ">=3.11"\n\n` +
                        `[build-system]\nrequires = ["setuptools>=68"]\nbuild-backend = "setuptools.build_meta"\n`,
                    dryRun: input.dryRun
                }), ...this.ensureFile({
                    id: "bootstrap-python-main",
                    path: resolve(workspaceRoot, "src", "main.py"),
                    content: `def main() -> None:\n    print("Hello from ${packageName}")\n\n\nif __name__ == "__main__":\n    main()\n`,
                    dryRun: input.dryRun,
                    ensureParentDirectory: true
                }));
            }
        }
        else {
            actions.push({
                id: "bootstrap-project-scaffold",
                status: "skipped",
                message: "Skipped project scaffold because an existing project manifest was detected."
            });
        }
        if (input.withSonar) {
            actions.push(...this.ensureFile({
                id: "bootstrap-sonar-project",
                path: resolve(workspaceRoot, "sonar-project.properties"),
                content: [`sonar.projectKey=${this.input.workspace.key}`, `sonar.projectName=${this.input.workspace.name}`, "sonar.sources=src", "sonar.tests=test", "sonar.sourceEncoding=UTF-8"].join("\n") +
                    "\n",
                dryRun: input.dryRun
            }));
        }
        if (input.withCoderabbit) {
            actions.push(...this.ensureFile({
                id: "bootstrap-coderabbit-md",
                path: resolve(workspaceRoot, "coderabbit.md"),
                content: `# CodeRabbit Instructions\n\nProject-specific review guidance for ${this.input.workspace.name}.\n`,
                dryRun: input.dryRun
            }));
        }
        if (input.installDeps) {
            const installCommand = this.installDependenciesCommand(input.stack);
            actions.push(input.dryRun
                ? {
                    id: "bootstrap-install-deps",
                    status: "simulated",
                    message: `Would run ${installCommand.join(" ")} in ${workspaceRoot}.`,
                    command: installCommand
                }
                : this.installDependenciesAction(workspaceRoot, input.stack));
        }
        return { workspace: initResult.workspace, dryRun: input.dryRun, actions };
    }
    loadBootstrapPlan(planPath) {
        return this.loadParsedBootstrapPlan(JSON.parse(readFileSync(planPath, "utf8")), planPath);
    }
    loadBootstrapPlanFromAssistSession(sessionId) {
        const sessionView = this.showAssistSession(sessionId);
        return this.loadParsedBootstrapPlan(sessionView.currentPlan, `workspace assist session ${sessionView.session.id}`);
    }
    loadBootstrapPlanFromOpenAssistSession() {
        const session = this.requireAssistSessionRepository().findOpenByWorkspaceId(this.input.workspace.id);
        return session ? this.loadBootstrapPlanFromAssistSession(session.id) : null;
    }
    deduplicateCheckLists(checks) {
        const unique = (entries) => entries.filter((entry, index) => entries.findIndex((candidate) => candidate.id === entry.id) === index);
        return {
            agentHarness: unique(checks.agentHarness),
            filesystem: unique(checks.filesystem),
            git: unique(checks.git),
            runtime: unique(checks.runtime),
            quality: unique(checks.quality),
            integrations: unique(checks.integrations)
        };
    }
    deriveOverallStatus(runtimeDetection, harnesses, checks) {
        if (!runtimeDetection.ok) {
            return "blocked";
        }
        if (Object.values(checks).flat().some((check) => check.status === "blocked")) {
            return "blocked";
        }
        const realHarnesses = harnesses.filter((harness) => harness.providerKey !== "local");
        if (realHarnesses.every((harness) => !harness.installed)) {
            return "limited";
        }
        if (Object.values(checks).flat().some((check) => check.status === "warning" || check.status === "missing")) {
            return "warning";
        }
        return "ready";
    }
    buildAgentHarnessChecks(runtimeDetection, harnesses) {
        if (!runtimeDetection.ok) {
            return [{ id: "agent-runtime-config", status: "blocked", message: runtimeDetection.errorMessage, details: { errorCode: runtimeDetection.errorCode } }];
        }
        const checks = [
            {
                id: "agent-runtime-config",
                status: "ok",
                message: `Loaded agent runtime config from ${this.input.agentRuntimeConfigPath}.`,
                details: { defaultProvider: runtimeDetection.defaultProvider }
            }
        ];
        if (runtimeDetection.parseWarning) {
            checks.push({ id: "agent-runtime-config-warning", status: "warning", message: runtimeDetection.parseWarning });
        }
        for (const harness of harnesses) {
            checks.push({
                id: `harness-${harness.providerKey}`,
                status: harness.status,
                message: harness.message,
                details: {
                    providerKey: harness.providerKey,
                    active: harness.active,
                    autonomyLevel: harness.autonomyLevel,
                    command: harness.command
                }
            });
        }
        return checks;
    }
    buildFilesystemChecks() {
        if (!this.input.workspaceRoot) {
            return [{ id: "workspace-root-configured", status: "missing", message: "Workspace root path is not configured." }];
        }
        const workspaceRoot = this.input.workspaceRoot;
        const checks = [{ id: "workspace-root-configured", status: "ok", message: `Workspace root is set to ${workspaceRoot}.` }];
        if (!existsSync(workspaceRoot)) {
            checks.push({ id: "workspace-root-exists", status: "missing", message: `Workspace root ${workspaceRoot} does not exist.` });
            return checks;
        }
        checks.push({ id: "workspace-root-exists", status: "ok", message: `Workspace root ${workspaceRoot} exists.` });
        try {
            accessSync(workspaceRoot, constants.W_OK);
            checks.push({ id: "workspace-root-writable", status: "ok", message: `Workspace root ${workspaceRoot} is writable.` });
        }
        catch {
            checks.push({ id: "workspace-root-writable", status: "blocked", message: `Workspace root ${workspaceRoot} is not writable.` });
        }
        for (const relativePath of beerengineerOwnedDirectories) {
            const absolutePath = resolve(workspaceRoot, relativePath);
            const present = existsSync(absolutePath);
            checks.push({
                id: `filesystem-${relativePath}`,
                status: present ? "ok" : "missing",
                message: present ? `${absolutePath} exists.` : `${absolutePath} is missing.`
            });
        }
        const projectState = this.detectProjectState();
        checks.push({
            id: "project-manifest",
            status: projectState.manifest ? "ok" : "warning",
            message: projectState.manifest ? `Detected project manifest ${projectState.manifest}.` : "No known project manifest detected."
        });
        checks.push({
            id: "project-tsconfig",
            status: projectState.tsconfig ? "ok" : "not_applicable",
            message: projectState.tsconfig ? "tsconfig.json exists." : "tsconfig.json not detected."
        });
        checks.push({
            id: "project-detection",
            status: projectState.isBrownfield ? "ok" : "warning",
            message: projectState.isBrownfield
                ? `Detected brownfield project signals: ${projectState.brownfieldSignals.join(", ")}.`
                : "No strong brownfield project signals detected."
        });
        return checks;
    }
    buildGitChecks() {
        const gitBinary = this.checkBinary("git");
        const checks = [{ id: "git-binary", status: gitBinary.status, message: gitBinary.message }];
        if (!this.input.workspaceRoot || !existsSync(this.input.workspaceRoot)) {
            checks.push({ id: "git-repository", status: "not_applicable", message: "Git repository check skipped because the workspace root is missing." });
            return checks;
        }
        if (gitBinary.status !== "ok") {
            checks.push({ id: "git-repository", status: "blocked", message: "Git repository check blocked because git is not available." });
            return checks;
        }
        const gitRepo = this.isGitRepository(this.input.workspaceRoot);
        checks.push({
            id: "git-repository",
            status: gitRepo.isRepository ? "ok" : "missing",
            message: gitRepo.isRepository ? `${this.input.workspaceRoot} is a git repository.` : `No git repository found at ${this.input.workspaceRoot}.`,
            details: gitRepo.details
        });
        if (gitRepo.isRepository) {
            const remoteOrigin = this.detectGitRemoteOrigin(this.input.workspaceRoot);
            checks.push({
                id: "git-remote-origin",
                status: remoteOrigin ? "ok" : "warning",
                message: remoteOrigin ? `Git remote origin is ${remoteOrigin}.` : "Git remote origin is not configured."
            });
        }
        return checks;
    }
    buildRuntimeChecks() {
        return [this.checkBinary("node"), this.checkBinary("npm"), this.checkBinary("sonar-scanner")].map((entry) => ({
            id: `${entry.binary}-binary`,
            status: entry.status,
            message: entry.message
        }));
    }
    buildQualityChecks() {
        if (!this.input.workspaceRoot || !existsSync(this.input.workspaceRoot)) {
            return [
                { id: "sonar-project-file", status: "not_applicable", message: "sonar-project.properties check skipped because the workspace root is missing." },
                { id: "coderabbit-instructions-file", status: "not_applicable", message: "coderabbit.md check skipped because the workspace root is missing." }
            ];
        }
        const sonarPath = resolve(this.input.workspaceRoot, "sonar-project.properties");
        const coderabbitPath = resolve(this.input.workspaceRoot, "coderabbit.md");
        return [
            {
                id: "sonar-project-file",
                status: existsSync(sonarPath) ? "ok" : "missing",
                message: existsSync(sonarPath) ? "sonar-project.properties exists." : "sonar-project.properties is missing."
            },
            {
                id: "coderabbit-instructions-file",
                status: existsSync(coderabbitPath) ? "ok" : "missing",
                message: existsSync(coderabbitPath) ? "coderabbit.md exists." : "coderabbit.md is missing."
            }
        ];
    }
    buildIntegrationChecks() {
        const envConfig = this.input.workspaceRoot && existsSync(this.input.workspaceRoot)
            ? parseDotEnv(resolve(this.input.workspaceRoot, ".env.local"))
            : {};
        const sonarInput = {
            hasStoredConfig: Boolean(this.input.sonarSettings?.hostUrl && this.input.sonarSettings?.organization && this.input.sonarSettings?.projectKey),
            hasToken: Boolean(this.input.sonarSettings?.token),
            envFallback: Boolean(envConfig.SONAR_HOST_URL || envConfig.SONAR_ORGANIZATION || envConfig.SONAR_PROJECT_KEY || envConfig.SONAR_TOKEN)
        };
        const coderabbitInput = {
            hasStoredConfig: Boolean(this.input.coderabbitSettings?.hostUrl && this.input.coderabbitSettings?.organization && this.input.coderabbitSettings?.repository),
            hasToken: Boolean(this.input.coderabbitSettings?.token),
            envFallback: Boolean(envConfig.CODERABBIT_HOST_URL || envConfig.CODERABBIT_ORGANIZATION || envConfig.CODERABBIT_REPOSITORY || envConfig.CODERABBIT_TOKEN)
        };
        return [
            { id: "sonar-config", status: this.integrationStatus(sonarInput), message: this.integrationMessage("Sonar", sonarInput) },
            { id: "coderabbit-config", status: this.integrationStatus(coderabbitInput), message: this.integrationMessage("Coderabbit", coderabbitInput) }
        ];
    }
    integrationStatus(input) {
        if (input.hasStoredConfig && input.hasToken) {
            return "ok";
        }
        if (input.envFallback) {
            return "warning";
        }
        return "missing";
    }
    integrationMessage(label, input) {
        if (input.hasStoredConfig && input.hasToken) {
            return `${label} workspace configuration is stored in the database.`;
        }
        if (input.envFallback) {
            return `${label} is only configured via .env.local fallback.`;
        }
        return `${label} configuration is missing.`;
    }
    detectRuntimeConfig() {
        try {
            const parsedJson = loadAgentRuntimeConfig(this.input.agentRuntimeConfigPath);
            const activeProviders = new Set();
            const selections = [
                parsedJson.defaultProvider,
                parsedJson.defaults?.interactive?.provider,
                parsedJson.defaults?.autonomous?.provider,
                parsedJson.interactive?.brainstorm_chat?.provider,
                parsedJson.interactive?.story_review_chat?.provider,
                ...Object.values(parsedJson.stages ?? {}).map((selection) => selection?.provider),
                ...Object.values(parsedJson.workers ?? {}).map((selection) => selection?.provider)
            ].filter((value) => Boolean(value));
            for (const selection of selections) {
                activeProviders.add(selection);
            }
            return { ok: true, config: parsedJson, defaultProvider: parsedJson.defaultProvider, activeProviders, parseWarning: null };
        }
        catch (error) {
            if (error instanceof SyntaxError) {
                return { ok: false, errorCode: "AGENT_RUNTIME_CONFIG_PARSE_ERROR", errorMessage: `Agent runtime config ${this.input.agentRuntimeConfigPath} contains invalid JSON.` };
            }
            if (error instanceof AppError) {
                return { ok: false, errorCode: error.code, errorMessage: error.message };
            }
            const code = error instanceof Error ? error.code : undefined;
            if (code === "ENOENT") {
                return { ok: false, errorCode: "AGENT_RUNTIME_CONFIG_NOT_FOUND", errorMessage: `Agent runtime config ${this.input.agentRuntimeConfigPath} could not be read.` };
            }
            return { ok: false, errorCode: "AGENT_RUNTIME_CONFIG_INVALID", errorMessage: error instanceof Error ? error.message : "Agent runtime config could not be parsed." };
        }
    }
    detectHarnesses(runtimeDetection) {
        const providerKeys = ["local", "codex", "claude"];
        if (!runtimeDetection.ok) {
            return providerKeys.map((providerKey) => ({
                providerKey,
                adapterKey: null,
                command: null,
                configured: false,
                installed: false,
                active: false,
                interactiveCapable: false,
                workspaceWriteCapable: false,
                setupCapable: false,
                autonomyLevel: "safe",
                status: "blocked",
                message: `${providerKey} harness detection skipped because runtime config is invalid.`,
                errorCode: runtimeDetection.errorCode,
                errorMessage: runtimeDetection.errorMessage
            }));
        }
        const autonomyLevel = this.resolveAutonomyLevel(runtimeDetection);
        return providerKeys.map((providerKey) => {
            const providerConfig = runtimeDetection.config.providers[providerKey];
            const configured = Boolean(providerConfig);
            const binaryName = providerConfig?.command[0] ?? null;
            const binaryCheck = binaryName
                ? this.checkBinary(binaryName)
                : { binary: providerKey, status: "missing", message: `${providerKey} is not configured.` };
            const active = runtimeDetection.activeProviders.has(providerKey);
            const isRealHarness = providerKey === "codex" || providerKey === "claude";
            const installed = binaryCheck.status === "ok";
            const interactiveCapable = isRealHarness && configured && installed;
            const workspaceWriteCapable = interactiveCapable && setupAutonomyOrder[autonomyLevel] >= setupAutonomyOrder["workspace-write"];
            const setupCapable = interactiveCapable && setupAutonomyOrder[autonomyLevel] >= setupAutonomyOrder["setup-capable"];
            const status = !configured ? "missing" : installed ? "ok" : active ? "warning" : "missing";
            return {
                providerKey,
                adapterKey: providerConfig?.adapterKey ?? null,
                command: providerConfig?.command ?? null,
                configured,
                installed,
                active,
                interactiveCapable,
                workspaceWriteCapable,
                setupCapable,
                autonomyLevel,
                status,
                message: !configured
                    ? `${providerKey} harness is not configured in the runtime config.`
                    : installed
                        ? `${providerKey} harness is configured and its command is available.`
                        : `${providerKey} harness is configured but its command is not available.`,
                errorCode: null,
                errorMessage: null
            };
        });
    }
    resolveAutonomyLevel(runtimeDetection) {
        const policy = runtimeDetection.config.policy;
        if (policy.autonomyMode === "yolo" && policy.approvalMode === "never" && policy.filesystemMode === "danger-full-access" && policy.networkMode === "enabled") {
            return "setup-capable";
        }
        if (policy.autonomyMode === "yolo" && (policy.filesystemMode === "workspace-write" || policy.filesystemMode === "danger-full-access")) {
            return "workspace-write";
        }
        return "safe";
    }
    checkBinary(binary) {
        const result = spawnSync("which", [binary], { encoding: "utf8" });
        return result.status === 0 ? { binary, status: "ok", message: `${binary} is available.` } : { binary, status: "missing", message: `${binary} is not available on PATH.` };
    }
    isGitRepository(workspaceRoot) {
        const dotGitPath = resolve(workspaceRoot, ".git");
        if (!existsSync(dotGitPath)) {
            return { isRepository: false, details: { reason: ".git is missing" } };
        }
        try {
            const output = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: workspaceRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
            return { isRepository: output === "true", details: { dotGitType: lstatSync(dotGitPath).isDirectory() ? "directory" : "file" } };
        }
        catch (error) {
            return { isRepository: false, details: { reason: error instanceof Error ? error.message : String(error) } };
        }
    }
    suggestActionForCheck(id) {
        switch (id) {
            case "agent-runtime-config":
            case "agent-runtime-config-warning":
                return "Fix the agent runtime configuration file.";
            case "harness-codex":
                return "Install Codex CLI or configure a different primary harness.";
            case "harness-claude":
                return "Install Claude Code or remove its active runtime selection.";
            case "workspace-root-configured":
                return "Set a workspace root via workspace:update-root or --workspace-root.";
            case "workspace-root-exists":
                return "Create the workspace root directory or run workspace:init --create-root.";
            case "workspace-root-writable":
                return "Fix workspace root permissions.";
            case "filesystem-.beerengineer":
            case "filesystem-.beerengineer/artifacts":
                return "Run workspace:init to create BeerEngineer runtime directories.";
            case "project-manifest":
                return "Create a project manifest or use workspace:bootstrap for a new project.";
            case "git-binary":
                return "Install git.";
            case "git-repository":
                return "Initialize a git repository with workspace:init --init-git.";
            case "git-remote-origin":
                return "Add a git remote origin for brownfield repository tracking.";
            case "node-binary":
                return "Install Node.js.";
            case "npm-binary":
                return "Install npm.";
            case "sonar-scanner-binary":
                return "Install sonar-scanner if Sonar checks are required.";
            case "sonar-project-file":
                return "Add sonar-project.properties if this workspace should use Sonar.";
            case "coderabbit-instructions-file":
                return "Add coderabbit.md if this workspace should use CodeRabbit review instructions.";
            case "sonar-config":
                return "Persist Sonar settings with beerengineer sonar config set.";
            case "coderabbit-config":
                return "Persist Coderabbit settings with beerengineer coderabbit config set.";
            default:
                return null;
        }
    }
    autoFixForCheck(id) {
        switch (id) {
            case "workspace-root-exists":
                return "workspace:init --create-root";
            case "filesystem-.beerengineer":
            case "filesystem-.beerengineer/artifacts":
                return "workspace:init";
            case "git-repository":
                return "workspace:init --init-git";
            default:
                return null;
        }
    }
    loadParsedBootstrapPlan(parsed, source) {
        const validated = workspaceSetupAssistOutputSchema.shape.plan.safeParse(parsed);
        if (!validated.success || validated.data.workspaceKey !== this.input.workspace.key) {
            throw new AppError("WORKSPACE_BOOTSTRAP_PLAN_INVALID", `Bootstrap plan ${source} is invalid for workspace ${this.input.workspace.key}.`);
        }
        return validated.data;
    }
    buildSuggestedPlan(doctor) {
        const rootPath = this.input.workspaceRoot;
        const hasGitRepo = doctor.checks.git.some((check) => check.id === "git-repository" && check.status === "ok");
        const projectState = this.detectProjectState();
        return {
            version: 1,
            workspaceKey: this.input.workspace.key,
            rootPath,
            mode: projectState.isBrownfield ? "brownfield" : "greenfield",
            stack: projectState.manifest === "pyproject.toml" || projectState.manifest === "requirements.txt" ? "python" : "node-ts",
            scaffoldProjectFiles: !projectState.isBrownfield,
            createRoot: !rootPath || !existsSync(rootPath),
            initGit: !hasGitRepo,
            installDeps: false,
            withSonar: !projectState.sonarProjectFile,
            withCoderabbit: !projectState.coderabbitInstructionsFile,
            generatedAt: Date.now()
        };
    }
    async assistWithAgent(input) {
        const doctor = this.doctor();
        if (!this.findInteractiveHarness(doctor.harnesses)) {
            throw new AppError("WORKSPACE_ASSIST_HARNESS_REQUIRED", "workspace:assist requires a configured and installed Codex or Claude harness.");
        }
        const basePlan = input.currentPlan ?? this.buildSuggestedPlan(doctor);
        const result = await input.runtime.adapter.runWorkspaceSetupAssist({
            runtime: {
                provider: input.runtime.providerKey,
                model: input.runtime.model,
                policy: input.runtime.policy,
                workspaceRoot: this.input.workspaceRoot ?? this.input.workspace.rootPath ?? process.cwd()
            },
            interactionType: "workspace_setup_assist",
            prompt: this.buildWorkspaceAssistPrompt(doctor, input.userMessage),
            workspace: { key: this.input.workspace.key, name: this.input.workspace.name, rootPath: this.input.workspaceRoot },
            doctor: {
                status: doctor.status,
                missing: doctor.missing,
                suggestedActions: doctor.suggestedActions,
                autoFixable: doctor.autoFixable,
                checks: this.simplifyChecksForAssist(doctor.checks)
            },
            currentPlan: basePlan,
            userMessage: input.userMessage ?? "Refine the setup plan for this workspace."
        });
        const parsed = workspaceSetupAssistOutputSchema.safeParse(result.output);
        if (!parsed.success) {
            throw new AppError("WORKSPACE_ASSIST_OUTPUT_INVALID", parsed.error.issues.map((issue) => issue.message).join("; "));
        }
        const output = parsed.data;
        return {
            assistantMessage: output.assistantMessage,
            plan: output.plan,
            rationale: output.rationale,
            warnings: output.warnings,
            needsUserInput: output.needsUserInput,
            followUpHint: output.followUpHint ?? null,
            runtime: { providerKey: input.runtime.providerKey, model: input.runtime.model, command: input.runtime.command }
        };
    }
    simplifyChecksForAssist(checks) {
        const mapCheck = (entry) => ({ id: entry.id, status: entry.status, message: entry.message });
        return {
            agentHarness: checks.agentHarness.map(mapCheck),
            filesystem: checks.filesystem.map(mapCheck),
            git: checks.git.map(mapCheck),
            runtime: checks.runtime.map(mapCheck),
            quality: checks.quality.map(mapCheck),
            integrations: checks.integrations.map(mapCheck)
        };
    }
    buildWorkspaceAssistPrompt(doctor, userMessage) {
        return [
            "You are planning a BeerEngineer workspace setup flow.",
            "Return a planning-only result. Do not execute commands.",
            "Prefer preserving existing brownfield projects over scaffolding starter files.",
            `Workspace status: ${doctor.status}`,
            userMessage ? `User setup request:\n${userMessage}` : null
        ]
            .filter((value) => Boolean(value))
            .join("\n\n");
    }
    async createAssistSession(input) {
        const sessionRepository = this.requireAssistSessionRepository();
        const messageRepository = this.requireAssistMessageRepository();
        const assisted = await this.assistWithAgent({ runtime: input.runtime });
        const session = sessionRepository.create({
            workspaceId: this.input.workspace.id,
            status: "open",
            currentPlanJson: JSON.stringify(assisted.plan, null, 2)
        });
        messageRepository.create({
            sessionId: session.id,
            role: "system",
            content: "Workspace setup assist session.",
            structuredPayloadJson: JSON.stringify({ workspaceKey: this.input.workspace.key, workspaceRoot: this.input.workspaceRoot }, null, 2),
            derivedPlanJson: null
        });
        const assistantMessage = messageRepository.create({
            sessionId: session.id,
            role: "assistant",
            content: assisted.assistantMessage,
            structuredPayloadJson: JSON.stringify({
                rationale: assisted.rationale,
                warnings: assisted.warnings,
                needsUserInput: assisted.needsUserInput,
                followUpHint: assisted.followUpHint,
                runtime: assisted.runtime
            }, null, 2),
            derivedPlanJson: JSON.stringify(assisted.plan, null, 2)
        });
        sessionRepository.update(session.id, { lastAssistantMessageId: assistantMessage.id });
        return this.showAssistSession(session.id);
    }
    parseStoredPlan(value) {
        return this.loadParsedBootstrapPlan(JSON.parse(value), "session");
    }
    detectProjectState() {
        if (!this.input.workspaceRoot || !existsSync(this.input.workspaceRoot)) {
            return {
                manifest: null,
                tsconfig: false,
                sourceDirectory: false,
                sonarProjectFile: false,
                coderabbitInstructionsFile: false,
                gitRemoteOrigin: false,
                brownfieldSignals: [],
                isBrownfield: false
            };
        }
        const workspaceRoot = this.input.workspaceRoot;
        const manifest = supportedProjectManifestFiles.find((candidate) => existsSync(resolve(workspaceRoot, candidate))) ?? null;
        const tsconfig = existsSync(resolve(workspaceRoot, "tsconfig.json"));
        const sourceDirectory = existsSync(resolve(workspaceRoot, "src"));
        const sonarProjectFile = existsSync(resolve(workspaceRoot, "sonar-project.properties"));
        const coderabbitInstructionsFile = existsSync(resolve(workspaceRoot, "coderabbit.md"));
        const gitRemoteOrigin = this.detectGitRemoteOrigin(workspaceRoot) !== null;
        const brownfieldSignals = [
            manifest ? `manifest:${manifest}` : null,
            tsconfig ? "tsconfig" : null,
            sourceDirectory ? "src-directory" : null,
            sonarProjectFile ? "sonar-project" : null,
            coderabbitInstructionsFile ? "coderabbit-instructions" : null,
            gitRemoteOrigin ? "git-remote-origin" : null
        ].filter((value) => Boolean(value));
        return {
            manifest,
            tsconfig,
            sourceDirectory,
            sonarProjectFile,
            coderabbitInstructionsFile,
            gitRemoteOrigin,
            brownfieldSignals,
            isBrownfield: brownfieldSignals.length > 0
        };
    }
    findInteractiveHarness(harnesses) {
        return harnesses.find((harness) => harness.interactiveCapable) ?? null;
    }
    findSetupCapableHarness(harnesses) {
        return harnesses.find((harness) => harness.setupCapable) ?? null;
    }
    detectGitRemoteOrigin(workspaceRoot) {
        try {
            const output = execFileSync("git", ["remote", "get-url", "origin"], {
                cwd: workspaceRoot,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "pipe"]
            }).trim();
            return output.length > 0 ? output : null;
        }
        catch {
            return null;
        }
    }
    requireWorkspaceRoot() {
        if (!this.input.workspaceRoot) {
            throw new AppError("WORKSPACE_ROOT_NOT_CONFIGURED", "Workspace root is not configured. Set it first or pass --workspace-root.");
        }
        return this.input.workspaceRoot;
    }
    formatBootstrapCommand(sessionId) {
        return `npm run cli -- --workspace ${this.input.workspace.key} workspace:bootstrap --session-id ${sessionId}`;
    }
    formatAssistCommand() {
        return `npm run cli -- --workspace ${this.input.workspace.key} workspace:assist`;
    }
    formatNextAssistCommand(session) {
        return session.status === "open" ? this.formatBootstrapCommand(session.id) : this.formatAssistCommand();
    }
    createDirectoryAction(id, path, message) {
        mkdirSync(path, { recursive: true });
        return { id, status: "created", message, path };
    }
    gitInitAction(workspaceRoot) {
        execFileSync("git", ["init", "-b", "main"], { cwd: workspaceRoot, stdio: ["ignore", "pipe", "pipe"] });
        return { id: "git-init", status: "created", message: `Initialized a git repository in ${workspaceRoot}.`, command: ["git", "init", "-b", "main"] };
    }
    ensureFile(input) {
        if (existsSync(input.path)) {
            return [{ id: input.id, status: "skipped", message: `${input.path} already exists.`, path: input.path }];
        }
        if (input.dryRun) {
            const actions = [];
            const parentDirectory = dirname(input.path);
            if (input.ensureParentDirectory && !existsSync(parentDirectory)) {
                actions.push({
                    id: `${input.id}-parent-directory`,
                    status: "simulated",
                    message: `Would create parent directory ${parentDirectory}.`,
                    path: parentDirectory
                });
            }
            actions.push({ id: input.id, status: "simulated", message: `Would create ${input.path}.`, path: input.path });
            return actions;
        }
        if (input.ensureParentDirectory) {
            mkdirSync(dirname(input.path), { recursive: true });
        }
        writeFileSync(input.path, input.content, "utf8");
        return [{ id: input.id, status: "created", message: `Created ${input.path}.`, path: input.path }];
    }
    ensureGitignoreContains(input: { id: string; path: string; entry: string; dryRun: boolean }) {
        const parentDirectory = dirname(input.path);
        const pathExists = existsSync(input.path);
        const currentContent = pathExists ? readFileSync(input.path, "utf8") : "";
        if (currentContent.includes(".beerengineer/worktrees/")) {
            return [
                {
                    id: input.id,
                    status: "skipped",
                    message: `${input.path} already ignores BeerEngineer worktrees.`,
                    path: input.path
                }
            ];
        }
        if (input.dryRun) {
            return [
                {
                    id: input.id,
                    status: "simulated",
                    message: pathExists
                        ? `Would update ${input.path} to ignore BeerEngineer worktrees.`
                        : `Would create ${input.path} and ignore BeerEngineer worktrees.`,
                    path: input.path
                }
            ];
        }
        mkdirSync(parentDirectory, { recursive: true });
        const separator = currentContent.length > 0 && !currentContent.endsWith("\n") ? "\n" : "";
        writeFileSync(input.path, `${currentContent}${separator}${input.entry}`, "utf8");
        return [
            {
                id: input.id,
                status: pathExists ? "updated" : "created",
                message: `${input.path} ignores BeerEngineer worktrees.`,
                path: input.path
            }
        ];
    }
    installDependenciesCommand(stack) {
        if (stack === "python") {
            const pythonBinary = this.checkBinary("python3").status === "ok"
                ? "python3"
                : this.checkBinary("python").status === "ok"
                    ? "python"
                    : null;
            if (!pythonBinary) {
                throw new AppError("WORKSPACE_BOOTSTRAP_PYTHON_REQUIRED", "workspace:bootstrap --install-deps for Python requires python3 or python on PATH.");
            }
            return [pythonBinary, "-m", "pip", "install", "-e", "."];
        }
        return ["npm", "install"];
    }
    installDependenciesAction(workspaceRoot, stack) {
        const command = this.installDependenciesCommand(stack);
        execFileSync(command[0], command.slice(1), { cwd: workspaceRoot, stdio: ["ignore", "pipe", "pipe"] });
        return {
            id: "bootstrap-install-deps",
            status: "created",
            message: `Installed ${stack === "python" ? "Python" : "npm"} dependencies in ${workspaceRoot}.`,
            command
        };
    }
    toPackageName(value) {
        const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        return normalized.length > 0 ? normalized : "beerengineer-app";
    }
    requireAssistSessionRepository() {
        if (!this.input.assistSessionRepository) {
            throw new AppError("WORKSPACE_ASSIST_NOT_AVAILABLE", "Workspace assist session repository is not configured.");
        }
        return this.input.assistSessionRepository;
    }
    requireAssistMessageRepository() {
        if (!this.input.assistMessageRepository) {
            throw new AppError("WORKSPACE_ASSIST_NOT_AVAILABLE", "Workspace assist message repository is not configured.");
        }
        return this.input.assistMessageRepository;
    }
}
