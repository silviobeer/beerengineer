import { test } from "node:test"
import assert from "node:assert/strict"

import {
  TRUSTED_MANAGED_INSTALL_DOWNLOAD_HOSTS,
  assertTrustedManagedInstallDownloadUrl,
  downloadManagedInstallTarball,
} from "../src/core/managedInstall/download.js"

test("assertTrustedManagedInstallDownloadUrl requires HTTPS and trusted GitHub hosts", () => {
  assert.deepEqual(
    [...TRUSTED_MANAGED_INSTALL_DOWNLOAD_HOSTS].sort(),
    ["api.github.com", "codeload.github.com", "github.com", "objects.githubusercontent.com"],
  )
  for (const host of TRUSTED_MANAGED_INSTALL_DOWNLOAD_HOSTS) {
    assert.doesNotThrow(() => assertTrustedManagedInstallDownloadUrl(`https://${host}/owner/repo/archive.tar.gz`))
  }

  assert.throws(
    () => assertTrustedManagedInstallDownloadUrl("http://github.com/owner/repo/archive.tar.gz?token=secret"),
    err => {
      assert.match((err as Error).message, /unsupported_protocol:http:/)
      assert.doesNotMatch((err as Error).message, /secret/)
      return true
    },
  )
  assert.throws(
    () => assertTrustedManagedInstallDownloadUrl("https://evil.example/archive.tar.gz?token=secret"),
    err => {
      assert.match((err as Error).message, /untrusted_host:evil.example/)
      assert.doesNotMatch((err as Error).message, /secret/)
      return true
    },
  )
})

test("downloadManagedInstallTarball fails closed on untrusted redirects", async () => {
  await assert.rejects(
    downloadManagedInstallTarball("https://github.com/silviobeer/beerengineer/archive.tar.gz", {
      request: async () => ({
        statusCode: 302,
        headers: { location: "https://evil.example/archive.tar.gz?token=secret" },
        body: Buffer.alloc(0),
      }),
    }),
    err => {
      assert.match((err as Error).message, /managed_install_download_failed:untrusted_redirect_host:evil.example/)
      assert.doesNotMatch((err as Error).message, /secret/)
      return true
    },
  )
})

test("downloadManagedInstallTarball follows trusted redirects and returns final metadata", async () => {
  const seen: string[] = []
  const result = await downloadManagedInstallTarball("https://github.com/silviobeer/beerengineer/archive.tar.gz", {
    request: async url => {
      seen.push(url.toString())
      if (url.hostname === "github.com") {
        return {
          statusCode: 302,
          headers: { location: "https://codeload.github.com/silviobeer/beerengineer/tar.gz/refs/tags/v1.0.0" },
          body: Buffer.alloc(0),
        }
      }
      return {
        statusCode: 200,
        headers: {},
        body: Buffer.from("tarball"),
      }
    },
  })

  assert.equal(result.body.toString("utf8"), "tarball")
  assert.equal(result.finalUrl, "https://codeload.github.com/silviobeer/beerengineer/tar.gz/refs/tags/v1.0.0")
  assert.deepEqual(seen, [
    "https://github.com/silviobeer/beerengineer/archive.tar.gz",
    "https://codeload.github.com/silviobeer/beerengineer/tar.gz/refs/tags/v1.0.0",
  ])
})

test("downloadManagedInstallTarball times out stalled download requests", async () => {
  await assert.rejects(
    downloadManagedInstallTarball("https://github.com/silviobeer/beerengineer/archive.tar.gz", {
      requestTimeoutMs: 10,
      request: async () => await new Promise(() => {}),
    }),
    /managed_install_download_failed:timeout/,
  )
})
