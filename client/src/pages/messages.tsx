/**
 * messages.tsx — Role- and org-guarded messaging page
 *
 * Role hierarchy (lowest → highest):
 *   tenant  → can message their property manager / admin only
 *   landlord → can message managers + admins; cannot see other landlords
 *   manager → can message anyone in the org except other tenants' private threads
 *   admin   → full access; sees all org messages
 *
 * Org guard: if user.organizationId is absent the page renders a hard block.
 *
 * Contacts (compose picker):
 *   tenant   → sees only managers + admins (never other tenants / landlords)
 *   landlord → sees managers + admins only
 *   manager  → sees admins + other managers + landlords  (not tenants — use broadcast)
 *   admin    → sees everyone in the org
 *
 * UI differences by role:
 *   tenant   → header says "Inbox", no Sent-to-tenants shortcut, no Broadcast tab
 *   landlord → header says "Messages", same as tenant for contacts
 *   manager  → header says "Team Messages", Broadcast shortcut shown
 *   admin    → header says "All Messages", Broadcast shortcut shown
 */

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useWsEvent } from "@/hooks/useWebSocket";
import {
  Plus, Search, Send, X, Reply,
  Inbox, SendHorizonal, Mail, ChevronLeft, Radio,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { useRoleGuard, ROLES } from "@/hooks/useRoleGuard";

import {
  PageShell, PageHeader, SectionCard, SPBadge, EmptyState,
  PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar,
  StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog,
} from "@/components/ui/sp-ui";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Message {
  id: number;
  fromUserId: string;
  toUserId: string;
  fromName: string;
  toName: string;
  fromEmail: string | null;
  toEmail: string | null;
  fromRole: string | null;
  toRole: string | null;
  subject?: string;
  content: string;
  isRead: boolean;
  isSentByMe: boolean;
  createdAt: string;
}

interface OrgUser {
  id: string;
  firstName?: string;
  lastName?: string;
  email: string | null;
  role: string;
}

// ── Role badge ────────────────────────────────────────────────────────────────

const ROLE_BADGE_COLORS: Record<string, string> = {
  admin:       "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400",
  manager:     "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
  landlord:    "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  staff:       "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400",
  caretaker:   "bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-400",
  tenant:      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  contractor:  "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400",
  guard:       "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400",
};

function RoleBadge({ role }: { role: string | null | undefined }) {
  if (!role) return null;
  const colors = ROLE_BADGE_COLORS[role.toLowerCase()] ?? "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center px-1.5 py-0 rounded text-[10px] font-semibold capitalize ${colors}`}>
      {role}
    </span>
  );
}

// ── Role helpers ──────────────────────────────────────────────────────────────

type AppRole = "tenant" | "landlord" | "manager" | "admin";

const ROLE_RANK: Record<AppRole, number> = {
  tenant: 0,
  landlord: 1,
  manager: 2,
  admin: 3,
};

function normalizeRole(raw: string | undefined | null): AppRole {
  const r = (raw ?? "").toLowerCase().replace(/-/g, "_") as AppRole;
  return ROLE_RANK[r] !== undefined ? r : "tenant"; // safest default
}

/** Roles the current user is allowed to message.
 *  tenant / landlord → staff only (manager + admin)
 *  manager           → admins, other managers, landlords
 *  admin             → everyone
 */
function allowedRecipientRoles(role: AppRole): AppRole[] {
  switch (role) {
    case "tenant":
    case "landlord":
      return ["manager", "admin"];
    case "manager":
      return ["manager", "admin", "landlord", "tenant"];
    case "admin":
      return ["tenant", "landlord", "manager", "admin"];
  }
}

/** Roles the current user can send NEW (compose) messages to.
 *  Managers/admins use broadcast for tenant mass-comms,
 *  but can still reply 1-to-1 to a tenant who messaged them first.
 *  Kept separate from allowedRecipientRoles so the compose picker
 *  doesn't list all tenants for managers. */
function composeRecipientRoles(role: AppRole): AppRole[] {
  switch (role) {
    case "tenant":
    case "landlord":
      return ["manager", "admin"];
    case "manager":
      return ["manager", "admin", "landlord"]; // tenants via broadcast, not compose
    case "admin":
      return ["tenant", "landlord", "manager", "admin"];
  }
}

function canAccessBroadcast(role: AppRole) {
  return role === "manager" || role === "admin";
}

// ── Utility ───────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase() || "?";
}

function userName(u: OrgUser) {
  return [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || "Unknown";
}

function pageTitle(role: AppRole) {
  switch (role) {
    case "tenant":   return "Inbox";
    case "landlord": return "Messages";
    case "manager":  return "Team Messages";
    case "admin":    return "All Messages";
  }
}

function pageSubtitle(role: AppRole) {
  switch (role) {
    case "tenant":   return "Your messages with property management";
    case "landlord": return "Your messages with property managers";
    case "manager":  return "Messages across your managed properties";
    case "admin":    return "Organisation-wide message centre";
  }
}

// ── MessageRow ────────────────────────────────────────────────────────────────

function MessageRow({ message, isSelected, onSelect }: {
  message: Message; isSelected: boolean; onSelect: () => void;
}) {
  const counterpart = message.isSentByMe ? message.toName : message.fromName;
  const unread = !message.isRead && !message.isSentByMe;

  return (
    <button
      className={`w-full text-left px-4 py-3.5 transition-colors border-b border-border/50 dark:border-gray-800/60 last:border-0
        ${isSelected ? "bg-blue-50 dark:bg-blue-950/40" : "hover:bg-muted/60 dark:hover:bg-gray-900/60"}`}
      onClick={onSelect}
    >
      <div className="flex items-start gap-3">
        <Avatar className="w-8 h-8 flex-shrink-0 mt-0.5">
          <AvatarFallback className={`text-xs font-semibold ${message.isSentByMe ? "bg-blue-100 text-blue-700" : "bg-muted dark:bg-gray-700 text-muted-foreground"}`}>
            {initials(counterpart)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <span className={`text-sm truncate flex items-center gap-1.5 ${unread ? "font-semibold text-foreground" : "text-foreground/80"}`}>
              {message.isSentByMe && <SendHorizonal className="w-3 h-3 text-muted-foreground flex-shrink-0" />}
              {counterpart}
              <RoleBadge role={message.isSentByMe ? message.toRole : message.fromRole} />
            </span>
            <span className="text-[10px] text-muted-foreground whitespace-nowrap flex-shrink-0">
              {formatDistanceToNow(new Date(message.createdAt), { addSuffix: true })}
            </span>
          </div>
          <p className={`text-xs truncate ${unread ? "text-foreground/70" : "text-muted-foreground"}`}>
            {message.subject ? <><span className="font-medium">{message.subject}</span> · </> : null}
            {message.content}
          </p>
        </div>
        {unread && <div className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0 mt-2" />}
      </div>
    </button>
  );
}

// ── MessageDetail ─────────────────────────────────────────────────────────────

function MessageDetail({ message, onClose, onReply, canReply }: {
  message: Message;
  onClose: () => void;
  onReply: (toUserId: string, subject: string) => void;
  /** Only allow reply when current role permits messaging the sender. */
  canReply: boolean;
}) {
  return (
    <Card className="rounded-xl border border-slate-100 shadow-sm h-full flex flex-col">
      <div className="px-5 py-4 border-b border-border dark:border-gray-800 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground truncate">
            {message.subject || "No subject"}
          </h2>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-muted-foreground items-center">
            <span>
              <span className="text-foreground/60">From:</span>{" "}
              <span className="font-medium text-foreground">{message.fromName}</span>
              {message.fromEmail && <span> &lt;{message.fromEmail}&gt;</span>}
            </span>
            <span>
              <span className="text-foreground/60">To:</span>{" "}
              <span className="font-medium text-foreground">{message.toName}</span>
              {message.toEmail && <span> &lt;{message.toEmail}&gt;</span>}
            </span>
            <span>{formatDistanceToNow(new Date(message.createdAt), { addSuffix: true })}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {canReply && !message.isSentByMe && (
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5"
              onClick={() => onReply(message.fromUserId, `Re: ${message.subject || ""}`.trim())}>
              <Reply className="w-3.5 h-3.5" />Reply
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
      <CardContent className="p-5 flex-1 overflow-y-auto">
        <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
          {message.content}
        </p>
      </CardContent>
    </Card>
  );
}

// ── OrgGuard ──────────────────────────────────────────────────────────────────

function OrgGuard() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <Card className="max-w-sm w-full mx-4">
        <CardContent className="py-12 text-center">
          <Mail className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground mb-1">No organisation linked</p>
          <p className="text-xs text-muted-foreground">
            Your account is not associated with an organisation. Please contact support.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Messages() {
  const guard = useRoleGuard(ROLES.ALL_AUTHENTICATED);
  if (guard.gate) return guard.gate;

  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ── Org guard (client-side; server enforces this too via requireOrg) ─────────
  if (!user?.organizationId) {
    return <OrgGuard />;
  }

  const role = normalizeRole(user?.role);
  const currentUserId = String(user?.id ?? "");
  const allowedRoles  = allowedRecipientRoles(role);  // reply permissions
  const composeRoles  = composeRecipientRoles(role);   // compose picker
  const showBroadcastTab = canAccessBroadcast(role);

  const [box, setBox]               = useState<"all" | "inbox" | "sent">("all");
  const [search, setSearch]         = useState("");
  const [readFilter, setReadFilter] = useState("all");
  const [selected, setSelected]     = useState<Message | null>(null);
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [compose, setCompose] = useState({ toUserId: "", subject: "", content: "", isReply: false });

  // ── Fetch messages ──────────────────────────────────────────────────────────
  const { data: messagesData, isLoading } = useQuery<any>({
    queryKey: ["/api/messages", box],
    queryFn: async () => {
      const r = await apiRequest(`/api/messages?box=${box}&limit=100`);
      return r.json();
    },
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
    // Only run when user is fully loaded with an org
    enabled: !!user?.organizationId,
  });

  const messages: Message[] = messagesData?.results ?? ensureArray(messagesData) ?? [];
  const unreadCount = messages.filter(m => !m.isRead && !m.isSentByMe).length;

  // ── Fetch contacts for compose picker ─────────────────────────────────────
  // /api/messages/contacts already applies org scoping on the server.
  // We additionally filter client-side by allowedRoles so tenants never see
  // fellow tenants in the dropdown even if the server were to return them.
  const { data: contactsRaw } = useQuery<any>({
    queryKey: ["/api/messages/contacts"],
    queryFn: async () => {
      const r = await apiRequest("/api/messages/contacts");
      if (!r.ok) return [];
      return r.json();
    },
    staleTime: 5 * 60 * 1000,
    enabled: !!user?.organizationId,
  });

  const allOrgUsers: OrgUser[] = ensureArray(contactsRaw);

  // Client-side role filter — defence-in-depth over the server filter
  const orgUsers: OrgUser[] = allOrgUsers.filter(u => {
    if (u.id === currentUserId) return false; // exclude self
    const uRole = normalizeRole(u.role);
    return composeRoles.includes(uRole);
  });

  // ── Real-time refresh ───────────────────────────────────────────────────────
  useWsEvent("message:new", () => {
    queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
  });

  // ── Send ────────────────────────────────────────────────────────────────────
  const sendMutation = useMutation({
    mutationFn: async (data: typeof compose) => {
      const r = await apiRequest("/api/messages", { method: "POST", data });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
      setIsComposeOpen(false);
      setCompose({ toUserId: "", subject: "", content: "", isReply: false });
    },
    onError: () => {
      toast({ title: "Failed to send message", description: "Please try again.", variant: "destructive" });
    },
  });

  // ── Mark as read ────────────────────────────────────────────────────────────
  const markReadMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest(`/api/messages/${id}/read`, { method: "PUT" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/messages"] }),
  });

  const handleSelect = useCallback((m: Message) => {
    setSelected(m);
    if (!m.isRead && !m.isSentByMe) markReadMutation.mutate(m.id);
  }, [markReadMutation]);

  const openReply = useCallback((toUserId: string, subject: string) => {
    // Validate by role from the message itself rather than waiting for contacts list
    const replyTarget = allOrgUsers.find(u => u.id === toUserId);
    const targetRole = replyTarget ? normalizeRole(replyTarget.role) : null;
    if (targetRole && !allowedRoles.includes(targetRole)) {
      toast({
        title: "Cannot reply",
        description: "You are not permitted to message this user directly.",
        variant: "destructive",
      });
      return;
    }
    setCompose({ toUserId, subject, content: "", isReply: true });
    setIsComposeOpen(true);
  }, [allOrgUsers, allowedRoles, toast]);

  // ── Filter ──────────────────────────────────────────────────────────────────
  const filtered = messages.filter(m => {
    const q = search.toLowerCase();
    const matchSearch = !search
      || (m.subject ?? "").toLowerCase().includes(q)
      || m.content.toLowerCase().includes(q)
      || m.fromName.toLowerCase().includes(q)
      || m.toName.toLowerCase().includes(q);
    const matchRead = readFilter === "all"
      || (readFilter === "unread" && !m.isRead && !m.isSentByMe)
      || (readFilter === "read"   && (m.isRead || m.isSentByMe));
    return matchSearch && matchRead;
  });

  // Whether reply is permitted given the current user's role.
  // Derive from the message's fromRole directly — don't depend on the
  // contacts list having loaded, which would hide the button until it arrives.
  const replyPermitted = useCallback((m: Message) => {
    if (m.isSentByMe) return false;
    const senderRole = normalizeRole(m.fromRole);
    return allowedRoles.includes(senderRole);
  }, [allowedRoles]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <PageShell>
      <PageHeader
        title={pageTitle(role)}
        subtitle={`${pageSubtitle(role)}${unreadCount > 0 ? ` · ${unreadCount} unread` : ""}`}
        icon={<Mail className="w-5 h-5" />}
        actions={
          <>
            {/* Broadcast shortcut — staff only */}
            {showBroadcastTab && (
              <SecondaryButton icon={<Radio className="w-4 h-4" />} onClick={() => window.location.href = "/broadcast-messages"}>
                Broadcast
              </SecondaryButton>
            )}
            {/* Compose is available to all roles with at least one permitted recipient */}
            {orgUsers.length > 0 && (
              <PrimaryButton icon={<Plus className="w-4 h-4" />} onClick={() => { setCompose({ toUserId: "", subject: "", content: "", isReply: false }); setIsComposeOpen(true); }}>
                Compose
              </PrimaryButton>
            )}
          </>
        }
      />

      <div className="w-full">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 h-[calc(100vh-160px)]">

          {/* ── List panel ────────────────────────────────────────────────── */}
          <div className={`lg:col-span-1 flex flex-col gap-3 ${selected ? "hidden lg:flex" : "flex"}`}>

            {/* Inbox / Sent / All tabs */}
            <div className="flex rounded-xl border border-border dark:border-gray-700 bg-card dark:bg-gray-900 p-1 gap-1">
              {(["all", "inbox", "sent"] as const).map(b => (
                <button key={b} onClick={() => { setBox(b); setSelected(null); }}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-lg capitalize transition-colors
                    ${box === b ? "bg-muted dark:bg-gray-800 text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  {b === "inbox" ? (
                    <span className="flex items-center justify-center gap-1">
                      Inbox
                      {unreadCount > 0 && (
                        <Badge className="h-4 min-w-4 px-1 text-[10px] bg-blue-500 text-white rounded-full">
                          {unreadCount}
                        </Badge>
                      )}
                    </span>
                  ) : b === "sent" ? (
                    <span className="flex items-center justify-center gap-1">
                      <SendHorizonal className="w-3 h-3" />Sent
                    </span>
                  ) : "All"}
                </button>
              ))}
            </div>

            {/* Search + read filter */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder="Search…" className="pl-9 h-9 border-border dark:border-gray-700 text-sm"
                  value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <Select value={readFilter} onValueChange={setReadFilter}>
                <SelectTrigger className="w-24 h-9 border-border dark:border-gray-700 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="unread">Unread</SelectItem>
                  <SelectItem value="read">Read</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* List */}
            <Card className="rounded-xl border border-slate-100 shadow-sm flex-1 overflow-y-auto">
              {isLoading ? (
                <div className="p-4 space-y-3">
                  {[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-muted dark:bg-gray-800 rounded-xl animate-pulse" />)}
                </div>
              ) : filtered.length === 0 ? (
                <EmptyState icon={<Mail />} title={search ? "No messages match" : `No messages in ${box}`} size="lg" />
              ) : filtered.map(m => (
                <MessageRow key={m.id} message={m} isSelected={selected?.id === m.id} onSelect={() => handleSelect(m)} />
              ))}
            </Card>
          </div>

          {/* ── Detail panel ──────────────────────────────────────────────── */}
          <div className={`lg:col-span-2 ${selected ? "flex" : "hidden lg:flex"} flex-col`}>
            {selected ? (
              <div className="flex flex-col h-full">
                <button className="lg:hidden flex items-center gap-1.5 text-sm text-blue-600 mb-3"
                  onClick={() => setSelected(null)}>
                  <ChevronLeft className="w-4 h-4" />Back
                </button>
                <MessageDetail
                  message={selected}
                  onClose={() => setSelected(null)}
                  onReply={openReply}
                  canReply={replyPermitted(selected)}
                />
              </div>
            ) : (
              <SectionCard className="h-full">
                <EmptyState
                  icon={<Inbox />}
                  title="Select a message"
                  description="Choose a message from the list to read it here"
                  action={orgUsers.length > 0 ? { label: "Compose new message", onClick: () => { setCompose({ toUserId: "", subject: "", content: "", isReply: false }); setIsComposeOpen(true); } } : undefined}
                  size="lg"
                />
              </SectionCard>
            )}
          </div>
        </div>
      </div>

      {/* ── Compose dialog ──────────────────────────────────────────────────── */}
      <Dialog open={isComposeOpen} onOpenChange={open => {
        setIsComposeOpen(open);
        if (!open) setCompose({ toUserId: "", subject: "", content: "", isReply: false });
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{compose.isReply ? "Reply" : "New message"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-sm font-medium">To</Label>
              {compose.isReply ? (
                // Locked recipient in reply mode — show as read-only chip
                (() => {
                  const recipient = allOrgUsers.find(u => u.id === compose.toUserId);
                  const name = recipient ? userName(recipient) : compose.toUserId;
                  const recipientRole = recipient?.role ?? "";
                  return (
                    <div className="mt-1 flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-muted/50">
                      <Avatar className="w-6 h-6 flex-shrink-0">
                        <AvatarFallback className="text-[10px]">{initials(name)}</AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-medium">{name}</span>
                      {recipientRole && (
                        <span className="text-xs text-muted-foreground">· {recipientRole.replace(/_/g, " ")}</span>
                      )}
                    </div>
                  );
                })()
              ) : (
                <Select value={compose.toUserId || undefined} onValueChange={v => setCompose(c => ({ ...c, toUserId: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select recipient" /></SelectTrigger>
                  <SelectContent>
                    {orgUsers.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-muted-foreground">No available recipients</div>
                    ) : orgUsers.map(u => (
                      <SelectItem key={u.id} value={u.id}>
                        <span className="flex items-center gap-2">
                          <Avatar className="w-5 h-5">
                            <AvatarFallback className="text-[10px]">{initials(userName(u))}</AvatarFallback>
                          </Avatar>
                          <span>{userName(u)}</span>
                          {u.role && (
                            <span className="text-muted-foreground text-xs">
                              · {u.role.replace(/_/g, " ")}
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div>
              <Label className="text-sm font-medium">Subject</Label>
              <Input className="mt-1" placeholder="Subject (optional)" value={compose.subject}
                onChange={e => setCompose(c => ({ ...c, subject: e.target.value }))} />
            </div>
            <div>
              <Label className="text-sm font-medium">Message</Label>
              <Textarea className="mt-1 min-h-[140px] resize-none" placeholder="Write your message…"
                value={compose.content} onChange={e => setCompose(c => ({ ...c, content: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsComposeOpen(false)}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={!compose.toUserId || !compose.content.trim() || sendMutation.isPending}
              onClick={() => sendMutation.mutate(compose)}>
              {sendMutation.isPending ? "Sending…" : <><Send className="w-4 h-4 mr-1.5" />Send</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}