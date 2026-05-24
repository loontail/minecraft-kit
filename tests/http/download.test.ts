import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MinecraftKitError, MinecraftKitErrorCodes } from "../../src/core/errors";
import { downloadFile } from "../../src/http/download";
import type { ProgressEvent } from "../../src/types/events";
import { FakeHttpClient } from "../helpers/fake-http";
import { sha1OfBytes } from "../helpers/hash";

describe("downloadFile", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mckit-dl-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("writes file and reports events", async () => {
    const body = new TextEncoder().encode("hello world");
    const expectedSha1 = sha1OfBytes(body);
    const http = new FakeHttpClient().on("https://x/", { body });
    const target = path.join(tmpDir, "x");
    const events: ProgressEvent[] = [];
    const result = await downloadFile(http, {
      url: "https://x/",
      target,
      expectedSha1,
      expectedSize: body.byteLength,
      onEvent: (e) => events.push(e),
    });
    expect(result.bytesDownloaded).toBe(body.byteLength);
    expect(result.skipped).toBe(false);
    expect(await fs.readFile(target, "utf8")).toBe("hello world");
    expect(events.some((e) => e.type === "download:started")).toBe(true);
    expect(events.some((e) => e.type === "download:completed")).toBe(true);
    expect(events.some((e) => e.type === "integrity:verified")).toBe(true);
  });

  it("skips when destination is already valid", async () => {
    const body = new TextEncoder().encode("hello");
    const expectedSha1 = sha1OfBytes(body);
    const target = path.join(tmpDir, "x");
    await fs.writeFile(target, body);
    const http = new FakeHttpClient();
    const result = await downloadFile(http, {
      url: "https://x/",
      target,
      expectedSha1,
      expectedSize: body.byteLength,
    });
    expect(result.skipped).toBe(true);
    expect(http.requests.length).toBe(0);
  });

  it("rejects on hash mismatch", async () => {
    const body = new TextEncoder().encode("abc");
    const http = new FakeHttpClient().on("https://x/", { body });
    const target = path.join(tmpDir, "x");
    await expect(
      downloadFile(http, {
        url: "https://x/",
        target,
        expectedSha1: "0".repeat(40),
        expectedSize: 3,
      }),
    ).rejects.toBeInstanceOf(MinecraftKitError);
  });

  it("rejects on size mismatch", async () => {
    const body = new TextEncoder().encode("abc");
    const http = new FakeHttpClient().on("https://x/", { body });
    const target = path.join(tmpDir, "x");
    await expect(
      downloadFile(http, {
        url: "https://x/",
        target,
        expectedSize: 99,
      }),
    ).rejects.toBeInstanceOf(MinecraftKitError);
  });

  it("rejects non-http(s) URL schemes before issuing a request", async () => {
    const http = new FakeHttpClient();
    const target = path.join(tmpDir, "x");
    await expect(downloadFile(http, { url: "file:///etc/passwd", target })).rejects.toThrow(
      /INVALID_INPUT|http\(s\)/,
    );
    await expect(downloadFile(http, { url: "data:text/plain,oops", target })).rejects.toThrow(
      /INVALID_INPUT|http\(s\)/,
    );
    expect(http.requests.length).toBe(0);
  });

  it("rejects unparseable URLs", async () => {
    const http = new FakeHttpClient();
    const target = path.join(tmpDir, "x");
    await expect(downloadFile(http, { url: "not a url at all", target })).rejects.toThrow(
      /INVALID_INPUT|not parseable/,
    );
    expect(http.requests.length).toBe(0);
  });

  it("rejects URLs whose host is not in the allow-list", async () => {
    const body = new TextEncoder().encode("ok");
    const http = new FakeHttpClient().on("https://evil.example.com/", { body });
    const target = path.join(tmpDir, "x");
    await expect(
      downloadFile(http, {
        url: "https://evil.example.com/",
        target,
        hostAllowList: ["*.minecraft.net", "maven.minecraftforge.net"],
      }),
    ).rejects.toThrow(/allow-list/);
    expect(http.requests.length).toBe(0);
  });

  it("accepts URLs whose host matches a wildcard allow-list entry", async () => {
    const body = new TextEncoder().encode("ok");
    const expectedSha1 = sha1OfBytes(body);
    const http = new FakeHttpClient().on("https://piston-data.minecraft.net/file", { body });
    const target = path.join(tmpDir, "x");
    const result = await downloadFile(http, {
      url: "https://piston-data.minecraft.net/file",
      target,
      expectedSha1,
      hostAllowList: ["*.minecraft.net"],
    });
    expect(result.bytesDownloaded).toBe(body.byteLength);
  });

  it("falls back to the next mirror URL when the first one fails", async () => {
    const body = new TextEncoder().encode("mirror-ok");
    const expectedSha1 = sha1OfBytes(body);
    const http = new FakeHttpClient()
      .on("https://primary/file", {
        error: () =>
          new MinecraftKitError(MinecraftKitErrorCodes.NETWORK_HTTP_ERROR, "primary 404", {
            context: { url: "https://primary/file", httpStatus: 404 },
          }),
      })
      .on("https://mirror/file", { body });
    const target = path.join(tmpDir, "x");
    const events: ProgressEvent[] = [];
    const result = await downloadFile(http, {
      url: ["https://primary/file", "https://mirror/file"],
      target,
      expectedSha1,
      expectedSize: body.byteLength,
      onEvent: (e) => events.push(e),
    });
    expect(result.bytesDownloaded).toBe(body.byteLength);
    expect(result.skipped).toBe(false);
    expect(await fs.readFile(target, "utf8")).toBe("mirror-ok");
    const completed = events.find((e) => e.type === "download:completed");
    expect(completed && "file" in completed ? completed.file.url : undefined).toBe(
      "https://mirror/file",
    );
  });

  it("aggregates errors when every mirror URL fails", async () => {
    const http = new FakeHttpClient()
      .on("https://a/file", {
        error: () =>
          new MinecraftKitError(MinecraftKitErrorCodes.NETWORK_HTTP_ERROR, "a 404", {
            context: { url: "https://a/file", httpStatus: 404 },
          }),
      })
      .on("https://b/file", {
        error: () =>
          new MinecraftKitError(MinecraftKitErrorCodes.NETWORK_HTTP_ERROR, "b 404", {
            context: { url: "https://b/file", httpStatus: 404 },
          }),
      });
    const target = path.join(tmpDir, "x");
    let caught: unknown;
    try {
      await downloadFile(http, {
        url: ["https://a/file", "https://b/file"],
        target,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MinecraftKitError);
    const error = caught as MinecraftKitError;
    expect(error.code).toBe(MinecraftKitErrorCodes.NETWORK_HTTP_ERROR);
    expect(error.context.urls).toEqual(["https://a/file", "https://b/file"]);
    expect(error.cause).toBeInstanceOf(AggregateError);
    const aggregate = error.cause as AggregateError;
    expect(aggregate.errors.length).toBe(2);
  });

  it("rejects an empty URL array before issuing any request", async () => {
    const http = new FakeHttpClient();
    const target = path.join(tmpDir, "x");
    let caught: unknown;
    try {
      await downloadFile(http, { url: [], target });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MinecraftKitError);
    expect((caught as MinecraftKitError).code).toBe(MinecraftKitErrorCodes.INVALID_INPUT);
    expect(http.requests.length).toBe(0);
  });

  it("stops mirror fallback when the caller aborts", async () => {
    const http = new FakeHttpClient()
      .on("https://a/file", {
        error: () =>
          new MinecraftKitError(MinecraftKitErrorCodes.NETWORK_ABORTED, "aborted", {
            context: { url: "https://a/file" },
          }),
      })
      .on("https://b/file", {
        body: new TextEncoder().encode("never-reached"),
      });
    const target = path.join(tmpDir, "x");
    await expect(
      downloadFile(http, {
        url: ["https://a/file", "https://b/file"],
        target,
      }),
    ).rejects.toMatchObject({ code: MinecraftKitErrorCodes.NETWORK_ABORTED });
    expect(http.requests.length).toBe(1);
  });
});
