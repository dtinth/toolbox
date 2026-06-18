import type { Dialog } from "./dialog-center.ts";

// Normalise everything a user can hand a tool — chosen files, dropped files,
// dropped/pasted text, pasted blobs — into File objects. "Everything the user
// hands a tool is bytes, and bytes-with-a-name is a File." See ADR-0005.

const MIME_EXT: Record<string, string> = {
  "application/octet-stream": "bin",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
  "application/json": "json",
  "application/zip": "zip",
  "text/plain": "txt",
  "text/html": "html",
  "text/csv": "csv",
  "text/markdown": "md",
};

/** Best-effort file extension for a MIME type (no leading dot). */
export function extensionForMime(mime: string): string {
  const base = (mime.split(";")[0] ?? "").trim().toLowerCase();
  if (MIME_EXT[base]) return MIME_EXT[base]!;
  const slash = base.indexOf("/");
  if (slash >= 0) {
    const sub = base.slice(slash + 1);
    if (sub && !sub.includes("+") && /^[a-z0-9.-]+$/.test(sub)) {
      return sub.replace(/^x-/, "");
    }
  }
  return "bin";
}

/** A synthesised name for a nameless payload, e.g. `pasted-1718.png`. */
export function synthName(mime: string, now: number = Date.now()): string {
  return `pasted-${now}.${extensionForMime(mime)}`;
}

/** Wrap a Blob as a File. A Blob that is already a File is returned unchanged. */
export function blobToFile(blob: Blob, now: number = Date.now()): File {
  if (blob instanceof File) return blob;
  const type = blob.type || "application/octet-stream";
  return new File([blob], synthName(type, now), { type: blob.type, lastModified: now });
}

/** Wrap a string as a `text/plain` File. */
export function textToFile(text: string, now: number = Date.now()): File {
  return new File([text], synthName("text/plain", now), { type: "text/plain", lastModified: now });
}

export interface DataTransferLike {
  files: ArrayLike<File>;
  getData(type: string): string;
}

/**
 * Candidate Files from a drop or a paste event's `clipboardData`. Real files
 * win; otherwise a text payload (uri-list preferred, then plain) becomes a
 * single `text/plain` File.
 */
export function filesFromDataTransfer(dt: DataTransferLike, now: number = Date.now()): File[] {
  const files = Array.from(dt.files);
  if (files.length > 0) return files;
  const text = dt.getData("text/uri-list") || dt.getData("text/plain");
  if (text) return [textToFile(text, now)];
  return [];
}

export interface ClipboardItemLike {
  types: ReadonlyArray<string>;
  getType(type: string): Promise<Blob>;
}

/**
 * Candidate Files from the async Clipboard API (`navigator.clipboard.read()`).
 * Each representation of each item becomes one candidate, in order, so a
 * multi-type clipboard yields several candidates for the quick pick to choose
 * between.
 */
export async function filesFromClipboardItems(
  items: ReadonlyArray<ClipboardItemLike>,
  now: number = Date.now(),
): Promise<File[]> {
  const out: File[] = [];
  for (const item of items) {
    for (const type of item.types) {
      out.push(blobToFile(await item.getType(type), now));
    }
  }
  return out;
}

/**
 * Reduce candidate Files to the one the tool should receive. Zero or one
 * candidate resolves immediately; more than one is disambiguated through the
 * quick pick (label = file name). With no pick available, the first wins.
 */
export async function chooseFile(files: File[], pick?: Dialog["pick"]): Promise<File | undefined> {
  if (files.length <= 1) return files[0];
  if (!pick) return files[0];
  const items = files.map((file) => ({
    label: file.name,
    description: `${file.type || "application/octet-stream"} · ${file.size} B`,
    file,
  }));
  const chosen = await pick(items, { title: "Choose what to use" });
  return chosen?.file;
}
