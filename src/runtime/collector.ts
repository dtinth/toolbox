import { chooseFile } from "./file-intake.ts";
import type { Dialog } from "./dialog-center.ts";

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
  | { kind: "checkbox"; label: string; checked: boolean; onChange?: (checked: boolean) => void }
  | { kind: "copyableText"; text: string };

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
  checkbox(label: string, opts: { checked: boolean; onChange?: (checked: boolean) => void }): void;
  copyableText(text: string): void;
  menu(label: string, cb: () => void): void;
  menuItem(label: string, opts?: { onClick?: () => void }): void;
  menuSeparator(): void;
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

export function collect(declarator: (ui: Ui) => void, deps: CollectDeps = {}): WindowNode[] {
  const mainWindow: WindowNode = {
    kind: "window",
    id: "__main__",
    title: "",
    children: [],
    menus: [],
  };
  const stack: { children: ChildNode[] }[] = [mainWindow];
  const subWindows: WindowNode[] = [];
  let currentMenu: MenuItemNode[] | null = null;

  const windowFn = Object.assign(
    (id: string, titleOrCb: string | (() => void), cb?: () => void) => {
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
      stack.push(node);
      callback();
      stack.pop();
      subWindows.push(node);
    },
    {
      setTitle(newTitle: string) {
        const current = stack[stack.length - 1];
        if ("kind" in current) {
          (current as WindowNode).title = newTitle;
        }
      },
      setWidth(width: number) {
        const current = stack[stack.length - 1];
        if ("kind" in current) {
          (current as WindowNode).width = width;
        }
      },
      onClose(handler: () => void) {
        const current = stack[stack.length - 1];
        if ("kind" in current) {
          (current as WindowNode).onClose = handler;
        }
      },
    },
  );

  const ui: Ui = {
    window: windowFn,
    label(text) {
      stack[stack.length - 1]!.children.push({ kind: "label", text });
    },
    button(label, opts) {
      stack[stack.length - 1]!.children.push({
        kind: "button",
        label,
        onClick: opts?.onClick,
      });
    },
    row(cb) {
      const node: Node = { kind: "row", children: [] };
      stack.push(node as { children: ChildNode[] });
      cb();
      stack.pop();
      stack[stack.length - 1]!.children.push(node);
    },
    textInput(value, opts) {
      stack[stack.length - 1]!.children.push({
        kind: "textInput",
        value,
        placeholder: opts?.placeholder,
        onChange: opts?.onChange,
      });
    },
    textarea(value, opts) {
      stack[stack.length - 1]!.children.push({
        kind: "textarea",
        value,
        placeholder: opts?.placeholder,
        onChange: opts?.onChange,
        rows: opts?.rows,
      });
    },
    checkbox(label, opts) {
      stack[stack.length - 1]!.children.push({
        kind: "checkbox",
        label,
        checked: opts.checked,
        onChange: opts.onChange,
      });
    },
    copyableText(text) {
      stack[stack.length - 1]!.children.push({ kind: "copyableText", text });
    },
    menu(label, cb) {
      // Find the nearest window frame on the stack, defaulting to mainWindow.
      let targetWindow: WindowNode = mainWindow;
      for (let i = stack.length - 1; i >= 0; i--) {
        const frame = stack[i]!;
        if ("menus" in frame) {
          targetWindow = frame as WindowNode;
          break;
        }
      }
      const menuNode: MenuNode = { kind: "menu", label, items: [] };
      targetWindow.menus.push(menuNode);
      const prevMenu = currentMenu;
      currentMenu = menuNode.items;
      cb();
      currentMenu = prevMenu;
    },
    menuItem(label, opts) {
      if (currentMenu) {
        currentMenu.push({ kind: "menuItem", label, onClick: opts?.onClick });
      }
    },
    menuSeparator() {
      if (currentMenu) {
        currentMenu.push({ kind: "menuSeparator" });
      }
    },
    file(file, opts) {
      const onFile = opts.onFile;
      stack[stack.length - 1]!.children.push({
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
          void chooseFile(files, deps.pick).then((file) => {
            if (file) onFile(file);
          });
        },
      });
    },
  };
  declarator(ui);
  return [mainWindow, ...subWindows];
}
