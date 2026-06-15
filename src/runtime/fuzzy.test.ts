import { describe, expect, it } from "vite-plus/test";
import { searchTools } from "./fuzzy.ts";
import type { ManifestEntry } from "./manifest.ts";

const entries: ManifestEntry[] = [
  { id: "counter", name: "Counter" },
  { id: "alpha", name: "Alpha" },
  { id: "bravo", name: "Bravo" },
];

describe("searchTools", () => {
  it("returns entries sorted alphabetically by name when the query is empty", () => {
    expect(searchTools("", entries)).toEqual([
      { id: "alpha", name: "Alpha" },
      { id: "bravo", name: "Bravo" },
      { id: "counter", name: "Counter" },
    ]);
  });

  it("returns entries sorted alphabetically by name when the query is whitespace", () => {
    expect(searchTools("   ", entries)).toEqual([
      { id: "alpha", name: "Alpha" },
      { id: "bravo", name: "Bravo" },
      { id: "counter", name: "Counter" },
    ]);
  });

  it("returns matching entries for a non-empty query", () => {
    const result = searchTools("ctr", entries);
    expect(result).toEqual([{ id: "counter", name: "Counter" }]);
  });

  it("matches against the id as well as the name", () => {
    const result = searchTools("hello", [
      { id: "hello-world", name: "Hello World" },
      { id: "other", name: "Other" },
    ]);
    expect(result).toEqual([{ id: "hello-world", name: "Hello World" }]);
  });

  it("matches case-insensitively", () => {
    const result = searchTools("COUNTER", [
      { id: "counter", name: "Counter" },
      { id: "other", name: "Other" },
    ]);
    expect(result).toEqual([{ id: "counter", name: "Counter" }]);
  });

  it("returns an empty array when no entry matches", () => {
    expect(searchTools("xyz", entries)).toEqual([]);
  });

  it("orders multiple matches with the best score first", () => {
    const result = searchTools("col", [
      { id: "recol", name: "Recolic" },
      { id: "collection", name: "Collection" },
      { id: "color-picker", name: "Color Picker" },
    ]);
    expect(result[result.length - 1]!.id).toBe("recol");
    expect(
      result
        .slice(0, 2)
        .map((e) => e.id)
        .sort(),
    ).toEqual(["collection", "color-picker"]);
  });
});
