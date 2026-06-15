import type { Runtime, ToolInstanceInfo } from "../runtime/index.ts";

export function parseToolsFromSearch(search: string): string[] {
  if (!search) return [];
  const queryString = search.startsWith("?") ? search.slice(1) : search;
  if (!queryString) return [];
  const params = new URLSearchParams(queryString);
  const raw = params.get("tool");
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function readToolsFromUrl(): string[] {
  return parseToolsFromSearch(globalThis.window?.location.search ?? "");
}

// URL format: `/?tool=<id1>,<id2>,…` — empty list means no query, just "/".
export function buildUrlForTools(manifestIds: string[]): string {
  if (manifestIds.length === 0) return "/";
  const params = new URLSearchParams();
  params.set("tool", manifestIds.join(","));
  return `/?${params.toString()}`;
}

export interface ReconcileAction {
  toClose: string[];
  toLaunch: string[];
}

export function reconcileActions(
  runningInstances: ReadonlyArray<Pick<ToolInstanceInfo, "instanceId" | "manifestId">>,
  desiredManifestIds: string[],
): ReconcileAction {
  const desiredSet = new Set(desiredManifestIds);
  const runningManifestSet = new Set(runningInstances.map((i) => i.manifestId));
  const toClose: string[] = [];
  for (const inst of runningInstances) {
    if (!desiredSet.has(inst.manifestId)) toClose.push(inst.instanceId);
  }
  const toLaunch: string[] = [];
  for (const id of desiredManifestIds) {
    if (!runningManifestSet.has(id)) toLaunch.push(id);
  }
  return { toClose, toLaunch };
}

export interface UrlSyncOptions {
  runtime: Runtime;
  launchByManifestId: (manifestId: string) => void;
  getRunningInstances: () => ReadonlyArray<Pick<ToolInstanceInfo, "instanceId" | "manifestId">>;
}
