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

/** An entry shown in a quick pick (see `api.dialog.pick`). */
export interface QuickPickItem {
  label: string;
  description?: string;
  detail?: string;
}

/** Options for a quick pick. */
export interface QuickPickOptions {
  title?: string;
  placeholder?: string;
}

/**
 * Modal, Promise-returning dialogs rendered by the host (not `ui.*` collector
 * nodes). Scoped to the calling tool. Currently only `pick` is implemented;
 * `confirm` / `input` / `message` are planned (see PLAN.md).
 */
export interface Dialog {
  /**
   * Show a VS Code-style quick pick. Resolves with the chosen item, or
   * `undefined` if dismissed (Escape / backdrop). Items keep their order;
   * the user can type to fuzzy-filter.
   */
  pick: <T extends QuickPickItem>(items: T[], opts?: QuickPickOptions) => Promise<T | undefined>;
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
  /**
   * A focusable intake box that yields a File from choose-a-file, drop, or
   * paste. Pass the tool's current file (or null) for the metadata display;
   * `onFile` delivers a newly supplied one. Ambiguity (several files, or a
   * multi-type clipboard) is resolved via `api.dialog.pick`.
   */
  file(
    file: File | null,
    opts: { onFile: (file: File) => void; accept?: string; label?: string },
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
  dialog: Dialog;
  /** Close this tool instance. */
  dispose: () => void;
}
