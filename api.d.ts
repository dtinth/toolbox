// The toolbox tool API contract.
//
// This is the hand-authored, canonical surface a tool's `init(api)` receives.
// It depends only on standard DOM lib types. The runtime's real types are
// asserted to conform to this file (see src/runtime/api-conformance.ts), so
// the two cannot drift. Tools import their types from here, not from the
// runtime internals. See docs/adr/0004-api-contract-as-dts.md.

/** Handle returned by `api.toast.show`, for updating or dismissing a toast. */
export interface ToastHandle {
  update(opts: { message?: string; loading?: boolean }): void;
  dismiss(): void;
}

/**
 * The IMGUI primitive surface. Calls are collected by the runtime during the
 * tool's declarator and turned into a vDOM tree. The current window is the one
 * whose `window(...)` callback is on the call stack (the implicit main window
 * at the top level).
 */
export interface Ui {
  window: {
    /** Declare a sub-window this frame (title defaults to the id). */
    (id: string, cb: () => void): void;
    /** Declare a sub-window this frame with an explicit title. */
    (id: string, title: string, cb: () => void): void;
    /** Override the current window's display title for this frame. */
    setTitle(newTitle: string): void;
    /** Set the current window's close handler. */
    onClose(handler: () => void): void;
  };
  label(text: string): void;
  button(label: string, opts?: { onClick?: () => void }): void;
  row(cb: () => void): void;
  textInput(value: string, opts?: { placeholder?: string; onChange?: (v: string) => void }): void;
  textarea(
    value: string,
    opts?: { placeholder?: string; onChange?: (v: string) => void; rows?: number },
  ): void;
}

/** The per-instance object the runtime passes to a tool's `init(api)`. */
export interface Api {
  /** The declarator: assign a function that declares the tool's UI for a frame. */
  onRender: () => void;
  ui: Ui;
  /** Request a redraw (re-runs `onRender`). */
  requestUpdate: () => void;
  /** Register a per-frame tick callback; returns an unsubscribe function. */
  tick: (cb: () => void) => () => void;
  toast: {
    show(message: string, opts?: { loading?: boolean; duration?: number }): ToastHandle;
  };
  /** Close this tool instance. */
  dispose: () => void;
}
