import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";

export interface SavedView<F> {
  id: string;
  name: string;
  filters: F;
  createdAt: number;
}

/**
 * Per-user, per-page saved filter views ("Overdue > 30 days, Kileleshwa").
 * Stored in this browser's localStorage, keyed by user and page, so each person
 * keeps their own and they never leak between accounts on a shared computer.
 */
export function useSavedViews<F>(pageKey: string) {
  const { user } = useAuth();
  const storageKey = `sp_views_${(user as any)?.id ?? "anon"}_${pageKey}`;

  const read = useCallback((): SavedView<F>[] => {
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }, [storageKey]);

  const [views, setViews] = useState<SavedView<F>[]>(read);
  useEffect(() => { setViews(read()); }, [read]);

  const persist = (next: SavedView<F>[]) => {
    setViews(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* storage full / blocked */ }
  };

  const save = (name: string, filters: F) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Same name replaces the old view rather than creating a duplicate.
    const rest = views.filter(v => v.name.toLowerCase() !== trimmed.toLowerCase());
    persist([{ id: `${Date.now()}`, name: trimmed, filters, createdAt: Date.now() }, ...rest].slice(0, 20));
  };

  const remove = (id: string) => persist(views.filter(v => v.id !== id));

  return { views, save, remove };
}
