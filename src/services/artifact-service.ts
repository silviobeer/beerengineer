import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type ArtifactPayload = {
  itemId: string;
  projectId?: string | null;
  stageRunId: string;
  kind: string;
  format: "md" | "json";
  content: string;
};

export type WrittenArtifact = {
  path: string;
  sha256: string;
  sizeBytes: number;
};

export class ArtifactService {
  public constructor(private readonly rootDir: string) {}

  public writeArtifact(payload: ArtifactPayload): WrittenArtifact {
    const relativePath = join(
      "items",
      payload.itemId,
      payload.projectId ?? "_shared",
      "runs",
      payload.stageRunId,
      `${payload.kind}.${payload.format}`
    );
    const absolutePath = resolve(this.rootDir, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, payload.content, "utf8");

    const fileBuffer = readFileSync(absolutePath);
    const sha256 = createHash("sha256").update(fileBuffer).digest("hex");
    const stats = statSync(absolutePath);

    return {
      path: relativePath,
      sha256,
      sizeBytes: stats.size
    };
  }
}
