import { type ManifestEntry, type ToolInstanceInfo } from "../runtime/index.ts";

export function runningManifestIds(instances: readonly ToolInstanceInfo[]): Set<string> {
  const ids = new Set<string>();
  for (const inst of instances) {
    ids.add(inst.manifestId);
  }
  return ids;
}

export function findManifestEntry(manifest: ManifestEntry[], id: string): ManifestEntry | null {
  for (const entry of manifest) {
    if (entry.id === id) {
      return entry;
    }
  }
  return null;
}
