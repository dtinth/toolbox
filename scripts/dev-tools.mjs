import { resolve } from "node:path";
import { readdir } from "node:fs/promises";
import { createServer } from "vite-plus";

const root = resolve(import.meta.dirname, "..");
const toolsDir = resolve(root, "tools");

const entries = (await readdir(toolsDir, { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

if (entries.length === 0) {
  console.log("No tools to watch.");
  process.exit(0);
}

console.log(`Watching ${entries.length} tool(s): ${entries.join(", ")}`);

const server = await createServer({
  configFile: false,
  root,
  server: {
    watch: {
      ignored: ["!**/tools/**"],
    },
  },
  build: {
    outDir: "public/tools",
    emptyOutDir: false,
    minify: false,
    target: "es2023",
    watch: {},
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

await server.listen();
console.log("Tools dev server running. Press Ctrl+C to stop.");

process.on("SIGINT", async () => {
  await server.close();
  process.exit(0);
});
