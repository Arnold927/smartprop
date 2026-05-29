import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus, Search, Zap, Droplets, Flame, Trash2, Wifi,
  AlertTriangle, CheckCircle, DollarSign, Edit, Clock, X, Save,
  MoreHorizontal, TrendingUp, BarChart3, PieChart, CheckCircle2,
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, PieChart as RePieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { format } from "date-fns";
import DataTable from "@/components/ui/data-table";
import StatusBadge from "@/components/ui/status-badge";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";
import { useRoleGuard, ROLES } from "@/hooks/useRoleGuard";


// ── Types ─────────────────────────────────────────────────────────────────────

interface UtilityBill {
  id: number;
  accountId: number;
  billNumber?: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  dueDate: string;
  amount: string | number;
  currency: string;
  unitsConsumed?: string;
  unitRate?: string;
  status: string;
  notes?: string;
  account?: {
    accountNumber: string;
    property: { name: string };
    provider: { name: string; type: string };
  };
}

interface UtilityProvider {
  id: number;
  name: string;
  type: string;
  contactEmail: string;
  contactPhone: string;
  billingCycle: string;
  averageRate: number;
  currency: string;
  isActive: boolean;
}

interface UtilityAccount {
  id: number;
  propertyId: number;
  unitId?: number;
  providerId: number;
  accountNumber: string;
  meterNumber?: string;
  connectionDate?: string;
  isActive: boolean;
  notes?: string;
}

interface MeterReading {
  id: number;
  accountId: number;
  readingDate: string;
  reading: string;
  readingType: string;
  consumption?: string;
  readBy?: string;
  notes?: string;
  verified?: boolean;
}

interface PropertyExpense {
  id: number;
  expenseNumber: string;
  propertyId: number;
  vendorName: string;
  description: string;
  amount: number;
  currency: string;
  category: string;
  expenseDate: string;
  status: string;
  property?: { name: string };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const utilityTypeIcons: Record<string, any> = {
  electricity: Zap, water: Droplets, gas: Flame,
  waste: Trash2, internet: Wifi, generator: Zap,
};

const getStatusColor = (status: string) => {
  switch (status) {
    case "paid": return "bg-emerald-50 text-emerald-700 border border-emerald-200" ;
    case "pending": return "bg-yellow-100 text-yellow-800";
    case "overdue": return "bg-red-100 text-red-800";
    default: return "bg-muted text-foreground";
  }
};

// ── PagedTable ────────────────────────────────────────────────────────────────

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

function PagedTable<T>({
  data,
  columns,
  emptyMessage,
}: {
  data: T[];
  columns: any[];
  emptyMessage: string;
}) {
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);

  // Reset to page 1 when data length changes (e.g. filter applied)
  const totalPages = Math.max(1, Math.ceil(data.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = data.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <div className="space-y-3">
      {/* Top bar: page-size selector + record count */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {data.length === 0
            ? "No records"
            : `Showing ${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, data.length)} of ${data.length}`}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Rows per page:</span>
          <Select value={String(pageSize)} onValueChange={v => { setPageSize(Number(v)); setPage(1); }}>
            <SelectTrigger className="w-20 h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map(n => (
                <SelectItem key={n} value={String(n)}>{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTable data={paged} columns={columns} emptyMessage={emptyMessage} />

      {/* Pagination controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button size="sm" variant="outline" disabled={safePage === 1} onClick={() => setPage(1)}>«</Button>
          <Button size="sm" variant="outline" disabled={safePage === 1} onClick={() => setPage(p => Math.max(1, p - 1))}>‹</Button>
          <span className="text-sm text-muted-foreground px-2">Page {safePage} of {totalPages}</span>
          <Button size="sm" variant="outline" disabled={safePage === totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>›</Button>
          <Button size="sm" variant="outline" disabled={safePage === totalPages} onClick={() => setPage(totalPages)}>»</Button>
        </div>
      )}
    </div>
  );
}

// ── Row Actions Menu ──────────────────────────────────────────────────────────

function RowActions({ items }: {
  items: Array<{
    label: string;
    icon?: React.ReactNode;
    onClick: () => void;
    destructive?: boolean;
    separator?: boolean;
  }>;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
          <MoreHorizontal className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {items.map((item, i) => (
          <span key={i}>
            {item.separator && <DropdownMenuSeparator />}
            <DropdownMenuItem
              onClick={item.onClick}
              className={item.destructive ? "text-destructive focus:text-destructive" : ""}
            >
              {item.icon && <span className="mr-2">{item.icon}</span>}
              {item.label}
            </DropdownMenuItem>
          </span>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Edit Provider Dialog ──────────────────────────────────────────────────────

function EditProviderDialog({
  provider, open, onClose,
}: { provider: UtilityProvider | null; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isNew = !provider;

  const blank = { name: "", type: "electricity", contactEmail: "", contactPhone: "", billingCycle: "monthly", averageRate: 0, currency: "KES", isActive: true };
  const [form, setForm] = useState<Partial<UtilityProvider>>(provider ? { ...provider } : blank);

  useEffect(() => {
    if (open) setForm(provider ? { ...provider } : blank);
  }, [open, provider]);

  const set = (patch: Partial<UtilityProvider>) => setForm(f => ({ ...f, ...patch }));

  const mutation = useMutation({
    mutationFn: async (data: Partial<UtilityProvider>) => {
      const url = isNew ? "/api/utility-providers" : `/api/utility-providers/${provider!.id}`;
      const method = isNew ? "POST" : "PUT";
      const r = await apiRequest(url, { method, data: data });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/utility-providers"] });
      toast({ title: isNew ? "Provider created" : "Provider updated" });
      onClose();
    },
    onError: () => toast({ title: "Error", description: "Failed to save provider.", variant: "destructive" }),
  });

  const handleChange = (o: boolean) => {
    if (!o) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{isNew ? "Add Provider" : "Edit Provider"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="col-span-2 space-y-1">
            <Label>Provider Name *</Label>
            <Input value={form.name || ""} onChange={e => set({ name: e.target.value })} placeholder="e.g. Kenya Power" />
          </div>
          <div className="space-y-1">
            <Label>Type *</Label>
            <Select value={form.type} onValueChange={v => set({ type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["electricity","water","gas","waste","internet","generator"].map(t => (
                  <SelectItem key={t} value={t} className="capitalize">{t.charAt(0).toUpperCase()+t.slice(1)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Billing Cycle *</Label>
            <Select value={form.billingCycle} onValueChange={v => set({ billingCycle: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["monthly","quarterly","biannual","annual"].map(c => (
                  <SelectItem key={c} value={c} className="capitalize">{c.charAt(0).toUpperCase()+c.slice(1)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Contact Email</Label>
            <Input type="email" value={form.contactEmail || ""} onChange={e => set({ contactEmail: e.target.value })} placeholder="billing@provider.com" />
          </div>
          <div className="space-y-1">
            <Label>Contact Phone</Label>
            <Input value={form.contactPhone || ""} onChange={e => set({ contactPhone: e.target.value })} placeholder="+254 700 000 000" />
          </div>
          <div className="space-y-1">
            <Label>Average Rate</Label>
            <Input type="number" value={form.averageRate || 0} onChange={e => set({ averageRate: parseFloat(e.target.value) })} />
          </div>
          <div className="space-y-1">
            <Label>Currency</Label>
            <Select value={form.currency || "KES"} onValueChange={v => set({ currency: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["KES","USD","EUR"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 flex items-center gap-3">
            <Switch checked={form.isActive ?? true} onCheckedChange={v => set({ isActive: v })} />
            <Label>Active</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}><X className="w-4 h-4 mr-1" />Cancel</Button>
          <Button onClick={() => mutation.mutate(form)} disabled={mutation.isPending || !form.name || !form.type}>
            <Save className="w-4 h-4 mr-1" />{mutation.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit Account Dialog ───────────────────────────────────────────────────────

function EditAccountDialog({
  account, providers, propertiesList, open, onClose,
}: { account: UtilityAccount | null; providers: UtilityProvider[]; propertiesList: { id: number; name: string }[]; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isNew = !account;

  const toDateStr = (d?: string) => d ? format(new Date(d), "yyyy-MM-dd") : "";
  const blank = { accountNumber: "", meterNumber: "", isActive: true, notes: "", propertyId: 0 };
  const fromAccount = (a: UtilityAccount | null) => a ? { ...a, connectionDate: toDateStr(a.connectionDate) } : blank;

  const [form, setForm] = useState<Partial<UtilityAccount>>(fromAccount(account));

  useEffect(() => {
    if (open) setForm(fromAccount(account));
  }, [open, account]);

  const set = (patch: Partial<UtilityAccount>) => setForm(f => ({ ...f, ...patch }));

  const mutation = useMutation({
    mutationFn: async (data: Partial<UtilityAccount>) => {
      const url = isNew ? "/api/utility-accounts" : `/api/utility-accounts/${account!.id}`;
      const method = isNew ? "POST" : "PUT";
      const r = await apiRequest(url, { method, data: data });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/utility-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/utility-bills"] });
      toast({ title: isNew ? "Account created" : "Account updated" });
      onClose();
    },
    onError: () => toast({ title: "Error", description: "Failed to save account.", variant: "destructive" }),
  });

  const handleChange = (o: boolean) => {
    if (!o) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{isNew ? "Add Utility Account" : "Edit Utility Account"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="space-y-1">
            <Label>Account Number *</Label>
            <Input value={form.accountNumber || ""} onChange={e => set({ accountNumber: e.target.value })} placeholder="e.g. ACC-12345" />
          </div>
          <div className="space-y-1">
            <Label>Meter Number</Label>
            <Input value={form.meterNumber || ""} onChange={e => set({ meterNumber: e.target.value })} placeholder="e.g. MTR-67890" />
          </div>
          <div className="col-span-2 space-y-1">
            <Label>Property *</Label>
            <Select value={String(form.propertyId || "")} onValueChange={v => set({ propertyId: parseInt(v) })}>
              <SelectTrigger><SelectValue placeholder="Select property" /></SelectTrigger>
              <SelectContent>
                {propertiesList.map(p => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1">
            <Label>Provider *</Label>
            <Select value={String(form.providerId || "")} onValueChange={v => set({ providerId: parseInt(v) })}>
              <SelectTrigger><SelectValue placeholder="Select provider" /></SelectTrigger>
              <SelectContent>
                {providers.map(p => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.name} ({p.type})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Connection Date</Label>
            <Input type="date" value={form.connectionDate || ""} onChange={e => set({ connectionDate: e.target.value })} />
          </div>
          <div className="flex items-center gap-3 pt-5">
            <Switch checked={form.isActive ?? true} onCheckedChange={v => set({ isActive: v })} />
            <Label>Active</Label>
          </div>
          <div className="col-span-2 space-y-1">
            <Label>Notes</Label>
            <Textarea value={form.notes || ""} onChange={e => set({ notes: e.target.value })} placeholder="Optional notes…" rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}><X className="w-4 h-4 mr-1" />Cancel</Button>
          <Button onClick={() => mutation.mutate(form)} disabled={mutation.isPending || !form.accountNumber || !form.providerId || !form.propertyId}>
            <Save className="w-4 h-4 mr-1" />{mutation.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit Bill Dialog ──────────────────────────────────────────────────────────

function EditBillDialog({
  bill, open, onClose,
}: { bill: UtilityBill | null; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isNew = !bill;

  const toDate = (d?: string) => d ? format(new Date(d), "yyyy-MM-dd") : "";
  const blank = { amount: "", currency: "KES", status: "pending", notes: "", billingPeriodStart: "", billingPeriodEnd: "", dueDate: "", utilityType: "water" };
  const fromBill = (b: UtilityBill | null) => b ? {
    ...b,
    billingPeriodStart: toDate(b.billingPeriodStart),
    billingPeriodEnd: toDate(b.billingPeriodEnd),
    dueDate: toDate(b.dueDate),
    utilityType: (b as any).utilityType || b.account?.provider.type || "water",
  } : blank;

  const [form, setForm] = useState<any>(fromBill(bill));

  useEffect(() => {
    if (open) setForm(fromBill(bill));
  }, [open, bill]);

  const set = (patch: any) => setForm((f: any) => {
    const next = { ...f, ...patch };
    // Finance: auto-compute amount when we have enough data
    // amount = unitsConsumed × unitRate  OR  (currentReading − previousReading) × unitRate
    const units = parseFloat(next.unitsConsumed) || 0;
    const rate  = parseFloat(next.unitRate)       || 0;
    const prev  = parseFloat(next.previousReading) || 0;
    const curr  = parseFloat(next.currentReading)  || 0;
    const computedUnits = units > 0 ? units : (curr > prev ? curr - prev : 0);
    if (computedUnits > 0 && rate > 0 && !patch.amount) {
      next.amount = (computedUnits * rate).toFixed(2);
      next.unitsConsumed = next.unitsConsumed || String(computedUnits);
    }
    return next;
  });

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      const url = isNew ? "/api/utility-bills" : `/api/utility-bills/${bill!.id}`;
      const method = isNew ? "POST" : "PUT";
      const r = await apiRequest(url, { method, data: data });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/utility-bills"] });
      toast({ title: isNew ? "Bill created" : "Bill updated" });
      onClose();
    },
    onError: () => toast({ title: "Error", description: "Failed to save bill.", variant: "destructive" }),
  });

  const handleChange = (o: boolean) => {
    if (!o) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{isNew ? "Add Utility Bill" : "Edit Utility Bill"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="col-span-2 space-y-1">
            <Label>Utility Type *</Label>
            <Select value={form.utilityType || "water"} onValueChange={v => set({ utilityType: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {[
                  { value: "water", label: "💧 Water" },
                  { value: "electricity", label: "⚡ Electricity" },
                  { value: "gas", label: "🔥 Gas" },
                  { value: "internet", label: "📶 Internet / WiFi" },
                  { value: "waste", label: "🗑️ Waste" },
                  { value: "generator", label: "⚙️ Generator" },
                  { value: "other", label: "🔧 Other" },
                ].map(t => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Period Start *</Label>
            <Input type="date" value={form.billingPeriodStart || ""} onChange={e => set({ billingPeriodStart: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>Period End *</Label>
            <Input type="date" value={form.billingPeriodEnd || ""} onChange={e => set({ billingPeriodEnd: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>Due Date *</Label>
            <Input type="date" value={form.dueDate || ""} onChange={e => set({ dueDate: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>Status</Label>
            <Select value={form.status || "pending"} onValueChange={v => set({ status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["pending","paid","overdue","disputed"].map(s => (
                  <SelectItem key={s} value={s} className="capitalize">{s.charAt(0).toUpperCase()+s.slice(1)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Amount *</Label>
            <Input type="number" value={form.amount || ""} onChange={e => set({ amount: e.target.value })} placeholder="0.00" />
          </div>
          <div className="space-y-1">
            <Label>Currency</Label>
            <Select value={form.currency || "KES"} onValueChange={v => set({ currency: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["KES","USD","EUR"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Units Consumed</Label>
            <Input value={form.unitsConsumed || ""} onChange={e => set({ unitsConsumed: e.target.value })} placeholder="e.g. 250 kWh" />
          </div>
          <div className="space-y-1">
            <Label>Unit Rate</Label>
            <Input type="number" step="0.01" value={form.unitRate || ""} onChange={e => set({ unitRate: e.target.value })} placeholder="e.g. 18.50" />
          </div>
          <div className="space-y-1">
            <Label>Previous Reading</Label>
            <Input type="number" value={form.previousReading || ""} onChange={e => set({ previousReading: e.target.value })} placeholder="e.g. 12000" />
          </div>
          <div className="space-y-1">
            <Label>Current Reading</Label>
            <Input type="number" value={form.currentReading || ""} onChange={e => set({ currentReading: e.target.value })} placeholder="e.g. 12250" />
          </div>
          <div className="col-span-2 space-y-1">
            <Label>Amount * <span className="text-xs text-muted-foreground font-normal">(auto-calculated from readings × rate)</span></Label>
            <Input type="number" step="0.01" value={form.amount || ""} onChange={e => set({ amount: e.target.value })} placeholder="0.00" className={form.amount && !isNaN(Number(form.amount)) ? "ring-1 ring-emerald-400" : ""} />
          </div>
          <div className="col-span-2 space-y-1">
            <Label>Notes</Label>
            <Textarea value={form.notes || ""} onChange={e => set({ notes: e.target.value })} placeholder="Optional notes…" rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}><X className="w-4 h-4 mr-1" />Cancel</Button>
          <Button onClick={() => mutation.mutate(form)} disabled={mutation.isPending || !form.amount || !form.dueDate}>
            <Save className="w-4 h-4 mr-1" />{mutation.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit Meter Reading Dialog ─────────────────────────────────────────────────

function EditReadingDialog({
  reading, accounts, open, onClose,
}: { reading: MeterReading | null; accounts: UtilityAccount[]; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isNew = !reading;

  const blank = {
    accountId: 0,
    readingDate: new Date().toISOString().split("T")[0],
    reading: "",
    readingType: "manual",
    consumption: "",
    readBy: "",
    notes: "",
  };
  const fromReading = (r: MeterReading | null) => r ? {
    ...r,
    readingDate: r.readingDate ? format(new Date(r.readingDate), "yyyy-MM-dd") : "",
  } : blank;

  const [form, setForm] = useState<any>(fromReading(reading));

  useEffect(() => {
    if (open) setForm(fromReading(reading));
  }, [open, reading]);

  const set = (patch: any) => setForm((f: any) => ({ ...f, ...patch }));

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      const url = isNew ? "/api/utility-meter-readings" : `/api/utility-meter-readings/${reading!.id}`;
      const method = isNew ? "POST" : "PUT";
      const r = await apiRequest(url, { method, data });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/utility-meter-readings"] });
      toast({ title: isNew ? "Reading recorded" : "Reading updated" });
      onClose();
    },
    onError: () => toast({ title: "Error", description: "Failed to save reading.", variant: "destructive" }),
  });

  const handleChange = (o: boolean) => {
    if (!o) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>{isNew ? "Record Meter Reading" : "Edit Meter Reading"}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Account *</Label>
            <Select value={String(form.accountId || "")} onValueChange={v => set({ accountId: parseInt(v) })}>
              <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
              <SelectContent>
                {accounts.map((a: UtilityAccount) => (
                  <SelectItem key={a.id} value={String(a.id)}>{a.accountNumber}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Reading Date *</Label>
              <Input type="date" value={form.readingDate || ""} onChange={e => set({ readingDate: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Reading Type</Label>
              <Select value={form.readingType || "manual"} onValueChange={v => set({ readingType: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="auto">Automatic</SelectItem>
                  <SelectItem value="estimated">Estimated</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Meter Reading *</Label>
              <Input type="number" value={form.reading || ""} onChange={e => set({ reading: e.target.value })} placeholder="e.g. 12345" />
            </div>
            <div className="space-y-1">
              <Label>Consumption</Label>
              <Input value={form.consumption || ""} onChange={e => set({ consumption: e.target.value })} placeholder="e.g. 250 kWh" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Read By</Label>
            <Input value={form.readBy || ""} onChange={e => set({ readBy: e.target.value })} placeholder="Name of reader" />
          </div>
          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea value={form.notes || ""} onChange={e => set({ notes: e.target.value })} placeholder="Optional notes…" rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}><X className="w-4 h-4 mr-1" />Cancel</Button>
          <Button onClick={() => mutation.mutate(form)} disabled={mutation.isPending || !form.reading || !form.accountId}>
            <Save className="w-4 h-4 mr-1" />{mutation.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Accounts Tab ──────────────────────────────────────────────────────────────

function AccountsTab({ providers, propertiesList, searchTerm }: { providers: UtilityProvider[]; propertiesList: { id: number; name: string }[]; searchTerm: string }) {
  const [editAccount, setEditAccount] = useState<UtilityAccount | null | "new">(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: accounts = [] } = useQuery<UtilityAccount[]>({
    queryKey: ["/api/utility-accounts"],
    queryFn: async () => {
      const r = await apiRequest("/api/utility-accounts");
      return ensureArray(await r.json());
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => apiRequest(`/api/utility-accounts/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/utility-accounts"] });
      toast({ title: "Account deleted" });
    },
  });

  const filtered = accounts.filter(a => {
    const pName = providers.find(p => p.id === a.providerId)?.name || "";
    return a.accountNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      pName.toLowerCase().includes(searchTerm.toLowerCase());
  });

  const columns = [
    {
      header: "Account Number", accessorKey: "accountNumber",
      cell: (a: UtilityAccount) => <span className="font-mono text-sm font-medium">{a.accountNumber}</span>,
    },
    {
      header: "Meter Number", accessorKey: "meterNumber",
      cell: (a: UtilityAccount) => a.meterNumber || <span className="text-muted-foreground">—</span>,
    },
    {
      header: "Provider", accessorKey: "provider",
      cell: (a: UtilityAccount) => {
        const p = providers.find(pr => pr.id === a.providerId);
        if (!p) return <span className="text-muted-foreground">Unknown</span>;
        const Icon = utilityTypeIcons[p.type] || Zap;
        return (
          <div className="flex items-center gap-2">
            <Icon className="w-4 h-4 text-muted-foreground" />
            <span>{p.name}</span>
          </div>
        );
      },
    },
    {
      header: "Connection Date", accessorKey: "connectionDate",
      cell: (a: UtilityAccount) => a.connectionDate
        ? format(new Date(a.connectionDate), "MMM dd, yyyy")
        : <span className="text-muted-foreground">—</span>,
    },
    {
      header: "Status", accessorKey: "isActive",
      cell: (a: UtilityAccount) => (
        <Badge className={a.isActive ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-muted text-foreground"}>
          {a.isActive ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    {
      header: "", accessorKey: "actions",
      cell: (a: UtilityAccount) => (
        <RowActions items={[
          { label: "Edit", icon: <Edit className="w-4 h-4" />, onClick: () => setEditAccount(a) },
          { label: "Delete", icon: <Trash2 className="w-4 h-4" />, onClick: () => { if (confirm("Delete this account?")) deleteMutation.mutate(a.id); }, destructive: true, separator: true },
        ]} />
      ),
    },
  ];

  return (
    <>
      <div className="flex justify-end mb-4">
        <Button onClick={() => setEditAccount("new")}><Plus className="w-4 h-4 mr-2" />Add Account</Button>
      </div>
      <PagedTable data={filtered} columns={columns} emptyMessage="No utility accounts found" />
      <EditAccountDialog
        account={editAccount === "new" ? null : editAccount}
        providers={providers}
        propertiesList={propertiesList}
        open={editAccount !== null}
        onClose={() => setEditAccount(null)}
      />
    </>
  );
}

// ── Meter Readings Tab ────────────────────────────────────────────────────────

function ReadingsTab({ searchTerm }: { searchTerm: string }) {
  const [editReading, setEditReading] = useState<MeterReading | null | "new">(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: readings = [] } = useQuery<MeterReading[]>({
    queryKey: ["/api/utility-meter-readings"],
    queryFn: async () => {
      const r = await apiRequest("/api/utility-meter-readings");
      return ensureArray(await r.json());
    },
  });

  const { data: accounts = [] } = useQuery<UtilityAccount[]>({
    queryKey: ["/api/utility-accounts"],
    queryFn: async () => {
      const r = await apiRequest("/api/utility-accounts");
      return ensureArray(await r.json());
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => apiRequest(`/api/utility-meter-readings/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/utility-meter-readings"] });
      toast({ title: "Reading deleted" });
    },
  });

  const verifyMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await apiRequest(`/api/utility-meter-readings/${id}`, { method: "PUT", data: { verified: true } });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/utility-meter-readings"] });
      toast({ title: "Reading verified" });
    },
  });

  const filtered = readings.filter(r => {
    const acct = accounts.find(a => a.id === r.accountId);
    return !searchTerm ||
      (acct?.accountNumber || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.readingType.toLowerCase().includes(searchTerm.toLowerCase());
  });

  const columns = [
    {
      header: "Date", accessorKey: "readingDate",
      cell: (r: MeterReading) => format(new Date(r.readingDate), "MMM dd, yyyy"),
    },
    {
      header: "Account", accessorKey: "accountId",
      cell: (r: MeterReading) => {
        const acct = accounts.find(a => a.id === r.accountId);
        return acct ? <span className="font-mono text-sm">{acct.accountNumber}</span> : <span className="text-muted-foreground">Unknown</span>;
      },
    },
    {
      header: "Reading", accessorKey: "reading",
      cell: (r: MeterReading) => <span className="font-semibold">{r.reading}</span>,
    },
    {
      header: "Consumption", accessorKey: "consumption",
      cell: (r: MeterReading) => r.consumption || <span className="text-muted-foreground">—</span>,
    },
    {
      header: "Type", accessorKey: "readingType",
      cell: (r: MeterReading) => <Badge variant="outline" className="capitalize">{r.readingType}</Badge>,
    },
    {
      header: "Verified", accessorKey: "verified",
      cell: (r: MeterReading) => r.verified
        ? <CheckCircle2 className="w-4 h-4 text-green-600" />
        : <Clock className="w-4 h-4 text-muted-foreground" />,
    },
    {
      header: "", accessorKey: "actions",
      cell: (r: MeterReading) => (
        <RowActions items={[
          { label: "Edit", icon: <Edit className="w-4 h-4" />, onClick: () => setEditReading(r) },
          ...(!r.verified ? [{ label: "Verify", icon: <CheckCircle2 className="w-4 h-4" />, onClick: () => verifyMutation.mutate(r.id) }] : []),
          { label: "Delete", icon: <Trash2 className="w-4 h-4" />, onClick: () => { if (confirm("Delete this reading?")) deleteMutation.mutate(r.id); }, destructive: true, separator: true },
        ]} />
      ),
    },
  ];

  return (
    <>
      <div className="flex justify-end mb-4">
        <Button onClick={() => setEditReading("new")}><Plus className="w-4 h-4 mr-2" />Record Reading</Button>
      </div>
      <PagedTable data={filtered} columns={columns} emptyMessage="No meter readings found" />
      <EditReadingDialog
        reading={editReading === "new" ? null : editReading}
        accounts={accounts}
        open={editReading !== null}
        onClose={() => setEditReading(null)}
      />
    </>
  );
}

// ── Analytics Tab ─────────────────────────────────────────────────────────────

function AnalyticsTab({ bills, providers }: { bills: UtilityBill[]; providers: UtilityProvider[] }) {
  const { data: accounts = [] } = useQuery<UtilityAccount[]>({
    queryKey: ["/api/utility-accounts"],
    queryFn: async () => {
      const r = await apiRequest("/api/utility-accounts");
      return ensureArray(await r.json());
    },
  });

  const totalAmount = bills.reduce((sum, b) => sum + parseFloat(String(b.amount) || "0"), 0);
  const paidBillsCount = bills.filter(b => b.status === "paid").length;
  const pendingBillsCount = bills.filter(b => b.status === "pending").length;
  const overdueBillsCount = bills.filter(b => b.status === "overdue").length;

  const billStatusData = [
    { name: "Pending", value: pendingBillsCount, color: "#f59e0b" },
    { name: "Paid", value: paidBillsCount, color: "#10b981" },
    { name: "Overdue", value: overdueBillsCount, color: "#ef4444" },
  ];

  const typeBreakdown = providers.reduce((acc: any[], p) => {
    const existing = acc.find(item => item.type === p.type);
    if (existing) { existing.count += 1; } else { acc.push({ type: p.type, count: 1 }); }
    return acc;
  }, []);

  const monthlyTrends = bills
    .reduce((acc: any[], bill) => {
      const month = new Date(bill.billingPeriodStart).toLocaleDateString("en-US", { month: "short", year: "numeric" });
      const existing = acc.find(item => item.month === month);
      if (existing) {
        existing.amount += parseFloat(String(bill.amount) || "0");
        existing.count += 1;
      } else {
        acc.push({ month, amount: parseFloat(String(bill.amount) || "0"), count: 1 });
      }
      return acc;
    }, [])
    .slice(-6);

  const costByProvider = providers.map(p => {
    const providerAccounts = accounts.filter(a => a.providerId === p.id);
    const accountIds = providerAccounts.map(a => a.id);
    const providerBills = bills.filter(b => accountIds.includes(b.accountId));
    return { name: p.name, cost: providerBills.reduce((sum, b) => sum + parseFloat(String(b.amount) || "0"), 0) };
  });

  return (
    <div className="space-y-6">
      {/* Summary stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Average Bill Amount</p>
            <p className="text-2xl font-semibold mt-1">
              KSh {bills.length > 0 ? (totalAmount / bills.length).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "0"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Payment Rate</p>
            <p className="text-2xl font-semibold mt-1">
              {bills.length > 0 ? ((paidBillsCount / bills.length) * 100).toFixed(1) : "0"}%
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Active Accounts</p>
            <p className="text-2xl font-semibold mt-1">
              {accounts.filter(a => a.isActive).length}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <PieChart className="h-4 w-4" />Bill Status Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <RePieChart>
                <Pie data={billStatusData} cx="50%" cy="50%" labelLine={false}
                  label={({ name, value }) => value > 0 ? `${name}: ${value}` : ""}
                  outerRadius={90} dataKey="value">
                  {billStatusData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip />
              </RePieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4" />Utility Type Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={typeBreakdown}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="type" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4" />Monthly Bill Trends
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={monthlyTrends}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="amount" stroke="#3b82f6" name="Amount (KES)" dot={false} />
                <Line type="monotone" dataKey="count" stroke="#10b981" name="Bill Count" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <DollarSign className="h-4 w-4" />Cost by Provider
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={costByProvider}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="cost" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function UtilityManagement() {
  const guard = useRoleGuard(ROLES.ADMIN_MANAGER_STAFF);
  if (guard.gate) return guard.gate;

  const [activeTab, setActiveTab] = useState<"bills" | "providers" | "accounts" | "expenses" | "readings" | "analytics">("bills");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [editBill, setEditBill] = useState<UtilityBill | null | "new">(null);
  const [editProvider, setEditProvider] = useState<UtilityProvider | null | "new">(null);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: rawBills = [] } = useQuery<UtilityBill[]>({
    queryKey: ["/api/utility-bills"],
    queryFn: async () => { const r = await apiRequest("/api/utility-bills"); return ensureArray(await r.json()); },
    enabled: activeTab === "bills" || activeTab === "analytics",
  });

  const { data: providers = [] } = useQuery<UtilityProvider[]>({
    queryKey: ["/api/utility-providers"],
    queryFn: async () => { const r = await apiRequest("/api/utility-providers"); return ensureArray(await r.json()); },
  });

  const { data: allAccounts = [] } = useQuery<UtilityAccount[]>({
    queryKey: ["/api/utility-accounts"],
    queryFn: async () => { const r = await apiRequest("/api/utility-accounts"); return ensureArray(await r.json()); },
  });

  const { data: propertiesList = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/properties"],
    queryFn: async () => { const r = await apiRequest("/api/properties"); return ensureArray(await r.json()); },
  });

  // Enrich bills client-side with account -> provider + property lookups
  const bills: UtilityBill[] = rawBills.map(bill => {
    const account = allAccounts.find(a => a.id === bill.accountId);
    const provider = account ? providers.find(p => p.id === account.providerId) : undefined;
    const property = account ? propertiesList.find(p => p.id === account.propertyId) : undefined;
    return {
      ...bill,
      account: account ? {
        accountNumber: account.accountNumber,
        property: { name: property?.name ?? `Property #${account.propertyId}` },
        provider: { name: provider?.name ?? "Unknown", type: provider?.type ?? "" },
      } : bill.account,
    };
  });

  const { data: rawExpenses = [] } = useQuery<PropertyExpense[]>({
    queryKey: ["/api/property-expenses"],
    queryFn: async () => {
      const r = await apiRequest("/api/property-expenses?page_size=200");
      return ensureArray(await r.json());
    },
    enabled: activeTab === "expenses",
  });

  // Enrich expenses with property name from propertiesList
  const expenses: PropertyExpense[] = rawExpenses.map(e => ({
    ...e,
    property: e.property ?? { name: propertiesList.find(p => p.id === e.propertyId)?.name ?? "—" },
  }));

  const deleteProviderMutation = useMutation({
    mutationFn: async (id: number) => apiRequest(`/api/utility-providers/${id}`, { method: "DELETE" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/utility-providers"] }); toast({ title: "Provider deleted" }); },
  });

  const deleteBillMutation = useMutation({
    mutationFn: async (id: number) => apiRequest(`/api/utility-bills/${id}`, { method: "DELETE" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/utility-bills"] }); toast({ title: "Bill deleted" }); },
  });

  const markBillPaidMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await apiRequest(`/api/utility-bills/${id}`, { method: "PUT", data: { status: "paid", paidDate: new Date().toISOString() } });
      return r.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/utility-bills"] }); toast({ title: "Bill marked as paid" }); },
  });

  const totalMonthlyBills = bills.reduce((sum, b) => sum + Number(b.amount), 0);
  const overdueBills = bills.filter(b => b.status === "overdue");
  const pendingBills = bills.filter(b => b.status === "pending");
  const activeProviders = providers.filter(p => p.isActive);

  const filteredBills = bills.filter(bill => {
    const matchesSearch = !searchTerm ||
      bill.account?.provider.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      bill.account?.property.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (bill.billNumber || "").toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || bill.status === statusFilter;
    const matchesType = typeFilter === "all" || bill.account?.provider.type === typeFilter;
    const billStart = bill.billingPeriodStart ? new Date(bill.billingPeriodStart) : null;
    const matchesDateFrom = !dateFrom || (billStart && billStart >= new Date(dateFrom));
    const matchesDateTo = !dateTo || (billStart && billStart <= new Date(dateTo + "T23:59:59"));
    return matchesSearch && matchesStatus && matchesType && matchesDateFrom && matchesDateTo;
  });

  const filteredProviders = providers.filter(p => {
    const matchesSearch = !searchTerm ||
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.type.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSearch && (typeFilter === "all" || p.type === typeFilter);
  });

  const filteredExpenses = (Array.isArray(expenses) ? expenses : []).filter(e =>
    !searchTerm ||
    e.vendorName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (e.property?.name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.expenseNumber.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const billColumns = [
    {
      // Merged: icon + provider type + bill# + property all in one cell
      header: "Bill", accessorKey: "provider",
      cell: (bill: UtilityBill) => {
        const resolvedType = (bill as any).utilityType || bill.account?.provider.type || "";
        const Icon = utilityTypeIcons[resolvedType] || Zap;
        return (
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
              <Icon className="w-4 h-4 text-blue-600" />
            </div>
            <div className="min-w-0">
              <p className="font-medium text-foreground truncate">
                {bill.account?.provider.name || <span className="text-muted-foreground">—</span>}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {bill.account?.property.name || "—"}
                {bill.billNumber && <span className="ml-1 font-mono text-blue-500">· {bill.billNumber}</span>}
              </p>
            </div>
          </div>
        );
      },
    },
    {
      // Merged: billing period + due date
      header: "Period / Due", accessorKey: "billingPeriod",
      cell: (b: UtilityBill) => (
        <div className="text-xs">
          {b.billingPeriodStart
            ? <p className="text-muted-foreground">{format(new Date(b.billingPeriodStart), "MMM d")} – {format(new Date(b.billingPeriodEnd), "MMM d, yyyy")}</p>
            : <p className="text-muted-foreground">—</p>}
          <p className="font-medium text-foreground mt-0.5">Due {format(new Date(b.dueDate), "MMM d, yyyy")}</p>
        </div>
      ),
    },
    {
      // Merged: amount + units consumed
      header: "Amount", accessorKey: "amount",
      cell: (b: UtilityBill) => (
        <div>
          <p className="font-semibold">{b.currency} {Number(b.amount).toLocaleString()}</p>
          {b.unitsConsumed && <p className="text-xs text-muted-foreground">{b.unitsConsumed} units</p>}
        </div>
      ),
    },
    {
      header: "Status", accessorKey: "status",
      cell: (b: UtilityBill) => (
        <Badge className={getStatusColor(b.status)}>
          {b.status.charAt(0).toUpperCase() + b.status.slice(1)}
        </Badge>
      ),
    },
    {
      header: "", accessorKey: "actions",
      cell: (b: UtilityBill) => (
        <RowActions items={[
          { label: "Edit", icon: <Edit className="w-4 h-4" />, onClick: () => setEditBill(b) },
          ...(b.status === "pending" ? [{ label: "Mark Paid", icon: <CheckCircle2 className="w-4 h-4" />, onClick: () => markBillPaidMutation.mutate(b.id) }] : []),
          { label: "Delete", icon: <Trash2 className="w-4 h-4" />, onClick: () => { if (confirm("Delete this bill?")) deleteBillMutation.mutate(b.id); }, destructive: true, separator: true },
        ]} />
      ),
    },
  ];

  const providerColumns = [
    {
      header: "Provider", accessorKey: "name",
      cell: (p: UtilityProvider) => {
        const Icon = utilityTypeIcons[p.type] || Zap;
        return (
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center">
              <Icon className="w-4 h-4 text-green-600" />
            </div>
            <div>
              <p className="font-medium">{p.name}</p>
              <p className="text-xs text-muted-foreground capitalize">{p.type}</p>
            </div>
          </div>
        );
      },
    },
    {
      header: "Contact", accessorKey: "contact",
      cell: (p: UtilityProvider) => (
        <div>
          <p className="text-sm">{p.contactEmail || "—"}</p>
          <p className="text-xs text-muted-foreground">{p.contactPhone || ""}</p>
        </div>
      ),
    },
    {
      header: "Billing Cycle", accessorKey: "billingCycle",
      cell: (p: UtilityProvider) => <Badge variant="outline" className="capitalize">{p.billingCycle}</Badge>,
    },
    {
      header: "Avg Rate", accessorKey: "averageRate",
      cell: (p: UtilityProvider) => <span className="font-medium">{p.currency} {Number(p.averageRate).toFixed(2)}</span>,
    },
    {
      header: "Status", accessorKey: "isActive",
      cell: (p: UtilityProvider) => (
        <Badge className={p.isActive ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-muted text-foreground"}>
          {p.isActive ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    {
      header: "", accessorKey: "actions",
      cell: (p: UtilityProvider) => (
        <RowActions items={[
          { label: "Edit", icon: <Edit className="w-4 h-4" />, onClick: () => setEditProvider(p) },
          { label: "Delete", icon: <Trash2 className="w-4 h-4" />, onClick: () => { if (confirm(`Delete "${p.name}"?`)) deleteProviderMutation.mutate(p.id); }, destructive: true, separator: true },
        ]} />
      ),
    },
  ];

  const expenseColumns = [
    {
      header: "Vendor", accessorKey: "vendorName",
      cell: (e: PropertyExpense) => (
        <div>
          <p className="font-medium">{e.vendorName}</p>
          <p className="text-xs font-mono text-muted-foreground">{e.expenseNumber}</p>
        </div>
      ),
    },
    {
      header: "Description & Property", accessorKey: "description",
      cell: (e: PropertyExpense) => (
        <div>
          <p className="text-sm truncate max-w-[220px]">{e.description}</p>
          <p className="text-xs text-muted-foreground">{e.property?.name || "—"}</p>
        </div>
      ),
    },
    {
      header: "Category & Date", accessorKey: "category",
      cell: (e: PropertyExpense) => (
        <div>
          <Badge variant="outline" className="capitalize text-xs">{e.category}</Badge>
          <p className="text-xs text-muted-foreground mt-1">{format(new Date(e.expenseDate), "MMM dd, yyyy")}</p>
        </div>
      ),
    },
    {
      header: "Amount", accessorKey: "amount",
      cell: (e: PropertyExpense) => <span className="font-medium whitespace-nowrap">{e.currency} {Number(e.amount).toLocaleString()}</span>,
    },
    {
      header: "Status", accessorKey: "status",
      cell: (e: PropertyExpense) => <StatusBadge status={e.status} />,
    },
  ];

  const tabs = [
    { key: "bills" as const, label: "Utility Bills" },
    { key: "providers" as const, label: "Service Providers" },
    { key: "accounts" as const, label: "Accounts" },
    { key: "expenses" as const, label: "Utility Expenses" },
    { key: "readings" as const, label: "Meter Readings" },
    { key: "analytics" as const, label: "Analytics" },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Utility Management</h1>
          <p className="text-muted-foreground mt-1">Manage utility bills, providers, accounts, and expenses</p>
        </div>
        {activeTab === "bills" && (
          <Button onClick={() => setEditBill("new")}><Plus className="w-4 h-4 mr-2" />Add Utility Bill</Button>
        )}
        {activeTab === "providers" && (
          <Button onClick={() => setEditProvider("new")}><Plus className="w-4 h-4 mr-2" />Add Provider</Button>
        )}
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { icon: DollarSign, bg: "bg-blue-100", color: "text-blue-600", label: "Monthly Bills Total", value: `KES ${totalMonthlyBills.toLocaleString()}`, valueColor: "text-foreground" },
          { icon: AlertTriangle, bg: "bg-red-100", color: "text-red-600", label: "Overdue Bills", value: overdueBills.length, valueColor: "text-red-600" },
          { icon: Clock, bg: "bg-yellow-100", color: "text-yellow-600", label: "Pending Bills", value: pendingBills.length, valueColor: "text-yellow-600" },
          { icon: CheckCircle, bg: "bg-green-100", color: "text-green-600", label: "Active Providers", value: activeProviders.length, valueColor: "text-green-600" },
        ].map(({ icon: Icon, bg, color, label, value, valueColor }) => (
          <Card key={label}>
            <CardContent className="p-6">
              <div className="flex items-center space-x-4">
                <div className={`p-3 ${bg} rounded-lg`}><Icon className={`w-6 h-6 ${color}`} /></div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{label}</p>
                  <p className={`text-2xl font-bold ${valueColor}`}>{value}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div className="border-b border-border">
        <nav className="-mb-px flex space-x-8 overflow-x-auto">
          {tabs.map(tab => (
            <button key={tab.key} onClick={() => { setActiveTab(tab.key); setSearchTerm(""); }}
              className={`whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === tab.key
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}>
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Filters — hidden for analytics and meter readings */}
      {activeTab !== "analytics" && activeTab !== "readings" && (
        <Card>
          <CardContent className="p-6">
            <div className="flex flex-wrap gap-3 items-center">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input placeholder={`Search ${activeTab}…`} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-10" />
              </div>
              {activeTab === "bills" && (
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="overdue">Overdue</SelectItem>
                    <SelectItem value="disputed">Disputed</SelectItem>
                  </SelectContent>
                </Select>
              )}
              {(activeTab === "bills" || activeTab === "providers") && (
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder="Type" /></SelectTrigger>
                  <SelectContent>
                    {["all","electricity","water","gas","waste","internet","generator"].map(t => (
                      <SelectItem key={t} value={t}>{t === "all" ? "All Types" : t.charAt(0).toUpperCase()+t.slice(1)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {activeTab === "bills" && (
                <>
                  <div className="flex items-center gap-1.5">
                    <Label className="text-xs text-muted-foreground whitespace-nowrap shrink-0">From</Label>
                    <Input type="date" className="w-36 h-9 text-sm" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Label className="text-xs text-muted-foreground whitespace-nowrap shrink-0">To</Label>
                    <Input type="date" className="w-36 h-9 text-sm" value={dateTo} onChange={e => setDateTo(e.target.value)} />
                  </div>
                  {(dateFrom || dateTo) && (
                    <Button variant="ghost" size="sm" className="h-9 px-2 text-xs text-muted-foreground"
                      onClick={() => { setDateFrom(""); setDateTo(""); }}>
                      <X className="w-3.5 h-3.5 mr-1" /> Clear dates
                    </Button>
                  )}
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Content */}
      {activeTab === "analytics" ? (
        <AnalyticsTab bills={bills} providers={providers} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              {tabs.find(t => t.key === activeTab)?.label}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activeTab === "readings" && (
              <div className="mb-4">
                <div className="relative max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
                  <Input placeholder="Search readings…" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-10" />
                </div>
              </div>
            )}
            {activeTab === "bills" && <PagedTable data={filteredBills} columns={billColumns} emptyMessage="No utility bills found" />}
            {activeTab === "providers" && <PagedTable data={filteredProviders} columns={providerColumns} emptyMessage="No utility providers found" />}
            {activeTab === "accounts" && <AccountsTab providers={providers} propertiesList={propertiesList} searchTerm={searchTerm} />}
            {activeTab === "expenses" && <PagedTable data={filteredExpenses} columns={expenseColumns} emptyMessage="No utility expenses found" />}
            {activeTab === "readings" && <ReadingsTab searchTerm={searchTerm} />}
          </CardContent>
        </Card>
      )}

      {/* Dialogs */}
      <EditBillDialog
        bill={editBill === "new" ? null : editBill}
        open={editBill !== null}
        onClose={() => setEditBill(null)}
      />
      <EditProviderDialog
        provider={editProvider === "new" ? null : editProvider}
        open={editProvider !== null}
        onClose={() => setEditProvider(null)}
      />
    </div>
  );
}