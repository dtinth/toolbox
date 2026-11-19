import { useEffect, useRef, useState } from "preact/hooks";
import { type DockDrag } from "../runtime/dock-controller.ts";
import { type DockTarget } from "../runtime/docking.ts";
import { LayoutView } from "../runtime/layout-view.tsx";
import { LAYOUT_CHROME_Z } from "../runtime/renderer.tsx";
import { type Runtime } from "../runtime/index.ts";

/** How far a tab must travel before a press turns into a drag that pulls it out. */
const DRAG_START = 10;

/** Above every floating window, whose z-index climbs with each focus. */
const OVERLAY_Z = 100_000;

/** Where in the ghost window the pointer holds it, when a tab is dragged out. */
const GRAB = { x: 40, y: 18 };

/**
 * The Layout's chrome on the desktop: a tab bar for every Pane, and the
 * dividers between them. The docked Windows themselves are drawn by their own
 * tools' roots, underneath, in the rectangles this tree gives them.
 *
 * A tab can be dragged out of its Pane. While it is, the compass shows, and the
 * same rules hold as for a floating Window dragged by its title: let go on a
 * button to dock it there; anywhere else, it floats where it was let go.
 */
export function DockLayer({ runtime }: { runtime: Runtime }) {
  const [, setVersion] = useState(0);
  const [ghost, setGhost] = useState<{ id: string; x: number; y: number } | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const redraw = () => {
      setVersion((v) => v + 1);
    };
    runtime.setDockingEnabled(true);
    const unsubscribe = runtime.subscribe(redraw);
    // The Layout fills the viewport, so a new viewport size moves every Pane —
    // and every docked Window with it.
    const onResize = () => {
      runtime.requestUpdate();
    };
    globalThis.addEventListener("resize", onResize);
    return () => {
      unsubscribe();
      runtime.setDockingEnabled(false);
      globalThis.removeEventListener("resize", onResize);
      cleanupRef.current?.();
    };
  }, [runtime]);

  const onTabPointerDown = (id: string, e: PointerEvent) => {
    if (e.button !== 0) {
      return;
    }
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;

    const onMove = (ev: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_START) {
          return;
        }
        dragging = true;
        document.documentElement.style.userSelect = "none";
      }
      setGhost({ id, x: ev.clientX, y: ev.clientY });
      runtime.dockDragMove(id, ev.clientX, ev.clientY);
    };
    const cleanup = () => {
      globalThis.removeEventListener("pointermove", onMove);
      globalThis.removeEventListener("pointerup", onUp);
      globalThis.removeEventListener("pointercancel", onCancel);
      globalThis.removeEventListener("keydown", onKey, true);
      document.documentElement.style.userSelect = "";
      setGhost(null);
      cleanupRef.current = null;
    };
    const onUp = (ev: PointerEvent) => {
      cleanup();
      if (!dragging) {
        return;
      }
      // The press was a drag, so the click it ends with must not also pick the tab.
      swallowNextClick();
      const target: DockTarget | null = runtime.dockDragEnd(true);
      if (target === null) {
        runtime.undockWindow(id, { x: ev.clientX - GRAB.x, y: ev.clientY - GRAB.y });
      }
    };
    const onCancel = () => {
      cleanup();
      runtime.dockDragEnd(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && dragging) {
        ev.preventDefault();
        ev.stopPropagation();
        swallowNextClick();
        onCancel();
      }
    };
    cleanupRef.current = cleanup;
    globalThis.addEventListener("pointermove", onMove);
    globalThis.addEventListener("pointerup", onUp);
    globalThis.addEventListener("pointercancel", onCancel);
    globalThis.addEventListener("keydown", onKey, true);
  };

  const layout = runtime.layout;
  return (
    <>
      {layout === null ? null : (
        <div
          class="pointer-events-none fixed inset-0"
          style={{ zIndex: LAYOUT_CHROME_Z }}
          data-toolbox-layout
        >
          <LayoutView
            root={layout}
            chromeOnly
            renderTab={() => null}
            labelOf={(id) => runtime.windowTitle(id)}
            isTabShown={(id) => runtime.isWindowPresent(id)}
            onChange={(next) => {
              runtime.setLayout(next);
            }}
            onCloseTab={(id) => {
              runtime.closeWindow(id);
            }}
            canCloseTab={(id) => runtime.canCloseWindow(id)}
            onFloatTab={(id) => {
              runtime.undockWindow(id);
            }}
            onTabPointerDown={onTabPointerDown}
          />
        </div>
      )}
      {ghost === null ? null : (
        <div
          class="pointer-events-none fixed flex h-24 w-56 flex-col overflow-hidden rounded-lg border border-toolbox-accent bg-toolbox-surface/80"
          style={{ left: ghost.x - GRAB.x, top: ghost.y - GRAB.y, zIndex: OVERLAY_Z - 1 }}
        >
          <div class="flex h-9 items-center border-b border-toolbox-border bg-toolbox-deepest px-3 text-xs text-toolbox-muted">
            {runtime.windowTitle(ghost.id)}
          </div>
        </div>
      )}
      <DockOverlay runtime={runtime} />
    </>
  );
}

function swallowNextClick() {
  globalThis.addEventListener(
    "click",
    (c) => {
      c.stopPropagation();
      c.preventDefault();
    },
    { capture: true, once: true },
  );
}

const GLYPHS: Record<string, string> = {
  tab: "▣",
  "split-left": "◧",
  "split-right": "◨",
  "split-top": "⬒",
  "split-bottom": "⬓",
  "edge-left": "⇤",
  "edge-right": "⇥",
  "edge-top": "⤒",
  "edge-bottom": "⤓",
  back: "↩",
};

function glyphOf(target: DockTarget): string {
  switch (target.kind) {
    case "tab":
    case "back": {
      return GLYPHS[target.kind];
    }
    case "split":
    case "edge": {
      return GLYPHS[`${target.kind}-${target.side}`];
    }
    default: {
      return "";
    }
  }
}

const sameTarget = (a: DockTarget | null, b: DockTarget) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The compass: what a drag can dock onto, drawn above everything. It takes no
 * pointer events — the drag decides what is under the pointer from the
 * geometry, so the overlay is only a picture of that.
 */
function DockOverlay({ runtime }: { runtime: Runtime }) {
  const [drag, setDrag] = useState<DockDrag | null>(runtime.dockDrag);
  useEffect(
    () =>
      runtime.subscribeDockDrag(() => {
        setDrag(runtime.dockDrag);
      }),
    [runtime],
  );
  if (drag === null) {
    return null;
  }
  return (
    <div
      class="pointer-events-none fixed inset-0"
      style={{ zIndex: OVERLAY_Z }}
      data-toolbox-chrome
    >
      {drag.preview === null ? null : (
        <div
          class="absolute rounded border-2 border-dashed border-toolbox-accent"
          style={{
            left: drag.preview.x,
            top: drag.preview.y,
            width: drag.preview.w,
            height: drag.preview.h,
          }}
        />
      )}
      {drag.buttons.map((b) => (
        <div
          key={JSON.stringify(b.target)}
          class={`absolute flex items-center justify-center rounded-lg border text-2xl shadow-lg ${
            sameTarget(drag.target, b.target)
              ? "border-toolbox-accent bg-toolbox-accent text-toolbox-deepest"
              : "border-toolbox-border-light bg-toolbox-content/90 text-toolbox-text"
          }`}
          style={{ left: b.rect.x, top: b.rect.y, width: b.rect.w, height: b.rect.h }}
        >
          {/* With nothing docked, the one button fills the screen, whatever side it names. */}
          {runtime.layout === null ? GLYPHS.tab : glyphOf(b.target)}
        </div>
      ))}
    </div>
  );
}
