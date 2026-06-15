import { render } from "preact";
import { useState } from "preact/hooks";
import "./app.css";
import { EmbedHost, Host } from "./app.tsx";
import { findManifestEntry } from "./app/host.ts";
import { createRuntime, loadManifest, type Runtime, type ToolModule } from "./runtime/index.ts";

async function loadToolModule(id: string): Promise<ToolModule> {
  return (await import(/* @vite-ignore */ `/tools/${id}/index.js`)) as ToolModule;
}

function getEmbedToolFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("tool");
}

async function bootstrap() {
  const manifest = await loadManifest(async () => {
    const res = await fetch("/tools.json");
    return res.text();
  });

  const runtime: Runtime = createRuntime();
  const embedToolId = getEmbedToolFromUrl();

  if (embedToolId) {
    const entry = findManifestEntry(manifest.tools, embedToolId);
    if (!entry) {
      console.error(`Unknown tool: ${embedToolId}`);
    } else {
      try {
        const mod = await loadToolModule(embedToolId);
        runtime.launchTool({
          manifestId: entry.id,
          name: entry.name,
          loader: mod.default,
        });
      } catch (err) {
        console.error(`Failed to load tool ${embedToolId}:`, err);
      }
    }
    render(<EmbedHost runtime={runtime} />, document.getElementById("app")!);
    return;
  }

  function launchById(id: string) {
    const entry = findManifestEntry(manifest.tools, id);
    if (!entry) {
      console.error(`Unknown tool: ${id}`);
      return;
    }
    const instance = runtime.launchTool({
      manifestId: entry.id,
      name: entry.name,
    });
    loadToolModule(id)
      .then((mod) => {
        runtime.initializeTool(instance.instanceId, mod.default);
      })
      .catch((err) => {
        console.error(`Failed to load tool ${id}:`, err);
        runtime.closeTool(instance.instanceId);
      });
  }

  function DesktopRoot() {
    const [paletteOpen, setPaletteOpen] = useState(false);
    return (
      <Host
        runtime={runtime}
        manifest={manifest.tools}
        paletteOpen={paletteOpen}
        onPaletteOpenChange={setPaletteOpen}
        onLaunch={launchById}
      />
    );
  }

  render(<DesktopRoot />, document.getElementById("app")!);
}

void bootstrap();
