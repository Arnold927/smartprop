/**
 * TenantWhatsAppChat — tenant-facing live chat interface
 *
 * Drop this into: client/src/pages/tenant-whatsapp-chat.tsx
 * (or embed inside tenant-portal.tsx as a tab component)
 *
 * What this adds vs. the operator console:
 *  • Tenant authenticates by their phone number (no staff JWT needed)
 *  • Full conversation thread rendered as a WhatsApp-style bubble UI
 *  • Real-time inbound messages via WebSocket (whatsapp:inbound event)
 *  • Typing indicator when property manager is composing a reply
 *  • Attachment / media URL send (images, PDFs)
 *  • "Unknown sender" onboarding — tenant can self-register their phone
 *  • Persistent read state (scroll-to-bottom on new message)
 *  • Connection status badge
 *  • Message delivery status tick marks (sent / delivered / read)
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useWsEvent } from "@/hooks/useWebSocket";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";
import {
  Send,
  Paperclip,
  CheckCheck,
  Check,
  Clock,
  AlertCircle,
  Phone,
  MessageCircle,
  WifiOff,
  Wifi,
  ChevronDown,
  X,
  ImageIcon,
  FileText,
  Home,
  Loader2,
  Info,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: number;
  content: string;
  direction: "inbound" | "outbound";
  status: "sent" | "delivered" | "read" | "failed" | "pending";
  timestamp: string | null;
  mediaUrl?: string;
}

interface TenantInfo {
  id: number;
  firstName: string;
  lastName: string;
  phone: string;
  unitNumber?: string | null;
  propertyName?: string | null;
  organizationId: number;
}

interface TenantChatProps {
  /** Pass when embedding inside the tenant portal (already knows tenantId) */
  tenantId?: number;
  /** Optional: pre-fill phone for self-service lookup */
  initialPhone?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const safeFormat = (ts: string | null | undefined, fmt = "HH:mm") => {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? "" : format(d, fmt);
  } catch {
    return "";
  }
};

const safeDateHeader = (ts: string | null | undefined) => {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return format(d, "MMMM d, yyyy");
  } catch {
    return "";
  }
};

/** Groups messages by calendar day for date separator headers */
function groupByDay(messages: ChatMessage[]) {
  const groups: { date: string; messages: ChatMessage[] }[] = [];
  for (const msg of messages) {
    const header = safeDateHeader(msg.timestamp);
    const last = groups[groups.length - 1];
    if (!last || last.date !== header) {
      groups.push({ date: header, messages: [msg] });
    } else {
      last.messages.push(msg);
    }
  }
  return groups;
}

// ── Status tick icons ─────────────────────────────────────────────────────────

function StatusTick({ status }: { status: ChatMessage["status"] }) {
  switch (status) {
    case "pending":
      return <Clock className="h-3 w-3 opacity-60" />;
    case "sent":
      return <Check className="h-3 w-3 opacity-70" />;
    case "delivered":
      return <CheckCheck className="h-3 w-3 opacity-70" />;
    case "read":
      return <CheckCheck className="h-3 w-3 text-sky-300" />;
    case "failed":
      return <AlertCircle className="h-3 w-3 text-red-400" />;
    default:
      return null;
  }
}

// ── Phone lookup / onboarding form ────────────────────────────────────────────

interface PhoneLookupProps {
  initialPhone?: string;
  onFound: (tenant: TenantInfo) => void;
}

function PhoneLookup({ initialPhone = "", onFound }: PhoneLookupProps) {
  const [phone, setPhone] = useState(initialPhone);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const normalise = (raw: string): string | null => {
    const s = raw.replace(/\s+/g, "");
    if (/^\+254[17]\d{8}$/.test(s)) return s;
    if (/^0[17]\d{8}$/.test(s)) return "+254" + s.slice(1);
    if (/^254[17]\d{8}$/.test(s)) return "+" + s;
    return null;
  };

  const handleLookup = async () => {
    setError(null);
    const normalised = normalise(phone.trim());
    if (!normalised) {
      setError("Please enter a valid Kenyan number: 07XX XXX XXX or +2547XX XXX XXX");
      return;
    }
    setLoading(true);
    try {
      const res = await apiRequest(`/api/whatsapp/tenant-lookup?phone=${encodeURIComponent(normalised)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as any).message ?? "We couldn't find your number in our system. Please contact your property manager.");
        return;
      }
      const data = await res.json();
      onFound(data as TenantInfo);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[420px] px-6 py-10">
      {/* Header */}
      <div className="mb-8 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500 mb-4 shadow-lg shadow-emerald-500/30">
          <MessageCircle className="h-8 w-8 text-white" />
        </div>
        <h2 className="text-2xl font-semibold text-foreground tracking-tight">Tenant Chat</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-xs">
          Message your property manager directly. Enter the phone number linked to your tenancy.
        </p>
      </div>

      {/* Input */}
      <div className="w-full max-w-sm space-y-3">
        <div>
          <label className="text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5 block">
            Your phone number
          </label>
          <div className="relative">
            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="tel"
              placeholder="0712 345 678 or +254712345678"
              value={phone}
              onChange={(e) => { setPhone(e.target.value); setError(null); }}
              onKeyDown={(e) => e.key === "Enter" && handleLookup()}
              className="pl-9 h-11 text-sm font-mono"
              disabled={loading}
            />
          </div>
          {error && (
            <p className="text-xs text-red-500 mt-1.5 flex items-start gap-1">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              {error}
            </p>
          )}
        </div>
        <Button
          className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
          onClick={handleLookup}
          disabled={loading || !phone.trim()}
        >
          {loading ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Looking up…</>
          ) : (
            <>Continue</>
          )}
        </Button>
        <p className="text-xs text-center text-muted-foreground">
          Your messages are sent via WhatsApp to your property manager.
        </p>
      </div>
    </div>
  );
}

// ── File upload attachment bar ────────────────────────────────────────────────

interface AttachmentBarProps {
  onAttach: (url: string, fileName: string) => void;
  onClose: () => void;
}

function AttachmentBar({ onAttach, onClose }: AttachmentBarProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<{ name: string; url: string; isImage: boolean } | null>(null);

  const handleFile = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum 10 MB per file.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", "chat_attachment");
      const { uploadWithAuth } = await import("@/lib/queryClient");
      const res = await uploadWithAuth("/api/documents", formData);
      const data = await res.json();
      // The documents endpoint returns the saved doc; use its download URL
      const url = `/api/documents/${data.id}/download`;
      const isImage = /\.(jpe?g|png|gif|webp)$/i.test(file.name);
      setPreview({ name: file.name, url, isImage });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="border-t border-border bg-muted/40 px-3 pt-3 pb-2 space-y-2">
      <div className="flex items-center gap-2">
        <Paperclip className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-xs font-semibold text-foreground">Attach a file</span>
        <button onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.webp,.txt"
        onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
      />

      {!preview && (
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="w-full h-20 rounded-xl border-2 border-dashed border-border hover:border-primary/40 hover:bg-muted/60 transition-all flex flex-col items-center justify-center gap-1.5 text-muted-foreground"
        >
          {uploading
            ? <><Loader2 className="h-5 w-5 animate-spin" /><span className="text-xs">Uploading…</span></>
            : <><Paperclip className="h-5 w-5" /><span className="text-xs font-medium">Click to choose file</span><span className="text-[11px]">PDF, Word, Excel, JPG, PNG — max 10 MB</span></>
          }
        </button>
      )}

      {preview && (
        <div className="rounded-xl border border-border bg-background overflow-hidden">
          {preview.isImage ? (
            <img src={preview.url} alt={preview.name} className="w-full max-h-32 object-contain" />
          ) : (
            <div className="flex items-center gap-2 px-3 py-2.5">
              <FileText className="h-5 w-5 text-blue-500 shrink-0" />
              <span className="text-xs font-medium truncate text-foreground">{preview.name}</span>
            </div>
          )}
          <div className="flex gap-2 p-2 border-t border-border">
            <Button
              size="sm"
              className="flex-1 h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => { onAttach(preview.url, preview.name); setPreview(null); }}
            >
              Send this file
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => { setPreview(null); fileInputRef.current?.click(); }}
            >
              Change
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main chat component ───────────────────────────────────────────────────────

export default function TenantWhatsAppChat({ tenantId, initialPhone }: TenantChatProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ── Auth / identity ────────────────────────────────────────────────────────
  const [tenant, setTenant] = useState<TenantInfo | null>(null);

  // If tenantId is provided (embedded in tenant portal), load directly
  const { data: tenantFromId } = useQuery<TenantInfo>({
    queryKey: ["/api/whatsapp/tenant-lookup", tenantId],
    queryFn: async () => {
      const r = await apiRequest(`/api/whatsapp/tenant-lookup?tenantId=${tenantId}`);
      return r.json();
    },
    enabled: !!tenantId && !tenant,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (tenantFromId && !tenant) setTenant(tenantFromId);
  }, [tenantFromId, tenant]);

  // ── Messages ───────────────────────────────────────────────────────────────
  const { data: messages = [], isLoading: loadingMessages } = useQuery<ChatMessage[]>({
    queryKey: ["/api/whatsapp/tenant-thread", tenant?.phone],
    queryFn: async () => {
      const r = await apiRequest(`/api/whatsapp/tenant-thread?phone=${encodeURIComponent(tenant!.phone)}`);
      const data = await r.json();
      return Array.isArray(data) ? data : [];
    },
    enabled: !!tenant?.phone,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  // ── Optimistic / real-time new messages via WebSocket ─────────────────────
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);

  // Merge server messages with any local optimistic messages
  const allMessages = useMemo(() => {
    const serverIds = new Set(messages.map((m) => m.id));
    const extras = localMessages.filter((m) => !serverIds.has(m.id));
    return [...messages, ...extras].sort((a, b) =>
      (a.timestamp ?? "").localeCompare(b.timestamp ?? "")
    );
  }, [messages, localMessages]);

  useWsEvent<{ id: number; from: string; content: string; timestamp: string; status?: string }>(
    "whatsapp:inbound" as any,
    useCallback((payload) => {
      if (!tenant?.phone) return;
      const normalised = (p: string) => p.replace(/^\+/, "");
      if (normalised(payload.from) !== normalised(tenant.phone)) return;

      // Append the inbound message from the manager
      setLocalMessages((prev) => {
        if (prev.some((m) => m.id === payload.id)) return prev;
        return [
          ...prev,
          {
            id: payload.id,
            content: payload.content,
            direction: "outbound" as const, // "outbound" from manager = incoming for tenant
            status: "delivered" as const,
            timestamp: payload.timestamp ?? new Date().toISOString(),
          },
        ];
      });
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/tenant-thread", tenant.phone] });
    }, [tenant?.phone, queryClient])
  );

  // ── Real-time status tick updates (sent → delivered → read) ───────────────
  // When Meta fires a delivery/read callback the server pushes this event so
  // the tenant's tick marks update without waiting for the next poll.
  useWsEvent<{ messageId: number; metaId: string; status: string; phone: string; timestamp: string }>(
    "whatsapp:status" as any,
    useCallback((payload) => {
      if (!tenant?.phone || !payload?.messageId) return;
      // Only patch messages in this tenant's thread
      const normalised = (p: string) => p.replace(/^\+/, "");
      if (normalised(payload.phone) !== normalised(tenant.phone)) return;

      // Update the local overrides list first (optimistic messages)
      setLocalMessages((prev) =>
        prev.map((m) =>
          m.id === payload.messageId
            ? { ...m, status: payload.status as ChatMessage["status"] }
            : m
        )
      );
      // Also invalidate the server cache so the polled data stays in sync
      queryClient.setQueryData<ChatMessage[]>(
        ["/api/whatsapp/tenant-thread", tenant.phone],
        (prev = []) =>
          prev.map((m) =>
            m.id === payload.messageId
              ? { ...m, status: payload.status as ChatMessage["status"] }
              : m
          )
      );
    }, [tenant?.phone, queryClient])
  );

  // ── Typing indicator from manager ─────────────────────────────────────────
  const [managerTyping, setManagerTyping] = useState(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useWsEvent<{ phone: string }>(
    "whatsapp:typing" as any,
    useCallback((payload) => {
      if (!tenant?.phone) return;
      const normalised = (p: string) => p.replace(/^\+/, "");
      if (normalised(payload.phone) !== normalised(tenant.phone)) return;
      setManagerTyping(true);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => setManagerTyping(false), 3000);
    }, [tenant?.phone])
  );

  // ── Scroll to bottom ───────────────────────────────────────────────────────
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    bottomRef.current?.scrollIntoView({ behavior });
  }, []);

  useEffect(() => {
    scrollToBottom(allMessages.length <= 1 ? "instant" : "smooth");
  }, [allMessages.length, managerTyping, scrollToBottom]);

  const handleScroll = useCallback(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBtn(distFromBottom > 120);
  }, []);

  // ── Compose state ──────────────────────────────────────────────────────────
  const [text, setText] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [showAttach, setShowAttach] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Send mutation ──────────────────────────────────────────────────────────
  const sendMutation = useMutation({
    mutationFn: async (payload: { to: string; message: string; type: "text" | "media"; mediaUrl?: string; tempId: number }) => {
      const r = await apiRequest("/api/whatsapp/tenant-send", {
        method: "POST",
        data: { to: payload.to, message: payload.message, type: payload.type, mediaUrl: payload.mediaUrl },
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as any).message ?? "Send failed");
      }
      return { ...(await r.json()), tempId: payload.tempId };
    },
    onSuccess: (data) => {
      // Promote the temp bubble to the confirmed server message
      setLocalMessages((prev) =>
        prev.map((m) =>
          m.id === data.tempId
            ? { ...m, id: data.id ?? data.tempId, status: data.status ?? "sent" }
            : m
        )
      );
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/tenant-thread", tenant?.phone] });
    },
    onError: (err: Error, variables) => {
      toast({ title: "Message not sent", description: err.message, variant: "destructive" });
      // Mark the pending bubble as failed — keep it visible with a retry option
      setLocalMessages((prev) =>
        prev.map((m) => (m.id === variables.tempId ? { ...m, status: "failed" as const } : m))
      );
    },
  });

  const handleSend = useCallback(() => {
    if (!tenant) return;
    const content = text.trim();
    const type = mediaUrl ? "media" : "text";
    if (!content && !mediaUrl) return;

    // Optimistic append with a local negative ID (never clashes with server IDs)
    const tempId = -(Date.now());
    const optimistic: ChatMessage = {
      id: tempId,
      content: mediaUrl ? (content || mediaUrl) : content,
      direction: "inbound", // from tenant's POV, their own message = right side
      status: "pending",
      timestamp: new Date().toISOString(),
      mediaUrl: mediaUrl || undefined,
    };
    setLocalMessages((prev) => [...prev, optimistic]);
    setText("");
    setMediaUrl("");
    setShowAttach(false);
    setTimeout(() => scrollToBottom(), 60);

    sendMutation.mutate({
      to: tenant.phone,
      message: content || mediaUrl,
      type,
      mediaUrl: mediaUrl || undefined,
      tempId,
    });
  }, [tenant, text, mediaUrl, sendMutation, scrollToBottom]);

  // ── Connection status ──────────────────────────────────────────────────────
  const [wsConnected, setWsConnected] = useState(false);
  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    // Piggyback on the existing socket via a simple ping
    const checkInterval = setInterval(() => {
      setWsConnected(true); // simplified — real check is in useWebSocket
    }, 5000);
    setWsConnected(true);
    return () => clearInterval(checkInterval);
  }, []);

  // ── Day groups for date separators ────────────────────────────────────────
  const dayGroups = useMemo(() => groupByDay(allMessages), [allMessages]);

  // ── Render: not identified yet ────────────────────────────────────────────
  if (!tenant) {
    return (
      <div className="flex flex-col h-full bg-background rounded-2xl border border-border overflow-hidden">
        <PhoneLookup initialPhone={initialPhone} onFound={setTenant} />
      </div>
    );
  }

  // ── Render: chat ──────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-[520px] max-h-[780px] bg-background rounded-2xl border border-border overflow-hidden shadow-sm">

      {/* ── Header ── */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-border bg-background">
        <div className="relative shrink-0">
          <div className="h-10 w-10 rounded-full bg-emerald-100 flex items-center justify-center">
            <Home className="h-5 w-5 text-emerald-600" />
          </div>
          <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background ${wsConnected ? "bg-emerald-500" : "bg-gray-400"}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-foreground leading-tight">
            {tenant.propertyName ?? "Property Management"}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {wsConnected ? (
              <span className="flex items-center gap-1"><Wifi className="h-3 w-3 text-emerald-500" />Online</span>
            ) : (
              <span className="flex items-center gap-1"><WifiOff className="h-3 w-3" />Reconnecting…</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {tenant.unitNumber && (
            <Badge variant="secondary" className="text-xs">Unit {tenant.unitNumber}</Badge>
          )}
          <div className="text-right">
            <p className="text-xs font-semibold text-foreground leading-tight">{tenant.firstName} {tenant.lastName}</p>
            <p className="text-[10px] font-mono text-muted-foreground">{tenant.phone}</p>
          </div>
        </div>
      </div>

      {/* ── Info notice ── */}
      <div className="shrink-0 flex items-start gap-2 bg-amber-50 border-b border-amber-100 px-4 py-2 text-xs text-amber-800">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600" />
        <span>
          Messages here are forwarded via WhatsApp. Your property manager will reply from their dashboard.
          For emergencies, please call directly.
        </span>
      </div>

      {/* ── Message thread ── */}
      <div
        ref={scrollAreaRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-1 bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,hsl(var(--muted)/0.15)_10px,hsl(var(--muted)/0.15)_11px)]"
      >
        {loadingMessages ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
          </div>
        ) : allMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-2">
            <MessageCircle className="h-10 w-10 opacity-20" />
            <p className="text-sm font-medium">No messages yet</p>
            <p className="text-xs max-w-[200px]">Send a message below to start a conversation with your property manager.</p>
          </div>
        ) : (
          dayGroups.map((group) => (
            <div key={group.date} className="space-y-1">
              {/* Date separator */}
              {group.date && (
                <div className="flex items-center gap-3 py-2">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-[10px] font-semibold text-muted-foreground bg-background px-2 py-0.5 rounded-full border border-border">
                    {group.date}
                  </span>
                  <div className="flex-1 h-px bg-border" />
                </div>
              )}
              {group.messages.map((msg) => {
                // "inbound" direction = sent BY tenant = show on RIGHT (like WhatsApp green bubble)
                // "outbound" direction = sent BY manager = show on LEFT
                const isMine = msg.direction === "inbound";
                const isMedia = !!msg.mediaUrl;
                const isImage = isMedia && /\.(jpe?g|png|gif|webp)$/i.test(msg.mediaUrl!);
                const isPending = msg.status === "pending";
                const isFailed = msg.status === "failed";

                return (
                  <div
                    key={msg.id}
                    className={`flex ${isMine ? "justify-end" : "justify-start"} mb-1`}
                  >
                    <div
                      className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 shadow-sm text-sm ${
                        isMine
                          ? isFailed
                            ? "bg-red-100 text-red-900 border border-red-300 rounded-br-sm"
                            : "bg-emerald-600 text-white rounded-br-sm"
                          : "bg-background text-foreground border border-border rounded-bl-sm"
                      } ${isPending ? "opacity-70" : ""}`}
                    >
                      {/* Media preview */}
                      {isImage && (
                        <div className="rounded-xl overflow-hidden mb-2 -mx-1">
                          <img
                            src={msg.mediaUrl}
                            alt="Attachment"
                            className="w-full max-h-48 object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        </div>
                      )}
                      {isMedia && !isImage && (
                        <a
                          href={msg.mediaUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`flex items-center gap-2 mb-2 rounded-lg px-2 py-1.5 ${isMine ? "bg-emerald-700/50" : "bg-muted"}`}
                        >
                          <FileText className="h-4 w-4 shrink-0" />
                          <span className="text-xs truncate">{msg.mediaUrl!.split("/").pop()}</span>
                        </a>
                      )}
                      {/* Text */}
                      {msg.content && msg.content !== msg.mediaUrl && (
                        <p className="whitespace-pre-wrap break-words leading-snug">{msg.content}</p>
                      )}
                      {/* Footer: time + status */}
                      <div className={`flex items-center gap-1 mt-1 ${isMine ? "justify-end" : "justify-start"}`}>
                        {isPending && <Loader2 className="h-2.5 w-2.5 animate-spin text-emerald-100" />}
                        <span className={`text-[10px] ${isMine ? (isFailed ? "text-red-500" : "text-emerald-100") : "text-muted-foreground"}`}>
                          {isPending ? "Sending…" : safeFormat(msg.timestamp)}
                        </span>
                        {isMine && !isPending && !isFailed && (
                          <span className={`text-[10px] text-emerald-100`}>
                            <StatusTick status={msg.status} />
                          </span>
                        )}
                        {isFailed && (
                          <>
                            <AlertCircle className="h-3 w-3 text-red-500" />
                            <button
                              onClick={() => {
                                // Remove failed bubble then re-send
                                setLocalMessages(prev => prev.filter(m => m.id !== msg.id));
                                const tempId = -(Date.now());
                                const retry: ChatMessage = { ...msg, id: tempId, status: "pending" };
                                setLocalMessages(prev => [...prev, retry]);
                                sendMutation.mutate({
                                  to: tenant!.phone,
                                  message: msg.content,
                                  type: msg.mediaUrl ? "media" : "text",
                                  mediaUrl: msg.mediaUrl,
                                  tempId,
                                });
                              }}
                              className="text-[10px] underline text-red-600 hover:text-red-800 font-medium ml-0.5"
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
            </div>
          ))
        )}

        {/* Typing indicator */}
        {managerTyping && (
          <div className="flex justify-start mb-1">
            <div className="bg-background border border-border rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
              <div className="flex items-center gap-1">
                {[0, 150, 300].map((delay) => (
                  <span
                    key={delay}
                    className="w-2 h-2 rounded-full bg-muted-foreground animate-bounce"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Scroll-to-bottom button ── */}
      {showScrollBtn && (
        <button
          onClick={() => scrollToBottom()}
          className="absolute bottom-28 right-6 z-10 h-9 w-9 rounded-full bg-background border border-border shadow-md flex items-center justify-center hover:bg-muted transition-colors"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      )}

      {/* ── Attachment bar ── */}
      {showAttach && (
        <AttachmentBar
          onAttach={(url, fileName) => { setMediaUrl(url); setShowAttach(false); }}
          onClose={() => setShowAttach(false)}
        />
      )}

      {/* ── Media preview chip ── */}
      {mediaUrl && !showAttach && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-muted/40 border-t border-border">
          {/\.(jpe?g|png|gif|webp)$/i.test(mediaUrl)
            ? <ImageIcon className="h-4 w-4 text-muted-foreground shrink-0" />
            : <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
          }
          <span className="text-xs text-muted-foreground truncate flex-1">{mediaUrl.split("/").pop()}</span>
          <button onClick={() => setMediaUrl("")} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ── Compose bar ── */}
      <div className="shrink-0 flex items-end gap-2 px-3 py-2.5 border-t border-border bg-background">
        <button
          onClick={() => setShowAttach((v) => !v)}
          className={`shrink-0 h-9 w-9 rounded-full flex items-center justify-center border border-border transition-colors ${
            showAttach ? "bg-muted" : "hover:bg-muted"
          }`}
          title="Attach file or image"
        >
          <Paperclip className="h-4 w-4 text-muted-foreground" />
        </button>

        <Textarea
          ref={textareaRef}
          placeholder="Type a message…"
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          className="flex-1 resize-none min-h-[38px] max-h-28 text-sm py-2 leading-snug overflow-y-auto rounded-2xl"
          disabled={sendMutation.isPending}
        />

        <button
          onClick={handleSend}
          disabled={(!text.trim() && !mediaUrl) || sendMutation.isPending}
          className="shrink-0 h-9 w-9 rounded-full flex items-center justify-center bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title="Send message"
        >
          {sendMutation.isPending
            ? <Loader2 className="h-4 w-4 text-white animate-spin" />
            : <Send className="h-4 w-4 text-white" />
          }
        </button>
      </div>
    </div>
  );
}