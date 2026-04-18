import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ConfigurationError } from "../shared/errors.js";
export type ResolvableProfile = {
  promptPath: string;
  skillPaths: readonly string[];
};

export type ResolvedRunProfile = {
  promptPath: string;
  promptContent: string;
  skills: Array<{
    path: string;
    content: string;
  }>;
};

export class PromptResolver {
  public constructor(private readonly repoRoot: string) {}

  public resolve(profile: ResolvableProfile): ResolvedRunProfile {
    const promptPath = resolve(this.repoRoot, profile.promptPath);
    const promptContent = this.readFile(promptPath);
    const skills = profile.skillPaths.map((skillPath) => {
      const absolutePath = resolve(this.repoRoot, skillPath);
      return {
        path: skillPath,
        content: this.readFile(absolutePath)
      };
    });

    return {
      promptPath: profile.promptPath,
      promptContent,
      skills
    };
  }

  private readFile(filePath: string): string {
    try {
      return readFileSync(filePath, "utf8");
    } catch (error) {
      throw new ConfigurationError(`Failed to read prompt or skill file at ${filePath}`, {
        cause: error
      });
    }
  }
}
