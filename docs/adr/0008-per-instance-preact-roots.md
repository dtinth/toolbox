# 0008: One Preact root per tool instance

Each running **Tool** instance renders into its **own** Preact root — a container
the **Runtime** owns under the desktop element — rather than all instances sharing
one combined tree. A `requestUpdate` re-runs only that instance's **Declarator**
and re-renders only its root; one instance's redraw never re-runs another's
`onRender`.

## Before

`renderOnce()` re-ran _every_ instance's `onRender`, concatenated all windows into
one `WindowNode[]`, and handed the whole list to a single `toPreact(...)` →
`render()`. Any `requestUpdate` from any tool re-collected and re-rendered the
entire desktop.

## After

- The Runtime tracks a per-instance **dirty** set. A tool's `api.requestUpdate`
  marks _its_ instance dirty.
- Collection is per-instance: `renderInstance(instanceId)` runs only that
  instance's declarator and returns that instance's windows. The combined
  `runtime.render(): VNode` is gone.
- The Runtime owns mounting: a `Map<instanceId, container>` under a desktop
  element; `render(vnode, container)` per dirty instance; `render(null, container)`
  - drop the node on close. The Host shrinks to the desktop element, the imperative
    chrome layers (toasts / picks / inputs), and the palette.
- Cross-cutting state forces targeted re-renders: the focus ring is per-window, so
  `focusWindow` re-renders the two affected instances (newly- and previously-
  active), not all. z-order and position stay pure CSS (`position: fixed` +
  `zIndex`), so they need no cross-instance coordination.

The isolation _logic_ (which instances re-collect) is DOM-free and unit-tested via
`onRender` call-count behavior; the actual `render(vnode, container)` mounting is a
thin adapter, smoke-tested in the browser (consistent with the existing
renderer→DOM testing posture).

## Why

- It stops being possible for one tool to make another tool's `onRender` run —
  removing a whole class of cross-tool coupling, wasted work, and "why did my tool
  redraw?" surprises.
- **Custom widgets** (ADR-0007) hold live Preact mounts; partitioning instances
  into independent roots keeps those mounts cleanly scoped and isolates a throw in
  one instance's render from the rest of the desktop.
- It is the natural stepping-stone to pop-out as a live Portal (ADR-0002, amended):
  a window subtree can be re-targeted into a popup document precisely because the
  render pipeline is already per-instance rather than one global tree.

## Trade-offs accepted

- **More moving parts than one tree.** The Runtime now owns container DOM and a
  dirty set instead of returning a single VNode. We accept this for the isolation
  and the pop-out path; the alternative (single root + manual per-instance memo)
  kept a shared render pass where one instance's error could break the frame.
- **Cross-cutting redraws need explicit fan-out.** Anything genuinely global (focus
  ring today; a future theme toggle) must enumerate the instances it affects rather
  than relying on one big re-render. This is a small, explicit cost.
