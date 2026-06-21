# Plan

Working plan for the toolbox runtime. Tracks what's done, what's in flight,
and what still needs to be done. Used in place of a formal issue tracker
while the project is in the building stage.

## Where we are

The runtime skeleton is in place: the SPA loads a tool from `/tools/index.json`,
mounts the tool's declarator output (an IMGUI-style call-collected vDOM tree)
inside a Preact host, and supports redraws, animation ticks, toasts, and a
Cmd-K palette for switching tools. Seven tools exercise the main runtime
capabilities. A single `pnpm build` produces a deployable `dist/` artifact
including the runtime, the manifest, and all built tools. The build fails
on any lint warning.

**The runtime runs in one of two modes:**

- **Desktop mode** (no `?tool=`): the multi-window runtime with the
  Cmd-K palette launcher. Multiple tools can be running concurrently.
  The palette auto-opens when no tools are running; Cmd-K toggles it
  otherwise; a "+" launcher button at the bottom-right of the screen is the
  touch-friendly open target. A plain left-click on a palette item launches the tool in-
  place; right-click / cmd-click / middle-click follow the item's
  `<a href="?tool=<id>">` and open the tool in a new tab (embed mode).
  No URL is written — the desktop URL stays as `/` regardless of which
  tools are running.
- **Embed mode** (`?tool=<id>`): a single tool runs in a clean desktop
  with no launcher. Cmd-K is a no-op; the palette is never shown. The
  URL is the source of truth for which tool is running.

**Window chrome is now implemented:**

- Implicit main window with id/title split and `ui.window.setTitle()` / `ui.window.onClose()`
- Floating fixed-position windows with title bar drag via pointer events (mouse + touch)
- Global z-order counter, click-to-focus with a lime green focus ring
- All 7 tools migrated to the new implicit-main-window API
- Dark theme design system via Tailwind v4 `@theme` tokens (`toolbox-*`) inspired by
  thdocs/notes-frontend aesthetic (dark charcoal surfaces, Arimo/Comic Mono fonts,
  `#d7fc70` accent, `#ffffbb` hover, `#bbeeff` secondary)

The architectural shape is captured in `CONTEXT.md` and three ADRs under
`docs/adr/`. The development process (tracer-bullet TDD, no dead code,
tools drive the API) is in `docs/api-principles.md`. Past decisions and
implementation history are in git (see commit log).

## Where we are headed

Continue the tracer-bullet loop: pick a tool, identify the runtime
capability it needs, TDD that capability in (RED → GREEN → REFACTOR →
COMMIT), wire the tool into the manifest, verify, push. The next tools
should exercise primitives that the runtime types declare but that no tool
has yet rendered:

- ~~A **file-picker / drop-area tool** would drive `ui.dropArea` (DnD) and
  file-handling utilities.~~ **Superseded:** file _intake_ is now the `ui.file`
  primitive — see [ADR-0005](docs/adr/0005-file-intake-via-ui-file.md). Generic
  `ui.dropArea` (inter-tool DnD) remains a separate, deferred concern.
- ~~A **menu-using tool** (e.g. a tool that has File / Edit / Help menus)
  would drive the `ui.menu` / `ui.menuItem` renderer.~~ **Done:** the
  **uploader** tool drives `ui.menu` / `ui.menuItem` / `ui.menuSeparator`
  (see [ADR-0006](docs/adr/0006-menu-as-collector-primitive.md)).
- A **pop-out / projector implementation** would let the user tear off a
  window into a real browser popup (ADR 0002 is the plan; not yet
  implemented).

After those primitives come **embed mode polish** (currently `?tool=<id>` only),
**per-tool config** (a tool that has settings), and **persistence beyond
localStorage** (e.g. tool state in IndexedDB). **Resizable windows** and
**PiP** are stretch goals.

### Blob inspector (planned tracer bullets)

Concrete plan from a `grill-with-docs` session — see
[ADR-0004](docs/adr/0004-api-contract-as-dts.md),
[ADR-0005](docs/adr/0005-file-intake-via-ui-file.md) and the
**Blob / File / Quick pick / File input** glossary entries in `CONTEXT.md`.
Build contract-first (add to `api.d.ts` first, then implement to conform):

1. **API contract (`api.d.ts`)** — introduce the hand-authored contract for the
   _current_ surface, add a tsc-checked conformance assertion, and repoint tool
   imports from `src/runtime/index.ts` to it. (ADR-0004)
2. **`api.dialog.pick`** — VS Code-style quick pick: a Promise-returning,
   host-rendered overlay reusing the Cmd-K palette's search / fuzzy / arrow-nav
   UX. Single-select; `canPickMany` deferred.
3. **`ui.file`** — focusable intake box (choose / drop / focus-scoped paste, plus
   a hover/touch `…` menu with _Choose file…_ / _Paste from clipboard_). Yields
   exactly one `File`; ambiguity (multiple files, or multi-type paste) resolves
   via `api.dialog.pick`. Every source normalised to a `File`. (ADR-0005)
4. **`blob-inspector` tool** — metadata only (name / type / size /
   lastModified), consumes `ui.file`. Add to the manifest. Proves `ui.file`
   end-to-end.
5. **(future)** `ui.image` + type-aware previews (text / image / hex) in the
   inspector.

### Runtime

- [x] **Multi-tool support** — the runtime now hosts multiple tool
      instances concurrently. `launchTool({ manifestId, name, loader })`,
      `closeTool(instanceId)`, `toolInstances()`, and `isEmpty` are the
      primary surface. `loadTool(loader)` is kept as a back-compat
      single-instance path. Window ids are scoped (`${instanceId}::${id}`)
      so per-tool windows coexist in `windowStates` / `activeWindowId`
      without collisions. Toasts are aggregated across instances.
      See commits `d5fc030` … `849d5b2` and `9ecbb1c` … `849d5b2`.

### Custom widgets + reactive surface

Designed in a `grill-with-docs` session; see the **Custom widget**, **Reactive
surface**, **Signal**, **Identity group**, and **Instance root** terms in
`CONTEXT.md`, plus ADR-0007 / ADR-0008 and the ADR-0002 amendment.

- [x] **Synchronous-collection enforcement** — `api.ui` is a single stable object
      dispatching on a "currently collecting" context: `ui.*` outside the window
      throws (`"ui.* called outside onRender"`); a Promise-returning `onRender`
      throws (`"onRender must be synchronous"`). `api.preact.*` / `requestUpdate`
      stay ungated.
- [x] **`api.preact`** — the hand-declared subset (`h`, `Fragment`, `signal`,
      `computed`, `effect`, `batch`, `useSignal`, `useComputed`, `useSignalEffect`)
      in `api.d.ts`, bound to real preact + `@preact/signals` and asserted to
      conform.
- [x] **`ui.identityGroup(key?)`** — `(group, position)` identity: a collector
      marker; the renderer keys each child and strips the markers.
- [x] **`ui.custom(render)`** — the live-Preact leaf node + a stable `CustomWidget`
      wrapper so the mount (and its signal subscriptions) survive redraws.
      (ADR-0007)
- [x] **Per-instance Preact roots** — per-instance dirty + cache so one instance's
      redraw never re-runs another's `onRender`; `renderInstance(id)` + a
      `DesktopRoots` host that mounts each instance into its own root. (ADR-0008)
- [x] **First `ui.custom` driver** — Tap BPM reworked into a single tap pad
      (Custom widget) with a linear-regression tempo estimator + confidence.
- [ ] **(future)** Pop-out as a live Portal of a window subtree into a popup
      document — supersedes ADR-0002's serialized projection (caveats: inject the
      stylesheet, confirm Preact creates nodes in the target `ownerDocument`).

## Open issues

### Build / tooling

- [x] **Tools built after Vite build, causing stale dist/tools/.** The
      `pnpm build` script ran `vp build` (which copies `public/` to `dist/`)
      before `scripts/build-tools.mjs`. Fixed: tools are now built before
      Vite. (`tsc && node scripts/build-tools.mjs && vp build`)
- [ ] **Pre-commit hook can reformat files during commit.** The
      `vite.config.ts` `staged: "*": "vp check --fix"` hook can modify
      staged files. `public/tools/` is gitignored so the manifest is safe.
      No surprises since the build-order fix.

### Runtime capabilities (typed but unrendered)

- [x] **`ui.menu` / `ui.menuItem` / `ui.menuSeparator`** — re-introduced as
      collector primitives, rendered as a top-of-window menu bar with dropdowns
      portaled out of the clipped window (the `ui.file` `…` menu mechanism).
      Driven by the **uploader** tool. See
      [ADR-0006](docs/adr/0006-menu-as-collector-primitive.md).
- [x] **`ui.checkbox`** and **`ui.copyableText`** — added alongside the
      uploader: a labelled boolean toggle, and a click-to-copy / drag-out
      (`text/plain`) read-only text pill. See the CONTEXT.md terms.
- [ ] **`ui.dropArea`** _(generic inter-tool DnD — distinct from `ui.file`
      intake; see [ADR-0005](docs/adr/0005-file-intake-via-ui-file.md))_ — never
      typed or rendered. DnD plumbing not started.
- [ ] **`ui.draggable`** — never typed or rendered. Should use native HTML5 DnD.
- [ ] **HTML5 DnD plumbing** — the runtime needs to forward `dragstart`,
      `dragover`, `drop` events to the matching `dropArea` / `draggable`
      nodes. Not started.

### Window chrome (future)

- [ ] **Resizable windows** — at least a bottom-right handle. Postponed
      from v1. Position persistence decision still needed.
- [ ] **Pop-out button** — appears in the window chrome. Opens the
      window in a real browser popup via `window.open`, then the
      runtime drives the popup as a projector (ADR 0002).
- [ ] **PiP** — `document.pictureInPictureWindow` for a video-style
      always-on-top mini window. Stretch goal.

### Shortcuts and peripherals

- [ ] **`api.shortcuts.register(combo, handler)`** — types in
      `src/runtime/runtime.ts`, not yet implemented. Should be scoped
      to the focused window (`runtime.activeWindowId` is now available).
      Decide the combo string format (`"CmdOrCtrl+S"`, `"Cmd+K"`, etc.).
- [x] **`api.dialog.input`** — host-rendered modal text prompt, the sibling
      of `api.dialog.pick` (see the **Input dialog** term in CONTEXT.md).
      **`confirm` / `message`** remain unbuilt.

### Launcher / embed

- [x] **Embed mode** — `?tool=<id>` runs that one tool in a clean
      desktop, no palette, no Cmd-K. Used as the "open in new tab"
      target from a palette item's `<a href="?tool=<id>">`.
- [x] **Launcher polish** — the card-list home page is gone. The Cmd-K
      palette is the only launcher UI. Empty query shows the manifest
      in alphabetical order; non-empty runs a fuzzy match against
      `name` and `id`. Each item is an `<a href="?tool=<id>">` so
      right-click / cmd-click / middle-click open in a new tab.
- [ ] **Launcher state** — when Cmd-K is open and a tool is running,
      the palette shows the manifest. Should the palette also list
      "open windows" so the user can switch between windows of the
      same tool?

### Persistence and state

- [ ] **Per-tool state persistence** — `localStorage` is fine for small
      things (notes), but tools that need structured state (recent
      files, undo history) need IndexedDB or a similar store. Decide
      whether the runtime provides a `api.storage` API or whether each
      tool rolls its own.
- [ ] **Window state persistence** — position/size persistence not yet
      implemented. Decision pending (per-tool? per-window? per-instance?).

### Tooling DX

- [ ] **`vp dev` + `dev-tools` watcher are two processes.** A single
      `pnpm dev` could run both in parallel via `vp run` or a small
      `concurrently`-style script. Not blocking; nice to have.
- [ ] **No test fixtures for runtime+host integration** — tests cover
      the collector and the runtime in isolation. The full
      `runtime → renderer → Preact → DOM` pipeline is only smoke-
      tested via agent-browser. A JSDOM-based test that mounts the
      host and asserts on the resulting DOM would catch regressions
      faster.

## Reference

- **Domain glossary, runtime model, ADR rationale**: see `CONTEXT.md`
  and `docs/adr/0001-tools-as-plain-esm.md`,
  `docs/adr/0002-popout-as-projector.md`,
  `docs/adr/0003-imgui-collector-model.md`.
- **Process (tracer-bullet TDD, no dead code)**: see
  `docs/api-principles.md`.
- **Implementation history**: see git log. The recent commits map
  1-to-1 to tracer bullets (#1 hello-world through #8 launcher + Cmd-K),
  with later commits for build pipeline, strict-lint config, and
  window chrome + dark theme.
- **Test count and current state**: 68 tests in 9 test files under
  `src/runtime/*.test.ts` and `src/app/*.test.ts` (collector, renderer,
  runtime, manifest, tool-loader, fuzzy, click, host, palette-
  visibility). All passing as of the latest commit. Build produces a
  complete `dist/` artifact and fails on any lint warning.

## Suggested skills

When picking up from this plan, an agent should consider invoking:

- **`tdd`** — for any new runtime primitive, write a RED test in
  `src/runtime/*.test.ts` first, then GREEN, then REFACTOR, then
  commit. This is the project's process.
- **`grill-with-docs`** — for any architectural decision that goes
  beyond a single primitive (e.g. "where does window state live?"
  or "what's the menu API shape?"). Drive the question with the
  glossary in `CONTEXT.md` and the ADRs.
- **`improve-codebase-architecture`** — periodically, when the runtime
  has grown enough primitives that the module structure feels
  strained. Read `CONTEXT.md` first to ground the analysis in the
  project's language.
- **`pdd`** — if a single tool's requirements start spanning many
  capabilities and the natural division is unclear, write `@todo`
  stubs and pick them up in tracer-bullet order. The first
  capability pulled in dictates the order.
- **`agent-browser`** — for end-to-end verification of a new
  primitive or tool. The CI gate is `pnpm build`; the human gate
  is "open the URL and try the new thing." Use it before declaring
  a tracer bullet done.
- **`tmux`** — for running `vp dev` + `dev-tools` in parallel during
  iterative work, so a tool change in `tools/<id>/` is reflected in
  the running browser without a manual restart cycle.
