import { render } from "preact";
import { useState } from "preact/hooks";
import "./app.css";
import { App, findManifestEntry } from "./app.tsx";
import { createRuntime, loadManifest, type Runtime, type ToolModule } from "./runtime/index.ts";

function getToolFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("tool");
}

async function loadToolModule(id: string): Promise<ToolModule> {
  return (await import(/* @vite-ignore */ `/tools/${id}/index.js`)) as ToolModule;
}

async function bootstrap() {
  const manifest = await loadManifest(async () => {
    const res = await fetch("/tools.json");
    return res.text();
  });

  const toolFromUrl = getToolFromUrl();
  const runtime: Runtime = createRuntime();

  function launchById(id: string) {
    const entry = findManifestEntry(manifest.tools, id);
    if (!entry) {
      console.error(`Unknown tool: ${id}`);
      return;
    }
    loadToolModule(id)
      .then((mod) => {
        runtime.launchTool({
          manifestId: entry.id,
          name: entry.name,
          loader: mod.default,
        });
      })
      .catch((err) => {
        console.error(`Failed to load tool ${id}:`, err);
      });
  }

  if (toolFromUrl) {
    launchById(toolFromUrl);
  }

  function AppRoot() {
    const [paletteOpen, setPaletteOpen] = useState(false);
    return (
      <App
        runtime={runtime}
        manifest={manifest.tools}
        paletteOpen={paletteOpen}
        onPaletteOpenChange={setPaletteOpen}
        onLaunch={launchById}
      />
    );
  }

  render(<AppRoot />, document.getElementById("app")!);
}

void bootstrap();
