# 0009: Tools style via `api.tw`, not ambient Tailwind classes

Tools build class strings with **`api.tw`** — a runtime tagged template backed by
UnoCSS — instead of writing bare Tailwind class names that depend on the runtime's
build. Tailwind stays an implementation detail of the **Runtime**'s own chrome.

```js
api.ui.custom(() =>
  api.preact.h("button", {
    class: api.tw`w-40 h-40 rounded-full bg-toolbox-accent text-toolbox-deepest`,
  }),
);
// -> class="tw-w-40 tw-h-40 tw-rounded-full tw-bg-toolbox-accent tw-text-toolbox-deepest"
```

## The problem

Tool class names only worked because Tailwind v4's automatic content detection
scans `tools/` source at the **Runtime**'s build. So a tool's styles were:

- coupled to the tool being present at the runtime build,
- coupled to the runtime's exact Tailwind config, and
- limited to literal class strings (no class names computed at runtime).

A class a tool used but the build didn't scan would silently be unstyled. Styling
was an _ambient_ dependency, not a capability the tool asks for.

## The decision

- **`api.tw\`…\`` is a contract primitive** (declared in `api.d.ts`, like
  `api.preact`). It returns a class string and registers the needed CSS at
  runtime, so styling is a capability the runtime _provides_ rather than ambient
  classes the tool _hopes exist_.
- **UnoCSS (`preset-wind4`) generates tool CSS at runtime.** `preset-wind4` is
  Tailwind-v4-aligned, so the utility vocabulary matches what tool authors already
  know.
- **Dual engine.** The runtime's chrome keeps **Tailwind v4** (untouched, zero
  visual risk); UnoCSS is added only for tools.
- **Prefixed (`tw-`).** `api.tw` applies the `tw-` prefix to every utility (via
  the preset's `prefix`). Tool classes live in their own namespace, so they can
  never clash with — or be overridden by — the chrome's unprefixed Tailwind
  classes. The two engines target disjoint selectors and can drift independently.
- **Theme is single-sourced.** UnoCSS's `theme.colors` / `theme.font` reference
  the same CSS variables the chrome's `@theme` already emits
  (`var(--color-toolbox-accent)`, `var(--font-mono)`, …), so `bg-toolbox-accent`
  means the same thing in a tool and in the chrome, with no duplicated values.
- **Generation is synchronous-internally.** `api.tw` returns the class string
  immediately and schedules a microtask to generate + inject the CSS into a shared
  `<style>`; injected tokens are deduped. Because UnoCSS resolves static utilities
  synchronously, the microtask runs before the browser paints, so there is no
  flash. Dynamic _values_ still go through inline `style` (e.g. an animated
  `transform`).

## Why not the alternatives

- **Twind** matched the `tw\`…\`` shape and is synchronous, but it is effectively
  unmaintained and reimplements Tailwind (~v3 semantics), diverging from the v4
  chrome.
- **Ambient `@unocss/runtime` (DOM scan)** needed no tool changes, but it is
  implicit and tools would still "rely on classes being available" — the very
  coupling we set out to make explicit.
- **Build-time per-tool CSS sidecar** keeps one engine and avoids a runtime
  dependency, but it cannot generate class names computed at runtime and assumes
  tools are always built from this repo. `api.tw` keeps the door open for runtime-
  composed / runtime-loaded tools.

## Trade-offs accepted

- **Two CSS engines** (Tailwind v4 for chrome, UnoCSS for tools) and the
  `@unocss/core` + `preset-wind4` weight added to the runtime bundle.
- **A `tw-` prefix** appears in tool markup / devtools.
- **Variant prefixing is by simple rule** (`api.tw` inserts the prefix after the
  final `:`), which is correct for ordinary variants but not for a `:` inside an
  arbitrary value — rare in tool UIs.
- Tool `--spacing` / `--un-*` rely on the chrome's global Tailwind theme vars
  being present (they are; the chrome always loads).

## Migration

`api.tw` ships with **tap-bpm** migrated as the reference. Remaining tools can
migrate incrementally; once all have, the runtime build can stop scanning `tools/`
(restrict Tailwind's content to `src/`) to enforce the decoupling and shrink the
chrome CSS.
