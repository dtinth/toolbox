import { describe, expect, it } from "vite-plus/test";
import { buildUrlForTools, parseToolsFromSearch } from "./url-sync.ts";

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
});
