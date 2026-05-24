import { describe, expect, it } from "vitest";
import { createMemoryCache } from "../../src/http/cache";
import { planAssetDownloads } from "../../src/install/assets";
import { FakeHttpClient } from "../helpers/fake-http";

const indexBody = JSON.stringify({
  objects: {
    "minecraft/sounds/x": { hash: "abcdef0123456789", size: 100 },
    "minecraft/sounds/y": { hash: "1234567890abcdef", size: 200 },
  },
});

describe("planAssetDownloads", () => {
  it("emits an action per object plus the index", async () => {
    const http = new FakeHttpClient().on("https://idx/", { body: indexBody });
    const result = await planAssetDownloads({
      directory: "/r",
      assetIndex: { id: "5", sha1: "x", size: 1, totalSize: 1, url: "https://idx/" },
      http,
      cache: createMemoryCache(),
    });
    expect(result.actions.length).toBe(3);
    expect(result.indexDocument.objects["minecraft/sounds/x"]?.hash).toBe("abcdef0123456789");
  });

  it("rejects an asset index that does not match the expected shape", async () => {
    const http = new FakeHttpClient().on("https://idx/", {
      body: '{"objects":{"x":{"hash":1,"size":2}}}',
    });
    await expect(
      planAssetDownloads({
        directory: "/r",
        assetIndex: { id: "5", sha1: "x", size: 1, totalSize: 1, url: "https://idx/" },
        http,
        cache: createMemoryCache(),
      }),
    ).rejects.toMatchObject({ code: "MANIFEST_INVALID" });
  });
});
