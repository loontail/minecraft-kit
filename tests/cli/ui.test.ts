import { describe, expect, it } from "vitest";
import { createStubUi } from "../../src/cli/ui";

describe("createStubUi", () => {
  it("returns an ok outcome by default", async () => {
    const ui = createStubUi(["hello"]);
    const outcome = await ui.text({ message: "name?" });
    expect(outcome).toEqual({ kind: "ok", value: "hello" });
  });

  it("supports back / cancel shorthands", async () => {
    const ui = createStubUi(["back", "cancel"]);
    const selectOutcome = await ui.select({ message: "?", options: [{ label: "a", value: 1 }] });
    expect(selectOutcome.kind).toBe("back");
    const confirmOutcome = await ui.confirm({ message: "?" });
    expect(confirmOutcome.kind).toBe("cancel");
  });

  it("supports raw outcome objects", async () => {
    const ui = createStubUi([{ kind: "back" }, { kind: "cancel" }]);
    expect(
      (await ui.searchableSelect({ message: "?", options: [{ label: "a", value: 1 }] })).kind,
    ).toBe("back");
    expect((await ui.text({ message: "?" })).kind).toBe("cancel");
  });

  it("captures intro / outro / log / note calls", () => {
    const ui = createStubUi();
    ui.intro("hello");
    ui.outro("bye");
    ui.note("title", "body");
    ui.log("info", "info-msg");
    expect(ui.calls.map((c) => c.kind)).toEqual(["intro", "outro", "note", "log"]);
  });

  it("captures spinner start / message / stop", () => {
    const ui = createStubUi();
    const sp = ui.spinner();
    sp.start("starting");
    sp.message("update 1");
    sp.message("update 2");
    sp.stop("done");
    expect(ui.calls.map((c) => c.kind)).toEqual([
      "spinner-start",
      "spinner-message",
      "spinner-message",
      "spinner-stop",
    ]);
  });

  it("captures spinner stop without message", () => {
    const ui = createStubUi();
    ui.spinner().stop();
    expect(ui.calls[0]?.kind).toBe("spinner-stop");
  });

  it("throws when script is exhausted", async () => {
    const ui = createStubUi();
    await expect(ui.text({ message: "?" })).rejects.toBeTruthy();
  });
});
