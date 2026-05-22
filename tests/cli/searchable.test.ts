import { describe, expect, it } from "vitest";
import { MAX_VISIBLE_OPTIONS, buildUi } from "../../src/cli/ui";

type Recorded = {
  readonly kind: "text" | "select";
  readonly opts: Record<string, unknown>;
};

type FakeClack = {
  readonly recorded: Recorded[];
  readonly module: Parameters<typeof buildUi>[0];
};

const makeFakeClack = (answers: readonly unknown[]): FakeClack => {
  const queue = [...answers];
  const recorded: Recorded[] = [];
  const module: Parameters<typeof buildUi>[0] = {
    intro: () => {},
    outro: () => {},
    note: () => {},
    log: { info: () => {}, success: () => {}, warn: () => {}, error: () => {} },
    text: async (opts: object) => {
      recorded.push({ kind: "text", opts: opts as Record<string, unknown> });
      if (queue.length === 0) throw new Error("Fake clack exhausted (text)");
      return queue.shift();
    },
    select: async (opts: object) => {
      recorded.push({ kind: "select", opts: opts as Record<string, unknown> });
      if (queue.length === 0) throw new Error("Fake clack exhausted (select)");
      return queue.shift();
    },
    confirm: async (opts: object) => {
      recorded.push({ kind: "select", opts: opts as Record<string, unknown> });
      return queue.shift();
    },
    spinner: () => ({ start: () => {}, message: () => {}, stop: () => {} }),
    isCancel: (value: unknown) => value === Symbol.for("mckit:test:cancel"),
  };
  return { recorded, module };
};

describe("Ui.searchableSelect", () => {
  it("shows the list immediately — no filter prompt, no filter sentinel option", async () => {
    const options = Array.from({ length: 100 }, (_, i) => ({
      label: `1.21.${i}`,
      value: `1.21.${i}`,
    }));
    const fake = makeFakeClack(["1.21.5"]);
    const ui = buildUi(fake.module);
    const result = await ui.searchableSelect({ message: "Pick", options });
    expect(result).toEqual({ kind: "ok", value: "1.21.5" });
    expect(fake.recorded).toHaveLength(1);
    expect(fake.recorded[0]?.kind).toBe("select");
    const opts = fake.recorded[0]?.opts as { options: { label: string }[] };
    expect(opts.options.every((o) => !o.label.toLowerCase().includes("filter"))).toBe(true);
    expect(opts.options.every((o) => !o.label.includes("🔎"))).toBe(true);
  });

  it("clips a huge list to the first MAX_VISIBLE_OPTIONS without extra entries", async () => {
    const options = Array.from({ length: 887 }, (_, i) => ({
      label: `1.${i}`,
      value: `v${i}`,
    }));
    const fake = makeFakeClack(["v0"]);
    const ui = buildUi(fake.module);
    const result = await ui.searchableSelect({ message: "Pick", options });
    expect(result).toEqual({ kind: "ok", value: "v0" });
    const opts = fake.recorded[0]?.opts as { options: { label: string }[] };
    expect(opts.options.length).toBe(MAX_VISIBLE_OPTIONS);
  });

  it("appends back / cancel sentinels when requested", async () => {
    const options = Array.from({ length: 100 }, (_, i) => ({
      label: `${i}`,
      value: i,
    }));
    const fake = makeFakeClack([3]);
    const ui = buildUi(fake.module);
    await ui.searchableSelect({ message: "Pick", options, allowBack: true, allowCancel: true });
    const opts = fake.recorded[0]?.opts as { options: { label: string }[] };
    const labels = opts.options.map((o) => o.label);
    expect(labels).toContain("← Back");
    expect(labels).toContain("✕ Cancel");
    expect(opts.options.length).toBe(MAX_VISIBLE_OPTIONS + 2);
  });

  it("uses regular select directly when option count is below threshold", async () => {
    const options = Array.from({ length: 5 }, (_, i) => ({
      label: `${i}`,
      value: i,
    }));
    const fake = makeFakeClack([3]);
    const ui = buildUi(fake.module);
    const result = await ui.searchableSelect({ message: "Pick", options });
    expect(result).toEqual({ kind: "ok", value: 3 });
    expect(fake.recorded.length).toBe(1);
    expect(fake.recorded[0]?.kind).toBe("select");
  });

  it("propagates cancel from the select", async () => {
    const options = Array.from({ length: 100 }, (_, i) => ({
      label: `${i}`,
      value: i,
    }));
    const fake = makeFakeClack([Symbol.for("mckit:test:cancel")]);
    const ui = buildUi(fake.module);
    const result = await ui.searchableSelect({ message: "Pick", options });
    expect(result.kind).toBe("cancel");
  });
});
