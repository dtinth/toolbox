export interface ToastHandle {
  update(opts: { message?: string; loading?: boolean }): void;
  dismiss(): void;
}

export interface Toast {
  id: number;
  message: string;
  loading: boolean;
  createdAt: number;
}

export interface ToastCenter {
  show(
    instanceId: string,
    message: string,
    opts?: { loading?: boolean; duration?: number },
  ): ToastHandle;
  dismiss(id: number): void;
  dismissForInstance(instanceId: string): void;
  list(): Toast[];
  reset(): void;
}

export function createToastCenter({ onChange }: { onChange: () => void }): ToastCenter {
  const toasts: Toast[] = [];
  const instanceToasts = new Map<string, Set<number>>();
  const autoDismissTimers = new Map<number, ReturnType<typeof setTimeout>>();
  let nextToastId = 1;

  function scheduleAutoDismiss(id: number, duration: number) {
    const timer = setTimeout(() => {
      dismissInternal(id);
    }, duration);
    autoDismissTimers.set(id, timer);
  }

  function cancelAutoDismiss(id: number) {
    const timer = autoDismissTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      autoDismissTimers.delete(id);
    }
  }

  function dismissInternal(id: number): void {
    const i = toasts.findIndex((t) => t.id === id);
    if (i < 0) return;
    toasts.splice(i, 1);
    cancelAutoDismiss(id);
    for (const set of instanceToasts.values()) {
      set.delete(id);
    }
    onChange();
  }

  function show(
    instanceId: string,
    message: string,
    opts?: { loading?: boolean; duration?: number },
  ): ToastHandle {
    const id = nextToastId++;
    const loading = opts?.loading ?? false;
    const duration = opts?.duration ?? 2000;
    const toast: Toast = { id, message, loading, createdAt: Date.now() };
    toasts.push(toast);
    if (!instanceToasts.has(instanceId)) {
      instanceToasts.set(instanceId, new Set());
    }
    instanceToasts.get(instanceId)!.add(id);
    if (!loading) scheduleAutoDismiss(id, duration);
    onChange();
    return {
      update(updateOpts) {
        const t = toasts.find((x) => x.id === id);
        if (!t) return;
        if (updateOpts.message !== undefined) t.message = updateOpts.message;
        if (updateOpts.loading !== undefined) {
          t.loading = updateOpts.loading;
          if (updateOpts.loading) {
            cancelAutoDismiss(id);
          } else {
            scheduleAutoDismiss(id, duration);
          }
        }
        onChange();
      },
      dismiss() {
        dismissInternal(id);
      },
    };
  }

  function dismiss(id: number): void {
    dismissInternal(id);
  }

  function dismissForInstance(instanceId: string): void {
    const ids = instanceToasts.get(instanceId);
    if (!ids) return;
    for (const id of Array.from(ids)) {
      dismissInternal(id);
    }
    instanceToasts.delete(instanceId);
  }

  function list(): Toast[] {
    return toasts.slice();
  }

  function reset(): void {
    for (const timer of autoDismissTimers.values()) clearTimeout(timer);
    autoDismissTimers.clear();
    toasts.length = 0;
    instanceToasts.clear();
    nextToastId = 1;
  }

  return { show, dismiss, dismissForInstance, list, reset };
}
