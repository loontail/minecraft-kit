import path from "node:path";
import { targetPaths } from "../core/paths";
import { fetchJson } from "../http/metadata";
import type { MetadataCache } from "../types/cache";
import type { ProgressListener } from "../types/events";
import type { HttpClient } from "../types/http";
import type { RuntimeFilesManifest } from "../types/runtime";
import type { Target } from "../types/target";
import {
  VerificationKinds,
  type VerificationResult,
  VerifyFileCategories,
  VerifyFileStatuses,
} from "../types/verify";
import { runVerification, verifyHashedFile } from "./helpers";

/**
 * Inputs to {@link verifyRuntime}.
 *
 * @internal
 */
export type VerifyRuntimeInput = {
  readonly target: Target;
  readonly http: HttpClient;
  readonly cache: MetadataCache;
  readonly signal?: AbortSignal;
  readonly onEvent?: ProgressListener;
};

/**
 * Verify the Java runtime files. Honours `target.runtime.installRoot` when set so a
 * shared/global runtime install is checked at its real location instead of the per-target
 * `runtime/` subfolder.
 */
export const verifyRuntime = async (input: VerifyRuntimeInput): Promise<VerificationResult> => {
  return runVerification(
    {
      targetId: input.target.id,
      kind: VerificationKinds.RUNTIME,
      ...(input.onEvent !== undefined ? { onEvent: input.onEvent } : {}),
    },
    async (record) => {
      let manifest: RuntimeFilesManifest;
      try {
        manifest = await fetchJson<RuntimeFilesManifest>(input.http, input.cache, {
          url: input.target.runtime.manifestUrl,
          cacheKey: `runtime-manifest:${input.target.runtime.component}:${input.target.runtime.platformKey}:${input.target.runtime.manifestSha1}`,
          ...(input.signal !== undefined ? { signal: input.signal } : {}),
        });
      } catch {
        // Manifest unreachable — record one MISSING issue keyed on the manifest URL so the
        // caller sees that the runtime cannot be verified right now. Repair will re-attempt.
        record({
          path: input.target.runtime.manifestUrl,
          category: VerifyFileCategories.RUNTIME_FILE,
          status: VerifyFileStatuses.MISSING,
        });
        return;
      }
      const runtimeRoot = targetPaths.runtimeRoot(
        input.target.directory,
        input.target.runtime.component,
        input.target.runtime.installRoot,
      );
      for (const [relative, entry] of Object.entries(manifest.files)) {
        if (entry.type !== "file") continue;
        record(
          await verifyHashedFile({
            path: path.join(runtimeRoot, relative),
            expectedSha1: entry.downloads.raw.sha1,
            expectedSize: entry.downloads.raw.size,
            url: entry.downloads.raw.url,
            category: VerifyFileCategories.RUNTIME_FILE,
          }),
        );
      }
    },
  );
};
