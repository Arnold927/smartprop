import * as React from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SearchableOption {
  value: string;
  /** Main line, e.g. a tenant's name. */
  label: string;
  /** Second line, e.g. "Unit 4B · Kileleshwa Grove". Also searched. */
  description?: string;
  /** Extra text that should match a search but isn't shown (email, phone…). */
  keywords?: string;
  disabled?: boolean;
}

interface SearchableSelectProps {
  /** Controlled value. Omit (and use defaultValue) for native, uncontrolled forms with `name`. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  /** Renders a hidden input so the value is included in native form submissions. */
  name?: string;
  /** Show an "×" to clear the selection (sets value to ""). */
  clearable?: boolean;
  /** Cap on rows rendered at once; the list says how many more match. */
  maxVisible?: number;
}

/**
 * Drop-in replacement for a long <Select>: click, type to filter by name, unit,
 * property, email, phone…, Enter to pick. Each row can show a second line of context.
 *
 * Built as a combobox: the search box IS the trigger (so it stays inside a dialog's
 * focus trap), and only the option list is portaled to <body> so a dialog's
 * overflow can't clip it. The list keeps focus in the input (mousedown is
 * default-prevented), keeps pointer events away from the dialog's "click outside"
 * handler, and handles wheel scrolling itself.
 */
export function SearchableSelect({
  value: valueProp, defaultValue = "", onValueChange: onChange, options,
  placeholder = "Select…", searchPlaceholder = "Search…", emptyText = "No matches",
  disabled, className, id, name, clearable, maxVisible = 100,
}: SearchableSelectProps) {
  const [inner, setInner] = React.useState(defaultValue);
  const value = valueProp ?? inner;
  const setValue = (v: string) => { setInner(v); onChange?.(v); };

  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const [box, setBox] = React.useState<{ left: number; width: number; top?: number; bottom?: number; maxH: number } | null>(null);

  const rootRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  const selected = options.find(o => o.value === value);

  const matches = React.useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return options;
    return options.filter(o => {
      const hay = `${o.label} ${o.description ?? ""} ${o.keywords ?? ""}`.toLowerCase();
      return tokens.every(t => hay.includes(t));
    });
  }, [options, query]);
  const shown = matches.slice(0, maxVisible);

  const close = React.useCallback(() => { setOpen(false); setQuery(""); }, []);
  const choose = (o: SearchableOption) => { if (o.disabled) return; setValue(o.value); close(); };

  // Place the list under (or, if cramped, over) the trigger, following scroll/resize.
  const place = React.useCallback(() => {
    const el = rootRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = below < 220 && above > below;
    const maxH = Math.max(140, Math.min(288, up ? above : below));
    const width = Math.max(r.width, 256);
    const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - width - 8));
    setBox(up
      ? { left, width, bottom: window.innerHeight - r.top + 4, maxH }
      : { left, width, top: r.bottom + 4, maxH });
  }, []);

  React.useLayoutEffect(() => {
    if (!open) return;
    place();
    inputRef.current?.focus();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, place]);

  // Outside click closes; Escape closes only the list (not the dialog around it).
  React.useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!rootRef.current?.contains(t) && !listRef.current?.contains(t)) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    };
    document.addEventListener("mousedown", down);
    window.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("mousedown", down); window.removeEventListener("keydown", key, true); };
  }, [open, close]);

  React.useEffect(() => { setActive(0); }, [query, open]);
  React.useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, box]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(i => Math.min(i + 1, shown.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (shown[active]) choose(shown[active]); }
    else if (e.key === "Tab") close();
  };

  const triggerCls = cn(
    "flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm text-left ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
    className,
  );

  return (
    <div ref={rootRef} className="relative w-full">
      {name && <input type="hidden" name={name} value={value} />}

      {open ? (
        <div className={cn(triggerCls, "ring-2 ring-ring ring-offset-2")}>
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded
            aria-controls={id ? `${id}-list` : undefined}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={selected ? selected.label : searchPlaceholder}
            className="min-w-0 flex-1 !bg-transparent !shadow-none !ring-0 !border-0 !p-0 !h-auto text-sm outline-none focus-visible:!outline-none placeholder:text-muted-foreground"
          />
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50 rotate-180" />
        </div>
      ) : (
        <button
          type="button"
          id={id}
          role="combobox"
          aria-expanded={false}
          disabled={disabled}
          onClick={() => setOpen(true)}
          className={cn(triggerCls, !selected && "text-muted-foreground")}
        >
          <span className="min-w-0 flex-1 truncate">
            {selected ? (
              <>
                {selected.label}
                {selected.description && <span className="ml-2 text-xs text-muted-foreground">{selected.description}</span>}
              </>
            ) : placeholder}
          </span>
          {clearable && selected && !disabled ? (
            <span
              role="button"
              aria-label="Clear"
              className="rounded p-0.5 hover:bg-muted"
              onClick={e => { e.stopPropagation(); setValue(""); }}
            >
              <X className="h-3.5 w-3.5 opacity-60" />
            </span>
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
          )}
        </button>
      )}

      {open && box && createPortal(
        <div
          ref={listRef}
          id={id ? `${id}-list` : undefined}
          role="listbox"
          // Keep the search box focused, and keep the click away from the dialog's outside-click handler.
          onMouseDown={e => e.preventDefault()}
          onPointerDown={e => e.stopPropagation()}
          onWheel={e => { e.stopPropagation(); if (listRef.current) listRef.current.scrollTop += e.deltaY; }}
          style={{ position: "fixed", left: box.left, width: box.width, top: box.top, bottom: box.bottom, maxHeight: box.maxH, pointerEvents: "auto" }}
          className="z-[200] overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {shown.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">{emptyText}</div>
          ) : shown.map((o, i) => (
            <div
              key={o.value}
              data-idx={i}
              role="option"
              aria-selected={o.value === value}
              aria-disabled={o.disabled}
              onMouseMove={() => setActive(i)}
              onClick={() => choose(o)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
                i === active && "bg-accent text-accent-foreground",
                o.disabled && "cursor-not-allowed opacity-50",
              )}
            >
              <Check className={cn("h-4 w-4 shrink-0", o.value === value ? "opacity-100" : "opacity-0")} />
              <div className="min-w-0 flex-1">
                <div className="truncate">{o.label}</div>
                {o.description && <div className="truncate text-xs text-muted-foreground">{o.description}</div>}
              </div>
            </div>
          ))}
          {matches.length > shown.length && (
            <div className="px-2 py-1.5 text-center text-xs text-muted-foreground">
              {matches.length - shown.length} more — keep typing to narrow down
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
