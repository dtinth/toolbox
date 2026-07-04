import type { Api, Progress } from "../../api.d.ts";

// Bezel assets (fetched at runtime). Both are native @2x; content rects are the
// transparent screen opening in @2x device pixels. Horizontal numbers are from
// Apple's Figma export; the vertical bezel is a separate export (not an exact
// rotation of the horizontal), so its rect is measured from the PNG's alpha
// channel: the opaque bezel ends at x 145/2210 and y 139/2892.
interface Bezel {
  url: string;
  w: number;
  h: number;
  content: { x: number; y: number; w: number; h: number };
}
const HORIZONTAL: Bezel = {
  url: "https://im.dt.in.th/ipfs/bafybeifpeej5xjyjrcz54xiwtifarao5hxl74hvnprplcnoddkuyyknxyy/ipad-bezel.png",
  w: 3064,
  h: 2364,
  content: { x: 152, y: 132, w: 2752, h: 2068 },
};
const VERTICAL: Bezel = {
  url: "https://im.dt.in.th/ipfs/bafybeiet7kco3c3nrzi5udkp3og5tfnhnzcmp4u3alks7qaldy7bjavcui/image.png",
  w: 2364,
  h: 3064,
  content: { x: 146, y: 140, w: 2064, h: 2752 },
};

// Cache fetched bezel bytes so re-framing doesn't refetch the ~1MB asset.
const bezelCache = new Map<string, Blob>();

async function fetchBezel(bezel: Bezel, progress: Progress): Promise<Blob> {
  const cached = bezelCache.get(bezel.url);
  if (cached) return cached;

  const res = await fetch(bezel.url);
  if (!res.ok) throw new Error(`Couldn't load the device frame (HTTP ${res.status})`);
  const total = Number(res.headers.get("content-length") ?? 0);

  let blob: Blob;
  if (res.body && total > 0) {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    let lastPct = 0;
    progress.report({ message: "Loading device frame…", increment: 0 });
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      const pct = Math.floor((loaded / total) * 100);
      if (pct > lastPct) {
        progress.report({ increment: pct - lastPct });
        lastPct = pct;
      }
    }
    blob = new Blob(chunks as BlobPart[], { type: "image/png" });
  } else {
    progress.report({ message: "Loading device frame…" });
    blob = await res.blob();
  }

  bezelCache.set(bezel.url, blob);
  return blob;
}

// Composite the screenshot into the bezel per the agreed algorithm: shrink the
// frame if the image is too small (never upscale either), cover-fit + crop the
// image into the content rect, then draw the bezel on top.
function composite(img: ImageBitmap, bezel: ImageBitmap, spec: Bezel): Promise<Blob> {
  const c = spec.content;
  const f = Math.min(1, img.width / c.w, img.height / c.h);
  const cw = Math.round(spec.w * f);
  const ch = Math.round(spec.h * f);

  const canvas = new OffscreenCanvas(cw, ch);
  const ctx = canvas.getContext("2d")!;

  const rx = c.x * f;
  const ry = c.y * f;
  const rw = c.w * f;
  const rh = c.h * f;
  const cover = Math.max(rw / img.width, rh / img.height); // ≤ 1, never upscales
  const dw = img.width * cover;
  const dh = img.height * cover;

  ctx.save();
  ctx.beginPath();
  ctx.rect(rx, ry, rw, rh);
  ctx.clip();
  ctx.drawImage(img, rx + (rw - dw) / 2, ry + (rh - dh) / 2, dw, dh);
  ctx.restore();

  ctx.drawImage(bezel, 0, 0, cw, ch);
  return canvas.convertToBlob({ type: "image/png" });
}

export default function init(api: Api) {
  let output: File | null = null;

  async function frame(input: File) {
    try {
      const result = await api.withProgress({ title: "Framing screenshot" }, async (progress) => {
        const img = await createImageBitmap(input);
        const spec = img.height > img.width ? VERTICAL : HORIZONTAL;
        const bezelBlob = await fetchBezel(spec, progress);
        progress.report({ message: "Compositing…" });
        const bezel = await createImageBitmap(bezelBlob);
        const blob = await composite(img, bezel, spec);
        return new File([blob], "ipad.png", { type: "image/png" });
      });
      output = result;
      api.requestUpdate();
    } catch {
      // withProgress already surfaced an error toast.
    }
  }

  api.onRender = () => {
    api.ui.window.setTitle("iPad Frame");
    api.ui.label("Paste, drop, or choose an iPad screenshot to drop it into a device frame.");
    api.ui.file(null, {
      accept: "image/*",
      label: "Screenshot — paste / drop / choose",
      onFile: (f) => void frame(f),
    });
    api.ui.label("Framed result (copy / drag out / open / download):");
    api.ui.file(output, {
      readOnly: true,
      label: "The framed PNG will appear here",
    });
  };
}
