/**
 * OptimizedImage.tsx
 *
 * Drop-in <img> replacement for SmartProp that:
 *  - renders a low-res thumbnail immediately (if `thumbnailUrl` is supplied)
 *  - lazy-loads the full image only when the element enters the viewport
 *  - swaps thumbnail → full image with a smooth fade once loaded
 *  - falls back to full URL when no thumbnail exists
 *  - supports a click-to-expand lightbox for list-view photos
 *
 * Usage — list view (thumbnail only, expands on click):
 *   <OptimizedImage
 *     src={photo.url}
 *     thumbnailUrl={photo.thumbnailUrl}
 *     alt="Maintenance photo"
 *     className="w-20 h-20 object-cover rounded"
 *     expandable
 *   />
 *
 * Usage — detail view (full image, still lazy):
 *   <OptimizedImage
 *     src={photo.url}
 *     thumbnailUrl={photo.thumbnailUrl}
 *     alt="Maintenance photo"
 *     className="w-full rounded-lg"
 *   />
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import { X, ZoomIn } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Props ─────────────────────────────────────────────────────────────────────
interface OptimizedImageProps
  extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src" | "loading"> {
  /** Full-resolution URL (used when expanded or in detail view) */
  src: string;
  /** Small thumbnail URL returned by the server (200 px JPEG). Falls back to src. */
  thumbnailUrl?: string;
  /** Alt text */
  alt: string;
  /** If true the image opens in a lightbox on click */
  expandable?: boolean;
  /** Extra classes for the <img> element */
  className?: string;
  /** Extra classes for the wrapping <div> */
  wrapperClassName?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────
export function OptimizedImage({
  src,
  thumbnailUrl,
  alt,
  expandable = false,
  className,
  wrapperClassName,
  ...rest
}: OptimizedImageProps) {
  const thumb = thumbnailUrl ?? src;
  const [fullLoaded, setFullLoaded] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // Preload the full image once the thumbnail enters the viewport
  useEffect(() => {
    if (!imgRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          const full = new Image();
          full.src = src;
          full.onload = () => setFullLoaded(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" } // start loading 200 px before the element is visible
    );
    observer.observe(imgRef.current);
    return () => observer.disconnect();
  }, [src]);

  const openLightbox = useCallback(
    (e: React.MouseEvent) => {
      if (!expandable) return;
      e.stopPropagation();
      setLightboxOpen(true);
    },
    [expandable]
  );

  const closeLightbox = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setLightboxOpen(false);
  }, []);

  // Close on Escape key
  useEffect(() => {
    if (!lightboxOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightboxOpen]);

  return (
    <>
      {/* ── Thumbnail wrapper ──────────────────────────────────────────────── */}
      <div
        className={cn("relative overflow-hidden", wrapperClassName)}
        onClick={openLightbox}
      >
        {/* Thumbnail — shown immediately, fades out when full image loads */}
        <img
          ref={imgRef}
          src={thumb}
          alt={alt}
          loading="lazy"
          decoding="async"
          className={cn(
            "transition-opacity duration-300",
            fullLoaded ? "opacity-0 absolute inset-0" : "opacity-100",
            className
          )}
          {...rest}
        />

        {/* Full image — fades in once loaded */}
        {fullLoaded && (
          <img
            src={src}
            alt={alt}
            loading="lazy"
            decoding="async"
            className={cn("transition-opacity duration-300 opacity-100", className)}
            {...rest}
          />
        )}

        {/* Expand hint overlay */}
        {expandable && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/20 transition-colors cursor-zoom-in">
            <ZoomIn className="h-5 w-5 text-white opacity-0 hover:opacity-100 transition-opacity drop-shadow" />
          </div>
        )}
      </div>

      {/* ── Lightbox ────────────────────────────────────────────────────────── */}
      {lightboxOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={closeLightbox}
        >
          <button
            className="absolute top-4 right-4 rounded-full bg-white/10 hover:bg-white/20 p-2 text-white transition-colors"
            onClick={closeLightbox}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={src}
            alt={alt}
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

// ── PhotoGrid — thin wrapper for list views ───────────────────────────────────
interface Photo {
  id: number | string;
  url: string;
  thumbnailUrl?: string;
  uploadedAt?: string;
}

interface PhotoGridProps {
  photos: Photo[];
  className?: string;
}

/**
 * Renders a responsive grid of maintenance photos.
 * Uses thumbnails for the grid cells; click to view full image in a lightbox.
 *
 * Usage:
 *   <PhotoGrid photos={photos} />
 */
export function PhotoGrid({ photos, className }: PhotoGridProps) {
  if (!photos.length) return null;

  return (
    <div className={cn("grid grid-cols-3 gap-2 sm:grid-cols-4", className)}>
      {photos.map((photo) => (
        <OptimizedImage
          key={photo.id}
          src={photo.url}
          thumbnailUrl={photo.thumbnailUrl}
          alt="Maintenance photo"
          expandable
          className="w-full h-24 object-cover rounded-lg"
          wrapperClassName="rounded-lg border border-border overflow-hidden"
        />
      ))}
    </div>
  );
}
