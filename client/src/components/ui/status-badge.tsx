import { cn } from "@/lib/utils"

interface StatusBadgeProps {
 status: string
 className?: string
}

/**
 * StatusBadge
 * Maps status/priority strings to semantic CSS classes defined in index.css.
 * Each class (e.g. .status-active) resolves its colours via CSS custom-property
 * tokens (--badge-success-bg / --badge-success-fg) that are redefined per-theme
 * in :root, .gray, and .dark. No per-theme overrides or !important rules needed.
 */
export default function StatusBadge({ status, className }: StatusBadgeProps) {
 const variantClass = getVariantClass(status)
 return (
 <span className={cn("status-badge", variantClass, className)}>
 {formatStatus(status)}
 </span>
 )
}

function getVariantClass(status: string): string {
 switch (status.toLowerCase()) {
 case "active":
 return "status-active"
 case "paid":
 case "completed":
 return "status-paid"
 case "pending":
 return "status-pending"
 case "maintenance":
 case "in_progress":
 return "status-maintenance"
 case "overdue":
 case "overdue_rent":
 case "open":
 return "status-overdue"
 case "high":
 case "urgent":
 return "priority-high"
 case "medium":
 return "priority-medium"
 case "low":
 return "priority-low"
 case "cancelled":
 case "inactive":
 // Neutral badge — uses muted tokens via Tailwind
 return "bg-[var(--badge-neutral-bg)] text-[var(--badge-neutral-fg)]"
 case "partial":
 return "priority-medium"
 default:
 return "bg-[var(--badge-neutral-bg)] text-[var(--badge-neutral-fg)]"
 }
}

function formatStatus(status: string): string {
 return status
 .replace(/_/g, " ")
 .replace(/\b\w/g, (l) => l.toUpperCase())
}
