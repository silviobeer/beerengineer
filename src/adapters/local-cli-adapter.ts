import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { AppError } from "../shared/errors.js";
import type {
  AgentAdapter,
  AdapterRunRequest,
  AdapterRunResult,
  ExecutionAdapterRunRequest,
  ExecutionAdapterRunResult,
  DocumentationAdapterRunRequest,
  DocumentationAdapterRunResult,
  QaAdapterRunRequest,
  QaAdapterRunResult,
  RalphVerificationAdapterRunRequest,
  RalphVerificationAdapterRunResult,
  StoryReviewAdapterRunRequest,
  StoryReviewAdapterRunResult,
  TestPreparationAdapterRunRequest,
  TestPreparationAdapterRunResult
} from "./types.js";

export class AgentExecutionError extends AppError {
  public constructor(message: string) {
    super("AGENT_EXECUTION_ERROR", message);
    this.name = "AgentExecutionError";
  }
}

export class LocalCliAdapter implements AgentAdapter {
  public readonly key = "local-cli";

  public constructor(
    private readonly repoRoot: string,
    private readonly scriptPath = "scripts/local-agent.mjs",
    private readonly timeoutMs = 120_000
  ) {}

  public async run(request: AdapterRunRequest): Promise<AdapterRunResult> {
    const parsed = this.executePayload(request) as Omit<AdapterRunResult, "stdout" | "stderr" | "exitCode" | "command">;
    return {
      ...parsed,
      stdout: parsed ? JSON.stringify(parsed) : "",
      stderr: "",
      exitCode: 0,
      command: [process.execPath, resolve(this.repoRoot, this.scriptPath)]
    };
  }

  public async runStoryExecution(request: ExecutionAdapterRunRequest): Promise<ExecutionAdapterRunResult> {
    const parsed = this.executePayload(request) as { output: ExecutionAdapterRunResult["output"] };
    return {
      output: parsed.output,
      stdout: JSON.stringify(parsed),
      stderr: "",
      exitCode: 0,
      command: [process.execPath, resolve(this.repoRoot, this.scriptPath)]
    };
  }

  public async runStoryTestPreparation(
    request: TestPreparationAdapterRunRequest
  ): Promise<TestPreparationAdapterRunResult> {
    const parsed = this.executePayload(request) as { output: TestPreparationAdapterRunResult["output"] };
    return {
      output: parsed.output,
      stdout: JSON.stringify(parsed),
      stderr: "",
      exitCode: 0,
      command: [process.execPath, resolve(this.repoRoot, this.scriptPath)]
    };
  }

  public async runStoryRalphVerification(
    request: RalphVerificationAdapterRunRequest
  ): Promise<RalphVerificationAdapterRunResult> {
    const parsed = this.executePayload(request) as { output: RalphVerificationAdapterRunResult["output"] };
    return {
      output: parsed.output,
      stdout: JSON.stringify(parsed),
      stderr: "",
      exitCode: 0,
      command: [process.execPath, resolve(this.repoRoot, this.scriptPath)]
    };
  }

  public async runProjectQa(request: QaAdapterRunRequest): Promise<QaAdapterRunResult> {
    const parsed = this.executePayload(request) as { output: QaAdapterRunResult["output"] };
    return {
      output: parsed.output,
      stdout: JSON.stringify(parsed),
      stderr: "",
      exitCode: 0,
      command: [process.execPath, resolve(this.repoRoot, this.scriptPath)]
    };
  }

  public async runProjectDocumentation(
    request: DocumentationAdapterRunRequest
  ): Promise<DocumentationAdapterRunResult> {
    const parsed = this.executePayload(request) as { output: DocumentationAdapterRunResult["output"] };
    return {
      output: parsed.output,
      stdout: JSON.stringify(parsed),
      stderr: "",
      exitCode: 0,
      command: [process.execPath, resolve(this.repoRoot, this.scriptPath)]
    };
  }

  public async runStoryReview(request: StoryReviewAdapterRunRequest): Promise<StoryReviewAdapterRunResult> {
    const parsed = this.executePayload(request) as { output: StoryReviewAdapterRunResult["output"] };
    return {
      output: parsed.output,
      stdout: JSON.stringify(parsed),
      stderr: "",
      exitCode: 0,
      command: [process.execPath, resolve(this.repoRoot, this.scriptPath)]
    };
  }

  private executePayload(
    request:
      | AdapterRunRequest
      | ExecutionAdapterRunRequest
      | TestPreparationAdapterRunRequest
      | RalphVerificationAdapterRunRequest
      | StoryReviewAdapterRunRequest
      | QaAdapterRunRequest
      | DocumentationAdapterRunRequest
  ): unknown {
    const tempDir = mkdtempSync(join(tmpdir(), "beerengineer-agent-"));
    const payloadPath = join(tempDir, "payload.json");
    writeFileSync(payloadPath, JSON.stringify(request, null, 2), "utf8");

    try {
      const command = [process.execPath, resolve(this.repoRoot, this.scriptPath), payloadPath];
      const result = spawnSync(command[0], command.slice(1), {
        cwd: this.repoRoot,
        encoding: "utf8",
        timeout: this.timeoutMs
      });

      if (result.error) {
        throw new AgentExecutionError(result.error.message);
      }

      if (result.signal) {
        throw new AgentExecutionError(`Agent process terminated by signal ${result.signal}`);
      }

      if (result.status !== 0) {
        throw new AgentExecutionError(result.stderr || "Agent process failed");
      }

      return JSON.parse(result.stdout);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}
