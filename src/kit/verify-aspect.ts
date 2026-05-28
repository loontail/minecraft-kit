/**
 * Builder for `kit.verify`. Wires the four per-aspect verifiers (Minecraft / Fabric /
 * Forge / Runtime) onto a common request shape that forwards signal + event listener.
 *
 * @internal
 * @packageDocumentation
 */

import { withOptionalOnEvent, withOptionalSignal } from "../core/optional";
import type { MetadataCache } from "../types/cache";
import type { HttpClient } from "../types/http";
import type { Target } from "../types/target";
import type { VerificationResult, VerifyOperationOptions } from "../types/verify";
import { verifyFabric } from "../verify/fabric";
import { verifyForge } from "../verify/forge";
import { verifyMinecraft } from "../verify/minecraft";
import { verifyRuntime } from "../verify/runtime";

/**
 * Shape of `kit.verify`. The four per-aspect surfaces all share the same `(target,
 * options) → Promise<VerificationResult>` contract.
 */
export type VerifyAspect = {
  readonly minecraft: {
    run(target: Target, options?: VerifyOperationOptions): Promise<VerificationResult>;
  };
  readonly fabric: {
    run(target: Target, options?: VerifyOperationOptions): Promise<VerificationResult>;
  };
  readonly forge: {
    run(target: Target, options?: VerifyOperationOptions): Promise<VerificationResult>;
  };
  readonly runtime: {
    run(target: Target, options?: VerifyOperationOptions): Promise<VerificationResult>;
  };
};

/**
 * Inputs the verify builder needs from the `MinecraftKit` constructor.
 *
 * @internal
 */
export type VerifyAspectDeps = {
  readonly http: HttpClient;
  readonly cache: MetadataCache;
};

/**
 * Assemble `kit.verify`.
 *
 * @internal
 */
export const buildVerifyAspect = (deps: VerifyAspectDeps): VerifyAspect => {
  const { http, cache } = deps;
  const verifyArgs = (target: Target, opts?: VerifyOperationOptions) => ({
    target,
    http,
    cache,
    ...withOptionalSignal(opts?.signal),
    ...withOptionalOnEvent(opts?.onEvent),
  });
  return {
    minecraft: { run: (target, opts) => verifyMinecraft(verifyArgs(target, opts)) },
    fabric: { run: (target, opts) => verifyFabric(verifyArgs(target, opts)) },
    forge: { run: (target, opts) => verifyForge(verifyArgs(target, opts)) },
    runtime: { run: (target, opts) => verifyRuntime(verifyArgs(target, opts)) },
  };
};
