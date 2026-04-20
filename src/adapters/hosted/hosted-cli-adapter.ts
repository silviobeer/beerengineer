import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

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
  InteractiveBrainstormAdapterRunRequest,
  InteractiveBrainstormAdapterRunResult,
  InteractiveStoryReviewAdapterRunRequest,
  InteractiveStoryReviewAdapterRunResult,
  QaAdapterRunRequest,
  QaAdapterRunResult,
  RalphVerificationAdapterRunRequest,
  RalphVerificationAdapterRunResult,
  StoryReviewAdapterRunRequest,
  StoryReviewAdapterRunResult,
  TestPreparationAdapterRunRequest,
  TestPreparationAdapterRunResult
} from "../types.js";

export type AnyAdapterRequest =
  | AdapterRunRequest
  | InteractiveBrainstormAdapterRunRequest
  | InteractiveStoryReviewAdapterRunRequest
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
  private static readonly structuredPayloadInstructionsByKind: Record<string, string> = {
    story_test_preparation: [
      "Inside `output`, return exactly these fields:",
      '{ "summary": string, "testFiles": Array<{ "path": string, "content": string, "writeMode": "proposed"|"written" }>, "testsGenerated": Array<{ "path": string, "intent": string }>, "assumptions": string[], "blockers": string[] }',
      "`testFiles` and `testsGenerated` are required and must be non-empty when the run succeeds."
    ].join("\n"),
    story_execution: [
      "Inside `output`, return exactly these fields:",
      '{ "summary": string, "changedFiles": string[], "testsRun": Array<{ "command": string, "status": "passed"|"failed"|"not_run" }>, "implementationNotes": string[], "blockers": string[] }'
    ].join("\n"),
    story_ralph_verification: [
      "Inside `output`, return exactly these fields:",
      '{ "storyCode": string, "overallStatus": "passed"|"review_required"|"failed", "summary": string, "acceptanceCriteriaResults": Array<{ "acceptanceCriterionId": string, "acceptanceCriterionCode": string, "status": "passed"|"review_required"|"failed", "evidence": string, "notes": string }>, "blockers": string[] }'
    ].join("\n"),
    story_app_verification: [
      "Inside `output`, return exactly these fields:",
      '{ "storyCode": string, "runner": "agent_browser"|"playwright", "overallStatus": "passed"|"review_required"|"failed", "summary": string, "resolvedStartUrl"?: string|null, "checks": Array<{ "id": string, "description": string, "status": "passed"|"review_required"|"failed", "evidence": string }>, "artifacts": Array<{ "kind": "screenshot"|"log"|"trace"|"report", "path": string, "label": string, "contentType": string }>, "failureSummary"?: string|null }'
    ].join("\n"),
    story_review: [
      "Inside `output`, return exactly these fields:",
      '{ "storyCode": string, "overallStatus": "passed"|"review_required"|"failed", "summary": string, "findings": Array<{ "severity": "critical"|"high"|"medium"|"low", "category": "correctness"|"security"|"reliability"|"performance"|"maintainability"|"persistence", "title": string, "description": string, "evidence": string, "filePath"?: string|null, "line"?: number|null, "suggestedFix"?: string|null }>, "recommendations": string[] }'
    ].join("\n"),
    project_qa: [
      "Inside `output`, return exactly these fields:",
      '{ "projectCode": string, "overallStatus": "passed"|"review_required"|"failed", "summary": string, "findings": Array<{ "severity": "critical"|"high"|"medium"|"low", "category": "functional"|"security"|"regression"|"ux", "title": string, "description": string, "evidence": string, "reproSteps": string[], "suggestedFix": string, "storyCode"?: string|null, "acceptanceCriterionCode"?: string|null }>, "recommendations": string[] }'
    ].join("\n"),
    project_documentation: [
      "Inside `output`, return exactly these fields:",
      '{ "projectCode": string, "overallStatus": "completed"|"review_required", "summary": string, "originalScope": string, "deliveredScope": string, "architectureSnapshot": string, "waves": Array<{ "waveCode": string, "goal": string, "storiesDelivered": string[] }>, "storiesDelivered": Array<{ "storyCode": string, "summary": string }>, "verificationSummary": { "ralphPassedStoryCodes": string[], "storyReviewPassedStoryCodes": string[], "qaStatus": "passed"|"review_required", "qaOpenFindingCount": number }, "technicalReviewSummary": { "reviewedStoryCodes": string[], "openFindingCounts": { "critical": number, "high": number, "medium": number, "low": number } }, "qaSummary": { "status": "passed"|"review_required", "summary": string, "openFindings": number }, "openFollowUps": string[], "keyChangedAreas": string[], "reportMarkdown": string }'
    ].join("\n")
  };

  protected constructor(
    public readonly key: string,
    protected readonly baseCommand: string[],
    protected readonly baseEnv: Record<string, string>,
    protected readonly timeoutMs: number
  ) {}

  public async run(request: AdapterRunRequest): Promise<AdapterRunResult> {
    const executed = await this.executeCommand({
      request,
      prompt: this.buildPrompt("stage_run", request)
    });
    const parsed = this.parseJsonText(executed.outputText) as AdapterRunResult;
    return {
      markdownArtifacts: parsed.markdownArtifacts,
      structuredArtifacts: parsed.structuredArtifacts,
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

  public async runInteractiveStoryReview(
    request: InteractiveStoryReviewAdapterRunRequest
  ): Promise<InteractiveStoryReviewAdapterRunResult> {
    return this.executeOutputEnvelope<InteractiveStoryReviewAdapterRunResult>("interactive_story_review", request);
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
    const responseEnvelopeInstructions =
      kind === "stage_run"
        ? [
            "The final JSON object must use this exact top-level shape:",
            '{ "markdownArtifacts": Array<{ "kind": string, "content": string }>, "structuredArtifacts": Array<{ "kind": string, "content": unknown }> }'
          ].join("\n")
        : [
            "The final JSON object must use this exact top-level shape:",
            '{ "output": <the structured result payload> }',
            "Do not place assistant text or structured fields at the top level. Put the full result inside `output`."
          ].join("\n");
    const structuredPayloadInstructions = this.buildStructuredPayloadInstructions(kind, request);
    const resolvedSkillsSection =
      skills && skills.length > 0
        ? ["Resolved skills:", skills.map((skill) => `Path: ${skill.path}\n${skill.content}`).join("\n\n---\n\n")].join("\n")
        : null;
    const sections = [
      "You are the BeerEngineer provider backend.",
      "Return exactly one JSON object matching the requested result envelope.",
      "Do not wrap the response in markdown fences or prose.",
      "The runtime policy is engine-owned and must be followed exactly.",
      "Use the provided prompt and skills as the authoritative work instructions.",
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
    if ("interactionType" in request && request.interactionType === "brainstorm_chat") {
      return [
        "Inside `output`, return exactly these fields:",
        '{ "assistantMessage": string, "draftPatch": { "problem"?: string|null, "coreOutcome"?: string|null, "targetUsers"?: string[], "useCases"?: string[], "constraints"?: string[], "nonGoals"?: string[], "risks"?: string[], "openQuestions"?: string[], "candidateDirections"?: string[], "recommendedDirection"?: string|null, "scopeNotes"?: string|null, "assumptions"?: string[] }, "needsStructuredFollowUp": boolean, "followUpHint": string|null }',
        "Keep `draftPatch` narrow and only include keys you are actually changing."
      ].join("\n");
    }
    if ("interactionType" in request && request.interactionType === "story_review_chat") {
      return [
        "Inside `output`, return exactly these fields:",
        '{ "assistantMessage": string, "entryUpdates": Array<{ "entryId": string, "status": "pending"|"accepted"|"needs_revision"|"rejected"|"resolved", "summary": string, "changeRequest"?: string|null, "rationale"?: string|null, "severity"?: "critical"|"high"|"medium"|"low"|null }>, "needsStructuredFollowUp": boolean, "followUpHint": string|null, "recommendedResolution": "approve"|"approve_and_autorun"|"approve_all"|"approve_all_and_autorun"|"approve_selected"|"request_changes"|"request_story_revisions"|"apply_story_edits"|null }',
        "If feedback is ambiguous, return an empty `entryUpdates` array and set `needsStructuredFollowUp` to true."
      ].join("\n");
    }
    return HostedCliAdapterBase.structuredPayloadInstructionsByKind[kind] ?? null;
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
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        child.kill("SIGTERM");
        reject(new HostedAgentExecutionError(`Agent process timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

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
        clearTimeout(timer);
        reject(new HostedAgentExecutionError(error.message));
      });
      child.on("close", (code, signal) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (signal) {
          reject(new HostedAgentExecutionError(`Agent process terminated by signal ${signal}`));
          return;
        }
        if ((code ?? 1) !== 0) {
          reject(new HostedAgentExecutionError(this.sanitizeErrorOutput(stderr)));
          return;
        }
        resolve({
          stdout,
          stderr,
          exitCode: code ?? 0
        });
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
