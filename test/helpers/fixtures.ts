import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadFixture(name: string): string {
  return readFileSync(resolve("test/fixtures", name), "utf8");
}
