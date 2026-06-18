import type { Api } from "../../api.d.ts";

export default function init(api: Api) {
  let taps: number[] = [];
  let lastTap = 0;
  let now = Date.now();

  api.onRender = () => {
    let bpm = 0;
    if (taps.length >= 2) {
      const recent = taps.slice(-4);
      const span = (recent[recent.length - 1]! - recent[0]!) / 1000;
      if (span > 0) bpm = Math.round(((recent.length - 1) / span) * 60);
    }
    const secondsSinceLastTap = lastTap ? (now - lastTap) / 1000 : 0;

    api.ui.window.setTitle("Tap BPM");
    api.ui.row(() => {
      api.ui.label(`${bpm || "—"} BPM`);
      api.ui.button("tap", {
        onClick: () => {
          const t = Date.now();
          if (lastTap && t - lastTap > 2000) taps = [];
          taps.push(t);
          lastTap = t;
          api.requestUpdate();
        },
      });
      api.ui.button("reset", {
        onClick: () => {
          taps = [];
          lastTap = 0;
          api.requestUpdate();
        },
      });
    });
    api.ui.label(
      secondsSinceLastTap < 2 && lastTap
        ? `last tap ${secondsSinceLastTap.toFixed(1)}s ago`
        : "tap the button to a beat",
    );
  };

  api.tick(() => {
    const t = Date.now();
    if (now === t) return;
    now = t;
    if (lastTap && t - lastTap < 2000) api.requestUpdate();
  });
}
