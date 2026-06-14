# 0003: IMGUI is implemented as a call collector with lexical ui.window scope

Tools describe their UI by writing code that looks like direct function calls
into an `api.ui.*` namespace. The runtime maintains a "current collector"
stack: each call appends a vDOM node to the top of the stack, and the lexical
scope (which `api.ui.window(title, cb)` callback is on the call stack)
determines where `api.ui.button(...)` etc. land.

```js
api.onRender = () => {
  api.ui.window("Main", () => {
    // push window scope
    api.ui.button("OK", { onClick: doIt });
    api.ui.menu("File", () => {
      // push menu scope inside window
      api.ui.menuItem("New", { onClick: doNew });
    });
  }); // pop window scope
};
```

This is the same model Dear ImGui uses with `ImGui::Begin/End` — the
"current window" is determined by lexical scope, not by a global or a
returned handle. The "Main UI" doesn't need to be threaded through
every call; the call stack handles it.

## Why

- Closures over tool state work naturally without the tool author having
  to thread a per-window "ui" reference through every call.
- The "tool can have multiple windows, declared implicitly" model maps
  directly to "declarator calls `ui.window` for each window it wants
  this frame." No separate `openWindow` / handle to manage.
- Menu items, dialog content, and any other nested structures follow
  the same pattern: a `cb` is invoked synchronously, and calls inside it
  are collected into the parent structure.
- The IMGUI vibe (Unity IMGUI, Dear ImGui) is preserved: the tool code
  reads like "describe the UI, run it," not "construct a vDOM data
  structure."

## Trade-offs accepted

- Async/timeout-based UI emission is subtle. If a tool schedules a
  callback that calls `api.ui.button(...)` later, the lexical scope at
  the time of the call might be wrong (or no scope at all). The
  pattern is: capture the relevant state at scheduling time, then call
  `api.requestUpdate()` to re-run the declarator synchronously.
- The "current window" is implicit. A tool author reading their own
  code has to follow the call stack to know where a call lands. This
  is the same trade-off Dear ImGui accepts; we accept it for the same
  reason (the alternative — threading a per-window ui handle — adds
  ceremony without making the code easier to read).
