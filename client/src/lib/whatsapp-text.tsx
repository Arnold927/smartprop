import * as React from "react";

/**
 * WhatsApp-style inline formatting for chat bubbles: *bold*, _italic_, ~strike~.
 * Messages are stored with those markers (they are sent through WhatsApp), and
 * showing them raw ("*Maintenance Request Received*") looks like a bug. Only
 * well-formed pairs on a single line are converted; anything else is left as typed.
 */
const TOKEN = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g;

export function renderWhatsAppText(text: string | null | undefined): React.ReactNode {
  if (!text) return text ?? null;
  return text.split(TOKEN).map((part, i) => {
    if (part.length > 2) {
      const inner = part.slice(1, -1);
      if (inner.trim() === inner) {
        if (part.startsWith("*") && part.endsWith("*")) return <strong key={i}>{inner}</strong>;
        if (part.startsWith("_") && part.endsWith("_")) return <em key={i}>{inner}</em>;
        if (part.startsWith("~") && part.endsWith("~")) return <s key={i}>{inner}</s>;
      }
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}
