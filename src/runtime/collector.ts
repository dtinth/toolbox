export type Node =
  | { kind: "label"; text: string }
  | { kind: "button"; label: string; onClick?: () => void }
  | WindowNode;

export type WindowNode = { kind: "window"; title: string; children: Node[] };

export interface Ui {
  window(title: string, cb: () => void): void;
  label(text: string): void;
  button(label: string, opts?: { onClick?: () => void }): void;
}

export function collect(declarator: (ui: Ui) => void): WindowNode[] {
  const root: { children: WindowNode[] } = { children: [] };
  const stack: { children: Node[] }[] = [root];
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
  };
  declarator(ui);
  return root.children;
}
