import { test } from "node:test"
import assert from "node:assert/strict"

import { resolveManagedInstallRelease } from "../src/core/managedInstall/release.js"

test("resolveManagedInstallRelease defaults to the newest stable GitHub release", async () => {
  const target = await resolveManagedInstallRelease({
    repo: "silviobeer/beerengineer",
    fetchReleases: async () => [
      releasePayload("v2.0.0-beta.1", { prerelease: true, published_at: "2026-02-10T00:00:00Z" }),
      releasePayload("v1.1.0", { published_at: "2026-02-01T00:00:00Z" }),
      releasePayload("v1.2.0", { draft: true, published_at: "2026-03-01T00:00:00Z" }),
      releasePayload("v1.0.0", { published_at: "2026-01-01T00:00:00Z" }),
    ],
  })

  assert.equal(target.repo, "silviobeer/beerengineer")
  assert.equal(target.tag, "v1.1.0")
  assert.equal(target.version, "1.1.0")
  assert.equal(target.tarballUrl, "https://api.github.com/repos/silviobeer/beerengineer/tarball/v1.1.0")
})

test("resolveManagedInstallRelease reports repo tag and download metadata", async () => {
  const target = await resolveManagedInstallRelease({
    repo: "silviobeer/beerengineer",
    fetchReleases: async () => [
      releasePayload("v1.0.0", {
        tarball_url: "https://codeload.github.com/silviobeer/beerengineer/tar.gz/refs/tags/v1.0.0",
        html_url: "https://github.com/silviobeer/beerengineer/releases/tag/v1.0.0",
        published_at: "2026-01-01T00:00:00Z",
      }),
    ],
  })

  assert.deepEqual(target.download, {
    tarballUrl: "https://codeload.github.com/silviobeer/beerengineer/tar.gz/refs/tags/v1.0.0",
    host: "codeload.github.com",
    protocol: "https:",
  })
  assert.equal(target.htmlUrl, "https://github.com/silviobeer/beerengineer/releases/tag/v1.0.0")
})

test("resolveManagedInstallRelease fails clearly when no stable release exists", async () => {
  await assert.rejects(
    resolveManagedInstallRelease({
      repo: "silviobeer/beerengineer",
      fetchReleases: async () => [
        releasePayload("v2.0.0-beta.1", { prerelease: true }),
        releasePayload("v1.0.0-draft", { draft: true }),
      ],
    }),
    /managed_install_release_required:no_stable_release:silviobeer\/beerengineer/,
  )
})

test("resolveManagedInstallRelease rejects non-HTTPS tarball metadata", async () => {
  await assert.rejects(
    resolveManagedInstallRelease({
      repo: "silviobeer/beerengineer",
      fetchReleases: async () => [
        releasePayload("v1.0.0", {
          tarball_url: "http://api.github.com/repos/silviobeer/beerengineer/tarball/v1.0.0",
        }),
      ],
    }),
    /managed_install_release_resolution_failed:insecure_tarball_protocol:http:/,
  )
})

function releasePayload(tag: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    tarball_url: `https://api.github.com/repos/silviobeer/beerengineer/tarball/${tag}`,
    html_url: `https://github.com/silviobeer/beerengineer/releases/tag/${tag}`,
    published_at: "2026-01-01T00:00:00Z",
    ...overrides,
  }
}
