import { describe, expect, it } from "vite-plus/test";
import { fuzzyFilter, searchTools } from "./fuzzy.ts";
import { type ManifestEntry } from "./manifest.ts";

describe("fuzzyFilter", () => {
  it("returns all items in the given order for an empty query", () => {
    const items = [{ t: "banana" }, { t: "apple" }];
    expect(fuzzyFilter("", items, (x) => x.t)).toStrictEqual(items);
  });

  it("keeps only subsequence matches", () => {
    const items = [{ t: "apple" }, { t: "banana" }, { t: "grape" }];
    const res = fuzzyFilter("ae", items, (x) => x.t).map((x) => x.t);
    expect(res).toContain("apple");
    expect(res).toContain("grape");
    expect(res).not.toContain("banana");
  });

  it("is case-insensitive", () => {
    const items = [{ t: "Apple" }];
    expect(fuzzyFilter("apple", items, (x) => x.t)).toHaveLength(1);
  });
});

const entries: ManifestEntry[] = [
  { id: "counter", name: "Counter" },
  { id: "alpha", name: "Alpha" },
  { id: "bravo", name: "Bravo" },
];

describe("searchTools", () => {
  it("returns entries sorted alphabetically by name when the query is empty", () => {
    expect(searchTools("", entries)).toStrictEqual([
      { id: "alpha", name: "Alpha" },
      { id: "bravo", name: "Bravo" },
      { id: "counter", name: "Counter" },
    ]);
  });

  it("returns entries sorted alphabetically by name when the query is whitespace", () => {
    expect(searchTools("   ", entries)).toStrictEqual([
      { id: "alpha", name: "Alpha" },
      { id: "bravo", name: "Bravo" },
      { id: "counter", name: "Counter" },
    ]);
  });

  it("returns matching entries for a non-empty query", () => {
    const result = searchTools("ctr", entries);
    expect(result).toStrictEqual([{ id: "counter", name: "Counter" }]);
  });

  it("matches against the id as well as the name", () => {
    const result = searchTools("hello", [
      { id: "hello-world", name: "Hello World" },
      { id: "other", name: "Other" },
    ]);
    expect(result).toStrictEqual([{ id: "hello-world", name: "Hello World" }]);
  });

  it("matches case-insensitively", () => {
    const result = searchTools("COUNTER", [
      { id: "counter", name: "Counter" },
      { id: "other", name: "Other" },
    ]);
    expect(result).toStrictEqual([{ id: "counter", name: "Counter" }]);
  });

  it("returns an empty array when no entry matches", () => {
    expect(searchTools("xyz", entries)).toStrictEqual([]);
  });

  it("orders multiple matches with the best score first", () => {
    const result = searchTools("col", [
      { id: "recol", name: "Recolic" },
      { id: "collection", name: "Collection" },
      { id: "color-picker", name: "Color Picker" },
    ]);
    expect(result.at(-1)!.id).toBe("recol");
    expect(
      result
        .slice(0, 2)
        .map((e) => e.id)
        .toSorted(),
    ).toStrictEqual(["collection", "color-picker"]);
  });
});
