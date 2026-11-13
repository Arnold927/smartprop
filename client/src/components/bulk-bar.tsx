import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BulkBarProps {
  count: number;
  onClear: () => void;
  /** Noun for the count, e.g. "tenant" → "3 tenants selected". */
  noun?: string;
  children: ReactNode;
}

/**
 * Floating action bar shown while rows are selected. Sits above the phone's
 * bottom navigation and centred on larger screens. Put the bulk action
 * buttons in `children`.
 */
export function BulkBar({ count, onClear, noun = "item", children }: BulkBarProps) {
  if (count <= 0) return null;
  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="fixed inset-x-3 bottom-[4.5rem] z-40 lg:inset-x-auto lg:bottom-6 lg:left-1/2 lg:-translate-x-1/2 lg:min-w-[28rem]"
    >
      <div className="rounded-xl border bg-card px-3 py-2.5 shadow-xl lg:flex lg:items-center lg:gap-3">
        <div className="flex items-center justify-between gap-2 lg:contents">
          <span className="text-sm font-semibold px-1">
            {count} {noun}{count === 1 ? "" : "s"} selected
          </span>
          <Button variant="ghost" size="icon" className="h-8 w-8 lg:order-last" onClick={onClear} aria-label="Clear selection">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 lg:mt-0 lg:ml-auto">{children}</div>
      </div>
    </div>
  );
}
