import { useEffect, useRef, useState } from "preact/hooks";
import {
  type LayoutNode,
  leaf,
  pathOfTab,
  putTab,
  removeTab,
  split,
  splitPane,
} from "../runtime/layout-tree.ts";
import { LayoutView } from "../runtime/layout-view.tsx";

/**
 * A page for trying the Layout tree by hand, at `/?lab=layout`.
 *
 * The tree has no home on the desktop until drag-to-dock lands, and a divider
 * is something you have to feel before you can say what is wrong with it —
 * above all with a finger. So the engine gets a page of its own first.
 *
 * The panes hold nothing but their own name and size. This is on purpose: the
 * lab is about the geometry, and a real tool inside a pane would only make it
 * harder to see what the dividers do.
 */

const START: LayoutNode = split(
  "row",
  [leaf(["one"]), split("column", [leaf(["two"]), leaf(["three", "four"])])],
  [0.4, 0.6],
);

const NAMES: Record<string, string> = {
  one: "One",
  two: "Two",
  three: "Three",
  four: "Four",
};

let nextTab = 5;
function freshTab(): string {
  const id = `tab-${nextTab}`;
  NAMES[id] = `Tab ${nextTab}`;
  nextTab += 1;
  return id;
}

/** Watch the size of one element, so a pane can show what it is worth. */
function useBoxSize(ref: { current: HTMLDivElement | null }): { w: number; h: number } {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (el === null) {
      return undefined;
    }
    const observer = new ResizeObserver(() => {
      const box = el.getBoundingClientRect();
      setSize({ w: Math.round(box.width), h: Math.round(box.height) });
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [ref]);
  return size;
}

function PaneBody({
  tab,
  onSplit,
  onAddTab,
}: {
  tab: string;
  onSplit: (direction: "row" | "column") => void;
  onAddTab: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const size = useBoxSize(ref);
  const button =
    "h-11 rounded border border-toolbox-border px-3 text-sm hover:border-toolbox-border-light";
  return (
    <div ref={ref} class="flex h-full flex-col gap-3">
      <div class="text-toolbox-accent">{NAMES[tab] ?? tab}</div>
      <div class="font-mono text-sm text-toolbox-muted">
        {size.w} x {size.h}
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class={button}
          onClick={() => {
            onSplit("row");
          }}
        >
          Split right
        </button>
        <button
          type="button"
          class={button}
          onClick={() => {
            onSplit("column");
          }}
        >
          Split down
        </button>
        <button type="button" class={button} onClick={onAddTab}>
          Add a tab
        </button>
      </div>
    </div>
  );
}

export function LayoutLab() {
  const [root, setRoot] = useState<LayoutNode | null>(START);

  const addBeside = (tab: string, direction: "row" | "column") => {
    setRoot((current) => {
      if (current === null) {
        return current;
      }
      const path = pathOfTab(current, tab);
      return path === null
        ? current
        : splitPane(current, path, direction, leaf([freshTab()]), "after");
    });
  };

  const addTab = (tab: string) => {
    setRoot((current) => (current === null ? current : putTab(current, tab, freshTab())));
  };

  return (
    <div class="fixed inset-0 flex flex-col bg-toolbox-deepest text-toolbox-text">
      <header class="flex shrink-0 flex-wrap items-center gap-3 border-b border-toolbox-border px-3 py-2">
        <div class="font-bold">Layout lab</div>
        <div class="hidden text-sm text-toolbox-muted sm:block">
          Drag a divider with a finger or the mouse. Or give it focus with the Tab key, then use the
          arrow keys, Home and End.
        </div>
        <button
          type="button"
          class="ml-auto h-11 rounded border border-toolbox-border px-3 text-sm"
          onClick={() => {
            setRoot(START);
          }}
        >
          Start again
        </button>
      </header>
      <main class="relative min-h-0 flex-1">
        <LayoutView
          root={root}
          labelOf={(tab) => NAMES[tab] ?? tab}
          renderTab={(tab) => (
            <PaneBody
              tab={tab}
              onSplit={(direction) => {
                addBeside(tab, direction);
              }}
              onAddTab={() => {
                addTab(tab);
              }}
            />
          )}
          onChange={setRoot}
          onCloseTab={(tab) => {
            setRoot((current) => (current === null ? null : removeTab(current, tab)));
          }}
          empty={<div class="text-sm">Every pane is closed. Press Start again.</div>}
        />
      </main>
    </div>
  );
}
