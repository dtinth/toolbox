import { useEffect, useRef, useState } from "preact/hooks";
import type {
  ManifestEntry,
  PickRequest,
  QuickPickItem,
  Runtime,
  Toast,
  ToolInstanceInfo,
} from "./runtime/index.ts";
import { fuzzyFilter, searchTools } from "./runtime/fuzzy.ts";
import { shouldInterceptClick } from "./app/click.ts";
import { runningManifestIds } from "./app/host.ts";
import { computePaletteVisibility } from "./app/palette-visibility.ts";
import { FilterableList } from "./app/filterable-list.tsx";

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
  if (!open) return null;

  const launch = (id: string) => {
    onLaunch(id);
    if (canClose) onClose();
  };

  return (
    <FilterableList<ManifestEntry>
      filter={(query) => searchTools(query, manifest)}
      itemKey={(t) => t.id}
      canDismiss={canClose}
      selectOnFocus
      placeholder="Type to search tools…"
      onChoose={(t) => launch(t.id)}
      onDismiss={onClose}
      renderItem={(t, { active, choose }) => (
        // An <a> so cmd/ctrl/middle-click open the tool in a new tab natively;
        // a plain left-click is intercepted and launches in place.
        <a
          href={`?tool=${encodeURIComponent(t.id)}`}
          onClick={(e) => {
            if (shouldInterceptClick(e)) {
              e.preventDefault();
              choose();
            }
          }}
          class={`w-full text-left px-4 py-2 hover:bg-toolbox-content flex items-center gap-2 text-toolbox-text block ${active ? "bg-toolbox-content" : ""}`}
        >
          <span class="flex-1">{t.name}</span>
          {running.has(t.id) ? <span class="text-xs text-toolbox-muted">current</span> : null}
        </a>
      )}
    />
  );
}

function ToastLayer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div class="fixed bottom-4 right-4 flex flex-col gap-2 z-50" data-toolbox-chrome>
      {toasts.map((t) => {
        const isError = t.intent === "error";
        const determinate = t.progress !== undefined;
        return (
          <div
            key={t.id}
            class={`bg-toolbox-surface border text-toolbox-text text-sm rounded-lg shadow-xl px-3 py-2 flex flex-col gap-1.5 min-w-60 ${
              isError ? "border-red-500/60" : "border-toolbox-border"
            }`}
          >
            <div class="flex items-center gap-2">
              {isError ? (
                <span class="text-red-400">⚠</span>
              ) : t.loading && !determinate ? (
                <span class="inline-block w-3 h-3 border-2 border-toolbox-accent border-t-transparent rounded-full animate-spin" />
              ) : null}
              <span class={`flex-1 ${isError ? "text-red-300" : ""}`}>{t.message}</span>
              <button
                type="button"
                class="text-toolbox-muted hover:text-toolbox-accent-yellow"
                onClick={() => onDismiss(t.id)}
              >
                ×
              </button>
            </div>
            {determinate ? (
              <div class="h-1 w-full bg-toolbox-deepest rounded overflow-hidden">
                <div
                  class="h-full bg-toolbox-accent transition-[width] duration-150"
                  style={{ width: `${Math.max(0, Math.min(100, t.progress ?? 0))}%` }}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

interface IndexedItem {
  item: QuickPickItem;
  i: number;
}

function PickModal({
  request,
  onResolve,
}: {
  request: PickRequest;
  onResolve: (id: number, index: number | null) => void;
}) {
  const indexed: IndexedItem[] = request.items.map((item, i) => ({ item, i }));

  return (
    <FilterableList<IndexedItem>
      overlayZClass="z-50"
      title={request.options.title}
      placeholder={request.options.placeholder ?? "Type to filter…"}
      filter={(query) =>
        fuzzyFilter(query, indexed, (x) => `${x.item.label} ${x.item.description ?? ""}`)
      }
      itemKey={(x) => x.i}
      onChoose={(x) => onResolve(request.id, x.i)}
      onDismiss={() => onResolve(request.id, null)}
      renderItem={(x, { active, choose }) => (
        <button
          type="button"
          onClick={choose}
          class={`w-full text-left px-4 py-2 hover:bg-toolbox-content flex flex-col text-toolbox-text ${active ? "bg-toolbox-content" : ""}`}
        >
          <span class="flex items-center gap-2">
            <span class="flex-1">{x.item.label}</span>
            {x.item.description ? (
              <span class="text-xs text-toolbox-muted">{x.item.description}</span>
            ) : null}
          </span>
          {x.item.detail ? <span class="text-xs text-toolbox-muted">{x.item.detail}</span> : null}
        </button>
      )}
    />
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
    // The animation loop runs only while a tool has a tick subscriber; an idle
    // toolbox does no per-frame work.
    let rafId: number | null = null;
    const loop = () => {
      runtime.tick();
      rafId = runtime.hasTickSubscribers() ? requestAnimationFrame(loop) : null;
    };
    const ensureTicking = () => {
      if (rafId === null && runtime.hasTickSubscribers()) rafId = requestAnimationFrame(loop);
    };
    const unsubscribe = runtime.subscribe(() => {
      setVnode(runtime.render());
      setToasts(runtime.toasts());
      setPicks(runtime.pendingPicks());
      ensureTicking();
    });
    ensureTicking();
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
    // The animation loop runs only while a tool has a tick subscriber; an idle
    // toolbox does no per-frame work.
    let rafId: number | null = null;
    const loop = () => {
      runtime.tick();
      rafId = runtime.hasTickSubscribers() ? requestAnimationFrame(loop) : null;
    };
    const ensureTicking = () => {
      if (rafId === null && runtime.hasTickSubscribers()) rafId = requestAnimationFrame(loop);
    };
    const unsubscribe = runtime.subscribe(() => {
      setVnode(runtime.render());
      setToasts(runtime.toasts());
      setPicks(runtime.pendingPicks());
      setInstances(runtime.toolInstances());
      ensureTicking();
    });
    ensureTicking();
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

  const openPalette = () => {
    userDismissedRef.current = true;
    onPaletteOpenChange(true);
  };

  return (
    <div class="toolbox-host fixed inset-0">
      {vnode}
      <ToastLayer toasts={toasts} onDismiss={(id) => runtime.dismissToast(id)} />
      <PickLayer picks={picks} onResolve={(id, index) => runtime.resolvePick(id, index)} />
      {!visibility.isOpen ? (
        <button
          type="button"
          data-toolbox-chrome
          aria-label="Open launcher"
          title="Launch a tool (⌘K)"
          class="fixed bottom-4 right-4 z-40 w-12 h-12 rounded-full bg-toolbox-accent text-toolbox-deepest text-2xl leading-none shadow-xl flex items-center justify-center hover:bg-toolbox-accent-yellow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focused"
          onClick={openPalette}
        >
          +
        </button>
      ) : null}
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
