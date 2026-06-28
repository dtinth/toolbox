import { chooseFile } from "./file-intake.ts";
import type { Dialog } from "./dialog-center.ts";
import type { VNode } from "../../api.d.ts";

export type Node =
  | { kind: "label"; text: string }
  | { kind: "button"; label: string; onClick?: () => void }
  | { kind: "row"; children: ChildNode[] }
  | { kind: "textInput"; value: string; placeholder?: string; onChange?: (v: string) => void }
  | {
      kind: "textarea";
      value: string;
      placeholder?: string;
      onChange?: (v: string) => void;
      rows?: number;
    }
  | {
      kind: "file";
      file: File | null;
      accept?: string;
      label?: string;
      readOnly?: boolean;
      resolve: (files: File[]) => void;
    }
  | { kind: "spinner" }
  | {
      kind: "checkbox";
      label: string;
      checked: boolean;
      disabled?: boolean;
      onChange?: (checked: boolean) => void;
    }
  | {
      kind: "segmented";
      value: string;
      options: { value: string; label: string }[];
      onChange?: (value: string) => void;
    }
  | { kind: "copyableText"; text: string }
  | { kind: "custom"; render: () => VNode }
  // A collector-only marker: never rendered itself, it resets the identity
  // cursor for the nodes that follow (group defaults to the next ordinal).
  | { kind: "identityGroup"; group?: string };

export type ChildNode = Node | WindowNode;

export type MenuItemNode =
  | { kind: "menuItem"; label: string; onClick?: () => void }
  | { kind: "menuSeparator" };

export type MenuNode = { kind: "menu"; label: string; items: MenuItemNode[] };

export type WindowNode = {
  kind: "window";
  id: string;
  title: string;
  children: ChildNode[];
  menus: MenuNode[];
  width?: number;
  onClose?: () => void;
};

export interface Ui {
  window: {
    (id: string, cb: () => void): void;
    (id: string, title: string, cb: () => void): void;
    setTitle(newTitle: string): void;
    setWidth(width: number): void;
    onClose(handler: () => void): void;
  };
  label(text: string): void;
  button(label: string, opts?: { onClick?: () => void }): void;
  row(cb: () => void): void;
  textInput(value: string, opts?: { placeholder?: string; onChange?: (v: string) => void }): void;
  textarea(
    value: string,
    opts?: { placeholder?: string; onChange?: (v: string) => void; rows?: number },
  ): void;
  checkbox(
    label: string,
    opts: { checked: boolean; disabled?: boolean; onChange?: (checked: boolean) => void },
  ): void;
  segmented(
    value: string,
    opts: {
      options: { value: string; label: string }[];
      onChange?: (value: string) => void;
    },
  ): void;
  copyableText(text: string): void;
  menu(label: string, cb: () => void): void;
  menuItem(label: string, opts?: { onClick?: () => void }): void;
  menuSeparator(): void;
  custom(render: () => VNode): void;
  identityGroup(key?: string): void;
  file(
    file: File | null,
    opts: {
      onFile?: (file: File) => void;
      accept?: string;
      label?: string;
      readOnly?: boolean;
    },
  ): void;
}

export interface CollectDeps {
  /** Bound `api.dialog.pick` for the instance, used to disambiguate candidates. */
  pick?: Dialog["pick"];
}

type Frame = { children: ChildNode[] };

interface CollectState {
  mainWindow: WindowNode;
  stack: Frame[];
  subWindows: WindowNode[];
  currentMenu: MenuItemNode[] | null;
  pick?: Dialog["pick"];
}

// The collection is synchronous and non-reentrant, so a single module-level
// context is enough: `collect` installs it for the duration of the declarator,
// and the stable `ui` below reads it. Outside a collection it is null, which is
// how `ui.*` calls made after `onRender` returns (or inside a Custom widget's
// Preact render) are caught.
let active: CollectState | null = null;

function need(): CollectState {
  if (!active) throw new Error("ui.* called outside onRender");
  return active;
}

function top(state: CollectState): Frame {
  return state.stack[state.stack.length - 1]!;
}

function currentWindow(state: CollectState): WindowNode {
  for (let i = state.stack.length - 1; i >= 0; i--) {
    const frame = state.stack[i]!;
    if ("kind" in frame) return frame as WindowNode;
  }
  return state.mainWindow;
}

/**
 * The single, stable `ui` object every tool instance receives as `api.ui`. Its
 * methods dispatch on the current collection context; calling one outside a
 * collection window throws.
 */
export const ui: Ui = {
  window: Object.assign(
    (id: string, titleOrCb: string | (() => void), cb?: () => void) => {
      const state = need();
      let title: string;
      let callback: () => void;
      if (typeof titleOrCb === "function") {
        title = id;
        callback = titleOrCb;
      } else {
        title = titleOrCb;
        callback = cb!;
      }
      const node: WindowNode = { kind: "window", id, title, children: [], menus: [] };
      state.stack.push(node);
      callback();
      state.stack.pop();
      state.subWindows.push(node);
    },
    {
      setTitle(newTitle: string) {
        currentWindow(need()).title = newTitle;
      },
      setWidth(width: number) {
        currentWindow(need()).width = width;
      },
      onClose(handler: () => void) {
        currentWindow(need()).onClose = handler;
      },
    },
  ),
  label(text) {
    top(need()).children.push({ kind: "label", text });
  },
  button(label, opts) {
    top(need()).children.push({ kind: "button", label, onClick: opts?.onClick });
  },
  row(cb) {
    const state = need();
    const node: Node = { kind: "row", children: [] };
    state.stack.push(node as Frame);
    cb();
    state.stack.pop();
    top(state).children.push(node);
  },
  textInput(value, opts) {
    top(need()).children.push({
      kind: "textInput",
      value,
      placeholder: opts?.placeholder,
      onChange: opts?.onChange,
    });
  },
  textarea(value, opts) {
    top(need()).children.push({
      kind: "textarea",
      value,
      placeholder: opts?.placeholder,
      onChange: opts?.onChange,
      rows: opts?.rows,
    });
  },
  checkbox(label, opts) {
    top(need()).children.push({
      kind: "checkbox",
      label,
      checked: opts.checked,
      disabled: opts.disabled,
      onChange: opts.onChange,
    });
  },
  segmented(value, opts) {
    top(need()).children.push({
      kind: "segmented",
      value,
      options: opts.options,
      onChange: opts.onChange,
    });
  },
  copyableText(text) {
    top(need()).children.push({ kind: "copyableText", text });
  },
  menu(label, cb) {
    const state = need();
    const menuNode: MenuNode = { kind: "menu", label, items: [] };
    currentWindow(state).menus.push(menuNode);
    const prevMenu = state.currentMenu;
    state.currentMenu = menuNode.items;
    cb();
    state.currentMenu = prevMenu;
  },
  menuItem(label, opts) {
    const state = need();
    if (state.currentMenu) {
      state.currentMenu.push({ kind: "menuItem", label, onClick: opts?.onClick });
    }
  },
  menuSeparator() {
    const state = need();
    if (state.currentMenu) {
      state.currentMenu.push({ kind: "menuSeparator" });
    }
  },
  custom(render) {
    top(need()).children.push({ kind: "custom", render });
  },
  identityGroup(key) {
    top(need()).children.push({ kind: "identityGroup", group: key });
  },
  file(file, opts) {
    const state = need();
    const onFile = opts.onFile;
    const pick = state.pick;
    top(state).children.push({
      kind: "file",
      file,
      accept: opts.accept,
      label: opts.label,
      readOnly: opts.readOnly,
      // Deliver one File to the tool. A single candidate is delivered
      // synchronously; more than one is disambiguated via the quick pick.
      // (No-op when readOnly / no onFile — the renderer also disables intake.)
      resolve: (files: File[]) => {
        if (!onFile || files.length === 0) return;
        if (files.length === 1) {
          onFile(files[0]!);
          return;
        }
        void chooseFile(files, pick).then((chosen) => {
          if (chosen) onFile(chosen);
        });
      },
    });
  },
};

export function collect(declarator: (ui: Ui) => unknown, deps: CollectDeps = {}): WindowNode[] {
  if (active) throw new Error("collect is not re-entrant");
  const mainWindow: WindowNode = {
    kind: "window",
    id: "__main__",
    title: "",
    children: [],
    menus: [],
  };
  const state: CollectState = {
    mainWindow,
    stack: [mainWindow],
    subWindows: [],
    currentMenu: null,
    pick: deps.pick,
  };
  active = state;
  try {
    const result = declarator(ui);
    if (result != null && typeof (result as { then?: unknown }).then === "function") {
      throw new Error("onRender must be synchronous");
    }
  } finally {
    active = null;
  }
  return [mainWindow, ...state.subWindows];
}
