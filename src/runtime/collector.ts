export type Node =
  | { kind: "label"; text: string }
  | { kind: "button"; label: string; onClick?: () => void }
  | { kind: "row"; children: ChildNode[] }
  | { kind: "textInput"; value: string; placeholder?: string; onChange?: (v: string) => void };

export type ChildNode = Node | WindowNode;

export type WindowNode = { kind: "window"; title: string; children: ChildNode[] };

export interface Ui {
  window(title: string, cb: () => void): void;
  label(text: string): void;
  button(label: string, opts?: { onClick?: () => void }): void;
  row(cb: () => void): void;
  textInput(value: string, opts?: { placeholder?: string; onChange?: (v: string) => void }): void;
}

export function collect(declarator: (ui: Ui) => void): WindowNode[] {
  const root: { children: WindowNode[] } = { children: [] };
  const stack: { children: ChildNode[] }[] = [root];
  const ui: Ui = {
    window(title, cb) {
      const node: WindowNode = { kind: "window", title, children: [] };
      stack.push(node);
      cb();
      stack.pop();
      root.children.push(node);
    },
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
  };
  declarator(ui);
  return root.children;
}
