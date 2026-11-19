import { render } from "preact";
import { useState } from "preact/hooks";
import "./app.css";
import { EmbedHost, Host } from "./app.tsx";
import { findManifestEntry } from "./app/host.ts";
import { DockLab } from "./app/dock-lab.prototype.tsx";
import { LayoutLab } from "./app/layout-lab.tsx";
import { createRuntime, loadManifest, type Runtime, type ToolModule } from "./runtime/index.ts";

async function loadToolModule(id: string): Promise<ToolModule> {
  return (await import(/* @vite-ignore */ `/tools/${id}/index.js`)) as ToolModule;
}

function getEmbedToolFromUrl(): string | null {
  return new URLSearchParams(globalThis.location.search).get("tool");
}

async function bootstrap() {
  // The layout lab is a prototype page for the Layout tree, at `/?lab=layout`.
  // It needs no tool and no runtime, so it comes before the manifest.
  if (new URLSearchParams(globalThis.location.search).get("lab") === "layout") {
    render(<LayoutLab />, document.querySelector("#app")!);
    return;
  }
  // PROTOTYPE for issue #20, at `/?lab=dock`. Goes away when #20 is resolved.
  if (new URLSearchParams(globalThis.location.search).get("lab") === "dock") {
    render(<DockLab />, document.querySelector("#app")!);
    return;
  }

  const manifest = await loadManifest(async () => {
    const res = await fetch("/tools.json");
    return res.text();
  });

  const runtime: Runtime = createRuntime();
  const embedToolId = getEmbedToolFromUrl();

  if (embedToolId !== null && embedToolId !== "") {
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
      } catch (error) {
        console.error(`Failed to load tool ${embedToolId}:`, error);
      }
    }
    render(<EmbedHost runtime={runtime} />, document.querySelector("#app")!);
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
    void (async () => {
      try {
        const mod = await loadToolModule(id);
        runtime.initializeTool(instance.instanceId, mod.default);
      } catch (error) {
        console.error(`Failed to load tool ${id}:`, error);
        runtime.closeTool(instance.instanceId);
      }
    })();
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

  render(<DesktopRoot />, document.querySelector("#app")!);
}

await bootstrap();
