import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import {
  Send, Users, MessageSquare, Mail, Smartphone, Bell,
  Calendar, Filter, Eye, Clock, CheckCircle2, AlertCircle,
  Zap, Plus, X, FileText, Search,
} from "lucide-react";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { formatDistanceToNow } from "date-fns";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";
import { useAuth } from "@/hooks/useAuth";

// ── Schema ────────────────────────────────────────────────────────────────────

const broadcastSchema = z.object({
  title: z.string().min(1, "Title is required"),
  content: z.string().min(1, "Message content is required"),
  audienceType: z.string().min(1, "Please select an audience"),
  broadcastMedium: z.array(z.string()).min(1, "Select at least one channel"),
  scheduledFor: z.string().optional(),
});

type BroadcastForm = z.infer<typeof broadcastSchema>;

// ── Constants ─────────────────────────────────────────────────────────────────

const ROLE_OPTIONS = [
  { value: "tenant",    label: "Tenant" },
  { value: "landlord",  label: "Landlord" },
  { value: "manager",   label: "Manager" },
  { value: "staff",     label: "Staff" },
  { value: "caretaker", label: "Caretaker" },
  { value: "guard",     label: "Guard" },
  { value: "admin",     label: "Admin" },
];

const audienceOptions = [
  { value: "all_tenants",          label: "All Tenants",          description: "All active tenants",            icon: Users },
  { value: "all_landlords",        label: "All Landlords",         description: "All property owners",           icon: Users },
  { value: "all_users",            label: "All Users",             description: "Everyone in the system",        icon: Users },
  { value: "specific_properties",  label: "Specific Properties",   description: "Choose specific properties",    icon: Filter },
  { value: "specific_roles",       label: "Specific Roles",        description: "Target by user role",           icon: Filter },
  { value: "custom_filter",        label: "Custom Filter",         description: "Advanced filtering options",    icon: Filter },
];

const communicationChannels = [
  { value: "app_notification", label: "In-App Notification", description: "Instant push via WebSocket — works for any logged-in user", icon: Bell,        color: "bg-blue-500",   available: true },
  { value: "email",            label: "Email",               description: "Sent via Resend — requires RESEND_API_KEY env var",          icon: Mail,        color: "bg-green-500",  available: !!true  },
  { value: "sms",              label: "SMS",                 description: "Sent via Twilio — requires TWILIO_* env vars",               icon: Smartphone,  color: "bg-purple-500", available: !!true  },
  { value: "whatsapp",         label: "WhatsApp",            description: "Sent via WhatsApp Business API — requires WHATSAPP_API_KEY + WHATSAPP_PHONE_NUMBER_ID env vars", icon: MessageSquare, color: "bg-green-600", available: true },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusColor(status: string) {
  switch (status) {
    case "sent":      return "bg-emerald-50 text-emerald-700 border border-emerald-200";
    case "sending":   return "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/50 dark:text-yellow-400";
    case "scheduled": return "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-400";
    case "failed":    return "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-400";
    default:          return "bg-muted text-muted-foreground";
  }
}

function StatusIcon({ status }: { status: string }) {
  const cls = "h-3 w-3 mr-1";
  switch (status) {
    case "sent":      return <CheckCircle2 className={cls} />;
    case "sending":   return <Zap className={`${cls} animate-pulse`} />;
    case "scheduled": return <Clock className={cls} />;
    case "failed":    return <AlertCircle className={cls} />;
    default:          return <Clock className={cls} />;
  }
}

// ── Templates panel ───────────────────────────────────────────────────────────

function TemplatesDialog({ open, onClose, onApply }: {
  open: boolean;
  onClose: () => void;
  onApply: (title: string, content: string) => void;
}) {
  const { data: templates = [] } = useQuery({
    queryKey: ["/api/broadcast-messages/templates"],
    queryFn: async () => {
      const r = await apiRequest("/api/broadcast-messages/templates");
      return ensureArray(await r.json());
    },
    enabled: open,
    retry: false,
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[70vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-4 h-4" />Communication Templates
          </DialogTitle>
        </DialogHeader>
        {templates.length === 0 ? (
          <div className="py-12 text-center">
            <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No templates yet.</p>
            <p className="text-xs text-muted-foreground mt-1">Create one via POST /api/broadcast-messages/templates.</p>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            {(templates as any[]).map((t: any) => (
              <div key={t.id} className="border border-border dark:border-gray-700 rounded-xl p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{t.name}</p>
                    <Badge variant="outline" className="text-[10px] mt-1 capitalize">{t.category.replace(/_/g, " ")}</Badge>
                  </div>
                  <Button size="sm" variant="outline" className="h-7 text-xs"
                    onClick={() => { onApply(t.subject || t.name, t.content); onClose(); }}>
                    Use
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{t.content}</p>
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const PAGE_SIZE_OPTIONS = [5, 10, 20, 50];

export default function BroadcastMessaging() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<number[]>([]);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const form = useForm<BroadcastForm>({
    resolver: zodResolver(broadcastSchema),
    defaultValues: { title: "", content: "", audienceType: "", broadcastMedium: [], scheduledFor: "" },
  });

  // ── Fetch broadcast history ─────────────────────────────────────────────────
  const { data: broadcasts = [], isLoading } = useQuery({
    queryKey: ["/api/broadcast-messages"],
    queryFn: async () => {
      const r = await apiRequest("/api/broadcast-messages");
      return ensureArray(await r.json());
    },
    retry: false,
  });

  // ── Fetch properties for specific_properties filter ─────────────────────────
  const audienceType = form.watch("audienceType");
  const { data: properties = [] } = useQuery({
    queryKey: ["/api/properties"],
    queryFn: async () => {
      const r = await apiRequest("/api/properties");
      return ensureArray(await r.json());
    },
    enabled: audienceType === "specific_properties",
    retry: false,
  });

  // ── Create broadcast ────────────────────────────────────────────────────────
  const createBroadcastMutation = useMutation({
    mutationFn: async (data: BroadcastForm) => {
      const payload = {
        ...data,
        scheduledFor: data.scheduledFor ? new Date(data.scheduledFor).toISOString() : null,
      };
      const r = await apiRequest("/api/broadcast-messages", { method: "POST", data: payload });
      return r.json();
    },
    onSuccess: (result: any) => {
      const isScheduled = result.status === "scheduled";
      const skipped = result.skippedCount ?? 0;
      toast({
        title: isScheduled ? "Broadcast scheduled" : "Broadcast sent",
        description: isScheduled
          ? `Will be delivered to ${result.totalRecipients} recipients on ${new Date(result.scheduledFor).toLocaleString()}.`
          : [
              `Delivered to ${result.sentCount} of ${result.totalRecipients} recipients.`,
              result.failedCount > 0 ? ` ${result.failedCount} failed.` : "",
              skipped > 0 ? ` ${skipped} skipped — missing contact info for selected channel(s).` : "",
            ].join("").trim(),
      });
      form.reset();
      setSelectedChannels([]);
      setSelectedRoles([]);
      setSelectedPropertyIds([]);
      queryClient.invalidateQueries({ queryKey: ["/api/broadcast-messages"] });
    },
    onError: (error: any) => toast({
      title: "Failed to send broadcast",
      description: error.message || "Please try again.",
      variant: "destructive",
    }),
  });

  const handleChannelToggle = (channel: string, checked: boolean) => {
    const next = checked
      ? [...selectedChannels, channel]
      : selectedChannels.filter(c => c !== channel);
    setSelectedChannels(next);
    form.setValue("broadcastMedium", next, { shouldValidate: true });
  };

  const onSubmit = (data: BroadcastForm) => {
    let audienceFilter: Record<string, any> | undefined;
    if (data.audienceType === "specific_properties") {
      audienceFilter = { propertyIds: selectedPropertyIds };
    } else if (data.audienceType === "specific_roles" || data.audienceType === "custom_filter") {
      audienceFilter = { roles: selectedRoles };
    }
    createBroadcastMutation.mutate({ ...data, audienceFilter } as any);
  };

  // Stats
  const totalSent       = (broadcasts as any[]).reduce((s: number, b: any) => s + (b.sentCount || 0), 0);
  const totalRecipients = (broadcasts as any[]).reduce((s: number, b: any) => s + (b.totalRecipients || 0), 0);
  const totalOpened     = (broadcasts as any[]).reduce((s: number, b: any) => s + (b.openedCount || 0), 0);
  const openRate        = totalSent > 0 ? Math.round((totalOpened / totalSent) * 100) : 0;

  // Date + search filtering
  const filteredBroadcasts = (broadcasts as any[]).filter((b: any) => {
    const created = new Date(b.createdAt);
    if (dateFrom && created < new Date(dateFrom)) return false;
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      if (created > to) return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchesTitle   = b.title?.toLowerCase().includes(q);
      const matchesContent = b.content?.toLowerCase().includes(q);
      const matchesStatus  = b.status?.toLowerCase().includes(q);
      const matchesMedium  = (b.broadcastMedium as string[] | undefined)?.some(m => m.toLowerCase().includes(q));
      if (!matchesTitle && !matchesContent && !matchesStatus && !matchesMedium) return false;
    }
    return true;
  });

  const hasDateFilter = dateFrom || dateTo;
  const hasAnyFilter  = hasDateFilter || searchQuery.trim();

  const clearDateFilter = () => {
    setDateFrom("");
    setDateTo("");
    setCurrentPage(1);
  };

  const clearAllFilters = () => {
    setDateFrom("");
    setDateTo("");
    setSearchQuery("");
    setCurrentPage(1);
  };

  // Pagination
  const totalBroadcasts = filteredBroadcasts.length;
  const totalPages = Math.max(1, Math.ceil(totalBroadcasts / pageSize));
  const paginatedBroadcasts = filteredBroadcasts.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  const handlePageSizeChange = (val: string) => {
    setPageSize(Number(val));
    setCurrentPage(1);
  };

  // Shared history card — rendered for both admins and managers
  const broadcastHistoryCard = (
    <Card className="rounded-xl border border-slate-100 shadow-sm">
      <CardHeader className="pb-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center text-base font-semibold">
            <MessageSquare className="h-4 w-4 mr-2" />Recent Broadcasts
          </CardTitle>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Rows per page</span>
            <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
              <SelectTrigger className="h-7 w-[64px] text-xs">
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

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
            placeholder="Search by title, content, status, channel…"
            className="h-8 pl-8 pr-8 text-xs"
          />
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(""); setCurrentPage(1); }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Date range filter */}
        <div className="flex items-center gap-2 flex-wrap">
          <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <Input
              type="date"
              value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); setCurrentPage(1); }}
              className="h-7 text-xs w-full"
              placeholder="From"
            />
            <span className="text-xs text-muted-foreground shrink-0">to</span>
            <Input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={e => { setDateTo(e.target.value); setCurrentPage(1); }}
              className="h-7 text-xs w-full"
              placeholder="To"
            />
          </div>
          {hasDateFilter && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground shrink-0"
              onClick={clearDateFilter}
            >
              <X className="h-3 w-3 mr-1" />Clear
            </Button>
          )}
        </div>
        {hasAnyFilter && (
          <p className="text-xs text-muted-foreground">
            {totalBroadcasts} result{totalBroadcasts !== 1 ? "s" : ""}
            <button onClick={clearAllFilters} className="ml-2 underline hover:text-foreground">
              Clear all filters
            </button>
          </p>
        )}
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {isLoading ? (
            [...Array(3)].map((_, i) => (
              <div key={i} className="h-24 bg-muted dark:bg-gray-800 rounded-xl animate-pulse" />
            ))
          ) : (broadcasts as any[]).length === 0 ? (
            <div className="text-center py-16">
              <MessageSquare className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No broadcast messages yet</p>
              <p className="text-xs text-muted-foreground mt-1">Send your first broadcast to get started</p>
            </div>
          ) : filteredBroadcasts.length === 0 ? (
            <div className="text-center py-16">
              <Search className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No broadcasts match your filters</p>
              <Button variant="link" className="text-xs mt-1 h-auto p-0" onClick={clearAllFilters}>
                Clear all filters
              </Button>
            </div>
          ) : paginatedBroadcasts.map((broadcast: any) => (
            <div key={broadcast.id} className="border border-border dark:border-gray-700 rounded-xl p-4 hover:shadow-sm transition-shadow">
              <div className="flex justify-between items-start mb-2 gap-2">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-slate-900 truncate">{broadcast.title}</h3>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{broadcast.content}</p>
                </div>
                <Badge className={`${statusColor(broadcast.status)} flex items-center flex-shrink-0 text-xs`}>
                  <StatusIcon status={broadcast.status} />
                  {broadcast.status}
                </Badge>
              </div>

              <div className="flex items-center justify-between text-xs text-muted-foreground mt-2">
                <div className="flex gap-3">
                  <span className="flex items-center gap-1">
                    <Users className="h-3 w-3" />{broadcast.totalRecipients ?? 0} recipients
                  </span>
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-green-500" />{broadcast.sentCount ?? 0} sent
                  </span>
                  {(broadcast.skippedCount ?? 0) > 0 && (
                    <span className="flex items-center gap-1 text-amber-500">
                      <AlertCircle className="h-3 w-3" />{broadcast.skippedCount} skipped
                    </span>
                  )}
                  {(broadcast.failedCount ?? 0) > 0 && (
                    <span className="flex items-center gap-1 text-red-500">
                      <AlertCircle className="h-3 w-3" />{broadcast.failedCount} failed
                    </span>
                  )}
                </div>
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {formatDistanceToNow(new Date(broadcast.createdAt), { addSuffix: true })}
                </span>
              </div>

              {/* Channel pills */}
              {broadcast.broadcastMedium?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {(broadcast.broadcastMedium as string[]).map((medium: string) => {
                    const ch = communicationChannels.find(c => c.value === medium);
                    if (!ch) return null;
                    const Icon = ch.icon;
                    return (
                      <span key={medium} className="flex items-center gap-1 text-[10px] bg-muted dark:bg-gray-800 rounded-md px-2 py-1">
                        <Icon className="h-2.5 w-2.5" />{ch.label}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Pagination controls */}
        {!isLoading && totalBroadcasts > 0 && (
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-border dark:border-gray-700">
            <p className="text-xs text-muted-foreground">
              {Math.min((currentPage - 1) * pageSize + 1, totalBroadcasts)}–{Math.min(currentPage * pageSize, totalBroadcasts)} of {totalBroadcasts}
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
              <span className="text-xs text-muted-foreground px-1">
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
      </CardContent>
    </Card>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card dark:bg-gray-900 border-b border-border dark:border-gray-800 px-6 py-5">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Broadcast Messaging</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Send messages to multiple recipients across different channels
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setTemplatesOpen(true)}>
            <Eye className="h-4 w-4 mr-2" />Templates
          </Button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Broadcasts",  value: (broadcasts as any[]).length, icon: Send,         color: "text-blue-500" },
            { label: "Messages Sent",     value: totalSent,                    icon: CheckCircle2, color: "text-green-500" },
            { label: "Total Recipients",  value: totalRecipients,              icon: Users,        color: "text-purple-500" },
            { label: "Open Rate",         value: `${openRate}%`,              icon: Eye,          color: "text-orange-500" },
          ].map(stat => {
            const Icon = stat.icon;
            return (
              <Card key={stat.label} className="rounded-xl border border-slate-100 shadow-sm">
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                    <p className="text-2xl font-semibold text-slate-900 mt-0.5">{stat.value}</p>
                  </div>
                  <Icon className={`h-8 w-8 ${stat.color}`} />
                </CardContent>
              </Card>
            );
          })}
        </div>

        {isAdmin ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* ── Compose form ──────────────────────────────────────────────── */}
          <Card className="rounded-xl border border-slate-100 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center text-base font-semibold">
                <Send className="h-4 w-4 mr-2" />Create Broadcast Message
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

                  <FormField control={form.control} name="title" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Message Title</FormLabel>
                      <FormControl><Input placeholder="e.g. Water Outage Notice" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="content" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Message Content</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Write your message here…" rows={4} className="resize-none" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="audienceType" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Target Audience</FormLabel>
                      <Select onValueChange={v => { field.onChange(v); setSelectedRoles([]); setSelectedPropertyIds([]); }} value={field.value}>
                        <FormControl>
                          <SelectTrigger><SelectValue placeholder="Choose target audience" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {audienceOptions.map(o => (
                            <SelectItem key={o.value} value={o.value}>
                              <div className="flex flex-col">
                                <span>{o.label}</span>
                                <span className="text-xs text-muted-foreground">{o.description}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />

                  {/* ── Specific Properties picker ──────────────────────── */}
                  {audienceType === "specific_properties" && (
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">
                        Select Properties <span className="text-red-500">*</span>
                      </Label>
                      {(properties as any[]).length === 0 ? (
                        <p className="text-xs text-muted-foreground py-2">Loading properties…</p>
                      ) : (
                        <div className="border border-border rounded-xl divide-y divide-border max-h-48 overflow-y-auto">
                          {(properties as any[]).map((p: any) => {
                            const checked = selectedPropertyIds.includes(p.id);
                            return (
                              <label key={p.id} className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${checked ? "bg-emerald-50 dark:bg-emerald-950/20" : "hover:bg-muted/50"}`}>
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={v => {
                                    setSelectedPropertyIds(prev =>
                                      v ? [...prev, p.id] : prev.filter(id => id !== p.id)
                                    );
                                  }}
                                />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium leading-tight truncate">{p.name}</p>
                                  {p.address && <p className="text-xs text-muted-foreground truncate">{p.address}</p>}
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      )}
                      {selectedPropertyIds.length === 0 && (
                        <p className="text-xs text-amber-600 flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" />Select at least one property
                        </p>
                      )}
                      {selectedPropertyIds.length > 0 && (
                        <p className="text-xs text-emerald-600">{selectedPropertyIds.length} propert{selectedPropertyIds.length === 1 ? "y" : "ies"} selected</p>
                      )}
                    </div>
                  )}

                  {/* ── Specific Roles / Custom Filter picker ───────────── */}
                  {(audienceType === "specific_roles" || audienceType === "custom_filter") && (
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">
                        Select Roles <span className="text-red-500">*</span>
                      </Label>
                      <div className="border border-border rounded-xl divide-y divide-border">
                        {ROLE_OPTIONS.map(role => {
                          const checked = selectedRoles.includes(role.value);
                          return (
                            <label key={role.value} className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${checked ? "bg-emerald-50 dark:bg-emerald-950/20" : "hover:bg-muted/50"}`}>
                              <Checkbox
                                checked={checked}
                                onCheckedChange={v => {
                                  setSelectedRoles(prev =>
                                    v ? [...prev, role.value] : prev.filter(r => r !== role.value)
                                  );
                                }}
                              />
                              <span className="text-sm capitalize">{role.label}</span>
                            </label>
                          );
                        })}
                      </div>
                      {selectedRoles.length === 0 && (
                        <p className="text-xs text-amber-600 flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" />Select at least one role
                        </p>
                      )}
                      {selectedRoles.length > 0 && (
                        <p className="text-xs text-emerald-600">{selectedRoles.length} role{selectedRoles.length === 1 ? "" : "s"} selected</p>
                      )}
                    </div>
                  )}

                  {/* Channel selection */}
                  <div className="space-y-2">
                    <Label>Communication Channels</Label>
                    <div className="grid grid-cols-1 gap-2">
                      {communicationChannels.map(ch => {
                        const Icon = ch.icon;
                        const isChecked = selectedChannels.includes(ch.value);
                        const isDisabled = !ch.available;
                        return (
                          <label key={ch.value}
                            className={`flex items-center gap-3 p-3 border rounded-xl transition-colors
                              ${isDisabled
                                ? "border-border dark:border-gray-700 opacity-50 cursor-not-allowed"
                                : isChecked
                                  ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-700 cursor-pointer"
                                  : "border-border dark:border-gray-700 hover:bg-muted/50 cursor-pointer"
                              }`}>
                            <Checkbox
                              id={ch.value}
                              checked={isChecked}
                              disabled={isDisabled}
                              onCheckedChange={v => !isDisabled && handleChannelToggle(ch.value, v as boolean)}
                            />
                            <div className={`w-8 h-8 ${ch.color} rounded-lg flex items-center justify-center flex-shrink-0`}>
                              <Icon className="h-4 w-4 text-white" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium text-slate-900">{ch.label}</p>
                                {isDisabled && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">Coming soon</span>}
                              </div>
                              <p className="text-xs text-muted-foreground leading-tight">{ch.description}</p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                    {form.formState.errors.broadcastMedium && (
                      <p className="text-xs text-red-500">{form.formState.errors.broadcastMedium.message}</p>
                    )}
                  </div>

                  <FormField control={form.control} name="scheduledFor" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Schedule for Later <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                      <FormControl>
                        <Input type="datetime-local" {...field} min={new Date().toISOString().slice(0, 16)} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                    disabled={
                      createBroadcastMutation.isPending ||
                      (audienceType === "specific_properties" && selectedPropertyIds.length === 0) ||
                      ((audienceType === "specific_roles" || audienceType === "custom_filter") && selectedRoles.length === 0)
                    }>
                    {createBroadcastMutation.isPending
                      ? <><Zap className="h-4 w-4 mr-2 animate-spin" />Sending…</>
                      : <><Send className="h-4 w-4 mr-2" />Send Broadcast</>
                    }
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>

          {/* ── Broadcast history (admin) ──────────────────────────────────── */}
          {broadcastHistoryCard}

        </div>
        ) : (
          /* ── Manager: read-only history, full-width ───────────────────── */
          <div className="max-w-3xl">
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>Only admins can create and send broadcast messages. You can view the history of messages sent to your tenants below.</span>
            </div>
            {broadcastHistoryCard}
          </div>
        )}
      </div>

      {/* Templates dialog */}
      <TemplatesDialog
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        onApply={(title, content) => {
          form.setValue("title", title);
          form.setValue("content", content);
        }}
      />
    </div>
  );
}