# 0001: Tools ship as pre-compiled plain ES modules under public/

Tool source lives in `tools/<id>/` as TypeScript/JSX. A separate build step
(esbuild or tsc) compiles it to plain ES modules under `public/tools/<id>/`,
which the runtime loads at runtime via dynamic `import()`. Tools are _not_
part of the Vite build that produces the runtime itself.

## Why

- Tools are authored with TypeScript/JSX ergonomics but shipped as plain
  ES modules with no Vite-specific magic, so a tool author can in principle
  swap to a different runtime without rewriting the tool.
- The runtime remains a small, fast-loading shell. Adding a tool doesn't
  trigger a runtime rebuild.
- The manifest (`public/tools.json`) is a curated allowlist; tools under
  development can exist in `tools/` without showing up in the launcher.
