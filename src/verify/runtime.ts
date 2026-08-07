import path from "node:path";
import { withOptionalOnEvent, withOptionalSignal } from "../core/optional";
import { targetPaths } from "../core/paths";
import { fetchRuntimeManifest } from "../http/manifests";
import { RuntimeEntryTypes, type RuntimeFilesManifest } from "../types/runtime";
import {
  VerificationKinds,
  type VerificationResult,
  type VerifyAspectInput,
  VerifyFileCategories,
  VerifyFileStatuses,
} from "../types/verify";
import {
  runVerification,
  type VerificationRecorder,
  type VerifyHashedFileInput,
  verifyHashedFiles,
} from "./helpers";

/**
 * Verify the Java runtime files. Honours `target.runtime.installRoot` when set so a
 * shared/global runtime install is checked at its real location instead of the per-target
 * `runtime/` subfolder.
 *
 * Prefer `kit.verify.runtime.run(target)` over importing this directly.
 *
 * @example
 * ```ts
 * import { MinecraftKit } from "@loontail/minecraft-kit";
 *
 * const kit = new MinecraftKit();
 * const result = await kit.verify.runtime.run(target);
 * console.log(`runtime ${result.isValid ? "ok" : "broken"} — ${result.checkedFiles} files checked`);
 * ```
 */
export const verifyRuntime = async (input: VerifyAspectInput): Promise<VerificationResult> => {
  return runVerification(
    {
      targetId: input.target.id,
      kind: VerificationKinds.RUNTIME,
      ...withOptionalOnEvent(input.onEvent),
      ...withOptionalSignal(input.signal),
    },
    async (record) => {
      let manifest: RuntimeFilesManifest;
      try {
        manifest = await fetchRuntimeManifest(
          input.http,
          input.cache,
          input.target.runtime,
          input.signal,
        );
      } catch {
        recordRuntimeManifestUnreachable(record, input.target.runtime.manifestUrl);
        return;
      }
      const runtimeRoot = targetPaths.runtimeRoot(
        input.target.directory,
        input.target.runtime.component,
        input.target.runtime.installRoot,
      );
      const checks: VerifyHashedFileInput[] = [];
      for (const [relative, entry] of Object.entries(manifest.files)) {
        if (entry.type !== RuntimeEntryTypes.FILE) continue;
        checks.push({
          path: path.join(runtimeRoot, relative),
          expectedSha1: entry.downloads.raw.sha1,
          expectedSize: entry.downloads.raw.size,
          url: entry.downloads.raw.url,
          category: VerifyFileCategories.RUNTIME_FILE,
        });
      }
      await verifyHashedFiles(record, checks, input.signal);
    },
  );
};

/**
 * Record a single `MISSING` issue keyed on the manifest URL when the runtime manifest is
 * unreachable. Lets the caller see that the runtime cannot be verified right now; repair
 * will re-attempt the manifest fetch on its next pass.
 */
const recordRuntimeManifestUnreachable = (
  record: VerificationRecorder,
  manifestUrl: string,
): void => {
  record({
    path: manifestUrl,
    category: VerifyFileCategories.RUNTIME_FILE,
    status: VerifyFileStatuses.MISSING,
  });
};
