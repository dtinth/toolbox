import type { Api, Progress } from "../../api.d.ts";

const URL_KEY = "uploader.uploadUrl";
const COMPRESS_KEY = "uploader.compressWebp";
const loadUrl = () => localStorage.getItem(URL_KEY) ?? "";
const saveUrl = (v: string) => localStorage.setItem(URL_KEY, v);
const loadCompress = () => localStorage.getItem(COMPRESS_KEY) !== "0";
const saveCompress = (v: boolean) => localStorage.setItem(COMPRESS_KEY, v ? "1" : "0");

const COMPRESSIBLE = new Set(["image/png", "image/jpeg", "image/bmp", "image/webp"]);
async function maybeCompress(file: File): Promise<File> {
  if (!COMPRESSIBLE.has(file.type) || file.size <= 128 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.85 });
    if (blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".webp";
    return new File([blob], name, { type: "image/webp" });
  } catch {
    return file;
  }
}

function uploadFile(url: string, file: File, progress: Progress): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    let last = 0;
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      progress.report({ increment: pct - last, message: `Uploading… ${pct}%` });
      last = pct;
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText) as { url?: unknown };
          if (typeof data.url === "string") resolve(data.url);
          else reject(new Error("Upload response had no 'url' field"));
        } catch {
          reject(new Error("Upload response was not valid JSON"));
        }
      } else {
        reject(new Error(`Upload failed (HTTP ${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    const fd = new FormData();
    fd.append("file", file, file.name);
    xhr.send(fd);
  });
}

export default function init(api: Api) {
  let file: File | null = null;
  let resultUrl: string | null = null;

  const promptForUrl = async (): Promise<string> => {
    const entered = await api.dialog.input({
      title: "Upload URL",
      value: loadUrl(),
      placeholder: "https://example.com/upload",
    });
    if (entered != null) {
      saveUrl(entered);
      api.requestUpdate();
      return entered;
    }
    return loadUrl();
  };

  const doUpload = async () => {
    if (!file) {
      api.toast.show("Choose a file first", { duration: 3000 });
      return;
    }
    let url = loadUrl();
    if (!url) {
      url = await promptForUrl();
      if (!url) return;
    }
    const chosen = file;
    await api.withProgress({ title: "Uploading" }, async (progress) => {
      progress.report({ message: "Preparing…" });
      const toSend = loadCompress() ? await maybeCompress(chosen) : chosen;
      resultUrl = await uploadFile(url, toSend, progress);
      api.requestUpdate();
    });
  };

  api.onRender = () => {
    api.ui.window.setTitle("Uploader");
    api.ui.menu("Settings", () => {
      api.ui.menuItem("Set upload URL…", { onClick: () => void promptForUrl() });
    });
    api.ui.file(file, {
      label: "Choose, drop, or paste a file to upload",
      onFile: (f) => {
        file = f;
        api.requestUpdate();
      },
    });
    api.ui.checkbox("Compress images to WebP", {
      checked: loadCompress(),
      onChange: (v) => {
        saveCompress(v);
        api.requestUpdate();
      },
    });
    api.ui.button("Upload", { onClick: () => void doUpload().catch(() => {}) });
    if (resultUrl) {
      api.ui.label("Uploaded:");
      api.ui.copyableText(resultUrl);
    }
  };
}
