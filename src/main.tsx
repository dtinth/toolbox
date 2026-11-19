import { render } from "preact";
import { useState } from "preact/hooks";
import "./app.css";
import { EmbedHost, Host } from "./app.tsx";
import { findManifestEntry } from "./app/host.ts";
import { LayoutLab } from "./app/layout-lab.tsx";
import { parseRoute, workspaceIdFromName, workspaceUrl } from "./app/route.ts";
import { createRuntime, loadManifest, type Runtime, type ToolModule } from "./runtime/index.ts";
import {
  autosave,
  createWorkspaceStore,
  restoreWorkspace,
  snapshot,
  type WorkspaceStore,
} from "./runtime/workspace.ts";

async function loadToolModule(id: string): Promise<ToolModule> {
  return (await import(/* @vite-ignore */ `/tools/${id}/index.js`)) as ToolModule;
}

/** The Workspace store, or null when the browser blocks storage. */
function openWorkspaceStore(): WorkspaceStore | null {
  try {
    return createWorkspaceStore(globalThis.localStorage);
  } catch {
    return null;
  }
}

async function bootstrap() {
  // The layout lab is a prototype page for the Layout tree, at `/?lab=layout`.
  // It needs no tool and no runtime, so it comes before the manifest.
  if (new URLSearchParams(globalThis.location.search).get("lab") === "layout") {
    render(<LayoutLab />, document.querySelector("#app")!);
    return;
  }

  const manifest = await loadManifest(async () => {
    const res = await fetch("/tools.json");
    return res.text();
  });

  const runtime: Runtime = createRuntime();
  const route = parseRoute(globalThis.location.search);

  function launchById(id: string, instanceId?: string) {
    const entry = findManifestEntry(manifest.tools, id);
    if (!entry) {
      console.error(`Unknown tool: ${id}`);
      return;
    }
    const instance = runtime.launchTool({
      instanceId,
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

  if (route.kind === "embed") {
    for (const id of route.toolIds) {
      launchById(id);
    }
    render(<EmbedHost runtime={runtime} />, document.querySelector("#app")!);
    return;
  }

  const store = openWorkspaceStore();
  const baseTitle = document.title;

  /** Save the Workspace as the user works, from now until the page goes. */
  function persistTo(id: string) {
    document.title = `${id} — ${baseTitle}`;
    if (store === null) {
      return;
    }
    const saver = autosave(runtime, (workspace) => {
      store.save(id, workspace);
    });
    // A move less than the autosave delay before the tab closes still counts.
    globalThis.addEventListener("pagehide", saver.flush);
  }

  let initialWorkspace: string | null = null;
  if (route.kind === "workspace") {
    initialWorkspace = route.id;
    const saved = store?.load(route.id) ?? null;
    if (saved !== null) {
      const manifestIds = new Set(manifest.tools.map((tool) => tool.id));
      restoreWorkspace(runtime, saved, manifestIds, (tool) => {
        launchById(tool.manifestId, tool.instanceId);
      });
    }
    persistTo(route.id);
  }

  /** Promote the scratch bench to a named Workspace. An error message, or null. */
  function saveAs(name: string): string | null {
    if (store === null) {
      return "This browser does not let the page store anything.";
    }
    const id = workspaceIdFromName(name);
    if (id === null) {
      return "Type a name with at least one letter or digit.";
    }
    if (store.load(id) !== null) {
      return `“${id}” is taken. Pick another name.`;
    }
    store.save(id, snapshot(runtime));
    globalThis.history.replaceState(null, "", workspaceUrl(id));
    persistTo(id);
    return null;
  }

  function DesktopRoot() {
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [workspace, setWorkspace] = useState(initialWorkspace);
    return (
      <Host
        runtime={runtime}
        manifest={manifest.tools}
        paletteOpen={paletteOpen}
        onPaletteOpenChange={setPaletteOpen}
        onLaunch={(id) => {
          launchById(id);
        }}
        onSaveWorkspace={
          workspace === null
            ? (name) => {
                const error = saveAs(name);
                if (error === null) {
                  setWorkspace(workspaceIdFromName(name));
                }
                return error;
              }
            : undefined
        }
      />
    );
  }

  render(<DesktopRoot />, document.querySelector("#app")!);
}

await bootstrap();
