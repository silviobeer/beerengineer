import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { previewPidPath, resolvePreviewLaunchSpec, startPreviewServer, stopPreviewServer } from "../src/core/previewLauncher.js"

function makeWorktree(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  mkdirSync(join(root, ".beerengineer"), { recursive: true })
  return root
}

test("resolvePreviewLaunchSpec rejects preview.cwd traversal", () => {
  const root = makeWorktree("be2-preview-cwd-")
  writeFileSync(
    join(root, ".beerengineer", "workspace.json"),
    JSON.stringify({
      preview: {
        command: "npm run dev",
        cwd: "../outside",
      },
    }, null, 2),
  )

  assert.throws(() => resolvePreviewLaunchSpec(root), /preview_command_cwd_invalid/)
})

test("startPreviewServer waits for the dev server to bind before reporting started", async () => {
  const root = makeWorktree("be2-preview-start-")
  writeFileSync(
    join(root, ".beerengineer", "workspace.json"),
    JSON.stringify({
      preview: {
        command: `${process.execPath} -e "const http=require('node:http');const port=Number(process.env.PORT);http.createServer((_,res)=>res.end('ok')).listen(port, process.env.BEERENGINEER_PREVIEW_HOST, () => setTimeout(() => process.exit(0), 1500));"`,
      },
    }, null, 2),
  )

  const started = await startPreviewServer({
    worktreePath: root,
    previewHost: "127.0.0.1",
    previewPort: 39871,
  })

  assert.equal(started.status, "started")
  assert.equal(started.launch.source, "workspace-config")
  assert.equal(existsSync(previewPidPath(root)), true)
})

test("startPreviewServer fails when the command never starts listening and surfaces the log tail", async () => {
  const root = makeWorktree("be2-preview-fail-")
  writeFileSync(
    join(root, ".beerengineer", "workspace.json"),
    JSON.stringify({
      preview: {
        command: `${process.execPath} -e "console.error('preview boot failed'); process.exit(1)"`,
      },
    }, null, 2),
  )

  await assert.rejects(
    startPreviewServer({
      worktreePath: root,
      previewHost: "127.0.0.1",
      previewPort: 39872,
    }),
    error => {
      assert.match((error as Error).message, /preview_failed_to_listen/)
      assert.match((error as Error).message, /preview boot failed/)
      const logPath = join(root, ".beerengineer-preview.log")
      assert.match(readFileSync(logPath, "utf8"), /preview boot failed/)
      return true
    },
  )
})

test("stopPreviewServer stops a managed preview and removes the pid file", async () => {
  const root = makeWorktree("be2-preview-stop-")
  writeFileSync(
    join(root, ".beerengineer", "workspace.json"),
    JSON.stringify({
      preview: {
        command: `${process.execPath} -e "const http=require('node:http');const port=Number(process.env.PORT);http.createServer((_,res)=>res.end('ok')).listen(port, process.env.BEERENGINEER_PREVIEW_HOST)"`,
      },
    }, null, 2),
  )

  const started = await startPreviewServer({
    worktreePath: root,
    previewHost: "127.0.0.1",
    previewPort: 39873,
  })
  assert.equal(started.status, "started")
  assert.equal(existsSync(previewPidPath(root)), true)

  const stopped = await stopPreviewServer({
    worktreePath: root,
    previewHost: "127.0.0.1",
    previewPort: 39873,
  })

  assert.equal(stopped.status, "stopped")
  assert.equal(existsSync(previewPidPath(root)), false)
})
