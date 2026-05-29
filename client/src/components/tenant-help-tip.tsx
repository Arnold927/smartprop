/**
 * TenantHelpTip — inline contextual help for tenant portal
 *
 * Usage:
 *   <TenantHelpTip id="rent-due">
 *     Your rent is due on the 1st of each month. Late payments may attract a penalty.
 *   </TenantHelpTip>
 *
 * Each tip is dismissible and remembers its dismissed state in localStorage.
 */

import { useState } from "react";
import { Info, X } from "lucide-react";

interface TipProps {
  id: string;
  children: React.ReactNode;
  variant?: "info" | "warning" | "tip";
}

function isDismissed(id: string) {
  try { return localStorage.getItem(`sp_tip_${id}`) === "1"; } catch { return false; }
}
function dismiss(id: string) {
  try { localStorage.setItem(`sp_tip_${id}`, "1"); } catch { /* ignore */ }
}

export function TenantHelpTip({ id, children, variant = "info" }: TipProps) {
  const [hidden, setHidden] = useState(() => isDismissed(id));

  if (hidden) return null;

  const styles = {
    info:    "bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200",
    warning: "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200",
    tip:     "bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-800 text-purple-800 dark:text-purple-200",
  }[variant];

  return (
    <div className={`flex items-start gap-2.5 p-3 rounded-xl border text-xs leading-relaxed ${styles} mb-3`}>
      <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 opacity-70" />
      <span className="flex-1">{children}</span>
      <button
        onClick={() => { dismiss(id); setHidden(true); }}
        className="flex-shrink-0 opacity-50 hover:opacity-100 transition-opacity"
        aria-label="Dismiss tip"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/**
 * FloatingHelpButton — re-launches the onboarding wizard on demand
 */
interface FloatingHelpProps {
  onClick: () => void;
}

export function FloatingHelpButton({ onClick }: FloatingHelpProps) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-20 right-4 z-40 w-10 h-10 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
      aria-label="Show help"
      title="Help"
    >
      <span className="text-base font-bold leading-none">?</span>
    </button>
  );
}

export default TenantHelpTip;
