#!/usr/bin/env node

import Database from "better-sqlite3"
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const BACKUP_RETENTION_COUNT = 5

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

const metadataPath = process.argv[2]
if (!metadataPath) {
  console.error("usage: update-backup.js <metadata.json>")
  process.exit(2)
}

const meta = readJson(metadataPath)
mkdirSync(meta.install.backupRoot, { recursive: true })
const stamp = new Date().toISOString().replace(/:/g, "-")
const backupDir = join(meta.install.backupRoot, `${stamp}-${meta.currentVersion}-to-${meta.targetVersion}`)
mkdirSync(backupDir, { recursive: true })

const db = new Database(meta.dbPath, { fileMustExist: true })
try {
  db.pragma("wal_checkpoint(TRUNCATE)")
} finally {
  db.close()
}

const files = []
for (const suffix of ["", "-wal", "-shm"]) {
  const src = `${meta.dbPath}${suffix}`
  if (!existsSync(src)) continue
  const name = `beerengineer.sqlite${suffix}`
  const dest = join(backupDir, name)
  copyFileSync(src, dest)
  files.push({ name, bytes: readFileSync(dest).byteLength })
}

const manifest = {
  sourceDbPath: meta.dbPath,
  sourceDbPathSource: meta.dbPathSource,
  createdAt: new Date().toISOString(),
  fromVersion: meta.currentVersion,
  targetVersion: meta.targetVersion,
  operationId: meta.operationId,
  sqliteSha256: sha256File(join(backupDir, "beerengineer.sqlite")),
  files,
}
writeFileSync(join(backupDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8")

try {
  const backups = readdirSync(meta.install.backupRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(meta.install.backupRoot, entry.name))
    .filter(dir => existsSync(join(dir, "manifest.json")))
    .filter(dir => dir !== backupDir)
    .sort((a, b) => {
      const aa = readJson(join(a, "manifest.json"))
      const bb = readJson(join(b, "manifest.json"))
      return Date.parse(bb.createdAt) - Date.parse(aa.createdAt)
    })
  for (const stale of backups.slice(BACKUP_RETENTION_COUNT - 1)) {
    rmSync(stale, { recursive: true, force: true })
  }
} catch {}

process.stdout.write(`${JSON.stringify({ backupDir, manifest })}\n`)
