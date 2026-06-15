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

- A **file-picker / drop-area tool** would drive `ui.dropArea` (DnD) and
  file-handling utilities.
- A **menu-using tool** (e.g. a tool that has File / Edit / Help menus)
  would drive the `ui.menu` / `ui.menuItem` renderer.
- A **sub-window tool** (a tool that opens a real second window via
  `api.openWindow`) would drive multi-window lifecycle.
- A **pop-out / projector implementation** would let the user tear off a
  window into a real browser popup (ADR 0002 is the plan; not yet
  implemented).

Once those primitives are exercised, the next phase is **window
chrome**: draggable title bars, resize handles, focus management,
z-ordering. The current windows are just absolutely-positioned flex items.

After chrome comes **embed mode polish** (currently `?tool=<id>` only),
a **per-tool config** mechanism (a tool that has settings), and
**persistence beyond localStorage** (e.g. tool state in IndexedDB).

## Open issues

### Build / tooling

- [ ] **Pre-commit hook in `vite.config.ts` `staged: "*": "vp check --fix"`
      can reformat files during the commit, including `public/tools.json`
      if it's still tracked.** The original corruption that prompted the
      move of the manifest to `tools/index.json` was traced to this. The
      `tools/index.json` → `public/tools/index.json` copy now happens in
      the build script (`scripts/build-tools.mjs`), so the source manifest
      is no longer at risk. `public/tools/` is gitignored. Confirm the
      hook doesn't surprise us again on a future refactor.

### Runtime capabilities (typed but unrendered)

- [ ] **`ui.menu` / `ui.menuItem` / `ui.menuSeparator`** — types exist in
      `src/runtime/collector.ts`, but the renderer in
      `src/runtime/renderer.tsx` has no `case "menu"` for them. The next
      tool that needs an in-window menu will pull this in.
- [ ] **`ui.dropArea`** — same situation. Types in collector, no
      renderer case. DnD plumbing not started.
- [ ] **`ui.draggable`** — types in collector, no renderer. Should use
      native HTML5 DnD per ADR scope decision.
- [ ] **HTML5 DnD plumbing** — the runtime needs to forward `dragstart`,
      `dragover`, `drop` events to the matching `dropArea` / `draggable`
      nodes. Decide whether to do this in the renderer (via Preact event
      props) or at the collector level (the collector stores the
      `onDrop` handler, the renderer wires it up).

### Window chrome

- [ ] **Draggable windows** — title bar drag to move. CSS positioning
      updates on `pointerdown` / `pointermove` / `pointerup`. Persist
      position in `localStorage` keyed by window title? Or scoped to
      the tool? Design decision needed.
- [ ] **Resizable windows** — at least a bottom-right handle. Same
      persistence question.
- [ ] **Focus / z-order** — clicking a window brings it to front. The
      focus state is needed to scope `api.shortcuts` to the right
      window. Needs an explicit "active window" concept.
- [ ] **Window chrome styling** — title bar should be visually distinct
      from the window content. Currently the title is just a label at
      the top of the window body.
- [ ] **Pop-out button** — appears in the window chrome. Opens the
      window in a real browser popup via `window.open`, then the
      runtime drives the popup as a projector (ADR 0002).
- [ ] **PiP** — `document.pictureInPictureWindow` for a video-style
      always-on-top mini window. Stretch goal.

### Shortcuts and peripherals

- [ ] **`api.shortcuts.register(combo, handler)`** — types in
      `src/runtime/runtime.ts`, not yet implemented. Should be scoped
      to the focused window. Decide the combo string format
      (`"CmdOrCtrl+S"`, `"Cmd+K"`, etc.).
- [ ] **`api.dialog.confirm` / `input` / `message`** — types in
      collector and runtime, not yet implemented. The renderer needs
      a modal overlay that blocks the calling window.

### Launcher / embed

- [ ] **Embed mode improvements** — currently `?tool=<id>` only.
      Consider `?tools=qr,counter,echo` to open multiple tools at once.
- [ ] **Launcher polish** — currently a list of cards. Could be a
      grid, with icons, with search. Cmd-K palette already exists; the
      launcher itself doesn't need a search box because Cmd-K works
      everywhere.
- [ ] **Launcher state** — when Cmd-K is open and a tool is running,
      the palette shows the manifest. Should the palette also list
      "open windows" so the user can switch between windows of the
      same tool? (Currently multiple instances of the same tool just
      sit there side by side.)

### Persistence and state

- [ ] **Per-tool state persistence** — `localStorage` is fine for small
      things (notes), but tools that need structured state (recent
      files, undo history) need IndexedDB or a similar store. Decide
      whether the runtime provides a `api.storage` API or whether each
      tool rolls its own.
- [ ] **Window state persistence** — the optional position/size
      persistence mentioned under Window Chrome needs a single
      decision (per-tool? per-window? per-instance?).

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
  with later commits fixing the build pipeline and strict-lint config.
- **Test count and current state**: 20 tests in `src/runtime/*.test.ts`
  (collector, renderer, runtime, manifest, tool-loader). All passing
  as of `cfeafb5`. Build produces a complete `dist/` artifact and
  fails on any lint warning.

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
