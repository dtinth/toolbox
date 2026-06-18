import type { Api } from "../../api.d.ts";

export default function init(api: Api) {
  api.onRender = () => {
    api.ui.window.setTitle("Save demo");
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
  };
}
