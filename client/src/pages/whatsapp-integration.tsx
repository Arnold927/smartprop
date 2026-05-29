import { MediaUploader } from "@/components/ui/media-uploader";
import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useWsEvent } from "@/hooks/useWebSocket";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";
import { useRoleGuard, ROLES } from "@/hooks/useRoleGuard";

import {
  MessageCircle,
  Send,
  Users,
  Clock,
  CheckCircle,
  Settings,
  Phone,
  Zap,
  TrendingUp,
  AlertCircle,
  Plus,
  Play,
  Loader2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
  Tag,
  Trash2,
  Copy,
  Reply,
  MoreHorizontal,
  Eye,
  UserCheck,
  XCircle,
  ArrowDownCircle,
  Paperclip,
  ImageIcon,
  AlertTriangle,
  WifiOff,
  Smile,
  FileText,
  LayoutTemplate,
  ChevronUp,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type MessageType = "text" | "template" | "media";

interface WhatsAppMessage {
  id: number;
  to: string;
  type: MessageType;
  content: string;
  status: "sent" | "delivered" | "read" | "failed" | "attended";
  direction?: "outbound" | "inbound";
  timestamp: string | null;
  template_name?: string;
}

interface InboundMessage {
  id: number;
  from: string;
  content: string;
  status: string;
  direction: "inbound";
  timestamp: string | null;
}

/** A single message in a conversation thread (either direction) */
interface ThreadMessage {
  id: number;
  content: string;
  direction: "outbound" | "inbound";
  status: string;
  timestamp: string | null;
}

/** Grouped conversation indexed by phone number */
interface Conversation {
  phone: string;
  tenantName?: string;
  unitNumber?: string;
  lastMessageAt: string | null;
  unreadCount: number;
  messages: ThreadMessage[];
}

/** Lightweight sidebar row returned by GET /api/whatsapp/conversations */
interface ConversationSummary {
  phone: string;
  lastContent: string;
  lastDirection: string;
  lastAt: string | null;
  lastStatus: string;
  unreadCount: number;
}

interface WhatsAppTemplate {
  id: number;
  name: string;
  category: string;
  content: string;
  variables: string[] | null;
  status: "active" | "pending" | "rejected";
}

interface WhatsAppMetrics {
  messages_sent_today: number;
  messages_delivered: number;
  response_rate: number;
  active_templates: number;
  total_contacts: number;
  avg_response_time?: number; // tracked only when inbound message timestamps are available
}

interface Tenant {
  id: number;
  firstName: string;
  lastName: string;
  phone: string | null;
  unitNumber: string | null;
}

interface ConfigStatus {
  configured: boolean;
  missing: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const safeFormat = (ts: string | null | undefined) => {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? "—" : format(d, "MMM dd, HH:mm");
  } catch {
    return "—";
  }
};

const STATUS_META: Record<string, { color: string; label: string; icon: React.ReactNode }> = {
  sent:      { color: "bg-blue-100 text-blue-800",   label: "Sent",      icon: <Send        className="h-3 w-3 mr-1 inline" /> },
  delivered: { color: "bg-emerald-50 text-emerald-700 border border-emerald-200", label: "Delivered", icon: <CheckCircle className="h-3 w-3 mr-1 inline" /> },
  read:      { color: "bg-purple-100 text-purple-800",label: "Read",     icon: <Eye         className="h-3 w-3 mr-1 inline" /> },
  failed:    { color: "bg-red-100 text-red-800",     label: "Failed",    icon: <XCircle     className="h-3 w-3 mr-1 inline" /> },
  attended:  { color: "bg-teal-100 text-teal-800",   label: "Attended",  icon: <UserCheck   className="h-3 w-3 mr-1 inline" /> },
};

const CATEGORY_COLORS: Record<string, string> = {
  rent_reminder:        "bg-orange-100 text-orange-800",
  maintenance_update:   "bg-blue-100 text-blue-800",
  payment_confirmation: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  emergency_alert:      "bg-red-100 text-red-800",
  custom:               "bg-purple-100 text-purple-800",
};

const PAGE_SIZE_OPTIONS = [5, 10, 20, 50];

// Fix: type annotation ensures the literal union is preserved, not narrowed to "text"
const EMPTY_MESSAGE: {
  to: string; message: string; type: MessageType;
  template_name?: string; templateVariables: Record<string, string>;
  mediaUrl: string; mediaCaption: string;
} = {
  to: "", message: "", type: "text", template_name: undefined,
  templateVariables: {}, mediaUrl: "", mediaCaption: "",
};
const EMPTY_TEMPLATE = { name: "", category: "custom", content: "", variables: [] as string[] };

// ── Pagination bar ────────────────────────────────────────────────────────────

interface PaginationBarProps {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  onPageSizeChange: (s: number) => void;
}

function PaginationBar({ total, page, pageSize, onPageChange, onPageSizeChange }: PaginationBarProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-border">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Rows per page:</span>
        <Select
          value={String(pageSize)}
          onValueChange={(v) => { onPageSizeChange(Number(v)); onPageChange(1); }}
        >
          <SelectTrigger className="h-8 w-[70px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((s) => (
              <SelectItem key={s} value={String(s)}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span>{total === 0 ? "0 results" : `${start}–${end} of ${total}`}</span>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[60px] text-center font-medium text-foreground">{page} / {totalPages}</span>
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Search bar ────────────────────────────────────────────────────────────────

interface SearchBarProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

function SearchBar({ value, onChange, placeholder = "Search…" }: SearchBarProps) {
  return (
    <div className="relative w-full max-w-sm">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-8 pr-8 h-9"
      />
      {value && (
        <button
          onClick={() => onChange("")}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function WhatsAppIntegration() {
  const guard = useRoleGuard(ROLES.ADMIN_MANAGER);
  if (guard.gate) return guard.gate;

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [newMessage, setNewMessage]             = useState(EMPTY_MESSAGE);
  const [newTemplate, setNewTemplate]           = useState(EMPTY_TEMPLATE);
  const [isMessageModalOpen, setMessageModal]   = useState(false);
  const [isTemplateModalOpen, setTemplateModal] = useState(false);
  const [emergencyMsg, setEmergencyMsg]         = useState("");
  const [activeAutomation, setActiveAutomation] = useState<string | null>(null);

  // Selected template object (so we know which variables to ask for)
  const [selectedTemplate, setSelectedTemplate] = useState<WhatsAppTemplate | null>(null);
  // Bulk send preview step
  const [bulkStep, setBulkStep] = useState<"compose" | "preview">("compose");
  // Unread tracking — server-persisted: phone → ISO timestamp of last read
  // Initialised from GET /api/whatsapp/threads/reads on mount.
  // Updated optimistically on thread open; synced cross-tab/device via whatsapp:read WS event.
  const [readMap, setReadMap] = useState<Record<string, string>>({});

  useQuery<Record<string, string>>({
    queryKey: ["/api/whatsapp/thread-reads"],
    queryFn: async () => {
      const r = await apiRequest("/api/whatsapp/threads/reads");
      const data = await r.json();
      return typeof data === "object" && data !== null ? data : {};
    },
    staleTime: Infinity,           // only refresh via WS or mutation — reads don't change server-side without us
    onSuccess: (data: Record<string, string>) => setReadMap(data),
  } as any);

  // Derive the legacy Set shape the rest of the component uses
  const readPhones = useMemo(() => new Set(Object.keys(readMap)), [readMap]);

  // Mutation: PATCH /api/whatsapp/threads/:phone/read
  const markReadMutation = useMutation({
    mutationFn: async (phone: string) => {
      const r = await apiRequest(`/api/whatsapp/threads/${encodeURIComponent(phone)}/read`, {
        method: "PATCH",
      });
      if (!r.ok) throw new Error("mark-read failed");
      return r.json() as Promise<{ phone: string; lastReadAt: string }>;
    },
    onSuccess: (data) => {
      setReadMap(prev => ({ ...prev, [data.phone]: data.lastReadAt }));
    },
    // Failure is non-fatal — unread badge will just re-appear on refresh
  });

  // Real-time cross-tab/device sync: another session marked a thread read
  useWsEvent<{ userId: string; phone: string; lastReadAt: string }>(
    "whatsapp:read" as any,
    useCallback((payload) => {
      if (!payload?.phone || !payload?.lastReadAt) return;
      setReadMap(prev => {
        // Only update if newer than what we already have
        const existing = prev[payload.phone];
        if (existing && existing >= payload.lastReadAt) return prev;
        return { ...prev, [payload.phone]: payload.lastReadAt };
      });
    }, [])
  );
  // Config banner dismissed by user
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // ── Template variable builder state ──────────────────────────────────────
  const [varInput, setVarInput]       = useState("");
  const contentRef                    = useRef<HTMLTextAreaElement>(null);

  const addVariable = () => {
    const name = varInput.trim().replace(/\s+/g, "_").toLowerCase();
    if (!name) return;
    if (newTemplate.variables.includes(name)) {
      toast({ title: "Duplicate variable", description: `"${name}" is already in the list.`, variant: "destructive" });
      return;
    }
    setNewTemplate(p => ({ ...p, variables: [...p.variables, name] }));
    setVarInput("");
  };

  const removeVariable = (name: string) => {
    setNewTemplate(p => ({ ...p, variables: p.variables.filter(v => v !== name) }));
  };

  const insertVariable = (name: string) => {
    const tag = `{{${name}}}`;
    const el = contentRef.current;
    if (!el) {
      // Fallback: append at end
      setNewTemplate(p => ({ ...p, content: p.content + tag }));
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end   = el.selectionEnd   ?? el.value.length;
    const next  = el.value.slice(0, start) + tag + el.value.slice(end);
    setNewTemplate(p => ({ ...p, content: next }));
    // Restore cursor after the inserted tag
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + tag.length, start + tag.length);
    });
  };

  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [viewMessage, setViewMessage] = useState<{ to: string; content: string; timestamp: string } | null>(null);

  const deleteMessageMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await apiRequest(`/api/whatsapp/messages/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Failed to delete message");
    },
    onSuccess: () => {
      toast({ title: "Deleted", description: "Message removed from the log." });
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/metrics"] });
    },
    onError: () => {
      toast({ title: "Delete Failed", description: "Could not delete the message.", variant: "destructive" });
    },
  });

  const markAttendedMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await apiRequest(`/api/whatsapp/messages/${id}/status`, {
        method: "PATCH",
        data: { status: "attended" },
      });
      if (!r.ok) throw new Error("Failed to update status");
    },
    onSuccess: () => {
      toast({ title: "Marked as Attended", description: "Message status updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/messages"] });
    },
    onError: () => {
      toast({ title: "Update Failed", description: "Could not update message status.", variant: "destructive" });
    },
  });

  const handleCopyMessage = (id: number, content: string) => {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedId(id);
      toast({ title: "Copied", description: "Message content copied to clipboard." });
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const handleReply = (to: string) => {
    setNewMessage({ ...EMPTY_MESSAGE, to });
    setMessageModal(true);
  };


  const [msgPage, setMsgPage]           = useState(1);
  const [msgPageSize, setMsgPageSize]   = useState(10);
  const [tmplPage, setTmplPage]         = useState(1);
  const [tmplPageSize, setTmplPageSize] = useState(10);

  // ── Search state ──────────────────────────────────────────────────────────
  const [msgSearch, setMsgSearch]   = useState("");
  const [tmplSearch, setTmplSearch] = useState("");

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: metrics, isLoading: loadingMetrics } = useQuery<WhatsAppMetrics>({
    queryKey: ["/api/whatsapp/metrics"],
    queryFn: async () => {
      const r = await apiRequest("/api/whatsapp/metrics");
      return r.json();
    },
    refetchInterval: 60_000,   // poll every 60 s as a baseline
    staleTime:       30_000,
  });

  // Config status — fetched once on mount
  const { data: configStatus } = useQuery<ConfigStatus>({
    queryKey: ["/api/whatsapp/status"],
    queryFn: async () => {
      const r = await apiRequest("/api/whatsapp/status");
      return r.json();
    },
    staleTime: Infinity, // env vars don't change at runtime
  });

  const { data: messages = [], isLoading: loadingMessages, refetch: refetchMessages } = useQuery<WhatsAppMessage[]>({
    queryKey: ["/api/whatsapp/messages"],
    queryFn: async () => {
      const r = await apiRequest("/api/whatsapp/messages");
      const data = await r.json();
      return Array.isArray(data) ? data : [];
    },
  });

  const { data: templates = [], isLoading: loadingTemplates, refetch: refetchTemplates } = useQuery<WhatsAppTemplate[]>({
    queryKey: ["/api/whatsapp/templates"],
    queryFn: async () => {
      const r = await apiRequest("/api/whatsapp/templates");
      const data = await r.json();
      return Array.isArray(data) ? data : [];
    },
  });

  // ── Lightweight conversation list (sidebar) ────────────────────────────────
  // Replaces the old org-wide messages + inbox fetches that loaded up to 200
  // rows each just to render phone numbers and last-message previews.
  // The server returns one row per phone with only what the sidebar needs.
  const [inboxSearch, setInboxSearch] = useState("");

  const {
    data: conversationSummaries = [],
    isLoading: loadingConversations,
    refetch: refetchConversations,
  } = useQuery<ConversationSummary[]>({
    queryKey: ["/api/whatsapp/conversations"],
    queryFn: async () => {
      const r = await apiRequest("/api/whatsapp/conversations");
      const data = await r.json();
      return Array.isArray(data) ? data : [];
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  // Thin local cache of inbound messages received via WS this session.
  // Only used to append real-time arrivals to the active thread view —
  // NOT used to populate the sidebar (that's conversationSummaries now).
  const [inboxMessages, setInboxMessages] = useState<InboundMessage[]>([]);

  const handleInboxSearch = (v: string) => setInboxSearch(v);

  // ── Typing indicator state ────────────────────────────────────────────────
  const [typingPhone, setTypingPhone] = useState<string | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showTypingFor = useCallback((phone: string, durationMs = 2500) => {
    setTypingPhone(phone);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => setTypingPhone(null), durationMs);
  }, []);

  // ── Real-time inbox updates via WebSocket — optimistic cache append ────────
  useWsEvent<{ id: number; from: string; content: string; timestamp: string; status?: string }>(
    "whatsapp:inbound" as any,
    useCallback((payload) => {
      if (!payload?.id || !payload?.from) {
        queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/conversations"] });
        queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/messages"] });
        queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/metrics"] });
        return;
      }
      // Show typing bubble briefly before the message "arrives"
      showTypingFor(payload.from, 1200);
      setTimeout(() => {
        // Append to local inboxMessages state (used only for active-thread real-time append)
        setInboxMessages(prev => {
          if (prev.some(m => m.id === payload.id)) return prev;
          const newMsg: InboundMessage = {
            id: payload.id,
            from: payload.from,
            content: payload.content,
            status: payload.status ?? "received",
            direction: "inbound",
            timestamp: payload.timestamp ?? new Date().toISOString(),
          };
          return [newMsg, ...prev];
        });
        // Refresh the sidebar conversation list so the last-message preview updates
        queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/conversations"] });
        queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/metrics"] });
      }, 1200);
    }, [queryClient, showTypingFor])
  );

  // ── Real-time delivery/read status updates from Meta webhook ──────────────
  // Meta fires sent → delivered → read callbacks; the server processes them,
  // updates the DB, and pushes this event so tick marks update instantly.
  useWsEvent<{ messageId: number; metaId: string; status: string; phone: string; timestamp: string }>(
    "whatsapp:status" as any,
    useCallback((payload) => {
      if (!payload?.messageId || !payload?.status) return;

      // Patch the messages list cache in-place — no refetch needed
      queryClient.setQueryData<WhatsAppMessage[]>(["/api/whatsapp/messages"], (prev = []) =>
        prev.map(m =>
          m.id === payload.messageId
            ? { ...m, status: payload.status as WhatsAppMessage["status"] }
            : m
        )
      );

      // Also patch local inboxMessages for status ticks on inbound messages
      setInboxMessages(prev =>
        prev.map(m =>
          m.id === payload.messageId ? { ...m, status: payload.status } : m
        )
      );
    }, [queryClient])
  );

  // ── Conversation threading ────────────────────────────────────────────────
  const [activeThread, setActiveThread] = useState<string | null>(null); // phone number
  const threadBottomRef = useRef<HTMLDivElement>(null);


  const { data: tenants = [] } = useQuery<Tenant[]>({
    queryKey: ["/api/tenants-for-bulk"],
    queryFn: async () => {
      const r = await apiRequest("/api/tenants?limit=100&page=1");
      const d = await r.json();
      // Endpoint returns { results: [...], count, page, limit }
      const rows = Array.isArray(d) ? d : (d.results ?? []);
      return rows;
    },
    staleTime: 5 * 60_000, // tenant list changes rarely
  });

  /** Build sidebar conversation list from the lightweight server summary.
   *  The `messages` array (from the Sent tab query) is no longer iterated here —
   *  the server already aggregated everything we need in one SQL query. */
  const conversations = useMemo((): Conversation[] => {
    return conversationSummaries.map(s => {
      const tenant = tenants.find(t =>
        t.phone === s.phone || t.phone?.replace(/^\+/, "") === s.phone.replace(/^\+/, "")
      );
      const unread = readPhones.has(s.phone) ? 0 : s.unreadCount;
      return {
        phone: s.phone,
        unitNumber: tenant?.unitNumber ?? undefined,
        lastMessageAt: s.lastAt,
        unreadCount: unread,
        messages: [{
          id: -1,                          // placeholder — real messages load per-thread
          content: s.lastContent,
          direction: s.lastDirection as "outbound" | "inbound",
          status: s.lastStatus,
          timestamp: s.lastAt,
        }],
      };
    });
  }, [conversationSummaries, readPhones, tenants]);

  const activeConversation = useMemo(
    () => conversations.find(c => c.phone === activeThread) ?? null,
    [conversations, activeThread]
  );

  // ── Per-thread paginated message fetch ────────────────────────────────────
  // We keep a stack of "pages" — each page is an array of ThreadMessages fetched
  // with a `before` cursor (lowest ID seen so far). Page 0 = most recent batch.
  const THREAD_PAGE_SIZE = 30;

  const [threadPages, setThreadPages]     = useState<ThreadMessage[][]>([]);
  const [threadBefore, setThreadBefore]   = useState<number | null>(null); // oldest ID fetched
  const [threadHasMore, setThreadHasMore] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const threadScrollRef  = useRef<HTMLDivElement>(null);
  const threadSentinelRef = useRef<HTMLDivElement>(null);

  /** Reset thread pages whenever we switch to a different conversation */
  useEffect(() => {
    setThreadPages([]);
    setThreadBefore(null);
    setThreadHasMore(true);
  }, [activeThread]);

  /** Fetch one page of thread messages (both directions) for the active phone */
  const fetchThreadPage = useCallback(async (phone: string, before: number | null) => {
    if (threadLoading) return;
    setThreadLoading(true);
    try {
      const qs = new URLSearchParams({
        phone,
        limit: String(THREAD_PAGE_SIZE),
        ...(before ? { before: String(before) } : {}),
      });

      // Fetch both outbound (messages) and inbound (inbox) in parallel
      const [outRes, inRes] = await Promise.all([
        apiRequest(`/api/whatsapp/messages?${qs}`),
        apiRequest(`/api/whatsapp/inbox?${qs}`),
      ]);

      const [outData, inData] = await Promise.all([
        outRes.json() as Promise<WhatsAppMessage[]>,
        inRes.json()  as Promise<InboundMessage[]>,
      ]);

      const outMsgs: ThreadMessage[] = (Array.isArray(outData) ? outData : []).map(m => ({
        id: m.id, content: m.content,
        direction: (m.direction ?? "outbound") as "outbound" | "inbound",
        status: m.status, timestamp: m.timestamp,
      }));
      const inMsgs: ThreadMessage[] = (Array.isArray(inData) ? inData : []).map(m => ({
        id: m.id, content: m.content,
        direction: "inbound" as const,
        status: m.status, timestamp: m.timestamp,
      }));

      const combined = [...outMsgs, ...inMsgs]
        .sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? ""));

      if (combined.length < THREAD_PAGE_SIZE) setThreadHasMore(false);

      const oldestId = combined.length > 0
        ? Math.min(...combined.map(m => m.id))
        : null;

      setThreadPages(prev => [combined, ...prev]); // prepend older page
      setThreadBefore(oldestId);
    } catch {
      // swallow — the global error toast in the mutation covers failures
    } finally {
      setThreadLoading(false);
    }
  }, [threadLoading]);

  /** Trigger initial page load when switching threads */
  useEffect(() => {
    if (activeThread) {
      fetchThreadPage(activeThread, null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThread]);

  /** IntersectionObserver on the top sentinel — load more when visible */
  useEffect(() => {
    const sentinel = threadSentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && activeThread && threadHasMore && !threadLoading) {
          // Capture scroll height before prepend so we can restore position
          const scroller = threadScrollRef.current;
          const prevScrollHeight = scroller?.scrollHeight ?? 0;

          fetchThreadPage(activeThread, threadBefore).then(() => {
            if (scroller) {
              // After React re-renders the prepended messages, restore position
              requestAnimationFrame(() => {
                scroller.scrollTop = scroller.scrollHeight - prevScrollHeight;
              });
            }
          });
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [activeThread, threadHasMore, threadLoading, threadBefore, fetchThreadPage]);

  /** Flat sorted list of all fetched thread messages (deduped by id) */
  const threadMessages = useMemo(() => {
    const seen = new Set<number>();
    const all: ThreadMessage[] = [];
    for (const page of threadPages) {
      for (const msg of page) {
        if (!seen.has(msg.id)) { seen.add(msg.id); all.push(msg); }
      }
    }
    // Patch status from real-time WS updates already in the global caches
    return all
      .map(msg => {
        const live = messages.find(m => m.id === msg.id);
        return live ? { ...msg, status: live.status } : msg;
      })
      .sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? ""));
  }, [threadPages, messages]);

  /** When a new real-time inbound message arrives for the active thread, append it */
  useEffect(() => {
    if (!activeThread) return;
    const latest = inboxMessages
      .filter(m => {
        const norm = (p: string) => p.replace(/^\+/, "");
        return norm(m.from) === norm(activeThread);
      })
      .sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""));
    if (!latest.length) return;
    const newest = latest[0];
    setThreadPages(prev => {
      // Only append if not already present
      const alreadyIn = prev.some(page => page.some(m => m.id === newest.id));
      if (alreadyIn) return prev;
      const appended: ThreadMessage = {
        id: newest.id, content: newest.content,
        direction: "inbound", status: newest.status,
        timestamp: newest.timestamp,
      };
      if (prev.length === 0) return [[appended]];
      const lastPage = [...prev[prev.length - 1], appended];
      return [...prev.slice(0, -1), lastPage];
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inboxMessages, activeThread]);

  // ── Inline reply: rich compose bar state ─────────────────────────────────
  const [inlineReply, setInlineReply]           = useState("");
  const [inlineType, setInlineType]             = useState<MessageType>("text");
  const [inlineMediaUrl, setInlineMediaUrl]     = useState("");
  const [inlineMediaCaption, setInlineMediaCaption] = useState("");
  const [inlineTemplate, setInlineTemplate]     = useState<WhatsAppTemplate | null>(null);
  const [inlineTemplateVars, setInlineTemplateVars] = useState<Record<string, string>>({});
  /** null = closed, "template" | "media" | "emoji" = which panel is open */
  const [inlinePanel, setInlinePanel]           = useState<"template" | "media" | "emoji" | null>(null);

  const inlineReplyRef  = useRef<HTMLTextAreaElement>(null);
  const typingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A small palette of commonly useful emojis for property comms
  const QUICK_EMOJIS = ["👍","✅","🙏","🏠","📋","📅","💰","🔧","⚠️","📞","✉️","🎉","🕐","🔑","💡","📌"];

  const resetInlineCompose = () => {
    setInlineReply("");
    setInlineType("text");
    setInlineMediaUrl("");
    setInlineMediaCaption("");
    setInlineTemplate(null);
    setInlineTemplateVars({});
    setInlinePanel(null);
  };

  // Tracks the temp ID of the current in-flight optimistic message so we can
  // promote it to confirmed (onSuccess) or mark it failed (onError).
  const optimisticIdRef = useRef<number | null>(null);

  const inlineReplyMutation = useMutation({
    mutationFn: async (payload: {
      to: string;
      type: MessageType;
      message: string;
      templateName?: string;
      variables?: Record<string, string>;
      mediaUrl?: string;
      mediaCaption?: string;
    }) => {
      const r = await apiRequest("/api/whatsapp/send", {
        method: "POST",
        data: {
          to: payload.to,
          message: payload.message.trim(),
          type: payload.type,
          templateName: payload.templateName,
          variables: payload.variables && Object.keys(payload.variables).length > 0 ? payload.variables : undefined,
          mediaUrl: payload.type === "media" ? payload.mediaUrl?.trim() : undefined,
          mediaCaption: payload.type === "media" ? payload.mediaCaption?.trim() : undefined,
        },
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as any).message || "Send failed");
      }
      return r.json();
    },
    onMutate: (payload) => {
      // Insert a "pending" bubble immediately so the user sees their message
      // in the thread before the network round-trip completes.
      const tempId = -(Date.now()); // negative = local-only, never clashes with server IDs
      optimisticIdRef.current = tempId;
      const optimistic: ThreadMessage = {
        id: tempId,
        content: payload.message.trim() || payload.mediaUrl || "",
        direction: "outbound",
        status: "pending" as any,
        timestamp: new Date().toISOString(),
      };
      setThreadPages(prev => {
        if (prev.length === 0) return [[optimistic]];
        const lastPage = [...prev[prev.length - 1], optimistic];
        return [...prev.slice(0, -1), lastPage];
      });
      resetInlineCompose();
      setTimeout(() => threadBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 60);
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/conversations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/metrics"] });
      // Replace the temp bubble with the confirmed server message
      const tempId = optimisticIdRef.current;
      optimisticIdRef.current = null;
      if (tempId !== null) {
        const confirmed: ThreadMessage = {
          id: data?.id ?? tempId,
          content: data?.content ?? data?.message ?? "",
          direction: "outbound",
          status: data?.status ?? "sent",
          timestamp: data?.timestamp ?? new Date().toISOString(),
        };
        setThreadPages(prev =>
          prev.map(page => page.map(m => (m.id === tempId ? confirmed : m)))
        );
      }
      setTimeout(() => threadBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    },
    onError: (err: Error) => {
      // Transition the optimistic bubble to "failed" so it stays visible with
      // a retry affordance — the user can click Retry to resend.
      const tempId = optimisticIdRef.current;
      optimisticIdRef.current = null;
      if (tempId !== null) {
        setThreadPages(prev =>
          prev.map(page =>
            page.map(m => (m.id === tempId ? { ...m, status: "failed" as any } : m))
          )
        );
      }
      toast({ title: "Send Failed", description: err.message, variant: "destructive" });
    },
  });

  const handleInlineSend = () => {
    if (!activeThread) return;

    if (inlineType === "media") {
      if (!inlineMediaUrl.trim()) {
        toast({ title: "Missing media URL", description: "Paste a publicly accessible URL before sending.", variant: "destructive" });
        return;
      }
      inlineReplyMutation.mutate({
        to: activeThread,
        type: "media",
        message: inlineMediaCaption || inlineMediaUrl,
        mediaUrl: inlineMediaUrl,
        mediaCaption: inlineMediaCaption,
      });
      return;
    }

    if (inlineType === "template") {
      if (!inlineTemplate) {
        toast({ title: "No template selected", description: "Choose a template first.", variant: "destructive" });
        return;
      }
      inlineReplyMutation.mutate({
        to: activeThread,
        type: "template",
        message: inlineTemplate.content,
        templateName: inlineTemplate.name,
        variables: inlineTemplateVars,
      });
      return;
    }

    // text
    if (!inlineReply.trim()) return;
    inlineReplyMutation.mutate({ to: activeThread, type: "text", message: inlineReply });
  };

  /** Retry a failed message: remove the failed bubble then re-send its content */
  const handleRetryMessage = (msg: ThreadMessage) => {
    if (!activeThread) return;
    // Remove the failed bubble
    setThreadPages(prev =>
      prev.map(page => page.filter(m => m.id !== msg.id))
    );
    inlineReplyMutation.mutate({ to: activeThread, type: "text", message: msg.content });
  };

  // ── Unread count in browser tab title ────────────────────────────────────
  const totalUnread = useMemo(
    () => conversations.reduce((sum, c) => sum + (readPhones.has(c.phone) ? 0 : c.unreadCount), 0),
    [conversations, readPhones]
  );

  useEffect(() => {
    const base = "WhatsApp – SmartProp";
    document.title = totalUnread > 0 ? `(${totalUnread}) ${base}` : base;
    return () => { document.title = base; };
  }, [totalUnread]);

  // Mark thread as read when opened — persists to server and syncs cross-device
  // Also reset compose bar so carry-over state from previous thread doesn't leak
  useEffect(() => {
    if (activeThread) {
      // Optimistic local update so the unread badge clears instantly
      setReadMap(prev => {
        if (prev[activeThread]) return prev;
        return { ...prev, [activeThread]: new Date().toISOString() };
      });
      // Persist to server (fire-and-forget; failure is non-fatal)
      markReadMutation.mutate(activeThread);
      resetInlineCompose();
      // Scroll to bottom after the initial page fetch resolves (async, ~200ms)
      setTimeout(() => threadBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 300);
      // Focus the inline reply input
      setTimeout(() => inlineReplyRef.current?.focus(), 80);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThread]);

  // ── Filtered + paginated slices ───────────────────────────────────────────

  const [msgStatusFilter, setMsgStatusFilter] = useState<string>("all");
  const handleMsgStatusFilter = (status: string) => { setMsgStatusFilter(status); setMsgPage(1); };

  const filteredMessages = useMemo(() => {
    const q = msgSearch.trim().toLowerCase();
    return messages.filter(m => {
      const matchesStatus = msgStatusFilter === "all" || m.status === msgStatusFilter;
      const matchesSearch = !q ||
        m.to.toLowerCase().includes(q) ||
        m.content.toLowerCase().includes(q) ||
        m.type.toLowerCase().includes(q) ||
        m.status.toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [messages, msgSearch, msgStatusFilter]);

  const filteredTemplates = useMemo(() => {
    const q = tmplSearch.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q) ||
      t.content.toLowerCase().includes(q) ||
      t.status.toLowerCase().includes(q)
    );
  }, [templates, tmplSearch]);

  const pagedMessages  = filteredMessages.slice((msgPage - 1)  * msgPageSize,  msgPage  * msgPageSize);
  const pagedTemplates = filteredTemplates.slice((tmplPage - 1) * tmplPageSize, tmplPage * tmplPageSize);

  const handleMsgSearch  = (v: string) => { setMsgSearch(v);  setMsgPage(1); };
  const handleTmplSearch = (v: string) => { setTmplSearch(v); setTmplPage(1); };
  const handleMsgPageSize  = (s: number) => { setMsgPageSize(s);  setMsgPage(1); };
  const handleTmplPageSize = (s: number) => { setTmplPageSize(s); setTmplPage(1); };

  // ── Bulk send state ───────────────────────────────────────────────────────
  const [isBulkModalOpen, setBulkModal]       = useState(false);
  const [bulkMessage, setBulkMessage]         = useState("");
  const [bulkType, setBulkType]               = useState<MessageType>("text");
  const [selectedPhones, setSelectedPhones]   = useState<Set<string>>(new Set());
  const [manualPhone, setManualPhone]         = useState("");
  const [contactSearch, setContactSearch]     = useState("");

  

  /** Fast phone → display name lookup used across the page */
  const phoneToName = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tenants) {
      if (!t.phone) continue;
      const name = `${t.firstName} ${t.lastName}`.trim();
      const label = t.unitNumber ? `${name} · Unit ${t.unitNumber}` : name;
      // Index both with and without leading + so we match regardless of format
      map.set(t.phone, label);
      map.set(t.phone.replace(/^\+/, ""), label);
    }
    return map;
  }, [tenants]);

  const resolveName = (phone: string): string =>
    phoneToName.get(phone) ?? phoneToName.get(phone.replace(/^\+/, "")) ?? phone;

  const tenantsWithPhone = useMemo(() =>
    tenants.filter(t => t.phone),
  [tenants]);

  const filteredContacts = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    if (!q) return tenantsWithPhone;
    return tenantsWithPhone.filter(t =>
      `${t.firstName} ${t.lastName}`.toLowerCase().includes(q) ||
      (t.phone ?? "").includes(q)
    );
  }, [tenantsWithPhone, contactSearch]);

  const togglePhone = (phone: string) => {
    setSelectedPhones(prev => {
      const next = new Set(prev);
      next.has(phone) ? next.delete(phone) : next.add(phone);
      return next;
    });
  };

  const toggleAll = () => {
    const allPhones = filteredContacts.map(t => t.phone!);
    const allSelected = allPhones.every(p => selectedPhones.has(p));
    setSelectedPhones(prev => {
      const next = new Set(prev);
      allPhones.forEach(p => allSelected ? next.delete(p) : next.add(p));
      return next;
    });
  };

  // Kenyan E.164: +254 followed by 9 digits (07xx → +2547xx, 01xx → +2541xx).
  // Accepts +2547XXXXXXXX, +2541XXXXXXXX, or bare 07/01 which we normalise.
  const normalisePhone = (raw: string): string | null => {
    const s = raw.replace(/\s+/g, "");
    // Already E.164
    if (/^\+254[17]\d{8}$/.test(s)) return s;
    // Local format: 07xx or 01xx
    if (/^0[17]\d{8}$/.test(s)) return "+254" + s.slice(1);
    return null;
  };

  const addManualPhone = () => {
    const raw = manualPhone.trim();
    if (!raw) return;
    const normalised = normalisePhone(raw);
    if (!normalised) {
      toast({
        title: "Invalid phone number",
        description: "Enter a Kenyan number: +2547XXXXXXXX, +2541XXXXXXXX, or 07/01XXXXXXXX.",
        variant: "destructive",
      });
      return;
    }
    setSelectedPhones(prev => new Set(prev).add(normalised));
    setManualPhone("");
  };

  const bulkSendMutation = useMutation({
    mutationFn: async () => {
      const phones = Array.from(selectedPhones);
      const r = await apiRequest("/api/whatsapp/bulk", {
        method: "POST",
        data: { phones, message: bulkMessage.trim(), type: bulkType },
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as any).message || "Bulk send failed");
      }
      return r.json() as Promise<{ successful: number; failed: number }>;
    },
    onSuccess: (result) => {
      toast({
        title: "Bulk Send Complete",
        description: `${result.successful} sent, ${result.failed} failed.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/metrics"] });
      setBulkModal(false);
      setBulkMessage("");
      setSelectedPhones(new Set());
      setContactSearch("");
      setBulkStep("compose");
    },
    onError: (err: Error) => {
      toast({ title: "Bulk Send Failed", description: err.message, variant: "destructive" });
    },
  });

  const handleBulkSend = () => {
    if (selectedPhones.size === 0) {
      toast({ title: "No recipients", description: "Select at least one contact.", variant: "destructive" });
      return;
    }
    if (!bulkMessage.trim()) {
      toast({ title: "Missing message", description: "Please enter a message.", variant: "destructive" });
      return;
    }
    // Show preview step before firing
    setBulkStep("preview");
  };

  const confirmBulkSend = () => {
    bulkSendMutation.mutate();
  };

  // ── Mutations ─────────────────────────────────────────────────────────────

  const sendMessageMutation = useMutation({
    mutationFn: async (payload: typeof EMPTY_MESSAGE) => {
      const r = await apiRequest("/api/whatsapp/send", {
        method: "POST",
        data: {
          to: payload.to.trim(),
          message: payload.message.trim(),
          type: payload.type,
          templateName: payload.template_name,
          variables: Object.keys(payload.templateVariables).length > 0 ? payload.templateVariables : undefined,
          mediaUrl: payload.type === "media" ? payload.mediaUrl.trim() : undefined,
          mediaCaption: payload.type === "media" ? payload.mediaCaption.trim() : undefined,
        },
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as any).message || "Send failed");
      }
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Message Sent", description: "WhatsApp message sent successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/metrics"] });
      setMessageModal(false);
      setNewMessage(EMPTY_MESSAGE);
      setSelectedTemplate(null);
    },
    onError: (err: Error) => {
      toast({ title: "Send Failed", description: err.message, variant: "destructive" });
    },
  });

  const createTemplateMutation = useMutation({
    mutationFn: async (payload: typeof EMPTY_TEMPLATE) => {
      const extracted = [...payload.content.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]);
      const variables = extracted.length > 0 ? extracted : payload.variables;
      const r = await apiRequest("/api/whatsapp/templates", {
        method: "POST",
        data: { name: payload.name.trim(), category: payload.category, content: payload.content.trim(), variables },
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as any).message || "Creation failed");
      }
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Template Created", description: "WhatsApp template created successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/templates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/metrics"] });
      setTemplateModal(false);
      setNewTemplate(EMPTY_TEMPLATE);
      setVarInput("");
    },
    onError: (err: Error) => {
      toast({ title: "Creation Failed", description: err.message, variant: "destructive" });
    },
  });

  const sendAutomatedMutation = useMutation({
    mutationFn: async (data: { type: string; customMessage?: string }) => {
      const r = await apiRequest("/api/whatsapp/automated", {
        method: "POST",
        data: { type: data.type, recipients: [], customMessage: data.customMessage },
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as any).message || "Automated send failed");
      }
      return r.json() as Promise<{ sent: number; failed: number; type: string }>;
    },
    onSuccess: (result) => {
      toast({
        title: "Notifications Sent",
        description: `${result.sent} message${result.sent !== 1 ? "s" : ""} sent${result.failed > 0 ? `, ${result.failed} failed` : ""}.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/metrics"] });
      setActiveAutomation(null);
      setEmergencyMsg("");
    },
    onError: (err: Error) => {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
      setActiveAutomation(null);
    },
  });

  const triggerAutomation = (type: string, customMessage?: string) => {
    setActiveAutomation(type);
    sendAutomatedMutation.mutate({ type, customMessage });
  };

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleSendMessage = () => {
    if (!newMessage.to.trim()) {
      toast({ title: "Missing Phone Number", description: "Please enter a phone number.", variant: "destructive" });
      return;
    }
    if (newMessage.type === "media") {
      if (!newMessage.mediaUrl.trim()) {
        toast({ title: "Missing Media", description: "Upload a file or paste a public URL before sending.", variant: "destructive" });
        return;
      }
      // For media sends, message carries the caption (or falls back to the URL so the field is never blank)
      if (!newMessage.message.trim()) {
        setNewMessage(p => ({ ...p, message: p.mediaUrl }));
      }
    } else if (!newMessage.message.trim()) {
      toast({ title: "Missing Message", description: "Please enter a message.", variant: "destructive" });
      return;
    }
    sendMessageMutation.mutate({ ...newMessage, message: newMessage.message.trim() || newMessage.mediaUrl });
  };

  const handleCreateTemplate = () => {
    if (!newTemplate.name.trim()) {
      toast({ title: "Missing Name", description: "Please enter a template name.", variant: "destructive" });
      return;
    }
    if (!newTemplate.content.trim()) {
      toast({ title: "Missing Content", description: "Please enter the template content.", variant: "destructive" });
      return;
    }
    createTemplateMutation.mutate(newTemplate);
  };

  // ── KPI values ────────────────────────────────────────────────────────────

  const kpis = [
    { label: "Messages Today",   value: metrics?.messages_sent_today ?? "—",              icon: Send,          color: "text-blue-600" },
    { label: "Delivered",        value: metrics?.messages_delivered ?? "—",                icon: CheckCircle,   color: "text-green-600" },
    { label: "Response Rate",    value: metrics ? `${metrics.response_rate}%` : "—",      icon: TrendingUp,    color: "text-purple-600" },
    { label: "Active Templates", value: metrics?.active_templates ?? "—",                 icon: MessageCircle, color: "text-orange-600" },
    { label: "Total Contacts",   value: metrics?.total_contacts ?? "—",                   icon: Users,         color: "text-indigo-600" },
    { label: "Avg Response",     value: metrics?.avg_response_time != null ? `${metrics.avg_response_time}m` : "N/A", icon: Clock, color: "text-muted-foreground" },
  ];

  // ── Render ────────────────────────────────────────────────────────────────



  return (
    <div className="p-6 space-y-6">

      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">WhatsApp Business Integration</h1>
          <p className="text-muted-foreground mt-1">
            Send automated notifications and manage WhatsApp communications with tenants and landlords
          </p>
        </div>
        <div className="flex gap-2">

          {/* Send Message dialog */}
          <Dialog open={isMessageModalOpen} onOpenChange={setMessageModal}>
            <DialogTrigger asChild>
              <Button className="bg-emerald-600 hover:bg-emerald-700 text-white">
                <Send className="h-4 w-4 mr-2" />Send Message
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Send WhatsApp Message</DialogTitle>
                <DialogDescription>Send a direct WhatsApp message to a contact</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                {/* Phone */}
                <div>
                  <Label htmlFor="phone">Phone Number <span className="text-red-500">*</span></Label>
                  <Input
                    id="phone"
                    placeholder="+254759657590"
                    value={newMessage.to}
                    onChange={e => setNewMessage(p => ({ ...p, to: e.target.value }))}
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Include country code, e.g. +254…</p>
                </div>

                {/* Message type */}
                <div>
                  <Label htmlFor="msg-type">Message Type</Label>
                  <Select
                    value={newMessage.type}
                    onValueChange={v => {
                      setNewMessage(p => ({ ...p, type: v as MessageType, templateVariables: {}, mediaUrl: "", mediaCaption: "" }));
                      if (v !== "template") setSelectedTemplate(null);
                    }}
                  >
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="text">Text</SelectItem>
                      <SelectItem value="template">Template</SelectItem>
                      <SelectItem value="media">Media (image / document)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* ── TEXT / TEMPLATE: message body ── */}
                {newMessage.type !== "media" && (
                  <div>
                    <Label htmlFor="msg-content">Message <span className="text-red-500">*</span></Label>
                    <Textarea
                      id="msg-content"
                      placeholder={newMessage.type === "template" ? "Template content (loaded from template)…" : "Enter your message…"}
                      rows={4}
                      value={newMessage.message}
                      onChange={e => setNewMessage(p => ({ ...p, message: e.target.value }))}
                      className="mt-1 font-mono text-sm"
                      readOnly={newMessage.type === "template" && !!selectedTemplate}
                    />
                  </div>
                )}

                {/* ── TEMPLATE: variable fields ── */}
                {newMessage.type === "template" && selectedTemplate && (selectedTemplate.variables ?? []).length > 0 && (
                  <div className="rounded-lg border border-dashed border-border p-3 space-y-3">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Fill template variables</p>
                    {(selectedTemplate.variables ?? []).map(varName => (
                      <div key={varName}>
                        <Label htmlFor={`var-${varName}`} className="text-xs">
                          <span className="font-mono bg-blue-50 text-blue-700 px-1 rounded">{`{{${varName}}}`}</span>
                        </Label>
                        <Input
                          id={`var-${varName}`}
                          placeholder={`Value for ${varName}…`}
                          value={newMessage.templateVariables[varName] ?? ""}
                          onChange={e => setNewMessage(p => ({
                            ...p,
                            templateVariables: { ...p.templateVariables, [varName]: e.target.value },
                          }))}
                          className="mt-1 h-8 text-sm"
                        />
                      </div>
                    ))}
                    {/* Live preview with variables substituted */}
                    <div className="rounded-md bg-muted p-2.5 text-xs text-muted-foreground leading-relaxed">
                      <span className="font-medium text-foreground block mb-1">Preview:</span>
                      {(selectedTemplate.variables ?? []).reduce(
                        (txt, v) => txt.replaceAll(`{{${v}}}`, newMessage.templateVariables[v] || `[${v}]`),
                        newMessage.message
                      )}
                    </div>
                  </div>
                )}

                {/* ── MEDIA: uploader + caption ── */}
                {newMessage.type === "media" && (
                  <div className="space-y-3">
                    <div>
                      <Label>
                        <Paperclip className="h-3.5 w-3.5 inline mr-1" />
                        Attach file
                      </Label>
                      <MediaUploader
                        className="mt-1"
                        onUploaded={(url) => setNewMessage(p => ({ ...p, mediaUrl: url, message: p.mediaCaption || url }))}
                        onClear={() => setNewMessage(p => ({ ...p, mediaUrl: "", message: "" }))}
                      />
                    </div>
                    {/* Manual URL fallback — shown always so power users aren't blocked */}
                    <div>
                      <Label htmlFor="media-url" className="text-xs text-muted-foreground">
                        Or paste a public URL directly
                      </Label>
                      <Input
                        id="media-url"
                        placeholder="https://example.com/image.jpg or document.pdf"
                        value={newMessage.mediaUrl}
                        onChange={e => setNewMessage(p => ({ ...p, mediaUrl: e.target.value }))}
                        className="mt-1 text-sm font-mono"
                      />
                    </div>
                    <div>
                      <Label htmlFor="media-caption">Caption <span className="text-muted-foreground">(optional)</span></Label>
                      <Textarea
                        id="media-caption"
                        placeholder="Add a caption for the media…"
                        rows={2}
                        value={newMessage.mediaCaption}
                        onChange={e => setNewMessage(p => ({ ...p, mediaCaption: e.target.value, message: e.target.value || p.mediaUrl }))}
                        className="mt-1 text-sm"
                      />
                    </div>
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => { setMessageModal(false); setSelectedTemplate(null); }} disabled={sendMessageMutation.isPending}>Cancel</Button>
                <Button onClick={handleSendMessage} disabled={sendMessageMutation.isPending} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                  {sendMessageMutation.isPending
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sending…</>
                    : <><Send className="h-4 w-4 mr-2" />Send</>}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Bulk Send dialog */}
          <Dialog open={isBulkModalOpen} onOpenChange={open => { setBulkModal(open); if (!open) { setSelectedPhones(new Set()); setBulkMessage(""); setContactSearch(""); setManualPhone(""); } }}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Users className="h-4 w-4 mr-2" />Bulk Send
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl w-[90vw] p-0 overflow-hidden">
              <div className="flex flex-col max-h-[85vh]">
                {/* Header */}
                <div className="px-6 pt-6 pb-4 shrink-0 border-b border-border">
                  <h2 className="text-lg font-semibold leading-none tracking-tight">Bulk Send WhatsApp Message</h2>
                  <p className="text-sm text-muted-foreground mt-1.5">Select contacts and type your message. All selected numbers will receive the same message.</p>
                </div>

                {/* Scrollable body */}
                <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0">
                <div className="grid grid-cols-2 gap-4">

                {/* Left — contact picker */}
                <div className="flex flex-col gap-2 overflow-hidden">
                  <Label>Select Contacts</Label>
                  <Input
                    placeholder="Search by name or number…"
                    value={contactSearch}
                    onChange={e => setContactSearch(e.target.value)}
                  />
                  {/* Select all row */}
                  {filteredContacts.length > 0 && (
                    <button
                      onClick={toggleAll}
                      className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground px-1"
                    >
                      <input
                        type="checkbox"
                        readOnly
                        checked={filteredContacts.every(t => selectedPhones.has(t.phone!))}
                        className="rounded"
                      />
                      Select all ({filteredContacts.length})
                    </button>
                  )}
                  {/* Contact list */}
                  <div className="overflow-y-auto flex-1 border rounded-lg divide-y max-h-52">
                    {filteredContacts.length === 0 ? (
                      <p className="text-center text-sm text-muted-foreground py-6">No contacts with phone numbers found</p>
                    ) : filteredContacts.map(t => (
                      <label key={t.id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedPhones.has(t.phone!)}
                          onChange={() => togglePhone(t.phone!)}
                          className="rounded"
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{t.firstName} {t.lastName}</p>
                          <p className="text-xs text-muted-foreground font-mono">{t.phone}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                  {/* Manual number entry */}
                  <div className="flex gap-2 mt-1">
                    <Input
                      placeholder="+254… (manual)"
                      value={manualPhone}
                      onChange={e => setManualPhone(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && addManualPhone()}
                      className="text-sm"
                    />
                    <Button size="sm" variant="outline" onClick={addManualPhone}>Add</Button>
                  </div>
                </div>

                {/* Right — message + selected summary */}
                <div className="flex flex-col gap-3 overflow-hidden">
                  {/* Selected chips */}
                  <div>
                    <Label>Selected ({selectedPhones.size})</Label>
                    <div className="flex flex-wrap gap-1 mt-1 max-h-24 overflow-y-auto border rounded-lg p-2 min-h-[2.5rem]">
                      {selectedPhones.size === 0
                        ? <span className="text-xs text-muted-foreground">No contacts selected yet</span>
                        : Array.from(selectedPhones).map(p => (
                          <span key={p} className="inline-flex items-center gap-1 bg-blue-100 text-blue-800 text-xs rounded-full px-2 py-0.5">
                            {p}
                            <button onClick={() => togglePhone(p)} className="hover:text-blue-600">
                              <XCircle className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                    </div>
                  </div>
                  {/* Message type */}
                  <div>
                    <Label>Message Type</Label>
                    <Select value={bulkType} onValueChange={v => setBulkType(v as MessageType)}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="text">Text</SelectItem>
                        <SelectItem value="template">Template</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {/* Message body */}
                  <div className="flex-1 flex flex-col">
                    <Label>Message <span className="text-red-500">*</span></Label>
                    <Textarea
                      placeholder="Type your message here…"
                      className="mt-1 flex-1 resize-none"
                      rows={6}
                      value={bulkMessage}
                      onChange={e => setBulkMessage(e.target.value)}
                    />
                  </div>
                </div>
                </div>{/* end grid */}

                {/* ── Preview step overlay — covers the scrollable body ── */}
                {bulkStep === "preview" && (
                  <div className="absolute inset-x-0 inset-y-0 z-10 bg-background flex flex-col gap-4 px-6 py-5 overflow-y-auto">
                    <div className="flex items-center gap-2 text-amber-600">
                      <AlertTriangle className="h-5 w-5 shrink-0" />
                      <h3 className="font-semibold">Confirm Bulk Send</h3>
                    </div>
                    <div className="space-y-3 flex-1 overflow-y-auto">
                      <div className="rounded-xl border border-slate-100 shadow-sm p-3 space-y-1">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Message</p>
                        <p className="text-sm whitespace-pre-wrap break-words">{bulkMessage}</p>
                      </div>
                      <div className="rounded-xl border border-slate-100 shadow-sm p-3 space-y-2">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
                          Recipients ({selectedPhones.size})
                        </p>
                        <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
                          {Array.from(selectedPhones).map(p => {
                            const tenant = tenantsWithPhone.find(t => t.phone === p);
                            return (
                              <span key={p} className="inline-flex items-center gap-1 bg-muted text-foreground text-xs rounded-full px-2 py-0.5 font-mono">
                                {tenant ? `${tenant.firstName} ${tenant.lastName}` : p}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        This will send <strong>{selectedPhones.size}</strong> WhatsApp message{selectedPhones.size !== 1 ? "s" : ""}. This action cannot be undone.
                      </p>
                    </div>
                    <div className="flex gap-2 justify-end shrink-0 pt-2 border-t border-border">
                      <Button variant="outline" onClick={() => setBulkStep("compose")} disabled={bulkSendMutation.isPending}>
                        ← Edit
                      </Button>
                      <Button onClick={confirmBulkSend} disabled={bulkSendMutation.isPending} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                        {bulkSendMutation.isPending
                          ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sending…</>
                          : <><Send className="h-4 w-4 mr-2" />Confirm — Send to {selectedPhones.size}</>}
                      </Button>
                    </div>
                  </div>
                )}
                </div>{/* end scrollable body */}

                {/* Sticky footer */}
                <div className="shrink-0 flex justify-end gap-2 px-6 py-4 border-t border-border bg-background">
                  <Button variant="outline" onClick={() => setBulkModal(false)} disabled={bulkSendMutation.isPending}>Cancel</Button>
                  <Button onClick={handleBulkSend} disabled={bulkSendMutation.isPending || selectedPhones.size === 0} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                    <Eye className="h-4 w-4 mr-2" />Preview &amp; Send ({selectedPhones.size})
                  </Button>
                </div>
              </div>{/* end flex-col wrapper */}
            </DialogContent>
          </Dialog>

          {/* Create Template dialog */}
          <Dialog open={isTemplateModalOpen} onOpenChange={(open) => { setTemplateModal(open); if (!open) { setNewTemplate(EMPTY_TEMPLATE); setVarInput(""); } }}>
            <DialogTrigger asChild>
              <Button variant="outline"><Plus className="h-4 w-4 mr-2" />Create Template</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Create WhatsApp Template</DialogTitle>
                <DialogDescription>Build your template by adding variables, then click Insert to place them in your message.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">

                {/* Name */}
                <div>
                  <Label htmlFor="tmpl-name">Template Name <span className="text-red-500">*</span></Label>
                  <Input
                    id="tmpl-name"
                    placeholder="e.g. Rent Reminder"
                    value={newTemplate.name}
                    onChange={e => setNewTemplate(p => ({ ...p, name: e.target.value }))}
                    className="mt-1"
                  />
                </div>

                {/* Category */}
                <div>
                  <Label>Category</Label>
                  <Select value={newTemplate.category} onValueChange={v => setNewTemplate(p => ({ ...p, category: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rent_reminder">Rent Reminder</SelectItem>
                      <SelectItem value="maintenance_update">Maintenance Update</SelectItem>
                      <SelectItem value="payment_confirmation">Payment Confirmation</SelectItem>
                      <SelectItem value="emergency_alert">Emergency Alert</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Variable builder */}
                <div>
                  <Label>Variables</Label>
                  <p className="text-xs text-muted-foreground mt-0.5 mb-2">
                    Add a variable name, then click <strong>Insert</strong> in your message to place it.
                  </p>
                  {/* Add variable input */}
                  <div className="flex gap-2">
                    <Input
                      placeholder="e.g. tenant_name"
                      value={varInput}
                      onChange={e => setVarInput(e.target.value.replace(/\s+/g, "_"))}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addVariable(); } }}
                      className="h-8 text-sm"
                    />
                    <Button type="button" size="sm" variant="outline" onClick={addVariable} className="shrink-0">
                      <Plus className="h-3.5 w-3.5 mr-1" />Add
                    </Button>
                  </div>
                  {/* Variable chips */}
                  {newTemplate.variables.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {newTemplate.variables.map(v => (
                        <div key={v} className="flex items-center gap-1 bg-blue-50 border border-blue-200 rounded-md pl-2 pr-1 py-0.5">
                          <Tag className="h-3 w-3 text-blue-500 shrink-0" />
                          <span className="text-xs font-mono text-blue-700">{v}</span>
                          <button
                            type="button"
                            onClick={() => insertVariable(v)}
                            className="text-xs text-blue-600 hover:text-blue-900 font-medium ml-1 px-1 border-l border-blue-200"
                            title={`Insert {{${v}}} at cursor`}
                          >
                            Insert
                          </button>
                          <button
                            type="button"
                            onClick={() => removeVariable(v)}
                            className="text-muted-foreground hover:text-red-500 ml-0.5"
                            title="Remove variable"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Content */}
                <div>
                  <Label htmlFor="tmpl-content">Message Content <span className="text-red-500">*</span></Label>
                  <Textarea
                    id="tmpl-content"
                    ref={contentRef}
                    placeholder="Type your message here, then click Insert on a variable above to place it at the cursor…"
                    rows={5}
                    value={newTemplate.content}
                    onChange={e => setNewTemplate(p => ({ ...p, content: e.target.value }))}
                    className="mt-1 font-mono text-sm"
                  />
                  {/* Live preview of inserted tags */}
                  {newTemplate.variables.length > 0 && newTemplate.content && (
                    <div className="mt-2 p-2.5 rounded-md bg-muted text-xs text-muted-foreground leading-relaxed">
                      <span className="font-medium text-foreground block mb-0.5">Preview:</span>
                      {newTemplate.content.replace(/\{\{(\w+)\}\}/g, (_, name) =>
                        newTemplate.variables.includes(name) ? `[${name}]` : `{{${name}}}`
                      )}
                    </div>
                  )}
                </div>

              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setTemplateModal(false); setNewTemplate(EMPTY_TEMPLATE); setVarInput(""); }} disabled={createTemplateMutation.isPending}>
                  Cancel
                </Button>
                <Button onClick={handleCreateTemplate} disabled={createTemplateMutation.isPending} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                  {createTemplateMutation.isPending
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating…</>
                    : <><Plus className="h-4 w-4 mr-2" />Create Template</>}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

        </div>
      </div>

      {/* ── Configuration warning banner ── */}
      {configStatus && !configStatus.configured && !bannerDismissed && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 px-4 py-3 text-sm">
          <WifiOff className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold">WhatsApp API not configured — running in demo mode</p>
            <p className="text-amber-700 mt-0.5">
              Messages are logged locally but <strong>not delivered</strong> to real phones.
              {configStatus.missing.length > 0 && (
                <> Set the following environment variables to enable live sending:{" "}
                  {configStatus.missing.map((k, i) => (
                    <span key={k}>
                      <code className="font-mono bg-amber-100 rounded px-1">{k}</code>
                      {i < configStatus.missing.length - 1 ? ", " : ""}
                    </span>
                  ))}.
                </>
              )}
            </p>
          </div>
          <button
            onClick={() => setBannerDismissed(true)}
            className="shrink-0 text-amber-500 hover:text-amber-800 ml-2"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {kpis.map(kpi => {
          const Icon = kpi.icon;
          return (
            <Card key={kpi.label} className="rounded-2xl border-border shadow-none">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">{kpi.label}</p>
                    <p className="text-2xl font-semibold text-foreground mt-0.5">
                      {loadingMetrics ? "—" : kpi.value}
                    </p>
                  </div>
                  <Icon className={`h-7 w-7 ${kpi.color} shrink-0`} />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Quick Actions */}
      <Card className="rounded-2xl border-border shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Zap className="h-5 w-5" />Quick Actions</CardTitle>
          <CardDescription>Send automated notifications to tenants and property owners based on live data</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { type: "rent_reminder",        label: "Send Rent Reminders",   description: "Notify tenants with overdue / pending payments",       icon: AlertCircle, color: "text-orange-600" },
              { type: "maintenance_update",   label: "Maintenance Updates",   description: "Update tenants on pending maintenance requests",        icon: Settings,    color: "text-blue-600" },
              { type: "payment_confirmation", label: "Payment Confirmations", description: "Confirm payments received in the last 24 hours",       icon: CheckCircle, color: "text-green-600" },
              { type: "emergency_alert",      label: "Emergency Alert",       description: "Broadcast urgent notice to all active tenants",        icon: AlertCircle, color: "text-red-600", isEmergency: true },
            ].map(action => {
              const Icon = action.icon;
              const busy = sendAutomatedMutation.isPending && activeAutomation === action.type;
              return (
                <div key={action.type} className="border rounded-xl p-4 space-y-2 hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-2">
                    <Icon className={`h-5 w-5 ${action.color}`} />
                    <span className="font-medium text-sm">{action.label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{action.description}</p>
                  {action.isEmergency && (
                    <Textarea
                      placeholder="Custom emergency message (optional)…"
                      rows={2}
                      value={emergencyMsg}
                      onChange={e => setEmergencyMsg(e.target.value)}
                      className="text-xs"
                    />
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    disabled={sendAutomatedMutation.isPending}
                    onClick={() => triggerAutomation(action.type, action.isEmergency ? emergencyMsg || undefined : undefined)}
                  >
                    {busy
                      ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Sending…</>
                      : <><Play className="h-3.5 w-3.5 mr-1.5" />Run</>}
                  </Button>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Main Content Tabs */}
      <Tabs defaultValue="conversations" className="w-full">
        <TabsList className="grid w-full grid-cols-3 max-w-lg">
          <TabsTrigger value="conversations" className="relative">
            Conversations
            {(() => {
              const unread = conversations.filter(c => c.unreadCount > 0).length;
              return unread > 0 ? (
                <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 min-w-[1.25rem]">
                  {unread}
                </span>
              ) : null;
            })()}
          </TabsTrigger>
          <TabsTrigger value="messages">Sent</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
        </TabsList>

        {/* ── Messages tab ── */}
        <TabsContent value="messages" className="space-y-4">
          <Card className="rounded-2xl border-border shadow-none">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Sent Messages</CardTitle>
                  <CardDescription>WhatsApp messages sent from your organisation</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => refetchMessages()}>
                  <RefreshCw className="h-4 w-4 mr-1" />Refresh
                </Button>
              </div>
              {/* Search */}
              <div className="pt-2 space-y-2">
                <SearchBar
                  value={msgSearch}
                  onChange={handleMsgSearch}
                  placeholder="Search by recipient, message, type or status…"
                />
                {/* Status filter pills */}
                <div className="flex flex-wrap gap-2 pt-1">
                  {(["all", "sent", "delivered", "read", "attended", "failed"] as const).map(status => {
                    const meta = STATUS_META[status];
                    const isActive = msgStatusFilter === status;
                    const count = status === "all"
                      ? messages.length
                      : messages.filter(m => m.status === status).length;
                    return (
                      <button
                        key={status}
                        onClick={() => handleMsgStatusFilter(status)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                          isActive
                            ? status === "all"
                              ? "bg-foreground text-background border-foreground"
                              : `${meta.color} border-transparent`
                            : "bg-background text-muted-foreground border-border hover:border-foreground/40"
                        }`}
                      >
                        {status !== "all" && meta.icon}
                        {status === "all" ? "All" : meta.label}
                        <span className={`ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] ${isActive ? "bg-black/10" : "bg-muted"}`}>
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {loadingMessages ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Recipient</TableHead>
                        <TableHead>Message</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Sent</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredMessages.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                            <MessageCircle className="h-10 w-10 mx-auto mb-2 opacity-20" />
                            {msgSearch ? "No messages match your search" : "No messages sent yet"}
                          </TableCell>
                        </TableRow>
                      ) : pagedMessages.map(msg => (
                        <TableRow key={msg.id} className="hover:bg-muted/50">
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                              <span className="font-mono text-sm">{msg.to}</span>
                            </div>
                          </TableCell>
                          <TableCell className="max-w-xs">
                            <p className="truncate text-sm" title={msg.content}>{msg.content}</p>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="capitalize">{msg.type}</Badge>
                          </TableCell>
                          <TableCell>
                            {(() => {
                              const meta = STATUS_META[msg.status] ?? { color: "bg-muted text-foreground", label: msg.status, icon: null };
                              return (
                                <Badge className={`capitalize flex items-center w-fit ${meta.color}`}>
                                  {meta.icon}{meta.label}
                                </Badge>
                              );
                            })()}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {safeFormat(msg.timestamp)}
                          </TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => setViewMessage({ to: msg.to, content: msg.content, timestamp: msg.timestamp ?? "" })}>
                                  <Eye className="h-4 w-4 mr-2" /> View full message
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleReply(msg.to)}>
                                  <Reply className="h-4 w-4 mr-2" /> Reply
                                </DropdownMenuItem>
                                {msg.status !== "attended" && (
                                  <DropdownMenuItem onClick={() => markAttendedMutation.mutate(msg.id)}>
                                    <UserCheck className="h-4 w-4 mr-2" /> Mark as attended
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem onClick={() => handleCopyMessage(msg.id, msg.content)}>
                                  {copiedId === msg.id
                                    ? <CheckCircle className="h-4 w-4 mr-2 text-green-500" />
                                    : <Copy className="h-4 w-4 mr-2" />}
                                  Copy message
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() => deleteMessageMutation.mutate(msg.id)}
                                  disabled={deleteMessageMutation.isPending}
                                >
                                  <Trash2 className="h-4 w-4 mr-2" /> Delete from log
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {filteredMessages.length > 0 && (
                    <PaginationBar
                      total={filteredMessages.length}
                      page={msgPage}
                      pageSize={msgPageSize}
                      onPageChange={setMsgPage}
                      onPageSizeChange={handleMsgPageSize}
                    />
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Conversations tab ── */}
        <TabsContent value="conversations" className="space-y-0">
          <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-4 h-[600px]">

            {/* ── Left: conversation list ── */}
            <Card className="rounded-2xl border-border shadow-none flex flex-col overflow-hidden">
              <CardHeader className="pb-2 shrink-0">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Conversations</CardTitle>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => refetchConversations()}>
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <SearchBar value={inboxSearch} onChange={handleInboxSearch} placeholder="Name, unit, phone, or message…" />
              </CardHeader>
              <CardContent className="p-0 flex-1 overflow-y-auto">
                {loadingConversations ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : conversations.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2 py-12">
                    <MessageCircle className="h-8 w-8 opacity-20" />
                    <p className="text-sm">No conversations yet</p>
                  </div>
                ) : conversations
                    .filter(c => {
                      if (!inboxSearch) return true;
                      const q = inboxSearch.trim().toLowerCase();
                      const name = resolveName(c.phone).toLowerCase();
                      const unit = (c.unitNumber ?? "").toLowerCase();
                      return (
                        c.phone.includes(q) ||
                        name.includes(q) ||
                        unit.includes(q) ||
                        c.messages.some(m => m.content.toLowerCase().includes(q))
                      );
                    })
                    .map(conv => {
                      const last = conv.messages[conv.messages.length - 1];
                      const isActive = activeThread === conv.phone;
                      const isUnread = conv.unreadCount > 0 && !readPhones.has(conv.phone);
                      const displayName = resolveName(conv.phone);
                      const isPhone = displayName === conv.phone; // name not resolved
                      return (
                        <button
                          key={conv.phone}
                          onClick={() => setActiveThread(isActive ? null : conv.phone)}
                          className={`w-full text-left px-4 py-3 border-b border-border transition-colors hover:bg-muted/50 ${isActive ? "bg-muted" : ""}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              {/* Avatar — blue dot overlay when unread */}
                              <div className="relative shrink-0">
                                <div className={`h-8 w-8 rounded-full flex items-center justify-center ${isUnread ? "bg-blue-600" : "bg-blue-100"}`}>
                                  <Phone className={`h-3.5 w-3.5 ${isUnread ? "text-white" : "text-blue-600"}`} />
                                </div>
                                {isUnread && (
                                  <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-red-500 border-2 border-background" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className={`text-sm truncate ${isUnread ? "font-bold text-foreground" : "font-medium"} ${isPhone ? "font-mono" : ""}`}>
                                  {displayName}
                                </p>
                                {!isPhone && (
                                  <p className="text-[10px] font-mono text-muted-foreground truncate">{conv.phone}</p>
                                )}
                                <p className={`text-xs truncate ${isUnread ? "text-foreground" : "text-muted-foreground"}`}>
                                  {last?.content ?? "—"}
                                </p>
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-1 shrink-0">
                              <span className="text-[10px] text-muted-foreground">{safeFormat(conv.lastMessageAt)}</span>
                              {isUnread && (
                                <span className="inline-flex items-center justify-center rounded-full bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 min-w-[1.25rem]">
                                  {conv.unreadCount}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })
                }
              </CardContent>
            </Card>

            {/* ── Right: thread view ── */}
            <Card className="rounded-2xl border-border shadow-none flex flex-col overflow-hidden">
              {!activeConversation ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
                  <ArrowDownCircle className="h-10 w-10 opacity-20" />
                  <p className="text-sm">Select a conversation to view the thread</p>
                </div>
              ) : (
                <>
                  {/* Thread header */}
                  <CardHeader className="pb-3 shrink-0 border-b border-border">
                    <div className="flex items-center gap-2">
                      <div className="h-9 w-9 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                        <Phone className="h-4 w-4 text-blue-600" />
                      </div>
                      <div className="min-w-0 flex-1">
                        {resolveName(activeConversation.phone) !== activeConversation.phone ? (
                          <>
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold text-sm">{resolveName(activeConversation.phone)}</p>
                              {activeConversation.unitNumber && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200" >
                                  Unit {activeConversation.unitNumber}
                                </span>
                              )}
                            </div>
                            <p className="text-xs font-mono text-muted-foreground truncate">{activeConversation.phone} · {threadMessages.length} msgs{threadHasMore ? "+" : ""}</p>
                          </>
                        ) : (
                          <>
                            <p className="font-semibold font-mono text-sm">{activeConversation.phone}</p>
                            <p className="text-xs text-muted-foreground">{threadMessages.length} messages{threadHasMore ? "+" : ""}</p>
                          </>
                        )}
                      </div>
                    </div>
                  </CardHeader>

                  {/* Message bubbles */}
                  <CardContent ref={threadScrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">

                    {/* Top sentinel — IntersectionObserver triggers older page load */}
                    <div ref={threadSentinelRef} className="h-1" />

                    {/* Load-more indicator */}
                    {threadLoading && (
                      <div className="flex justify-center py-2">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    )}
                    {!threadHasMore && threadMessages.length > 0 && (
                      <p className="text-center text-[10px] text-muted-foreground py-1">Beginning of conversation</p>
                    )}

                    {threadMessages.map(msg => {
                      const isOut = msg.direction === "outbound";
                      const isPending = (msg.status as string) === "pending";
                      const isFailed = msg.status === "failed";
                      const meta = STATUS_META[msg.status] ?? { color: "bg-muted text-foreground", label: msg.status, icon: null };
                      return (
                        <div key={msg.id} className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm shadow-sm transition-opacity ${
                            isOut
                              ? isFailed
                                ? "bg-red-100 text-red-900 border border-red-300 rounded-br-sm"
                                : "bg-blue-600 text-white rounded-br-sm"
                              : "bg-muted text-foreground rounded-bl-sm"
                          } ${isPending ? "opacity-60" : ""}`}>
                            <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                            <div className={`flex items-center gap-1.5 mt-1.5 text-[10px] ${isOut ? (isFailed ? "text-red-500 justify-end" : "text-blue-100 justify-end") : "text-muted-foreground"}`}>
                              {isPending && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                              <span>{isPending ? "Sending…" : safeFormat(msg.timestamp)}</span>
                              {isOut && !isPending && !isFailed && (
                                <span className={`px-1.5 py-0.5 rounded-full bg-blue-500/40`}>
                                  {meta.label}
                                </span>
                              )}
                              {isFailed && (
                                <>
                                  <XCircle className="h-3 w-3 text-red-500" />
                                  <button
                                    onClick={() => handleRetryMessage(msg)}
                                    className="ml-1 underline text-red-600 hover:text-red-800 font-medium"
                                  >
                                    Retry
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {/* Typing indicator — shown when the contact's message is incoming via WS */}
                    {typingPhone === activeConversation.phone && (
                      <div className="flex justify-start">
                        <div className="bg-muted text-foreground rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm shadow-sm flex items-center gap-1.5">
                          <span className="flex gap-1 items-center h-4">
                            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:0ms]" />
                            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:150ms]" />
                            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:300ms]" />
                          </span>
                        </div>
                      </div>
                    )}
                    <div ref={threadBottomRef} />
                  </CardContent>

                  {/* ── Rich inline compose bar ── */}
                  <div className="shrink-0 border-t border-border bg-background">

                    {/* ── Toolbar row: type switcher + emoji ── */}
                    <div className="flex items-center gap-1 px-3 pt-2 pb-1">
                      {/* Message type tabs */}
                      <div className="flex items-center rounded-xl border border-slate-100 shadow-sm bg-muted/40 p-0.5 gap-0.5">
                        {(["text", "template", "media"] as MessageType[]).map(t => (
                          <button
                            key={t}
                            onClick={() => { setInlineType(t); setInlinePanel(null); }}
                            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                              inlineType === t
                                ? "bg-background text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {t === "text" && "Text"}
                            {t === "template" && <span className="flex items-center gap-1"><LayoutTemplate className="h-3 w-3" />Template</span>}
                            {t === "media" && <span className="flex items-center gap-1"><Paperclip className="h-3 w-3" />Media</span>}
                          </button>
                        ))}
                      </div>

                      <div className="flex-1" />

                      {/* Emoji quick-insert (text mode only) */}
                      {inlineType === "text" && (
                        <button
                          onClick={() => setInlinePanel(p => p === "emoji" ? null : "emoji")}
                          className={`h-7 w-7 flex items-center justify-center rounded-md transition-colors ${
                            inlinePanel === "emoji" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                          }`}
                          title="Quick emoji"
                        >
                          <Smile className="h-4 w-4" />
                        </button>
                      )}
                    </div>

                    {/* ── Emoji palette panel ── */}
                    {inlinePanel === "emoji" && inlineType === "text" && (
                      <div className="px-3 pb-2 flex flex-wrap gap-1">
                        {QUICK_EMOJIS.map(em => (
                          <button
                            key={em}
                            onClick={() => {
                              const el = inlineReplyRef.current;
                              if (el) {
                                const s = el.selectionStart ?? el.value.length;
                                const e2 = el.selectionEnd ?? el.value.length;
                                const next = el.value.slice(0, s) + em + el.value.slice(e2);
                                setInlineReply(next);
                                requestAnimationFrame(() => {
                                  el.focus();
                                  el.setSelectionRange(s + em.length, s + em.length);
                                });
                              } else {
                                setInlineReply(p => p + em);
                              }
                            }}
                            className="text-lg hover:scale-110 transition-transform leading-none"
                          >
                            {em}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* ── Template panel ── */}
                    {inlineType === "template" && (
                      <div className="px-3 pb-2 space-y-2">
                        {/* Template picker */}
                        <Select
                          value={inlineTemplate?.name ?? ""}
                          onValueChange={name => {
                            const tmpl = templates.find(t => t.name === name && t.status === "active") ?? null;
                            setInlineTemplate(tmpl);
                            if (tmpl) {
                              const init: Record<string, string> = {};
                              (tmpl.variables ?? []).forEach(v => { init[v] = ""; });
                              setInlineTemplateVars(init);
                            } else {
                              setInlineTemplateVars({});
                            }
                          }}
                        >
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue placeholder="Choose a template…" />
                          </SelectTrigger>
                          <SelectContent>
                            {templates.filter(t => t.status === "active").length === 0
                              ? <SelectItem value="__none__" disabled>No active templates</SelectItem>
                              : templates.filter(t => t.status === "active").map(t => (
                                <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>
                              ))
                            }
                          </SelectContent>
                        </Select>

                        {/* Variable fields + live preview */}
                        {inlineTemplate && (
                          <>
                            {(inlineTemplate.variables ?? []).length > 0 && (
                              <div className="space-y-1.5 rounded-lg border border-dashed border-border p-2">
                                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Variables</p>
                                {(inlineTemplate.variables ?? []).map(v => (
                                  <div key={v} className="flex items-center gap-2">
                                    <span className="text-xs font-mono bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded shrink-0">{`{{${v}}}`}</span>
                                    <Input
                                      placeholder={`${v}…`}
                                      value={inlineTemplateVars[v] ?? ""}
                                      onChange={e => setInlineTemplateVars(p => ({ ...p, [v]: e.target.value }))}
                                      className="h-7 text-xs flex-1"
                                    />
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className="rounded-md bg-muted p-2.5 text-xs text-muted-foreground leading-relaxed">
                              <span className="font-medium text-foreground block mb-0.5">Preview:</span>
                              {(inlineTemplate.variables ?? []).reduce(
                                (txt, v) => txt.replaceAll(`{{${v}}}`, inlineTemplateVars[v] || `[${v}]`),
                                inlineTemplate.content
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {/* ── Media panel ── */}
                    {inlineType === "media" && (
                      <div className="px-3 pb-2 space-y-1.5">
                        <MediaUploader
                          key={activeThread ?? "none"}
                          onUploaded={(url) => setInlineMediaUrl(url)}
                          onClear={() => setInlineMediaUrl("")}
                        />
                        {/* Manual URL fallback */}
                        {!inlineMediaUrl && (
                          <Input
                            placeholder="Or paste a public URL (https://…)"
                            value={inlineMediaUrl}
                            onChange={e => setInlineMediaUrl(e.target.value)}
                            className="h-8 text-sm font-mono"
                          />
                        )}
                        <Input
                          placeholder="Caption (optional)"
                          value={inlineMediaCaption}
                          onChange={e => setInlineMediaCaption(e.target.value)}
                          className="h-8 text-sm"
                        />
                      </div>
                    )}

                    {/* ── Text compose row ── */}
                    {inlineType === "text" && (
                      <div className="flex items-end gap-2 px-3 pb-2.5">
                        <Textarea
                          ref={inlineReplyRef}
                          placeholder="Type a message…"
                          rows={1}
                          value={inlineReply}
                          onChange={e => {
                            setInlineReply(e.target.value);
                            if (activeThread) {
                              if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
                              typingDebounceRef.current = setTimeout(async () => {
                                try {
                                  await apiRequest("/api/whatsapp/typing", {
                                    method: "PATCH",
                                    data: { phone: activeThread },
                                  });
                                } catch {}
                              }, 500);
                            }
                          }}
                          onKeyDown={e => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              handleInlineSend();
                            }
                          }}
                          className="flex-1 resize-none min-h-[38px] max-h-32 text-sm py-2 leading-snug overflow-y-auto"
                          disabled={inlineReplyMutation.isPending}
                        />
                        <Button
                          size="icon"
                          className="h-9 w-9 shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white"
                          onClick={handleInlineSend}
                          disabled={!inlineReply.trim() || inlineReplyMutation.isPending}
                        >
                          {inlineReplyMutation.isPending
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <Send className="h-4 w-4" />}
                        </Button>
                      </div>
                    )}

                    {/* ── Send button row for template / media ── */}
                    {inlineType !== "text" && (
                      <div className="flex justify-end px-3 pb-2.5">
                        <Button
                          size="sm"
                          className="bg-emerald-600 hover:bg-emerald-700 text-white"
                          onClick={handleInlineSend}
                          disabled={inlineReplyMutation.isPending || (
                            inlineType === "media" ? !inlineMediaUrl.trim() :
                            inlineType === "template" ? !inlineTemplate : true
                          )}
                        >
                          {inlineReplyMutation.isPending
                            ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Sending…</>
                            : <><Send className="h-4 w-4 mr-1.5" />Send {inlineType === "template" ? "template" : "media"}</>}
                        </Button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </Card>
          </div>
        </TabsContent>

        {/* ── Templates tab ── */}
        <TabsContent value="templates" className="space-y-4">
          <Card className="rounded-2xl border-border shadow-none">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Message Templates</CardTitle>
                  <CardDescription>Reusable templates for common property management notifications</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => refetchTemplates()}>
                  <RefreshCw className="h-4 w-4 mr-1" />Refresh
                </Button>
              </div>
              {/* Search */}
              <div className="pt-2">
                <SearchBar
                  value={tmplSearch}
                  onChange={handleTmplSearch}
                  placeholder="Search by name, category, content or status…"
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {loadingTemplates ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Content Preview</TableHead>
                        <TableHead>Variables</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Use</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredTemplates.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                            <MessageCircle className="h-10 w-10 mx-auto mb-2 opacity-20" />
                            {tmplSearch ? "No templates match your search" : "No templates yet. Create your first template to get started."}
                          </TableCell>
                        </TableRow>
                      ) : pagedTemplates.map(tmpl => (
                        <TableRow key={tmpl.id} className="hover:bg-muted/50">
                          <TableCell className="font-medium">{tmpl.name}</TableCell>
                          <TableCell>
                            <Badge className={`capitalize ${CATEGORY_COLORS[tmpl.category] ?? "bg-muted text-foreground"}`}>
                              {tmpl.category.replace(/_/g, " ")}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-xs">
                            <p className="truncate text-sm text-muted-foreground" title={tmpl.content}>{tmpl.content}</p>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {(tmpl.variables ?? []).length === 0
                                ? <span className="text-xs text-muted-foreground">—</span>
                                : (tmpl.variables ?? []).map((v, i) => (
                                    <Badge key={i} variant="secondary" className="text-xs font-mono">{`{{${v}}}`}</Badge>
                                  ))
                              }
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge className={
                              tmpl.status === "active"   ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                              tmpl.status === "rejected" ? "bg-red-100 text-red-800" :
                                                           "bg-yellow-100 text-yellow-800"
                            }>
                              {tmpl.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={tmpl.status !== "active"}
                              onClick={() => {
                                setSelectedTemplate(tmpl);
                                const initVars: Record<string, string> = {};
                                (tmpl.variables ?? []).forEach(v => { initVars[v] = ""; });
                                setNewMessage(p => ({
                                  ...p,
                                  message: tmpl.content,
                                  type: "template" as MessageType,
                                  template_name: tmpl.name,
                                  templateVariables: initVars,
                                }));
                                setMessageModal(true);
                              }}
                            >
                              <Play className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {filteredTemplates.length > 0 && (
                    <PaginationBar
                      total={filteredTemplates.length}
                      page={tmplPage}
                      pageSize={tmplPageSize}
                      onPageChange={setTmplPage}
                      onPageSizeChange={handleTmplPageSize}
                    />
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Full message view dialog ── */}
      <Dialog open={!!viewMessage} onOpenChange={open => { if (!open) setViewMessage(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Full Message</DialogTitle>
            <DialogDescription className="flex items-center gap-2 pt-1">
              <Phone className="h-3.5 w-3.5" />
              <span className="font-mono">{viewMessage?.to}</span>
              {viewMessage?.timestamp && (
                <span className="text-muted-foreground ml-auto text-xs">{safeFormat(viewMessage.timestamp)}</span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg bg-muted p-4 text-sm whitespace-pre-wrap break-words max-h-80 overflow-y-auto">
            {viewMessage?.content}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { if (viewMessage) handleCopyMessage(-1, viewMessage.content); }}>
              <Copy className="h-4 w-4 mr-2" /> Copy
            </Button>
            <Button onClick={() => { if (viewMessage) { handleReply(viewMessage.to); setViewMessage(null); } }}>
              <Reply className="h-4 w-4 mr-2" /> Reply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}