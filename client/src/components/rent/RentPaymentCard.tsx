import { CheckCircle, Bell, MoreVertical } from "lucide-react";
import { format, parseISO, differenceInDays, isValid } from "date-fns";
import { MobileActionSheet } from "@/components/ui/mobile-action-sheet";
import { useState } from "react";

interface RentPaymentCardProps {
  payment: any;
  onMarkPaid: (id: number, onDone: () => void) => void;
  onReminder: (id: number, onDone: () => void) => void;
  isMarkingPaid?: boolean;
  isSendingReminder?: boolean;
}

export function RentPaymentCard({
  payment,
  onMarkPaid,
  onReminder,
  isMarkingPaid = false,
  isSendingReminder = false,
}: RentPaymentCardProps) {
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const canAct = payment.status === "pending" || payment.status === "overdue";

  const actions = [
    {
      label: isMarkingPaid ? "Marking as Paid…" : "Mark as Paid",
      icon: CheckCircle,
      onClick: () => onMarkPaid(payment.id, () => setIsSheetOpen(false)),
      className: "text-green-600",
      disabled: isMarkingPaid,
    },
    {
      label: isSendingReminder ? "Sending…" : "Send Reminder",
      icon: Bell,
      onClick: () => onReminder(payment.id, () => setIsSheetOpen(false)),
      className: "text-amber-600",
      disabled: isSendingReminder,
    },
  ];

  const fmt = (n: number) => `KES ${Math.abs(n).toLocaleString("en-KE")}`;

  const statusColor =
    payment.status === "paid"    ? "text-green-600" :
    payment.status === "overdue" ? "text-red-500"   :
    "text-amber-500";

  // Derive a human-readable billing month from available fields.
  // Prefer explicit billingMonth/periodMonth fields if the server returns them,
  // otherwise fall back to the due date (rent due 5 Jan → "January 2025").
  const dueDateParsed = payment.dueDate
    ? (() => { try { const d = parseISO(payment.dueDate); return isValid(d) ? d : null; } catch { return null; } })()
    : null;

  const billingMonth =
    payment.billingMonth  ??   // e.g. "2025-01"
    payment.periodMonth   ??   // e.g. 1 (numeric)
    payment.period        ??   // e.g. "January 2025"
    null;

  let billingLabel = "";
  if (billingMonth) {
    // If it's a "YYYY-MM" string, format it
    if (typeof billingMonth === "string" && /^\d{4}-\d{2}$/.test(billingMonth)) {
      try { billingLabel = format(parseISO(billingMonth + "-01"), "MMMM yyyy"); } catch {}
    } else if (typeof billingMonth === "number") {
      // Numeric month — pair with due date year if available
      const year = dueDateParsed ? dueDateParsed.getFullYear() : new Date().getFullYear();
      try { billingLabel = format(new Date(year, billingMonth - 1, 1), "MMMM yyyy"); } catch {}
    } else {
      billingLabel = String(billingMonth);
    }
  } else if (dueDateParsed) {
    // Fall back: the billing period is the month the rent was due
    billingLabel = format(dueDateParsed, "MMMM yyyy");
  }

  const daysOverdue =
    (payment.status === "overdue" || payment.status === "pending") && dueDateParsed
      ? Math.max(0, differenceInDays(new Date(), dueDateParsed))
      : 0;

  return (
    <>
      <div
        className="relative bg-card dark:bg-gray-900 border-b border-border dark:border-gray-800 px-4 py-3.5 active:bg-muted transition-colors cursor-pointer"
        onClick={() => canAct && setIsSheetOpen(true)}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-900 text-sm truncate">
              {payment.tenant
                ? `${payment.tenant.firstName} ${payment.tenant.lastName}`
                : "Unknown tenant"}
            </p>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap text-xs text-muted-foreground">
              <span className={`capitalize font-medium ${statusColor}`}>{payment.status}</span>
              {billingLabel && <><span>·</span><span className="font-medium text-foreground">{billingLabel}</span></>}
              {daysOverdue > 0 && <><span>·</span><span className="text-red-500 font-medium">{daysOverdue}d overdue</span></>}
              {payment.unit?.unitNumber && <><span>·</span><span>Unit {payment.unit.unitNumber}</span></>}
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="text-right">
              <p className="font-bold text-slate-900 text-sm">
                {fmt(Number(payment.amount))}
              </p>
            </div>
            {canAct && <MoreVertical className="h-4 w-4 text-muted-foreground" />}
          </div>
        </div>
      </div>

      <MobileActionSheet
        open={isSheetOpen}
        onOpenChange={setIsSheetOpen}
        title="Payment Actions"
        description={`Manage payment for ${payment.tenant?.firstName ?? "tenant"}`}
        actions={actions}
      />
    </>
  );
}