// Tool styling: a runtime tagged template (`api.tw`) backed by UnoCSS. Tools
// build class strings with it instead of relying on the chrome's build-time
// Tailwind. Every utility is emitted in the `tw-` namespace so tool styles can
// never clash with the chrome's Tailwind. See ADR-0009.
import { createGenerator, type UnoGenerator } from "@unocss/core";
import presetWind4 from "@unocss/preset-wind4";

const PREFIX = "tw-";

function applyPrefix(token: string): string {
  // Insert the prefix on the utility itself, after any variants (e.g.
  // `hover:bg-x` -> `hover:tw-bg-x`). Good for ordinary variants; a `:` inside an
  // arbitrary value is not handled (rare in tool UIs).
  const i = token.lastIndexOf(":");
  return i === -1 ? PREFIX + token : `${token.slice(0, i + 1)}${PREFIX}${token.slice(i + 1)}`;
}

type TwExpr = string | number | false | null | undefined;

/** Build the prefixed class string from a (tagged-template) strings/exprs pair. */
export function toToolClasses(strings: readonly string[], exprs: readonly TwExpr[] = []): string {
  let text = "";
  strings.forEach((s, i) => {
    text += s;
    const expr = exprs[i];
    if (expr) text += String(expr);
  });
  return text.split(/\s+/).filter(Boolean).map(applyPrefix).join(" ");
}

// The toolbox theme is single-sourced: reference the same CSS variables the
// chrome's `@theme` emits, so `bg-toolbox-accent` means the same thing in a tool
// and in the chrome with no duplicated values.
const toolboxTheme = {
  colors: {
    toolbox: {
      deepest: "var(--color-toolbox-deepest)",
      surface: "var(--color-toolbox-surface)",
      content: "var(--color-toolbox-content)",
      border: "var(--color-toolbox-border)",
      "border-light": "var(--color-toolbox-border-light)",
      text: "var(--color-toolbox-text)",
      muted: "var(--color-toolbox-muted)",
      accent: "var(--color-toolbox-accent)",
      "accent-yellow": "var(--color-toolbox-accent-yellow)",
      "accent-cyan": "var(--color-toolbox-accent-cyan)",
      "accent-pink": "var(--color-toolbox-accent-pink)",
    },
    focused: "var(--color-focused)",
  },
  font: { mono: "var(--font-mono)", sans: "var(--font-sans)" },
};

let genPromise: Promise<UnoGenerator> | null = null;
function generator(): Promise<UnoGenerator> {
  genPromise ??= createGenerator({
    presets: [presetWind4({ prefix: PREFIX })],
    theme: toolboxTheme,
  } as Parameters<typeof createGenerator>[0]);
  return genPromise;
}

/** Generate the CSS for already-prefixed tokens (no preflight — the chrome's). */
export async function generateToolCss(tokens: string[]): Promise<string> {
  const uno = await generator();
  const { css } = await uno.generate(tokens.join(" "), { preflights: false });
  return css;
}

const injected = new Set<string>();
const pending = new Set<string>();
let scheduled = false;
let styleEl: HTMLStyleElement | null = null;

function sheet(): HTMLStyleElement | null {
  if (typeof document === "undefined") return null;
  styleEl ??= (() => {
    const el = document.createElement("style");
    el.setAttribute("data-toolbox-tw", "");
    document.head.appendChild(el);
    return el;
  })();
  return styleEl;
}

async function flush(): Promise<void> {
  const tokens = [...pending].filter((t) => !injected.has(t));
  pending.clear();
  if (tokens.length === 0) return;
  for (const t of tokens) injected.add(t);
  const css = await generateToolCss(tokens);
  const el = sheet();
  if (el && css) el.textContent += css;
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    void flush();
  });
}

/**
 * `api.tw` — return a (prefixed) class string and register its CSS at runtime.
 * Generation is deduped and batched into a microtask; because UnoCSS resolves
 * static utilities synchronously, the styles land before the browser paints.
 */
export function tw(strings: TemplateStringsArray, ...exprs: TwExpr[]): string {
  const className = toToolClasses(strings, exprs);
  for (const t of className.split(" ")) {
    if (t && !injected.has(t)) pending.add(t);
  }
  schedule();
  return className;
}
