import { MAX_PROCESSOR_STDERR_LINES } from "../constants/defaults";
import { readJarMainClass } from "../core/archive";
import { MinecraftKitError, MinecraftKitErrorCodes } from "../core/errors";
import { fileExists } from "../core/fs";
import { sha1OfFile } from "../core/hash";
import { EventTypes } from "../types/events";
import type { ProgressListener } from "../types/events";
import type { RunForgeProcessorAction } from "../types/install";
import type { Spawner } from "../types/spawner";

/**
 * Inputs to {@link runProcessor}.
 *
 * @internal
 */
export type RunProcessorInput = {
  readonly action: RunForgeProcessorAction;
  readonly javaPath: string;
  readonly spawner: Spawner;
  readonly onEvent?: ProgressListener;
  readonly total: number;
};

/**
 * Execute a single Forge processor and verify its declared outputs.
 *
 * @internal
 */
export const runProcessor = async (input: RunProcessorInput): Promise<void> => {
  const startedAt = Date.now();
  const mainClass = await resolveProcessorMainClass(input.action);
  emit(input, { type: EventTypes.FORGE_PROCESSOR_STARTED, index: input.action.index, mainClass });

  const exit = await spawnProcessor(input, mainClass);
  if (exit.code !== 0) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.FORGE_PROCESSOR_FAILED,
      `Forge processor exited with code ${exit.code ?? "(signal)"}: ${mainClass}`,
      {
        context: {
          mainClass,
          stderr: exit.stderr,
          ...(exit.code !== null ? { exitCode: exit.code } : {}),
        },
      },
    );
  }
  input.onEvent?.({
    type: EventTypes.FORGE_PROCESSOR_COMPLETED,
    processor: { index: input.action.index, mainClass },
    exitCode: exit.code ?? 0,
    durationMs: Date.now() - startedAt,
  });

  await verifySideEffectOutputs(input, mainClass);
  await verifyProcessorOutputs(input, mainClass);
};

/**
 * Output-bearing CLI flags emitted by Forge's installer-tool family. Each entry is
 * `<flag> <path>` and the flag's `<path>` is a file the processor is expected to write.
 *
 *  - `--output` / `--out` — installertools (MCP_DATA, MERGE_MAPPING, …), binarypatcher, FART.
 *  - `--to`              — installertools EXTRACT_FILES (`--from <src> --to <dst>` pairs).
 *  - `--out-jar`         — SpecialSource (used by older Forge profiles, 1.13–1.16.x).
 *
 * `--optional <path>` removes a path from the expected set; Forge marks files that the
 * processor may legitimately skip writing (e.g. EXTRACT_FILES with a default-config that
 * the user has already customised) and we don't want those to flag a missing-output failure.
 *
 * @internal
 */
const OUTPUT_FLAGS = new Set(["--output", "--out", "--to", "--out-jar"]);

// Parse output paths from a processor's args. Paths flagged via `--optional <path>` are
// excluded so existence is best-effort.
//
// Why we need this: many Forge installertools tasks (MERGE_MAPPING, DOWNLOAD_MOJMAPS,
// MCP_DATA, EXTRACT_FILES, …) declare an empty `outputs` map in install_profile.json —
// they only write side-effect files. If one of them exits 0 without producing its
// expected file (e.g. a network glitch in DOWNLOAD_MOJMAPS leaves mojmaps empty, then
// MERGE_MAPPING "merges nothing" and exits 0 with no output), nothing in the install
// pipeline notices, and the next processor that consumes that file crashes with
// FileNotFoundException. Verifying side-effect outputs here turns those silent failures
// into a clean FORGE_PROCESSOR_FAILED at the right step.
export const collectSideEffectOutputs = (args: readonly string[]): readonly string[] => {
  const expected: string[] = [];
  const optional = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];
    if (value === undefined) continue;
    if (flag !== undefined && OUTPUT_FLAGS.has(flag)) {
      expected.push(value);
      i++;
    } else if (flag === "--optional") {
      optional.add(value);
      i++;
    }
  }
  return expected.filter((p) => !optional.has(p));
};

const verifySideEffectOutputs = async (
  input: RunProcessorInput,
  mainClass: string,
): Promise<void> => {
  const expected = collectSideEffectOutputs(input.action.args);
  for (const outputPath of expected) {
    if (!(await fileExists(outputPath))) {
      throw new MinecraftKitError(
        MinecraftKitErrorCodes.FORGE_PROCESSOR_FAILED,
        `Processor exited 0 but expected output is missing: ${outputPath}`,
        { context: { mainClass, filePath: outputPath, processorIndex: input.action.index } },
      );
    }
  }
};

/**
 * Read `Main-Class` from the processor JAR (always `classpath[0]`) now that all
 * libraries have been downloaded.
 *
 * Deferring this lookup from planning to runtime is what lets newer Forge versions work:
 * their processor JARs ship as regular Maven libraries rather than being bundled inside
 * the installer, so the JAR doesn't exist on disk at planning time.
 */
const resolveProcessorMainClass = async (action: RunForgeProcessorAction): Promise<string> => {
  const processorJar = action.classpath[0];
  if (processorJar === undefined) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.FORGE_INSTALLER_INVALID,
      "Forge processor has an empty classpath",
      { context: { processorIndex: action.index } },
    );
  }
  const mainClass = await readJarMainClass(processorJar);
  if (!mainClass) {
    throw new MinecraftKitError(
      MinecraftKitErrorCodes.FORGE_INSTALLER_INVALID,
      `Forge processor jar has no Main-Class: ${processorJar}`,
      { context: { filePath: processorJar } },
    );
  }
  return mainClass;
};

type ProcessorExit = {
  readonly code: number | null;
  readonly stderr: string;
};

const spawnProcessor = async (
  input: RunProcessorInput,
  mainClass: string,
): Promise<ProcessorExit> => {
  const classpathSeparator = process.platform === "win32" ? ";" : ":";
  const args = [
    "-cp",
    input.action.classpath.join(classpathSeparator),
    mainClass,
    ...input.action.args,
  ];
  const stderrTail: string[] = [];
  const child = input.spawner.spawn(input.javaPath, args, { cwd: process.cwd() });
  child.stdout.on("data", () => {});
  child.stderr.on("data", (line) => {
    if (stderrTail.length >= MAX_PROCESSOR_STDERR_LINES) stderrTail.shift();
    stderrTail.push(line);
  });
  const exit = await child.exited;
  return { code: exit.code, stderr: stderrTail.join("\n") };
};

const verifyProcessorOutputs = async (
  input: RunProcessorInput,
  mainClass: string,
): Promise<void> => {
  for (const [outputPath, expectedSha1] of Object.entries(input.action.outputs)) {
    const sha1 = await sha1OfFile(outputPath);
    if (sha1 !== expectedSha1) {
      throw new MinecraftKitError(
        MinecraftKitErrorCodes.FORGE_PROCESSOR_FAILED,
        `Processor output hash mismatch: ${outputPath}`,
        { context: { filePath: outputPath, expectedHash: expectedSha1, actualHash: sha1 } },
      );
    }
    input.onEvent?.({
      type: EventTypes.FORGE_PROCESSOR_OUTPUT_VERIFIED,
      processor: { index: input.action.index, mainClass },
      path: outputPath,
    });
  }
};

const emit = (
  input: RunProcessorInput,
  event: {
    type: typeof EventTypes.FORGE_PROCESSOR_STARTED;
    index: number;
    mainClass: string;
  },
): void => {
  input.onEvent?.({
    type: event.type,
    processor: { index: event.index, mainClass: event.mainClass },
    total: input.total,
  });
};
