import { describe, expect, it, vi } from "vite-plus/test";
import { collect, ui, type Ui } from "./collector.ts";

describe("collector", () => {
  it("throws when a ui.* call happens outside a collection window", () => {
    expect(() => ui.label("nope")).toThrow(/outside onRender/);
  });

  it("rejects an onRender that returns a Promise", () => {
    expect(() => collect(() => Promise.resolve())).toThrow(/synchronous/);
  });

  it("clears the collection context after collect returns", () => {
    collect((u) => u.label("ok"));
    expect(() => ui.label("nope")).toThrow(/outside onRender/);
  });

  it("returns main window even when declarator does nothing", () => {
    const result = collect((_ui: Ui) => {});
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe("window");
    expect(result[0]!.id).toBe("__main__");
  });

  it("collects top-level label into main window's children", () => {
    const result = collect((ui) => {
      ui.label("Hi");
    });
    expect(result[0]!.children).toEqual([{ kind: "label", text: "Hi" }]);
  });

  it("sets main window title via ui.window.setTitle", () => {
    const result = collect((ui) => {
      ui.window.setTitle("My App");
    });
    expect(result[0]!.title).toBe("My App");
  });

  it("sets main window width via ui.window.setWidth", () => {
    const result = collect((ui) => {
      ui.window.setWidth(420);
    });
    expect(result[0]!.width).toBe(420);
  });

  it("leaves window width undefined when setWidth is not called", () => {
    const result = collect(() => {});
    expect(result[0]!.width).toBeUndefined();
  });

  it("sets a sub-window's width via setWidth inside its callback", () => {
    const result = collect((ui) => {
      ui.window("sub", () => {
        ui.window.setWidth(300);
      });
    });
    expect(result[1]!.width).toBe(300);
    expect(result[0]!.width).toBeUndefined();
  });

  it("creates a sub-window with id as default title", () => {
    const result = collect((ui) => {
      ui.window("sub", () => {
        ui.label("inside");
      });
    });
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe("__main__");
    expect(result[1]!.id).toBe("sub");
    expect(result[1]!.title).toBe("sub");
    expect(result[1]!.children).toEqual([{ kind: "label", text: "inside" }]);
  });

  it("creates a sub-window with explicit title", () => {
    const result = collect((ui) => {
      ui.window("sub", "Sub Window", () => {
        ui.label("inside");
      });
    });
    expect(result[1]!.id).toBe("sub");
    expect(result[1]!.title).toBe("Sub Window");
    expect(result[1]!.children).toEqual([{ kind: "label", text: "inside" }]);
  });

  it("sets sub-window title via ui.window.setTitle inside callback", () => {
    const result = collect((ui) => {
      ui.window("sub", () => {
        ui.window.setTitle("Renamed");
      });
    });
    expect(result[1]!.title).toBe("Renamed");
  });

  it("stores onClose handler on main window", () => {
    const handler = () => {};
    const result = collect((ui) => {
      ui.window.onClose(handler);
    });
    expect(result[0]!.onClose).toBe(handler);
  });

  it("stores onClose handler on sub-window", () => {
    const handler = () => {};
    const result = collect((ui) => {
      ui.window("sub", () => {
        ui.window.onClose(handler);
      });
    });
    expect(result[1]!.onClose).toBe(handler);
  });

  it("collects multiple sub-windows in declaration order after main window", () => {
    const result = collect((ui) => {
      ui.window("a", () => {});
      ui.window("b", () => {});
    });
    expect(result).toHaveLength(3);
    expect(result[0]!.id).toBe("__main__");
    expect(result[1]!.id).toBe("a");
    expect(result[2]!.id).toBe("b");
  });

  it("main window has empty children when only sub-windows exist", () => {
    const result = collect((ui) => {
      ui.window("sub", () => {});
    });
    expect(result[0]!.children).toEqual([]);
  });

  it("collects a file node carrying file, accept, label and a resolve that delivers one file", () => {
    const delivered: File[] = [];
    const current = new File(["hi"], "current.txt", { type: "text/plain" });
    const result = collect((ui) => {
      ui.file(current, { onFile: (f) => delivered.push(f), accept: "image/*", label: "Pick" });
    });
    const node = result[0]!.children[0]!;
    expect(node.kind).toBe("file");
    if (node.kind !== "file") throw new Error("expected file node");
    expect(node.file).toBe(current);
    expect(node.accept).toBe("image/*");
    expect(node.label).toBe("Pick");

    const a = new File(["a"], "a.bin");
    node.resolve([a]);
    expect(delivered).toEqual([a]);
  });

  it("collects a read-only file node whose resolve is a no-op (no onFile)", () => {
    const out = new File(["x"], "out.png", { type: "image/png" });
    const result = collect((ui) => {
      ui.file(out, { readOnly: true, label: "Result" });
    });
    const node = result[0]!.children[0]!;
    if (node.kind !== "file") throw new Error("expected file node");
    expect(node.readOnly).toBe(true);
    expect(node.file).toBe(out);
    // No onFile provided — resolve must not throw.
    expect(() => node.resolve([new File(["y"], "y.bin")])).not.toThrow();
  });

  it("collects a checkbox node with label and checked state", () => {
    const result = collect((ui) => {
      ui.checkbox("Enable feature", { checked: true });
    });
    const node = result[0]!.children[0]!;
    expect(node.kind).toBe("checkbox");
    if (node.kind !== "checkbox") throw new Error("expected checkbox node");
    expect(node.label).toBe("Enable feature");
    expect(node.checked).toBe(true);
  });

  it("collects a checkbox node whose onChange forwards the value", () => {
    const received: boolean[] = [];
    const result = collect((ui) => {
      ui.checkbox("Toggle me", { checked: false, onChange: (v) => received.push(v) });
    });
    const node = result[0]!.children[0]!;
    if (node.kind !== "checkbox") throw new Error("expected checkbox node");
    node.onChange?.(true);
    expect(received).toEqual([true]);
  });

  it("collects a copyableText node carrying the text through", () => {
    const result = collect((ui) => {
      ui.copyableText("https://example.com/result");
    });
    const node = result[0]!.children[0]!;
    expect(node.kind).toBe("copyableText");
    if (node.kind !== "copyableText") throw new Error("expected copyableText node");
    expect(node.text).toBe("https://example.com/result");
  });

  it("collects a menu with items on the main window's menus array", () => {
    const onClick = vi.fn();
    const result = collect((ui) => {
      ui.menu("File", () => {
        ui.menuItem("New", { onClick });
        ui.menuSeparator();
        ui.menuItem("Quit");
      });
    });
    const mainWindow = result[0]!;
    expect(mainWindow.menus).toHaveLength(1);
    const menu = mainWindow.menus[0]!;
    expect(menu.kind).toBe("menu");
    expect(menu.label).toBe("File");
    expect(menu.items).toHaveLength(3);

    const item0 = menu.items[0]!;
    expect(item0.kind).toBe("menuItem");
    if (item0.kind !== "menuItem") throw new Error("expected menuItem");
    expect(item0.label).toBe("New");
    item0.onClick?.();
    expect(onClick).toHaveBeenCalledTimes(1);

    expect(menu.items[1]!.kind).toBe("menuSeparator");

    const item2 = menu.items[2]!;
    expect(item2.kind).toBe("menuItem");
    if (item2.kind !== "menuItem") throw new Error("expected menuItem");
    expect(item2.label).toBe("Quit");
  });

  it("collects two menus independently on the same window", () => {
    const result = collect((ui) => {
      ui.menu("File", () => {
        ui.menuItem("Open");
      });
      ui.menu("Edit", () => {
        ui.menuItem("Cut");
        ui.menuItem("Paste");
      });
    });
    const mainWindow = result[0]!;
    expect(mainWindow.menus).toHaveLength(2);
    expect(mainWindow.menus[0]!.label).toBe("File");
    expect(mainWindow.menus[0]!.items).toHaveLength(1);
    expect(mainWindow.menus[1]!.label).toBe("Edit");
    expect(mainWindow.menus[1]!.items).toHaveLength(2);
  });
});
