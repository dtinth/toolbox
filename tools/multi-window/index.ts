import type { Api } from "../../src/runtime/index.ts";

export default function init(api: Api) {
  let open = true;

  api.onRender = () => {
    api.ui.window("Controls", () => {
      api.ui.label("This is the main window.");
      api.ui.button(open ? "Close second window" : "Open second window", {
        onClick: () => {
          open = !open;
          api.requestUpdate();
        },
      });
    });
    if (open) {
      api.ui.window("Second", () => {
        api.ui.label("This second window appears because the first declared it.");
      });
    }
  };
}
