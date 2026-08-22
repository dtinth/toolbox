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
}

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
   * marked present; mark every other known Slot in scope dormant. For ids that
   * don't yet have a Slot, apply the centering + cascade placement rule:
   *  - center: (innerWidth/2 - 150, innerHeight/2 - 100)
   *  - offset: index === 0 → 0, else (index - 1) * 30
   *  - zIndex:  index === 0 → 0, else ++zCounter
   * The ordering is by position in the array (i.e. the order windows appear in
   * the render output).
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
    for (let i = 0; i < orderedIds.length; i++) {
      const id = orderedIds[i];
      if (!slots.has(id)) {
        const cx = (globalThis.window?.innerWidth ?? 800) / 2 - 150;
        const cy = (globalThis.window?.innerHeight ?? 600) / 2 - 100;
        const offset = i === 0 ? 0 : (i - 1) * 30;
        slots.set(id, {
          x: cx + offset,
          y: cy + offset,
          zIndex: i === 0 ? 0 : ++zCounter,
          present: true,
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
    activeId,
    forget,
    reset,
    get slots(): ReadonlyMap<string, Slot> {
      return slots;
    },
  };
}
