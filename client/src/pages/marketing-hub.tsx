import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";
import {
  Send, Eye, Users, TrendingUp, Mail, FileText, Megaphone,
  Target, Plus, MessageCircle, Bell, Phone, Calendar, Clock,
  CheckCircle2, AlertCircle, Loader2, BarChart3, RefreshCw,
  Search, Filter,
} from "lucide-react";

// ── Types matching actual DB schema ──────────────────────────────────────────

interface Broadcast {
  id: number;
  title: string;
  content: string;
  audienceType: "all_tenants" | "all_landlords" | "all_users" | "specific_properties" | "specific_roles" | "custom_filter";
  broadcastMedium: Array<"app_notification" | "email" | "sms" | "whatsapp">;
  status: "draft" | "sending" | "sent" | "scheduled" | "failed";
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  openedCount: number;
  scheduledFor: string | null;
  createdAt: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const AUDIENCE_OPTIONS = [
  { value: "all_tenants",         label: "All Tenants" },
  { value: "all_landlords",       label: "All Landlords / Property Owners" },
  { value: "all_users",           label: "All Users" },
  { value: "specific_properties", label: "Specific Properties" },
  { value: "specific_roles",      label: "Specific Roles" },
  { value: "custom_filter",       label: "Custom Filter" },
];

const MEDIUM_OPTIONS = [
  { value: "app_notification", label: "App Notification", icon: Bell },
  { value: "email",            label: "Email",            icon: Mail },
  { value: "sms",              label: "SMS",              icon: Phone },
  { value: "whatsapp",         label: "WhatsApp",         icon: MessageCircle },
];

const STATUS_COLORS: Record<string, string> = {
  sent:      "bg-emerald-50 text-emerald-700 border border-emerald-200",
  sending:   "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  scheduled: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  draft:     "bg-muted text-muted-foreground",
  failed:    "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  sent:      <CheckCircle2 className="h-3 w-3" />,
  sending:   <Loader2 className="h-3 w-3 animate-spin" />,
  scheduled: <Clock className="h-3 w-3" />,
  draft:     <FileText className="h-3 w-3" />,
  failed:    <AlertCircle className="h-3 w-3" />,
};

const MEDIUM_COLORS: Record<string, string> = {
  app_notification: "bg-purple-100 text-purple-800",
  email:            "bg-orange-100 text-orange-800",
  sms:              "bg-red-100 text-red-800",
  whatsapp:         "bg-emerald-50 text-emerald-700 border border-emerald-200",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const ensureArray = <T,>(data: unknown): T[] => {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && "results" in data && Array.isArray((data as any).results))
    return (data as any).results as T[];
  return [];
};

const safeDate = (d: string | null | undefined) => {
  if (!d) return "—";
  try {
    const dt = new Date(d);
    return isNaN(dt.getTime()) ? "—" : format(dt, "MMM dd, yyyy");
  } catch {
    return "—";
  }
};

const pct = (num: number, den: number) =>
  den > 0 ? `${Math.round((num / den) * 100)}%` : "—";

const EMPTY_FORM = {
  title: "",
  content: "",
  audienceType: "all_tenants" as const,
  broadcastMedium: ["app_notification"] as string[],
  scheduledFor: "",
};

// ── CampaignForm (top-level to prevent focus loss on re-render) ───────────────

interface CampaignFormProps {
  form: typeof EMPTY_FORM;
  setForm: React.Dispatch<React.SetStateAction<typeof EMPTY_FORM>>;
  toggleMedium: (val: string) => void;
}

function CampaignForm({ form, setForm, toggleMedium }: CampaignFormProps) {
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="camp-title">Subject / Title <span className="text-red-500">*</span></Label>
        <Input
          id="camp-title"
          placeholder="e.g. Rent Reminder — June 2025"
          value={form.title}
          onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
          className="mt-1"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label>Audience <span className="text-red-500">*</span></Label>
          <Select
            value={form.audienceType}
            onValueChange={val => setForm(f => ({ ...f, audienceType: val as any }))}
          >
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AUDIENCE_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="camp-schedule">Schedule (optional)</Label>
          <Input
            id="camp-schedule"
            type="datetime-local"
            value={form.scheduledFor}
            onChange={e => setForm(f => ({ ...f, scheduledFor: e.target.value }))}
            className="mt-1"
          />
        </div>
      </div>

      <div>
        <Label>Broadcast Channels <span className="text-red-500">*</span></Label>
        <div className="grid grid-cols-2 gap-2 mt-2">
          {MEDIUM_OPTIONS.map(opt => {
            const Icon = opt.icon;
            const checked = form.broadcastMedium.includes(opt.value);
            return (
              <label
                key={opt.value}
                className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors
                  ${checked ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30" : "border-border hover:bg-muted"}`}
              >
                <Checkbox checked={checked} onCheckedChange={() => toggleMedium(opt.value)} className="shrink-0" />
                <Icon className={`h-4 w-4 ${checked ? "text-blue-600" : "text-muted-foreground"}`} />
                <span className="text-sm font-medium">{opt.label}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div>
        <Label htmlFor="camp-content">Message Content <span className="text-red-500">*</span></Label>
        <Textarea
          id="camp-content"
          placeholder="Write your message here..."
          rows={6}
          value={form.content}
          onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
          className="mt-1"
        />
        <p className="text-xs text-muted-foreground mt-1">{form.content.length} characters</p>
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MarketingHub() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [activeTab, setActiveTab]       = useState("campaigns");
  const [searchQ, setSearchQ]           = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [form, setForm]                 = useState(EMPTY_FORM);
  const [pageSize, setPageSize]         = useState(10);
  const [currentPage, setCurrentPage]   = useState(1);

  const PAGE_SIZE_OPTIONS = [5, 10, 20, 50];

  // ── Data ──────────────────────────────────────────────────────────────────

  const { data: broadcastsRaw, isLoading } = useQuery({
    queryKey: ["/api/broadcast-messages"],
    queryFn: async () => {
      const r = await apiRequest("/api/broadcast-messages");
      return ensureArray<Broadcast>(await r.json());
    },
  });

  const broadcasts: Broadcast[] = broadcastsRaw ?? [];

  // ── Derived KPIs ──────────────────────────────────────────────────────────

  const totalSent       = broadcasts.reduce((s, b) => s + (b.sentCount || 0), 0);
  const totalRecipients = broadcasts.reduce((s, b) => s + (b.totalRecipients || 0), 0);
  const totalOpened     = broadcasts.reduce((s, b) => s + (b.openedCount || 0), 0);
  const openRate        = totalSent > 0 ? Math.round((totalOpened / totalSent) * 100) : 0;
  const totalFailed     = broadcasts.reduce((s, b) => s + (b.failedCount || 0), 0);
  const deliveryRate    = totalSent + totalFailed > 0
    ? Math.round((totalSent / (totalSent + totalFailed)) * 100)
    : 0;

  const channelCounts = broadcasts.reduce<Record<string, number>>((acc, b) => {
    (b.broadcastMedium || []).forEach(m => { acc[m] = (acc[m] || 0) + 1; });
    return acc;
  }, {});

  // ── Filtered list ──────────────────────────────────────────────────────────

  const filtered = broadcasts.filter(b => {
    if (statusFilter !== "all" && b.status !== statusFilter) return false;
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase();
      if (!b.title?.toLowerCase().includes(q) &&
          !b.content?.toLowerCase().includes(q) &&
          !b.audienceType?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated  = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const handlePageSizeChange = (val: string) => {
    setPageSize(Number(val));
    setCurrentPage(1);
  };

  // ── Mutation ──────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: async (payload: typeof EMPTY_FORM) => {
      const r = await apiRequest("/api/broadcast-messages", {
        method: "POST",
        data: {
          title:           payload.title,
          content:         payload.content,
          audienceType:    payload.audienceType,
          broadcastMedium: payload.broadcastMedium,
          scheduledFor:    payload.scheduledFor || null,
        },
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.message || "Failed to create campaign");
      }
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Campaign Created", description: "Your campaign has been created and is being dispatched." });
      queryClient.invalidateQueries({ queryKey: ["/api/broadcast-messages"] });
      setIsCreateOpen(false);
      setForm(EMPTY_FORM);
      setActiveTab("campaigns");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to Create", description: err.message, variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!form.title.trim()) {
      toast({ title: "Missing Title", description: "Please enter a title.", variant: "destructive" });
      return;
    }
    if (!form.content.trim()) {
      toast({ title: "Missing Content", description: "Please enter message content.", variant: "destructive" });
      return;
    }
    if (form.broadcastMedium.length === 0) {
      toast({ title: "No Channel Selected", description: "Select at least one broadcast channel.", variant: "destructive" });
      return;
    }
    createMutation.mutate(form);
  };

  const toggleMedium = (val: string) => {
    setForm(f => ({
      ...f,
      broadcastMedium: f.broadcastMedium.includes(val)
        ? f.broadcastMedium.filter(m => m !== val)
        : [...f.broadcastMedium, val],
    }));
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Marketing Hub</h1>
          <p className="text-muted-foreground mt-1">
            Create and manage client communications, offers, and campaigns
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/broadcast-messages"] })}
          >
            <RefreshCw className="h-4 w-4 mr-1" />Refresh
          </Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setIsCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />New Campaign
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: "Total Campaigns",
            value: broadcasts.length,
            icon: Megaphone,
            color: "text-blue-500",
            sub: `${broadcasts.filter(b => b.status === "scheduled").length} scheduled`,
          },
          {
            label: "Messages Sent",
            value: totalSent.toLocaleString(),
            icon: Send,
            color: "text-green-500",
            sub: `${totalRecipients.toLocaleString()} total recipients`,
          },
          {
            label: "Open Rate",
            value: `${openRate}%`,
            icon: Eye,
            color: openRate >= 20 ? "text-green-500" : "text-orange-500",
            sub: openRate >= 20 ? "Above benchmark" : "Below 20% benchmark",
          },
          {
            label: "Delivery Rate",
            value: `${deliveryRate}%`,
            icon: Target,
            color: deliveryRate >= 90 ? "text-green-500" : "text-red-500",
            sub: `${totalFailed} failed deliveries`,
          },
        ].map(stat => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label} className="rounded-2xl border-border shadow-none">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                    <p className="text-2xl font-semibold text-foreground mt-0.5">{isLoading ? "—" : stat.value}</p>
                    <p className="text-xs text-muted-foreground mt-1">{stat.sub}</p>
                  </div>
                  <Icon className={`h-7 w-7 ${stat.color} shrink-0`} />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Channel breakdown */}
      {broadcasts.length > 0 && (
        <Card className="rounded-2xl border-border shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />Channel Usage
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {MEDIUM_OPTIONS.map(opt => {
                const Icon = opt.icon;
                const count = channelCounts[opt.value] || 0;
                const pctVal = broadcasts.length > 0 ? Math.round((count / broadcasts.length) * 100) : 0;
                return (
                  <div key={opt.value} className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">{opt.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Progress value={pctVal} className="h-1.5 flex-1" />
                      <span className="text-xs font-medium w-7 text-right">{count}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 max-w-sm">
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="create">New Campaign</TabsTrigger>
        </TabsList>

        {/* Campaigns table */}
        <TabsContent value="campaigns" className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search campaigns…"
                value={searchQ}
                onChange={e => { setSearchQ(e.target.value); setCurrentPage(1); }}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setCurrentPage(1); }}>
              <SelectTrigger className="w-[160px]">
                <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="scheduled">Scheduled</SelectItem>
                <SelectItem value="sending">Sending</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-muted-foreground whitespace-nowrap">Rows</span>
              <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
                <SelectTrigger className="h-9 w-[70px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map(n => (
                    <SelectItem key={n} value={String(n)} className="text-xs">{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Card className="rounded-2xl border-border shadow-none">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campaign</TableHead>
                    <TableHead>Audience</TableHead>
                    <TableHead>Channels</TableHead>
                    <TableHead className="text-right">Recipients</TableHead>
                    <TableHead className="text-right">Sent</TableHead>
                    <TableHead className="text-right">Open Rate</TableHead>
                    <TableHead className="text-right">Failed</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    [...Array(4)].map((_, i) => (
                      <TableRow key={i}>
                        {[...Array(8)].map((_, j) => (
                          <TableCell key={j}><div className="h-4 bg-muted rounded animate-pulse" /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                        <Megaphone className="h-10 w-10 mx-auto mb-2 opacity-20" />
                        {broadcasts.length === 0
                          ? "No campaigns yet. Create your first campaign to get started!"
                          : "No campaigns match your filters."}
                      </TableCell>
                    </TableRow>
                  ) : paginated.map(b => (
                    <TableRow key={b.id} className="hover:bg-muted/50">
                      <TableCell>
                        <div className="font-medium max-w-[200px] truncate" title={b.title}>{b.title}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          {b.scheduledFor
                            ? <><Calendar className="h-3 w-3" />Scheduled {safeDate(b.scheduledFor)}</>
                            : <><Clock className="h-3 w-3" />{safeDate(b.createdAt)}</>}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {AUDIENCE_OPTIONS.find(a => a.value === b.audienceType)?.label ?? b.audienceType}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {(b.broadcastMedium || []).map(m => (
                            <Badge key={m} className={`text-xs px-1.5 py-0 ${MEDIUM_COLORS[m] || "bg-muted"}`}>
                              {MEDIUM_OPTIONS.find(o => o.value === m)?.label ?? m}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">{b.totalRecipients.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {b.sentCount > 0 ? b.sentCount.toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {b.openedCount > 0
                          ? <span className="text-green-600 font-medium">{pct(b.openedCount, b.sentCount)}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {b.failedCount > 0
                          ? <span className="text-red-500 font-medium">{b.failedCount}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <Badge className={`flex items-center gap-1 w-fit text-xs ${STATUS_COLORS[b.status] || STATUS_COLORS.draft}`}>
                          {STATUS_ICONS[b.status]}
                          {b.status.charAt(0).toUpperCase() + b.status.slice(1)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {filtered.length > 0 && (
            <div className="flex items-center justify-between mt-1">
              <p className="text-xs text-muted-foreground">
                {Math.min((currentPage - 1) * pageSize + 1, filtered.length)}–{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length} campaign{filtered.length !== 1 ? "s" : ""}
                {filtered.length !== broadcasts.length && ` (filtered from ${broadcasts.length})`}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  ‹ Prev
                </Button>
                <span className="text-xs text-muted-foreground px-2">
                  {currentPage} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                >
                  Next ›
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* New campaign tab */}
        <TabsContent value="create">
          <Card className="rounded-2xl border-border shadow-none max-w-2xl">
            <CardHeader>
              <CardTitle>New Campaign</CardTitle>
              <CardDescription>
                Send a message to your tenants, landlords, or all users across one or more channels.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <CampaignForm form={form} setForm={setForm} toggleMedium={toggleMedium} />
              <div className="flex justify-end pt-2">
                <Button
                  onClick={handleSubmit}
                  disabled={createMutation.isPending}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {createMutation.isPending
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sending…</>
                    : <><Send className="h-4 w-4 mr-2" />{form.scheduledFor ? "Schedule Campaign" : "Send Campaign"}</>}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>New Marketing Campaign</DialogTitle>
            <DialogDescription>Broadcast a message to your audience across selected channels.</DialogDescription>
          </DialogHeader>
          <CampaignForm form={form} setForm={setForm} toggleMedium={toggleMedium} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)} disabled={createMutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {createMutation.isPending
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sending…</>
                : <><Send className="h-4 w-4 mr-2" />{form.scheduledFor ? "Schedule" : "Send Now"}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}