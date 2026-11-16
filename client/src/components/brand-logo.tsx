/**
 * The SmartProp logo, in one place.
 *
 *  - <BrandMark variant="tile">   white building on a green rounded square (menus, headers, small spots)
 *  - <BrandMark variant="plain">  the green gradient building with its two linked properties (large spots)
 *  - <BrandLogo>                  the plain mark plus the name "SmartProp" (sign-in help pages)
 *
 * Both marks are the same building, so wherever it appears it reads as one logo.
 */
import React from "react";

const GREEN = "#059669";

/** The building: roof, body, windows and door, drawn on a 64x64 grid. */
function Building({ body, windows, windowOpacity = 1 }: { body: string; windows: string; windowOpacity?: number }) {
  return (
    <>
      <g fill={body}>
        <rect x="20" y="20" width="24" height="32" rx="2" />
        <path d="M18 20 L32 8 L46 20 Z" />
      </g>
      <g fill={windows} opacity={windowOpacity}>
        {[24, 30, 36].flatMap((y) => [23, 29, 35].map((x) => <rect key={`${x}-${y}`} x={x} y={y} width="3" height="3" rx="0.5" />))}
        <rect x="28" y="44" width="8" height="8" rx="1" />
      </g>
    </>
  );
}

export function BrandMark({ size = 32, variant = "tile", className = "" }: { size?: number; variant?: "tile" | "plain"; className?: string }) {
  if (variant === "tile") {
    const s = 0.85;   // the building, a little smaller than the tile, centred
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" className={`shrink-0 ${className}`} role="img" aria-label="SmartProp">
        <rect width="64" height="64" rx="14" fill={GREEN} />
        <g transform={`translate(${32 - 32 * s} ${32 - 30 * s}) scale(${s})`}>
          <Building body="#ffffff" windows={GREEN} />
        </g>
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className={`shrink-0 ${className}`} role="img" aria-label="SmartProp">
      <defs>
        <linearGradient id="spBrandGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="55%" stopColor="#059669" />
          <stop offset="100%" stopColor="#047857" />
        </linearGradient>
      </defs>
      <g stroke="url(#spBrandGradient)" strokeWidth="1.5" opacity="0.55">
        <path d="M12 32 L20 32 M44 32 L52 32" strokeDasharray="2,2" />
      </g>
      <g fill="url(#spBrandGradient)" opacity="0.7">
        <rect x="4" y="28" width="8" height="8" rx="1" />
        <rect x="52" y="28" width="8" height="8" rx="1" />
      </g>
      <Building body="url(#spBrandGradient)" windows="#ffffff" windowOpacity={0.45} />
    </svg>
  );
}

const SIZES = { sm: { mark: 32, text: "text-lg" }, md: { mark: 40, text: "text-xl" }, lg: { mark: 48, text: "text-2xl" }, xl: { mark: 64, text: "text-3xl" } } as const;

/** The mark and the name. Centred, because it sits at the top of the sign-in help pages. */
export default function BrandLogo({ className = "", size = "md", showText = true }: { className?: string; size?: keyof typeof SIZES; showText?: boolean }) {
  const s = SIZES[size];
  return (
    <div className={`flex items-center justify-center gap-3 ${className}`}>
      <BrandMark size={s.mark} variant="plain" />
      {showText && (
        <div className="flex flex-col leading-tight text-left">
          <span className={`font-bold tracking-tight text-foreground ${s.text}`}>
            Smart<span className="text-emerald-600">Prop</span>
          </span>
          <span className="text-[10px] text-muted-foreground font-medium tracking-wider">PROPERTY MANAGEMENT</span>
        </div>
      )}
    </div>
  );
}
