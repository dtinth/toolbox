import { resolve } from "node:path";
import { readdir } from "node:fs/promises";
import { build } from "vite-plus";

const root = resolve(import.meta.dirname, "..");
const toolsDir = resolve(root, "tools");
const entries = (await readdir(toolsDir, { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

if (entries.length === 0) {
  console.log("No tools to build.");
  process.exit(0);
}

console.log(`Building ${entries.length} tool(s): ${entries.join(", ")}`);

await build({
  configFile: false,
  root,
  publicDir: false,
  build: {
    outDir: "public/tools",
    emptyOutDir: false,
    minify: false,
    target: "es2023",
    lib: {
      entry: Object.fromEntries(entries.map((id) => [id, resolve(toolsDir, id, "index.ts")])),
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}/index.js`,
    },
    rollupOptions: {
      output: {
        entryFileNames: "[name]/index.js",
      },
    },
  },
  logLevel: "info",
});
