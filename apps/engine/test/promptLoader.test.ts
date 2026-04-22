import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { clearPromptCache, loadPrompt, PromptLoadError } from "../src/llm/prompts/loader.js"

test("loadPrompt strips the title heading and caches results", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-prompts-"))
  mkdirSync(join(dir, "system"), { recursive: true })
  writeFileSync(join(dir, "system", "demo.md"), "# Demo Prompt\n\nfirst body\n", "utf8")

  const previous = process.env.BEERENGINEER_PROMPTS_DIR
  process.env.BEERENGINEER_PROMPTS_DIR = dir
  clearPromptCache()

  try {
    const first = loadPrompt("system", "demo")
    writeFileSync(join(dir, "system", "demo.md"), "# Demo Prompt\n\nsecond body\n", "utf8")
    const second = loadPrompt("system", "demo")

    assert.equal(first, "first body\n")
    assert.equal(second, "first body\n")
  } finally {
    clearPromptCache()
    if (previous === undefined) delete process.env.BEERENGINEER_PROMPTS_DIR
    else process.env.BEERENGINEER_PROMPTS_DIR = previous
  }
})

test("loadPrompt errors loudly on a missing file", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-prompts-"))
  const previous = process.env.BEERENGINEER_PROMPTS_DIR
  process.env.BEERENGINEER_PROMPTS_DIR = dir
  clearPromptCache()

  try {
    assert.throws(
      () => loadPrompt("reviewers", "missing"),
      (error: unknown) =>
        error instanceof PromptLoadError &&
        error.missing &&
        error.message.includes(join(dir, "reviewers", "missing.md")) &&
        error.message.includes('kind="reviewers" id="missing"'),
    )
  } finally {
    clearPromptCache()
    if (previous === undefined) delete process.env.BEERENGINEER_PROMPTS_DIR
    else process.env.BEERENGINEER_PROMPTS_DIR = previous
  }
})

test("loadPrompt honors BEERENGINEER_PROMPTS_DIR relative to cwd", () => {
  const cwd = process.cwd()
  const root = mkdtempSync(join(tmpdir(), "be2-prompts-cwd-"))
  const relativeDir = "fixtures/prompts"
  mkdirSync(join(root, relativeDir, "workers"), { recursive: true })
  writeFileSync(join(root, relativeDir, "workers", "execution.md"), "# Execution\n\nrelative body\n", "utf8")

  const previousDir = process.env.BEERENGINEER_PROMPTS_DIR
  clearPromptCache()
  process.chdir(root)
  process.env.BEERENGINEER_PROMPTS_DIR = relativeDir

  try {
    assert.equal(loadPrompt("workers", "execution"), "relative body\n")
  } finally {
    process.chdir(cwd)
    clearPromptCache()
    if (previousDir === undefined) delete process.env.BEERENGINEER_PROMPTS_DIR
    else process.env.BEERENGINEER_PROMPTS_DIR = previousDir
  }
})
