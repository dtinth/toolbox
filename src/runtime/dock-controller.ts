// Dock controller: the runtime's side of docking. It answers where a docked
// Window is drawn, and follows a drag so the host can draw the compass.
//
// The geometry is in docking.ts; the tree is in the window manager. This is
// the glue, plus the one piece of state a drag needs.

import {
  compassAt,
  type CompassButton,
  type DockTarget,
  paneOf,
  previewRect,
  type Rect,
  targetAt,
} from "./docking.ts";
import { type DockContext } from "./renderer.tsx";
import { type WindowManager } from "./window-manager.ts";

export type { DockTarget } from "./docking.ts";
export type { LayoutNode } from "./layout-tree.ts";

/**
 * A Window being dragged with docking in mind: what the overlay draws.
 */
export interface DockDrag {
  id: string;
  /** The compass buttons on show, in viewport pixels. */
  buttons: CompassButton[];
  /** The button under the pointer, or null to float where it lets go. */
  target: DockTarget | null;
  /** The rectangle the Window would get, or null when there is no target. */
  preview: Rect | null;
}

/** The height of a Pane's tab bar (`h-9` in LayoutView). The docked Window sits below it. */
export const PANE_TAB_BAR = 36;

/** The area the Layout fills: the whole viewport. */
function dockArea(): Rect {
  return {
    x: 0,
    y: 0,
    w: globalThis.window?.innerWidth ?? 800,
    h: globalThis.window?.innerHeight ?? 600,
  };
}

export interface DockController {
  /** What the renderer needs. */
  context: DockContext;
  /** The drag in progress, or null. */
  readonly drag: DockDrag | null;
  /** Follow a drag: the pointer is at x, y in the viewport. */
  move: (id: string, x: number, y: number) => void;
  /**
   * End a drag. With `commit`, a drop on a button docks the Window. Returns
   * the target it dropped on, or null when it was let go over nothing, or the
   * drag was cancelled.
   */
  end: (commit: boolean) => DockTarget | null;
  /** Be told when the drag changes. */
  subscribe: (onChange: () => void) => () => void;
  dock: (id: string, target: DockTarget) => void;
  undock: (id: string, at?: { x: number; y: number }) => void;
}

export function createDockController(wm: WindowManager, redraw: () => void): DockController {
  let drag: DockDrag | null = null;
  const subscribers = new Set<() => void>();

  function notify() {
    for (const sub of subscribers) {
      sub();
    }
  }

  function dock(id: string, target: DockTarget): void {
    wm.dock(id, target);
    redraw();
  }

  function move(id: string, x: number, y: number): void {
    const area = dockArea();
    const buttons = compassAt(wm.layout, area, id, x, y);
    const target = targetAt(buttons, x, y);
    drag = {
      id,
      buttons,
      target,
      preview: target === null ? null : previewRect(wm.layout, id, target, area),
    };
    notify();
  }

  function end(commit: boolean): DockTarget | null {
    const last = drag;
    drag = null;
    notify();
    if (last === null || !commit || last.target === null) {
      return null;
    }
    if (last.target.kind !== "back") {
      dock(last.id, last.target);
    }
    return last.target;
  }

  const context: DockContext = {
    placeOf(id) {
      const pane = paneOf(wm.layout, id, dockArea());
      if (pane === null) {
        return null;
      }
      const { x, y, w, h } = pane.rect;
      return {
        rect: { x, y: y + PANE_TAB_BAR, w, h: Math.max(0, h - PANE_TAB_BAR) },
        shown: pane.tabs[pane.activeTab] === id,
      };
    },
    dragMove: move,
    dragEnd: end,
  };

  return {
    context,
    get drag() {
      return drag;
    },
    move,
    end,
    subscribe(onChange) {
      subscribers.add(onChange);
      return () => {
        subscribers.delete(onChange);
      };
    },
    dock,
    undock(id, at) {
      wm.undock(id, at);
      redraw();
    },
  };
}
