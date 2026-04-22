import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { PromptResolver } from "../../services/prompt-resolver.js";
import { AppError } from "../../shared/errors.js";
import type {
  AdapterRunRequest,
  AdapterRunResult,
  AppVerificationAdapterRunRequest,
  AppVerificationAdapterRunResult,
  DocumentationAdapterRunRequest,
  DocumentationAdapterRunResult,
  ExecutionAdapterRunRequest,
  ExecutionAdapterRunResult,
  ImplementationReviewAdapterRunRequest,
  ImplementationReviewAdapterRunResult,
  InteractiveBrainstormAdapterRunRequest,
  InteractiveBrainstormAdapterRunResult,
  PlanningReviewAdapterRunRequest,
  PlanningReviewAdapterRunResult,
  InteractiveStoryReviewAdapterRunRequest,
  InteractiveStoryReviewAdapterRunResult,
  QaAdapterRunRequest,
  QaAdapterRunResult,
  RalphVerificationAdapterRunRequest,
  RalphVerificationAdapterRunResult,
  StoryReviewAdapterRunRequest,
  StoryReviewAdapterRunResult,
  TestPreparationAdapterRunRequest,
  TestPreparationAdapterRunResult,
  WorkspaceSetupAssistAdapterRunRequest,
  WorkspaceSetupAssistAdapterRunResult
} from "../types.js";

export type AnyAdapterRequest =
  | AdapterRunRequest
  | PlanningReviewAdapterRunRequest
  | ImplementationReviewAdapterRunRequest
  | InteractiveBrainstormAdapterRunRequest
  | InteractiveStoryReviewAdapterRunRequest
  | WorkspaceSetupAssistAdapterRunRequest
  | ExecutionAdapterRunRequest
  | TestPreparationAdapterRunRequest
  | RalphVerificationAdapterRunRequest
  | AppVerificationAdapterRunRequest
  | StoryReviewAdapterRunRequest
  | QaAdapterRunRequest
  | DocumentationAdapterRunRequest;

type CommandExecutionResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string[];
  outputText: string;
};

export class HostedAgentExecutionError extends AppError {
  public constructor(message: string) {
    super("AGENT_EXECUTION_ERROR", message);
    this.name = "HostedAgentExecutionError";
  }
}

export abstract class HostedCliAdapterBase {
  private static readonly structuredPayloadPromptPathByKind: Record<string, string> = {
    story_test_preparation: "prompts/hosted/contracts/story-test-preparation.md",
    story_execution: "prompts/hosted/contracts/story-execution.md",
    story_ralph_verification: "prompts/hosted/contracts/story-ralph-verification.md",
    story_app_verification: "prompts/hosted/contracts/story-app-verification.md",
    story_review: "prompts/hosted/contracts/story-review.md",
    project_qa: "prompts/hosted/contracts/project-qa.md",
    project_documentation: "prompts/hosted/contracts/project-documentation.md",
    planning_review: "prompts/hosted/contracts/planning-review.md",
    implementation_review: "prompts/hosted/contracts/implementation-review.md"
  };

  private static readonly structuredPayloadPromptPathByInteractionType: Record<string, string> = {
    brainstorm_chat: "prompts/hosted/contracts/interactive-brainstorm.md",
    story_review_chat: "prompts/hosted/contracts/interactive-story-review.md",
    workspace_setup_assist: "prompts/hosted/contracts/workspace-setup-assist.md"
  };

  private readonly promptResolver: PromptResolver;

  protected constructor(
    public readonly key: string,
    repoRoot: string,
    protected readonly baseCommand: string[],
    protected readonly baseEnv: Record<string, string>,
    protected readonly timeoutMs: number
  ) {
    this.promptResolver = new PromptResolver(repoRoot);
  }

  public async run(request: AdapterRunRequest): Promise<AdapterRunResult> {
    const executed = await this.executeCommand({
      request,
      prompt: this.buildPrompt("stage_run", request)
    });
    const parsed = this.parseJsonText(executed.outputText) as AdapterRunResult;
    return {
      markdownArtifacts: parsed.markdownArtifacts,
      structuredArtifacts: parsed.structuredArtifacts,
      needsUserInput: parsed.needsUserInput ?? false,
      userInputQuestion: parsed.userInputQuestion ?? null,
      followUpHint: parsed.followUpHint ?? null,
      stdout: executed.stdout,
      stderr: executed.stderr,
      exitCode: executed.exitCode,
      command: executed.command
    };
  }

  public async runInteractiveBrainstorm(
    request: InteractiveBrainstormAdapterRunRequest
  ): Promise<InteractiveBrainstormAdapterRunResult> {
    return this.executeOutputEnvelope<InteractiveBrainstormAdapterRunResult>("interactive_brainstorm", request);
  }

  public async runPlanningReview(
    request: PlanningReviewAdapterRunRequest
  ): Promise<PlanningReviewAdapterRunResult> {
    return this.executeOutputEnvelope<PlanningReviewAdapterRunResult>("planning_review", request);
  }

  public async runImplementationReview(
    request: ImplementationReviewAdapterRunRequest
  ): Promise<ImplementationReviewAdapterRunResult> {
    return this.executeOutputEnvelope<ImplementationReviewAdapterRunResult>("implementation_review", request);
  }

  public async runInteractiveStoryReview(
    request: InteractiveStoryReviewAdapterRunRequest
  ): Promise<InteractiveStoryReviewAdapterRunResult> {
    return this.executeOutputEnvelope<InteractiveStoryReviewAdapterRunResult>("interactive_story_review", request);
  }

  public async runWorkspaceSetupAssist(
    request: WorkspaceSetupAssistAdapterRunRequest
  ): Promise<WorkspaceSetupAssistAdapterRunResult> {
    return this.executeOutputEnvelope<WorkspaceSetupAssistAdapterRunResult>("workspace_setup_assist", request);
  }

  public async runStoryTestPreparation(
    request: TestPreparationAdapterRunRequest
  ): Promise<TestPreparationAdapterRunResult> {
    return this.executeOutputEnvelope<TestPreparationAdapterRunResult>("story_test_preparation", request);
  }

  public async runStoryExecution(request: ExecutionAdapterRunRequest): Promise<ExecutionAdapterRunResult> {
    return this.executeOutputEnvelope<ExecutionAdapterRunResult>("story_execution", request);
  }

  public async runStoryRalphVerification(
    request: RalphVerificationAdapterRunRequest
  ): Promise<RalphVerificationAdapterRunResult> {
    return this.executeOutputEnvelope<RalphVerificationAdapterRunResult>("story_ralph_verification", request);
  }

  public async runStoryAppVerification(
    request: AppVerificationAdapterRunRequest
  ): Promise<AppVerificationAdapterRunResult> {
    return this.executeOutputEnvelope<AppVerificationAdapterRunResult>("story_app_verification", request);
  }

  public async runStoryReview(request: StoryReviewAdapterRunRequest): Promise<StoryReviewAdapterRunResult> {
    return this.executeOutputEnvelope<StoryReviewAdapterRunResult>("story_review", request);
  }

  public async runProjectQa(request: QaAdapterRunRequest): Promise<QaAdapterRunResult> {
    return this.executeOutputEnvelope<QaAdapterRunResult>("project_qa", request);
  }

  public async runProjectDocumentation(
    request: DocumentationAdapterRunRequest
  ): Promise<DocumentationAdapterRunResult> {
    return this.executeOutputEnvelope<DocumentationAdapterRunResult>("project_documentation", request);
  }

  protected async executeOutputEnvelope<TResult>(kind: string, request: AnyAdapterRequest): Promise<TResult> {
    const executed = await this.executeCommand({
      request,
      prompt: this.buildPrompt(kind, request)
    });
    const parsed = this.parseJsonText(executed.outputText) as Record<string, unknown>;
    return {
      ...parsed,
      stdout: executed.stdout,
      stderr: executed.stderr,
      exitCode: executed.exitCode,
      command: executed.command
    } as TResult;
  }

  protected abstract buildCommand(input: {
    request: AnyAdapterRequest;
    responsePath: string;
  }): string[];

  private buildPrompt(kind: string, request: AnyAdapterRequest): string {
    const { prompt, skills, runtime, ...rest } = request as AnyAdapterRequest & {
      prompt?: string;
      skills?: Array<{ path: string; content: string }>;
    };
    const responseEnvelopeInstructions = this.loadPromptFile(
      kind === "stage_run" ? "prompts/hosted/envelopes/stage-run.md" : "prompts/hosted/envelopes/output.md"
    );
    const structuredPayloadInstructions = this.buildStructuredPayloadInstructions(kind, request);
    const resolvedSkillsSection =
      skills && skills.length > 0
        ? ["Resolved skills:", skills.map((skill) => `Path: ${skill.path}\n${skill.content}`).join("\n\n---\n\n")].join("\n")
        : null;
    const sections = [
      this.loadPromptFile("prompts/hosted/shared/preamble.md"),
      responseEnvelopeInstructions,
      structuredPayloadInstructions,
      `Request kind: ${kind}`,
      `Provider: ${runtime.provider}`,
      `Model: ${runtime.model ?? "default"}`,
      `Workspace root: ${runtime.workspaceRoot}`,
      `Runtime policy:\n${JSON.stringify(runtime.policy, null, 2)}`,
      prompt ? `Primary instructions:\n${prompt}` : null,
      resolvedSkillsSection,
      `Execution payload:\n${JSON.stringify(rest, null, 2)}`
    ].filter((value): value is string => Boolean(value));
    return sections.join("\n\n");
  }

  private buildStructuredPayloadInstructions(kind: string, request: AnyAdapterRequest): string | null {
    if ("interactionType" in request) {
      const promptPath = HostedCliAdapterBase.structuredPayloadPromptPathByInteractionType[request.interactionType];
      return promptPath ? this.loadPromptFile(promptPath) : null;
    }
    const promptPath = HostedCliAdapterBase.structuredPayloadPromptPathByKind[kind];
    return promptPath ? this.loadPromptFile(promptPath) : null;
  }

  private loadPromptFile(relativePath: string): string {
    return this.promptResolver.resolveFile(relativePath);
  }

  private async executeCommand(input: {
    request: AnyAdapterRequest;
    prompt: string;
  }): Promise<CommandExecutionResult> {
    const tempDir = mkdtempSync(join(tmpdir(), "beerengineer-hosted-agent-"));
    const responsePath = join(tempDir, "response.txt");

    try {
      const command = this.buildCommand({
        request: input.request,
        responsePath
      });
      const result = await this.spawnCommand(command, input.request.runtime.workspaceRoot, input.prompt);

      const outputText = this.resolveOutputText(result.stdout, responsePath);
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        command,
        outputText
      };
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  private spawnCommand(command: string[], cwd: string, stdin: string): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }> {
    return new Promise((resolve, reject) => {
      const child = spawn(command[0], command.slice(1), {
        cwd,
        env: {
          ...process.env,
          ...this.baseEnv
        },
        stdio: "pipe"
      });

      let stdout = "";
      let stderr = "";
      let settled = false;
      let exitCode: number | null = null;
      let exitSignal: NodeJS.Signals | null = null;
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        child.kill("SIGTERM");
        reject(new HostedAgentExecutionError(`Agent process timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      let exitFlushTimer: NodeJS.Timeout | null = null;

      const clearTimers = () => {
        clearTimeout(timer);
        if (exitFlushTimer) {
          clearTimeout(exitFlushTimer);
          exitFlushTimer = null;
        }
      };

      const finalize = () => {
        if (settled || exitCode === null) {
          return;
        }
        settled = true;
        clearTimers();
        if (exitSignal) {
          reject(new HostedAgentExecutionError(`Agent process terminated by signal ${exitSignal}`));
          return;
        }
        if (exitCode !== 0) {
          reject(new HostedAgentExecutionError(this.sanitizeErrorOutput(stderr)));
          return;
        }
        resolve({
          stdout,
          stderr,
          exitCode
        });
      };

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimers();
        reject(new HostedAgentExecutionError(error.message));
      });
      child.on("exit", (code, signal) => {
        if (settled) {
          return;
        }
        exitCode = code ?? 0;
        exitSignal = signal;
        exitFlushTimer = setTimeout(finalize, 50);
      });
      child.on("close", (code, signal) => {
        if (exitCode === null) {
          exitCode = code ?? 0;
          exitSignal = signal;
        }
        finalize();
      });
      child.stdin.write(stdin, "utf8");
      child.stdin.end();
    });
  }

  private resolveOutputText(stdout: string, responsePath: string): string {
    const fileOutput = readFileIfPresent(responsePath);
    const candidate = fileOutput ?? stdout;
    if (!candidate.trim()) {
      throw new HostedAgentExecutionError("Agent process did not return any output");
    }
    return candidate.trim();
  }

  private parseJsonText(text: string): unknown {
    const direct = tryParseJson(text);
    if (direct.ok) {
      return direct.value;
    }
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
    if (fenced) {
      const parsedFenced = tryParseJson(fenced);
      if (parsedFenced.ok) {
        return parsedFenced.value;
      }
    }

    const extracted = extractJsonObject(text);
    if (extracted) {
      const parsedExtracted = tryParseJson(extracted);
      if (parsedExtracted.ok) {
        return parsedExtracted.value;
      }
    }

    throw new HostedAgentExecutionError("Agent response was not valid JSON");
  }

  private sanitizeErrorOutput(stderr: string): string {
    const collapsed = stderr.replaceAll(/\s+/g, " ").trim();
    if (!collapsed) {
      return "Agent process failed";
    }
    const truncated = collapsed.length > 500 ? `${collapsed.slice(0, 500)}...` : collapsed;
    return truncated.replaceAll(/(api[_-]?key|token|authorization)\s*[:=]\s*\S+/gi, "$1=[redacted]");
  }
}

function readFileIfPresent(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return {
      ok: true,
      value: JSON.parse(text)
    };
  } catch {
    return { ok: false };
  }
}

function extractJsonObject(text: string): string | null {
  const state: JsonObjectScanState = {
    start: -1,
    depth: 0,
    inString: false,
    escaping: false
  };

  for (let index = 0; index < text.length; index += 1) {
    const result = scanJsonObjectCharacter(state, text[index], index, text);
    if (result !== null) {
      return result;
    }
  }
  return null;
}

type JsonObjectScanState = {
  start: number;
  depth: number;
  inString: boolean;
  escaping: boolean;
};

function scanJsonObjectCharacter(state: JsonObjectScanState, char: string, index: number, text: string): string | null {
  if (state.escaping) {
    state.escaping = false;
    return null;
  }
  if (char === "\\") {
    state.escaping = true;
    return null;
  }
  if (char === "\"") {
    state.inString = !state.inString;
    return null;
  }
  if (state.inString) {
    return null;
  }
  if (char === "{") {
    if (state.start === -1) {
      state.start = index;
    }
    state.depth += 1;
    return null;
  }
  if (char !== "}") {
    return null;
  }
  state.depth -= 1;
  if (state.depth === 0 && state.start !== -1) {
    return text.slice(state.start, index + 1);
  }
  return null;
}
