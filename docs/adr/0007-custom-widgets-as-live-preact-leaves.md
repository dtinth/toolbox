# 0007: Custom widgets are live Preact leaves

A tool can declare a **Custom widget** with `ui.custom(render)`. Unlike every
other `ui.*` primitive — which the collector turns into a data node that the
runtime diffs and patches across redraws — a custom widget is a **leaf** whose
subtree is _live Preact_. `render` is a closure returning a Preact vnode built
with `api.preact.h`; it runs inside Preact's own render lifecycle, **not** during
the tool's declarator.

```js
function init(api) {
  const { signal, h } = api.preact;
  const zoom = signal(1); // durable state, init scope

  api.onRender = () => {
    api.ui.label("Preview");
    api.ui.custom(() => h(Canvas, { zoom })); // leaf: live Preact subtree
  };

  // a pointermove handler somewhere inside Canvas:
  // zoom.value = 2  -> repaints ONLY the widget, no onRender
}
```

## The model

- **Signal-driven, mounted once.** The tool owns **Signals** (`api.preact.signal`,
  created in `init` scope so they persist across redraws). The render closure
  reads them; mutating a signal repaints _only that widget's_ Preact subtree,
  bypassing `onRender` / `requestUpdate` entirely. `@preact/signals` auto-subscribes
  the wrapper component when the closure reads `.value`.
- **Leaf boundary.** The closure must not call `ui.*` — those run outside the
  collection window and throw (see below). imgui-land and Preact-land meet only at
  this one node. A custom widget is a sub-element inside a **Window**, never a Tool.
- **Identity is positional**, refined by **Identity group** (`ui.identityGroup`):
  a node's identity is `(group, positionWithinGroup)`. The runtime renders one
  stable `CustomWidget` wrapper component per slot and feeds it the latest render
  closure, so positional Preact diffing keeps the mount (and any internal
  `useSignal` state) alive across redraws.
- **`api.preact`** is the hand-declared subset a widget is built from: `h`,
  `Fragment`; the signal factories `signal` / `computed` / `effect` / `batch`
  (callable anywhere, incl. `init`); the signal hooks `useSignal` / `useComputed`
  / `useSignalEffect` (render-only — Preact enforces). We declare this subset in
  `api.d.ts` rather than re-exporting Preact's types (ADR-0004); the runtime's real
  bindings are asserted to conform. There is deliberately no `useRef` / `useEffect`
  — DOM wiring uses a callback `ref` plus a signal.

## The two enforced invariants

A custom widget runs _outside_ the declarator, so the boundary between
"collection time" and "everything else" must be sharp:

1. **`onRender` is synchronous.** Returning a Promise throws
   (`"onRender must be synchronous"`). The collector relies on the synchronous
   call stack to know the current **Window**; an `await` would break it.
2. **`ui.*` outside the collection window throws** (`"ui.* called outside
onRender"`). `api.ui` is a single stable object whose methods dispatch on a
   "currently collecting" context — so an `await`-ing declarator, a `setTimeout`,
   or a custom widget's Preact render cannot silently emit nodes. `api.preact.*`
   and `requestUpdate()` are _not_ gated; signals and redraw requests are valid
   anywhere.

## Why

- The IMGUI collector (ADR-0003) re-runs the whole declarator on every redraw and
  diffs the result. That is wrong for anything with rich internal lifecycle (a
  canvas, a charting lib, an editor): you want it mounted once and driven
  imperatively. Preact + signals already solve that — so we expose a controlled
  doorway into Preact rather than reinventing retained-mode widgets.
- Signals make the widget autonomous: high-frequency interaction (drag, draw,
  animate) repaints the leaf without paying for a full declarator re-run.
- Restricting the surface to a declared `api.preact` subset (no raw `useRef` /
  `useEffect`, state in signals) keeps the contract self-contained and steers
  authors toward the signal-first state model.

## Trade-offs accepted

- **Two mental models.** Tools now mix imgui-style declaration with Preact-style
  components. The leaf boundary keeps them from interleaving, but an author must
  know which side of the line they are on (the `ui.*`-throws rule makes crossing
  it loud rather than silent).
- **Positional identity can reset internal state.** A widget's component-internal
  `useSignal` lives at a `(group, position)`; if the tree shape above it changes,
  it remounts and that state resets. We accept this because (a) durable state
  belongs in tool-owned signals, which survive remounts, and (b) the project
  convention is to **prefer `disabled` over conditional show/hide**, keeping
  structure static. `ui.identityGroup` is the escape valve when structure must
  change.
- **Pop-out.** A live Preact widget cannot be serialized, which contradicted the
  original **Projector** model — resolved by making pop-out a live Portal (see
  ADR-0002, amended).
