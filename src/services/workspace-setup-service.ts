import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import type { AgentRuntimeConfig, ResolvedAgentRuntime } from "../adapters/runtime.js";
import { loadAgentRuntimeConfig } from "../adapters/runtime.js";
import type { WorkspaceSetupContext } from "../app-context.js";
import type { WorkspaceAssistMessage, WorkspaceAssistSession, WorkspaceCoderabbitSettings, WorkspaceSonarSettings } from "../domain/types.js";
import { workspaceSetupAssistOutputSchema, type WorkspaceSetupAssistPlan } from "../schemas/output-contracts.js";
import { AppError } from "../shared/errors.js";
import { ExecutionReadinessCoreService } from "./execution-readiness-service.js";
import { VerificationReadinessCoreService } from "./verification-readiness-service.js";
import { detectCoderabbitCliState } from "../shared/coderabbit-cli.js";
import { parseGitRemoteRepository } from "../shared/git-remote.js";
import type { HarnessMcpTarget } from "../shared/workspace-mcp.js";
import { applyHarnessMcpConfig, isHarnessMcpConfigured, renderHarnessMcpConfigPreview, resolveHarnessMcpTargets } from "../shared/workspace-mcp.js";
import { detectSonarCliState } from "../shared/sonar-cli.js";
import { parseDotEnv } from "./env-config.js";
const beerengineerOwnedDirectories = [".beerengineer", ".beerengineer/workspaces"];
const beerengineerGitignoreEntry = "# beerengineer runtime data (managed by beerengineer CLI)\n.beerengineer/\n";
const legacyBeerengineerGitignoreEntry = ".beerengineer/worktrees/";
const supportedProjectManifestFiles = ["package.json", "pyproject.toml", "requirements.txt", "go.mod", "Cargo.toml"];
const sonarCliName = "sonar";
const sonarCliLabel = "SonarQube CLI";
const sonarScannerCliName = "sonar-scanner";
const sonarScannerCliLabel = "SonarScanner CLI";
const agentBrowserCliName = "agent-browser";
const agentBrowserCliLabel = "Agent Browser CLI";
const githubCliName = "gh";
const githubCliLabel = "GitHub CLI";
const playwrightCliCommand = "npx playwright";
const playwrightCliLabel = "Playwright CLI";
const coderabbitCliAliases = ["cr", "coderabbit"];
const coderabbitCliLabel = "CodeRabbit CLI";
const setupAutonomyOrder = {
    safe: 0,
    "workspace-write": 1,
    "setup-capable": 2
};
type CheckStatus = "ok" | "warning" | "missing" | "blocked" | "not_applicable";
type DoctorCheck = {
    id: string;
    status: string;
    message: string;
    details?: Record<string, unknown>;
};
type DoctorChecks = {
    agentHarness: DoctorCheck[];
    filesystem: DoctorCheck[];
    git: DoctorCheck[];
    runtime: DoctorCheck[];
    executionReadiness: DoctorCheck[];
    dependencyTooling: DoctorCheck[];
    appBuild: DoctorCheck[];
    typecheck: DoctorCheck[];
    e2eReadiness: DoctorCheck[];
    browserVerification: DoctorCheck[];
    agentBrowser: DoctorCheck[];
    playwrightSetup: DoctorCheck[];
    uiServerContract: DoctorCheck[];
    quality: DoctorCheck[];
    integrations: DoctorCheck[];
};
type WorkspaceAction = {
    id: string;
    status: string;
    message: string;
    path?: string;
    command?: string[];
    details?: Record<string, unknown>;
    created?: boolean;
    configured?: boolean;
};
type RuntimeDetectionSuccess = {
    ok: true;
    config: AgentRuntimeConfig;
    defaultProvider: string;
    activeProviders: Set<string>;
    parseWarning: string | null;
};
type RuntimeDetectionFailure = {
    ok: false;
    errorCode: string;
    errorMessage: string;
};
type RuntimeDetection = RuntimeDetectionSuccess | RuntimeDetectionFailure;
type HarnessStatus = Exclude<CheckStatus, "not_applicable">;
type DetectedHarness = {
    providerKey: "local" | "codex" | "claude";
    adapterKey: string | null;
    command: string[] | null;
    configured: boolean;
    installed: boolean;
    active: boolean;
    interactiveCapable: boolean;
    workspaceWriteCapable: boolean;
    setupCapable: boolean;
    autonomyLevel: keyof typeof setupAutonomyOrder;
    status: HarnessStatus;
    message: string;
    errorCode: string | null;
    errorMessage: string | null;
};
type BinaryCheck = {
    binary: string;
    status: "ok" | "missing";
    message: string;
    resolvedPath: string | null;
};
type AnyBinaryCheck = {
    binary: "coderabbit";
    resolvedAlias: string | null;
    status: "ok" | "missing";
    message: string;
};
type IntegrationPresenceInput = {
    hasStoredConfig: boolean;
    hasToken: boolean;
    hasCliAuth?: boolean;
    envFallback: boolean;
};
type ProjectState = {
    manifest: string | null;
    tsconfig: boolean;
    sourceDirectory: boolean;
    sonarProjectFile: boolean;
    coderabbitInstructionsFile: boolean;
    gitRemoteOrigin: boolean;
    brownfieldSignals: string[];
    isBrownfield: boolean;
};
type WorkspaceAssistSessionRepositoryLike = {
    getById(id: string): WorkspaceAssistSession | null;
    getLatestByWorkspaceId(workspaceId: string): WorkspaceAssistSession | null;
    findOpenByWorkspaceId(workspaceId: string): WorkspaceAssistSession | null;
    listByWorkspaceId(workspaceId: string): WorkspaceAssistSession[];
    create(input: {
        workspaceId: string;
        status: WorkspaceAssistSession["status"];
        currentPlanJson: string;
    }): WorkspaceAssistSession;
    update(inputId: string, input: Partial<Pick<WorkspaceAssistSession, "status" | "currentPlanJson" | "resolvedAt" | "lastAssistantMessageId" | "lastUserMessageId">>): WorkspaceAssistSession;
};
type WorkspaceAssistMessageRepositoryLike = {
    create(input: Omit<WorkspaceAssistMessage, "id" | "createdAt">): WorkspaceAssistMessage;
    listBySessionId(sessionId: string): WorkspaceAssistMessage[];
};
type WorkspaceSetupServiceInput = {
    workspace: {
        id: string;
        key: string;
        name: string;
        rootPath?: string | null;
    } & Record<string, unknown>;
    workspaceSettings?: {
        runtimeProfileJson?: string | null;
        appTestConfigJson?: string | null;
    };
    workspaceRoot: string | null;
    rootPathSource: WorkspaceSetupContext["rootPathSource"];
    agentRuntimeConfigPath: string;
    agentRuntimeConfig?: AgentRuntimeConfig;
    sonarSettings?: WorkspaceSonarSettings | null;
    coderabbitSettings?: WorkspaceCoderabbitSettings | null;
    assistSessionRepository?: WorkspaceAssistSessionRepositoryLike;
    assistMessageRepository?: WorkspaceAssistMessageRepositoryLike;
};
export class WorkspaceSetupService {
    private readonly input: WorkspaceSetupServiceInput;
    constructor(input: WorkspaceSetupServiceInput) {
        this.input = input;
    }
    doctor() {
        const checks: DoctorChecks = {
            agentHarness: [],
            filesystem: [],
            git: [],
            runtime: [],
            executionReadiness: [],
            dependencyTooling: [],
            appBuild: [],
            typecheck: [],
            e2eReadiness: [],
            browserVerification: [],
            agentBrowser: [],
            playwrightSetup: [],
            uiServerContract: [],
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
        const readinessChecks = this.buildExecutionReadinessChecks();
        checks.executionReadiness.push(...readinessChecks.executionReadiness);
        checks.dependencyTooling.push(...readinessChecks.dependencyTooling);
        checks.appBuild.push(...readinessChecks.appBuild);
        checks.typecheck.push(...readinessChecks.typecheck);
        checks.e2eReadiness.push(...readinessChecks.e2eReadiness);
        const verificationChecks = this.buildVerificationReadinessChecks();
        checks.browserVerification.push(...verificationChecks.browserVerification);
        checks.agentBrowser.push(...verificationChecks.agentBrowser);
        checks.playwrightSetup.push(...verificationChecks.playwrightSetup);
        checks.uiServerContract.push(...verificationChecks.uiServerContract);
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
    init(input: { createRoot: boolean; initGit: boolean; dryRun: boolean }) {
        const workspaceRoot = this.requireWorkspaceRoot();
        const actions: WorkspaceAction[] = [];
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
    async startOrReuseAssistSession(input: { runtime: ResolvedAgentRuntime }) {
        const existing = this.requireAssistSessionRepository().findOpenByWorkspaceId(this.input.workspace.id);
        if (existing) {
            return this.showAssistSession(existing.id);
        }
        return this.createAssistSession(input);
    }
    showAssistSession(sessionId?: string) {
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
            runtimeProfile: this.describeAssistRuntimeProfile(this.parseStoredPlan(session.currentPlanJson)),
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
            runtimeProfile: this.describeAssistRuntimeProfile(this.parseStoredPlan(session.currentPlanJson)),
            messageCount: messageRepository.listBySessionId(session.id).length,
            isLatest: session.id === latestSessionId,
            isOpen: session.status === "open",
            recommendedForBootstrap: session.id === openSessionId,
            recommendedNextCommand: session.id === openSessionId ? this.formatBootstrapCommand(session.id) : null
        }));
    }
    async chatAssistSession(input: { runtime: ResolvedAgentRuntime; sessionId: string; message: string }) {
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
    resolveAssistSession(input: { sessionId: string }) {
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
    cancelAssistSession(input: { sessionId: string }) {
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
    bootstrap(input: {
        stack: "node-ts" | "python";
        scaffoldProjectFiles: boolean;
        createRoot: boolean;
        initGit: boolean;
        installDeps: boolean;
        withSonar: boolean;
        withCoderabbit: boolean;
        mcpTargets?: HarnessMcpTarget[];
        dryRun: boolean;
    }) {
        if (input.stack !== "node-ts" && input.stack !== "python") {
            throw new AppError("UNSUPPORTED_WORKSPACE_STACK", `Workspace bootstrap stack ${input.stack} is not supported.`);
        }
        if (input.installDeps && !this.findSetupCapableHarness(this.doctor().harnesses)) {
            throw new AppError("WORKSPACE_BOOTSTRAP_SETUP_CAPABILITY_REQUIRED", "workspace:bootstrap --install-deps requires a setup-capable Codex or Claude runtime policy.");
        }
        const initResult = this.init({ createRoot: input.createRoot, initGit: input.initGit, dryRun: input.dryRun });
        const workspaceRoot = this.requireWorkspaceRoot();
        const actions: WorkspaceAction[] = [...initResult.actions];
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
        const mcpTargets = input.mcpTargets ?? [];
        if (mcpTargets.length > 0) {
            for (const descriptor of resolveHarnessMcpTargets(workspaceRoot).filter((candidate) => mcpTargets.includes(candidate.target))) {
                const preview = renderHarnessMcpConfigPreview(descriptor);
                try {
                    const configured = isHarnessMcpConfigured(descriptor);
                    actions.push(input.dryRun
                        ? {
                            id: `bootstrap-mcp-${descriptor.target}`,
                            status: configured ? "skipped" : "simulated",
                            message: configured
                                ? `${descriptor.label} already includes an agent-browser MCP server entry.`
                                : `Would configure agent-browser MCP for ${descriptor.label} at ${descriptor.path}.`,
                            path: descriptor.path,
                            details: { target: descriptor.target, scope: descriptor.scope, preview }
                        }
                        : configured
                            ? {
                                id: `bootstrap-mcp-${descriptor.target}`,
                                status: "skipped",
                                message: `${descriptor.label} already includes an agent-browser MCP server entry.`,
                                path: descriptor.path,
                                details: { target: descriptor.target, scope: descriptor.scope }
                            }
                            : {
                                id: `bootstrap-mcp-${descriptor.target}`,
                                status: "created",
                                message: `Configured agent-browser MCP for ${descriptor.label} at ${descriptor.path}.`,
                                ...applyHarnessMcpConfig(descriptor),
                                details: { target: descriptor.target, scope: descriptor.scope }
                            });
                }
                catch (error) {
                    actions.push({
                        id: `bootstrap-mcp-${descriptor.target}`,
                        status: "blocked",
                        message: error instanceof Error
                            ? `Failed to configure ${descriptor.label}: ${error.message}`
                            : `Failed to configure ${descriptor.label}.`,
                        path: descriptor.path,
                        details: { target: descriptor.target, scope: descriptor.scope, preview }
                    });
                }
            }
        }
        return { workspace: initResult.workspace, dryRun: input.dryRun, actions };
    }
    loadBootstrapPlan(planPath: string) {
        return this.loadParsedBootstrapPlan(JSON.parse(readFileSync(planPath, "utf8")), planPath);
    }
    loadBootstrapPlanFromAssistSession(sessionId: string) {
        const sessionView = this.showAssistSession(sessionId);
        return this.loadParsedBootstrapPlan(sessionView.currentPlan, `workspace assist session ${sessionView.session.id}`);
    }
    loadBootstrapPlanFromOpenAssistSession() {
        const session = this.requireAssistSessionRepository().findOpenByWorkspaceId(this.input.workspace.id);
        return session ? this.loadBootstrapPlanFromAssistSession(session.id) : null;
    }
    deduplicateCheckLists(checks: DoctorChecks): DoctorChecks {
        const unique = (entries: DoctorCheck[]) => entries.filter((entry, index) => entries.findIndex((candidate) => candidate.id === entry.id) === index);
        return {
            agentHarness: unique(checks.agentHarness),
            filesystem: unique(checks.filesystem),
            git: unique(checks.git),
            runtime: unique(checks.runtime),
            executionReadiness: unique(checks.executionReadiness),
            dependencyTooling: unique(checks.dependencyTooling),
            appBuild: unique(checks.appBuild),
            typecheck: unique(checks.typecheck),
            e2eReadiness: unique(checks.e2eReadiness),
            browserVerification: unique(checks.browserVerification),
            agentBrowser: unique(checks.agentBrowser),
            playwrightSetup: unique(checks.playwrightSetup),
            uiServerContract: unique(checks.uiServerContract),
            quality: unique(checks.quality),
            integrations: unique(checks.integrations)
        };
    }
    deriveOverallStatus(runtimeDetection: RuntimeDetection, harnesses: DetectedHarness[], checks: DoctorChecks): "blocked" | "limited" | "warning" | "ready" {
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
    buildAgentHarnessChecks(runtimeDetection: RuntimeDetection, harnesses: DetectedHarness[]): DoctorCheck[] {
        if (!runtimeDetection.ok) {
            return [{ id: "agent-runtime-config", status: "blocked", message: runtimeDetection.errorMessage, details: { errorCode: runtimeDetection.errorCode } }];
        }
        const checks: DoctorCheck[] = [
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
    buildGitChecks(): DoctorCheck[] {
        const gitBinary = this.checkBinary("git");
        const checks: DoctorCheck[] = [{ id: "git-binary", status: gitBinary.status, message: gitBinary.message }];
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
    buildRuntimeChecks(): DoctorCheck[] {
        const playwrightCheck = this.checkPlaywrightCli();
        const coderabbitCheck = this.checkAnyBinary(coderabbitCliAliases);
        return [
            this.checkBinary("node"),
            this.checkBinary("npm"),
            this.checkBinary(githubCliName),
            this.checkBinary(agentBrowserCliName),
            playwrightCheck,
            this.checkBinary(sonarCliName),
            this.checkBinary(sonarScannerCliName),
            coderabbitCheck
        ].map((entry) => ({
            id: `${entry.binary}-binary`,
            status: entry.status,
            message: this.formatRuntimeCheckMessage(entry)
        }));
    }
    buildExecutionReadinessChecks(): Pick<DoctorChecks, "executionReadiness" | "dependencyTooling" | "appBuild" | "typecheck" | "e2eReadiness"> {
        if (!this.input.workspaceRoot) {
            return {
                executionReadiness: [{ id: "execution-readiness-root", status: "missing", message: "Execution readiness check skipped because the workspace root is not configured." }],
                dependencyTooling: [],
                appBuild: [],
                typecheck: [],
                e2eReadiness: []
            };
        }
        const report = new ExecutionReadinessCoreService().inspect({
            workspaceRoot: this.input.workspaceRoot,
            workspaceSettings: { appTestConfigJson: this.input.workspaceSettings?.appTestConfigJson ?? null }
        });
        const groups: Pick<DoctorChecks, "executionReadiness" | "dependencyTooling" | "appBuild" | "typecheck" | "e2eReadiness"> = {
            executionReadiness: [{
                    id: "execution-readiness-status",
                    status: report.status === "ready" ? "ok" : report.status === "auto_fixable" ? "warning" : "blocked",
                    message: report.status === "ready"
                        ? `Execution readiness is green for profile ${report.profileKey}.`
                        : `Execution readiness is ${report.status} for profile ${report.profileKey}.`
                }],
            dependencyTooling: [],
            appBuild: [],
            typecheck: [],
            e2eReadiness: []
        };
        for (const finding of report.findings) {
            const entry = {
                id: `execution-readiness-${finding.code}`,
                status: finding.isAutoFixable ? "warning" : "blocked",
                message: finding.summary,
                details: { recommendedAction: finding.recommendedAction, scopePath: finding.scopePath }
            } satisfies DoctorCheck;
            if (finding.doctorCategory === "appBuild") {
                groups.appBuild.push(entry);
            }
            else if (finding.doctorCategory === "typecheck") {
                groups.typecheck.push(entry);
            }
            else if (finding.doctorCategory === "e2eReadiness") {
                groups.e2eReadiness.push(entry);
            }
            else if (finding.doctorCategory === "dependencyTooling") {
                groups.dependencyTooling.push(entry);
            }
            else {
                groups.executionReadiness.push(entry);
            }
        }
        return groups;
    }
    buildVerificationReadinessChecks(): Pick<DoctorChecks, "browserVerification" | "agentBrowser" | "playwrightSetup" | "uiServerContract"> {
        if (!this.input.workspaceRoot) {
            return {
                browserVerification: [{ id: "verification-readiness-root", status: "missing", message: "Verification readiness check skipped because the workspace root is not configured." }],
                agentBrowser: [],
                playwrightSetup: [],
                uiServerContract: []
            };
        }
        const report = new VerificationReadinessCoreService().inspect({
            workspaceRoot: this.input.workspaceRoot,
            workspaceSettings: { appTestConfigJson: this.input.workspaceSettings?.appTestConfigJson ?? null },
            story: {
                id: "doctor-story",
                projectId: "doctor-project",
                code: "default",
                title: "Doctor UI verification route",
                description: "Validate the browser verification contract",
                actor: "workspace operator",
                goal: "inspect browser verification readiness",
                benefit: "early visibility",
                priority: "medium",
                status: "draft",
                sourceArtifactId: "doctor-artifact",
                createdAt: 0,
                updatedAt: 0
            },
            workspaceKey: this.input.workspace.key,
            skipBinaryProbes: true
        });
        const groups: Pick<DoctorChecks, "browserVerification" | "agentBrowser" | "playwrightSetup" | "uiServerContract"> = {
            browserVerification: [{
                    id: "verification-readiness-status",
                    status: report.status === "ready" ? "ok" : report.status === "auto_fixable" ? "warning" : "blocked",
                    message: report.status === "ready"
                        ? `Verification readiness is green for profile ${report.profileKey}.`
                        : `Verification readiness is ${report.status} for profile ${report.profileKey}.`
                }],
            agentBrowser: [],
            playwrightSetup: [],
            uiServerContract: []
        };
        for (const finding of report.findings) {
            const entry = {
                id: `verification-readiness-${finding.code}`,
                status: finding.isAutoFixable ? "warning" : "blocked",
                message: finding.summary,
                details: { recommendedAction: finding.recommendedAction, scopePath: finding.scopePath }
            };
            if (finding.doctorCategory === "agentBrowser") {
                groups.agentBrowser.push(entry);
            }
            else if (finding.doctorCategory === "playwrightSetup") {
                groups.playwrightSetup.push(entry);
            }
            else if (finding.doctorCategory === "uiServerContract") {
                groups.uiServerContract.push(entry);
            }
            else {
                groups.browserVerification.push(entry);
            }
        }
        return groups;
    }
    formatRuntimeCheckMessage(entry: { binary: string; status: string; message: string; resolvedAlias?: string | null }) {
        switch (entry.binary) {
            case sonarCliName:
                return entry.status === "ok"
                    ? `${sonarCliLabel} (${sonarCliName}) is available.`
                    : `${sonarCliLabel} (${sonarCliName}) is not available on PATH.`;
            case sonarScannerCliName:
                return entry.status === "ok"
                    ? `${sonarScannerCliLabel} (${sonarScannerCliName}) is available.`
                    : `${sonarScannerCliLabel} (${sonarScannerCliName}) is not available on PATH.`;
            case agentBrowserCliName:
                return entry.status === "ok"
                    ? `${agentBrowserCliLabel} (${agentBrowserCliName}) is available.`
                    : `${agentBrowserCliLabel} (${agentBrowserCliName}) is not available on PATH.`;
            case githubCliName:
                return entry.status === "ok"
                    ? `${githubCliLabel} (${githubCliName}) is available.`
                    : `${githubCliLabel} (${githubCliName}) is not available on PATH.`;
            case "playwright":
                return entry.status === "ok"
                    ? `${playwrightCliLabel} (${playwrightCliCommand}) is available.`
                    : `${playwrightCliLabel} (${playwrightCliCommand}) is not available in this workspace.`;
            case "coderabbit":
                return entry.status === "ok"
                    ? `${coderabbitCliLabel} (${(entry as AnyBinaryCheck).resolvedAlias}) is available.`
                    : `${coderabbitCliLabel} (${coderabbitCliAliases.join(" / ")}) is not available on PATH.`;
            default:
                return entry.message;
        }
    }
    buildQualityChecks(): DoctorCheck[] {
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
    buildIntegrationChecks(): DoctorCheck[] {
        const envConfig = this.input.workspaceRoot && existsSync(this.input.workspaceRoot)
            ? parseDotEnv(resolve(this.input.workspaceRoot, ".env.local"))
            : {};
        const sonarCliState = this.input.workspaceRoot && existsSync(this.input.workspaceRoot)
            ? detectSonarCliState(this.input.workspaceRoot)
            : { available: false, loggedIn: false, detail: null };
        const coderabbitCliState = this.input.workspaceRoot && existsSync(this.input.workspaceRoot)
            ? detectCoderabbitCliState(this.input.workspaceRoot)
            : { available: false, binary: null, loggedIn: false, detail: null };
        const sonarInput = {
            hasStoredConfig: Boolean(this.input.sonarSettings?.hostUrl && this.input.sonarSettings?.organization && this.input.sonarSettings?.projectKey),
            hasToken: Boolean(this.input.sonarSettings?.token),
            hasCliAuth: sonarCliState.loggedIn,
            envFallback: Boolean(envConfig.SONAR_HOST_URL || envConfig.SONAR_ORGANIZATION || envConfig.SONAR_PROJECT_KEY || envConfig.SONAR_TOKEN)
        };
        const coderabbitInput = {
            hasStoredConfig: Boolean(this.input.coderabbitSettings?.hostUrl && this.input.coderabbitSettings?.organization && this.input.coderabbitSettings?.repository),
            hasToken: Boolean(this.input.coderabbitSettings?.token),
            hasCliAuth: coderabbitCliState.loggedIn,
            envFallback: Boolean(envConfig.CODERABBIT_HOST_URL || envConfig.CODERABBIT_ORGANIZATION || envConfig.CODERABBIT_REPOSITORY || envConfig.CODERABBIT_TOKEN)
        };
        return [
            { id: "sonar-config", status: this.integrationStatus(sonarInput, "sonar"), message: this.integrationMessage("Sonar", sonarInput, "sonar") },
            this.buildSonarLiveScanCheck(),
            { id: "coderabbit-config", status: this.integrationStatus(coderabbitInput, "coderabbit"), message: this.integrationMessage("CodeRabbit", coderabbitInput, "coderabbit") },
            this.buildCoderabbitLiveReviewCheck(),
            ...this.buildMcpChecks()
        ];
    }
    buildSonarLiveScanCheck(): DoctorCheck {
        if (!this.input.workspaceRoot || !existsSync(this.input.workspaceRoot)) {
            return {
                id: "sonar-live-scan",
                status: "not_applicable",
                message: "Sonar live-scan readiness check skipped because the workspace root is missing."
            };
        }
        const envConfig = parseDotEnv(resolve(this.input.workspaceRoot, ".env.local"));
        const branchName = this.currentGitBranchName(this.input.workspaceRoot);
        const defaultBranch = this.input.sonarSettings?.defaultBranch ?? envConfig.SONAR_DEFAULT_BRANCH ?? "main";
        const pullRequestKey =
            process.env.SONAR_PULLREQUEST_KEY ??
                process.env.GITHUB_EVENT_PULL_REQUEST_NUMBER ??
                process.env.GITHUB_PR_NUMBER ??
                process.env.CI_MERGE_REQUEST_IID ??
                null;
        const analysisTarget = pullRequestKey ? "pull_request" : branchName === defaultBranch || branchName === "main" ? "main" : branchName ? "branch" : "none";
        const hostUrl = this.input.sonarSettings?.hostUrl ?? envConfig.SONAR_HOST_URL ?? null;
        const organization = this.input.sonarSettings?.organization ?? envConfig.SONAR_ORGANIZATION ?? null;
        const projectKey = this.input.sonarSettings?.projectKey ?? envConfig.SONAR_PROJECT_KEY ?? null;
        const hasToken = Boolean(this.input.sonarSettings?.token || envConfig.SONAR_TOKEN);
        const javaAvailable = this.checkBinary("java").status === "ok";
        const scannerAvailable = this.checkBinary(sonarScannerCliName).status === "ok";
        const ready = Boolean(hostUrl && organization && projectKey && hasToken && javaAvailable && scannerAvailable && analysisTarget !== "none");
        const errors = [
            hostUrl ? null : "hostUrl is missing",
            organization ? null : "organization is missing",
            projectKey ? null : "projectKey is missing",
            hasToken ? null : "token is missing",
            javaAvailable ? null : "java is missing",
            scannerAvailable ? null : "sonar-scanner is missing",
            analysisTarget !== "none" ? null : "no active git branch or pull request context was detected"
        ].filter((value): value is string => Boolean(value));
        if (ready) {
            return {
                id: "sonar-live-scan",
                status: "ok",
                message: `Sonar live scan is ready for ${analysisTarget} analysis on ${branchName ?? "the current context"}.`
            };
        }
        return {
            id: "sonar-live-scan",
            status: analysisTarget === "none" ? "warning" : "missing",
            message: `Sonar live scan is not ready for ${analysisTarget} analysis: ${errors.join("; ")}`
        };
    }
    buildCoderabbitLiveReviewCheck(): DoctorCheck {
        if (!this.input.workspaceRoot || !existsSync(this.input.workspaceRoot)) {
            return {
                id: "coderabbit-live-review",
                status: "not_applicable",
                message: "CodeRabbit live-review readiness check skipped because the workspace root is missing."
            };
        }
        const envConfig = parseDotEnv(resolve(this.input.workspaceRoot, ".env.local"));
        const branchName = this.currentGitBranchName(this.input.workspaceRoot);
        const defaultBranch = this.input.coderabbitSettings?.defaultBranch ?? envConfig.CODERABBIT_DEFAULT_BRANCH ?? "main";
        const pullRequestKey = process.env.GITHUB_EVENT_PULL_REQUEST_NUMBER ?? process.env.GITHUB_PR_NUMBER ?? process.env.CI_MERGE_REQUEST_IID ?? null;
        const analysisTarget = pullRequestKey ? "pull_request" : branchName === defaultBranch || branchName === "main" ? "main" : branchName ? "branch" : "none";
        const remoteOrigin = this.detectGitRemoteOrigin(this.input.workspaceRoot);
        const inferredRepository = parseGitRemoteRepository(remoteOrigin);
        const organization = this.input.coderabbitSettings?.organization ?? envConfig.CODERABBIT_ORGANIZATION ?? inferredRepository?.organization ?? null;
        const repository = this.input.coderabbitSettings?.repository ?? envConfig.CODERABBIT_REPOSITORY ?? inferredRepository?.repository ?? null;
        const gitAvailable = this.checkBinary("git").status === "ok";
        const gitRepository = this.isGitRepository(this.input.workspaceRoot).isRepository;
        const cliAvailable = this.checkAnyBinary(coderabbitCliAliases).status === "ok";
        const ready = Boolean(gitAvailable && gitRepository && cliAvailable && organization && repository && analysisTarget !== "none");
        const warnings = [
            organization ? null : "organization is missing",
            repository ? null : "repository is missing",
            gitAvailable ? null : "git is missing",
            gitRepository ? null : "workspace root is not a git repository",
            cliAvailable ? null : "CodeRabbit CLI is missing",
            analysisTarget !== "none" ? null : "no active git branch or pull request context was detected"
        ].filter((value): value is string => Boolean(value));
        if (ready) {
            return {
                id: "coderabbit-live-review",
                status: "ok",
                message: `CodeRabbit live review is ready for ${analysisTarget} analysis on ${branchName ?? "the current context"}.`
            };
        }
        return {
            id: "coderabbit-live-review",
            status: analysisTarget === "none" ? "warning" : "missing",
            message: `CodeRabbit live review is not ready for ${analysisTarget} analysis: ${warnings.join("; ")}`
        };
    }
    buildMcpChecks(): DoctorCheck[] {
        const agentBrowserInstalled = this.checkBinary(agentBrowserCliName).status === "ok";
        if (!this.input.workspaceRoot || !existsSync(this.input.workspaceRoot)) {
            return [];
        }
        return resolveHarnessMcpTargets(this.input.workspaceRoot).map((descriptor) => {
            if (!agentBrowserInstalled) {
                return {
                    id: `mcp-${descriptor.target}-agent-browser`,
                    status: "not_applicable",
                    message: `${descriptor.label} check skipped because ${agentBrowserCliLabel} (${agentBrowserCliName}) is not installed.`
                };
            }
            if (!existsSync(descriptor.path)) {
                return {
                    id: `mcp-${descriptor.target}-agent-browser`,
                    status: "warning",
                    message: `${descriptor.label} config ${descriptor.path} was not found; agent-browser MCP is not configured there.`
                };
            }
            try {
                const configured = isHarnessMcpConfigured(descriptor);
                return {
                    id: `mcp-${descriptor.target}-agent-browser`,
                    status: configured ? "ok" : "warning",
                    message: configured
                        ? `${descriptor.label} includes an agent-browser MCP server entry.`
                        : `${descriptor.label} config exists at ${descriptor.path} but does not include an agent-browser MCP server entry.`
                };
            }
            catch {
                return {
                    id: `mcp-${descriptor.target}-agent-browser`,
                    status: "warning",
                    message: `${descriptor.label} config ${descriptor.path} could not be parsed as the expected config format.`
                };
            }
        });
    }
    integrationStatus(input: IntegrationPresenceInput, provider: "generic" | "sonar" | "coderabbit" = "generic"): "ok" | "warning" | "missing" {
        if (provider === "coderabbit") {
            if (input.hasStoredConfig) {
                return "ok";
            }
            if (input.envFallback) {
                return "warning";
            }
            return "missing";
        }
        if (input.hasStoredConfig && (input.hasToken || input.hasCliAuth)) {
            return "ok";
        }
        if (input.envFallback) {
            return "warning";
        }
        if (input.hasStoredConfig) {
            return "warning";
        }
        return "missing";
    }
    integrationMessage(label: string, input: IntegrationPresenceInput, provider: "generic" | "sonar" | "coderabbit" = "generic"): string {
        if (input.hasStoredConfig && input.hasToken) {
            return `${label} workspace configuration is stored in the database.`;
        }
        if (provider === "sonar" && input.hasStoredConfig && input.hasCliAuth) {
            return "Sonar project configuration is stored in the database and authentication is available via `sonar auth login`.";
        }
        if (provider === "coderabbit" && input.hasStoredConfig && input.hasCliAuth) {
            return "CodeRabbit repository configuration is stored in the database and authentication is available via `cr auth login`.";
        }
        if (input.envFallback) {
            if (provider === "sonar" && input.hasCliAuth) {
                return "Sonar is configured via .env.local fallback and authenticated via `sonar auth login`.";
            }
            if (provider === "coderabbit" && input.hasCliAuth) {
                return "CodeRabbit is configured via .env.local fallback and authenticated via `cr auth login`.";
            }
            return `${label} is only configured via .env.local fallback.`;
        }
        if (provider === "sonar" && input.hasStoredConfig) {
            return "Sonar project configuration is stored, but authentication is missing. Set a token or login via `sonar auth login`.";
        }
        if (provider === "coderabbit" && input.hasStoredConfig) {
            return "CodeRabbit repository configuration is stored. Authentication is optional, but `cr auth login` or an API key is recommended for higher-quality reviews.";
        }
        return `${label} configuration is missing.`;
    }
    detectRuntimeConfig(): RuntimeDetection {
        try {
            const parsedJson = this.input.agentRuntimeConfig ?? loadAgentRuntimeConfig(this.input.agentRuntimeConfigPath);
            const activeProviders = new Set<string>();
            const selections = [
                parsedJson.defaultProvider,
                parsedJson.defaults?.interactive?.provider,
                parsedJson.defaults?.autonomous?.provider,
                parsedJson.interactive?.brainstorm_chat?.provider,
                parsedJson.interactive?.story_review_chat?.provider,
                ...Object.values(parsedJson.stages ?? {}).map((selection) => selection?.provider),
                ...Object.values(parsedJson.workers ?? {}).map((selection) => selection?.provider)
            ].filter((value): value is string => Boolean(value));
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
            const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
            if (code === "ENOENT") {
                return { ok: false, errorCode: "AGENT_RUNTIME_CONFIG_NOT_FOUND", errorMessage: `Agent runtime config ${this.input.agentRuntimeConfigPath} could not be read.` };
            }
            return { ok: false, errorCode: "AGENT_RUNTIME_CONFIG_INVALID", errorMessage: error instanceof Error ? error.message : "Agent runtime config could not be parsed." };
        }
    }
    recommendRuntimeProfile(doctor: ReturnType<WorkspaceSetupService["doctor"]>) {
        const runtimeDetection = this.detectRuntimeConfig();
        if (!runtimeDetection.ok) {
            return null;
        }
        const providers = runtimeDetection.config.providers ?? {};
        if (!providers.codex || !providers.claude) {
            return null;
        }
        const interactiveHarness = this.findInteractiveHarness(doctor.harnesses);
        if (interactiveHarness?.providerKey === "claude") {
            return "claude_primary";
        }
        return "codex_primary";
    }
    describeAssistRuntimeProfile(plan: WorkspaceSetupAssistPlan) {
        const activeProfileJson = this.input.workspaceSettings?.runtimeProfileJson ?? null;
        let activeProfileKey = null;
        if (activeProfileJson) {
            try {
                const parsed = JSON.parse(activeProfileJson);
                activeProfileKey = typeof parsed?.profileKey === "string" ? parsed.profileKey : null;
            }
            catch {
                activeProfileKey = null;
            }
        }
        return {
            suggestedProfileKey: plan.runtimeProfileKey ?? null,
            appliedProfileKey: activeProfileKey,
            alreadyApplied: Boolean(plan.runtimeProfileKey) && plan.runtimeProfileKey === activeProfileKey
        };
    }
    detectHarnesses(runtimeDetection: RuntimeDetection): DetectedHarness[] {
        const providerKeys: DetectedHarness["providerKey"][] = ["local", "codex", "claude"];
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
    resolveAutonomyLevel(runtimeDetection: RuntimeDetectionSuccess): keyof typeof setupAutonomyOrder {
        const policy = runtimeDetection.config.policy;
        if (policy.autonomyMode === "yolo" && policy.approvalMode === "never" && policy.filesystemMode === "danger-full-access" && policy.networkMode === "enabled") {
            return "setup-capable";
        }
        if (policy.autonomyMode === "yolo" && (policy.filesystemMode === "workspace-write" || policy.filesystemMode === "danger-full-access")) {
            return "workspace-write";
        }
        return "safe";
    }
    checkBinary(binary: string): BinaryCheck {
        const resolvedPath = this.findBinaryOnPath(binary);
        return resolvedPath
            ? { binary, status: "ok", message: `${binary} is available.`, resolvedPath }
            : { binary, status: "missing", message: `${binary} is not available on PATH.`, resolvedPath: null };
    }
    checkAnyBinary(binaries: string[]): AnyBinaryCheck {
        for (const binary of binaries) {
            const result = this.checkBinary(binary);
            if (result.status === "ok") {
                return { binary: "coderabbit", resolvedAlias: binary, status: "ok", message: `${binary} is available.` };
            }
        }
        return { binary: "coderabbit", resolvedAlias: null, status: "missing", message: `${binaries.join(" / ")} are not available on PATH.` };
    }
    checkPlaywrightCli() {
        const workspaceRoot = this.input.workspaceRoot ?? process.cwd();
        const localCliPath = this.findBinaryInDirectory(resolve(workspaceRoot, "node_modules", ".bin"), "playwright");
        if (localCliPath) {
            return { binary: "playwright", status: "ok", message: `${playwrightCliCommand} is available.` };
        }
        const globalPlaywright = this.checkBinary("playwright");
        if (globalPlaywright.status === "ok") {
            return { binary: "playwright", status: "ok", message: `${playwrightCliCommand} is available.` };
        }
        const npxBinary = this.checkBinary("npx");
        if (npxBinary.status !== "ok") {
            return { binary: "playwright", status: "missing", message: `${playwrightCliLabel} requires npx plus a Playwright installation.` };
        }
        return { binary: "playwright", status: "missing", message: `${playwrightCliLabel} (${playwrightCliCommand}) is not installed in this workspace.` };
    }
    findBinaryOnPath(binary: string): string | null {
        const pathValue = process.env.PATH;
        if (!pathValue) {
            return null;
        }
        for (const directory of pathValue.split(delimiter)) {
            if (!directory) {
                continue;
            }
            const resolvedBinary = this.findBinaryInDirectory(directory, binary);
            if (resolvedBinary) {
                return resolvedBinary;
            }
        }
        return null;
    }
    findBinaryInDirectory(directory: string, binary: string): string | null {
        const candidates = this.binaryCandidates(binary);
        for (const candidate of candidates) {
            const candidatePath = resolve(directory, candidate);
            if (!existsSync(candidatePath)) {
                continue;
            }
            if (process.platform === "win32") {
                return candidatePath;
            }
            try {
                accessSync(candidatePath, constants.X_OK);
                return candidatePath;
            }
            catch {
                continue;
            }
        }
        return null;
    }
    binaryCandidates(binary: string): string[] {
        if (process.platform !== "win32") {
            return [binary];
        }
        const extensions = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
            .split(";")
            .filter((value) => value.length > 0)
            .map((value) => value.toLowerCase());
        const lowerBinary = binary.toLowerCase();
        if (extensions.some((extension) => lowerBinary.endsWith(extension))) {
            return [binary];
        }
        return [binary, ...extensions.map((extension) => `${binary}${extension}`)];
    }
    isGitRepository(workspaceRoot: string): { isRepository: boolean; details: Record<string, string> } {
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
    currentGitBranchName(workspaceRoot: string): string | null {
        try {
            const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
                cwd: workspaceRoot,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "pipe"]
            }).trim();
            return branch === "HEAD" ? null : branch;
        }
        catch {
            return null;
        }
    }
    suggestActionForCheck(id: string): string | null {
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
            case "gh-binary":
                return `Install the ${githubCliLabel} (${githubCliName}).`;
            case "agent-browser-binary":
                return `Install the ${agentBrowserCliLabel} (${agentBrowserCliName}) and run \`${agentBrowserCliName} install\`.`;
            case "playwright-binary":
                return `Install the ${playwrightCliLabel} so \`${playwrightCliCommand}\` works in this workspace.`;
            case "sonar-binary":
                return `Install the ${sonarCliLabel} (${sonarCliName}) and authenticate with \`sonar auth login\` if Sonar integrations are required.`;
            case "sonar-scanner-binary":
                return `Install the ${sonarScannerCliLabel} (${sonarScannerCliName}) if live project scans are required.`;
            case "coderabbit-binary":
                return `Install the ${coderabbitCliLabel} (${coderabbitCliAliases.join(" / ")}).`;
            case "mcp-claude-agent-browser":
                return "Add an agent-browser MCP server entry to .mcp.json or run workspace:mcp:apply --target claude.";
            case "mcp-cursor-agent-browser":
                return "Add an agent-browser MCP server entry to .cursor/mcp.json or run workspace:mcp:apply --target cursor.";
            case "mcp-opencode-agent-browser":
                return "Add an agent-browser MCP server entry to opencode.json(c) or run workspace:mcp:apply --target opencode.";
            case "mcp-codex-agent-browser":
                return "Add an agent-browser MCP server entry to ~/.codex/config.toml or run workspace:mcp:apply --target codex.";
            case "sonar-project-file":
                return "Add sonar-project.properties if this workspace should use Sonar.";
            case "coderabbit-instructions-file":
                return "Add coderabbit.md if this workspace should use CodeRabbit review instructions.";
            case "sonar-config":
                return "Persist Sonar project settings with beerengineer sonar config set. For SonarQube CLI auth run `sonar auth login`; for live scanner runs also store a token.";
            case "coderabbit-config":
                return "Persist CodeRabbit settings with beerengineer coderabbit config set.";
            case "coderabbit-live-review":
                return "Ensure the workspace is a git repository on a real branch, install CodeRabbit CLI, and persist or infer organization/repository. `cr auth login` is recommended but optional.";
            case "execution-readiness-status":
                return "Run execution:readiness:start to persist and inspect the full readiness gate result.";
            case "execution-readiness-node_modules_missing":
            case "execution-readiness-next_binary_missing":
            case "execution-readiness-typescript_binary_missing":
                return "Run npm --prefix apps/ui install or execution:readiness:start to let BeerEngineer attempt deterministic remediation.";
            case "execution-readiness-build_command_failed":
                return "Fix the canonical UI build failure before execution starts.";
            case "execution-readiness-typecheck_failed":
                return "Fix the canonical UI typecheck failure before execution starts.";
            case "execution-readiness-playwright_missing":
                return "Add Playwright to apps/ui or remove it from app test runner preferences.";
            default:
                return null;
        }
    }
    autoFixForCheck(id: string): string | null {
        switch (id) {
            case "workspace-root-exists":
                return "workspace:init --create-root";
            case "filesystem-.beerengineer":
                return "workspace:init";
            case "git-repository":
                return "workspace:init --init-git";
            default:
                return null;
        }
    }
    loadParsedBootstrapPlan(parsed: unknown, source: string): WorkspaceSetupAssistPlan {
        const validated = workspaceSetupAssistOutputSchema.shape.plan.safeParse(parsed);
        if (!validated.success || validated.data.workspaceKey !== this.input.workspace.key) {
            throw new AppError("WORKSPACE_BOOTSTRAP_PLAN_INVALID", `Bootstrap plan ${source} is invalid for workspace ${this.input.workspace.key}.`);
        }
        return validated.data;
    }
    buildSuggestedPlan(doctor: ReturnType<WorkspaceSetupService["doctor"]>): WorkspaceSetupAssistPlan {
        const rootPath = this.input.workspaceRoot;
        const hasGitRepo = doctor.checks.git.some((check) => check.id === "git-repository" && check.status === "ok");
        const projectState = this.detectProjectState();
        const runtimeProfileKey = this.recommendRuntimeProfile(doctor);
        return {
            version: 1,
            workspaceKey: this.input.workspace.key,
            rootPath,
            runtimeProfileKey,
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
    async assistWithAgent(input: { runtime: ResolvedAgentRuntime; userMessage?: string; currentPlan?: WorkspaceSetupAssistPlan | null }) {
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
    simplifyChecksForAssist(checks: DoctorChecks) {
        const mapCheck = (entry: DoctorCheck) => ({ id: entry.id, status: entry.status, message: entry.message });
        return {
            agentHarness: checks.agentHarness.map(mapCheck),
            filesystem: checks.filesystem.map(mapCheck),
            git: checks.git.map(mapCheck),
            runtime: checks.runtime.map(mapCheck),
            quality: checks.quality.map(mapCheck),
            integrations: checks.integrations.map(mapCheck)
        };
    }
    buildWorkspaceAssistPrompt(doctor: ReturnType<WorkspaceSetupService["doctor"]>, userMessage?: string) {
        return [
            "You are planning a BeerEngineer workspace setup flow.",
            "Return a planning-only result. Do not execute commands.",
            "Prefer preserving existing brownfield projects over scaffolding starter files.",
            "For runtime profiles, recommend codex_primary or claude_primary only when both Codex and Claude are available.",
            "If no built-in profile is a clean fit, set runtimeProfileKey to null and explain the manual_custom next steps: workspace:runtime:profiles, workspace:runtime:show, workspace:runtime:set-stage, workspace:runtime:set-worker, workspace:runtime:set-interactive.",
            `Workspace status: ${doctor.status}`,
            userMessage ? `User setup request:\n${userMessage}` : null
        ]
            .filter((value) => Boolean(value))
            .join("\n\n");
    }
    async createAssistSession(input: { runtime: ResolvedAgentRuntime }) {
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
    parseStoredPlan(value: string): WorkspaceSetupAssistPlan {
        return this.loadParsedBootstrapPlan(JSON.parse(value), "session");
    }
    detectProjectState(): ProjectState {
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
        ].filter((value): value is string => Boolean(value));
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
    findInteractiveHarness(harnesses: DetectedHarness[]): DetectedHarness | null {
        return harnesses.find((harness) => harness.interactiveCapable) ?? null;
    }
    findSetupCapableHarness(harnesses: DetectedHarness[]): DetectedHarness | null {
        return harnesses.find((harness) => harness.setupCapable) ?? null;
    }
    detectGitRemoteOrigin(workspaceRoot: string): string | null {
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
    formatBootstrapCommand(sessionId: string): string {
        return `npm run cli -- --workspace ${this.input.workspace.key} workspace:bootstrap --session-id ${sessionId}`;
    }
    formatAssistCommand() {
        return `npm run cli -- --workspace ${this.input.workspace.key} workspace:assist`;
    }
    formatNextAssistCommand(session: WorkspaceAssistSession): string {
        return session.status === "open" ? this.formatBootstrapCommand(session.id) : this.formatAssistCommand();
    }
    createDirectoryAction(id: string, path: string, message: string): WorkspaceAction {
        mkdirSync(path, { recursive: true });
        return { id, status: "created", message, path };
    }
    gitInitAction(workspaceRoot: string): WorkspaceAction {
        execFileSync("git", ["init", "-b", "main"], { cwd: workspaceRoot, stdio: ["ignore", "pipe", "pipe"] });
        return { id: "git-init", status: "created", message: `Initialized a git repository in ${workspaceRoot}.`, command: ["git", "init", "-b", "main"] };
    }
    ensureFile(input: { id: string; path: string; content: string; dryRun: boolean; ensureParentDirectory?: boolean }): WorkspaceAction[] {
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
        if (currentContent.includes(input.entry) || currentContent.endsWith(input.entry.trimEnd())) {
            return [
                {
                    id: input.id,
                    status: "skipped",
                    message: `${input.path} already ignores BeerEngineer runtime data.`,
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
                        ? `Would update ${input.path} to ignore BeerEngineer runtime data.`
                        : `Would create ${input.path} and ignore BeerEngineer runtime data.`,
                    path: input.path
                }
            ];
        }
        mkdirSync(parentDirectory, { recursive: true });
        const separator = currentContent.length > 0 && !currentContent.endsWith("\n") ? "\n" : "";
        const upgradedContent = currentContent.includes(legacyBeerengineerGitignoreEntry)
            ? currentContent.replace(`${legacyBeerengineerGitignoreEntry}\n`, "").replace(legacyBeerengineerGitignoreEntry, "")
            : currentContent;
        const upgradedSeparator = upgradedContent.length > 0 && !upgradedContent.endsWith("\n") ? "\n" : "";
        writeFileSync(input.path, `${upgradedContent}${upgradedSeparator}${input.entry}`, "utf8");
        return [
            {
                id: input.id,
                status: pathExists ? "updated" : "created",
                message: `${input.path} ignores BeerEngineer worktrees.`,
                path: input.path
            }
        ];
    }
    installDependenciesCommand(stack: "node-ts" | "python"): string[] {
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
    installDependenciesAction(workspaceRoot: string, stack: "node-ts" | "python"): WorkspaceAction {
        const command = this.installDependenciesCommand(stack);
        execFileSync(command[0], command.slice(1), { cwd: workspaceRoot, stdio: ["ignore", "pipe", "pipe"] });
        return {
            id: "bootstrap-install-deps",
            status: "created",
            message: `Installed ${stack === "python" ? "Python" : "npm"} dependencies in ${workspaceRoot}.`,
            command
        };
    }
    toPackageName(value: string): string {
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
