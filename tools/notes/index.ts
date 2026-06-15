import type { Api } from "../../src/runtime/index.ts";

const STORAGE_KEY = "toolbox:notes:text";

export default function init(api: Api) {
  let text = localStorage.getItem(STORAGE_KEY) ?? "";

  api.onRender = () => {
    api.ui.window.setTitle("Notes");
    api.ui.textarea(text, {
      placeholder: "Type to save",
      rows: 10,
      onChange: (v) => {
        text = v;
        localStorage.setItem(STORAGE_KEY, text);
        api.requestUpdate();
      },
    });
    api.ui.label(`Saved (${text.length} chars)`);
  };
}
