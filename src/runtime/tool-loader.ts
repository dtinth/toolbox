import { type Api } from "./runtime.ts";

export interface ToolModule {
  default: (api: Api) => void;
}

export async function loadTool(
  id: string,
  importer: (specifier: string) => Promise<ToolModule>,
): Promise<(api: Api) => void> {
  const mod = await importer(`/tools/${id}/index.js`);
  return mod.default;
}
