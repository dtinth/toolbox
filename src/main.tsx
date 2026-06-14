import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import "./app.css";
import { createRuntime, type Toast } from "./runtime/index.ts";

interface ManifestEntry {
  id: string;
  name: string;
  description?: string;
}

function getToolFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("tool");
}

function ToastLayer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div class="fixed bottom-4 right-4 flex flex-col gap-2 z-50">
      {toasts.map((t) => (
        <div
          key={t.id}
          class="bg-neutral-800 text-white text-sm rounded shadow-lg px-3 py-2 flex items-center gap-2 min-w-60"
        >
          {t.loading ? (
            <span class="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : null}
          <span class="flex-1">{t.message}</span>
          <button
            type="button"
            class="text-white/70 hover:text-white"
            onClick={() => onDismiss(t.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function Launcher({
  manifest,
  onPick,
}: {
  manifest: ManifestEntry[];
  onPick: (id: string) => void;
}) {
  return (
    <div class="fixed inset-0 flex items-center justify-center p-4">
      <div class="w-full max-w-2xl">
        <h1 class="text-2xl font-semibold mb-4 text-neutral-800">Toolbox</h1>
        <ul class="flex flex-col gap-2">
          {manifest.map((t) => (
            <li>
              <button
                type="button"
                onClick={() => onPick(t.id)}
                class="w-full text-left rounded-lg border bg-white p-4 hover:bg-neutral-50 transition-colors"
              >
                <div class="font-semibold text-neutral-800">{t.name}</div>
                {t.description ? (
                  <div class="text-sm text-neutral-500 mt-1">{t.description}</div>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Palette({
  open,
  manifest,
  currentId,
  onPick,
  onClose,
}: {
  open: boolean;
  manifest: ManifestEntry[];
  currentId: string | null;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);
  if (!open) return null;
  const lower = query.toLowerCase();
  const filtered = manifest.filter(
    (t) => t.name.toLowerCase().includes(lower) || t.id.toLowerCase().includes(lower),
  );
  return (
    <div
      class="fixed inset-0 z-40 flex items-start justify-center pt-32 bg-black/30"
      onClick={onClose}
    >
      <div
        class="bg-white rounded-lg shadow-2xl w-full max-w-xl mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="text"
          autofocus
          placeholder="Type to search tools…"
          value={query}
          onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter" && filtered[0]) onPick(filtered[0].id);
          }}
          class="w-full px-4 py-3 text-lg border-b outline-none"
        />
        <ul class="max-h-80 overflow-y-auto">
          {filtered.length === 0 ? <li class="p-4 text-neutral-500">No matches.</li> : null}
          {filtered.map((t) => (
            <li>
              <button
                type="button"
                onClick={() => onPick(t.id)}
                class={`w-full text-left px-4 py-2 hover:bg-neutral-100 flex items-center gap-2 ${t.id === currentId ? "bg-neutral-50" : ""}`}
              >
                <span class="flex-1">{t.name}</span>
                {t.id === currentId ? <span class="text-xs text-neutral-400">current</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

async function bootstrap() {
  const toolFromUrl = getToolFromUrl();

  const manifestRes = await fetch("/tools.json");
  const manifest = (await manifestRes.json()) as { tools: ManifestEntry[] };

  if (!toolFromUrl) {
    const root = document.getElementById("app")!;
    render(
      <Launcher
        manifest={manifest.tools}
        onPick={(id) => {
          window.location.search = `?tool=${encodeURIComponent(id)}`;
        }}
      />,
      root,
    );
    return;
  }

  const mod = (await import(/* @vite-ignore */ `/tools/${toolFromUrl}/index.js`)) as {
    default: Parameters<ReturnType<typeof createRuntime>["loadTool"]>[0];
  };

  const runtime = createRuntime();
  runtime.loadTool(mod.default);
  const initial = runtime.render();

  function Host() {
    const [vnode, setVnode] = useState(initial);
    const [toasts, setToasts] = useState<Toast[]>([]);
    const [paletteOpen, setPaletteOpen] = useState(false);
    useEffect(() => {
      const unsubscribe = runtime.subscribe(() => {
        setVnode(runtime.render());
        setToasts(runtime.toasts());
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
          setPaletteOpen((v) => !v);
        }
      };
      window.addEventListener("keydown", onKey);
      return () => {
        unsubscribe();
        if (rafId !== null) cancelAnimationFrame(rafId);
        window.removeEventListener("keydown", onKey);
      };
    }, []);
    return (
      <div class="toolbox-host">
        {vnode}
        <ToastLayer toasts={toasts} onDismiss={(id) => runtime.dismissToast(id)} />
        <Palette
          open={paletteOpen}
          manifest={manifest.tools}
          currentId={toolFromUrl}
          onPick={(id) => {
            window.location.search = `?tool=${encodeURIComponent(id)}`;
          }}
          onClose={() => setPaletteOpen(false)}
        />
      </div>
    );
  }

  render(<Host />, document.getElementById("app")!);
}

void bootstrap();
