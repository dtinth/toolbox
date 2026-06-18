import type { Api } from "../../api.d.ts";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function init(api: Api) {
  let file: File | null = null;

  api.onRender = () => {
    api.ui.window.setTitle("Blob Inspector");
    api.ui.file(file, {
      label: "Drop, paste, or choose a blob to inspect",
      onFile: (f) => {
        file = f;
        api.requestUpdate();
      },
    });

    if (file) {
      api.ui.label(`Name: ${file.name}`);
      api.ui.label(`Type: ${file.type || "application/octet-stream"}`);
      api.ui.label(`Size: ${formatBytes(file.size)} (${file.size} bytes)`);
      api.ui.label(`Modified: ${new Date(file.lastModified).toLocaleString()}`);
      api.ui.row(() => {
        api.ui.button("Clear", {
          onClick: () => {
            file = null;
            api.requestUpdate();
          },
        });
      });
    }
  };
}
