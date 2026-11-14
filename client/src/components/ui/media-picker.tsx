/**
 * MediaPicker — choose photos/videos (or take a photo) BEFORE the record exists, e.g. in a "report a
 * problem" form. Files stay on the device until the form is submitted; the caller then sends them with
 * uploadAll() from lib/media.ts using the new record's id.
 */
import { useEffect, useRef } from "react";
import { Camera, ImagePlus, Play, X as XIc } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MAX_FILES_PER_BATCH, MAX_IMAGE_MB, MAX_VIDEO_MB, isVideoFile, validateMediaFile } from "@/lib/media";

export interface StagedMedia { id: string; file: File; preview: string; video: boolean }

export function stageFiles(files: File[]): { staged: StagedMedia[]; errors: string[] } {
  const staged: StagedMedia[] = []; const errors: string[] = [];
  for (const f of files) {
    const bad = validateMediaFile(f);
    if (bad) { errors.push(bad); continue; }
    staged.push({ id: `${f.name}-${f.size}-${f.lastModified}-${Math.random().toString(36).slice(2, 6)}`, file: f, preview: URL.createObjectURL(f), video: isVideoFile(f) });
  }
  return { staged, errors };
}

export function MediaPicker({
  value, onChange, onError, max = MAX_FILES_PER_BATCH, disabled, className, hint,
}: {
  value: StagedMedia[];
  onChange: (next: StagedMedia[]) => void;
  onError?: (message: string) => void;
  max?: number;
  disabled?: boolean;
  className?: string;
  hint?: string;
}) {
  const pick = useRef<HTMLInputElement>(null);
  const cam = useRef<HTMLInputElement>(null);
  const live = useRef(value);
  live.current = value;
  // Free the preview blobs when the picker goes away.
  useEffect(() => () => live.current.forEach(s => URL.revokeObjectURL(s.preview)), []);

  const add = (list: FileList | null) => {
    if (!list) return;
    const room = max - value.length;
    const { staged, errors } = stageFiles(Array.from(list).slice(0, Math.max(room, 0)));
    if (list.length > room) errors.push(`You can add up to ${max} files at a time.`);
    if (errors.length) onError?.(errors[0]);
    if (staged.length) onChange([...value, ...staged]);
  };
  const remove = (id: string) => {
    const gone = value.find(v => v.id === id);
    if (gone) URL.revokeObjectURL(gone.preview);
    onChange(value.filter(v => v.id !== id));
  };

  return (
    <div className={cn("space-y-2", className)}>
      <input ref={pick} type="file" accept="image/*,video/*" multiple className="hidden" onChange={e => { add(e.target.files); e.target.value = ""; }} />
      <input ref={cam} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { add(e.target.files); e.target.value = ""; }} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={disabled || value.length >= max} onClick={() => pick.current?.click()}>
          <ImagePlus className="mr-1.5 h-4 w-4 text-emerald-600" /> Add photos or videos
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={disabled || value.length >= max} onClick={() => cam.current?.click()} className="sm:hidden">
          <Camera className="mr-1.5 h-4 w-4 text-emerald-600" /> Take a photo
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{hint ?? `Photos up to ${MAX_IMAGE_MB} MB, videos up to ${MAX_VIDEO_MB} MB. Up to ${max} files.`}</p>
      {value.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-2">
          {value.map(s => (
            <div key={s.id} className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted">
              {s.video
                ? <video src={s.preview} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                : <img src={s.preview} alt="" className="h-full w-full object-cover" />}
              {s.video && <span className="pointer-events-none absolute inset-0 flex items-center justify-center"><span className="rounded-full bg-black/60 p-1.5 text-white"><Play className="h-3.5 w-3.5 fill-current" /></span></span>}
              <button type="button" onClick={() => remove(s.id)} disabled={disabled} aria-label={`Remove ${s.file.name}`} data-no-touch-target
                className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-red-600"><XIc className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
