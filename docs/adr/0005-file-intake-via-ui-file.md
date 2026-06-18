# 0005: File intake is `ui.file`; generic `ui.dropArea` / `ui.draggable` deferred

External data enters a tool through a dedicated `ui.file` primitive: a
focusable box that accepts a file via choose-a-file, drop, or paste, and always
yields **exactly one** `File`. Every source is normalised to a `File` (a named
`Blob`): nameless/typed-only payloads (a pasted image, dropped text) get a
synthesised name, and text is wrapped as a `text/plain` File — _everything the
user hands a tool is bytes_. Any ambiguity (several dropped files, or a
clipboard payload carrying multiple representations) is resolved through
`api.dialog.pick` (see the **Quick pick** concept), never a silent guess.

## Why

- **The real need is intake**, not moving data between tools: get a `File`
  from the OS or clipboard _into_ a tool. One widget unifies the three sources
  behind a single `onFile(file)` contract.
- **Everything-is-bytes** keeps the type model trivial — one yielded type
  (`File`), so consuming tools never branch on source.
- **One disambiguation path.** Multiple files and multi-type paste both route
  through `api.dialog.pick`, rather than each growing its own ad-hoc UI.
- **Focus-scoped paste.** The box owns a `tabindex`; paste binds to the focused
  _box_, so multiple file inputs in one window never contend for a paste. A
  hover/touch `…` menu (_Choose file…_ / _Paste from clipboard_) keeps it
  usable without a keyboard.

## Supersedes

This supersedes, for the **intake** use case, the direction recorded only as
prose in `PLAN.md` ("a file-picker / drop-area tool would drive `ui.dropArea`")
and the `CONTEXT.md` note that "in v1 only `ui.dropArea` accepts drops". No
prior ADR covered `ui.dropArea`, so nothing is struck at the ADR level; the
superseded lines in `PLAN.md` are marked and point here.

The **generic** `ui.dropArea` / `ui.draggable` system — inter-tool
drag-and-drop over arbitrary MIME types, for moving data _between_ tools —
remains a separate, deferred concern. It is neither a prerequisite for nor
replaced by `ui.file`; the two solve different problems and may both exist
later.

## Trade-offs accepted

- **Two new runtime capabilities up front.** `ui.file` depends on
  `api.dialog.pick` existing. Accepted: the quick pick is independently useful
  (VS Code-style chooser, reused from the Cmd-K palette UX) and is built first
  as its own tracer bullet.
- **No content preview in v1.** The first blob-inspector tool shows metadata
  only; `ui.image` and type-aware previews are deferred to later bullets so
  this work does not balloon into a third new primitive.
