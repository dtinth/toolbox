import { useEffect, useRef, useState } from "preact/hooks";
import type { ManifestEntry, Runtime, Toast, ToolInstanceInfo } from "./runtime/index.ts";
import { searchTools } from "./runtime/fuzzy.ts";
import { shouldInterceptClick } from "./app/click.ts";
import { findManifestEntry, runningManifestIds } from "./app/host.ts";

export interface PaletteProps {
  open: boolean;
  manifest: ManifestEntry[];
  runningManifestIds: Set<string>;
  onLaunch: (id: string) => void;
  onClose: () => void;
}

export function Palette({
  open,
  manifest,
  runningManifestIds: running,
  onLaunch,
  onClose,
}: PaletteProps) {
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
    if (item) onLaunch(item.id);
  };

  return (
    <div
      class="fixed inset-0 z-40 flex items-start justify-center pt-32 bg-black/60"
      onClick={onClose}
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
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
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
          }}
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
    <div class="fixed bottom-4 right-4 flex flex-col gap-2 z-50">
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

export interface HostProps {
  runtime: Runtime;
  manifest: ManifestEntry[];
  paletteOpen: boolean;
  onPaletteOpenChange: (open: boolean) => void;
  onLaunch: (id: string) => void;
}

export function Host({ runtime, manifest, paletteOpen, onPaletteOpenChange, onLaunch }: HostProps) {
  const [vnode, setVnode] = useState(() => runtime.render());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [instances, setInstances] = useState<ReadonlyArray<ToolInstanceInfo>>(() =>
    runtime.toolInstances(),
  );

  useEffect(() => {
    const unsubscribe = runtime.subscribe(() => {
      setVnode(runtime.render());
      setToasts(runtime.toasts());
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
        onPaletteOpenChange(!paletteOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      unsubscribe();
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener("keydown", onKey);
    };
  }, [paletteOpen, onPaletteOpenChange]);

  const running = runningManifestIds(instances);

  return (
    <div class="toolbox-host">
      {vnode}
      <ToastLayer toasts={toasts} onDismiss={(id) => runtime.dismissToast(id)} />
      <Palette
        open={paletteOpen}
        manifest={manifest}
        runningManifestIds={running}
        onLaunch={onLaunch}
        onClose={() => onPaletteOpenChange(false)}
      />
    </div>
  );
}

export interface AppProps {
  runtime: Runtime;
  manifest: ManifestEntry[];
  paletteOpen: boolean;
  onPaletteOpenChange: (open: boolean) => void;
  onLaunch: (id: string) => void;
}

export function App(props: AppProps) {
  return <Host {...props} />;
}

export { findManifestEntry };
