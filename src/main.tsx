import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import "./app.css";
import { createRuntime, type Toast } from "./runtime/index.ts";

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

async function bootstrap() {
  const toolFromUrl = getToolFromUrl();

  const manifestRes = await fetch("/tools.json");
  const manifest = (await manifestRes.json()) as {
    tools: { id: string; name: string }[];
  };

  const toolId = toolFromUrl ?? manifest.tools[0]?.id;
  if (!toolId) {
    const root = document.getElementById("app")!;
    root.innerHTML = '<div class="p-8 text-neutral-500">No tools in manifest.</div>';
    return;
  }

  const mod = (await import(/* @vite-ignore */ `/tools/${toolId}/index.js`)) as {
    default: Parameters<ReturnType<typeof createRuntime>["loadTool"]>[0];
  };

  const runtime = createRuntime();
  runtime.loadTool(mod.default);
  const initial = runtime.render();

  function Host() {
    const [vnode, setVnode] = useState(initial);
    const [toasts, setToasts] = useState<Toast[]>([]);
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
      return () => {
        unsubscribe();
        if (rafId !== null) cancelAnimationFrame(rafId);
      };
    }, []);
    return (
      <div class="toolbox-host">
        {vnode}
        <ToastLayer toasts={toasts} onDismiss={(id) => runtime.dismissToast(id)} />
      </div>
    );
  }

  render(<Host />, document.getElementById("app")!);
}

void bootstrap();
