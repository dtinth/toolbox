import type { Api } from "../../src/runtime/index.ts";

export default function init(api: Api) {
  api.onRender = () => {
    api.ui.window("Hello, world", () => {
      api.ui.label("Welcome to the toolbox.");
    });
  };
}
