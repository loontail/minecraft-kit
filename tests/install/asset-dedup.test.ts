import { describe, expect, it } from "vitest";
import { createMemoryCache } from "../../src/http/cache";
import { planAssetDownloads } from "../../src/install/assets";
import { FakeHttpClient } from "../helpers/fake-http";

describe("planAssetDownloads", () => {
  it("emits a single download per unique hash even when multiple virtual paths share it", async () => {
    const sharedHash = "5ff04807c356f1beed0b86ccf659b44b9983e3fa";
    const otherHash = "0123456789abcdef0123456789abcdef01234567";
    const indexBody = JSON.stringify({
      objects: {
        "a.txt": { hash: sharedHash, size: 10 },
        "localized/a.txt": { hash: sharedHash, size: 10 },
        "other.txt": { hash: otherHash, size: 5 },
      },
    });
    const http = new FakeHttpClient().on("https://idx/", { body: indexBody });
    const cache = createMemoryCache();
    const result = await planAssetDownloads({
      directory: "/r",
      assetIndex: { id: "idx", sha1: "x", size: 1, totalSize: 1, url: "https://idx/" },
      http,
      cache,
    });
    const objectActions = result.actions.filter((a) => a.category === "asset");
    expect(objectActions.length).toBe(2);
    const hashes = objectActions.map((a) => a.expectedSha1);
    expect(new Set(hashes).size).toBe(hashes.length);
    expect(hashes).toContain(sharedHash);
    expect(hashes).toContain(otherHash);
  });
});
