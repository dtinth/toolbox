import type { Api } from "../../api.d.ts";

export default function init(api: Api) {
  api.onRender = () => {
    api.ui.window.setTitle("Hello, world");
    api.ui.label("Welcome to the toolbox.");
  };
}
