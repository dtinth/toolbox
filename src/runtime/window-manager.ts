// Window manager: owns geometry, z-order, focus, placement, and scoped-id encoding
// for all windows across all tool instances.

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

export function createWindowManager(): WindowManager {
  const slots = new Map<string, Slot>();
  let zCounter = 0;

  function place(orderedIds: string[], scope = ""): void {
    const declared = new Set(orderedIds);
    for (const [id, slot] of slots) {
      if (id.startsWith(scope)) {
        slot.present = declared.has(id);
      }
    }
    for (const id of orderedIds) {
      if (!slots.has(id)) {
        const taken = slots.size;
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
      }
    }
  }

  function focus(id: string): boolean {
    const slot = slots.get(id);
    if (slot === undefined || !slot.present) {
      return false;
    }
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
      return true;
    }
    return false;
  }

  function move(id: string, x: number, y: number): void {
    const slot = slots.get(id);
    if (slot) {
      slot.x = x;
      slot.y = y;
    }
  }

  function resize(id: string, width: number, height: number): void {
    const slot = slots.get(id);
    if (slot) {
      slot.width = Math.max(MIN_WINDOW_WIDTH, width);
      slot.height = Math.max(MIN_WINDOW_HEIGHT, height);
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
    for (const key of slots.keys()) {
      if (key.startsWith(prefix)) {
        slots.delete(key);
      }
    }
  }

  function reset(): void {
    slots.clear();
    zCounter = 0;
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
  };
}
