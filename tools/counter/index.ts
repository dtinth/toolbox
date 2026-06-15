import type { Api } from "../../src/runtime/index.ts";

export default function init(api: Api) {
  let count = 0;
  api.onRender = () => {
    api.ui.window.setTitle("Counter");
    api.ui.row(() => {
      api.ui.label(`count: ${count}`);
      api.ui.button("+", {
        onClick: () => {
          count++;
          api.requestUpdate();
        },
      });
      api.ui.button("-", {
        onClick: () => {
          count--;
          api.requestUpdate();
        },
      });
      api.ui.button("reset", {
        onClick: () => {
          count = 0;
          api.requestUpdate();
        },
      });
    });
  };
}
