// Window manager: owns geometry, z-order, focus, placement, and scoped-id encoding
// for all windows across all tool instances.

export interface WindowState {
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
   * Ensure every id in orderedIds has a WindowState. For ids that don't yet
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

  /** Clear all state and reset the z counter. */
  reset: () => void;

  /** Read-only view of all known window states. */
  readonly states: ReadonlyMap<string, WindowState>;
}

export function createWindowManager(): WindowManager {
  const states = new Map<string, WindowState>();
  let zCounter = 0;

  function place(orderedIds: string[]): void {
    for (let i = 0; i < orderedIds.length; i++) {
      const id = orderedIds[i];
      if (!states.has(id)) {
        const cx = (globalThis.window?.innerWidth ?? 800) / 2 - 150;
        const cy = (globalThis.window?.innerHeight ?? 600) / 2 - 100;
        const offset = i === 0 ? 0 : (i - 1) * 30;
        states.set(id, {
          x: cx + offset,
          y: cy + offset,
          zIndex: i === 0 ? 0 : ++zCounter,
        });
      }
    }
  }

  function focus(id: string): boolean {
    const state = states.get(id);
    if (!state) {
      return false;
    }
    const maxZ = Math.max(...Array.from(states.values(), (s: WindowState) => s.zIndex), 0);
    if (state.zIndex < maxZ) {
      state.zIndex = ++zCounter;
      return true;
    }
    return false;
  }

  function move(id: string, x: number, y: number): void {
    const state = states.get(id);
    if (state) {
      state.x = x;
      state.y = y;
    }
  }

  function activeId(): string | null {
    let maxZ = -1;
    let active: string | null = null;
    for (const [id, state] of states) {
      if (state.zIndex > maxZ) {
        maxZ = state.zIndex;
        active = id;
      }
    }
    return active;
  }

  function forget(prefix: string): void {
    for (const key of states.keys()) {
      if (key.startsWith(prefix)) {
        states.delete(key);
      }
    }
  }

  function reset(): void {
    states.clear();
    zCounter = 0;
  }

  return {
    place,
    focus,
    move,
    activeId,
    forget,
    reset,
    get states(): ReadonlyMap<string, WindowState> {
      return states;
    },
  };
}
