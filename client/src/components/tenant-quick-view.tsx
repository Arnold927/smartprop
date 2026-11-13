import { Link } from "wouter";
import { Building2, CalendarDays, ExternalLink, Wallet, Wrench, Receipt } from "lucide-react";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SPAvatar, SPBadge } from "@/components/ui/sp-ui";
import { ContactActions } from "@/components/contact-actions";
import { ActivityTimeline, useTimeline } from "@/components/activity-timeline";
import { cn } from "@/lib/utils";

interface TenantSummary {
  tenantId: number; name: string; email: string; phone: string | null; status: string;
  unitNumber: string | null; propertyName: string | null; monthlyRent: number | null; leaseEnd: string | null;
  balanceDue: number; overdueCount: number; lastPayment: { amount: number; date: string } | null; openMaintenance: number;
}

const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;
const day = (s: string) => new Date(s).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });

function Tile({ icon: Icon, label, value, sub, tone }: { icon: any; label: string; value: string; sub?: string; tone?: "red" | "green" | "amber" }) {
  return (
    <div className={cn("rounded-xl border p-3", tone === "red" && "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40")}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground"><Icon className="h-3.5 w-3.5" />{label}</div>
      <p className={cn("mt-1 text-base font-semibold tabular-nums",
        tone === "red" && "text-red-700 dark:text-red-300", tone === "green" && "text-emerald-700 dark:text-emerald-300", tone === "amber" && "text-amber-700 dark:text-amber-300")}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

interface TenantQuickViewProps {
  tenantId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where "Open full profile" goes. Pass a platform-org-aware path when needed. */
  profileHref?: (id: number) => string;
}

/**
 * Slide-over summary of one tenant, opened from a list row so the manager does
 * not lose their place: contact buttons, balance, last payment, lease end,
 * open maintenance and the recent activity feed.
 */
export function TenantQuickView({ tenantId, open, onOpenChange, profileHref }: TenantQuickViewProps) {
  const { data, isLoading, isError } = useTimeline<TenantSummary>("tenant", open ? tenantId : null, 40);
  const s = data?.summary;
  const daysLeft = s?.leaseEnd ? Math.ceil((new Date(s.leaseEnd).getTime() - Date.now()) / 86400000) : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md p-0">
        <div className="space-y-5 p-5">
          <SheetHeader className="space-y-1 text-left">
            {isLoading || !s ? (
              <div className="flex items-center gap-3"><Skeleton className="h-12 w-12 rounded-full" /><div className="space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-28" /></div></div>
            ) : (
              <div className="flex items-center gap-3">
                <SPAvatar name={s.name} size="lg" />
                <div className="min-w-0">
                  <SheetTitle className="truncate text-lg">{s.name}</SheetTitle>
                  <SheetDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" />{s.unitNumber ? `Unit ${s.unitNumber}` : "No unit"}{s.propertyName ? ` · ${s.propertyName}` : ""}</span>
                    <SPBadge status={s.status} />
                  </SheetDescription>
                </div>
              </div>
            )}
            {isError && <p className="text-sm text-muted-foreground">Could not load this tenant.</p>}
          </SheetHeader>

          {s && (
            <>
              <ContactActions variant="buttons" phone={s.phone} email={s.email} name={s.name}
                message={s.balanceDue > 0 ? `Hello ${s.name.split(" ")[0]}, a friendly reminder that ${kes(s.balanceDue)} is outstanding on your rent. Kindly settle at your earliest convenience.` : undefined} />

              <div className="grid grid-cols-2 gap-3">
                <Tile icon={Wallet} label="Balance due" value={s.balanceDue > 0 ? kes(s.balanceDue) : "Nil"}
                  sub={s.overdueCount ? `${s.overdueCount} overdue invoice${s.overdueCount === 1 ? "" : "s"}` : "All paid up"} tone={s.balanceDue > 0 ? "red" : "green"} />
                <Tile icon={Receipt} label="Last payment" value={s.lastPayment ? kes(s.lastPayment.amount) : "None yet"} sub={s.lastPayment ? day(s.lastPayment.date) : undefined} />
                <Tile icon={CalendarDays} label="Lease ends" value={s.leaseEnd ? day(s.leaseEnd) : "No lease"}
                  sub={daysLeft !== null ? (daysLeft > 0 ? `${daysLeft} days left` : "Expired") : undefined} tone={daysLeft !== null && daysLeft <= 30 ? "amber" : undefined} />
                <Tile icon={Wrench} label="Open requests" value={String(s.openMaintenance)} sub={s.monthlyRent ? `Rent ${kes(s.monthlyRent)}` : undefined} />
              </div>

              <div className="flex gap-2">
                <Button asChild className="flex-1">
                  <Link href={profileHref ? profileHref(s.tenantId) : `/tenants/${s.tenantId}`} onClick={() => onOpenChange(false)}>
                    <ExternalLink className="mr-1.5 h-4 w-4" />Open full profile
                  </Link>
                </Button>
              </div>

              <div>
                <h3 className="mb-3 text-sm font-semibold">Recent activity</h3>
                <ActivityTimeline kind="tenant" id={tenantId} limit={8} compact />
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
