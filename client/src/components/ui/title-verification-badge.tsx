/**
 * TitleVerificationBadge
 *
 * A compact, reusable badge that shows a property's land title verification status.
 * Used on:
 *   - Properties listing cards
 *   - Property detail page header
 *   - Diaspora portal property overview
 *   - Add/Edit property modal (inline, next to the title field)
 *
 * Props:
 *   status   — "verified" | "encumbered" | "disputed" | "not_found" | "error" | "sandbox" | "unverified" | undefined
 *   size     — "sm" | "md" (default "sm")
 *   showIcon — whether to show the shield icon (default true)
 *   isSandbox — show [SANDBOX] tag
 */

import { Shield, ShieldCheck, ShieldAlert, ShieldX, ShieldQuestion, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type TitleVerificationStatus =
  | "verified"
  | "encumbered"
  | "disputed"
  | "not_found"
  | "error"
  | "sandbox"
  | "unverified"
  | undefined
  | null;

interface TitleVerificationBadgeProps {
  status: TitleVerificationStatus;
  size?: "sm" | "md";
  showIcon?: boolean;
  isSandbox?: boolean;
  encumbrances?: string[];
  className?: string;
}

const STATUS_CONFIG: Record<
  string,
  {
    label: string;
    tooltip: string;
    icon: any;
    cls: string;
  }
> = {
  verified: {
    label: "Title Verified",
    tooltip: "Title deed verified against the Ardhisasa land registry — registered and unencumbered.",
    icon: ShieldCheck,
    cls: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  },
  encumbered: {
    label: "Encumbered",
    tooltip: "Title is registered but has active charges or caveats. Review before transacting.",
    icon: ShieldAlert,
    cls: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-700",
  },
  disputed: {
    label: "Disputed",
    tooltip: "This title is currently under dispute. Exercise extreme caution.",
    icon: AlertTriangle,
    cls: "bg-red-100 text-red-800 border-red-300 dark:bg-red-950/40 dark:text-red-300 dark:border-red-700",
  },
  not_found: {
    label: "Not in Registry",
    tooltip: "This title number was not found in the Ardhisasa land registry.",
    icon: ShieldX,
    cls: "bg-red-100 text-red-800 border-red-300 dark:bg-red-950/40 dark:text-red-300 dark:border-red-700",
  },
  error: {
    label: "Verification Error",
    tooltip: "The verification check failed. Please try again.",
    icon: ShieldX,
    cls: "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800  dark:border-gray-600",
  },
  sandbox: {
    label: "Sandbox Result",
    tooltip: "Verification ran in sandbox mode — no real registry call was made.",
    icon: Shield,
    cls: "bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-700",
  },
  unverified: {
    label: "Title Unverified",
    tooltip: "No title deed verification has been run for this property. Landlord-provided details only.",
    icon: ShieldQuestion,
    cls: "bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800/60 dark:text-slate-400 dark:border-slate-600",
  },
};

export function TitleVerificationBadge({
  status,
  size = "sm",
  showIcon = true,
  isSandbox,
  encumbrances,
  className = "",
}: TitleVerificationBadgeProps) {
  const resolvedStatus = status ?? "unverified";
  const cfg = STATUS_CONFIG[resolvedStatus] ?? STATUS_CONFIG["unverified"];
  const Icon = cfg.icon;

  const iconSize = size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5";
  const textSize = size === "sm" ? "text-[10px]" : "text-xs";

  const badgeContent = (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border font-medium whitespace-nowrap ${cfg.cls} ${textSize} ${className}`}
    >
      {showIcon && <Icon className={iconSize} />}
      {cfg.label}
      {isSandbox && resolvedStatus !== "unverified" && (
        <span className="opacity-60 ml-0.5">[sandbox]</span>
      )}
    </span>
  );

  // Build a rich tooltip when there are encumbrances
  const tooltipText =
    encumbrances && encumbrances.length > 0
      ? `${cfg.tooltip}\n\nEncumbrances:\n${encumbrances.map(e => `• ${e}`).join("\n")}`
      : cfg.tooltip;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help">{badgeContent}</span>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="max-w-xs text-xs whitespace-pre-line"
        >
          {tooltipText}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default TitleVerificationBadge;
