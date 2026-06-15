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
});
