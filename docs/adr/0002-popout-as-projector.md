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
