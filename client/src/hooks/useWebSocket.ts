/**
 * useWebSocket — connects to the SmartProp real-time server
 *
 * Usage:
 *   const { connected, lastEvent } = useWebSocket();
 *
 *   // React to a specific event type
 *   useWsEvent("maintenance:updated", (payload) => {
 *     queryClient.invalidateQueries({ queryKey: ["/api/maintenance-requests"] });
 *     toast({ title: `Maintenance #${payload.id} → ${payload.status}` });
 *   });
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

// ─── Types (mirror server/ws.ts) ─────────────────────────────────────────────

export type WsEventType =
  | "maintenance:updated"
  | "payment:confirmed"
  | "payment:overdue"
  | "message:new"
  | "whatsapp:inbound"
  | "whatsapp:status"
  | "broadcast"
  | "ping"
  | "error";

export interface WsEvent<T = unknown> {
  type: WsEventType;
  payload: T;
  ts: string;
}

// ─── Reconnect config ─────────────────────────────────────────────────────────

const RECONNECT_BASE_MS  = 1_000;   // 1 s
const RECONNECT_MAX_MS   = 30_000;  // 30 s
const RECONNECT_FACTOR   = 2;
const RECONNECT_JITTER   = 0.2;     // ±20% random jitter

/** Compute next reconnect delay with exponential backoff + jitter */
function backoffDelay(attempt: number): number {
  const exp    = Math.min(RECONNECT_BASE_MS * Math.pow(RECONNECT_FACTOR, attempt), RECONNECT_MAX_MS);
  const jitter = exp * RECONNECT_JITTER * (Math.random() * 2 - 1); // ±jitter%
  return Math.round(exp + jitter);
}

// ─── Internal singleton so we don't open multiple sockets ────────────────────

let sharedSocket:      WebSocket | null = null;
let sharedSocketToken: string   | null  = null;
let reconnectAttempt = 0;
let reconnectTimer:  ReturnType<typeof setTimeout> | null = null;
const listeners = new Map<WsEventType, Set<(payload: unknown) => void>>();

function clearReconnectTimer() {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function dispatch(raw: string) {
  try {
    const event: WsEvent = JSON.parse(raw);
    if (event.type === "ping") {
      sharedSocket?.send(JSON.stringify({ type: "pong" }));
      return;
    }
    listeners.get(event.type)?.forEach(fn => fn(event.payload));
    listeners.get("*" as WsEventType)?.forEach(fn => fn(event));
  } catch {
    // ignore malformed frames
  }
}

function connect(token: string) {
  // Clear any pending reconnect before opening a new connection
  clearReconnectTimer();

  if (
    sharedSocket &&
    sharedSocketToken === token &&
    (sharedSocket.readyState === WebSocket.OPEN ||
     sharedSocket.readyState === WebSocket.CONNECTING)
  ) {
    return sharedSocket;
  }

  if (sharedSocket && sharedSocket.readyState !== WebSocket.CLOSED) {
    sharedSocket.onclose = null; // prevent the close handler from scheduling a reconnect
    sharedSocket.close();
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url      = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
  const ws       = new WebSocket(url);

  sharedSocket      = ws;
  sharedSocketToken = token;

  ws.addEventListener("message", e => dispatch(e.data));

  ws.addEventListener("open", () => {
    reconnectAttempt = 0; // reset backoff on successful connection
    // Notify all useWebSocket hooks that we're connected
    listeners.get("__connected__" as WsEventType)?.forEach(fn => fn(true));
  });

  ws.addEventListener("close", () => {
    // Notify hooks we're disconnected
    listeners.get("__connected__" as WsEventType)?.forEach(fn => fn(false));

    // Don't reconnect if the tab is being unloaded or token is gone
    const currentToken = localStorage.getItem("access_token");
    if (!currentToken) return;

    const delay = backoffDelay(reconnectAttempt);
    reconnectAttempt++;
    reconnectTimer = setTimeout(() => connect(currentToken), delay);
  });

  ws.addEventListener("error", () => {
    // close event will fire after error and handle reconnect
  });

  return ws;
}

export function getOrCreateSocket(token: string): WebSocket {
  return connect(token);
}

// ─── Main hook ────────────────────────────────────────────────────────────────

export function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<WsEvent | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;

    connect(token);

    // Subscribe to connection-state changes
    const onConnected = (val: unknown) => setConnected(val as boolean);
    if (!listeners.has("__connected__" as WsEventType)) {
      listeners.set("__connected__" as WsEventType, new Set());
    }
    listeners.get("__connected__" as WsEventType)!.add(onConnected);

    // If socket is already open, reflect that immediately
    if (sharedSocket?.readyState === WebSocket.OPEN) setConnected(true);

    const onMessage = (e: MessageEvent) => {
      try {
        const event: WsEvent = JSON.parse(e.data);
        if (event.type !== "ping") setLastEvent(event);
      } catch {}
    };
    sharedSocket?.addEventListener("message", onMessage);

    return () => {
      listeners.get("__connected__" as WsEventType)?.delete(onConnected);
      sharedSocket?.removeEventListener("message", onMessage);
    };
  }, []);

  return { connected, lastEvent };
}

// ─── Scoped event hook ────────────────────────────────────────────────────────

export function useWsEvent<T = unknown>(
  eventType: WsEventType,
  handler: (payload: T) => void
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;

    connect(token);

    const fn = (payload: unknown) => handlerRef.current(payload as T);
    if (!listeners.has(eventType)) listeners.set(eventType, new Set());
    listeners.get(eventType)!.add(fn);

    return () => {
      listeners.get(eventType)?.delete(fn);
    };
  }, [eventType]);
}

// ─── Auto-invalidation hook ───────────────────────────────────────────────────
/**
 * Drop this once anywhere in your app (e.g. inside App.tsx or a layout
 * component) to automatically invalidate TanStack Query caches on WS events.
 *
 * Usage:  useWsQuerySync();
 */
export function useWsQuerySync() {
  const queryClient = useQueryClient();

  useWsEvent("maintenance:updated", () => {
    queryClient.invalidateQueries({ queryKey: ["/api/maintenance-requests"] });
    queryClient.invalidateQueries({ queryKey: ["/api/contractor-portal/work-orders"] });
  });

  useWsEvent("payment:confirmed", () => {
    queryClient.invalidateQueries({ queryKey: ["/api/rent-payments"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["/api/diaspora-portal/contracts"] });
  });

  useWsEvent("payment:overdue", () => {
    queryClient.invalidateQueries({ queryKey: ["/api/rent-payments"] });
    queryClient.invalidateQueries({ queryKey: ["/api/arrears"] });
  });

  useWsEvent("message:new", () => {
    queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
    queryClient.invalidateQueries({ queryKey: ["/api/contractor-portal/messages"] });
    queryClient.invalidateQueries({ queryKey: ["/api/diaspora-portal/messages"] });
    queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
  });

  useWsEvent("whatsapp:inbound", () => {
    queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/conversations"] });
    queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
  });

  useWsEvent("whatsapp:status", () => {
    queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/conversations"] });
  });

  useWsEvent("broadcast", () => {
    queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
  });
}


