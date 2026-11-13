import { useCallback, useEffect, useState } from "react";

/**
 * Per-user "recent" and "pinned" records for the global search.
 * Stored in localStorage (per browser) — it is a convenience, not data of record.
 */
export interface QuickItem {
  /** Stable identity, e.g. "tenants-12". */
  key: string;
  /** Search group the item came from, e.g. "tenants". */
  group: string;
  title: string;
  subtitle?: string;
  href: string;
  at: number;
}

const MAX_RECENT = 8;
const MAX_PINNED = 12;
const EVT = "sp-quick-items";

function read(key: string): QuickItem[] {
  try { const v = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function write(key: string, v: QuickItem[]) {
  try { localStorage.setItem(key, JSON.stringify(v)); window.dispatchEvent(new Event(EVT)); } catch { /* storage unavailable */ }
}

export function useRecentItems(userId: string | number | undefined) {
  const rk = `sp_recent_items_${userId ?? "anon"}`;
  const pk = `sp_pinned_items_${userId ?? "anon"}`;
  const [recent, setRecent] = useState<QuickItem[]>(() => read(rk));
  const [pinned, setPinned] = useState<QuickItem[]>(() => read(pk));

  useEffect(() => {
    const sync = () => { setRecent(read(rk)); setPinned(read(pk)); };
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(EVT, sync); window.removeEventListener("storage", sync); };
  }, [rk, pk]);

  const addRecent = useCallback((item: Omit<QuickItem, "at">) => {
    const next = [{ ...item, at: Date.now() }, ...read(rk).filter(r => r.key !== item.key)].slice(0, MAX_RECENT);
    write(rk, next);
  }, [rk]);

  const isPinned = useCallback((key: string) => pinned.some(p => p.key === key), [pinned]);

  const togglePin = useCallback((item: Omit<QuickItem, "at">) => {
    const cur = read(pk);
    const next = cur.some(p => p.key === item.key)
      ? cur.filter(p => p.key !== item.key)
      : [{ ...item, at: Date.now() }, ...cur].slice(0, MAX_PINNED);
    write(pk, next);
  }, [pk]);

  const clearRecent = useCallback(() => write(rk, []), [rk]);

  return { recent, pinned, addRecent, isPinned, togglePin, clearRecent };
}
