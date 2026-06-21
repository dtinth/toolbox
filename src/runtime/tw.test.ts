import { describe, expect, it } from "vite-plus/test";
import { generateToolCss, toToolClasses } from "./tw.ts";

describe("toToolClasses", () => {
  it("prefixes each utility with tw-", () => {
    expect(toToolClasses(["w-40 rounded-full"])).toBe("tw-w-40 tw-rounded-full");
  });

  it("prefixes after the final variant colon", () => {
    expect(toToolClasses(["hover:bg-toolbox-accent"])).toBe("hover:tw-bg-toolbox-accent");
  });

  it("collapses whitespace/newlines and ignores empties", () => {
    expect(toToolClasses(["  flex \n  gap-2  "])).toBe("tw-flex tw-gap-2");
  });

  it("interpolates template expressions", () => {
    expect(toToolClasses(["bg-", "-500"], ["red"])).toBe("tw-bg-red-500");
  });
});

describe("generateToolCss", () => {
  it("emits prefixed selectors", async () => {
    const css = await generateToolCss(["tw-rounded-full"]);
    expect(css).toContain(".tw-rounded-full");
  });

  it("resolves toolbox theme colors to the shared CSS variables", async () => {
    const css = await generateToolCss(["tw-bg-toolbox-accent"]);
    expect(css).toContain("var(--color-toolbox-accent)");
  });

  it("supports variants", async () => {
    const css = await generateToolCss(["hover:tw-bg-toolbox-accent"]);
    expect(css).toContain(":hover");
  });
});
