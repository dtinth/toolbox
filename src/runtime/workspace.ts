// Workspace persistence: what a Workspace stores, where, and how a stored one
// survives a change to its shape. Issue #26.
//
// A Workspace is the set of running Tools plus how their Windows are arranged.
// Which URL loads which Workspace, and when it saves, is the host's business
// (issue #27). This module only turns a Runtime into stored JSON and back.

import { type LayoutNode, normalize, removeTab, tabsOf } from "./layout-tree.ts";
import { type Arrangement, type Runtime, type SavedSlot } from "./runtime.ts";
import { instancePrefix } from "./window-manager.ts";

/**
 * The shape this build writes. Bump it when the shape changes, and add a
 * migration from the old number to `migrations`. Bump it with no migration to
 * reset every stored Workspace instead: a stored one with no way forward loads
 * as nothing, and the next save writes over it. That is the reset for a change
 * whose migration is not worth writing.
 */
export const WORKSPACE_VERSION = 1;

/** A running Tool, by the ids that outlive the page. */
export interface SavedTool {
  /**
   * The instance id the Tool ran under. Slot keys start with it, so restoring
   * launches the Tool under the same id, and its Windows find their Slots.
   */
  instanceId: string;
  /** The Manifest id, never a name or an index: names change, ids do not. */
  manifestId: string;
}

export interface Workspace extends Arrangement {
  version: typeof WORKSPACE_VERSION;
  /** In launch order. */
  tools: SavedTool[];
}

/**
 * Each entry turns a stored Workspace of version N into one of version N + 1.
 * The input is untrusted JSON of that old shape; the output is checked again.
 */
export const migrations: Record<number, (old: Record<string, unknown>) => Record<string, unknown>> =
  {};

/** What the Runtime holds right now, as a Workspace. */
export function snapshot(runtime: Runtime): Workspace {
  const { slots, layout } = runtime.arrangement();
  return {
    version: WORKSPACE_VERSION,
    tools: runtime
      .toolInstances()
      .map(({ instanceId, manifestId }) => ({ instanceId, manifestId })),
    slots,
    layout,
  };
}

/**
 * Read a stored Workspace. Returns null when there is none, or when it cannot
 * be read: bad JSON, a wrong shape, or a version this build has no way to
 * reach. Null means "start empty", never "crash on load".
 */
export function parseWorkspace(
  text: string | null,
  steps: Record<number, (old: Record<string, unknown>) => Record<string, unknown>> = migrations,
): Workspace | null {
  if (text === null) {
    return null;
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(data) || typeof data.version !== "number") {
    return null;
  }
  let current: Record<string, unknown> = data;
  while (current.version !== WORKSPACE_VERSION) {
    const version = current.version as number;
    const step = steps[version];
    if (step === undefined) {
      return null;
    }
    current = step(current);
    if (current.version !== version + 1) {
      return null;
    }
  }
  return checkWorkspace(current);
}

/**
 * Drop what this Manifest cannot run, then repair what is left.
 *
 * A Tool whose id is gone from the Manifest cannot be launched, so its Slots
 * can never be drawn again, and its tabs would hold empty panes forever. Only a
 * restore can meet this: a live page cannot lose a Manifest entry. Slots that
 * belong to no saved Tool go too, for the same reason.
 */
export function pruneWorkspace(workspace: Workspace, manifestIds: ReadonlySet<string>): Workspace {
  // An instance id twice would make the second launch throw; keep the first.
  const seen = new Set<string>();
  const tools = workspace.tools.filter((tool) => {
    const keep = manifestIds.has(tool.manifestId) && !seen.has(tool.instanceId);
    seen.add(tool.instanceId);
    return keep;
  });
  const prefixes = tools.map((tool) => instancePrefix(tool.instanceId));
  const slots: Record<string, SavedSlot> = {};
  for (const [id, slot] of Object.entries(workspace.slots)) {
    if (prefixes.some((prefix) => id.startsWith(prefix))) {
      slots[id] = slot;
    }
  }
  let layout = normalize(workspace.layout);
  for (const tab of layout === null ? [] : tabsOf(layout)) {
    if (layout !== null && !(tab in slots)) {
      layout = removeTab(layout, tab);
    }
  }
  return { version: WORKSPACE_VERSION, tools, slots, layout };
}

/**
 * Put a Workspace back into an empty Runtime.
 *
 * The arrangement goes in first, then the Tools launch. A Slot must already be
 * there when its Tool first draws, or the Tool gets a fresh Slot at the
 * cascade spot and the saved one is never used. `launch` is how the host
 * starts a Tool (it imports the Tool's module); it must pass `instanceId` on to
 * `runtime.launchTool`.
 */
export function restoreWorkspace(
  runtime: Runtime,
  workspace: Workspace,
  manifestIds: ReadonlySet<string>,
  launch: (tool: SavedTool) => void,
): void {
  const pruned = pruneWorkspace(workspace, manifestIds);
  runtime.adoptArrangement(pruned);
  for (const tool of pruned.tools) {
    launch(tool);
  }
}

const storageKey = (id: string) => `toolbox.workspace.${id}`;

/** Where Workspaces live: `localStorage`, or a stand-in for it in tests. */
export type WorkspaceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface WorkspaceStore {
  load: (id: string) => Workspace | null;
  save: (id: string, workspace: Workspace) => void;
  /** Forget a stored Workspace, so the next load starts empty. */
  reset: (id: string) => void;
}

/**
 * Store Workspaces under one key each. `localStorage` and not IndexedDB: a
 * Workspace is a few kilobytes of JSON, read once on load, and a synchronous
 * read means the first frame can already be the restored one.
 *
 * Last write wins. Two tabs on one Workspace overwrite each other, and that is
 * the decision (#16), not an oversight.
 */
export function createWorkspaceStore(storage: WorkspaceStorage): WorkspaceStore {
  return {
    load: (id) => {
      try {
        return parseWorkspace(storage.getItem(storageKey(id)));
      } catch {
        return null;
      }
    },
    save: (id, workspace) => {
      try {
        storage.setItem(storageKey(id), JSON.stringify(workspace));
      } catch {
        // Full, or blocked. The page still works; it only stops remembering.
      }
    },
    reset: (id) => {
      try {
        storage.removeItem(storageKey(id));
      } catch {
        // Nothing stored, or nothing reachable: either way, nothing to forget.
      }
    },
  };
}

/**
 * Save the Workspace whenever the Runtime changes, a short while after the
 * last change, so one drag is one write and not a write per frame. Returns a
 * function that stops saving, after one final save of anything still pending.
 */
export function autosave(
  runtime: Runtime,
  save: (workspace: Workspace) => void,
  delayMs = 300,
): { flush: () => void; stop: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = "";
  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const workspace = snapshot(runtime);
    const text = JSON.stringify(workspace);
    if (text !== last) {
      last = text;
      save(workspace);
    }
  };
  const schedule = () => {
    timer ??= setTimeout(flush, delayMs);
  };
  // Launching a Tool redraws; moving a Window does not. Listen to both.
  const offRender = runtime.subscribe(schedule);
  const offArrangement = runtime.subscribeArrangement(schedule);
  return {
    flush,
    stop: () => {
      offRender();
      offArrangement();
      if (timer !== null) {
        flush();
      }
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isSize = (value: unknown): value is number | null => value === null || isFiniteNumber(value);

function checkSlot(value: unknown): SavedSlot | null {
  if (
    !isRecord(value) ||
    !isFiniteNumber(value.x) ||
    !isFiniteNumber(value.y) ||
    !isFiniteNumber(value.zIndex) ||
    !isSize(value.width) ||
    !isSize(value.height)
  ) {
    return null;
  }
  return {
    x: value.x,
    y: value.y,
    zIndex: value.zIndex,
    width: value.width,
    height: value.height,
  };
}

function checkLayout(value: unknown): LayoutNode | null | undefined {
  if (value === null) {
    return null;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  if (value.type === "leaf") {
    if (
      !Array.isArray(value.tabs) ||
      !value.tabs.every((tab) => typeof tab === "string") ||
      !isFiniteNumber(value.activeTab)
    ) {
      return undefined;
    }
    return { type: "leaf", tabs: value.tabs, activeTab: value.activeTab };
  }
  if (
    value.type !== "split" ||
    (value.direction !== "row" && value.direction !== "column") ||
    !Array.isArray(value.children) ||
    !Array.isArray(value.sizes)
  ) {
    return undefined;
  }
  const children: LayoutNode[] = [];
  for (const child of value.children) {
    const checked = checkLayout(child);
    if (checked === undefined || checked === null) {
      return undefined;
    }
    children.push(checked);
  }
  // Bad weights are not fatal: normalize gives every child an equal share.
  const sizes = value.sizes.map((size) => (isFiniteNumber(size) ? size : 0));
  return { type: "split", direction: value.direction, children, sizes };
}

/** Check untrusted JSON of the current version. One bad part fails the whole. */
function checkWorkspace(data: Record<string, unknown>): Workspace | null {
  if (!Array.isArray(data.tools) || !isRecord(data.slots)) {
    return null;
  }
  const tools: SavedTool[] = [];
  for (const tool of data.tools) {
    if (
      !isRecord(tool) ||
      typeof tool.instanceId !== "string" ||
      typeof tool.manifestId !== "string"
    ) {
      return null;
    }
    tools.push({ instanceId: tool.instanceId, manifestId: tool.manifestId });
  }
  const slots: Record<string, SavedSlot> = {};
  for (const [id, value] of Object.entries(data.slots)) {
    const slot = checkSlot(value);
    if (slot === null) {
      return null;
    }
    slots[id] = slot;
  }
  const layout = checkLayout(data.layout);
  if (layout === undefined) {
    return null;
  }
  return { version: WORKSPACE_VERSION, tools, slots, layout: normalize(layout) };
}
