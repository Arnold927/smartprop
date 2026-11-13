import { useState } from "react";
import { Bookmark, BookmarkPlus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useSavedViews } from "@/hooks/useSavedViews";

interface SavedViewsMenuProps<F> {
  /** Unique per page, e.g. "arrears" or "maintenance". */
  pageKey: string;
  /** The filters as they are right now. */
  current: F;
  /** Apply a saved view's filters to the page. */
  onApply: (filters: F) => void;
  /** True when no filter is active — the "save" option is then disabled. */
  isEmpty: boolean;
}

/** "Views" dropdown: apply, save and delete named filter combinations. */
export function SavedViewsMenu<F>({ pageKey, current, onApply, isEmpty }: SavedViewsMenuProps<F>) {
  const { views, save, remove } = useSavedViews<F>(pageKey);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  const commit = () => {
    if (!name.trim()) return;
    save(name, current);
    setName("");
    setNaming(false);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" aria-label="Saved views">
            <Bookmark className="w-4 h-4" />
            <span className="ml-1.5 hidden sm:inline">Views</span>
            {views.length > 0 && <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-[10px]">{views.length}</Badge>}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Saved views</DropdownMenuLabel>
          {views.length === 0 && (
            <div className="px-2 py-2 text-xs text-muted-foreground">
              None yet. Set up the filters you use often, then choose "Save current filters".
            </div>
          )}
          {views.map(v => (
            <DropdownMenuItem key={v.id} className="flex items-center justify-between gap-2" onSelect={() => onApply(v.filters)}>
              <span className="truncate">{v.name}</span>
              <button
                type="button"
                aria-label={`Delete view ${v.name}`}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={e => { e.stopPropagation(); e.preventDefault(); remove(v.id); }}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={isEmpty} onSelect={() => setNaming(true)}>
            <BookmarkPlus className="w-4 h-4 mr-2" />Save current filters…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={naming} onOpenChange={setNaming}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Save this view</DialogTitle>
            <DialogDescription>Give it a name you will recognise, e.g. "Overdue 30+ days".</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={name}
            maxLength={60}
            placeholder="View name"
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNaming(false)}>Cancel</Button>
            <Button onClick={commit} disabled={!name.trim()}>Save view</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export interface FilterChip { key: string; label: string; onClear: () => void }

/** "Filters active" strip with one removable chip per filter and a Clear all. */
export function ActiveFilters({ chips, onClearAll }: { chips: FilterChip[]; onClearAll: () => void }) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
      <span className="text-xs text-muted-foreground mr-0.5">Filters:</span>
      {chips.map(c => (
        <Badge key={c.key} variant="secondary" className="gap-1 pl-2 pr-1 py-0.5 font-normal">
          {c.label}
          <button type="button" aria-label={`Remove filter ${c.label}`} className="rounded-full p-0.5 hover:bg-background/60" onClick={c.onClear}>
            <X className="w-3 h-3" />
          </button>
        </Badge>
      ))}
      <button type="button" className="text-xs text-primary hover:underline ml-1" onClick={onClearAll}>Clear all</button>
    </div>
  );
}
