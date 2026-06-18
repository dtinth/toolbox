// Dialog center: owns pending modal dialogs (currently quick picks) that the
// host renders as chrome. Each `pick` returns a Promise the runtime resolves
// when the host reports a selection or dismissal. Mirrors toast-center's
// onChange dependency injection so a pending/resolved pick triggers a redraw.

export interface QuickPickItem {
  label: string;
  description?: string;
  detail?: string;
}

export interface QuickPickOptions {
  title?: string;
  placeholder?: string;
}

export interface Dialog {
  pick: <T extends QuickPickItem>(items: T[], opts?: QuickPickOptions) => Promise<T | undefined>;
}

/** A pending pick, as exposed to the host for rendering (no resolver). */
export interface PickRequest {
  id: number;
  items: QuickPickItem[];
  options: QuickPickOptions;
}

interface InternalRequest extends PickRequest {
  instanceId: string;
  resolve: (value: QuickPickItem | undefined) => void;
}

export interface DialogCenter {
  /** Build the per-instance `dialog` API object for a tool. */
  forInstance(instanceId: string): Dialog;
  /** Pending picks, in creation order, for the host to render. */
  list(): PickRequest[];
  /** Resolve a pick: `index` into the request's items, or `null` to dismiss. */
  resolve(id: number, index: number | null): void;
  /** Dismiss (resolve `undefined`) every pick opened by an instance. */
  cancelForInstance(instanceId: string): void;
  /** Dismiss all pending picks and reset the id counter. */
  reset(): void;
}

export function createDialogCenter({ onChange }: { onChange: () => void }): DialogCenter {
  const requests: InternalRequest[] = [];
  let nextId = 1;

  function pick<T extends QuickPickItem>(
    instanceId: string,
    items: T[],
    opts?: QuickPickOptions,
  ): Promise<T | undefined> {
    return new Promise<T | undefined>((resolvePromise) => {
      const id = nextId++;
      requests.push({
        id,
        instanceId,
        items,
        options: opts ?? {},
        resolve: resolvePromise as (value: QuickPickItem | undefined) => void,
      });
      onChange();
    });
  }

  function take(id: number): InternalRequest | undefined {
    const i = requests.findIndex((r) => r.id === id);
    if (i < 0) return undefined;
    return requests.splice(i, 1)[0];
  }

  function resolve(id: number, index: number | null): void {
    const req = take(id);
    if (!req) return;
    req.resolve(index === null ? undefined : req.items[index]);
    onChange();
  }

  function cancelForInstance(instanceId: string): void {
    const mine = requests.filter((r) => r.instanceId === instanceId);
    if (mine.length === 0) return;
    for (const req of mine) {
      take(req.id);
      req.resolve(undefined);
    }
    onChange();
  }

  function reset(): void {
    const all = requests.splice(0, requests.length);
    for (const req of all) req.resolve(undefined);
    nextId = 1;
    if (all.length > 0) onChange();
  }

  return {
    forInstance(instanceId) {
      return {
        pick: (items, opts) => pick(instanceId, items, opts),
      };
    },
    list: () => requests.map((r) => ({ id: r.id, items: r.items, options: r.options })),
    resolve,
    cancelForInstance,
    reset,
  };
}
