import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createToastCenter } from "./toast-center.ts";

describe("createToastCenter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("show returns a handle with update and dismiss", () => {
    const tc = createToastCenter({ onChange: () => {} });
    const handle = tc.show("inst-1", "hello");
    expect(typeof handle.update).toBe("function");
    expect(typeof handle.dismiss).toBe("function");
  });

  it("show adds a toast to list()", () => {
    const tc = createToastCenter({ onChange: () => {} });
    tc.show("inst-1", "hello");
    const toasts = tc.list();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.message).toBe("hello");
    expect(toasts[0]!.loading).toBe(false);
  });

  it("list() returns a copy — mutations do not affect internal state", () => {
    const tc = createToastCenter({ onChange: () => {} });
    tc.show("inst-1", "hello");
    const first = tc.list();
    first.push({ id: 999, message: "injected", loading: false, createdAt: 0, intent: "info" });
    expect(tc.list()).toHaveLength(1);
  });

  it("show invokes onChange", () => {
    const onChange = vi.fn();
    const tc = createToastCenter({ onChange });
    tc.show("inst-1", "hello");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("carries progress + intent and updates them", () => {
    const tc = createToastCenter({ onChange: () => {} });
    const handle = tc.show("inst-1", "Working", { loading: true, progress: 0 });
    expect(tc.list()[0]).toMatchObject({ loading: true, progress: 0, intent: "info" });

    handle.update({ progress: 40, message: "almost" });
    expect(tc.list()[0]).toMatchObject({ progress: 40, message: "almost" });

    handle.update({ loading: false, intent: "error", message: "boom" });
    expect(tc.list()[0]).toMatchObject({ intent: "error", message: "boom" });
  });

  it("defaults intent to info and leaves progress undefined", () => {
    const tc = createToastCenter({ onChange: () => {} });
    tc.show("inst-1", "hi");
    expect(tc.list()[0]!.intent).toBe("info");
    expect(tc.list()[0]!.progress).toBeUndefined();
  });

  it("non-loading toast auto-dismisses after duration (default 2000ms)", () => {
    const onChange = vi.fn();
    const tc = createToastCenter({ onChange });
    tc.show("inst-1", "hello");
    expect(tc.list()).toHaveLength(1);
    vi.advanceTimersByTime(1999);
    expect(tc.list()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(tc.list()).toHaveLength(0);
    // onChange called once for show, once for auto-dismiss
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("non-loading toast auto-dismisses after custom duration", () => {
    const tc = createToastCenter({ onChange: () => {} });
    tc.show("inst-1", "hello", { duration: 5000 });
    vi.advanceTimersByTime(4999);
    expect(tc.list()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(tc.list()).toHaveLength(0);
  });

  it("loading toast does not auto-dismiss", () => {
    const tc = createToastCenter({ onChange: () => {} });
    tc.show("inst-1", "hello", { loading: true });
    vi.advanceTimersByTime(10000);
    expect(tc.list()).toHaveLength(1);
  });

  it("update to loading:true cancels a pending auto-dismiss timer", () => {
    const tc = createToastCenter({ onChange: () => {} });
    const handle = tc.show("inst-1", "hello");
    // Timer is now scheduled for 2000ms
    handle.update({ loading: true });
    vi.advanceTimersByTime(2000);
    // Should NOT have been dismissed
    expect(tc.list()).toHaveLength(1);
    expect(tc.list()[0]!.loading).toBe(true);
  });

  it("update to loading:false restarts the auto-dismiss timer", () => {
    const tc = createToastCenter({ onChange: () => {} });
    const handle = tc.show("inst-1", "hello", { loading: true });
    vi.advanceTimersByTime(5000);
    expect(tc.list()).toHaveLength(1);
    handle.update({ loading: false });
    vi.advanceTimersByTime(1999);
    expect(tc.list()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(tc.list()).toHaveLength(0);
  });

  it("update invokes onChange", () => {
    const onChange = vi.fn();
    const tc = createToastCenter({ onChange });
    const handle = tc.show("inst-1", "hello", { loading: true });
    onChange.mockClear();
    handle.update({ message: "updated" });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("update on a dismissed toast is a no-op", () => {
    const onChange = vi.fn();
    const tc = createToastCenter({ onChange });
    const handle = tc.show("inst-1", "hello");
    handle.dismiss();
    onChange.mockClear();
    handle.update({ message: "ghost" });
    expect(onChange).not.toHaveBeenCalled();
    expect(tc.list()).toHaveLength(0);
  });

  it("dismiss removes the toast from list()", () => {
    const onChange = vi.fn();
    const tc = createToastCenter({ onChange });
    const handle = tc.show("inst-1", "hello");
    onChange.mockClear();
    handle.dismiss();
    expect(tc.list()).toHaveLength(0);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("tc.dismiss(id) removes the toast with that id", () => {
    const tc = createToastCenter({ onChange: () => {} });
    tc.show("inst-1", "hello");
    const id = tc.list()[0]!.id;
    tc.dismiss(id);
    expect(tc.list()).toHaveLength(0);
  });

  it("dismiss cancels the pending auto-dismiss timer", () => {
    const onChange = vi.fn();
    const tc = createToastCenter({ onChange });
    const handle = tc.show("inst-1", "hello");
    handle.dismiss();
    onChange.mockClear();
    // Advance past the 2000ms mark — the timer should not fire again
    vi.advanceTimersByTime(2000);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("dismissForInstance removes only that instance's toasts", () => {
    const tc = createToastCenter({ onChange: () => {} });
    tc.show("inst-1", "from A", { loading: true });
    tc.show("inst-2", "from B", { loading: true });
    tc.show("inst-1", "also from A", { loading: true });
    expect(tc.list()).toHaveLength(3);
    tc.dismissForInstance("inst-1");
    expect(tc.list()).toHaveLength(1);
    expect(tc.list()[0]!.message).toBe("from B");
  });

  it("dismissForInstance invokes onChange for each dismissed toast", () => {
    const onChange = vi.fn();
    const tc = createToastCenter({ onChange });
    tc.show("inst-1", "one", { loading: true });
    tc.show("inst-1", "two", { loading: true });
    onChange.mockClear();
    tc.dismissForInstance("inst-1");
    // Two dismissals
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("dismissForInstance on unknown instanceId is a no-op", () => {
    const onChange = vi.fn();
    const tc = createToastCenter({ onChange });
    onChange.mockClear();
    tc.dismissForInstance("ghost-instance");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reset() clears all toasts, timers, and resets id counter", () => {
    const onChange = vi.fn();
    const tc = createToastCenter({ onChange });
    tc.show("inst-1", "one", { loading: true });
    tc.show("inst-2", "two");
    tc.reset();
    expect(tc.list()).toHaveLength(0);
    // Advance past timers — they should not fire after reset
    onChange.mockClear();
    vi.advanceTimersByTime(5000);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reset() resets the id counter so new toasts start from 1", () => {
    const tc = createToastCenter({ onChange: () => {} });
    tc.show("inst-1", "one");
    tc.reset();
    tc.show("inst-1", "new");
    expect(tc.list()[0]!.id).toBe(1);
  });

  it("multiple toasts from same instance tracked separately; each auto-dismisses on its own timer", () => {
    const tc = createToastCenter({ onChange: () => {} });
    tc.show("inst-1", "a", { duration: 1000 });
    tc.show("inst-1", "b", { duration: 3000 });
    expect(tc.list()).toHaveLength(2);
    vi.advanceTimersByTime(1000);
    expect(tc.list()).toHaveLength(1);
    expect(tc.list()[0]!.message).toBe("b");
    vi.advanceTimersByTime(2000);
    expect(tc.list()).toHaveLength(0);
  });
});
