import type { ManifestEntry, ToolInstanceInfo } from "../runtime/index.ts";

export function runningManifestIds(instances: ReadonlyArray<ToolInstanceInfo>): Set<string> {
  const ids = new Set<string>();
  for (const inst of instances) {
    ids.add(inst.manifestId);
  }
  return ids;
}

export function findManifestEntry(manifest: ManifestEntry[], id: string): ManifestEntry | null {
  for (const entry of manifest) {
    if (entry.id === id) return entry;
  }
  return null;
}
