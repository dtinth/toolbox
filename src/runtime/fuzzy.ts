import type { ManifestEntry } from "./manifest.ts";

export function searchTools(query: string, entries: ManifestEntry[]): ManifestEntry[] {
  if (query.trim() === "") {
    return [...entries].sort((a, b) => a.name.localeCompare(b.name));
  }
  return [...entries].sort((a, b) => a.name.localeCompare(b.name));
}
