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
      resolve: (files: File[]) => void;
    }
  | { kind: "spinner" };

export type ChildNode = Node | WindowNode;

export type WindowNode = {
  kind: "window";
  id: string;
  title: string;
  children: ChildNode[];
  onClose?: () => void;
};

export interface Ui {
  window: {
    (id: string, cb: () => void): void;
    (id: string, title: string, cb: () => void): void;
    setTitle(newTitle: string): void;
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
  file(
    file: File | null,
    opts: { onFile: (file: File) => void; accept?: string; label?: string },
  ): void;
}

export function collect(declarator: (ui: Ui) => void): WindowNode[] {
  const mainWindow: WindowNode = { kind: "window", id: "__main__", title: "", children: [] };
  const stack: { children: ChildNode[] }[] = [mainWindow];
  const subWindows: WindowNode[] = [];

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
      const node: WindowNode = { kind: "window", id, title, children: [] };
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
    file(file, opts) {
      stack[stack.length - 1]!.children.push({
        kind: "file",
        file,
        accept: opts.accept,
        label: opts.label,
        // Deliver one File to the tool. Ambiguity (more than one candidate) is
        // wired to api.dialog.pick in a later step; for now the first wins.
        resolve: (files: File[]) => {
          if (files.length > 0) opts.onFile(files[0]!);
        },
      });
    },
  };
  declarator(ui);
  return [mainWindow, ...subWindows];
}
