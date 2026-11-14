/**
 * MediaGallery — thumbnails for photos and videos with a full-screen viewer.
 * Keyboard: ← → to move, Esc to close. Videos play in the viewer (with controls).
 */
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Play, Trash2, X as XIc, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { LABEL_TEXT, type MediaItem } from "@/lib/media";

const labelTone: Record<string, string> = {
  issue: "bg-amber-500/90", before: "bg-sky-600/90", after: "bg-emerald-600/90", progress: "bg-violet-600/90",
};

export function MediaGallery({
  items, onDelete, canDelete, className, size = "md",
}: {
  items: MediaItem[];
  onDelete?: (item: MediaItem) => void;
  canDelete?: (item: MediaItem) => boolean;
  className?: string;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState<number | null>(null);
  const [failed, setFailed] = useState<number | null>(null); // id of a video that could not be played
  const count = items.length;
  const close = useCallback(() => { setOpen(null); setFailed(null); }, []);
  const step = useCallback((d: number) => setOpen(i => (i === null ? i : (i + d + count) % count)), [count]);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, close, step]);

  useEffect(() => { if (open !== null && open >= count) setOpen(count ? count - 1 : null); }, [count, open]);

  if (!count) return null;
  const cur = open !== null ? items[open] : null;

  return (
    <>
      <div className={cn("grid gap-2", size === "sm" ? "grid-cols-[repeat(auto-fill,minmax(64px,1fr))]" : "grid-cols-[repeat(auto-fill,minmax(84px,1fr))]", className)}>
        {items.map((m, i) => (
          <div key={m.id} className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted">
            <button type="button" onClick={() => setOpen(i)} className="absolute inset-0 h-full w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              aria-label={`${m.kind === "video" ? "Play video" : "View photo"} ${i + 1} of ${count}`}>
              {m.thumbnailUrl
                ? <img src={m.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                : <div className="h-full w-full bg-muted" />}
              {m.kind === "video" && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="rounded-full bg-black/60 p-2 text-white"><Play className="h-4 w-4 fill-current" /></span>
                </span>
              )}
            </button>
            {m.label && (
              <span className={cn("pointer-events-none absolute left-1 top-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-white", labelTone[m.label] ?? "bg-black/60")}>
                {LABEL_TEXT[m.label]}
              </span>
            )}
            {onDelete && (canDelete ? canDelete(m) : true) && (
              <button type="button" onClick={() => onDelete(m)} aria-label="Remove" data-no-touch-target
                className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white opacity-100 transition-opacity hover:bg-red-600 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      {cur && (
        <div role="dialog" aria-modal="true" aria-label="Media viewer"
          className="fixed inset-0 z-[100] flex flex-col bg-black" onClick={close}>
          <div className="flex items-center justify-between px-4 py-3 text-white" onClick={e => e.stopPropagation()}>
            <span className="text-sm tabular-nums text-white/80">
              {(open ?? 0) + 1} / {count}
              {cur.label ? ` · ${LABEL_TEXT[cur.label]}` : ""}
              {cur.createdAt ? ` · ${new Date(cur.createdAt).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}` : ""}
            </span>
            <div className="flex items-center gap-1">
              <a href={cur.url} target="_blank" rel="noopener noreferrer" aria-label="Open original"
                className="rounded-full p-2 hover:bg-white/10"><Download className="h-5 w-5" /></a>
              <button type="button" onClick={close} aria-label="Close" className="rounded-full p-2 hover:bg-white/10"><XIc className="h-5 w-5" /></button>
            </div>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4 sm:px-14" onClick={e => e.stopPropagation()}>
            {cur.kind === "video"
              ? failed === cur.id
                ? <p className="max-w-xs text-center text-sm text-white/80">This video couldn't be played here (it may still be processing). Try again in a moment, or <a href={cur.url} target="_blank" rel="noopener noreferrer" className="underline">open it directly</a>.</p>
                : <video key={cur.id} src={cur.url} poster={cur.thumbnailUrl ?? undefined} controls autoPlay playsInline onError={() => setFailed(cur.id)} className="max-h-full max-w-full rounded-lg" />
              : <img key={cur.id} src={cur.url} alt="" className="max-h-full max-w-full rounded-lg object-contain" />}
            {count > 1 && (
              <>
                <button type="button" onClick={() => step(-1)} aria-label="Previous"
                  className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 sm:left-3"><ChevronLeft className="h-6 w-6" /></button>
                <button type="button" onClick={() => step(1)} aria-label="Next"
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 sm:right-3"><ChevronRight className="h-6 w-6" /></button>
              </>
            )}
          </div>
          {cur.caption && <p className="px-4 pb-4 text-center text-sm text-white/80" onClick={e => e.stopPropagation()}>{cur.caption}</p>}
        </div>
      )}
    </>
  );
}
