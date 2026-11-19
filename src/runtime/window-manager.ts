// Window manager: owns geometry, z-order, focus, placement, and scoped-id encoding
// for all windows across all tool instances — and the Layout tree that docked
// windows take their place from.

import { dock as dockInto, type DockTarget, isDocked as inTree } from "./docking.ts";
import {
  type LayoutNode,
  nodeAt,
  normalize,
  pathOfTab,
  removeTab,
  replaceAt,
  tabsOf,
} from "./layout-tree.ts";

/**
 * The durable seat a Window occupies, keyed by scoped id. A Slot outlives the
 * Window: the Window exists only while the tool's declarator draws it, but the
 * Slot keeps the geometry the user arranged.
 */
export interface Slot {
  x: number;
  y: number;
  zIndex: number;
  /**
   * Whether a Window is drawn into this Slot right now. Re-derived from the
   * declarator on every frame — never stored, never restored. A Slot with
   * `present: false` is dormant: invisible, but still holding its place.
   */
  present: boolean;
  /**
   * The size the user dragged this window to, or null while they have not.
   * Null is not "zero" — it means nobody has an opinion, so the window sizes
   * to its content (or to the width the tool asked for via `ui.window.setWidth`).
   * A user's size outranks the tool's, otherwise a tool that calls `setWidth`
   * every frame would undo the resize the moment it redrew.
   */
  width: number | null;
  height: number | null;
}

/** A Slot as a Workspace stores it: everything but `present`, which is never stored. */
export type SavedSlot = Omit<Slot, "present">;

/** What the user arranged: every Slot, and the Layout tree. */
export interface Arrangement {
  slots: Record<string, SavedSlot>;
  layout: LayoutNode | null;
}

/** Floor for a user resize, so a window can never be dragged into nothing. */
export const MIN_WINDOW_WIDTH = 200;
export const MIN_WINDOW_HEIGHT = 80;

/** Height of the title bar (`h-9` in the renderer), the only part that must
 * stay on screen: a window whose title bar is off screen cannot be dragged,
 * focused by pointer, or closed. */
export const TITLE_BAR_HEIGHT = 36;

/** How far each new window steps down-right from the one before. */
const CASCADE_STEP = 30;

// Scoped window id format: `${instanceId}::${originalId}`.
export function scopeId(instanceId: string, originalId: string): string {
  return `${instanceId}::${originalId}`;
}

export function instancePrefix(instanceId: string): string {
  return `${instanceId}::`;
}

export interface WindowManager {
  /**
   * Seat this frame's windows. Ensure every id in orderedIds has a Slot and is
   * marked present; mark every other known Slot in scope dormant. A brand-new
   * Slot is centred, then stepped down-right past the seats already taken:
   *  - center: (innerWidth/2 - 150, innerHeight/2 - 100)
   *  - offset: 30px per Slot that already exists, restarting at centre before
   *    a step would push the title bar off screen (see cascadeOffset)
   *  - zIndex: 0 for the very first Slot, else ++zCounter
   *
   * The cascade counts existing Slots rather than position in the array,
   * because per-instance rendering calls this once per instance — so array
   * position says nothing about how many windows are already on screen, and
   * counting it would drop every tool's first window on the same spot.
   *
   * Absence means dormant, not deleted: an existing Slot keeps its geometry and
   * z-order, so a window that stops being declared drops back into exactly the
   * same place when the tool declares it again. Only `forget` deletes.
   *
   * `scope` bounds which Slots the dormancy sweep may touch, as an id prefix.
   * Per-instance rendering (ADR-0008) places one instance's windows at a time,
   * so it must pass that instance's prefix — otherwise the sweep would mark
   * every other instance's windows dormant. Omit it only when orderedIds covers
   * every window the runtime knows about.
   */
  place: (orderedIds: string[], scope?: string) => void;

  /**
   * Raise window to top z-order. Returns true if the z-order changed, false if
   * the window was already highest, dormant, or the id is unknown.
   */
  focus: (id: string) => boolean;

  /** Update the position of a window. */
  move: (id: string, x: number, y: number) => void;

  /**
   * Set the size of a window, clamped to MIN_WINDOW_WIDTH/HEIGHT. Position and
   * z-order are untouched. No-op for an unknown id.
   */
  resize: (id: string, width: number, height: number) => void;

  /**
   * Return the id of the present window with the highest zIndex, or null if no
   * window is currently drawn. Dormant slots are skipped — focus must never
   * land on a window nobody can see.
   */
  activeId: () => string | null;

  /** Drop all windows whose id starts with the given prefix. */
  forget: (prefix: string) => void;

  /** Clear all slots and reset the z counter. */
  reset: () => void;

  /** Read-only view of all known slots. */
  readonly slots: ReadonlyMap<string, Slot>;

  /**
   * The Layout tree, or null when nothing is docked. Its tabs are Slot ids.
   *
   * A window is docked exactly when its id is in this tree. There is no flag
   * on the Slot: two records of one fact can disagree, and one cannot.
   */
  readonly layout: LayoutNode | null;

  /**
   * Dock a window at `target`, or move it there if it is docked already.
   *
   * The Slot keeps its floating `x`, `y`, `width` and `height` untouched while
   * docked. They are not the truth while the tree places the window, so every
   * reader must ask `isDocked` first — but keeping them is what lets `undock`
   * put the window back where it last floated (issue #24).
   */
  dock: (id: string, target: DockTarget) => void;

  /**
   * Take a window out of the tree, and raise it. With `at`, it floats there —
   * for a window dragged out by its tab. Without, it goes back to where it
   * floated before it was docked.
   */
  undock: (id: string, at?: { x: number; y: number }) => void;

  /** Whether the window's id is in the Layout tree. */
  isDocked: (id: string) => boolean;

  /** Replace the tree whole: after a divider drag, or a click on a tab. */
  setLayout: (next: LayoutNode | null) => void;

  /** A copy of what the user arranged, for a Workspace to store. */
  arrangement: () => Arrangement;

  /**
   * Take a saved arrangement, for a Workspace being restored.
   *
   * Each saved Slot comes in dormant. It holds its place until a tool whose
   * instance id it names draws it — and on a fresh page no tool has yet. A
   * saved Slot replaces a live one with the same id. Tree tabs with no Slot
   * are dropped, so the tree never names a window nobody can seat.
   */
  adopt: (saved: Arrangement) => void;
}

/**
 * How far to step the nth new window from centre.
 *
 * The cascade restarts at centre once another step would push the title bar
 * past an edge, rather than marching on: an unreachable title bar means a
 * window that cannot be moved, focused, or closed. Restarting means late
 * windows land exactly on early ones, which is the overlap the cascade exists
 * to avoid — but an exact overlap is at least reachable, and it only happens
 * after a screen's worth of windows.
 *
 * Viewport-derived rather than a fixed count, so it adapts to a phone and to an
 * ultrawide. A viewport too small for even one step gives 0, and every window
 * lands on centre — degenerate, but there is nowhere else to put them.
 */
function cascadeOffset(taken: number, cx: number, cy: number, vw: number, vh: number): number {
  // Keep a grabbable slice of the title bar in view horizontally, and all of
  // its height in view vertically.
  const roomX = vw - MIN_WINDOW_WIDTH - cx;
  const roomY = vh - TITLE_BAR_HEIGHT - cy;
  const steps = Math.floor(Math.max(0, Math.min(roomX, roomY)) / CASCADE_STEP);
  return (taken % (steps + 1)) * CASCADE_STEP;
}

/**
 * `onChange` hears about every change to what the user arranged: a move, a
 * resize, a raise, a dock, a new or forgotten Slot. A Workspace saves on it.
 * Moves reach here without any redraw, so a redraw is not a signal for it.
 */
export function createWindowManager(onChange: () => void = () => {}): WindowManager {
  const slots = new Map<string, Slot>();
  let zCounter = 0;
  let layout: LayoutNode | null = null;

  /** Slots that hold a seat in the cascade: the floating ones. */
  function floatingCount(): number {
    let count = 0;
    for (const id of slots.keys()) {
      if (!inTree(layout, id)) {
        count++;
      }
    }
    return count;
  }

  /** Bring a docked window's tab to the front. True when that changed anything. */
  function showTab(id: string): boolean {
    if (layout === null) {
      return false;
    }
    const path = pathOfTab(layout, id);
    if (path === null) {
      return false;
    }
    const pane = nodeAt(layout, path);
    if (pane === null || pane.type !== "leaf") {
      return false;
    }
    const index = pane.tabs.indexOf(id);
    if (index === pane.activeTab) {
      return false;
    }
    layout = replaceAt(layout, path, { ...pane, activeTab: index });
    return true;
  }

  function place(orderedIds: string[], scope = ""): void {
    const declared = new Set(orderedIds);
    for (const [id, slot] of slots) {
      if (id.startsWith(scope)) {
        slot.present = declared.has(id);
      }
    }
    for (const id of orderedIds) {
      if (!slots.has(id)) {
        const taken = floatingCount();
        const vw = globalThis.window?.innerWidth ?? 800;
        const vh = globalThis.window?.innerHeight ?? 600;
        const cx = vw / 2 - 150;
        const cy = vh / 2 - 100;
        const offset = cascadeOffset(taken, cx, cy, vw, vh);
        slots.set(id, {
          x: cx + offset,
          y: cy + offset,
          zIndex: taken === 0 ? 0 : ++zCounter,
          present: true,
          width: null,
          height: null,
        });
        onChange();
      }
    }
  }

  function focus(id: string): boolean {
    const slot = slots.get(id);
    if (slot === undefined || !slot.present) {
      return false;
    }
    const tabChanged = showTab(id);
    // Compare against the present windows only: a dormant window sitting on top
    // would otherwise pin everything below it, unfocusable.
    let maxZ = 0;
    for (const other of slots.values()) {
      if (other.present && other.zIndex > maxZ) {
        maxZ = other.zIndex;
      }
    }
    if (slot.zIndex < maxZ) {
      slot.zIndex = ++zCounter;
      onChange();
      return true;
    }
    if (tabChanged) {
      onChange();
    }
    return tabChanged;
  }

  function move(id: string, x: number, y: number): void {
    const slot = slots.get(id);
    if (slot) {
      slot.x = x;
      slot.y = y;
      onChange();
    }
  }

  function resize(id: string, width: number, height: number): void {
    const slot = slots.get(id);
    if (slot) {
      slot.width = Math.max(MIN_WINDOW_WIDTH, width);
      slot.height = Math.max(MIN_WINDOW_HEIGHT, height);
      onChange();
    }
  }

  function activeId(): string | null {
    let maxZ = -1;
    let active: string | null = null;
    for (const [id, slot] of slots) {
      if (slot.present && slot.zIndex > maxZ) {
        maxZ = slot.zIndex;
        active = id;
      }
    }
    return active;
  }

  function forget(prefix: string): void {
    let changed = false;
    for (const key of slots.keys()) {
      if (key.startsWith(prefix)) {
        slots.delete(key);
        changed = true;
        if (layout !== null) {
          layout = removeTab(layout, key);
        }
      }
    }
    if (changed) {
      onChange();
    }
  }

  function reset(): void {
    slots.clear();
    zCounter = 0;
    layout = null;
    onChange();
  }

  function dock(id: string, target: DockTarget): void {
    if (!slots.has(id)) {
      return;
    }
    layout = dockInto(layout, id, target);
    showTab(id);
    onChange();
  }

  function undock(id: string, at?: { x: number; y: number }): void {
    const slot = slots.get(id);
    if (slot === undefined || layout === null) {
      return;
    }
    layout = removeTab(layout, id);
    if (at !== undefined) {
      slot.x = at.x;
      slot.y = at.y;
    }
    slot.zIndex = ++zCounter;
    onChange();
  }

  function arrangement(): Arrangement {
    const saved: Record<string, SavedSlot> = {};
    for (const [id, { x, y, zIndex, width, height }] of slots) {
      saved[id] = { x, y, zIndex, width, height };
    }
    return { slots: saved, layout };
  }

  function adopt(saved: Arrangement): void {
    for (const [id, slot] of Object.entries(saved.slots)) {
      slots.set(id, { ...slot, present: false });
      zCounter = Math.max(zCounter, slot.zIndex);
    }
    let next = normalize(saved.layout);
    for (const tab of next === null ? [] : tabsOf(next)) {
      if (next !== null && !slots.has(tab)) {
        next = removeTab(next, tab);
      }
    }
    layout = next;
    onChange();
  }

  return {
    place,
    focus,
    move,
    resize,
    activeId,
    forget,
    reset,
    get slots(): ReadonlyMap<string, Slot> {
      return slots;
    },
    get layout(): LayoutNode | null {
      return layout;
    },
    dock,
    undock,
    isDocked: (id) => inTree(layout, id),
    setLayout: (next) => {
      layout = next;
      onChange();
    },
    arrangement,
    adopt,
  };
}
