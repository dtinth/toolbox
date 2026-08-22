// Window manager: owns geometry, z-order, focus, placement, and scoped-id encoding
// for all windows across all tool instances.

export interface Slot {
  x: number;
  y: number;
  zIndex: number;
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
   * Ensure every id in orderedIds has a Slot. For ids that don't yet
   * have one, apply the centering + cascade placement rule:
   *  - center: (innerWidth/2 - 150, innerHeight/2 - 100)
   *  - offset: index === 0 → 0, else (index - 1) * 30
   *  - zIndex:  index === 0 → 0, else ++zCounter
   * The ordering is by position in the array (i.e. the order windows appear in
   * the render output).
   */
  place: (orderedIds: string[]) => void;

  /**
   * Raise window to top z-order. Returns true if the z-order changed, false if
   * the window was already highest or the id is unknown.
   */
  focus: (id: string) => boolean;

  /** Update the position of a window. */
  move: (id: string, x: number, y: number) => void;

  /** Return the id of the window with the highest zIndex, or null if empty. */
  activeId: () => string | null;

  /** Drop all windows whose id starts with the given prefix. */
  forget: (prefix: string) => void;

  /** Clear all slot and reset the z counter. */
  reset: () => void;

  /** Read-only view of all known slots. */
  readonly slots: ReadonlyMap<string, Slot>;
}

export function createWindowManager(): WindowManager {
  const slots = new Map<string, Slot>();
  let zCounter = 0;

  function place(orderedIds: string[]): void {
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
        });
      }
    }
  }

  function focus(id: string): boolean {
    const slot = slots.get(id);
    if (!slot) {
      return false;
    }
    const maxZ = Math.max(...Array.from(slots.values(), (s: Slot) => s.zIndex), 0);
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
      if (slot.zIndex > maxZ) {
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
