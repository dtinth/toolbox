// Pop-out (ADR-0002, issue #29): show a Window in a real browser popup.
//
// The popup is only a place to paint. The tool's code, closures and signals stay
// in this document. The renderer moves the Window's content element into the
// popup's DOM and keeps rendering into it from here, so nothing unmounts on the
// way out or back, and every event handler still runs in this document.

import { type WindowManager } from "./window-manager.ts";

/** What the renderer needs to know about pop-out. */
export interface PopoutContext {
  /** The element in the popup to put this Window's content in, or null when it is not popped out. */
  targetOf: (id: string) => HTMLElement | null;
  /**
   * Pop the Window out, about where it sits now (`rect`, in viewport pixels).
   * Must be called from a click: `window.open` needs a user gesture. Does
   * nothing when the browser blocks the popup.
   */
  popOut: (id: string, title: string, rect: PopoutRect) => void;
  /** Bring the Window back, and close its popup. */
  popIn: (id: string) => void;
}

export interface PopoutRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PopoutController {
  context: PopoutContext;
  /** Bring back every Window whose id starts with `prefix` (all with ""). */
  popInAll: (prefix: string) => void;
  /** Keep a popup's title in step with its Window's. */
  setTitle: (id: string, title: string) => void;
}

interface Popup {
  win: Window;
  container: HTMLElement;
}

/**
 * Copy this page's styles into the popup, so Tailwind classes and theme tokens
 * mean the same there. Copies whatever is in `<head>` now: the built `<link>`
 * in production, or Vite's `<style>` tags in development.
 */
function copyStyles(from: Document, to: Document): void {
  for (const node of from.head.querySelectorAll('style, link[rel="stylesheet"]')) {
    const copy = to.importNode(node, true) as HTMLElement;
    if (copy instanceof to.defaultView!.HTMLLinkElement) {
      // An absolute href, since the popup's own URL is about:blank.
      copy.href = (node as HTMLLinkElement).href;
    }
    to.head.append(copy);
  }
  to.documentElement.className = from.documentElement.className;
  to.body.className = "toolbox-popout bg-toolbox-surface text-toolbox-text";
}

export function createPopoutController(wm: WindowManager, redraw: () => void): PopoutController {
  const popups = new Map<string, Popup>();

  function popIn(id: string): void {
    const popup = popups.get(id);
    popups.delete(id);
    wm.setPoppedOut(id, false);
    if (popup !== undefined && !popup.win.closed) {
      popup.win.close();
    }
    redraw();
  }

  function popOut(id: string, title: string, rect: PopoutRect): void {
    if (popups.has(id)) {
      popups.get(id)!.win.focus();
      return;
    }
    const left = Math.round(globalThis.screenX + rect.x);
    const top = Math.round(globalThis.screenY + rect.y);
    const features = `popup,width=${Math.round(rect.w)},height=${Math.round(rect.h)},left=${left},top=${top}`;
    const win = globalThis.open("", "", features);
    if (win === null) {
      return;
    }
    const doc = win.document;
    doc.title = title;
    copyStyles(document, doc);
    const container = doc.createElement("div");
    container.className = "flex flex-col gap-1 p-3 h-screen overflow-auto box-border";
    doc.body.style.margin = "0";
    doc.body.append(container);
    popups.set(id, { win, container });
    wm.setPoppedOut(id, true);
    // Closing the popup brings the Window back; it never closes the Window.
    win.addEventListener("pagehide", () => {
      if (popups.get(id)?.win === win) {
        popIn(id);
      }
    });
    redraw();
  }

  // A popup outlives nothing: when this page goes, its popups go with it.
  globalThis.addEventListener?.("pagehide", () => {
    for (const { win } of popups.values()) {
      win.close();
    }
  });

  return {
    context: {
      targetOf: (id) => popups.get(id)?.container ?? null,
      popOut,
      popIn,
    },
    popInAll: (prefix) => {
      for (const id of popups.keys()) {
        if (id.startsWith(prefix)) {
          popIn(id);
        }
      }
    },
    setTitle: (id, title) => {
      const popup = popups.get(id);
      if (popup !== undefined && popup.win.document.title !== title) {
        popup.win.document.title = title;
      }
    },
  };
}
