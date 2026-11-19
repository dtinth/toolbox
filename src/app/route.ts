// Which URL means what (issue #27).
//
//   /                  the scratch bench: launch and arrange freely, nothing persists
//   ?workspace=<id>    a named Workspace, saved as you go; last write wins
//   ?tool=a,b          embed: those tools only, no launcher, no Cmd-K

export type Route =
  | { kind: "scratch" }
  | { kind: "workspace"; id: string }
  | { kind: "embed"; toolIds: string[] };

/**
 * Read the route from a query string. `?tool=` wins over `?workspace=`: an
 * embed is locked, and must stay locked whatever else the URL carries. An
 * empty value counts as absent.
 */
export function parseRoute(search: string): Route {
  const params = new URLSearchParams(search);
  const toolIds = (params.get("tool") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");
  if (toolIds.length > 0) {
    return { kind: "embed", toolIds };
  }
  const id = params.get("workspace") ?? "";
  if (id !== "") {
    return { kind: "workspace", id };
  }
  return { kind: "scratch" };
}

/** The URL of a Workspace, relative to the page. */
export function workspaceUrl(id: string): string {
  return `?workspace=${encodeURIComponent(id)}`;
}

/**
 * Turn a name the user typed into a Workspace id: lower case, a dash for each
 * run of spaces or punctuation. Letters of any script stay, so a Thai name
 * makes a Thai id. Null when nothing usable is left.
 */
export function workspaceIdFromName(name: string): string | null {
  const id = name
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{M}\p{N}_]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");
  return id === "" ? null : id;
}
