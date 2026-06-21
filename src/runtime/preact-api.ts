// The runtime's real binding for the contract's `Preact` surface (api.preact).
// This assignment is the conformance gate: if Preact's real `h` / signal types
// stop matching the hand-declared subset in api.d.ts, this file fails to compile.
import { Fragment, h } from "preact";
import {
  batch,
  computed,
  effect,
  signal,
  useComputed,
  useSignal,
  useSignalEffect,
} from "@preact/signals";
import type { Preact } from "../../api.d.ts";

export const preactApi: Preact = {
  h,
  Fragment,
  signal,
  computed,
  effect,
  batch,
  useSignal,
  useComputed,
  useSignalEffect,
};
