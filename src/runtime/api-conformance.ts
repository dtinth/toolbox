// Conformance assertion: the runtime's real API types must be structurally
// equivalent to the hand-authored contract in `api.d.ts`, in BOTH directions,
// so neither can drift. Each assignment below fails to compile if its pair is
// not mutually assignable, which fails `vp check` (tsc). This module is
// type-only in effect and is never imported by the runtime bundle.
//
// Contract-first workflow: to add a primitive, declare it in `api.d.ts` first
// (this file goes red), then implement it in the runtime until green.
// See docs/adr/0004-api-contract-as-dts.md.

import type { Api as RuntimeApi } from "./runtime.ts";
import type { Ui as RuntimeUi } from "./collector.ts";
import type { ToastHandle as RuntimeToastHandle } from "./toast-center.ts";
import type {
  Api as ContractApi,
  ToastHandle as ContractToastHandle,
  Ui as ContractUi,
} from "../../api.d.ts";

export function __assertApiConformance(
  rApi: RuntimeApi,
  cApi: ContractApi,
  rUi: RuntimeUi,
  cUi: ContractUi,
  rToast: RuntimeToastHandle,
  cToast: ContractToastHandle,
): void {
  // runtime → contract (the runtime delivers at least the contract)
  const _apiToContract: ContractApi = rApi;
  const _uiToContract: ContractUi = rUi;
  const _toastToContract: ContractToastHandle = rToast;
  // contract → runtime (the runtime promises no more than the contract)
  const _apiToRuntime: RuntimeApi = cApi;
  const _uiToRuntime: RuntimeUi = cUi;
  const _toastToRuntime: RuntimeToastHandle = cToast;

  void _apiToContract;
  void _uiToContract;
  void _toastToContract;
  void _apiToRuntime;
  void _uiToRuntime;
  void _toastToRuntime;
}
