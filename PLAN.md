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

- A **file-picker / drop-area tool** would drive `ui.dropArea` (DnD) and
  file-handling utilities.
- A **menu-using tool** (e.g. a tool that has File / Edit / Help menus)
  would drive the `ui.menu` / `ui.menuItem` renderer.
- A **pop-out / projector implementation** would let the user tear off a
  window into a real browser popup (ADR 0002 is the plan; not yet
  implemented).

After those primitives come **embed mode polish** (currently `?tool=<id>` only),
**per-tool config** (a tool that has settings), and **persistence beyond
localStorage** (e.g. tool state in IndexedDB). **Resizable windows** and
**PiP** are stretch goals.

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

- [ ] **`ui.menu` / `ui.menuItem` / `ui.menuSeparator`** — types existed
      in old `src/runtime/collector.ts` but were removed in the collector
      refactor (menu types were never rendered by any tool). The next tool
      that needs an in-window menu will re-introduce them.
- [ ] **`ui.dropArea`** — never typed or rendered. DnD plumbing not started.
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
- [ ] **`api.dialog.confirm` / `input` / `message`** — types once existed
      in collector and runtime, not yet implemented. The renderer needs
      a modal overlay that blocks the calling window.

### Launcher / embed

- [ ] **Embed mode improvements** — currently `?tool=<id>` only.
      Consider `?tools=qr,counter,echo` to open multiple tools at once.
- [ ] **Launcher polish** — currently a list of cards (now dark-themed).
      Could be a grid, with icons, with search. Cmd-K palette already exists.
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
- **Test count and current state**: 33 tests in `src/runtime/*.test.ts`
  (collector, renderer, runtime, manifest, tool-loader). All passing
  as of `b8aba41`. Build produces a complete `dist/` artifact and
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
