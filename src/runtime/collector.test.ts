import { describe, expect, it } from "vite-plus/test";
import { collect, type Ui } from "./collector.ts";

describe("collector", () => {
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
});
