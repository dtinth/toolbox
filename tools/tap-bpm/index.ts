import type { Api } from "../../api.d.ts";
import { estimateBpm } from "./bpm.ts";

// Gap (ms) after which a new tap starts a fresh measurement.
const RESET_GAP = 2000;

export default function init(api: Api) {
  const { h, signal } = api.preact;
  let taps: number[] = [];
  // Drives the tap pad's flash. Written from a click handler and a setTimeout —
  // both outside onRender — so the pad repaints via the signal alone, without
  // re-running the declarator (ADR-0007).
  const lit = signal(false);

  // Register on pointer DOWN — a beat lands on the press, not the release, so
  // tapping on down is what musicians expect and is the most accurate timing.
  const tap = (e: PointerEvent) => {
    if (e.button !== 0) return; // ignore secondary mouse buttons
    e.preventDefault(); // suppress the focus/selection ghost + synthesized click
    const t = Date.now();
    if (taps.length && t - taps[taps.length - 1]! > RESET_GAP) taps = [];
    taps.push(t);
    lit.value = true;
    setTimeout(() => {
      lit.value = false;
    }, 110);
    api.requestUpdate();
  };

  const reset = () => {
    taps = [];
    api.requestUpdate();
  };

  api.onRender = () => {
    api.ui.window.setTitle("Tap BPM");
    api.ui.window.setWidth(260);

    const { bpm, confidence } = estimateBpm(taps);

    // The tap pad is a Custom widget: a live Preact button driven by the `lit`
    // signal for instant tactile feedback, independent of the declarator.
    api.ui.custom(() =>
      h(
        "button",
        {
          type: "button",
          onPointerDown: tap,
          class:
            "self-center w-40 h-40 rounded-full font-mono text-2xl tracking-widest select-none touch-manipulation " +
            "bg-toolbox-accent text-toolbox-deepest shadow-xl transition-transform duration-100 " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focused",
          style: { transform: lit.value ? "scale(0.93)" : "scale(1)" },
        },
        "TAP",
      ),
    );

    api.ui.label(bpm == null ? "— BPM" : `${bpm.toFixed(1)} BPM`);
    api.ui.label(
      confidence == null
        ? "keep tapping to a steady beat…"
        : `${Math.round(confidence * 100)}% sure it's within ±0.5 BPM`,
    );
    api.ui.button("reset", { onClick: reset });
  };
}
