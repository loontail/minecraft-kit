import { describe, expect, it } from "vitest";
import { MinecraftKitError } from "../../src/core/errors";
import {
  VerificationKinds,
  VerifyFileCategories,
  VerifyFileStatuses,
} from "../../src/types/verify";
import { runVerification } from "../../src/verify/helpers";

describe("runVerification — abort checkpoint", () => {
  it("stops recording further files once the signal aborts", async () => {
    const controller = new AbortController();
    let recorded = 0;
    await expect(
      runVerification(
        {
          targetId: "t",
          kind: VerificationKinds.MINECRAFT,
          signal: controller.signal,
        },
        async (record) => {
          record({
            path: "first",
            category: VerifyFileCategories.CLIENT_JAR,
            status: VerifyFileStatuses.OK,
          });
          recorded++;
          controller.abort();
          record({
            path: "second",
            category: VerifyFileCategories.CLIENT_JAR,
            status: VerifyFileStatuses.OK,
          });
          recorded++;
        },
      ),
    ).rejects.toBeInstanceOf(MinecraftKitError);
    expect(recorded).toBe(1);
  });

  it("records every file when no signal is provided", async () => {
    const result = await runVerification(
      { targetId: "t", kind: VerificationKinds.MINECRAFT },
      async (record) => {
        record({
          path: "first",
          category: VerifyFileCategories.CLIENT_JAR,
          status: VerifyFileStatuses.OK,
        });
        record({
          path: "second",
          category: VerifyFileCategories.CLIENT_JAR,
          status: VerifyFileStatuses.OK,
        });
      },
    );
    expect(result.checkedFiles).toBe(2);
    expect(result.isValid).toBe(true);
  });
});
