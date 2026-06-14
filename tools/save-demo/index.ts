import type { Api } from "../../src/runtime/index.ts";

export default function init(api: Api) {
  api.onRender = () => {
    api.ui.window("Save demo", () => {
      api.ui.label("Click the button to simulate a save:");
      api.ui.button("save", {
        onClick: () => {
          const t = api.toast.show("Saving…", { loading: true });
          setTimeout(() => {
            t.update({ message: "Saved!", loading: false });
          }, 1200);
        },
      });
      api.ui.button("quick toast", {
        onClick: () => {
          api.toast.show("Quick message", { loading: false });
        },
      });
    });
  };
}
