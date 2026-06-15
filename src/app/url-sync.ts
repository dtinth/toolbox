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

export function buildUrlForTools(manifestIds: string[]): string {
  if (manifestIds.length === 0) return "/";
  const params = new URLSearchParams();
  params.set("tool", manifestIds.join(","));
  const qs = params.toString();
  return `/?${qs}`;
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
  const runningByManifest = new Map<string, string[]>();
  for (const inst of runningInstances) {
    const list = runningByManifest.get(inst.manifestId);
    if (list) list.push(inst.instanceId);
    else runningByManifest.set(inst.manifestId, [inst.instanceId]);
  }
  const runningManifestSet = new Set(runningInstances.map((i) => i.manifestId));
  const toClose: string[] = [];
  for (const inst of runningInstances) {
    if (!desiredSet.has(inst.manifestId)) toClose.push(inst.instanceId);
  }
  const toLaunch: string[] = [];
  for (const id of desiredManifestIds) {
    if (!runningManifestSet.has(id)) toLaunch.push(id);
  }
  void runningByManifest;
  return { toClose, toLaunch };
}

export interface UrlSyncOptions {
  runtime: Runtime;
  launchByManifestId: (manifestId: string) => void;
  getRunningInstances: () => ReadonlyArray<Pick<ToolInstanceInfo, "instanceId" | "manifestId">>;
}

function currentUrlString(): string {
  return globalThis.window
    ? `${globalThis.window.location.pathname}${globalThis.window.location.search}`
    : "/";
}

export function installUrlSync(opts: UrlSyncOptions): () => void {
  const { runtime, launchByManifestId, getRunningInstances } = opts;

  function syncUrlFromState() {
    if (!globalThis.window) return;
    const manifestIds = getRunningInstances().map((i) => i.manifestId);
    const desired = buildUrlForTools(manifestIds);
    if (currentUrlString() === desired) return;
    globalThis.window.history.pushState(null, "", desired);
  }

  const unsubscribe = runtime.subscribe(syncUrlFromState);

  function onPopState() {
    const desired = readToolsFromUrl();
    const action = reconcileActions(getRunningInstances(), desired);
    for (const instanceId of action.toClose) runtime.closeTool(instanceId);
    for (const manifestId of action.toLaunch) launchByManifestId(manifestId);
  }

  globalThis.window?.addEventListener("popstate", onPopState);

  return () => {
    unsubscribe();
    globalThis.window?.removeEventListener("popstate", onPopState);
  };
}
