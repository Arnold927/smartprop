/**
 * MediaUploader
 *
 * Drag-and-drop / click-to-browse file uploader for WhatsApp media sends.
 * Uploads to POST /api/upload/media → Cloudinary → calls onUploaded(url) with
 * the public HTTPS URL that WhatsApp's Cloud API can pull.
 *
 * Falls back gracefully: if Cloudinary is not configured the server returns 503
 * and the component shows the manual URL input so the user is never blocked.
 *
 * Props:
 *   onUploaded(url, mime) — called once the file is live on Cloudinary
 *   onClear()            — called when the user removes the uploaded file
 *   className?           — forwarded to the root element
 */

import React, { useCallback, useRef, useState } from "react";
import { Upload, X, FileText, ImageIcon, Video, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { uploadWithAuth } from "@/lib/queryClient";

interface MediaUploaderProps {
  onUploaded: (url: string, mime: string) => void;
  onClear: () => void;
  className?: string;
}

interface UploadState {
  status: "idle" | "uploading" | "done" | "error";
  progress: number;   // 0-100 (simulated, XHR doesn't expose Cloudinary server progress)
  url: string | null;
  fileName: string | null;
  mime: string | null;
  error: string | null;
}

const INITIAL_STATE: UploadState = {
  status: "idle",
  progress: 0,
  url: null,
  fileName: null,
  mime: null,
  error: null,
};

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf", "video/mp4"];
const MAX_MB = 10;

function mimeIcon(mime: string | null) {
  if (!mime) return <Upload className="h-6 w-6" />;
  if (mime.startsWith("image/")) return <ImageIcon className="h-6 w-6" />;
  if (mime === "video/mp4")      return <Video className="h-6 w-6" />;
  return <FileText className="h-6 w-6" />;
}

export function MediaUploader({ onUploaded, onClear, className }: MediaUploaderProps) {
  const [state, setState] = useState<UploadState>(INITIAL_STATE);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    // Client-side validation
    if (!ALLOWED_TYPES.includes(file.type)) {
      setState(s => ({ ...s, status: "error", error: `Unsupported type. Allowed: JPEG, PNG, GIF, WEBP, PDF, MP4.` }));
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setState(s => ({ ...s, status: "error", error: `File too large. Max ${MAX_MB} MB.` }));
      return;
    }

    setState({
      status: "uploading",
      progress: 0,
      url: null,
      fileName: file.name,
      mime: file.type,
      error: null,
    });

    // Simulate smooth progress while the real upload runs
    let fake = 0;
    const ticker = setInterval(() => {
      fake = Math.min(fake + Math.random() * 12, 88);
      setState(s => s.status === "uploading" ? { ...s, progress: Math.round(fake) } : s);
    }, 200);

    try {
      const form = new FormData();
      form.append("file", file);

      const res = await uploadWithAuth("/api/upload/media", form);
      clearInterval(ticker);

      const data = await res.json() as { url: string; mime: string };

      setState(s => ({ ...s, status: "done", progress: 100, url: data.url }));
      onUploaded(data.url, data.mime);
    } catch (err: any) {
      clearInterval(ticker);
      setState(s => ({ ...s, status: "error", progress: 0, error: err.message || "Upload failed" }));
    }
  }, [onUploaded]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Reset so re-selecting the same file triggers onChange
    e.target.value = "";
  }, [handleFile]);

  const clear = useCallback(() => {
    setState(INITIAL_STATE);
    onClear();
  }, [onClear]);

  // ── Render: done state ────────────────────────────────────────────────────
  if (state.status === "done" && state.url) {
    const isImage = state.mime?.startsWith("image/");
    return (
      <div className={cn("rounded-xl border border-green-200 bg-green-50 p-3 space-y-2", className)}>
        <div className="flex items-center gap-2 text-green-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span className="text-xs font-medium truncate flex-1">{state.fileName}</span>
          <button onClick={clear} className="shrink-0 text-green-500 hover:text-green-800" title="Remove">
            <X className="h-4 w-4" />
          </button>
        </div>
        {isImage && (
          <div className="rounded-lg overflow-hidden border border-green-200" >
            <img
              src={state.url}
              alt="Uploaded preview"
              className="w-full max-h-32 object-contain bg-white"
              onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          </div>
        )}
        {!isImage && (
          <div className="flex items-center gap-2 rounded-lg bg-white border border-green-200 px-3 py-2">
            {mimeIcon(state.mime)}
            <a
              href={state.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-green-700 underline truncate"
            >
              {state.url}
            </a>
          </div>
        )}
      </div>
    );
  }

  // ── Render: uploading state ───────────────────────────────────────────────
  if (state.status === "uploading") {
    return (
      <div className={cn("rounded-xl border border-border bg-muted/40 p-4 space-y-3", className)}>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          <span className="truncate flex-1">{state.fileName}</span>
          <span className="text-xs font-mono">{state.progress}%</span>
        </div>
        <Progress value={state.progress} className="h-1.5" />
      </div>
    );
  }

  // ── Render: error state ───────────────────────────────────────────────────
  if (state.status === "error") {
    return (
      <div className={cn("rounded-xl border border-red-200 bg-red-50 p-3 space-y-2", className)}>
        <div className="flex items-center gap-2 text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="text-xs flex-1">{state.error}</span>
          <button onClick={clear} className="shrink-0 text-red-400 hover:text-red-700">
            <X className="h-4 w-4" />
          </button>
        </div>
        <Button size="sm" variant="outline" className="w-full text-xs h-7" onClick={() => setState(INITIAL_STATE)}>
          Try again
        </Button>
      </div>
    );
  }

  // ── Render: idle (drop zone) ──────────────────────────────────────────────
  return (
    <div
      className={cn(
        "rounded-xl border-2 border-dashed transition-colors cursor-pointer select-none",
        dragging ? "border-blue-400 bg-blue-50" : "border-border bg-muted/30 hover:border-blue-300 hover:bg-muted/50",
        className
      )}
      onClick={() => inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        accept={ALLOWED_TYPES.join(",")}
        onChange={handleInputChange}
      />
      <div className="flex flex-col items-center justify-center gap-1.5 py-5 px-4 text-muted-foreground">
        <Upload className={cn("h-7 w-7 transition-colors", dragging ? "text-blue-500" : "text-muted-foreground/60")} />
        <p className="text-sm font-medium text-foreground">
          {dragging ? "Drop to upload" : "Click or drag a file here"}
        </p>
        <p className="text-xs text-center">JPEG, PNG, GIF, WEBP, PDF, MP4 · max {MAX_MB} MB</p>
      </div>
    </div>
  );
}