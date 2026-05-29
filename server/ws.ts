/**
 * SmartProp WebSocket Server
 * ─────────────────────────
 * Provides real-time push events to authenticated browser clients.
 *
 * Connection flow:
 *   1. Client opens ws://host/ws?token=<JWT>
 *   2. Server verifies token, stores connection keyed by userId + orgId
 *   3. Server emits typed events whenever domain state changes
 *
 * Event catalogue (all payloads wrapped in { type, payload, ts }):
 *   maintenance:updated   — maintenance request status / assignment changed
 *   payment:confirmed     — rent payment marked paid / completed
 *   payment:overdue       — payment became overdue
 *   message:new           — a new in-app message was received
 *   broadcast             — org-wide admin announcement
 *   ping                  — keepalive (server → client every 30 s)
 *
 * Client → server messages:
 *   { type: "pong" }      — reply to keepalive (prevents timeout)
 */

import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import type { Server } from "http";
import jwt from "jsonwebtoken";
import type { CustomJWTPayload } from "./types/index.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type WsEventType =
  | "maintenance:updated"
  | "payment:confirmed"
  | "payment:overdue"
  | "message:new"
  | "whatsapp:inbound"
  | "whatsapp:status"
  | "whatsapp:read"
  | "broadcast"
  | "ping"
  | "error";

export interface WsEvent<T = unknown> {
  type: WsEventType;
  payload: T;
  ts: string; // ISO timestamp
}

interface AuthenticatedSocket extends WebSocket {
  userId: string;
  organizationId: number;
  role: string;
  isAlive: boolean;
}

// ─── Module-level state ───────────────────────────────────────────────────────

let wss: WebSocketServer | null = null;

/** All connected sockets, indexed by userId for fast targeted delivery */
const socketsByUser = new Map<string, Set<AuthenticatedSocket>>();

/** All connected sockets by orgId for org-wide broadcasts */
const socketsByOrg = new Map<number, Set<AuthenticatedSocket>>();

// ─── Auth helper ──────────────────────────────────────────────────────────────

function verifyToken(token: string): CustomJWTPayload | null {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    return jwt.verify(token, secret) as CustomJWTPayload;
  } catch {
    return null;
  }
}

function extractToken(req: IncomingMessage): string | null {
  // 1. Query-string: ws://host/ws?token=...
  const url = new URL(req.url ?? "/", "ws://localhost");
  const qs = url.searchParams.get("token");
  if (qs) return qs;

  // 2. Authorization header (for native clients)
  const auth = req.headers["authorization"];
  if (auth?.startsWith("Bearer ")) return auth.slice(7);

  return null;
}

// ─── Connection tracking ──────────────────────────────────────────────────────

function trackSocket(socket: AuthenticatedSocket) {
  const { userId, organizationId } = socket;

  if (!socketsByUser.has(userId)) socketsByUser.set(userId, new Set());
  socketsByUser.get(userId)!.add(socket);

  if (!socketsByOrg.has(organizationId)) socketsByOrg.set(organizationId, new Set());
  socketsByOrg.get(organizationId)!.add(socket);
}

function untrackSocket(socket: AuthenticatedSocket) {
  const { userId, organizationId } = socket;
  socketsByUser.get(userId)?.delete(socket);
  socketsByOrg.get(organizationId)?.delete(socket);
  if (socketsByUser.get(userId)?.size === 0) socketsByUser.delete(userId);
  if (socketsByOrg.get(organizationId)?.size === 0) socketsByOrg.delete(organizationId);
}

// ─── Send helpers ─────────────────────────────────────────────────────────────

function send<T>(socket: WebSocket, event: WsEvent<T>) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(event));
  }
}

function buildEvent<T>(type: WsEventType, payload: T): WsEvent<T> {
  return { type, payload, ts: new Date().toISOString() };
}

// ─── Public emit API (called from route handlers) ─────────────────────────────

/** Send an event to a specific user (all their open tabs/devices) */
export function emitToUser<T>(userId: string, type: WsEventType, payload: T) {
  const sockets = socketsByUser.get(userId);
  if (!sockets) return;
  const event = buildEvent(type, payload);
  for (const s of sockets) send(s, event);
}

/** Broadcast an event to every connected member of an organisation */
export function emitToOrg<T>(organizationId: number, type: WsEventType, payload: T) {
  const sockets = socketsByOrg.get(organizationId);
  if (!sockets) return;
  const event = buildEvent(type, payload);
  for (const s of sockets) send(s, event);
}

/** Shorthand helpers used by route handlers */
export function notifyMaintenanceUpdated(
  orgId: number,
  data: { id: number; status: string; title?: string; propertyName?: string; assignedToUserId?: string }
) {
  // Always notify org-wide (managers, admin dashboards)
  emitToOrg(orgId, "maintenance:updated", data);
  // Also notify the specifically assigned staff member so their portal updates instantly
  if (data.assignedToUserId) {
    emitToUser(data.assignedToUserId, "maintenance:updated", data);
  }
}

export function notifyPaymentConfirmed(
  orgId: number,
  data: { id: number; amount: number; tenantName?: string; invoiceNumber?: string }
) {
  emitToOrg(orgId, "payment:confirmed", data);
}

export function notifyPaymentOverdue(
  orgId: number,
  data: { id: number; amount: number; tenantName?: string; daysOverdue?: number }
) {
  emitToOrg(orgId, "payment:overdue", data);
}

export function notifyNewMessage(
  toUserId: string,
  data: { id: number; fromName: string; subject?: string; preview?: string }
) {
  emitToUser(toUserId, "message:new", data);
}

export function broadcastToOrg(orgId: number, message: string, meta?: Record<string, unknown>) {
  emitToOrg(orgId, "broadcast", { message, ...meta });
}

/** Push a new inbound WhatsApp message to all connected staff in the org */
export function notifyWhatsappInbound(
  orgId: number,
  data: { id: number; from: string; content: string; timestamp: string }
) {
  emitToOrg(orgId, "whatsapp:inbound", data);
}

/**
 * Push a delivery/read status update to all connected staff and the tenant.
 * Fired from the Meta webhook whenever a status callback arrives.
 *
 * payload:
 *   messageId   — the internal DB row id (resolved from metaMessageId)
 *   metaId      — the wamid Meta used in the callback (for reference)
 *   status      — "sent" | "delivered" | "read" | "failed"
 *   phone       — the recipient's phone number (so tenant chat can filter)
 *   timestamp   — ISO string from Meta's callback
 */
export function notifyWhatsappStatus(
  orgId: number,
  data: {
    messageId: number;
    metaId: string;
    status: string;
    phone: string;
    timestamp: string;
  }
) {
  emitToOrg(orgId, "whatsapp:status", data);
}

// ─── Server bootstrap ─────────────────────────────────────────────────────────

export function initWebSocketServer(httpServer: Server) {
  if (wss) return wss; // idempotent

  wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  // ── Keepalive heartbeat every 30 s ────────────────────────────────────────
  const heartbeat = setInterval(() => {
    wss!.clients.forEach((raw: WebSocket) => {
      const socket = raw as AuthenticatedSocket;
      if (!socket.isAlive) {
        socket.terminate();
        return;
      }
      socket.isAlive = false;
      send(socket, buildEvent("ping", { ts: new Date().toISOString() }));
    });
  }, 30_000);

  wss.on("close", () => clearInterval(heartbeat));

  // ── New connection ────────────────────────────────────────────────────────
  wss.on("connection", (raw: WebSocket, req: IncomingMessage) => {
    const socket = raw as AuthenticatedSocket;

    // 1. Auth
    const token = extractToken(req);
    if (!token) {
      send(socket, buildEvent("error", { message: "Missing auth token" }));
      socket.close(4001, "Unauthorized");
      return;
    }

    const decoded = verifyToken(token);
    if (!decoded || !decoded.organizationId) {
      send(socket, buildEvent("error", { message: "Invalid or expired token" }));
      socket.close(4001, "Unauthorized");
      return;
    }

    socket.userId = String(decoded.userId ?? decoded.sub ?? decoded.id ?? "");
    socket.organizationId = decoded.organizationId;
    socket.role = decoded.role ?? "user";
    socket.isAlive = true;

    trackSocket(socket);

    console.log(
      `[WS] +1 user=${socket.userId} org=${socket.organizationId} ` +
        `total=${wss!.clients.size}`
    );

    // 2. Handle incoming messages from client
    socket.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "pong") {
          socket.isAlive = true;
        }
      } catch {
        // ignore unparseable frames
      }
    });

    // 3. Cleanup on disconnect
    socket.on("close", () => {
      untrackSocket(socket);
      console.log(
        `[WS] -1 user=${socket.userId} org=${socket.organizationId} ` +
          `total=${wss!.clients.size}`
      );
    });

    socket.on("error", (err: Error) => {
      console.error(`[WS] socket error user=${socket.userId}:`, err.message);
    });
  });

  console.log("[WS] WebSocket server initialised on path /ws");
  return wss;
}

/** Graceful shutdown — call from process signal handlers */
export function closeWebSocketServer() {
  wss?.close();
  wss = null;
}