/**
 * communications.tsx — one "Communications" area for Messages, WhatsApp and
 * Broadcast.
 *
 * Each tab keeps its own route (/messages, /whatsapp-integration,
 * /broadcast-messaging) so existing links, bookmarks and the unread badge keep
 * working; the section tab strip (components/layout/section-tabs.tsx) switches
 * between them. For admins and managers, where that strip is shown, the three
 * pages drop their separate page titles and render embedded under it. Every
 * other role only has Messages, which keeps its normal header.
 */
import { lazy, Suspense } from "react";
import { useAuth } from "@/hooks/useAuth";

const Messages            = lazy(() => import("@/pages/messages"));
const WhatsAppIntegration = lazy(() => import("@/pages/whatsapp-integration"));
const BroadcastMessaging  = lazy(() => import("@/pages/broadcast-messaging"));

export type CommunicationsTab = "messages" | "whatsapp" | "broadcast";

export default function Communications({ tab = "messages" }: { tab?: CommunicationsTab }) {
  const { user } = useAuth();
  const hasTabs = user?.role === "admin" || user?.role === "manager";

  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
      {tab === "whatsapp"  ? <WhatsAppIntegration embedded />
        : tab === "broadcast" ? <BroadcastMessaging embedded />
        : <Messages embedded={hasTabs} />}
    </Suspense>
  );
}
