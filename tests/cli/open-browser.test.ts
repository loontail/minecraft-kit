import process from "node:process";
import { describe, expect, it } from "vitest";
import { openBrowser, pickCommand } from "../../src/cli/open-browser";

const OAUTH_URL_WITH_AMPERSANDS =
  "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?client_id=c&scope=XboxLive.signin+offline_access&redirect_uri=http%3A%2F%2Flocalhost%3A1234&state=s";

describe("openBrowser", () => {
  it("rejects unparseable URLs without spawning", async () => {
    expect(await openBrowser("not a url")).toBe(false);
  });

  it("rejects non-http(s) schemes", async () => {
    expect(await openBrowser("file:///etc/passwd")).toBe(false);
    expect(await openBrowser("data:text/html,<script>")).toBe(false);
    expect(await openBrowser("javascript:alert(1)")).toBe(false);
  });
});

describe("pickCommand", () => {
  it.skipIf(process.platform !== "win32")(
    "uses rundll32 on Windows so `&` in OAuth URLs survives — cmd /c start truncates at the first ampersand",
    () => {
      const picked = pickCommand(OAUTH_URL_WITH_AMPERSANDS);
      expect(picked.command).toBe("rundll32.exe");
      expect(picked.args).toEqual(["url.dll,FileProtocolHandler", OAUTH_URL_WITH_AMPERSANDS]);
    },
  );

  it.skipIf(process.platform !== "darwin")("uses `open` on macOS", () => {
    const picked = pickCommand(OAUTH_URL_WITH_AMPERSANDS);
    expect(picked.command).toBe("open");
    expect(picked.args).toEqual([OAUTH_URL_WITH_AMPERSANDS]);
  });

  it.skipIf(process.platform === "win32" || process.platform === "darwin")(
    "uses `xdg-open` on Linux / other Unix",
    () => {
      const picked = pickCommand(OAUTH_URL_WITH_AMPERSANDS);
      expect(picked.command).toBe("xdg-open");
      expect(picked.args).toEqual([OAUTH_URL_WITH_AMPERSANDS]);
    },
  );
});
