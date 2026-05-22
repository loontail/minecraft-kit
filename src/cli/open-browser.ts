import { spawn } from "node:child_process";
import process from "node:process";

/**
 * Safety-net deadline for the spawn promise. Some platforms/permissions can
 * leave the promise hanging if neither `'spawn'` nor `'error'` fires; once
 * this elapses we resolve `false` and let the caller fall back to printing
 * the URL.
 *
 * @internal
 */
const SPAWN_TIMEOUT_MS = 1500;

/**
 * Open `url` in the host's default browser without blocking. Resolves to `true` once the
 * child has actually started (`'spawn'` event), `false` on failure. The child is detached
 * + unref'd so the CLI can exit independently of the browser process.
 *
 * Implementation notes (every one of these used to be a bug):
 *
 * - On Windows we invoke `cmd.exe /c start` **directly**, without `shell: true`. Using
 *   `shell: true` makes Node wrap the command in another `cmd /s /c "..."`, which mangles
 *   the empty-title argument and silently drops the URL.
 * - The `""` after `start` is the window-title argument. Skipping it makes `start` treat a
 *   URL like `"https://..."` as the title and never opens anything.
 * - We resolve on the `'spawn'` event (Node ≥ 15.1) rather than `setImmediate`, otherwise we
 *   race the actual process-start and report success for commands that ENOENT'd.
 * - `windowsHide: true` keeps a console window from flashing.
 *
 * @internal
 */
export const openBrowser = async (url: string): Promise<boolean> => {
  if (!isSafeBrowserUrl(url)) return false;
  const { command, args } = pickCommand(url);
  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const child = spawn(command, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.once("error", () => finish(false));
      child.once("spawn", () => finish(true));
      setTimeout(() => finish(false), SPAWN_TIMEOUT_MS).unref();
      child.unref();
    } catch {
      finish(false);
    }
  });
};

/**
 * Reject anything that isn't a parseable http(s) URL. Handing arbitrary
 * strings (`file://`, `data:`, or anything containing quotes) to
 * `cmd /c start` is a shell-quoting hazard on Windows.
 *
 * @internal
 */
const isSafeBrowserUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
};

const pickCommand = (url: string): { command: string; args: string[] } => {
  switch (process.platform) {
    case "win32":
      return { command: process.env.ComSpec ?? "cmd.exe", args: ["/c", "start", '""', url] };
    case "darwin":
      return { command: "open", args: [url] };
    default:
      return { command: "xdg-open", args: [url] };
  }
};
