import { describe, expect, it, vi } from "vite-plus/test";
import { createDialogCenter } from "./dialog-center.ts";

describe("dialog center", () => {
  it("lists a pending pick and resolves it with the chosen item", async () => {
    const onChange = vi.fn();
    const dc = createDialogCenter({ onChange });
    const promise = dc.forInstance("inst-1").pick([{ label: "A" }, { label: "B" }], {
      title: "Choose",
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    const list = dc.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.items).toHaveLength(2);
    expect(list[0]!.options.title).toBe("Choose");

    dc.resolve(list[0]!.id, 1);
    await expect(promise).resolves.toEqual({ label: "B" });
    expect(dc.list()).toHaveLength(0);
  });

  it("resolves undefined when dismissed", async () => {
    const dc = createDialogCenter({ onChange: () => {} });
    const promise = dc.forInstance("i").pick([{ label: "A" }]);
    dc.resolve(dc.list()[0]!.id, null);
    await expect(promise).resolves.toBeUndefined();
  });

  it("resolves with the original item object (identity preserved)", async () => {
    const dc = createDialogCenter({ onChange: () => {} });
    const items = [{ label: "x" }, { label: "image" }];
    const promise = dc.forInstance("i").pick(items);
    dc.resolve(dc.list()[0]!.id, 1);
    await expect(promise).resolves.toBe(items[1]);
  });

  it("cancelForInstance dismisses only that instance's picks", async () => {
    const dc = createDialogCenter({ onChange: () => {} });
    const a = dc.forInstance("a").pick([{ label: "x" }]);
    const b = dc.forInstance("b").pick([{ label: "y" }]);
    dc.cancelForInstance("a");
    await expect(a).resolves.toBeUndefined();
    expect(dc.list()).toHaveLength(1);
    expect(dc.list()[0]!.items[0]!.label).toBe("y");

    dc.resolve(dc.list()[0]!.id, 0);
    await expect(b).resolves.toEqual({ label: "y" });
  });

  it("reset dismisses all pending picks and restarts ids", async () => {
    const dc = createDialogCenter({ onChange: () => {} });
    const p = dc.forInstance("a").pick([{ label: "x" }]);
    const firstId = dc.list()[0]!.id;
    dc.reset();
    await expect(p).resolves.toBeUndefined();
    expect(dc.list()).toHaveLength(0);

    void dc.forInstance("a").pick([{ label: "y" }]);
    expect(dc.list()[0]!.id).toBe(firstId);
  });

  it("resolve on an unknown id is a no-op", () => {
    const dc = createDialogCenter({ onChange: () => {} });
    expect(() => dc.resolve(999, 0)).not.toThrow();
  });
});
