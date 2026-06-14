import { describe, expect, it } from "vite-plus/test";
import { createRuntime } from "./runtime.ts";
import type { Ui } from "./collector.ts";

describe("runtime", () => {
  it("passes an api object with onRender, ui, and requestUpdate", () => {
    const runtime = createRuntime();
    let capturedApi: unknown = null;
    runtime.loadTool((api) => {
      capturedApi = api;
      api.onRender = () => {};
    });
    const api = capturedApi as {
      onRender?: () => void;
      ui: Ui;
      requestUpdate: () => void;
    };
    expect(api.ui).toBeTypeOf("object");
    expect(api.requestUpdate).toBeTypeOf("function");
  });

  it("captures a button click handler and runs requestUpdate on click", () => {
    const runtime = createRuntime();
    runtime.loadTool((api) => {
      let count = 0;
      api.onRender = () => {
        api.ui.window("Counter", () => {
          api.ui.label(`count=${count}`);
          api.ui.button("+", {
            onClick: () => {
              count++;
              api.requestUpdate();
            },
          });
        });
      };
    });
    runtime.render();
    expect(runtime.updateCount).toBe(0);
    const button = runtime.lastButton();
    button.onClick!();
    expect(runtime.updateCount).toBe(1);
  });

  it("renders a declarator that declares a window with a label", () => {
    const runtime = createRuntime();
    runtime.loadTool((api) => {
      api.onRender = () => {
        api.ui.window("Hello", () => {
          api.ui.label("Hi there");
        });
      };
    });
    const vnode = runtime.render();
    expect(vnode).toBeTruthy();
  });

  it("does not throw when requestUpdate is called before any tool is loaded", () => {
    const runtime = createRuntime();
    expect(() => runtime.requestUpdate()).not.toThrow();
  });
});
