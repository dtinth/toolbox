import { describe, expect, it } from "vite-plus/test";
import {
  blobToFile,
  chooseFile,
  extensionForMime,
  filesFromClipboardItems,
  filesFromDataTransfer,
  synthName,
  textToFile,
} from "./file-intake.ts";
import type { Dialog } from "./dialog-center.ts";

describe("extensionForMime", () => {
  it("maps known types", () => {
    expect(extensionForMime("image/png")).toBe("png");
    expect(extensionForMime("image/jpeg")).toBe("jpg");
    expect(extensionForMime("text/plain")).toBe("txt");
    expect(extensionForMime("image/svg+xml")).toBe("svg");
  });

  it("ignores parameters and case", () => {
    expect(extensionForMime("TEXT/PLAIN; charset=utf-8")).toBe("txt");
  });

  it("falls back to the subtype, stripping x-", () => {
    expect(extensionForMime("image/x-icon")).toBe("icon");
  });

  it("falls back to bin for unknown or structured-suffix types", () => {
    expect(extensionForMime("application/foo+bar")).toBe("bin");
    expect(extensionForMime("weird")).toBe("bin");
  });
});

describe("synthName", () => {
  it("builds pasted-<timestamp>.<ext>", () => {
    expect(synthName("image/png", 1718)).toBe("pasted-1718.png");
  });
});

describe("blobToFile", () => {
  it("returns a File unchanged", () => {
    const f = new File(["x"], "real.txt", { type: "text/plain" });
    expect(blobToFile(f)).toBe(f);
  });

  it("wraps a Blob with a synthesised name, type and lastModified", () => {
    const blob = new Blob(["hello"], { type: "image/png" });
    const file = blobToFile(blob, 1718);
    expect(file.name).toBe("pasted-1718.png");
    expect(file.type).toBe("image/png");
    expect(file.lastModified).toBe(1718);
    expect(file.size).toBe(5);
  });

  it("defaults the synthesised extension for a typeless blob", () => {
    const file = blobToFile(new Blob(["x"]), 9);
    expect(file.name).toBe("pasted-9.bin");
  });
});

describe("textToFile", () => {
  it("wraps text as a text/plain File", () => {
    const file = textToFile("https://example.com", 42);
    expect(file.name).toBe("pasted-42.txt");
    expect(file.type).toBe("text/plain");
  });
});

describe("filesFromDataTransfer", () => {
  it("returns real files when present", () => {
    const a = new File(["a"], "a.bin");
    const b = new File(["b"], "b.bin");
    const files = filesFromDataTransfer({ files: [a, b], getData: () => "" });
    expect(files).toEqual([a, b]);
  });

  it("falls back to uri-list when there's no html or plain text", () => {
    const out = filesFromDataTransfer(
      {
        files: [],
        getData: (t) => (t === "text/uri-list" ? "https://x" : ""),
      },
      7,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("pasted-7.txt");
  });

  it("offers both html and plain text as candidates when they differ (e.g. pasted from a web page)", () => {
    const out = filesFromDataTransfer(
      {
        files: [],
        getData: (t) => {
          if (t === "text/html") return "<b>hello</b>";
          if (t === "text/plain") return "hello";
          return "";
        },
      },
      7,
    );
    expect(out.map((f) => f.type)).toEqual(["text/html", "text/plain"]);
    expect(out.map((f) => f.name)).toEqual(["pasted-7.html", "pasted-7.txt"]);
  });

  it("returns a single plain text candidate when html and plain text are identical", () => {
    const out = filesFromDataTransfer(
      {
        files: [],
        getData: (t) => (t === "text/html" || t === "text/plain" ? "same" : ""),
      },
      7,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("text/plain");
  });

  it("returns nothing for an empty transfer", () => {
    expect(filesFromDataTransfer({ files: [], getData: () => "" })).toEqual([]);
  });
});

describe("chooseFile", () => {
  it("returns the only candidate without invoking pick", async () => {
    const f = new File(["a"], "a.txt");
    let called = false;
    const pick = (<T>(items: T[]) => {
      called = true;
      return Promise.resolve(items[0]);
    }) as Dialog["pick"];
    expect(await chooseFile([f], pick)).toBe(f);
    expect(called).toBe(false);
  });

  it("returns undefined when there are no candidates", async () => {
    expect(await chooseFile([])).toBeUndefined();
  });

  it("routes multiple candidates through pick and returns the chosen file", async () => {
    const a = new File(["a"], "a.txt");
    const b = new File(["b"], "b.txt");
    let seen: Array<{ label: string }> = [];
    const pick = (<T>(items: T[]) => {
      seen = items as Array<{ label: string }>;
      return Promise.resolve(items[1]);
    }) as Dialog["pick"];
    const chosen = await chooseFile([a, b], pick);
    expect(seen).toHaveLength(2);
    expect(seen[0]!.label).toBe("a.txt");
    expect(chosen).toBe(b);
  });

  it("falls back to the first candidate when multiple but no pick is available", async () => {
    const a = new File(["a"], "a.txt");
    const b = new File(["b"], "b.txt");
    expect(await chooseFile([a, b])).toBe(a);
  });
});

describe("filesFromClipboardItems", () => {
  it("yields one candidate per representation, in order", async () => {
    const item = {
      types: ["text/html", "text/plain"],
      getType: (t: string) =>
        Promise.resolve(new Blob([t === "text/html" ? "<b>x</b>" : "x"], { type: t })),
    };
    const out = await filesFromClipboardItems([item], 5);
    expect(out.map((f) => f.type)).toEqual(["text/html", "text/plain"]);
    expect(out[0]!.name).toBe("pasted-5.html");
    expect(out[1]!.name).toBe("pasted-5.txt");
  });
});
