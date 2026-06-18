import { describe, expect, it } from "vite-plus/test";
import {
  blobToFile,
  extensionForMime,
  filesFromClipboardItems,
  filesFromDataTransfer,
  synthName,
  textToFile,
} from "./file-intake.ts";

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

  it("prefers uri-list, then plain text, when no files", () => {
    const out = filesFromDataTransfer(
      {
        files: [],
        getData: (t) => (t === "text/uri-list" ? "https://x" : "plain"),
      },
      7,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("pasted-7.txt");
  });

  it("returns nothing for an empty transfer", () => {
    expect(filesFromDataTransfer({ files: [], getData: () => "" })).toEqual([]);
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
