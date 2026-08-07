import { describe, expect, it } from "vitest";
import { createMemoryCache } from "../../src/http/cache";
import { planRuntimeDownloads } from "../../src/install/runtime";
import type { ResolvedRuntime } from "../../src/types/runtime";
import { FakeHttpClient } from "../helpers/fake-http";

const runtime: ResolvedRuntime = {
  component: "java-runtime-gamma",
  platformKey: "windows-x64",
  versionName: "17",
  system: { os: "windows", arch: "x64", osVersion: "10" },
  manifestUrl: "https://m/",
  manifestSha1: "x",
};

const manifest = {
  files: {
    "bin/javaw.exe": {
      type: "file",
      executable: true,
      downloads: { raw: { sha1: "abc", size: 999, url: "https://r/javaw" } },
    },
    bin: { type: "directory" },
    link: { type: "link", target: "bin/javaw.exe" },
  },
};

describe("planRuntimeDownloads", () => {
  it("emits downloads only for file entries", async () => {
    const http = new FakeHttpClient().on("https://m/", { body: JSON.stringify(manifest) });
    const result = await planRuntimeDownloads({
      runtime,
      directory: "/r",
      http,
      cache: createMemoryCache(),
    });
    expect(result.actions.length).toBe(1);
    expect(result.actions[0]?.expectedSha1).toBe("abc");
  });

  it("rejects a runtime files manifest that does not match the expected shape", async () => {
    const http = new FakeHttpClient().on("https://m/", {
      body: '{"files":{"x":{"executable":true}}}',
    });
    await expect(
      planRuntimeDownloads({
        runtime,
        directory: "/r",
        http,
        cache: createMemoryCache(),
      }),
    ).rejects.toMatchObject({ code: "MANIFEST_INVALID" });
  });

  // A `file` entry with no `downloads` is dereferenced three levels deep by the planner; it
  // has to be caught at the boundary rather than escaping as a raw TypeError, otherwise
  // `repair.all`'s error classification (which switches on MinecraftKitError codes) can't
  // see it.
  it("rejects a file entry with no downloads as MANIFEST_INVALID, not a TypeError", async () => {
    const http = new FakeHttpClient().on("https://m/", {
      body: '{"files":{"bin/javaw.exe":{"type":"file","executable":true}}}',
    });
    const error = await planRuntimeDownloads({
      runtime,
      directory: "/r",
      http,
      cache: createMemoryCache(),
    }).catch((cause: unknown) => cause);

    expect(error).not.toBeInstanceOf(TypeError);
    expect(error).toMatchObject({ code: "MANIFEST_INVALID" });
  });

  it("rejects a link entry with no target as MANIFEST_INVALID", async () => {
    const http = new FakeHttpClient().on("https://m/", {
      body: '{"files":{"link":{"type":"link"}}}',
    });
    await expect(
      planRuntimeDownloads({ runtime, directory: "/r", http, cache: createMemoryCache() }),
    ).rejects.toMatchObject({ code: "MANIFEST_INVALID" });
  });
});
