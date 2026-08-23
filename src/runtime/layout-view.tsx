import { type ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  dragDivider,
  keyDelta,
  type LayoutNode,
  type LayoutPath,
  type LayoutSplit,
  measure,
  minSize,
  replaceAt,
  type SplitDirection,
} from "./layout-tree.ts";

/**
 * How wide the grab area of a divider is, in pixels. The line the user sees is
 * one pixel; this area is invisible and sits on top of the boundary.
 *
 * A one-pixel line is impossible to hit with a finger, and hard with a mouse.
 * The area costs no space, because a divider floats above the panes instead of
 * standing between them.
 */
const DIVIDER_HIT = 20;

/** How far one press of an arrow key moves a divider, in pixels. */
const KEY_STEP = 16;

export interface LayoutViewProps {
  /** The tree to draw, or null when nothing is docked. */
  root: LayoutNode | null;
  /** Draw the content of one tab. */
  renderTab: (tabId: string) => ComponentChildren;
  /** The name to put on a tab. */
  labelOf: (tabId: string) => string;
  /** Called with the new tree after a drag, a tab change, or a close. */
  onChange: (next: LayoutNode | null) => void;
  /** Called when the user closes a tab. Omit it to hide the close button. */
  onCloseTab?: (tabId: string) => void;
  /** What to draw when the tree is empty. */
  empty?: ComponentChildren;
}

interface ViewContext {
  renderTab: (tabId: string) => ComponentChildren;
  labelOf: (tabId: string) => string;
  onCloseTab?: (tabId: string) => void;
  /** Put a changed node back into the tree at its path. */
  update: (path: LayoutPath, next: LayoutNode) => void;
}

/**
 * Draw a Layout tree.
 *
 * Every node fills the box its parent gives it, and a split places its children
 * by percentage. The percentages come from `measure`, so what the screen shows
 * and what the tests cover are the same arithmetic.
 */
export function LayoutView({
  root,
  renderTab,
  labelOf,
  onChange,
  onCloseTab,
  empty,
}: LayoutViewProps) {
  if (root === null) {
    return (
      <div class="absolute inset-0 flex items-center justify-center text-toolbox-muted">
        {empty}
      </div>
    );
  }
  const ctx: ViewContext = {
    renderTab,
    labelOf,
    onCloseTab,
    update: (path, next) => {
      onChange(replaceAt(root, path, next));
    },
  };
  return <NodeView node={root} path={[]} ctx={ctx} />;
}

/**
 * The identity of a subtree: the first tab it holds.
 *
 * A tab appears in the tree at most once, so this is unique. Position would do
 * as well until a drag moves a pane, and then Preact would throw away the state
 * of every pane that shifted along.
 */
function keyOf(node: LayoutNode): string {
  return node.type === "leaf" ? node.tabs[0] : keyOf(node.children[0]);
}

function NodeView({ node, path, ctx }: { node: LayoutNode; path: LayoutPath; ctx: ViewContext }) {
  return node.type === "leaf" ? (
    <PaneView node={node} path={path} ctx={ctx} />
  ) : (
    <SplitView node={node} path={path} ctx={ctx} />
  );
}

/**
 * Measure the box this element occupies along one axis.
 *
 * A split needs pixels to honour a minimum and to turn a drag of the pointer
 * into a change of ratio. Nothing else in the tree needs them.
 */
function useAxisLength(ref: { current: HTMLDivElement | null }, direction: SplitDirection): number {
  const [length, setLength] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (el === null) {
      return undefined;
    }
    const observer = new ResizeObserver(() => {
      const box = el.getBoundingClientRect();
      setLength(direction === "row" ? box.width : box.height);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [ref, direction]);
  return length;
}

function SplitView({ node, path, ctx }: { node: LayoutSplit; path: LayoutPath; ctx: ViewContext }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const length = useAxisLength(ref, node.direction);
  const minima = node.children.map((child) => minSize(child, node.direction));

  // Before the first measurement there are no pixels to work with, so the
  // weights go straight to the screen. This lasts one frame.
  const fractions =
    length > 0 ? measure(node.sizes, minima, length).map((px) => px / length) : node.sizes;

  const offsets: number[] = [];
  let running = 0;
  for (const fraction of fractions) {
    offsets.push(running);
    running += fraction;
  }

  const apply = (index: number, deltaPx: number) => {
    if (length <= 0) {
      return;
    }
    const sizes = dragDivider(node.sizes, minima, length, index, deltaPx);
    ctx.update(path, { ...node, sizes });
  };

  const row = node.direction === "row";
  return (
    <div ref={ref} class="absolute inset-0">
      {node.children.map((child, i) => (
        <div
          key={keyOf(child)}
          class="absolute"
          style={
            row
              ? {
                  left: `${offsets[i] * 100}%`,
                  width: `${fractions[i] * 100}%`,
                  top: 0,
                  bottom: 0,
                }
              : {
                  top: `${offsets[i] * 100}%`,
                  height: `${fractions[i] * 100}%`,
                  left: 0,
                  right: 0,
                }
          }
        >
          <NodeView node={child} path={[...path, i]} ctx={ctx} />
        </div>
      ))}
      {node.children.slice(0, -1).map((child, i) => (
        <Divider
          key={`after-${keyOf(child)}`}
          direction={node.direction}
          at={offsets[i + 1]}
          onMove={(deltaPx) => {
            apply(i, deltaPx);
          }}
        />
      ))}
    </div>
  );
}

function Divider({
  direction,
  at,
  onMove,
}: {
  direction: SplitDirection;
  at: number;
  onMove: (deltaPx: number) => void;
}) {
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);
  // Every step of a drag must reach the tree as it stands now. The handler
  // below is made once, at pointer-down, and holds that render's `onMove` — so
  // the second step of a drag would be applied to the sizes of the first, and
  // the divider would stop after one step. The ref always holds the latest.
  const moveRef = useRef(onMove);
  moveRef.current = onMove;
  const row = direction === "row";

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) {
      return;
    }
    // Stop the browser from scrolling the page or selecting text. `touch-none`
    // in the class list does the same for a finger, before the event arrives.
    e.preventDefault();
    let last = row ? e.clientX : e.clientY;
    const previousSelect = document.documentElement.style.userSelect;
    document.documentElement.style.userSelect = "none";

    const onPointerMove = (ev: PointerEvent) => {
      const now = row ? ev.clientX : ev.clientY;
      // Send the step since the last event, not since the start: the tree has
      // already taken every earlier step, so a total would apply them twice.
      moveRef.current(now - last);
      last = now;
    };
    const cleanup = () => {
      globalThis.removeEventListener("pointermove", onPointerMove);
      globalThis.removeEventListener("pointerup", cleanup);
      globalThis.removeEventListener("pointercancel", cleanup);
      document.documentElement.style.userSelect = previousSelect;
      cleanupRef.current = null;
    };
    cleanupRef.current = cleanup;
    globalThis.addEventListener("pointermove", onPointerMove);
    globalThis.addEventListener("pointerup", cleanup);
    globalThis.addEventListener("pointercancel", cleanup);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const delta = keyDelta(e.key, direction, KEY_STEP);
    if (delta === null) {
      return;
    }
    e.preventDefault();
    moveRef.current(delta);
  };

  const half = DIVIDER_HIT / 2;
  // A focusable separator carrying `aria-valuenow` is the ARIA window-splitter
  // pattern, and it is the only correct markup for a divider. jsx-a11y counts
  // every separator as non-interactive, so it reads the pattern itself as a
  // fault. The rule is wrong here, and only here.
  /* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
  return (
    <hr
      tabIndex={0}
      aria-orientation={row ? "vertical" : "horizontal"}
      aria-valuenow={Math.round(at * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={row ? "Move the divider left or right" : "Move the divider up or down"}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      // An `hr` is already a separator, so the role needs no saying. `h-auto`
      // undoes the `height: 0` that Tailwind's preflight puts on every `hr`:
      // an explicit height wins over a top-and-bottom pair, and the divider
      // would have no height at all to grab. The line
      // the user sees is the `::before`, one pixel wide inside a grab area of
      // twenty. The element itself stays invisible.
      class={`absolute z-10 m-0 border-0 touch-none select-none focus:outline-none before:absolute before:bg-toolbox-border before:content-[''] hover:before:bg-toolbox-border-light focus:before:bg-focused ${
        row
          ? "top-0 bottom-0 h-auto cursor-col-resize before:top-0 before:bottom-0 before:left-1/2 before:-ml-px before:w-px"
          : "right-0 left-0 cursor-row-resize before:top-1/2 before:right-0 before:left-0 before:-mt-px before:h-px"
      }`}
      style={
        row
          ? { left: `calc(${at * 100}% - ${half}px)`, width: DIVIDER_HIT }
          : { top: `calc(${at * 100}% - ${half}px)`, height: DIVIDER_HIT }
      }
    />
  );
  /* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
}

function PaneView({
  node,
  path,
  ctx,
}: {
  node: Extract<LayoutNode, { type: "leaf" }>;
  path: LayoutPath;
  ctx: ViewContext;
}) {
  const active = node.tabs[node.activeTab] ?? node.tabs[0];
  return (
    <div class="absolute inset-0 flex flex-col overflow-hidden rounded bg-toolbox-surface">
      <div role="tablist" class="flex shrink-0 overflow-x-auto bg-toolbox-content">
        {node.tabs.map((tab, i) => (
          <div key={tab} class="flex items-center">
            <button
              type="button"
              role="tab"
              aria-selected={tab === active}
              onClick={() => {
                ctx.update(path, { ...node, activeTab: i });
              }}
              class={`h-9 px-3 text-sm whitespace-nowrap ${
                tab === active ? "bg-toolbox-surface text-toolbox-text" : "text-toolbox-muted"
              }`}
            >
              {ctx.labelOf(tab)}
            </button>
            {ctx.onCloseTab === undefined ? null : (
              <button
                type="button"
                aria-label={`Close ${ctx.labelOf(tab)}`}
                onClick={() => ctx.onCloseTab?.(tab)}
                class="h-9 w-7 text-toolbox-muted hover:text-toolbox-text"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      <div class="min-h-0 flex-1 overflow-auto p-3">{ctx.renderTab(active)}</div>
    </div>
  );
}
