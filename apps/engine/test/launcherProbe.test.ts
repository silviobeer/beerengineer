import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { readFileSync } from "node:fs"
import { setTimeout as delay } from "node:timers/promises"

import { resolveApiTokenFilePath } from "../src/api/tokenFile.js"
import { resolveEnginePidFilePath } from "../src/api/pidFile.js"

if (process.env.BEERENGINEER_TEST_LAUNCHER_PROBE === "1") {
  test("launcher probe exposes invocation-local config, port, and state paths", async () => {
    const configPath = process.env.BEERENGINEER_CONFIG_PATH
    assert.ok(configPath, "launcher must provide BEERENGINEER_CONFIG_PATH")

    const config = JSON.parse(readFileSync(configPath, "utf8")) as {
      dataDir: string
      enginePort: number
    }
    const server = createServer((_req, res) => res.end("ok"))

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(config.enginePort, "127.0.0.1", () => resolve())
    })

    const payload = {
      label: process.env.BEERENGINEER_TEST_LAUNCHER_LABEL ?? "unlabeled",
      configPath,
      dataDir: config.dataDir,
      enginePort: config.enginePort,
      xdgStateHome: process.env.XDG_STATE_HOME ?? null,
      tokenPath: resolveApiTokenFilePath(),
      pidPath: resolveEnginePidFilePath(),
      inheritedDataDir: process.env.BEERENGINEER_DATA_DIR ?? null,
      inheritedEnginePort: process.env.BEERENGINEER_ENGINE_PORT ?? null,
      inheritedApiTokenFile: process.env.BEERENGINEER_API_TOKEN_FILE ?? null,
      inheritedPidFile: process.env.BEERENGINEER_ENGINE_PID_FILE ?? null,
      inheritedPort: process.env.PORT ?? null,
    }
    console.log(`LAUNCHER_PROBE:${JSON.stringify({ event: "ready", ...payload })}`)

    const holdMs = Number(process.env.BEERENGINEER_TEST_LAUNCHER_HOLD_MS ?? "0")
    if (holdMs > 0) {
      await delay(holdMs)
    }

    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
    })

    console.log(`LAUNCHER_PROBE:${JSON.stringify({ event: "complete", ...payload })}`)
  })
}
