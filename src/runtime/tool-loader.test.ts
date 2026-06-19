import { describe, expect, it, vi } from "vite-plus/test";
import { loadTool } from "./tool-loader.ts";
import type { Api } from "./runtime.ts";

describe("loadTool", () => {
  it("dynamically imports the tool module and calls its default export with the api", async () => {
    let receivedApi: Api | null = null;
    const fakeMod = {
      default: (api: Api) => {
        receivedApi = api;
      },
    };
    const importer = vi.fn().mockResolvedValue(fakeMod);
    const tool = await loadTool("hello", importer);
    const api: Api = {
      onRender: () => {},
      ui: {
        window: Object.assign(() => {}, { setTitle() {}, onClose() {} }),
        label() {},
        button() {},
        row() {},
        textInput() {},
        textarea() {},
        checkbox() {},
        copyableText() {},
        menu() {},
        menuItem() {},
        menuSeparator() {},
        file() {},
      },
      requestUpdate: () => {},
      tick: () => () => {},
      toast: { show: () => ({ update() {}, dismiss() {} }) },
      dialog: { pick: () => Promise.resolve(undefined) },
      withProgress: (_options, task) => task({ report() {} }),
      dispose: () => {},
    };
    tool(api);
    expect(importer).toHaveBeenCalledWith("/tools/hello/index.js");
    expect(receivedApi).toBe(api);
  });
});
