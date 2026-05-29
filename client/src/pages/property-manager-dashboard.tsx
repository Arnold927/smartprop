/**
 * Property Manager Portal — /property-manager-dashboard
 *
 * Rebuilt from scratch. Gives PMs real write actions:
 *  ✅ Assign maintenance requests to technicians
 *  ✅ Approve / reject maintenance requests
 *  ✅ Message tenants and org users directly
 *  ✅ Real-time WebSocket updates + in-page notification drawer
 *  ✅ Full dark / gray / light theme support via CSS variables
 *  ✅ Mobile responsive (sm: breakpoints throughout)
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useWsEvent } from "@/hooks/useWebSocket";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow, isToday } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";
import {
  Building, Users, Wrench, AlertTriangle, CheckCircle2, Clock, MapPin,
  Activity, Bell, BellOff, MessageSquare, Send, Loader2, RefreshCw,
  Search, ChevronDown, ChevronUp, Check, X, Play, User,
  DollarSign, Trash2, CheckCheck, Phone, Mail, ArrowUpRight, Inbox, Star,
} from "lucide-react";

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmtDate = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  try { return format(new Date(d), "dd MMM yyyy"); } catch { return "—"; }
};
const timeAgo = (d: string | null | undefined) => {
  if (!d) return "—";
  try { return formatDistanceToNow(new Date(d), { addSuffix: true }); } catch { return "—"; }
};
const fmtKES = (n: any) => `KES ${Math.round(Number(n ?? 0)).toLocaleString("en-KE")}`;

// ─── Status / Priority configs ────────────────────────────────────────────────
const MAINT_STATUS: Record<string, { label: string; color: string; bg: string; border: string; icon: any }> = {
  pending:     { label: "Pending",     color: "text-blue-600 dark:text-blue-400",   bg: "bg-blue-50 dark:bg-blue-950/30",   border: "border-blue-200 dark:border-blue-800",   icon: Clock },
  assigned:    { label: "Assigned",    color: "text-purple-600 dark:text-purple-400", bg: "bg-purple-50 dark:bg-purple-950/30", border: "border-purple-200 dark:border-purple-800", icon: User },
  in_progress: { label: "In Progress", color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/30",  border: "border-amber-200 dark:border-amber-800",  icon: Play },
  completed:   { label: "Completed",   color: "text-green-600 dark:text-green-400", bg: "bg-green-50 dark:bg-green-950/30",  border: "border-green-200 dark:border-green-800",  icon: CheckCircle2 },
  cancelled:   { label: "Cancelled",   color: "text-muted-foreground",              bg: "bg-muted",                           border: "border-border",                           icon: X },
};
const PRIORITY: Record<string, { label: string; dot: string; text: string }> = {
  low:      { label: "Low",      dot: "bg-slate-400",  text: "text-muted-foreground" },
  medium:   { label: "Medium",   dot: "bg-yellow-400", text: "text-yellow-600 dark:text-yellow-400" },
  high:     { label: "High",     dot: "bg-orange-500", text: "text-orange-600 dark:text-orange-400" },
  urgent:   { label: "Urgent",   dot: "bg-red-500",    text: "text-red-600 dark:text-red-400" },
  critical: { label: "Critical", dot: "bg-red-700",    text: "text-red-700 dark:text-red-400" },
};

// ─── Maintenance Panel ────────────────────────────────────────────────────────
function MaintenancePanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("active");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: rawReqs, isLoading, refetch } = useQuery({
    queryKey: ["/api/maintenance-requests"],
    queryFn: async () => { const r = await apiRequest("/api/maintenance-requests"); return ensureArray(await r.json()); },
    retry: false,
  });
  const { data: staffRaw } = useQuery({
    queryKey: ["/api/staff-members"],
    queryFn: async () => { const r = await apiRequest("/api/staff-members"); return ensureArray(await r.json()); },
    retry: false,
  });

  const reqs = useMemo(() => ensureArray(rawReqs), [rawReqs]);
  const staff = useMemo(() =>
    ensureArray(staffRaw).filter((s: any) =>
      ["technician","maintenance_supervisor","facilities_manager","groundskeeper","janitor"].includes(s.position ?? "")
    ), [staffRaw]);

  const displayed = useMemo(() => {
    let list = reqs;
    if (filter === "active") list = list.filter((r: any) => !["completed","cancelled"].includes(r.status));
    else if (filter !== "all") list = list.filter((r: any) => r.status === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((r: any) =>
        r.title?.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q) ||
        r.property?.name?.toLowerCase().includes(q) || r.unit?.unitNumber?.toLowerCase().includes(q));
    }
    return list;
  }, [reqs, filter, search]);

  const assignMutation = useMutation({
    mutationFn: async ({ id, technicianId }: { id: number; technicianId: number }) => {
      const r = await apiRequest(`/api/maintenance-requests/${id}/assign-technician`, { method: "PATCH", data: { technicianId, status: "assigned" } });
      if (!r.ok) throw new Error("Assignment failed");
      return r.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/maintenance-requests"] }); toast({ title: "Technician assigned" }); },
    onError: (e: any) => toast({ title: e.message ?? "Failed", variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const r = await apiRequest(`/api/maintenance-requests/${id}`, { method: "PATCH", data: { status } });
      return r.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/maintenance-requests"] }); toast({ title: "Status updated" }); },
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, action }: { id: number; action: "approve" | "reject" }) => {
      const r = await apiRequest(`/api/maintenance-requests/${id}/approve`, { method: "PATCH", data: { action } });
      return r.json();
    },
    onSuccess: (_, v) => { queryClient.invalidateQueries({ queryKey: ["/api/maintenance-requests"] }); toast({ title: v.action === "approve" ? "Approved" : "Rejected" }); },
    onError: () => toast({ title: "Action failed", variant: "destructive" }),
  });

  const counts = useMemo(() => ({
    pending:    reqs.filter((r: any) => r.status === "pending").length,
    inProgress: reqs.filter((r: any) => r.status === "in_progress").length,
    urgent:     reqs.filter((r: any) => ["urgent","critical"].includes(r.priority) && !["completed","cancelled"].includes(r.status)).length,
    doneToday:  reqs.filter((r: any) => r.status === "completed" && r.completedAt && isToday(new Date(r.completedAt))).length,
  }), [reqs]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Pending",     value: counts.pending,    color: "text-blue-600 dark:text-blue-400",   bg: "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800",   icon: Clock },
          { label: "In Progress", value: counts.inProgress, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800",  icon: Play },
          { label: "Urgent",      value: counts.urgent,     color: "text-red-600 dark:text-red-400",     bg: "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800",         icon: AlertTriangle },
          { label: "Done Today",  value: counts.doneToday,  color: "text-green-600 dark:text-green-400", bg: "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800",  icon: CheckCircle2 },
        ].map(s => (
          <div key={s.label} className={`${s.bg} border rounded-xl p-3 text-center`}>
            <s.icon className={`h-5 w-5 ${s.color} mx-auto mb-1`} />
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-36">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search requests..." className="pl-9 h-9 text-sm bg-background" />
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-36 h-9 text-sm bg-background"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={() => refetch()} className="h-9 w-9 p-0"><RefreshCw className="h-3.5 w-3.5" /></Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" />Loading...</div>
      ) : displayed.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Wrench className="h-10 w-10 mx-auto mb-2 opacity-30" /><p className="text-sm">No maintenance requests</p>
        </div>
      ) : (
        <div className="space-y-2">
          {displayed.map((req: any) => {
            const st = MAINT_STATUS[req.status] ?? MAINT_STATUS.pending;
            const pr = PRIORITY[req.priority ?? "medium"] ?? PRIORITY.medium;
            const isExp = expandedId === req.id;
            const needsApproval = req.approvalRequired && req.status === "pending";
            return (
              <div key={req.id} className={`rounded-xl border ${st.bg} ${st.border}`}>
                <button className="w-full text-left p-3" onClick={() => setExpandedId(isExp ? null : req.id)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-foreground">{req.title ?? `Ticket #${req.id}`}</span>
                        {needsApproval && <Badge className="bg-orange-100 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800 text-xs py-0">Needs Approval</Badge>}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                        {req.property?.name && <span className="flex items-center gap-1"><Building className="h-3 w-3" />{req.property.name}</span>}
                        {req.unit?.unitNumber && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />Unit {req.unit.unitNumber}</span>}
                        <span>{timeAgo(req.createdAt)}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className={`text-xs font-medium flex items-center gap-1 ${st.color}`}><st.icon className="h-3 w-3" />{st.label}</span>
                      <span className={`text-xs flex items-center gap-1 ${pr.text}`}><span className={`h-1.5 w-1.5 rounded-full ${pr.dot}`} />{pr.label}</span>
                      {isExp ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground mt-1" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground mt-1" />}
                    </div>
                  </div>
                </button>
                {isExp && (
                  <div className="px-3 pb-3 pt-2 border-t border-border/40 space-y-3">
                    {req.description && <p className="text-sm text-foreground/80">{req.description}</p>}
                    {needsApproval && (
                      <div className="flex gap-2">
                        <Button size="sm" className="text-xs h-7 bg-green-600 hover:bg-green-700 text-white" onClick={() => approveMutation.mutate({ id: req.id, action: "approve" })}><Check className="h-3 w-3 mr-1" />Approve</Button>
                        <Button size="sm" variant="outline" className="text-xs h-7 border-red-300 dark:border-red-800 text-red-600 dark:text-red-400" onClick={() => approveMutation.mutate({ id: req.id, action: "reject" })}><X className="h-3 w-3 mr-1" />Reject</Button>
                      </div>
                    )}
                    {!["completed","cancelled"].includes(req.status) && staff.length > 0 && (
                      <Select onValueChange={val => assignMutation.mutate({ id: req.id, technicianId: Number(val) })}>
                        <SelectTrigger className="h-8 text-xs bg-background"><SelectValue placeholder={req.technicianId ? "Re-assign technician" : "Assign technician…"} /></SelectTrigger>
                        <SelectContent>
                          {staff.map((s: any) => (
                            <SelectItem key={s.id} value={String(s.id)}>{s.first_name} {s.last_name} · <span className="capitalize text-muted-foreground">{s.position?.replace(/_/g," ")}</span></SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {!["completed","cancelled"].includes(req.status) && (
                      <div className="flex gap-2 flex-wrap">
                        {req.status !== "in_progress" && (
                          <Button size="sm" variant="outline" className="text-xs h-7 border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-400" onClick={() => statusMutation.mutate({ id: req.id, status: "in_progress" })}><Play className="h-3 w-3 mr-1" />Start</Button>
                        )}
                        <Button size="sm" className="text-xs h-7 bg-green-600 hover:bg-green-700 text-white" onClick={() => statusMutation.mutate({ id: req.id, status: "completed" })}><Check className="h-3 w-3 mr-1" />Complete</Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Tenants Panel ────────────────────────────────────────────────────────────
function TenantsPanel() {
  const [search, setSearch] = useState("");
  const [composingFor, setComposingFor] = useState<any | null>(null);
  const [msgBody, setMsgBody] = useState("");
  const [sending, setSending] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: tenantsRaw, isLoading } = useQuery({
    queryKey: ["/api/tenants"],
    queryFn: async () => { const r = await apiRequest("/api/tenants"); return ensureArray(await r.json()); },
    retry: false,
  });

  const tenants = useMemo(() => {
    const list = ensureArray(tenantsRaw);
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter((t: any) =>
      `${t.firstName} ${t.lastName}`.toLowerCase().includes(q) ||
      t.email?.toLowerCase().includes(q) || t.phone?.includes(q));
  }, [tenantsRaw, search]);

  const sendMessage = async (t: any) => {
    if (!msgBody.trim() || !(t.userId ?? t.user_id)) return;
    setSending(true);
    try {
      await apiRequest("/api/messages", { method: "POST", data: { toUserId: t.userId ?? t.user_id, subject: "Message from Property Manager", content: msgBody } });
      setMsgBody(""); setComposingFor(null);
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
      toast({ title: "Message sent" });
    } catch { toast({ title: "Failed to send", variant: "destructive" }); }
    finally { setSending(false); }
  };

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tenants..." className="pl-9 h-9 text-sm bg-background" />
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" />Loading...</div>
      ) : (
        <div className="space-y-2">
          {tenants.map((t: any) => (
            <div key={t.id} className="bg-card border border-border rounded-xl p-3 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-primary">{(t.firstName?.[0] ?? "?").toUpperCase()}</span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{t.firstName} {t.lastName}</p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5 flex-wrap">
                      {t.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{t.email}</span>}
                      {t.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{t.phone}</span>}
                    </div>
                    {t.unitNumber && <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1"><MapPin className="h-3 w-3" />Unit {t.unitNumber}{t.propertyName ? ` · ${t.propertyName}` : ""}</p>}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <Badge className={`text-xs py-0 capitalize ${t.status === "active" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-muted text-muted-foreground border-border"}`}>{t.status ?? "active"}</Badge>
                  {(t.userId ?? t.user_id) && (
                    <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => { setComposingFor(t); setMsgBody(""); }}>
                      <MessageSquare className="h-3 w-3 mr-1" />Message
                    </Button>
                  )}
                </div>
              </div>
              {composingFor?.id === t.id && (
                <div className="mt-3 pt-3 border-t border-border space-y-2">
                  <Textarea value={msgBody} onChange={e => setMsgBody(e.target.value)} placeholder={`Message to ${t.firstName}…`} className="text-sm bg-background min-h-[64px] resize-none" />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => sendMessage(t)} disabled={sending || !msgBody.trim()} className="text-xs h-7">
                      {sending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Send className="h-3 w-3 mr-1" />}Send
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setComposingFor(null)} className="text-xs h-7">Cancel</Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Messages Panel ───────────────────────────────────────────────────────────
function MessagesPanel({ user }: { user: any }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [msgTab, setMsgTab] = useState<"inbox"|"sent">("inbox");
  const [composing, setComposing] = useState(false);
  const [toUserId, setToUserId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const { data: inboxData, refetch: ri } = useQuery({ queryKey: ["/api/messages","inbox"], queryFn: async () => { const r = await apiRequest("/api/messages?box=inbox"); const j = await r.json(); return ensureArray(j?.results ?? j); }, retry: false });
  const { data: sentData, refetch: rs } = useQuery({ queryKey: ["/api/messages","sent"], queryFn: async () => { const r = await apiRequest("/api/messages?box=sent"); const j = await r.json(); return ensureArray(j?.results ?? j); }, retry: false, enabled: msgTab === "sent" });
  const { data: orgUsersRaw } = useQuery({ queryKey: ["/api/auth/users"], queryFn: async () => { const r = await apiRequest("/api/auth/users"); return ensureArray(await r.json()); }, retry: false });

  const msgs = useMemo(() => msgTab === "inbox" ? ensureArray(inboxData) : ensureArray(sentData), [msgTab, inboxData, sentData]);
  const recipients = useMemo(() => ensureArray(orgUsersRaw).filter((u: any) => u.id !== user?.id), [orgUsersRaw, user]);

  const send = async () => {
    if (!body.trim() || !toUserId) return;
    setSending(true);
    try {
      await apiRequest("/api/messages", { method: "POST", data: { toUserId, subject: subject || "Message from Property Manager", content: body } });
      setBody(""); setSubject(""); setToUserId(""); setComposing(false);
      ri(); rs();
      toast({ title: "Message sent" });
    } catch { toast({ title: "Failed to send", variant: "destructive" }); }
    finally { setSending(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-1 bg-muted rounded-lg p-1">
          {(["inbox","sent"] as const).map(t => (
            <button key={t} onClick={() => setMsgTab(t)} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${msgTab===t?"bg-card shadow text-foreground":"text-muted-foreground hover:text-foreground"}`}>
              {t==="inbox"?<><Inbox className="h-3 w-3 inline mr-1"/>Inbox</>:<><ArrowUpRight className="h-3 w-3 inline mr-1"/>Sent</>}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => setComposing(!composing)} className="h-7 text-xs"><Send className="h-3 w-3 mr-1"/>New Message</Button>
      </div>
      {composing && (
        <div className="rounded-xl border-2 border-border bg-muted p-4 space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">New Message</p>
          <Select value={toUserId} onValueChange={setToUserId}><SelectTrigger className="text-sm bg-background h-9"><SelectValue placeholder="Send to…"/></SelectTrigger><SelectContent>{recipients.map((u:any)=>(<SelectItem key={u.id} value={u.id}>{[u.firstName,u.lastName].filter(Boolean).join(" ")||u.email} <span className="text-muted-foreground capitalize">· {u.role}</span></SelectItem>))}</SelectContent></Select>
          <Input value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Subject" className="text-sm bg-background h-9"/>
          <Textarea value={body} onChange={e=>setBody(e.target.value)} placeholder="Your message…" className="text-sm bg-background min-h-[80px] resize-none"/>
          <div className="flex gap-2">
            <Button size="sm" onClick={send} disabled={sending||!body.trim()||!toUserId} className="text-xs h-7">{sending?<Loader2 className="h-3 w-3 mr-1 animate-spin"/>:<Send className="h-3 w-3 mr-1"/>}Send</Button>
            <Button size="sm" variant="outline" onClick={()=>setComposing(false)} className="text-xs h-7">Cancel</Button>
          </div>
        </div>
      )}
      {msgs.length===0?(
        <div className="text-center py-12 text-muted-foreground"><MessageSquare className="h-10 w-10 mx-auto mb-2 opacity-30"/><p className="text-sm">No {msgTab} messages</p></div>
      ):(
        <div className="space-y-2">
          {msgs.map((msg:any)=>(
            <div key={msg.id} className={`rounded-xl border bg-card p-4 shadow-sm ${!msg.isRead&&msgTab==="inbox"?"border-primary/30":"border-border"}`}>
              <div className="flex items-start gap-2 mb-1">
                {!msg.isRead&&msgTab==="inbox"&&<span className="h-2 w-2 rounded-full bg-primary mt-1.5 shrink-0"/>}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{msg.subject??"(no subject)"}</p>
                  <p className="text-xs text-muted-foreground">{msgTab==="inbox"?`From: ${msg.fromName??"Unknown"}`:`To: ${msg.toName??"Unknown"}`} · {timeAgo(msg.createdAt)}</p>
                </div>
              </div>
              <p className="text-sm text-foreground/80 leading-relaxed">{msg.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
interface PMNotification { id: string; type: "maintenance"|"payment"|"message"|"system"; title: string; message: string; ts: string; read: boolean; }

// ─── OrgRatingsPanel ─────────────────────────────────────────────────────────
function OrgRatingsPanel() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/ratings/org-reviews"],
    queryFn: async () => (await apiRequest("/api/ratings/org-reviews")).json(),
  });

  const [filterType, setFilterType] = useState<string>("all");

  const reviewTypeLabel: Record<string, string> = {
    maintenance: "Maintenance",
    caretaker:   "Caretaker",
    landlord:    "Landlord / Management",
  };

  const reviewTypeBadgeColor: Record<string, string> = {
    maintenance: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
    caretaker:   "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
    landlord:    "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  };

  const renderStars = (rating: number) => (
    <span className="flex gap-0.5">
      {[1,2,3,4,5].map(n => (
        <Star key={n} className={`w-3.5 h-3.5 ${n <= rating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/30"}`} />
      ))}
    </span>
  );

  if (isLoading) return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
    </div>
  );

  const summary: any[] = data?.summary ?? [];
  const reviews: any[] = data?.reviews ?? [];
  const overallAvg: number = data?.overallAvg ?? 0;
  const totalRatings: number = data?.totalRatings ?? 0;
  const dist: Record<number, number> = data?.distribution ?? {};

  const filtered = filterType === "all" ? reviews : reviews.filter((r: any) => r.reviewType === filterType);

  return (
    <div className="space-y-5">
      {/* ── Summary strip ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="rounded-2xl border-border shadow-none">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Overall Rating</p>
            <p className="text-2xl font-bold text-foreground">{overallAvg.toFixed(1)}<span className="text-sm text-muted-foreground font-normal"> / 5</span></p>
            <div className="flex gap-0.5 mt-1">{renderStars(Math.round(overallAvg))}</div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-border shadow-none">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Total Reviews</p>
            <p className="text-2xl font-bold text-foreground">{totalRatings}</p>
          </CardContent>
        </Card>
        {summary.map((s: any) => (
          <Card key={s.reviewType} className="rounded-2xl border-border shadow-none">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1">{reviewTypeLabel[s.reviewType] ?? s.reviewType}</p>
              <p className="text-2xl font-bold text-foreground">{Number(s.avgRating).toFixed(1)}<span className="text-sm text-muted-foreground font-normal"> / 5</span></p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.count} review{s.count !== 1 ? "s" : ""}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Rating distribution bar ───────────────────────────────────── */}
      {totalRatings > 0 && (
        <Card className="rounded-2xl border-border shadow-none">
          <CardContent className="p-4 space-y-2">
            <p className="text-xs font-semibold text-foreground mb-2">Rating Distribution</p>
            {[5,4,3,2,1].map(n => {
              const count = dist[n] ?? 0;
              const pct = totalRatings > 0 ? Math.round((count / totalRatings) * 100) : 0;
              return (
                <div key={n} className="flex items-center gap-2 text-xs">
                  <span className="w-4 text-muted-foreground shrink-0">{n}</span>
                  <Star className="w-3 h-3 fill-yellow-400 text-yellow-400 shrink-0" />
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-yellow-400 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-8 text-right text-muted-foreground">{count}</span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* ── Filter + Review list ──────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold text-foreground flex-1">Recent Reviews</p>
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="text-xs border border-border rounded-lg px-2 py-1.5 bg-background text-foreground"
        >
          <option value="all">All Types</option>
          <option value="maintenance">Maintenance</option>
          <option value="caretaker">Caretaker</option>
          <option value="landlord">Landlord</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">No reviews yet for this filter.</div>
      ) : (
        <div className="space-y-3">
          {filtered.map((r: any) => (
            <Card key={r.id} className="rounded-2xl border-border shadow-none">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${reviewTypeBadgeColor[r.reviewType] ?? "bg-muted text-muted-foreground"}`}>
                      {reviewTypeLabel[r.reviewType] ?? r.reviewType}
                    </span>
                    {renderStars(Number(r.rating))}
                    <span className="text-xs text-muted-foreground font-medium">{Number(r.rating)}/5</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {r.createdAt ? format(new Date(r.createdAt), "d MMM yyyy") : "—"}
                  </span>
                </div>
                {r.title && <p className="text-sm font-medium text-foreground">{r.title}</p>}
                {r.comment && <p className="text-xs text-muted-foreground leading-relaxed">{r.comment}</p>}
                <div className="flex items-center gap-2 pt-1 border-t border-border">
                  <User className="w-3 h-3 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    {[r.tenantFirstName, r.tenantLastName].filter(Boolean).join(" ") || "Tenant"}
                    {r.propertyName ? ` · ${r.propertyName}` : ""}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PropertyManagerDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("overview");
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<PMNotification[]>([]);

  const { data: propertiesRaw, isLoading } = useQuery({ queryKey: ["/api/properties"], queryFn: async () => { const r = await apiRequest("/api/properties"); return ensureArray(await r.json()); }, retry: false });
  const { data: maintenanceRaw } = useQuery({ queryKey: ["/api/maintenance-requests"], queryFn: async () => { const r = await apiRequest("/api/maintenance-requests"); return ensureArray(await r.json()); }, retry: false });
  const { data: tenantsRaw } = useQuery({ queryKey: ["/api/tenants"], queryFn: async () => { const r = await apiRequest("/api/tenants"); return ensureArray(await r.json()); }, retry: false });
  const { data: paymentsRaw } = useQuery({ queryKey: ["/api/rent-payments"], queryFn: async () => { const r = await apiRequest("/api/rent-payments"); return ensureArray(await r.json()); }, retry: false });

  const properties  = useMemo(() => ensureArray(propertiesRaw),  [propertiesRaw]);
  const maintenance = useMemo(() => ensureArray(maintenanceRaw), [maintenanceRaw]);
  const tenants     = useMemo(() => ensureArray(tenantsRaw),     [tenantsRaw]);
  const payments    = useMemo(() => ensureArray(paymentsRaw),    [paymentsRaw]);

  const totalUnits    = properties.reduce((s: number, p: any) => s + Number(p.totalUnits ?? 0), 0);
  const occupiedUnits = properties.reduce((s: number, p: any) => s + Number(p.occupiedUnits ?? 0), 0);
  const occupancyRate = totalUnits > 0 ? Math.round(occupiedUnits / totalUnits * 100) : 0;
  const openTickets   = maintenance.filter((r: any) => !["completed","cancelled"].includes(r.status)).length;
  const urgentTickets = maintenance.filter((r: any) => ["urgent","critical"].includes(r.priority ?? "") && !["completed","cancelled"].includes(r.status)).length;
  const activeTenants = tenants.filter((t: any) => t.status === "active").length;
  const now = new Date();
  const monthRevenue = payments.filter((p: any) => {
    if (!["paid","completed"].includes(p.status)) return false;
    // Use paidDate (set by mark-paid), fall back to dueDate (billing period), then createdAt
    const d = p.paidDate ?? p.dueDate ?? p.createdAt;
    if (!d) return false;
    const pd = new Date(d);
    return pd.getMonth()===now.getMonth() && pd.getFullYear()===now.getFullYear();
  }).reduce((s: number, p: any) => s + Number(p.amount ?? 0), 0);

  const chartData = properties.slice(0, 8).map((p: any) => ({
    name: (p.name ?? "Property").slice(0, 12),
    Occupied: Number(p.occupiedUnits ?? 0),
    Vacant: Math.max(0, Number(p.totalUnits ?? 0) - Number(p.occupiedUnits ?? 0)),
  }));

  const addNotif = (n: Omit<PMNotification,"id"|"read">) =>
    setNotifications(prev => [{ ...n, id: String(Date.now()), read: false }, ...prev].slice(0, 50));

  useWsEvent("maintenance:updated", (p: any) => { queryClient.invalidateQueries({ queryKey: ["/api/maintenance-requests"] }); addNotif({ type:"maintenance", title:"Maintenance updated", message:`Request #${p?.id} → ${(p?.status??"").replace(/_/g," ")}`, ts: new Date().toISOString() }); });
  useWsEvent("payment:confirmed",  (p: any) => { queryClient.invalidateQueries({ queryKey: ["/api/rent-payments"] }); addNotif({ type:"payment", title:"Payment confirmed", message:`${p?.amount ?? ""} received`, ts: new Date().toISOString() }); toast({ title:"Payment confirmed ✓" }); });
  useWsEvent("payment:overdue",    ()       => { queryClient.invalidateQueries({ queryKey: ["/api/rent-payments"] }); addNotif({ type:"payment", title:"Payment overdue", message:"A tenant has an overdue payment", ts: new Date().toISOString() }); toast({ title:"Payment overdue", variant:"destructive" }); });
  useWsEvent("message:new",        (p: any) => { queryClient.invalidateQueries({ queryKey: ["/api/messages"] }); addNotif({ type:"message", title:"New message", message:`From ${p?.fromName??"someone"}`, ts: new Date().toISOString() }); });
  useWsEvent("broadcast",          (p: any) => { addNotif({ type:"system", title:p?.title??"Notice", message:p?.message??"", ts: new Date().toISOString() }); });

  const markAllRead = () => setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  const clearAll    = () => setNotifications([]);
  const unread      = notifications.filter(n => !n.read).length;

  const NCLS: Record<string,string> = {
    maintenance: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400",
    payment:     "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400",
    message:     "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400",
    system:      "bg-muted border-border text-muted-foreground",
  };
  const NICON: Record<string,any> = { maintenance: Wrench, payment: DollarSign, message: MessageSquare, system: Bell };

  if (isLoading) return <div className="p-6 space-y-4">{[...Array(4)].map((_,i)=><div key={i} className="h-24 bg-muted rounded-xl animate-pulse"/>)}</div>;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-slate-900 text-white px-4 sm:px-6 py-5 shadow-lg">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-xl bg-card/10 border border-white/20 flex items-center justify-center shadow">
                <Building className="h-6 w-6 text-white"/>
              </div>
              <div>
                <p className="text-lg font-bold leading-tight">Property Manager</p>
                <p className="text-white/70 text-sm">{user?.firstName ? `Welcome, ${user.firstName}` : "Operations Dashboard"}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setNotifOpen(!notifOpen)} className="relative p-2 rounded-xl bg-card/10 border border-white/20 hover:bg-card/20 transition-colors" aria-label="Notifications">
                <Bell className="h-5 w-5 text-white"/>
                {unread > 0 && <span className="absolute -top-1 -right-1 h-[18px] min-w-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-0.5 border-2 border-white/20">{unread>9?"9+":unread}</span>}
              </button>
              <div className="text-right hidden sm:block">
                <p className="text-xs text-white/60">{format(new Date(),"EEE, dd MMM yyyy")}</p>
                <p className="text-xs text-white/60">{occupancyRate}% occupancy</p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
            {[
              { label:"Properties",  value:String(properties.length),  color:"text-white" },
              { label:"Tenants",     value:String(activeTenants),       color:"text-white" },
              { label:"Open Tickets",value:String(openTickets),         color:urgentTickets>0?"text-red-300":"text-white" },
              { label:"Month Rev.",  value:fmtKES(monthRevenue),        color:"text-emerald-200" },
            ].map(s=>(
              <div key={s.label} className="text-center bg-card/10 rounded-lg py-2 px-1">
                <p className={`text-lg font-bold ${s.color} truncate`}>{s.value}</p>
                <p className="text-xs text-white/60 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Notification drawer */}
      {notifOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={()=>setNotifOpen(false)}/>
          <div className="fixed bottom-0 left-0 right-0 z-50 max-h-[75vh] flex flex-col bg-card text-card-foreground rounded-t-2xl shadow-2xl sm:left-auto sm:right-4 sm:bottom-4 sm:top-4 sm:w-96 sm:rounded-2xl sm:max-h-none">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4"/><span className="font-semibold">Notifications</span>
                {unread>0&&<Badge className="bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400 border-red-200 text-xs py-0">{unread} new</Badge>}
              </div>
              <div className="flex gap-1">
                {unread>0&&<button onClick={markAllRead} className="p-1.5 rounded-lg hover:bg-muted" title="Mark all read"><CheckCheck className="h-4 w-4 text-muted-foreground"/></button>}
                {notifications.length>0&&<button onClick={clearAll} className="p-1.5 rounded-lg hover:bg-muted" title="Clear all"><Trash2 className="h-4 w-4 text-muted-foreground"/></button>}
                <button onClick={()=>setNotifOpen(false)} className="p-1.5 rounded-lg hover:bg-muted ml-1"><X className="h-4 w-4 text-muted-foreground"/></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
              {notifications.length===0?(
                <div className="text-center py-12 text-muted-foreground"><BellOff className="h-10 w-10 mx-auto mb-2 opacity-30"/><p className="text-sm">No notifications yet</p></div>
              ):notifications.map(n=>{
                const Icon=NICON[n.type]??Bell; const cls=NCLS[n.type]??NCLS.system;
                return(
                  <div key={n.id} className={`rounded-xl border p-3 cursor-pointer ${n.read?"opacity-60 bg-card border-border":cls}`} onClick={()=>setNotifications(prev=>prev.map(x=>x.id===n.id?{...x,read:true}:x))}>
                    <div className="flex items-start gap-2">
                      <Icon className="h-4 w-4 shrink-0 mt-0.5"/>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-foreground">{n.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{n.message}</p>
                        <p className="text-xs text-muted-foreground/60 mt-1">{timeAgo(n.ts)}</p>
                      </div>
                      {!n.read&&<span className="h-2 w-2 rounded-full bg-primary shrink-0 mt-1"/>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Body */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full bg-card border border-border shadow-sm rounded-xl p-1 mb-5 flex flex-wrap h-auto gap-1">
            {[
              { value:"overview",    label:"Overview",    icon:Activity },
              { value:"maintenance", label:"Maintenance", icon:Wrench,         badge: openTickets>0?String(openTickets):undefined },
              { value:"tenants",     label:"Tenants",     icon:Users },
              { value:"messages",    label:"Messages",    icon:MessageSquare },
              { value:"ratings",     label:"Ratings",     icon:Star },
            ].map(t=>(
              <TabsTrigger key={t.value} value={t.value} className="flex-1 min-w-[80px] rounded-lg text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-muted-foreground flex items-center justify-center gap-1">
                <t.icon className="h-3.5 w-3.5"/><span className="hidden sm:inline">{t.label}</span>
                {t.badge&&<span className="h-4 min-w-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1">{t.badge}</span>}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            {chartData.length>0&&(
              <Card className="border-border shadow-sm">
                <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Building className="h-4 w-4 text-muted-foreground"/>Occupancy by Property</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={chartData} margin={{top:5,right:10,left:0,bottom:30}}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))"/>
                      <XAxis dataKey="name" tick={{fontSize:10,fill:"hsl(var(--muted-foreground))"}} angle={-30} textAnchor="end" interval={0}/>
                      <YAxis tick={{fontSize:10,fill:"hsl(var(--muted-foreground))"}}/>
                      <Tooltip contentStyle={{background:"hsl(var(--card))",border:"1px solid hsl(var(--border))",borderRadius:8}}/>
                      <Bar dataKey="Occupied" stackId="a" fill="#22c55e" radius={[0,0,0,0]}/>
                      <Bar dataKey="Vacant"   stackId="a" fill="hsl(var(--muted))" radius={[3,3,0,0]}/>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}
            <Card className="border-border shadow-sm">
              <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><MapPin className="h-4 w-4 text-muted-foreground"/>Property Status</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {properties.slice(0,8).map((p:any)=>{
                  const pct = p.totalUnits>0?Math.round((p.occupiedUnits??0)/p.totalUnits*100):0;
                  const maint = maintenance.filter((r:any)=>r.property?.id===p.id&&!["completed","cancelled"].includes(r.status)).length;
                  return(
                    <div key={p.id} className="flex items-center justify-between p-3 rounded-xl bg-muted/50 border border-border">
                      <div>
                        <p className="text-sm font-medium text-foreground">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{p.totalUnits??0} units · {pct}% occupied{maint>0?` · ${maint} open`:""}</p>
                      </div>
                      <Badge className={`text-xs py-0 ${pct >= 90 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : pct >= 75 ? 'bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800' : 'bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800'}`}>
                        {pct >= 90 ? 'Excellent' : pct >= 75 ? 'Good' : 'Low'}
                      </Badge>
                    </div>
                  );
                })}
                {properties.length===0&&<p className="text-sm text-muted-foreground text-center py-4">No properties found</p>}
              </CardContent>
            </Card>
            {urgentTickets>0&&(
              <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-4">
                <p className="text-sm font-semibold text-red-700 dark:text-red-400 mb-2 flex items-center gap-2"><AlertTriangle className="h-4 w-4"/>{urgentTickets} Urgent Issue{urgentTickets!==1?"s":""}</p>
                {maintenance.filter((r:any)=>["urgent","critical"].includes(r.priority??"")&&!["completed","cancelled"].includes(r.status)).slice(0,3).map((r:any)=>(
                  <div key={r.id} className="flex items-center justify-between text-xs py-1.5 border-t border-red-100 dark:border-red-900 first:border-0">
                    <span className="text-red-800 dark:text-red-300 font-medium truncate flex-1">{r.title??`Ticket #${r.id}`}</span>
                    <button onClick={()=>setTab("maintenance")} className="text-red-600 dark:text-red-400 underline ml-2 shrink-0">View →</button>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="maintenance"><MaintenancePanel/></TabsContent>
          <TabsContent value="tenants"><TenantsPanel/></TabsContent>
          <TabsContent value="messages"><MessagesPanel user={user}/></TabsContent>
          <TabsContent value="ratings"><OrgRatingsPanel/></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}