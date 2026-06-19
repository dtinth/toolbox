# 0006: Menus are an in-window collector primitive rendered as a top strip with portaled dropdowns

In-window menus are re-introduced as **collector** primitives: `ui.menu(label,
cb)` declares a menu, `ui.menuItem(label, { onClick })` declares an action item
inside it, and `ui.menuSeparator()` groups items. They are declared in the tool's
declarator each frame, exactly like `ui.button` / `ui.row`. The runtime renders a
tool's menus as a **menu bar strip at the top of the window body**; clicking a
menu opens its **dropdown, portaled to `document.body`** and positioned with
floating-ui, so it floats over (and past) the window's `overflow-hidden`.

## Why

- **Menus are tool-declared content, not host chrome.** What menus a window has,
  and what their items do, is the tool's concern and changes per frame with tool
  state — so menus belong in the collector/vDOM, diffed like every other
  `ui.*` node, not in the imperative host layer (which is reserved for the
  `api.dialog` family, toasts, and progress that must survive pop-out).
- **Reuse the proven dropdown mechanism.** The `ui.file` `…` menu already solves
  "a popover must escape a clipped window" by portaling to `document.body` and
  positioning with floating-ui (see [[windows-clip-popovers-portal]] /
  ADR direction). Menu dropdowns reuse that mechanism rather than removing the
  window's `overflow-hidden`.
- **In the body, not the title bar.** A strip at the top of the window body keeps
  the title bar free for its real jobs — the drag handle and the close button —
  and avoids coupling a general File/Edit/Help system to title-bar chrome. It
  also generalises cleanly to multiple menus per window.

## Trade-offs accepted

- **A second portal-dropdown implementation, for now.** The `ui.file` `…` menu
  and `ui.menu` will each portal+position their own dropdown until the shared
  mechanism is extracted. Accepted: prove the primitive first, refactor the
  common dropdown host later (two adapters = a real seam).
- **Menu bar consumes vertical space in the window body.** A window with menus is
  slightly shorter for content. Accepted as the cost of an in-body bar; tools
  without menus pay nothing (no `ui.menu` calls → no strip).
- **Not a native OS menu bar.** Menus are in-app, per-window, and do not merge
  into a global application menu. Consistent with the toolbox being its own
  desktop, not the host OS.

## History

The menu types (`ui.menu` / `ui.menuItem` / `ui.menuSeparator`) existed in an
early `collector.ts` but were removed because no tool rendered them (see
PLAN.md "Runtime capabilities (typed but unrendered)"). The **uploader** tool is
the first tool that needs an in-window menu — its "Settings → Set upload URL…"
item — and drives their re-introduction, this time actually rendered.
