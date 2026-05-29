import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, apiJson } from "@/lib/queryClient";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  CalendarDays, User, DollarSign, MapPin, Home, Clock,
  Wrench, CheckCircle2, XCircle, Pencil, Phone, Mail,
  TrendingUp, TrendingDown, Minus, ClipboardList, Tag,
  AlertCircle, Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow, format } from "date-fns";
import EditMaintenanceModal from "./edit-maintenance-modal";

interface MaintenanceRequest {
  id: number;
  title: string;
  description: string;
  priority: string;
  status: string;
  category?: string;
  assignedTo?: string;
  estimatedCost?: string;
  actualCost?: string;
  ticketNumber?: string;
  createdAt: string;
  completedAt?: string;
  scheduledDate?: string;
  estimatedHours?: number;
  actualHours?: number;
  tenant?: { firstName: string; lastName: string; email?: string; phone?: string };
  unit?: { id?: number; unitNumber: string };
  property?: { id?: number; name: string; address?: string };
  technician?: { id: number; name: string; specialty?: string };
}

interface ViewMaintenanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: MaintenanceRequest | null;
}

// ── Priority config ───────────────────────────────────────────────────────────
const PRIORITY: Record<string, { bg: string; dot: string; text: string; badge: string; label: string }> = {
  urgent: { bg: "bg-red-500",    dot: "bg-red-500",    text: "text-red-600",    badge: "bg-red-50 text-red-700 border-red-200",       label: "Urgent"  },
  high:   { bg: "bg-orange-500", dot: "bg-orange-500", text: "text-orange-600", badge: "bg-orange-50 text-orange-700 border-orange-200", label: "High"  },
  medium: { bg: "bg-amber-400",  dot: "bg-amber-400",  text: "text-amber-600",  badge: "bg-amber-50 text-amber-700 border-amber-200",   label: "Medium" },
  low:    { bg: "bg-emerald-500",dot: "bg-emerald-500",text: "text-emerald-600",badge: "bg-emerald-50 text-emerald-700 border-emerald-200",label: "Low" },
};

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS: Record<string, { icon: any; badge: string; bar: string; progress: number; label: string }> = {
  pending:          { icon: Clock,        badge: "bg-amber-50 text-amber-700 border-amber-200",         bar: "bg-amber-400",   progress: 15,  label: "Pending"     },
  pending_approval: { icon: AlertCircle,  badge: "bg-violet-50 text-violet-700 border-violet-200",      bar: "bg-violet-400",  progress: 10,  label: "Pending Approval" },
  assigned:         { icon: Wrench,       badge: "bg-blue-50 text-blue-700 border-blue-200",            bar: "bg-blue-500",    progress: 35,  label: "Assigned"    },
  in_progress:      { icon: Clock,        badge: "bg-purple-50 text-purple-700 border-purple-200",      bar: "bg-purple-500",  progress: 65,  label: "In Progress" },
  completed:        { icon: CheckCircle2, badge: "bg-emerald-50 text-emerald-700 border-emerald-200",   bar: "bg-emerald-500", progress: 100, label: "Completed"   },
  cancelled:        { icon: XCircle,      badge: "bg-gray-100 text-gray-500 border-gray-200",           bar: "bg-gray-300",    progress: 0,   label: "Cancelled"   },
};

const CATEGORY_LABELS: Record<string, string> = {
  plumbing: "Plumbing", electrical: "Electrical", hvac: "HVAC",
  carpentry: "Carpentry", painting: "Painting", cleaning: "Cleaning",
  landscaping: "Landscaping", appliance: "Appliance", security: "Security", other: "Other",
};

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 mb-3 flex items-center gap-1.5">
      <span className="inline-block w-3 h-px bg-emerald-400" />
      {children}
    </p>
  );
}

function InfoRow({ icon: Icon, label, value, muted }: { icon: any; label: string; value?: string | null; muted?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border/50 last:border-0">
      <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Icon className="w-3.5 h-3.5 text-emerald-600" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={cn("text-sm font-medium mt-0.5 truncate", muted ? "text-muted-foreground" : "text-foreground")}>{value}</p>
      </div>
    </div>
  );
}

function StatTile({ icon: Icon, label, value, accent }: { icon: any; label: string; value: string; accent?: boolean }) {
  return (
    <div className={cn("rounded-xl p-3.5 flex flex-col gap-1", accent ? "bg-emerald-50 border border-emerald-100" : "bg-muted/50 border border-border")}>
      <div className="flex items-center gap-1.5">
        <Icon className={cn("w-3.5 h-3.5", accent ? "text-emerald-600" : "text-muted-foreground")} />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <p className={cn("text-base font-bold", accent ? "text-emerald-700" : "text-foreground")}>{value}</p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ViewMaintenanceModal({ isOpen, onClose, request }: ViewMaintenanceModalProps) {
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [tab, setTab] = useState<"details" | "costs">("details");
  const [, navigate] = useLocation();

  const { data: workOrdersData } = useQuery({
    queryKey: ["/api/work-orders", request?.id],
    queryFn: () => apiJson(`/api/work-orders?maintenanceRequestId=${request!.id}`),
    enabled: isOpen && !!request?.id,
  });
  // apiJson returns the parsed body directly — handle both array and { results: [] } shapes
  const linkedWorkOrder = Array.isArray(workOrdersData)
    ? workOrdersData[0]
    : (workOrdersData as any)?.results?.[0]
    ?? (workOrdersData as any)?.data?.[0]
    ?? null;

  if (!request) return null;

  const pr       = PRIORITY[request.priority] ?? PRIORITY.low;
  const st       = STATUS[request.status]     ?? STATUS.pending;
  const StatusIcon = st.icon;
  const hasCosts = !!(request.estimatedCost || request.actualCost);
  const ageDays  = Math.max(1, Math.ceil((Date.now() - new Date(request.createdAt).getTime()) / 86_400_000));
  const costDiff = (request.estimatedCost && request.actualCost)
    ? parseFloat(request.actualCost) - parseFloat(request.estimatedCost)
    : null;
  const tenantName     = request.tenant ? `${request.tenant.firstName} ${request.tenant.lastName}` : null;
  const tenantInitials = request.tenant ? `${request.tenant.firstName[0]}${request.tenant.lastName[0]}` : null;
  const ticketLabel    = request.ticketNumber ?? `#${String(request.id).padStart(5, "0")}`;

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[600px] p-0 gap-0 overflow-hidden rounded-2xl border-0 shadow-2xl bg-card flex flex-col max-h-[90vh]">

          {/* ── Emerald header band ─────────────────────────────────────────── */}
          <div className="bg-gradient-to-br from-emerald-600 to-emerald-700 px-6 pt-5 pb-4 flex-shrink-0">
            {/* Top row: ticket + age + category + edit */}
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono font-semibold text-emerald-100 bg-emerald-800/40 px-2 py-0.5 rounded">
                  {ticketLabel}
                </span>
                <span className="text-emerald-200/60 text-xs">·</span>
                <span className="text-xs text-emerald-200">
                  {formatDistanceToNow(new Date(request.createdAt), { addSuffix: true })}
                </span>
                {request.category && (
                  <>
                    <span className="text-emerald-200/60 text-xs">·</span>
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-200">
                      <Tag className="w-3 h-3" />
                      {CATEGORY_LABELS[request.category] ?? request.category}
                    </span>
                  </>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-xs border-emerald-400/40 bg-emerald-800/30 text-white hover:bg-emerald-800/50 hover:text-white flex-shrink-0"
                onClick={() => setIsEditOpen(true)}
              >
                <Pencil className="w-3 h-3 mr-1" />Edit
              </Button>
            </div>

            {/* Title + description */}
            <h2 className="text-lg font-bold text-white leading-snug mb-1">{request.title}</h2>
            <p className="text-sm text-emerald-100/80 leading-relaxed line-clamp-2">{request.description}</p>

            {/* Status + priority badges */}
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <span className={cn(
                "inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-semibold border",
                st.badge
              )}>
                <StatusIcon className="w-3 h-3" />
                {st.label}
              </span>
              <span className={cn(
                "text-xs px-2.5 py-1 rounded-full font-semibold border",
                pr.badge
              )}>
                {pr.label} Priority
              </span>
            </div>

            {/* Progress bar */}
            {request.status !== "cancelled" && (
              <div className="mt-3.5 flex items-center gap-2">
                <div className="flex-1 bg-emerald-900/40 rounded-full h-1.5 overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all", st.bar === "bg-emerald-500" ? "bg-white/70" : st.bar)}
                    style={{ width: `${st.progress}%` }}
                  />
                </div>
                <span className="text-xs text-emerald-200 flex-shrink-0 font-medium">{st.progress}%</span>
              </div>
            )}
          </div>

          {/* ── Stat strip ──────────────────────────────────────────────────── */}
          <div className="grid grid-cols-4 divide-x divide-border border-b border-border bg-muted/30 flex-shrink-0">
            {[
              { label: "Age",      value: `${ageDays}d`,                                                                    Icon: Clock      },
              { label: "Estimate", value: request.estimatedCost ? `KSh ${parseFloat(request.estimatedCost).toLocaleString()}` : "TBD", Icon: DollarSign },
              { label: "Assignee", value: request.assignedTo ?? "—",                                                        Icon: Wrench, truncate: true },
              { label: "Unit",     value: request.unit?.unitNumber ?? "—",                                                  Icon: MapPin     },
            ].map(({ label, value, Icon, truncate }) => (
              <div key={label} className="px-3 py-3 flex flex-col gap-0.5">
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Icon className="w-3 h-3 text-emerald-600" />
                  <span className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">{label}</span>
                </div>
                <span className={cn("text-sm font-bold text-foreground", truncate && "truncate")}>{value}</span>
              </div>
            ))}
          </div>

          {/* ── Tab bar (always show, costs tab only when there are costs) ── */}
          <div className="flex border-b border-border bg-card flex-shrink-0">
            {(["details", ...(hasCosts ? ["costs"] : [])] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t as any)}
                className={cn(
                  "px-5 py-2.5 text-sm font-medium capitalize transition-colors relative",
                  tab === t
                    ? "text-emerald-700 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-emerald-600"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t}
              </button>
            ))}
          </div>

          {/* ── Scrollable body ──────────────────────────────────────────────── */}
          <div className="overflow-y-auto flex-1 min-h-0">
            <div className="px-6 py-5 space-y-5">

              {tab === "details" && (
                <>
                  {/* Location */}
                  <div>
                    <SectionLabel>Location</SectionLabel>
                    <div className="rounded-xl border border-border bg-muted/20 divide-y divide-border/50 overflow-hidden">
                      <InfoRow icon={Building2} label="Property" value={request.property?.name} />
                      <InfoRow icon={MapPin}    label="Unit"     value={request.unit?.unitNumber} />
                      {request.property?.address && (
                        <InfoRow icon={MapPin} label="Address" value={request.property.address} muted />
                      )}
                    </div>
                  </div>

                  {/* Tenant */}
                  <div>
                    <SectionLabel>Tenant</SectionLabel>
                    {tenantName ? (
                      <div className="rounded-xl border border-border bg-muted/20 p-4">
                        <div className="flex items-center gap-3 mb-3">
                          <Avatar className="w-10 h-10 flex-shrink-0">
                            <AvatarFallback className="bg-emerald-100 text-emerald-700 text-sm font-bold">
                              {tenantInitials}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-semibold text-foreground">{tenantName}</p>
                            <p className="text-xs text-muted-foreground">Tenant</p>
                          </div>
                        </div>
                        <div className="divide-y divide-border/50">
                          {request.tenant?.email && (
                            <InfoRow icon={Mail}  label="Email" value={request.tenant.email} muted />
                          )}
                          {request.tenant?.phone && (
                            <InfoRow icon={Phone} label="Phone" value={request.tenant.phone} muted />
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-border bg-muted/10 px-4 py-5 text-center">
                        <User className="w-8 h-8 text-muted-foreground/30 mx-auto mb-1.5" />
                        <p className="text-sm text-muted-foreground">No tenant assigned</p>
                      </div>
                    )}
                  </div>

                  {/* Assignment & Timeline */}
                  <div>
                    <SectionLabel>Assignment & Timeline</SectionLabel>
                    <div className="grid grid-cols-2 gap-3">
                      {request.assignedTo && (
                        <StatTile icon={Wrench}       label="Assigned To"  value={request.assignedTo}                                       accent />
                      )}
                      {request.technician && (
                        <StatTile icon={User}         label="Technician"   value={request.technician.name} />
                      )}
                      <StatTile   icon={CalendarDays} label="Created"      value={format(new Date(request.createdAt), "MMM d, yyyy")} />
                      {request.scheduledDate && (
                        <StatTile icon={CalendarDays} label="Scheduled"    value={format(new Date(request.scheduledDate), "MMM d, yyyy")} />
                      )}
                      {request.completedAt && (
                        <StatTile icon={CheckCircle2} label="Completed"    value={format(new Date(request.completedAt), "MMM d, yyyy")} accent />
                      )}
                      {request.estimatedHours != null && (
                        <StatTile icon={Clock}        label="Est. Hours"   value={`${request.estimatedHours}h`} />
                      )}
                      {request.actualHours != null && (
                        <StatTile icon={Clock}        label="Actual Hours" value={`${request.actualHours}h`} />
                      )}
                    </div>
                  </div>
                </>
              )}

              {tab === "costs" && hasCosts && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    {request.estimatedCost && (
                      <div className="rounded-xl border border-border bg-muted/30 p-4">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Estimated</p>
                        <p className="text-2xl font-bold text-foreground">
                          KSh {parseFloat(request.estimatedCost).toLocaleString("en-KE", { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                    )}
                    {request.actualCost && (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 mb-1">Actual</p>
                        <p className="text-2xl font-bold text-emerald-700">
                          KSh {parseFloat(request.actualCost).toLocaleString("en-KE", { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                    )}
                  </div>

                  {costDiff !== null && (
                    <div className={cn(
                      "rounded-xl border p-4 flex items-center gap-3",
                      costDiff > 0 ? "border-red-200 bg-red-50"   :
                      costDiff < 0 ? "border-emerald-200 bg-emerald-50" :
                      "border-border bg-muted/30"
                    )}>
                      {costDiff > 0
                        ? <TrendingUp   className="w-5 h-5 text-red-500 flex-shrink-0" />
                        : costDiff < 0
                        ? <TrendingDown className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                        : <Minus        className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                      }
                      <div>
                        <p className={cn("text-sm font-bold",
                          costDiff > 0 ? "text-red-700" : costDiff < 0 ? "text-emerald-700" : "text-foreground"
                        )}>
                          {costDiff > 0
                            ? `KSh ${Math.abs(costDiff).toLocaleString("en-KE")} over budget`
                            : costDiff < 0
                            ? `KSh ${Math.abs(costDiff).toLocaleString("en-KE")} under budget`
                            : "On budget"
                          }
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">vs. original estimate</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

            </div>
          </div>

          {/* ── Footer ──────────────────────────────────────────────────────── */}
          <div className="px-5 py-3.5 border-t border-border flex items-center justify-between bg-muted/20 flex-shrink-0">
            <Button variant="ghost" size="sm" className="text-muted-foreground h-8" onClick={onClose}>
              Close
            </Button>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className={cn(
                  "h-8 text-xs",
                  linkedWorkOrder
                    ? "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                    : "opacity-40 cursor-not-allowed"
                )}
                disabled={!linkedWorkOrder}
                title={linkedWorkOrder
                  ? "View the work order for this request"
                  : "No work order yet — submit a new request to auto-generate one"
                }
                onClick={() => {
                  if (linkedWorkOrder) { onClose(); navigate(`/work-orders/${linkedWorkOrder.id}`); }
                }}
              >
                <ClipboardList className="w-3.5 h-3.5 mr-1.5" />
                {linkedWorkOrder ? "Work Order" : "No Work Order"}
              </Button>
              <Button
                size="sm"
                className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
                onClick={() => setIsEditOpen(true)}
              >
                <Pencil className="w-3.5 h-3.5 mr-1.5" />
                Edit Request
              </Button>
            </div>
          </div>

        </DialogContent>
      </Dialog>

      <EditMaintenanceModal isOpen={isEditOpen} onClose={() => setIsEditOpen(false)} request={request} />
    </>
  );
}
