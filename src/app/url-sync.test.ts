import { describe, expect, it } from "vite-plus/test";
import { buildUrlForTools, parseToolsFromSearch, reconcileActions } from "./url-sync.ts";

describe("parseToolsFromSearch", () => {
  it("returns an empty array for empty search", () => {
    expect(parseToolsFromSearch("")).toEqual([]);
  });

  it("returns an empty array when ?tool is missing", () => {
    expect(parseToolsFromSearch("?other=value")).toEqual([]);
  });

  it("returns a single id from ?tool=counter", () => {
    expect(parseToolsFromSearch("?tool=counter")).toEqual(["counter"]);
  });

  it("splits comma-separated ids", () => {
    expect(parseToolsFromSearch("?tool=counter,echo")).toEqual(["counter", "echo"]);
  });

  it("trims whitespace around ids", () => {
    expect(parseToolsFromSearch("?tool=%20counter%20,%20echo%20")).toEqual(["counter", "echo"]);
  });

  it("filters out empty entries from leading/trailing/double commas", () => {
    expect(parseToolsFromSearch("?tool=,counter,,echo,")).toEqual(["counter", "echo"]);
  });

  it("decodes percent-encoded ids", () => {
    expect(parseToolsFromSearch("?tool=a%20b")).toEqual(["a b"]);
  });
});

describe("buildUrlForTools", () => {
  it("returns '/' (no query) when the list is empty", () => {
    expect(buildUrlForTools([])).toBe("/");
  });

  it("returns '/?tool=counter' for a single id", () => {
    expect(buildUrlForTools(["counter"])).toBe("/?tool=counter");
  });

  it("returns '/?tool=counter,echo' for two ids", () => {
    expect(buildUrlForTools(["counter", "echo"])).toBe("/?tool=counter,echo");
  });

  it("URL-encodes ids that contain special characters", () => {
    expect(buildUrlForTools(["a b"])).toBe("/?tool=a%20b");
  });
});

describe("reconcileActions", () => {
  it("is a no-op when both running and desired are empty", () => {
    expect(reconcileActions([], [])).toEqual({ toClose: [], toLaunch: [] });
  });

  it("closes running tools when desired is empty", () => {
    expect(reconcileActions([{ instanceId: "inst-1", manifestId: "counter" }], [])).toEqual({
      toClose: ["inst-1"],
      toLaunch: [],
    });
  });

  it("launches desired tools when none are running", () => {
    expect(reconcileActions([], ["counter"])).toEqual({ toClose: [], toLaunch: ["counter"] });
  });

  it("closes and launches the right tools when swapping a set", () => {
    const running = [
      { instanceId: "inst-1", manifestId: "counter" },
      { instanceId: "inst-2", manifestId: "echo" },
    ];
    expect(reconcileActions(running, ["echo", "alpha"])).toEqual({
      toClose: ["inst-1"],
      toLaunch: ["alpha"],
    });
  });
});
