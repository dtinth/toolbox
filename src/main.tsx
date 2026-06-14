import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import "./app.css";
import { createRuntime } from "./runtime/index.ts";

function getToolFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("tool");
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
    useEffect(() => {
      const unsubscribe = runtime.subscribe(() => {
        setVnode(runtime.render());
      });
      return unsubscribe;
    }, []);
    return <div class="toolbox-host">{vnode}</div>;
  }

  render(<Host />, document.getElementById("app")!);
}

void bootstrap();
