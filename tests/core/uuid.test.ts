import { describe, expect, it } from "vitest";
import { offlineUuidFor, stripUuidDashes } from "../../src/core/uuid";

describe("uuid", () => {
  it("derives stable UUIDs for the same name", () => {
    const first = offlineUuidFor("Notch");
    const second = offlineUuidFor("Notch");
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("derives different UUIDs for different names", () => {
    expect(offlineUuidFor("a")).not.toBe(offlineUuidFor("b"));
  });

  it("strips dashes", () => {
    expect(stripUuidDashes("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")).toBe(
      "aaaaaaaabbbbccccddddeeeeeeeeeeee",
    );
  });
});
