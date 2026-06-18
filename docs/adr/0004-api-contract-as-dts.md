# 0004: The tool API is a hand-authored contract in `api.d.ts`

The shape of the `api` object a tool's `init(api)` receives is defined in a
single, hand-authored declaration file (`api.d.ts`) that depends only on
standard DOM lib types (`File`, `Blob`, `Promise`, …). Tools import their
`Api` / `Ui` types from this contract, **not** from `src/runtime/`. A
type-only conformance module asserts that the runtime's real `Api` / `Ui`
types are structurally equivalent to the contract (assignable both
directions), so `vp check` (tsc) fails the moment implementation and contract
drift apart.

## Why

- **Readable in one place.** An agent or tool author can read the entire
  tool-facing surface in one impl-free file, without wading through the
  runtime. This was the deciding motivation: keep the contract legible.
- **Decoupling.** Tools depend on a published contract, not runtime internals.
  This restores the ADR-0001 goal that a tool could in principle target a
  different runtime. Today tools do
  `import type { Api } from "../../src/runtime/index.ts"`, reaching into the
  guts — `api.d.ts` removes that coupling.
- **Honesty over aspiration.** The contract lists only what is implemented;
  conformance prevents the drift that the old prose API list in `CONTEXT.md`
  suffered (it advertised many primitives — `column`, `heading`, `code`,
  `checkbox`, `select`, `slider`, `image`, `menu*`, `draggable`, `dropArea`,
  `shortcuts`, `dialog` — that were never built).
- **Publishable.** `api.d.ts` can ship as the toolbox's public type surface.

## How

- `api.d.ts` is **canonical**; the runtime conforms to it. It is _not_
  generated from the runtime.
- **Contract-first workflow:** a new primitive is added to `api.d.ts` first
  (conformance goes red), then implemented until green — matching the
  project's tracer-bullet / TDD process.
- Conformance is a tsc-checked type assertion module with no runtime cost.

## Trade-offs accepted

- **Two edit sites.** Adding a primitive means touching both the contract and
  the implementation. Accepted: the conformance check turns any drift into a
  compile error, and the single readable contract is worth the small
  duplication.
- **Generation was rejected.** Emitting `api.d.ts` from the runtime
  (`tsc --emitDeclarationOnly`, api-extractor) removes hand-maintenance but
  makes the "definition" a mirror of the implementation — it cannot express
  intent, cannot catch the implementation over-exposing, and produces noisier
  output than a curated file.
