import { describe, expect, it } from "vitest";

import {
  resolveDefaultAgentRuntimeOverridePath,
  resolveDefaultDbPath,
  resolveUserDataDir
} from "../../src/shared/user-data-paths.js";

describe("user data paths", () => {
  it("resolves Linux user data paths from XDG_DATA_HOME", () => {
    expect(
      resolveUserDataDir({
        platform: "linux",
        env: { XDG_DATA_HOME: "/tmp/xdg-home" }
      })
    ).toBe("/tmp/xdg-home/beerengineer");
    expect(
      resolveDefaultDbPath({
        platform: "linux",
        env: { XDG_DATA_HOME: "/tmp/xdg-home" }
      })
    ).toBe("/tmp/xdg-home/beerengineer/beerengineer.sqlite");
  });

  it("falls back to HOME-based Linux paths when XDG_DATA_HOME is missing", () => {
    expect(
      resolveUserDataDir({
        platform: "linux",
        env: { HOME: "/home/tester" }
      })
    ).toBe("/home/tester/.local/share/beerengineer");
  });

  it("resolves macOS user data paths", () => {
    expect(
      resolveUserDataDir({
        platform: "darwin",
        env: { HOME: "/Users/tester" }
      })
    ).toBe("/Users/tester/Library/Application Support/beerengineer");
  });

  it("resolves Windows user data paths from APPDATA", () => {
    expect(
      resolveUserDataDir({
        platform: "win32",
        env: { APPDATA: "C:\\Users\\Tester\\AppData\\Roaming" }
      })
    ).toContain("C:\\Users\\Tester\\AppData\\Roaming/beerengineer");
    expect(
      resolveDefaultAgentRuntimeOverridePath({
        platform: "win32",
        env: { APPDATA: "C:\\Users\\Tester\\AppData\\Roaming" }
      })
    ).toContain("C:\\Users\\Tester\\AppData\\Roaming/beerengineer/config/agent-runtime.override.json");
  });
});
