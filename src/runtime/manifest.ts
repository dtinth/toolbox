export interface ManifestEntry {
  id: string;
  name: string;
  icon?: string;
  description?: string;
}

export interface Manifest {
  tools: ManifestEntry[];
}

export async function loadManifest(fetchJson: () => Promise<string>): Promise<Manifest> {
  const raw = await fetchJson();
  const parsed = JSON.parse(raw) as unknown;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("tools" in parsed) ||
    !Array.isArray((parsed as { tools: unknown }).tools)
  ) {
    throw new Error("invalid manifest: expected { tools: [...] }");
  }
  const entries = (parsed as { tools: unknown[] }).tools.map((entry, i) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`invalid manifest: tools[${i}] is not an object`);
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== "string" || typeof e.name !== "string") {
      throw new Error(`invalid manifest: tools[${i}] must have string id and name`);
    }
    return {
      id: e.id,
      name: e.name,
      icon: typeof e.icon === "string" ? e.icon : undefined,
      description: typeof e.description === "string" ? e.description : undefined,
    };
  });
  return { tools: entries };
}
