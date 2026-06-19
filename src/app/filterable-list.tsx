import { useEffect, useRef, useState } from "preact/hooks";
import type { VNode } from "preact";

export interface FilterableListProps<T> {
  /** Return the items to show for the current query (caller owns filtering/sorting). */
  filter: (query: string) => T[];
  /** Stable key for an item. */
  itemKey: (item: T) => string | number;
  /** Render one row. `active` is the highlighted state; call `choose` to pick it. */
  renderItem: (item: T, opts: { active: boolean; choose: () => void }) => VNode;
  /** Invoked when an item is chosen (Enter on the highlighted row, or `choose`). */
  onChoose: (item: T) => void;
  /** Invoked on Escape / backdrop click (only when `canDismiss`). */
  onDismiss: () => void;
  canDismiss?: boolean;
  placeholder?: string;
  title?: string;
  /** Select the input's text on focus (used by the launcher). */
  selectOnFocus?: boolean;
  /** Tailwind z-index class for the backdrop. */
  overlayZClass?: string;
}

/**
 * A modal, filterable, keyboard-navigated list overlay: search input + fuzzy
 * list + Arrow/Enter/Escape + highlight-on-hover + backdrop dismiss. Host
 * chrome (rendered above windows). The Cmd-K palette and the quick pick are
 * both thin adapters over this.
 */
export function FilterableList<T>({
  filter,
  itemKey,
  renderItem,
  onChoose,
  onDismiss,
  canDismiss = true,
  placeholder = "Type to filter…",
  title,
  selectOnFocus = false,
  overlayZClass = "z-40",
}: FilterableListProps<T>): VNode {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    if (selectOnFocus) inputRef.current?.select();
  }, [selectOnFocus]);

  const items = filter(query);

  const dismiss = () => {
    if (canDismiss) onDismiss();
  };
  const choose = (index: number) => {
    const item = items[index];
    if (item) onChoose(item);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      if (canDismiss) {
        e.preventDefault();
        onDismiss();
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (items.length === 0 ? 0 : Math.min(h + 1, items.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(highlight);
    }
  };

  return (
    <div
      class={`fixed inset-0 ${overlayZClass} flex items-start justify-center pt-32 bg-black/60`}
      data-toolbox-chrome
      onClick={dismiss}
      onKeyDown={(e) => {
        if (e.key === "Escape" && canDismiss) {
          e.preventDefault();
          onDismiss();
        }
      }}
    >
      <div
        class="bg-toolbox-surface border border-toolbox-border rounded-lg shadow-2xl w-full max-w-xl mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {title ? <div class="px-4 pt-3 text-xs text-toolbox-muted">{title}</div> : null}
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          value={query}
          onInput={(e) => {
            setQuery((e.currentTarget as HTMLInputElement).value);
            setHighlight(0);
          }}
          onKeyDown={handleKeyDown}
          class="w-full px-4 py-3 text-lg border-b border-toolbox-border bg-toolbox-deepest text-toolbox-text placeholder-toolbox-muted outline-none rounded-t-lg"
        />
        <ul class="max-h-80 overflow-y-auto">
          {items.length === 0 ? <li class="p-4 text-toolbox-muted">No matches.</li> : null}
          {items.map((item, i) => (
            <li key={itemKey(item)} onMouseEnter={() => setHighlight(i)}>
              {renderItem(item, { active: i === highlight, choose: () => choose(i) })}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
