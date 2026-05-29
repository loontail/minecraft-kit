import type { InstallPhase } from "./install";
import type { VerificationKind } from "./verify";
import type { VerificationFileResult } from "./verify";

/**
 * Stable string constants for the `type` discriminator of every {@link ProgressEvent}.
 * Use these instead of bare string literals when filtering events.
 *
 * @example
 * ```ts
 * import { EventTypes } from "@loontail/minecraft-kit";
 *
 * await kit.install.run(plan, {
 *   onEvent: (e) => {
 *     if (e.type === EventTypes.DOWNLOAD_PROGRESS) updateBar(e.bytesDownloaded, e.totalBytes);
 *     if (e.type === EventTypes.INSTALL_PHASE_CHANGED) setPhase(e.phase);
 *   },
 * });
 * ```
 */
export const EventTypes = {
  INSTALL_PHASE_CHANGED: "install:phase-changed",
  DOWNLOAD_STARTED: "download:started",
  DOWNLOAD_PROGRESS: "download:progress",
  DOWNLOAD_SKIPPED: "download:skipped",
  DOWNLOAD_COMPLETED: "download:completed",
  DOWNLOAD_FAILED: "download:failed",
  INTEGRITY_VERIFIED: "integrity:verified",
  INTEGRITY_MISMATCH: "integrity:mismatch",
  ARCHIVE_EXTRACTED: "archive:extracted",
  FORGE_PROCESSOR_STARTED: "forge:processor-started",
  FORGE_PROCESSOR_COMPLETED: "forge:processor-completed",
  FORGE_PROCESSOR_OUTPUT_VERIFIED: "forge:processor-output-verified",
  VERIFY_FILE_CHECKED: "verify:file-checked",
  LAUNCH_STARTING: "launch:starting",
  LAUNCH_STARTED: "launch:started",
  LAUNCH_STDOUT: "launch:stdout",
  LAUNCH_STDERR: "launch:stderr",
  LAUNCH_EXITED: "launch:exited",
  LAUNCH_ABORTED: "launch:aborted",
} as const;

/**
 * Literal type of the `type` discriminator of a {@link ProgressEvent}.
 *
 * @example
 * ```ts
 * import { EventTypes, type EventType } from "@loontail/minecraft-kit";
 *
 * const interesting = new Set<EventType>([EventTypes.DOWNLOAD_FAILED, EventTypes.INTEGRITY_MISMATCH]);
 * const onEvent = (e: { type: EventType }) => { if (interesting.has(e.type)) console.warn(e); };
 * ```
 */
export type EventType = (typeof EventTypes)[keyof typeof EventTypes];

/**
 * Reference to a single file used in download events.
 *
 * @example
 * ```ts
 * import { EventTypes, type FileRef } from "@loontail/minecraft-kit";
 *
 * await kit.install.run(plan, {
 *   onEvent: (e) => {
 *     if (e.type === EventTypes.DOWNLOAD_COMPLETED) {
 *       const file: FileRef = e.file;
 *       console.log(`fetched ${file.url} → ${file.target}`);
 *     }
 *   },
 * });
 * ```
 */
export type FileRef = {
  readonly url: string;
  readonly target: string;
  readonly category?: string;
};

/**
 * A single processor description used in Forge events.
 *
 * @example
 * ```ts
 * import { EventTypes, type ProcessorRef } from "@loontail/minecraft-kit";
 *
 * const onForge = (e: { type: typeof EventTypes.FORGE_PROCESSOR_STARTED; processor: ProcessorRef; total: number }) =>
 *   console.log(`forge processor ${e.processor.index + 1}/${e.total}: ${e.processor.mainClass}`);
 * ```
 */
export type ProcessorRef = {
  readonly index: number;
  readonly mainClass: string;
};

/**
 * Optional aspect metadata attached by verification and aggregate repair flows.
 *
 * Standalone install events usually omit it because the install plan already
 * carries action categories. `repair.all` attaches it so consumers can tell
 * whether a forwarded event belongs to Minecraft, runtime, Fabric, or Forge.
 */
export type ProgressEventContext = {
  readonly aspect?: VerificationKind;
};

/**
 * Discriminated union of all runtime progress events. Pass an `onEvent` callback to
 * `install.run`, `update.run`, `verify.run`, `repair.run`, or `launch.run` to receive these.
 *
 * @example
 * ```ts
 * import { EventTypes, type ProgressEvent } from "@loontail/minecraft-kit";
 *
 * const onEvent = (e: ProgressEvent) => {
 *   if (e.type === EventTypes.DOWNLOAD_FAILED) console.error(e.file.target, e.error.message);
 *   if (e.type === EventTypes.LAUNCH_EXITED) console.log("game exited", e.code);
 * };
 * ```
 */
export type ProgressEvent = ProgressEventContext &
  (
    | {
        readonly type: "install:phase-changed";
        readonly phase: InstallPhase;
        readonly previous: InstallPhase | null;
      }
    | { readonly type: "download:started"; readonly file: FileRef; readonly expectedSize: number }
    | {
        readonly type: "download:progress";
        readonly file: FileRef;
        readonly bytesDownloaded: number;
        readonly totalBytes: number;
      }
    | { readonly type: "download:skipped"; readonly file: FileRef }
    | {
        readonly type: "download:completed";
        readonly file: FileRef;
        readonly durationMs: number;
        readonly bytes: number;
      }
    | {
        readonly type: "download:failed";
        readonly file: FileRef;
        readonly error: Error;
        readonly willRetry: boolean;
      }
    | {
        readonly type: "integrity:verified";
        readonly file: FileRef;
        readonly algorithm: "sha1" | "sha256";
        readonly hash: string;
      }
    | {
        readonly type: "integrity:mismatch";
        readonly file: FileRef;
        readonly algorithm: "sha1" | "sha256";
        readonly expected: string;
        readonly actual: string;
      }
    | {
        readonly type: "archive:extracted";
        readonly archive: string;
        readonly target: string;
        readonly fileCount: number;
      }
    | {
        readonly type: "forge:processor-started";
        readonly processor: ProcessorRef;
        readonly total: number;
      }
    | {
        readonly type: "forge:processor-completed";
        readonly processor: ProcessorRef;
        readonly exitCode: number;
        readonly durationMs: number;
      }
    | {
        readonly type: "forge:processor-output-verified";
        readonly processor: ProcessorRef;
        readonly path: string;
      }
    | { readonly type: "verify:file-checked"; readonly file: VerificationFileResult }
    | {
        readonly type: "launch:starting";
        readonly command: string;
        readonly args: readonly string[];
        readonly cwd: string;
      }
    | { readonly type: "launch:started"; readonly pid: number }
    | { readonly type: "launch:stdout"; readonly line: string }
    | { readonly type: "launch:stderr"; readonly line: string }
    | {
        readonly type: "launch:exited";
        readonly code: number | null;
        readonly signal: NodeJS.Signals | null;
      }
    | { readonly type: "launch:aborted"; readonly reason: string }
  );

/**
 * Listener signature accepted by every long-running operation.
 *
 * @example
 * ```ts
 * import type { ProgressListener } from "@loontail/minecraft-kit";
 *
 * const listener: ProgressListener = (e) => console.log(e.type);
 * await kit.install.run(plan, { onEvent: listener });
 * ```
 */
export type ProgressListener = (event: ProgressEvent) => void;

/**
 * Common options accepted by long-running operations.
 *
 * @example
 * ```ts
 * import type { OperationOptions } from "@loontail/minecraft-kit";
 *
 * const controller = new AbortController();
 * const options: OperationOptions = { signal: controller.signal, onEvent: console.log };
 * await kit.install.run(plan, options);
 * ```
 */
export type OperationOptions = {
  readonly signal?: AbortSignal;
  readonly onEvent?: ProgressListener;
};
