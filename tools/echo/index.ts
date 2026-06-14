import type { Api } from "../../src/runtime/index.ts";

export default function init(api: Api) {
  let text = "";
  api.onRender = () => {
    api.ui.window("Echo", () => {
      api.ui.textInput(text, {
        placeholder: "Type something",
        onChange: (v) => {
          text = v;
          api.requestUpdate();
        },
      });
      api.ui.label(text ? `> ${text}` : "(empty)");
    });
  };
}
