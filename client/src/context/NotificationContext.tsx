import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useWsEvent } from "@/hooks/useWebSocket";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";

export interface Notification {
  id: string;
  type: "maintenance" | "payment" | "message" | "system";
  title: string;
  message: string;
  ts: string;
  read: boolean;
  link?: string;
  meta?: Record<string, unknown>;
}

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  dismissNotification: (id: string) => void;
  clearAll: () => void;
  replyToNotification: (id: string, content: string) => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const { isAuthenticated } = useAuth();
  
  // Fetch initial notifications from API
  const { data: initialData } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
    queryFn: async () => {
      try {
        const res = await apiRequest("/api/notifications");
        return res.json();
      } catch {
        return [];
      }
    },
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (initialData) {
      setNotifications(initialData);
    }
  }, [initialData]);

  // ── c) Reconnect WebSocket when tab becomes visible again ─────────────────
  // Browsers throttle/suspend connections in background tabs.
  // When the user returns to the tab, force a fresh connection so they
  // receive any notifications that fired while they were away.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        const token = localStorage.getItem("access_token");
        if (token) {
          // Import dynamically to avoid circular deps
          import("@/hooks/useWebSocket").then(({ getOrCreateSocket }) => {
            getOrCreateSocket(token);
          }).catch(() => {});
        }
        // Also refetch notifications from server in case we missed any
        apiRequest("/api/notifications").then(r => r.json()).then(data => {
          if (Array.isArray(data)) setNotifications(data);
        }).catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  const addNotification = useCallback((notif: Omit<Notification, "id" | "read">) => {
    const newNotif: Notification = {
      ...notif,
      id: Math.random().toString(36).substring(7),
      read: false,
    };
    setNotifications(prev => [newNotif, ...prev]);
    
    // Show toast for new notification
    toast({
      title: newNotif.title,
      description: newNotif.message,
    });
  }, [toast]);

  // Real-time WebSocket listeners
  useWsEvent("maintenance:updated", (payload: any) => {
    addNotification({
      type: "maintenance",
      title: "Maintenance Update",
      message: `Request #${payload.id} is now ${payload.status.replace("_", " ")}`,
      ts: new Date().toISOString(),
      link: `/maintenance/${payload.id}`,
    });
  });

  useWsEvent("payment:confirmed", (payload: any) => {
    addNotification({
      type: "payment",
      title: "Payment Confirmed",
      message: `Payment of ${payload.amount} for Unit ${payload.unitNumber} confirmed.`,
      ts: new Date().toISOString(),
      link: "/finances",
    });
  });

  useWsEvent("message:new", (payload: any) => {
    addNotification({
      type: "message",
      title: "New Message",
      message: `From ${payload.fromName ?? payload.senderName ?? "Someone"}: ${payload.subject ?? payload.preview ?? ""}`,
      ts: new Date().toISOString(),
      link: "/messages",
    });
    queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
  });

  useWsEvent("whatsapp:inbound", (payload: any) => {
    addNotification({
      type: "message",
      title: "WhatsApp Reply",
      message: `${payload.from ?? "Tenant"}: ${payload.content ?? ""}`,
      ts: new Date().toISOString(),
      link: "/whatsapp-integration",
    });
    queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/conversations"] });
  });

  useWsEvent("broadcast", (payload: any) => {
    addNotification({
      type: "system",
      title: payload.title ?? "Broadcast Message",
      message: payload.message ?? "",
      ts: new Date().toISOString(),
      link: "/broadcast-messaging",
    });
  });

  const markAsRead = useCallback((id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    apiRequest(`/api/notifications/${id}/read`, { method: "POST" }).catch(() => {});
  }, []);

  const markAllAsRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    apiRequest("/api/notifications/read-all", { method: "POST" }).catch(() => {});
  }, []);

  const dismissNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
    apiRequest(`/api/notifications/${id}/read`, { method: "POST" }).catch(() => {});
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
    apiRequest("/api/notifications", { method: "DELETE" }).catch(() => {});
  }, []);

  const replyToNotification = useCallback(async (id: string, content: string) => {
    const res = await apiRequest(`/api/notifications/${id}/reply`, {
      method: "POST",
      data: { content },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any).message ?? "Failed to send reply");
    }
    // Mark as read locally after successful reply
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  }, []);

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, markAsRead, markAllAsRead, dismissNotification, clearAll, replyToNotification }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    // Return a safe no-op fallback rather than crashing — this can happen
    // during HMR or if a component tree mounts before the provider is ready.
    console.warn("useNotifications used outside NotificationProvider — returning fallback");
    return {
      notifications: [] as Notification[],
      unreadCount: 0,
      markAsRead: (_id: string) => {},
      markAllAsRead: () => {},
      dismissNotification: (_id: string) => {},
      clearAll: () => {},
      replyToNotification: async (_id: string, _content: string) => {},
    };
  }
  return context;
}