import { useEffect, useRef, useState } from "preact/hooks";
import type {
  ManifestEntry,
  PickRequest,
  Runtime,
  Toast,
  ToolInstanceInfo,
} from "./runtime/index.ts";
import { fuzzyFilter, searchTools } from "./runtime/fuzzy.ts";
import { shouldInterceptClick } from "./app/click.ts";
import { runningManifestIds } from "./app/host.ts";
import { computePaletteVisibility } from "./app/palette-visibility.ts";

export interface PaletteProps {
  open: boolean;
  canClose: boolean;
  manifest: ManifestEntry[];
  runningManifestIds: Set<string>;
  onLaunch: (id: string) => void;
  onClose: () => void;
}

export function Palette({
  open,
  canClose,
  manifest,
  runningManifestIds: running,
  onLaunch,
  onClose,
}: PaletteProps) {
  const closeIfAllowed = () => {
    if (canClose) onClose();
  };
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setHighlight(0);
    } else {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open]);

  if (!open) return null;

  const results = searchTools(query, manifest);
  const items = results;

  const invoke = (index: number) => {
    const item = items[index];
    if (item) {
      onLaunch(item.id);
      closeIfAllowed();
    }
  };

  const handleBackdropClick = () => {
    if (canClose) onClose();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      if (canClose) {
        e.preventDefault();
        onClose();
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (items.length === 0 ? 0 : Math.min(h + 1, items.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      invoke(highlight);
    }
  };

  return (
    <div
      class="fixed inset-0 z-40 flex items-start justify-center pt-32 bg-black/60"
      data-toolbox-chrome
      onClick={handleBackdropClick}
      onKeyDown={(e) => {
        if (e.key === "Escape" && canClose) {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div
        class="bg-toolbox-surface border border-toolbox-border rounded-lg shadow-2xl w-full max-w-xl mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          placeholder="Type to search tools…"
          value={query}
          onInput={(e) => {
            setQuery((e.currentTarget as HTMLInputElement).value);
            setHighlight(0);
          }}
          onKeyDown={handleKeyDown}
          class="w-full px-4 py-3 text-lg border-b border-toolbox-border bg-toolbox-deepest text-toolbox-text placeholder-toolbox-muted outline-none rounded-t-lg"
        />
        <ul class="max-h-80 overflow-y-auto">
          {items.length === 0 ? <li class="p-4 text-toolbox-muted">No matches.</li> : null}
          {items.map((t, i) => {
            const isRunning = running.has(t.id);
            const isActive = i === highlight;
            return (
              <li key={t.id}>
                <a
                  href={`?tool=${encodeURIComponent(t.id)}`}
                  onClick={(e) => {
                    if (shouldInterceptClick(e)) {
                      e.preventDefault();
                      setHighlight(i);
                      onLaunch(t.id);
                      closeIfAllowed();
                    }
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  class={`w-full text-left px-4 py-2 hover:bg-toolbox-content flex items-center gap-2 text-toolbox-text block ${isActive ? "bg-toolbox-content" : ""}`}
                >
                  <span class="flex-1">{t.name}</span>
                  {isRunning ? <span class="text-xs text-toolbox-muted">current</span> : null}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function ToastLayer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div class="fixed bottom-4 right-4 flex flex-col gap-2 z-50" data-toolbox-chrome>
      {toasts.map((t) => (
        <div
          key={t.id}
          class="bg-toolbox-surface border border-toolbox-border text-toolbox-text text-sm rounded-lg shadow-xl px-3 py-2 flex items-center gap-2 min-w-60"
        >
          {t.loading ? (
            <span class="inline-block w-3 h-3 border-2 border-toolbox-accent border-t-transparent rounded-full animate-spin" />
          ) : null}
          <span class="flex-1">{t.message}</span>
          <button
            type="button"
            class="text-toolbox-muted hover:text-toolbox-accent-yellow"
            onClick={() => onDismiss(t.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function PickModal({
  request,
  onResolve,
}: {
  request: PickRequest;
  onResolve: (id: number, index: number | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const indexed = request.items.map((item, i) => ({ item, i }));
  const results = fuzzyFilter(query, indexed, (x) => `${x.item.label} ${x.item.description ?? ""}`);

  const dismiss = () => onResolve(request.id, null);
  const choose = (pos: number) => {
    const hit = results[pos];
    if (hit) onResolve(request.id, hit.i);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      dismiss();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (results.length === 0 ? 0 : Math.min(h + 1, results.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(highlight);
    }
  };

  return (
    <div
      class="fixed inset-0 z-50 flex items-start justify-center pt-32 bg-black/60"
      data-toolbox-chrome
      onClick={dismiss}
    >
      <div
        class="bg-toolbox-surface border border-toolbox-border rounded-lg shadow-2xl w-full max-w-xl mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {request.options.title ? (
          <div class="px-4 pt-3 text-xs text-toolbox-muted">{request.options.title}</div>
        ) : null}
        <input
          ref={inputRef}
          type="text"
          placeholder={request.options.placeholder ?? "Type to filter…"}
          value={query}
          onInput={(e) => {
            setQuery((e.currentTarget as HTMLInputElement).value);
            setHighlight(0);
          }}
          onKeyDown={handleKeyDown}
          class="w-full px-4 py-3 text-lg border-b border-toolbox-border bg-toolbox-deepest text-toolbox-text placeholder-toolbox-muted outline-none rounded-t-lg"
        />
        <ul class="max-h-80 overflow-y-auto">
          {results.length === 0 ? <li class="p-4 text-toolbox-muted">No matches.</li> : null}
          {results.map((hit, i) => {
            const isActive = i === highlight;
            return (
              <li key={hit.i}>
                <button
                  type="button"
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => choose(i)}
                  class={`w-full text-left px-4 py-2 hover:bg-toolbox-content flex flex-col text-toolbox-text ${isActive ? "bg-toolbox-content" : ""}`}
                >
                  <span class="flex items-center gap-2">
                    <span class="flex-1">{hit.item.label}</span>
                    {hit.item.description ? (
                      <span class="text-xs text-toolbox-muted">{hit.item.description}</span>
                    ) : null}
                  </span>
                  {hit.item.detail ? (
                    <span class="text-xs text-toolbox-muted">{hit.item.detail}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function PickLayer({
  picks,
  onResolve,
}: {
  picks: PickRequest[];
  onResolve: (id: number, index: number | null) => void;
}) {
  const active = picks[0];
  if (!active) return null;
  return <PickModal key={active.id} request={active} onResolve={onResolve} />;
}

export interface HostProps {
  runtime: Runtime;
  manifest: ManifestEntry[];
  paletteOpen: boolean;
  onPaletteOpenChange: (open: boolean) => void;
  onLaunch: (id: string) => void;
}

export interface EmbedHostProps {
  runtime: Runtime;
}

export function EmbedHost({ runtime }: EmbedHostProps) {
  const [vnode, setVnode] = useState(() => runtime.render());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [picks, setPicks] = useState<PickRequest[]>(() => runtime.pendingPicks());

  useEffect(() => {
    const unsubscribe = runtime.subscribe(() => {
      setVnode(runtime.render());
      setToasts(runtime.toasts());
      setPicks(runtime.pendingPicks());
    });
    let rafId: number | null = null;
    const loop = () => {
      runtime.tick();
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => {
      unsubscribe();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [runtime]);

  return (
    <div class="toolbox-host fixed inset-0">
      {vnode}
      <ToastLayer toasts={toasts} onDismiss={(id) => runtime.dismissToast(id)} />
      <PickLayer picks={picks} onResolve={(id, index) => runtime.resolvePick(id, index)} />
    </div>
  );
}

export function Host({ runtime, manifest, paletteOpen, onPaletteOpenChange, onLaunch }: HostProps) {
  const [vnode, setVnode] = useState(() => runtime.render());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [picks, setPicks] = useState<PickRequest[]>(() => runtime.pendingPicks());
  const [instances, setInstances] = useState<ReadonlyArray<ToolInstanceInfo>>(() =>
    runtime.toolInstances(),
  );
  const userDismissedRef = useRef(false);
  const paletteOpenRef = useRef(paletteOpen);
  paletteOpenRef.current = paletteOpen;
  const lastInstancesLengthRef = useRef(instances.length);

  useEffect(() => {
    const unsubscribe = runtime.subscribe(() => {
      setVnode(runtime.render());
      setToasts(runtime.toasts());
      setPicks(runtime.pendingPicks());
      setInstances(runtime.toolInstances());
    });
    let rafId: number | null = null;
    const loop = () => {
      runtime.tick();
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (runtime.isEmpty) return;
        userDismissedRef.current = true;
        onPaletteOpenChange(!paletteOpenRef.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      unsubscribe();
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener("keydown", onKey);
    };
  }, [onPaletteOpenChange, runtime]);

  useEffect(() => {
    const prev = lastInstancesLengthRef.current;
    const next = instances.length;
    if (prev > 0 && next === 0) {
      userDismissedRef.current = false;
    }
    lastInstancesLengthRef.current = next;
  }, [instances.length]);

  const running = runningManifestIds(instances);
  const visibility = computePaletteVisibility({
    userToggledOpen: paletteOpen,
    runningCount: instances.length,
    userDismissed: userDismissedRef.current,
  });

  const handleHostClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest("[data-toolbox-window], [data-toolbox-chrome]")) return;
    if (!visibility.isOpen) {
      userDismissedRef.current = true;
      onPaletteOpenChange(true);
    }
  };

  return (
    <div class="toolbox-host fixed inset-0" onClick={handleHostClick}>
      {vnode}
      <ToastLayer toasts={toasts} onDismiss={(id) => runtime.dismissToast(id)} />
      <PickLayer picks={picks} onResolve={(id, index) => runtime.resolvePick(id, index)} />
      <Palette
        open={visibility.isOpen}
        canClose={visibility.canClose}
        manifest={manifest}
        runningManifestIds={running}
        onLaunch={(id) => {
          userDismissedRef.current = true;
          onLaunch(id);
        }}
        onClose={() => {
          userDismissedRef.current = true;
          onPaletteOpenChange(false);
        }}
      />
    </div>
  );
}
