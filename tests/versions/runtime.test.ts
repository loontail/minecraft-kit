import { describe, expect, it } from "vitest";
import { ApiEndpoints } from "../../src/constants/api";
import { silentLogger } from "../../src/core/logger";
import { createMemoryCache } from "../../src/http/cache";
import { RuntimePreference } from "../../src/types/runtime";
import type { RuntimeSystem } from "../../src/types/system";
import { RuntimeVersionsApi } from "../../src/versions/runtime";
import { FakeHttpClient } from "../helpers/fake-http";

const system: RuntimeSystem = { os: "windows", arch: "x64", osVersion: "10.0" };

const runtimeIndex = {
  "windows-x64": {
    "java-runtime-gamma": [
      {
        availability: { group: 1, progress: 100 },
        manifest: { sha1: "x", size: 1, url: "https://m/" },
        version: { name: "17.0.8", released: "2024-01-01" },
      },
    ],
    "jre-legacy": [
      {
        availability: { group: 1, progress: 100 },
        manifest: { sha1: "y", size: 1, url: "https://l/" },
        version: { name: "8.0.0", released: "2018-01-01" },
      },
    ],
  },
  linux: {},
};

const buildKit = (): { api: RuntimeVersionsApi; http: FakeHttpClient } => {
  const http = new FakeHttpClient().on(ApiEndpoints.mojang.runtimeIndex(), {
    body: JSON.stringify(runtimeIndex),
  });
  const api = new RuntimeVersionsApi({ http, cache: createMemoryCache(), logger: silentLogger });
  return { api, http };
};

describe("RuntimeVersionsApi", () => {
  it("lists components", async () => {
    const { api } = buildKit();
    const list = await api.list({ system });
    expect(list.length).toBe(2);
  });

  it("returns empty for unknown platform", async () => {
    const { api } = buildKit();
    const list = await api.list({
      system: { os: "windows", arch: "arm64", osVersion: "10.0" },
    });
    expect(list).toEqual([]);
  });

  it("resolves a specific component", async () => {
    const { api } = buildKit();
    const resolved = await api.resolve({ system, component: "java-runtime-gamma" });
    expect(resolved.component).toBe("java-runtime-gamma");
  });

  it("falls back to latest available with LATEST preference", async () => {
    const { api } = buildKit();
    const resolved = await api.resolve({
      system,
      component: "missing-component",
      preference: RuntimePreference.LATEST,
    });
    expect(resolved.component).toBe("java-runtime-gamma");
  });

  it("rejects when component not on platform", async () => {
    const { api } = buildKit();
    await expect(api.resolve({ system, component: "missing-component" })).rejects.toBeTruthy();
  });

  it("rejects when platform missing", async () => {
    const { api } = buildKit();
    await expect(
      api.resolve({ system: { os: "linux", arch: "arm64", osVersion: "5.0" } }),
    ).rejects.toBeTruthy();
  });

  it("rejects a runtime index that does not match the expected shape", async () => {
    const http = new FakeHttpClient().on(ApiEndpoints.mojang.runtimeIndex(), {
      body: '{"windows-x64":{"java-runtime-gamma":[{"manifest":{"sha1":"x"}}]}}',
    });
    const api = new RuntimeVersionsApi({ http, cache: createMemoryCache(), logger: silentLogger });
    await expect(api.list({ system })).rejects.toMatchObject({ code: "MANIFEST_INVALID" });
  });
});
