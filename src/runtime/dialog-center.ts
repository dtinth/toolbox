// Dialog center: owns pending modal dialogs (quick picks and input prompts)
// that the host renders as chrome. Each `pick`/`input` returns a Promise the
// runtime resolves when the host reports a selection or dismissal. Mirrors
// toast-center's onChange dependency injection so a pending/resolved dialog
// triggers a redraw.

export interface QuickPickItem {
  label: string;
  description?: string;
  detail?: string;
}

export interface QuickPickOptions {
  title?: string;
  placeholder?: string;
}

export interface InputOptions {
  title?: string;
  placeholder?: string;
}

export interface Dialog {
  pick: <T extends QuickPickItem>(items: T[], opts?: QuickPickOptions) => Promise<T | undefined>;
  input: (opts?: {
    title?: string;
    value?: string;
    placeholder?: string;
  }) => Promise<string | undefined>;
}

/** A pending pick, as exposed to the host for rendering (no resolver). */
export interface PickRequest {
  id: number;
  items: QuickPickItem[];
  options: QuickPickOptions;
}

/** A pending input request, as exposed to the host for rendering (no resolver). */
export interface InputRequest {
  id: number;
  options: InputOptions;
  /** The initial text value to prefill the input. */
  value: string;
}

interface InternalPickRequest extends PickRequest {
  instanceId: string;
  resolve: (value: QuickPickItem | undefined) => void;
}

interface InternalInputRequest extends InputRequest {
  instanceId: string;
  resolve: (value: string | undefined) => void;
}

export interface DialogCenter {
  /** Build the per-instance `dialog` API object for a tool. */
  forInstance: (instanceId: string) => Dialog;
  /** Pending picks, in creation order, for the host to render. */
  list: () => PickRequest[];
  /** Resolve a pick: `index` into the request's items, or `null` to dismiss. */
  resolve: (id: number, index: number | null) => void;
  /** Pending input requests, in creation order, for the host to render. */
  listInputs: () => InputRequest[];
  /** Resolve an input: the entered string, or `null` to dismiss (→ undefined). */
  resolveInput: (id: number, value: string | null) => void;
  /** Dismiss (resolve `undefined`) every pick/input opened by an instance. */
  cancelForInstance: (instanceId: string) => void;
  /** Dismiss all pending picks/inputs and reset the id counter. */
  reset: () => void;
}

export function createDialogCenter({ onChange }: { onChange: () => void }): DialogCenter {
  const requests: InternalPickRequest[] = [];
  const inputRequests: InternalInputRequest[] = [];
  let nextId = 1;

  function pick<T extends QuickPickItem>(
    instanceId: string,
    items: T[],
    opts?: QuickPickOptions,
  ): Promise<T | undefined> {
    return new Promise<T | undefined>((_resolve) => {
      const id = nextId++;
      requests.push({
        id,
        instanceId,
        items,
        options: opts ?? {},
        resolve: _resolve as (value: QuickPickItem | undefined) => void,
      });
      onChange();
    });
  }

  function input(
    instanceId: string,
    opts?: { title?: string; value?: string; placeholder?: string },
  ): Promise<string | undefined> {
    return new Promise<string | undefined>((_resolve) => {
      const id = nextId++;
      inputRequests.push({
        id,
        instanceId,
        value: opts?.value ?? "",
        options: { title: opts?.title, placeholder: opts?.placeholder },
        resolve: _resolve,
      });
      onChange();
    });
  }

  function takePick(id: number): InternalPickRequest | undefined {
    const i = requests.findIndex((r) => r.id === id);
    if (i === -1) {
      return undefined;
    }
    return requests.splice(i, 1)[0];
  }

  function takeInput(id: number): InternalInputRequest | undefined {
    const i = inputRequests.findIndex((r) => r.id === id);
    if (i === -1) {
      return undefined;
    }
    return inputRequests.splice(i, 1)[0];
  }

  function resolve(id: number, index: number | null): void {
    const req = takePick(id);
    if (!req) {
      return;
    }
    req.resolve(index === null ? undefined : req.items[index]);
    onChange();
  }

  function resolveInput(id: number, value: string | null): void {
    const req = takeInput(id);
    if (!req) {
      return;
    }
    req.resolve(value ?? undefined);
    onChange();
  }

  function cancelForInstance(instanceId: string): void {
    const minePicks = requests.filter((r) => r.instanceId === instanceId);
    const mineInputs = inputRequests.filter((r) => r.instanceId === instanceId);
    if (minePicks.length === 0 && mineInputs.length === 0) {
      return;
    }
    for (const req of minePicks) {
      takePick(req.id);
      req.resolve(undefined);
    }
    for (const req of mineInputs) {
      takeInput(req.id);
      req.resolve(undefined);
    }
    onChange();
  }

  function reset(): void {
    const allPicks = requests.splice(0);
    const allInputs = inputRequests.splice(0);
    for (const req of allPicks) {
      req.resolve(undefined);
    }
    for (const req of allInputs) {
      req.resolve(undefined);
    }
    nextId = 1;
    if (allPicks.length > 0 || allInputs.length > 0) {
      onChange();
    }
  }

  return {
    forInstance(instanceId) {
      return {
        pick: (items, opts) => pick(instanceId, items, opts),
        input: (opts) => input(instanceId, opts),
      };
    },
    list: () => requests.map((r) => ({ id: r.id, items: r.items, options: r.options })),
    resolve,
    listInputs: () => inputRequests.map((r) => ({ id: r.id, value: r.value, options: r.options })),
    resolveInput,
    cancelForInstance,
    reset,
  };
}
