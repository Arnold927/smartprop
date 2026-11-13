import { useCallback, useMemo, useState } from "react";

/**
 * Row selection for lists with bulk actions.
 *
 *   const sel = useRowSelection(filteredRows, r => r.id);
 *   <Checkbox checked={sel.isSelected(r.id)} onCheckedChange={() => sel.toggle(r.id)} />
 *   <Checkbox checked={sel.allSelected} onCheckedChange={() => sel.toggleAll()} />   // "visible" rows
 *   <BulkBar count={sel.count} onClear={sel.clear}>…</BulkBar>
 *
 * `items` is the list currently on screen (after filters/search). Selection
 * survives paging and filtering, but `selectedItems` only returns rows that are
 * still in `items`, so bulk actions never touch rows the user can no longer see.
 */
export function useRowSelection<T>(items: T[], getId: (item: T) => string | number) {
  const [selected, setSelected] = useState<Set<string | number>>(new Set());

  const visibleIds = useMemo(() => items.map(getId), [items, getId]);

  const isSelected = useCallback((id: string | number) => selected.has(id), [selected]);

  const toggle = useCallback((id: string | number) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const allSelected = visibleIds.length > 0 && visibleIds.every(id => selected.has(id));
  const someSelected = !allSelected && visibleIds.some(id => selected.has(id));

  /** Select every visible row, or clear them if they are all selected already. */
  const toggleAll = useCallback((ids: (string | number)[] = visibleIds) => {
    setSelected(prev => {
      const next = new Set(prev);
      const every = ids.length > 0 && ids.every(id => next.has(id));
      ids.forEach(id => (every ? next.delete(id) : next.add(id)));
      return next;
    });
  }, [visibleIds]);

  const clear = useCallback(() => setSelected(new Set()), []);

  const selectedItems = useMemo(() => items.filter(i => selected.has(getId(i))), [items, selected, getId]);

  return {
    selected, isSelected, toggle, toggleAll, clear,
    allSelected, someSelected,
    count: selectedItems.length,
    selectedItems,
  };
}
