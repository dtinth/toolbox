import { type ManifestEntry } from "./manifest.ts";
import { type Runtime, type ToolInstanceInfo } from "./runtime.ts";
import { type ToolModule } from "./tool-loader.ts";

export function launchToolFromModule(
  runtime: Runtime,
  entry: ManifestEntry,
  mod: ToolModule,
): ToolInstanceInfo {
  return runtime.launchTool({
    manifestId: entry.id,
    name: entry.name,
    loader: mod.default,
  });
}
