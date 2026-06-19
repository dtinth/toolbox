# Toolbox

A personal web-based operating system: a runtime that hosts small, single-purpose
tools (color picker, QR reader, tap BPM, etc.) in a desktop-like UI with windows,
menus, toasts, and drag-and-drop between tools.

## Language

**Tool**:
A single-purpose web utility that runs inside the toolbox. Declares its UI
declaratively via an IMGUI-style API: calls like `api.ui.button("OK", { onClick })`
are collected by the runtime during the tool's declarator and turned into a
vDOM tree that Preact renders and diffs across redraws.
_Avoid_: app, extension, plugin, widget

**Window**:
A visual container holding one tool's UI. A tool can have any number of
windows; in fact a window exists iff the tool's current declarator includes
a call to `api.ui.window(title, cb)`. The runtime owns position, size, focus,
and pop-out state across frames; the tool only declares what should exist.
Windows are in-app by default; the runtime provides a pop-out control that
moves a window into a real browser popup. Future: PiP.
_Avoid_: pane, panel, view, frame

**Tool source**:
TypeScript/JSX source under `tools/<id>/` in the repo. Compiled to plain ES
modules under `public/tools/<id>/index.js` by a build step (Vite library mode,
separate from the main Vite build). Tool source is _not_ part of the main
Vite build.
_Avoid_: tool code, tool bundle

**Manifest**:
`public/tools.json` — a curated list of tool entries (`id`, `name`, optional
`icon`, optional `description`). Only listed tools appear in the launcher;
unlisted tools can still be developed and tested in isolation.
_Avoid_: registry, catalog, index

**Runtime**:
The toolbox application itself: the desktop chrome, the cmd-k palette
launcher, the collector, the api surface that tools call into. Built by
Vite from `src/`. The runtime hosts zero or more **Tools** at once; the
launcher is part of the runtime itself, not a separate app.
_Avoid_: shell, host, framework, kernel

**API**:
The object passed by the runtime into a tool's `init(api)` function. Fresh
per tool instance. There is no separate "sub-api" for sub-windows — the same
`api` is used everywhere, and the current window is determined by which
`api.ui.window(title, cb)` call is currently executing its callback.
_Avoid_: sdk, runtime API

**Window manager**:
An internal module of the **Runtime** (`createWindowManager`) that owns each
**Window**'s position, z-order, focus, and initial placement (centering +
cascade offset) across frames, plus the scoped-id encoding
(`${instanceId}::${originalId}`). The Runtime delegates all window geometry to
it; tools never see it.
_Avoid_: WM, layout engine, compositor, window service

**Toast center**:
An internal module of the **Runtime** (`createToastCenter`) that owns the toast
queue, per-instance association, and auto-dismiss timers — including the rule
that a `loading` toast suppresses auto-dismiss until loading clears. The
Runtime's `toast` API and tool-close cleanup delegate to it.
_Avoid_: notification service, snackbar manager

**Declarator**:
A function the runtime calls to render a tool instance's UI for one frame.
The tool assigns it via `api.onRender = () => { ... }`. The runtime invokes
it on demand, after state changes, callback fires, or `requestUpdate()` is
called. Not a per-frame loop.
_Avoid_: render function, draw function

**IMGUI**:
The API style tools write against. Calls like `api.ui.button("OK", { onClick })`
look like direct invocations but are collected by the runtime into a vDOM tree.
Borrowed from the Unity / Dear ImGui _vibe_ of "declare UI by calling
functions"; the underlying implementation is declarative and re-runs on demand,
not a 60fps redraw loop.
_Avoid_: retained mode, immediate mode GUI (those have different technical
connotations; here we borrow the _vibe_, not the engine-loop semantics)

**Embed mode**:
Runtime running a single tool full-window with no launcher chrome, activated
by `?tool=<id>` query param.
_Avoid_: single-tool mode, kiosk

**Projector**:
A pop-out (or future PiP) window is a "dumb" display of the main instance's
state. The tool's JS does not re-execute in the popup; the runtime ships
vDOM updates and routes input events back.
_Avoid_: mirror, replica, child window

**Blob**:
An immutable chunk of bytes with a MIME `type` — the web platform's `Blob`.
The unit of binary data a **Tool** inspects or processes. A **File** is a
named Blob.
_Avoid_: binary, buffer, payload, attachment

**File**:
A named **Blob** (`name`, `type`, `size`, `lastModified`) — the web platform's
`File`. The canonical thing a tool receives from the user, regardless of
source: a chosen OS file, a dropped file, a pasted screenshot, or pasted text
are all normalised to a File. Nameless/typed-only sources (paste of an image,
drop of text) get a synthesised name (`pasted-<timestamp>.<ext>`) and
`lastModified = now`; text is wrapped as a `text/plain` File. _Everything the
user hands a tool is bytes, and bytes-with-a-name is a File._
_Avoid_: upload, document, blob (a File is a _named_ Blob — keep them distinct)

**Quick pick**:
A transient, filterable chooser the runtime renders as host chrome, modelled
on VS Code's quick pick. Exposed imperatively as `api.dialog.pick(items, opts)
-> Promise<Item | undefined>` (single-select; resolves `undefined` when
dismissed with Escape). Like **Toast** and the rest of `api.dialog`, it is
_not_ a `ui.*` collector node — it returns a Promise and is drawn by the host,
so it works regardless of pop-out (**Projector**) state. It reuses the same
search-input + fuzzy-filter + arrow-nav UX as the Cmd-K palette.
_Avoid_: dropdown, combobox, menu, modal list

**File input**:
The `ui.file(opts)` primitive — a focusable box (its own `tabindex`) that
yields a **File** from three sources: choose-a-file, drop, and paste. Paste is
scoped to the focused _box_ (click it, then Cmd/Ctrl+V), not merely the focused
**Window**, so two file inputs never fight over a paste. On hover (and always
on touch) the box shows a `…` menu with explicit _Choose file…_ and _Paste from
clipboard_ actions, so it works without a keyboard (mobile-friendly); the menu's
paste uses the async Clipboard API (`navigator.clipboard.read()`). Empty, the
box is blank; once a file is set it shows an icon + metadata. The `…` menu is
chrome the runtime draws, _not_ the (removed) `ui.menu` primitive. It always
yields _exactly one_ File via `onFile`; any ambiguity — several dropped files,
or a clipboard payload with multiple representations — is resolved through a
**Quick pick**, never a silent guess. Distinct from the deferred, generic
`ui.dropArea` / `ui.draggable` (inter-tool drag-and-drop): `ui.file` brings
_external_ data _into_ a tool. Once a file is present it can also leave: the
`…` menu offers _Download_, and the file icon is draggable straight out to the
OS desktop (Chromium `DownloadURL` trick).
_Avoid_: file picker, upload, dropzone, dropArea

## Relationships

- A **Runtime** hosts zero or more **Tools** simultaneously
- A **Tool** instance has at least one **Window** (the implicit main window).
  A window exists iff the tool's current **Declarator** includes a matching
  `ui.window(id, cb)` call, or it is the implicit main window.
- A **Tool source** under `tools/<id>/` compiles to `public/tools/<id>/` for the
  runtime to import at runtime
- A **Manifest** entry references a **Tool** by `id` (the import specifier)
- The **Cmd-K palette** is the runtime's unified launcher: it lists the
  manifest (alphabetical when empty, fuzzy-filtered as the user types) and
  launches the selected tool in-place. A plain left-click on a palette
  item calls `runtime.launchTool`; right-click / cmd-click / middle-click
  follow the natural `<a href="?tool=<id>">` link and open the tool in a
  new tab. The palette auto-opens when no tools are running; Cmd-K toggles
  it otherwise; a "+" launcher button at the bottom-right of the screen
  opens it (the touch-friendly affordance). Clicking the empty desktop does
  nothing.

## Example dialogue

> **Dev:** "When a tool calls `api.ui.button('OK', { onClick })`, what does the
> runtime do with the closure?"
> **Domain expert:** "It serializes a handler id, not the closure. On click,
> the runtime maps the id back to a fresh closure invocation in the tool's
> instance. Closures stay in the main window even when the window is popped
> out."
>
> **Dev:** "How does a tool open a sub-window?"
> **Domain expert:** "It just calls `api.ui.window('sub', 'Sub', () => { ... })`
> in its declarator. As long as that call is made, the sub-window exists. Stop
> calling it, and the window disappears. The runtime handles position and
> size across frames. The main window is always there — no need to call
> `ui.window` for it."
>
> **Dev:** "What happens if I open `/?tool=qr-code-reader`?"
> **Domain expert:** "The runtime loads, sees the query param, and
> launches the QR reader via `runtime.launchTool` — the QR reader
> becomes a running tool instance. The URL is also kept in sync as tools
> are launched and closed, so `/?tool=qr-code-reader,counter` is a
> normal form (comma-separated manifest ids). The cmd-k palette
> auto-opens on the home page (no `?tool=`); the embed-mode URL also
> works in a new tab, since each palette item is an `<a href="?tool=…">`."
>
> **Dev:** "If a tool is in the source tree but not in `tools.json`, does it
> still build?"
> **Domain expert:** "Yes — the tools build is independent of the manifest.
> It's just invisible in the launcher until you add it."

## Flagged ambiguities

- "extension" was used as an alternative to **tool** — resolved: this is not
  VS Code; tools are first-class hosted modules, not pluggable add-ons loaded
  from elsewhere. Use **tool**.
- "frame loop" was considered for the **Declarator** invocation — resolved:
  the runtime calls the declarator on demand (events, callbacks, explicit
  `requestUpdate()`), not on a tick. Tools needing animation subscribe to a
  tick via `api.tick(rate, cb)`.
- "scoped to the tool instance" was considered for **shortcuts** — resolved:
  shortcuts are scoped to the focused **Window**, not the **Tool** instance.
  A tool with two open windows doesn't get cross-window shortcut collisions
  — sub-window A's shortcuts only fire when A has focus. This matches what
  macOS, Windows, and Linux all do.
- "custom cross-window drag layer" was considered for v1 — resolved: the
  runtime uses native HTML5 DnD. Universal MIME types (`text/plain`,
  `text/uri-list`, files) work across windows, across apps, across the OS
  boundary for free. Custom MIME types are scoped to the toolbox. The
  tool picks the type; the runtime only plumbs events.
- "any UI element as a drop target" was considered — resolved: in v1 only
  `ui.dropArea` accepts drops. Other primitives are not drop targets.
- "one instance per tool id" was considered — resolved: the same **Tool** can
  be opened multiple times; each open creates a fresh **Tool** instance with
  its own state, windows, and api. The id is just an import specifier, not
  a singleton key.
- "preserve state on tool edits" was considered for the dev loop — resolved:
  the dev experience is full page refresh on tool file changes. State
  preservation across edits is not a goal in v1.
- "openWindow returns a handle" was considered for sub-window creation —
  resolved: there is no `openWindow` and no handle. The tool declares a
  sub-window by calling `api.ui.window(id, cb)` in its declarator. The
  sub-window exists iff that call is made this frame. Lifetime is implicit
  (driven by tool state, not by a separate open/close API). The runtime
  tracks position/size/focus across frames, but the tool controls
  sub-window existence. The main window is implicit and always exists.
- "per-window API or sub-API" was considered — resolved: a single `api`
  is passed to `init` and used everywhere. The current window is
  determined by which `ui.window(title, cb)` callback is currently
  executing. Sub-apis were rejected because they add complexity (the
  tool author has to thread sub-api references through) with no
  benefit over a single global `api` whose "current window" is
  maintained by the collector.

## How the IMGUI collector works

The runtime maintains a "current collector" — a stack of partial vDOM
trees being built. Before invoking the tool's declarator, the runtime
pushes an empty root. The declarator calls `api.ui.window(title, cb)`:

```
ui.window("settings", "Settings", () => {
  ui.button("OK", { onClick: doThing });     // <-- collected into "settings"'s tree
  ui.window.setTitle("Preferences");       // <-- override title at runtime
  ui.menu("File", () => {
    ui.menuItem("New", { onClick: ... });    // <-- collected into the menu
  });
});
```

Mechanically:

1. The declarator runs inside an implicit **main window** scope. Any
   `ui.*` calls at the top level (outside a `ui.window(...)` callback)
   are collected into the main window.
2. `ui.window(id, cb)` or `ui.window(id, title, cb)` pushes a new
   sub-window node onto the collector and synchronously invokes `cb`.
   The cb's `ui.*` calls append to that sub-window. When `cb` returns,
   the sub-window node is popped and attached to the root.
3. `ui.window.setTitle(newTitle)` overrides the display title of the
   current window (whether main window or a sub-window) for this frame.
4. `ui.button("OK", { onClick })` appends a button-node to the
   current window's tree, with `onClick` stored as a closure.
5. `ui.menu("File", cb)` appends a menu-node to the current window
   and synchronously invokes `cb`. Inside, `ui.menuItem(...)` calls
   append to the menu.
6. The runtime, after the declarator returns, takes the root tree and
   diffs it against the previous frame's tree, mutating the DOM in
   place. On click, the runtime looks up the handler id, retrieves
   the stored closure, and invokes it.

There is **no** "current window" global. The window context is purely
lexical: whichever `ui.window(...)` callback is on the call stack
determines where `ui.button(...)` etc. land. This is the same model
Dear ImGui uses with `ImGui::Begin/End`.

## API surface (v1)

The exact, machine-checked shape of the `api` object a tool's `init(api)`
receives is **not** kept here as prose — it lives in the hand-authored
contract **`api.d.ts`**, which the runtime's real types are asserted to conform
to. See [ADR-0004](docs/adr/0004-api-contract-as-dts.md). The sections below
describe the _behaviour_ behind that surface; the contract file is the source
of truth for its _shape_.

> Note: earlier revisions of this section listed many primitives
> (`column`, `spacer`, `heading`, `code`, `checkbox`, `select`, `slider`,
> `image`, `menu*`, `draggable`, `dropArea`, `shortcuts`, `dialog`) that were
> never implemented. Treat `api.d.ts` as authoritative; PLAN.md tracks what is
> intended but unbuilt.

### Window lifecycle

- A tool has an **implicit main window** that exists for the lifetime of the
  tool instance. The declarator (`onRender`) runs inside this main window's
  scope. The tool does not need to call `ui.window(...)` to create it.
- Sub-windows exist iff the tool's current declarator includes a call to
  `ui.window(id, cb)` (second form: `ui.window(id, title, cb)`). The tool
  controls sub-window existence via its own state (e.g. a `let subOpen = false`
  flag flipped by a button click).
- The runtime remembers each window's position, size, focus, and pop-out state
  across frames, keyed by id.
- A window's **id** is its stable identifier within a tool instance. A
  window's **title** is the display string shown in the title bar, which can
  be overridden at runtime via `ui.window.setTitle(newTitle)` called inside
  the window's callback scope.
- Two `ui.window` calls with the same id in the same declarator is a bug.

### Redraws

A redraw is triggered by:

- Any state change the tool signals via `api.requestUpdate()`.
- A callback firing (button click, drop, etc.).
- A `api.tick` callback firing.

The runtime re-invokes `api.onRender`, which re-declares the UI. The
runtime diffs the new tree against the previous frame's tree and patches
the DOM.

### Animation

`api.tick(cb)` registers a per-frame callback (rAF); `api.tick(rateHz, cb)`
registers a fixed-rate callback. After each tick fires, the runtime
triggers a redraw.
