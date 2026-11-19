import { collect, ui, type ChildNode, type Node, type Ui, type WindowNode } from "./collector.ts";
import { preactApi } from "./preact-api.ts";
import { tw } from "./tw.ts";
import { toPreact, toPreactInstance } from "./renderer.tsx";
import {
  createDockController,
  type DockDrag,
  type DockTarget,
  type LayoutNode,
} from "./dock-controller.ts";
import type { Preact, WindowPersistence } from "../../api.d.ts";
import { type VNode } from "preact";
import {
  createWindowManager,
  instancePrefix,
  scopeId,
  type Arrangement,
  type WindowManager,
  type Slot,
} from "./window-manager.ts";
import { createToastCenter, type Toast, type ToastHandle } from "./toast-center.ts";
import {
  createDialogCenter,
  type Dialog,
  type InputRequest,
  type PickRequest,
} from "./dialog-center.ts";

export type { Arrangement, SavedSlot, Slot } from "./window-manager.ts";
export type { Toast, ToastHandle } from "./toast-center.ts";
export type {
  Dialog,
  InputOptions,
  InputRequest,
  PickRequest,
  QuickPickItem,
  QuickPickOptions,
} from "./dialog-center.ts";

export interface Progress {
  report: (value: { message?: string; increment?: number }) => void;
}

export interface ProgressOptions {
  title: string;
}

export interface Api {
  onRender: () => void;
  ui: Ui;
  preact: Preact;
  tw: (
    strings: TemplateStringsArray,
    ...exprs: (string | number | false | null | undefined)[]
  ) => string;
  requestUpdate: () => void;
  tick: (cb: () => void) => () => void;
  toast: {
    show: (message: string, opts?: { loading?: boolean; duration?: number }) => ToastHandle;
  };
  dialog: Dialog;
  withProgress: <T>(
    options: ProgressOptions,
    task: (progress: Progress) => Promise<T>,
  ) => Promise<T>;
  dispose: () => void;
}

export interface ToolInstanceInfo {
  instanceId: string;
  manifestId: string;
  name: string;
}

export type { DockDrag } from "./dock-controller.ts";

export interface Runtime {
  launchTool: (opts: {
    /**
     * Adopt this id instead of minting one. Restoring a workspace passes the
     * saved id so its `${instanceId}::${originalId}` slot keys still resolve.
     * Throws if the id is already in use.
     */
    instanceId?: string;
    manifestId: string;
    name: string;
    loader?: (api: Api) => void;
  }) => ToolInstanceInfo;
  initializeTool: (instanceId: string, loader: (api: Api) => void) => void;
  isLoading: (instanceId: string) => boolean;
  closeTool: (instanceId: string) => void;
  toolInstances: () => readonly ToolInstanceInfo[];
  readonly isEmpty: boolean;
  render: () => VNode;
  /** Render a single instance into its own root (ADR-0008); null once gone. */
  renderInstance: (instanceId: string) => VNode | null;
  requestUpdate: () => void;
  subscribe: (onChange: () => void) => () => void;
  tick: () => void;
  hasTickSubscribers: () => boolean;
  toasts: () => Toast[];
  dismissToast: (id: number) => void;
  pendingPicks: () => PickRequest[];
  resolvePick: (id: number, index: number | null) => void;
  pendingInputs: () => InputRequest[];
  resolveInput: (id: number, value: string | null) => void;
  slots: ReadonlyMap<string, Slot>;
  focusWindow: (id: string) => void;
  moveWindow: (id: string, x: number, y: number) => void;
  resizeWindow: (id: string, width: number, height: number) => void;
  activeWindowId: string | null;
  /**
   * Turn docking on. Off by default, so a host that draws no Layout — the
   * embed host — never has a Window dock into a tree nobody can see.
   */
  setDockingEnabled: (enabled: boolean) => void;
  /** The Layout tree the docked Windows sit in, or null when nothing is docked. */
  readonly layout: LayoutNode | null;
  /** Replace the tree: after a divider drag, or a click on a tab. */
  setLayout: (next: LayoutNode | null) => void;
  /** Dock a Window, or move a docked one. */
  dockWindow: (id: string, target: DockTarget) => void;
  /** Float a docked Window: at `at`, or where it last floated. */
  undockWindow: (id: string, at?: { x: number; y: number }) => void;
  /** The title a Window drew last, for its tab. Falls back to the id. */
  windowTitle: (id: string) => string;
  /** Close a Window the way its own close button would, if it has one. */
  closeWindow: (id: string) => void;
  /** Whether a Window has a close button. */
  canCloseWindow: (id: string) => boolean;
  /** Whether a Window is drawn right now. A dormant one is not. */
  isWindowPresent: (id: string) => boolean;
  /** The drag in progress, for the overlay. */
  readonly dockDrag: DockDrag | null;
  /** Follow a drag: the pointer is at x, y in the viewport. */
  dockDragMove: (id: string, x: number, y: number) => void;
  /**
   * End a drag. With `commit`, a drop on a button docks the Window. Returns
   * the target it dropped on, or null when it was let go over nothing (or the
   * drag was cancelled).
   */
  dockDragEnd: (commit: boolean) => DockTarget | null;
  /** Be told when the drag changes. Kept apart from `subscribe`, which redraws every tool. */
  subscribeDockDrag: (onChange: () => void) => () => void;
  /**
   * A copy of the Slots and the Layout tree, for a Workspace to store. Only the
   * Slots each window's persistence policy lets through (issue #28).
   */
  arrangement: () => Arrangement;
  /**
   * Take a saved arrangement before its tools launch. Each Slot waits, dormant,
   * for the tool whose instance id it names. Pass the same ids to `launchTool`.
   */
  adoptArrangement: (saved: Arrangement) => void;
  /**
   * Be told when the arrangement changes — including a move, which redraws
   * nothing and so never reaches `subscribe`. Called often; debounce it.
   */
  subscribeArrangement: (onChange: () => void) => () => void;
  dispose: () => void;
  readonly disposed: boolean;
}

export interface TestRuntime extends Runtime {
  loadTool: (init: (api: Api) => void) => void;
  lastButton: () => Extract<Node, { kind: "button" }>;
  updateCount: number;
  windowTree: readonly WindowNode[];
}

function findLastButton(windows: WindowNode[]): Extract<Node, { kind: "button" }> | null {
  let last: Extract<Node, { kind: "button" }> | null = null;
  function walk(nodes: ChildNode[]) {
    for (const child of nodes) {
      if (child.kind === "button") {
        last = child;
      } else if (child.kind === "window") {
        walk(child.children);
      } else if (child.kind === "row") {
        walk(child.children);
      }
    }
  }
  walk(windows);
  return last;
}

interface ToolInstance {
  info: ToolInstanceInfo;
  onRender: () => void;
  api: Api;
  tickSubscribers: Set<() => void>;
  state: "loading" | "ready";
  // Per-instance render isolation (ADR-0008): `dirty` marks that this instance's
  // declarator must be re-run; `cache` holds its last collected (scoped) windows
  // so a redraw of one instance never re-runs another's onRender.
  dirty: boolean;
  cache: WindowNode[] | null;
}

// Run one instance's declarator and return its scoped windows. Loading
// instances render a spinner placeholder. `api.ui` is the stable collector
// `ui`; `collect` installs the collection context for the duration of the
// declarator, so `ui.*` works here and throws anywhere else. Returning
// onRender's result lets collect reject a Promise-returning (async) declarator.
function collectInstance(instance: ToolInstance): WindowNode[] {
  const instanceId = instance.info.instanceId;
  if (instance.state === "loading") {
    return [
      {
        kind: "window",
        id: scopeId(instanceId, "__main__"),
        title: instance.info.name,
        children: [{ kind: "spinner" }],
        menus: [],
        onClose: () => {
          instance.api.dispose();
        },
      },
    ];
  }
  // Forward onRender's runtime value (declared `void`, widened to `unknown`)
  // so collect can still reject an accidentally-async declarator.
  const render = instance.onRender as () => unknown;
  const windows = collect(() => render(), { pick: instance.api.dialog.pick });
  return windows.map((w) => {
    const originalId = w.id;
    w.id = scopeId(instanceId, originalId);
    if (originalId === "__main__" && !w.onClose) {
      w.onClose = () => {
        instance.api.dispose();
      };
    }
    return w;
  });
}

function build(): TestRuntime {
  const instances = new Map<string, ToolInstance>();
  const instanceOrder: string[] = [];
  let lastButtonRef: Extract<Node, { kind: "button" }> | null = null;
  let lastTree: WindowNode[] = [];
  let updates = 0;
  let pendingRender = false;
  const subscribers = new Set<() => void>();
  const arrangementSubscribers = new Set<() => void>();
  const wm: WindowManager = createWindowManager(() => {
    for (const sub of arrangementSubscribers) {
      sub();
    }
  });
  let disposed = false;
  const docking = createDockController(wm, () => {
    requestUpdate();
  });
  let dockingEnabled = false;
  /** What each Window drew last: its title, and how to close it. */
  const windowInfo = new Map<
    string,
    { title: string; onClose?: () => void; persistence?: WindowPersistence }
  >();

  function remember(windows: WindowNode[]): void {
    for (const w of windows) {
      windowInfo.set(w.id, {
        title: w.title || w.id,
        onClose: w.onClose,
        persistence: w.persistence,
      });
    }
  }

  /**
   * Whether a saved Workspace keeps this Slot (issue #28). A window keeps the
   * policy it last drew with, so a dormant one is still judged by its own word.
   */
  function persists(id: string, slot: Slot): boolean {
    const info = windowInfo.get(id);
    if (info === undefined) {
      // Never drawn on this page. While its tool is still loading, or not
      // launched yet, this is a restored Slot waiting for its window: keep it.
      const instanceId = id.slice(0, id.indexOf("::"));
      if (instances.get(instanceId)?.state !== "ready") {
        return true;
      }
    }
    const policy = info?.persistence ?? (id.endsWith("::__main__") ? "always" : "onlyOpen");
    return policy === "always" || (policy === "onlyOpen" && slot.present);
  }

  const toastCenter = createToastCenter({
    onChange: () => {
      requestUpdate();
    },
  });

  const dialogCenter = createDialogCenter({
    onChange: () => {
      requestUpdate();
    },
  });

  function notify() {
    for (const sub of subscribers) {
      sub();
    }
  }

  function buildApi(instance: ToolInstance): Api {
    const api: Api = {
      onRender: () => {},
      ui,
      preact: preactApi,
      tw,
      requestUpdate: () => {
        instance.dirty = true;
        updates++;
        scheduleRender();
      },
      tick(cb: () => void) {
        instance.tickSubscribers.add(cb);
        return () => {
          instance.tickSubscribers.delete(cb);
        };
      },
      toast: {
        show: (message, opts) => toastCenter.show(instance.info.instanceId, message, opts),
      },
      dialog: dialogCenter.forInstance(instance.info.instanceId),
      withProgress: async (options, task) => {
        const instanceId = instance.info.instanceId;
        const handle = toastCenter.show(instanceId, options.title, { loading: true });
        let current = 0;
        const progress: Progress = {
          report({ message, increment }) {
            if (increment !== undefined) {
              current = Math.max(0, Math.min(100, current + increment));
              handle.update({ progress: current, message });
            } else if (message !== undefined) {
              handle.update({ message });
            }
          },
        };
        try {
          const result = await task(progress);
          handle.dismiss();
          return result;
        } catch (error) {
          handle.dismiss();
          const message = error instanceof Error ? error.message : String(error);
          toastCenter.show(instanceId, `${options.title}: ${message}`, {
            intent: "error",
            duration: 6000,
          });
          throw error;
        }
      },
      dispose: () => {
        closeTool(instance.info.instanceId);
      },
    };
    Object.defineProperty(api, "onRender", {
      get: () => instance.onRender,
      set: (fn: () => void) => {
        instance.onRender = fn;
      },
      configurable: true,
      enumerable: true,
    });
    return api;
  }

  function launchTool(opts: {
    instanceId?: string;
    manifestId: string;
    name: string;
    loader?: (api: Api) => void;
  }): ToolInstanceInfo {
    // Opaque and random, never sequential: a saved workspace stores these ids in
    // its slot keys, so a fresh session must not be able to mint one that
    // collides with a saved one and seat a window in the wrong tool's slot.
    const instanceId = opts.instanceId ?? crypto.randomUUID();
    if (instances.has(instanceId)) {
      throw new Error(`instanceId already in use: ${instanceId}`);
    }
    const info: ToolInstanceInfo = {
      instanceId,
      manifestId: opts.manifestId,
      name: opts.name,
    };
    const instance: ToolInstance = {
      info,
      onRender: () => {},
      api: undefined as unknown as Api,
      tickSubscribers: new Set(),
      state: opts.loader ? "ready" : "loading",
      dirty: true,
      cache: null,
    };
    const api = buildApi(instance);
    instance.api = api;
    instances.set(instanceId, instance);
    instanceOrder.push(instanceId);
    disposed = false;
    if (opts.loader) {
      opts.loader(api);
    }
    scheduleRender();
    return info;
  }

  function initializeTool(instanceId: string, loader: (api: Api) => void): void {
    const instance = instances.get(instanceId);
    if (!instance) {
      return;
    }
    if (instance.state === "ready") {
      return;
    }
    instance.state = "ready";
    instance.dirty = true;
    loader(instance.api);
    scheduleRender();
  }

  function closeTool(instanceId: string): void {
    const instance = instances.get(instanceId);
    if (!instance) {
      return;
    }
    toastCenter.dismissForInstance(instanceId);
    dialogCenter.cancelForInstance(instanceId);
    instance.tickSubscribers.clear();
    wm.forget(instancePrefix(instanceId));
    for (const id of windowInfo.keys()) {
      if (id.startsWith(instancePrefix(instanceId))) {
        windowInfo.delete(id);
      }
    }
    instances.delete(instanceId);
    const orderIdx = instanceOrder.indexOf(instanceId);
    if (orderIdx !== -1) {
      instanceOrder.splice(orderIdx, 1);
    }
    if (instanceOrder.length === 0) {
      disposed = true;
      wm.reset();
    }
    scheduleRender();
  }

  // The isolation core: re-collect only when the instance is dirty (or has no
  // cache yet); otherwise reuse the cached windows so this instance's onRender
  // is not re-run for another instance's redraw.
  function instanceWindows(instance: ToolInstance): WindowNode[] {
    if (!instance.dirty && instance.cache) {
      return instance.cache;
    }
    const windows = collectInstance(instance);
    instance.cache = windows;
    instance.dirty = false;
    return windows;
  }

  // Combined composition (single root) — used by tests and as a fallback path.
  function renderOnce(): VNode {
    const allWindows: WindowNode[] = [];
    for (const instanceId of instanceOrder) {
      const instance = instances.get(instanceId);
      if (!instance) {
        continue;
      }
      allWindows.push(...instanceWindows(instance));
    }
    lastTree = allWindows;
    lastButtonRef = findLastButton(allWindows);
    wm.place(allWindows.map((w) => w.id));
    remember(allWindows);
    const active = wm.activeId();
    return toPreact(
      allWindows,
      wm.slots,
      active,
      focusWindow,
      moveWindow,
      resizeWindow,
      dockingEnabled ? docking.context : undefined,
    );
  }

  // Per-instance composition (one Preact root per instance, ADR-0008). Returns
  // that instance's windows as a fragment for the host to mount into the
  // instance's own container; null once the instance is gone.
  function renderInstance(instanceId: string): VNode | null {
    const instance = instances.get(instanceId);
    if (!instance) {
      return null;
    }
    const windows = instanceWindows(instance);
    // Keep lastTree/lastButton coherent for callers that only drive per-instance
    // rendering; placement is idempotent per id. Scope the dormancy sweep to
    // this instance — these are the only windows this call speaks for, and an
    // unscoped sweep would declare every other instance's windows dormant.
    wm.place(
      windows.map((w) => w.id),
      instancePrefix(instanceId),
    );
    remember(windows);
    const active = wm.activeId();
    return toPreactInstance(
      windows,
      wm.slots,
      active,
      focusWindow,
      moveWindow,
      resizeWindow,
      dockingEnabled ? docking.context : undefined,
    );
  }

  function requestUpdate(): void {
    updates++;
    scheduleRender();
  }

  function scheduleRender(): void {
    if (pendingRender) {
      return;
    }
    pendingRender = true;
    queueMicrotask(() => {
      pendingRender = false;
      if (instanceOrder.length > 0) {
        renderOnce();
      }
      notify();
    });
  }

  function fireTicks(): boolean {
    let fired = false;
    for (const instanceId of instanceOrder) {
      const instance = instances.get(instanceId);
      if (!instance) {
        continue;
      }
      for (const subscriber of instance.tickSubscribers) {
        subscriber();
        fired = true;
        // A tick is an animation frame for this instance — re-collect it.
        instance.dirty = true;
      }
    }
    return fired;
  }

  function hasTickSubscribers(): boolean {
    for (const instanceId of instanceOrder) {
      if ((instances.get(instanceId)?.tickSubscribers.size ?? 0) > 0) {
        return true;
      }
    }
    return false;
  }

  function focusWindow(id: string) {
    if (wm.focus(id)) {
      requestUpdate();
    }
  }

  function moveWindow(id: string, x: number, y: number) {
    wm.move(id, x, y);
  }

  // Unlike moveWindow this does need a redraw. The handle sets width/height on
  // the element live, but an unsized window also carries a `min-w-72` floor in
  // its class — and a floor of 288px silently wins over an inline width of 200.
  // Only a re-render drops that class, so the first resize below the floor does
  // nothing at all without this.
  function resizeWindow(id: string, width: number, height: number) {
    wm.resize(id, width, height);
    requestUpdate();
  }

  return {
    loadTool(loader) {
      for (const id of instances.keys()) {
        closeTool(id);
      }
      toastCenter.reset();
      dialogCenter.reset();
      wm.reset();
      lastTree = [];
      launchTool({
        manifestId: "__loaded__",
        name: "Loaded",
        loader,
      });
    },
    launchTool,
    initializeTool,
    isLoading: (instanceId: string) => instances.get(instanceId)?.state === "loading",
    closeTool,
    toolInstances: () => instanceOrder.map((id) => instances.get(id)!.info),
    get isEmpty() {
      return instanceOrder.length === 0;
    },
    render: renderOnce,
    renderInstance,
    requestUpdate,
    subscribe(onChange) {
      subscribers.add(onChange);
      return () => {
        subscribers.delete(onChange);
      };
    },
    lastButton: () => {
      if (!lastButtonRef) {
        throw new Error("no button was rendered");
      }
      return lastButtonRef;
    },
    tick: () => {
      // Only redraw when a tick actually fired — keeps an idle toolbox (no
      // animating tools) from re-rendering every animation frame.
      if (fireTicks()) {
        requestUpdate();
      }
    },
    hasTickSubscribers,
    toasts: () => toastCenter.list(),
    dismissToast: (id) => {
      toastCenter.dismiss(id);
    },
    pendingPicks: () => dialogCenter.list(),
    resolvePick: (id, index) => {
      dialogCenter.resolve(id, index);
    },
    pendingInputs: () => dialogCenter.listInputs(),
    resolveInput: (id, value) => {
      dialogCenter.resolveInput(id, value);
    },
    get updateCount() {
      return updates;
    },
    get slots() {
      return wm.slots;
    },
    focusWindow,
    moveWindow,
    resizeWindow,
    get activeWindowId() {
      return wm.activeId();
    },
    setDockingEnabled: (enabled) => {
      dockingEnabled = enabled;
      requestUpdate();
    },
    get layout() {
      return wm.layout;
    },
    setLayout: (next) => {
      wm.setLayout(next);
      requestUpdate();
    },
    dockWindow: docking.dock,
    undockWindow: docking.undock,
    windowTitle: (id) => windowInfo.get(id)?.title ?? id,
    closeWindow: (id) => {
      windowInfo.get(id)?.onClose?.();
    },
    canCloseWindow: (id) => windowInfo.get(id)?.onClose !== undefined,
    isWindowPresent: (id) => wm.slots.get(id)?.present ?? false,
    get dockDrag() {
      return docking.drag;
    },
    dockDragMove: docking.move,
    dockDragEnd: docking.end,
    subscribeDockDrag: docking.subscribe,
    arrangement: () => wm.arrangement(persists),
    adoptArrangement: (saved) => {
      wm.adopt(saved);
      requestUpdate();
    },
    subscribeArrangement(onChange) {
      arrangementSubscribers.add(onChange);
      return () => {
        arrangementSubscribers.delete(onChange);
      };
    },
    get windowTree() {
      return lastTree as readonly WindowNode[];
    },
    dispose: () => {
      for (const id of instances.keys()) {
        closeTool(id);
      }
      requestUpdate();
    },
    get disposed() {
      return disposed;
    },
  };
}

export function createRuntime(): Runtime {
  return build();
}

export function createTestRuntime(): TestRuntime {
  return build();
}
