# API principles

The tool API is built incrementally, driven by actual tool needs. This document
captures the _principles_ — not the full surface. The full surface emerges from
the tracer-bullet development process described below.

## Principles

1. **IMGUI as a call collector.** `api.ui.*` calls during a declarator
   (`api.onRender`) are collected into a vDOM tree. The runtime owns
   position, size, focus, and pop-out state. The tool declares what
   should exist; the runtime decides where and how it appears.

2. **Lexical scope via `ui.window(title, cb)`.** Whichever window callback
   is on the call stack is the implicit "current window" — there's no
   global current-window state, no returned handle. Nested structures
   (menus, drop areas, future "tab" primitives) follow the same pattern:
   a `cb` invoked synchronously, with calls inside it collected into
   the parent.

3. **Windows are stateless from the tool's perspective.** A window
   exists iff the tool's current declarator includes a call to
   `api.ui.window(title, cb)` with that title. The tool controls
   existence via its own state (a `let open = false` flag flipped by a
   button click). The runtime tracks position, size, focus, and
   pop-out across frames.

4. **One `api` per tool instance.** No sub-apis for sub-windows. The
   same `api` is used everywhere; the current window is determined by
   the collector's call stack.

5. **Per-tool-instance peripherals.** `api.shortcuts`, `api.dialog`,
   `api.tick` are scoped to the focused window. `api.toast` is
   desktop-scoped (a toast is visible above any window).

6. **Closures are the unit of interaction.** Handlers like
   `{ onClick: () => save() }` are stored as closures. The runtime
   serializes a handler id; on click, it looks up the closure and
   invokes it. This is what makes the projector model (pop-out windows
   without re-executing the tool) work.

7. **No dead code.** A primitive is added to the API only when a tool
   needs it. The runtime's capabilities grow to match real tool
   requirements, not imagined ones.

## Process: tracer-bullet development

We build one tool at a time. For each tool:

1. **Pick a tool.** A small, useful utility. Examples: "QR code reader",
   "color picker", "tap BPM".

2. **Identify the runtime capabilities the tool needs.** A QR code
   reader needs: a window, a button, an image display, a way to handle
   a file drop or a file picker, a way to copy the result to the
   clipboard. That's a candidate list — not all of it needs to be
   implemented at once.

3. **For each capability, run a TDD cycle:**
   - **RED**: write a test that describes the behavior from the
     _public_ perspective (a tool importing the api, calling the
     primitive, observing the result).
   - **GREEN**: implement the minimum runtime code to pass.
   - **REFACTOR**: clean up duplication, deepen modules.
   - **COMMIT** after green+refactor.

4. **Wire the tool into the manifest**, build it, and verify the
   runtime can load and run it.

5. **Repeat with the next tool.** New tools will reveal new
   capabilities; the runtime grows organically.

The order of tools matters. Pick the next tool based on what new
runtime capabilities it exercises, not based on importance. The
first tool should exercise: `init`, `onRender`, `ui.window`, a
simple primitive like `ui.button` or `ui.label`, and `requestUpdate`.
The second tool might add a new primitive, or a different lifecycle
pattern. Etc.

## Tools to build (rough ordering)

This is a working list, ordered by which runtime capabilities they
exercise. We pick the next one based on what the runtime _doesn't_
have yet.

1. **Hello, world.** The simplest possible tool. Validates: runtime
   loading, manifest reading, `init` invocation, `onRender`,
   `ui.window`, `ui.label`, basic window chrome. No business logic.

2. **Counter.** A button that increments a number. Validates:
   callbacks (`onClick`), closures over tool state, `requestUpdate`,
   re-render. No new primitives.

3. **Color picker.** A slider/input that displays a color. Validates:
   `slider` or `textInput`, `text` with `copyable`, drag-and-drop
   out (`ui.draggable`).

4. **QR code reader.** Reads an image (file drop or camera), decodes
   QR. Validates: `dropArea`, file handling, image display, async work
   in a callback that triggers `requestUpdate` after.

5. **Tap BPM.** A tap-tempo tool. Validates: `tick` for animation,
   `requestUpdate` from a tick callback.

6. **Notes / scratchpad.** A persistent text tool. Validates: tool
   state persistence (a tool wants to save its text somewhere).

7. **Window-state tool.** A tool that opens a sub-window. Validates:
   multi-window per tool.

8. ... as needed.

Each tool surfaces a small, well-defined runtime addition. The full
API isn't designed up front; it emerges.
