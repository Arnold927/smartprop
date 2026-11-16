/**
 * EntityMedia — the "Photos & videos" block for a record (maintenance request, work order,
 * construction update). Shows what the signed-in person is allowed to see and, when the server says
 * they may add to the record, an upload button with per-file progress.
 */
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Camera, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { MediaGallery } from "@/components/ui/media-gallery";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  LABEL_TEXT, MAX_FILES_PER_BATCH, MAX_IMAGE_MB, MAX_VIDEO_MB, mediaQueryKey, uploadAll, useEntityMedia,
  type MediaEntityType, type MediaLabel,
} from "@/lib/media";
import { cn } from "@/lib/utils";

interface Row { name: string; pct: number; error?: string; done?: boolean }

export function EntityMedia({
  entityType, entityId, title = "Photos & videos", labels, defaultLabel, emptyText = "No photos or videos yet.",
  hideIfEmptyReadOnly = false, includeWork = false, readOnly = false, className, bare = false, size,
}: {
  entityType: MediaEntityType;
  entityId: number;
  title?: string;
  /** When given, the person picks what the files show (e.g. before / after) before choosing them. */
  labels?: MediaLabel[];
  defaultLabel?: MediaLabel;
  emptyText?: string;
  hideIfEmptyReadOnly?: boolean;
  /** Maintenance requests: also show the contractor's before/progress/after files. */
  includeWork?: boolean;
  /** Never show the add button (e.g. a block that only shows what someone else sent). */
  readOnly?: boolean;
  className?: string;
  /** No heading/border: for use inside an existing card. */
  bare?: boolean;
  size?: "sm" | "md";
}) {
  const { data, isLoading, isError } = useEntityMedia(entityType, entityId, { includeWork });
  const qc = useQueryClient();
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState<MediaLabel | undefined>(defaultLabel ?? labels?.[0]);
  const [rows, setRows] = useState<Row[]>([]);
  const busy = rows.some(r => !r.done && !r.error);

  const items = data?.items ?? [];
  const canAdd = !!data?.canAdd && !readOnly;
  if (hideIfEmptyReadOnly && !isLoading && items.length === 0 && !canAdd) return null;

  const start = async (picked: File[]) => {
    if (!picked.length) return;
    const files = picked.slice(0, MAX_FILES_PER_BATCH);
    setRows(files.map(f => ({ name: f.name, pct: 0 })));
    const res = await uploadAll(files, { entityType, entityId, label: label ?? null }, (i, st) =>
      setRows(prev => prev.map((r, j) => (j === i ? { ...r, pct: st.pct, done: st.done, error: st.error } : r))));
    await qc.invalidateQueries({ queryKey: mediaQueryKey(entityType, entityId) });
    if (res.failed.length === 0) { setRows([]); toast({ title: res.ok.length === 1 ? "File added" : `${res.ok.length} files added` }); }
    else toast({ title: "Some files didn't upload", description: res.failed[0].error, variant: "destructive" });
  };

  const remove = async (id: number) => {
    try {
      await apiRequest(`/api/media/${id}`, { method: "DELETE" });
      await qc.invalidateQueries({ queryKey: mediaQueryKey(entityType, entityId) });
    } catch (e: any) {
      toast({ title: "Couldn't remove file", description: "Please try again.", variant: "destructive" });
    }
  };

  const body = (
    <div className="space-y-3">
      {isLoading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
      {isError && <div className="flex items-center gap-2 text-sm text-muted-foreground"><AlertCircle className="h-4 w-4" /> Couldn't load media.</div>}
      {!isLoading && !isError && items.length === 0 && <p className="text-sm text-muted-foreground">{emptyText}</p>}
      <MediaGallery items={items} size={size} onDelete={m => remove(m.id)} canDelete={m => !!m.canRemove} />

      {rows.length > 0 && (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate">{r.name}</span>
                <span className={cn("shrink-0", r.error ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>{r.error ? "Failed" : r.done ? "Done" : `${r.pct}%`}</span>
              </div>
              {r.error ? <p className="text-xs text-red-600 dark:text-red-400">{r.error}</p> : <Progress value={r.pct} className="h-1" />}
            </div>
          ))}
          {!busy && rows.some(r => r.error) && <Button type="button" variant="ghost" size="sm" onClick={() => setRows([])}>Dismiss</Button>}
        </div>
      )}

      {canAdd && (
        <div className="space-y-2">
          {labels && labels.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="What do these files show?">
              {labels.map(l => (
                <button key={l} type="button" role="radio" aria-checked={label === l} onClick={() => setLabel(l)} disabled={busy}
                  className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    label === l ? "border-emerald-600 bg-emerald-700 text-white" : "border-border bg-card text-muted-foreground hover:bg-muted")}>
                  {LABEL_TEXT[l]}
                </button>
              ))}
            </div>
          )}
          <input ref={input} type="file" accept="image/*,video/*" multiple className="hidden"
            onChange={e => { const f = Array.from(e.target.files ?? []); e.target.value = ""; void start(f); }} />
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : items.length ? <Plus className="mr-1.5 h-4 w-4 text-emerald-600" /> : <Camera className="mr-1.5 h-4 w-4 text-emerald-600" />}
            {busy ? "Uploading…" : "Add photos or videos"}
          </Button>
          <p className="text-xs text-muted-foreground">Photos up to {MAX_IMAGE_MB} MB, videos up to {MAX_VIDEO_MB} MB.</p>
        </div>
      )}
    </div>
  );

  if (bare) return <div className={className}>{body}</div>;
  return (
    <div className={cn("rounded-xl border border-border bg-card p-4", className)}>
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <Camera className="h-4 w-4 text-emerald-600" /> {title}
        {items.length > 0 && <span className="text-xs font-normal text-muted-foreground">({items.length})</span>}
      </div>
      {body}
    </div>
  );
}
