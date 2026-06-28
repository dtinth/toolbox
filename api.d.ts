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

/** Reporter passed to a `withProgress` task. */
export interface Progress {
  /**
   * Advance the task's progress. `increment` (0–100) moves the bar by that
   * delta; `message` updates the detail line. The bar is indeterminate until
   * the first `increment`.
   */
  report(value: { message?: string; increment?: number }): void;
}

/** Options for `withProgress`. */
export interface ProgressOptions {
  title: string;
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
 * `confirm` / `message` are planned (see PLAN.md).
 */
export interface Dialog {
  /**
   * Show a VS Code-style quick pick. Resolves with the chosen item, or
   * `undefined` if dismissed (Escape / backdrop). Items keep their order;
   * the user can type to fuzzy-filter.
   */
  pick: <T extends QuickPickItem>(items: T[], opts?: QuickPickOptions) => Promise<T | undefined>;
  /**
   * Show a modal text-input prompt. Resolves with the entered string, or
   * `undefined` if dismissed (Escape / backdrop / Cancel).
   */
  input: (opts?: {
    title?: string;
    value?: string;
    placeholder?: string;
  }) => Promise<string | undefined>;
}

/**
 * A Preact virtual node, produced by `api.preact.h`. Opaque to tools — only
 * passed back to the runtime (as a Custom widget's render result).
 */
export interface VNode {
  type: unknown;
  props: unknown;
  key: unknown;
}

/** A writable reactive value (Preact signal). */
export interface Signal<T> {
  value: T;
  /** Read without subscribing the current reactive context. */
  peek(): T;
}

/** A derived, read-only reactive value. */
export interface ReadonlySignal<T> {
  readonly value: T;
  peek(): T;
}

/**
 * The reactive / hyperscript surface a **Custom widget** is built from — the
 * hand-declared subset of Preact we commit to (we do not re-export Preact's own
 * types, so the contract stays self-contained; the runtime's real bindings are
 * asserted to conform). Unlike `ui.*`, these are never gated by the collection
 * window: the signal factories are callable anywhere (create durable state in
 * `init` scope), while the `use*` hooks are valid only inside a render closure
 * (Preact enforces this). There is deliberately no `useRef` / `useEffect` — wire
 * DOM with a callback `ref` plus a signal.
 */
export interface Preact {
  /** Hyperscript: build a vnode. */
  h: (type: any, props?: any, ...children: any[]) => VNode;
  /** Group children without a wrapper element. */
  Fragment: unknown;
  signal: <T>(value: T) => Signal<T>;
  computed: <T>(fn: () => T) => ReadonlySignal<T>;
  effect: (fn: () => void | (() => void)) => () => void;
  batch: <T>(fn: () => T) => T;
  useSignal: <T>(value: T) => Signal<T>;
  useComputed: <T>(fn: () => T) => ReadonlySignal<T>;
  useSignalEffect: (fn: () => void | (() => void)) => void;
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
    /**
     * Fix the current window's content width to `width` CSS pixels for this
     * frame. Without it a window sizes to its content (long, unbreakable text
     * can push it past the viewport); with it the window keeps that width and
     * its contents clip / truncate instead.
     */
    setWidth(width: number): void;
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
  checkbox(
    label: string,
    opts: { checked: boolean; disabled?: boolean; onChange?: (checked: boolean) => void },
  ): void;
  /**
   * A single-select value chooser rendered as a horizontal **segmented control**
   * — the segment whose `value` equals the passed `value` is highlighted.
   * Selecting another segment fires `onChange(value)`. It picks a _value_, not a
   * view: the tool re-declares its UI for the new value (e.g. an Encrypt/Decrypt
   * mode flag). Distinct from a `checkbox` (one boolean) — this is one-of-N.
   */
  segmented(
    value: string,
    opts: {
      options: { value: string; label: string }[];
      onChange?: (value: string) => void;
    },
  ): void;
  copyableText(text: string): void;
  menu(label: string, cb: () => void): void;
  menuItem(label: string, opts?: { onClick?: () => void }): void;
  menuSeparator(): void;
  /**
   * A **Custom widget**: a leaf whose subtree is live Preact. `render` returns a
   * vnode (built with `api.preact.h`) and runs in Preact's own lifecycle, not in
   * the declarator — so it must not call `ui.*`. Drive it with **Signals**
   * (`api.preact`); mutating one repaints the widget without re-running
   * `onRender`. See ADR-0007.
   */
  custom(render: () => VNode): void;
  /**
   * Open a new identity group for the nodes that follow in this container. A
   * node's reconciliation identity is `(group, positionWithinGroup)`. With no
   * argument the group is the next ordinal (`2`, `3`, …); with `key` it is named.
   * Use it to keep a stable region's identity (and any **Custom widget** state)
   * from being disturbed by a variable region before it.
   */
  identityGroup(key?: string): void;
  /**
   * A focusable intake box that yields a File from choose-a-file, drop, or
   * paste. Pass the tool's current file (or null) for the metadata display;
   * `onFile` delivers a newly supplied one. Ambiguity (several files, or a
   * multi-type clipboard) is resolved via `api.dialog.pick`.
   *
   * With `readOnly: true` the box is output-only: no drop / paste / choose
   * intake (and `onFile` is unused), just the file's metadata, the drag-out
   * handle, and the export menu (open / copy / download).
   */
  file(
    file: File | null,
    opts: {
      onFile?: (file: File) => void;
      accept?: string;
      label?: string;
      readOnly?: boolean;
    },
  ): void;
}

/** The per-instance object the runtime passes to a tool's `init(api)`. */
export interface Api {
  /** The declarator: assign a function that declares the tool's UI for a frame. */
  onRender: () => void;
  ui: Ui;
  /**
   * The reactive / hyperscript surface for **Custom widgets** (`ui.custom`).
   * Not gated by the collection window — usable in `init` scope and inside a
   * widget's render closure.
   */
  preact: Preact;
  /**
   * Build a class string and register its CSS at runtime (UnoCSS, Tailwind-v4
   * vocabulary). Use this to style a tool instead of bare class names — Tailwind
   * is an implementation detail of the runtime's chrome, not something tools
   * rely on. Classes are namespaced (`tw-…`) so they can't clash with the
   * chrome. Dynamic values still go through inline `style`. See ADR-0009.
   *
   *     h("button", { class: api.tw`rounded-full bg-toolbox-accent` })
   */
  tw: (
    strings: TemplateStringsArray,
    ...exprs: (string | number | false | null | undefined)[]
  ) => string;
  /** Request a redraw (re-runs `onRender`). */
  requestUpdate: () => void;
  /** Register a per-frame tick callback; returns an unsubscribe function. */
  tick: (cb: () => void) => () => void;
  toast: {
    show(message: string, opts?: { loading?: boolean; duration?: number }): ToastHandle;
  };
  dialog: Dialog;
  /**
   * Run `task` while showing a progress toast titled `options.title`. Resolves
   * with the task's result and dismisses the toast; if the task throws, shows
   * an error toast and rethrows. VS Code-style.
   */
  withProgress: <T>(
    options: ProgressOptions,
    task: (progress: Progress) => Promise<T>,
  ) => Promise<T>;
  /** Close this tool instance. */
  dispose: () => void;
}
