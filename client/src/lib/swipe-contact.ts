/** Shared swipe actions for anyone you might want to reach from a list row: Call and WhatsApp (each only when a usable number exists). */
import { Phone, MessageCircle } from "lucide-react";
import type { SwipeAction } from "@/components/ui/swipe-row";
import { toWhatsAppNumber } from "@/components/contact-actions";

export function contactSwipeActions(phone?: string | null, greetingName?: string | null): SwipeAction[] {
  const wa = toWhatsAppNumber(phone);
  return [
    { key: "call", label: "Call", icon: Phone, tone: "emerald", hidden: !phone, onAction: () => { if (phone) window.open(`tel:${phone}`, "_self"); } },
    {
      key: "wa", label: "WhatsApp", icon: MessageCircle, tone: "green", hidden: !wa,
      onAction: () => { if (wa) window.open(`https://wa.me/${wa}${greetingName ? `?text=${encodeURIComponent(`Hello ${greetingName}, `)}` : ""}`, "_blank"); },
    },
  ];
}
