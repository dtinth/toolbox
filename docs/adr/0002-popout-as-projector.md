# 0002: Pop-out windows are projectors of the main instance

When a window is popped out into a real browser popup (via the window chrome
button, or future PiP), the popup does _not_ re-execute the tool's code. It
is a dumb display target: the main instance owns the tool's state and
declarator function, ships a serialized vDOM tree + handler ids to the
popup, and routes input events (clicks, drops, key presses) from the popup
back to the main instance for handling.

## Why

- Single source of truth: closures over tool state stay in the main window,
  which eliminates an entire class of cross-window sync bugs.
- The tool author writes one piece of code; "is this window popped out" is
  the runtime's problem, not the tool's.
- Closures (e.g. `onClick: () => doThing(x)`) cannot be serialized, so the
  projector model is the only sane option for our IMGUI-on-closure model.

The alternative (popup re-imports the tool and runs independently with
shared state via `BroadcastChannel`) was considered and rejected: it adds
sync complexity with no benefit for the toolbox-of-utilities use case.

## Amendment (custom widgets): a live Portal, not a serialized projection

The "ships a serialized vDOM tree" mechanism above is **superseded**. The
single source of truth and one-piece-of-tool-code goals stand; the _transport_
changes.

**Custom widgets** (ADR-0007) are live Preact subtrees with closures and
**Signals** — they cannot be serialized into a popup. And ADR-0008 already made
each instance render into its own Preact root, so a window subtree is
independently mountable.

So pop-out becomes a **live Portal**: the runtime re-targets the window subtree's
DOM into the popup's document (a hand-rolled `render`-into-host, _not_
Preact/compat's `createPortal`, which is banned). The window's vnode stays in the
main instance's reconciliation tree; only _where its DOM paints_ moves. The tool's
JS, closures, and signals never leave the main document, and event handlers fire
there for free — which delivers the same "single source of truth, dumb display
target" intent the original decision wanted, now without serialization.

This also preserves widget state across the pop-out toggle: a portal relocates DOM
without unmounting, whereas a plain re-`render()` into the popup root would tear
down every widget's component instance.

Caveats to handle when pop-out is actually built (it is still unbuilt): inject the
Tailwind stylesheet into the popup document, and confirm Preact creates nodes in
the target `ownerDocument`.
