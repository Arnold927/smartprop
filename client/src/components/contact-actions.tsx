import { Mail, MessageCircle, Phone } from "lucide-react";
import { cn } from "@/lib/utils";

/** Turn 0712 345 678 / 712345678 / +254 712 345 678 into 254712345678 (wa.me format). */
export function toWhatsAppNumber(raw?: string | null): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0") && d.length === 10) d = "254" + d.slice(1);   // 07xx / 01xx
  else if ((d.startsWith("7") || d.startsWith("1")) && d.length === 9) d = "254" + d;
  return /^\d{10,15}$/.test(d) ? d : null;
}

interface ContactActionsProps {
  phone?: string | null;
  email?: string | null;
  /** Used to open WhatsApp with a greeting already typed. */
  name?: string;
  /** Pre-filled WhatsApp text; defaults to a short greeting. */
  message?: string;
  /** "icons" = compact round buttons (tables/cards), "buttons" = labelled (panels). */
  variant?: "icons" | "buttons";
  className?: string;
}

/**
 * Tap-to-call, WhatsApp and email in one place. These are plain links, so they
 * work on phones without any JavaScript: the dialler, WhatsApp and the mail
 * app open directly. Buttons for missing details are simply not shown.
 */
export function ContactActions({ phone, email, name, message, variant = "icons", className }: ContactActionsProps) {
  const wa = toWhatsAppNumber(phone);
  const text = message ?? (name ? `Hello ${name.split(" ")[0]}, ` : "Hello, ");
  const base = variant === "icons"
    ? "inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background hover:bg-muted transition-colors"
    : "inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted transition-colors";
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className={cn("flex items-center gap-2", className)} onClick={stop}>
      {phone && (
        <a href={`tel:${phone.replace(/\s/g, "")}`} className={base} aria-label={`Call ${name ?? "tenant"}`} title="Call">
          <Phone className="h-4 w-4 text-blue-600" />{variant === "buttons" && "Call"}
        </a>
      )}
      {wa && (
        <a href={`https://wa.me/${wa}?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer"
           className={base} aria-label={`WhatsApp ${name ?? "tenant"}`} title="WhatsApp">
          <MessageCircle className="h-4 w-4 text-emerald-600" />{variant === "buttons" && "WhatsApp"}
        </a>
      )}
      {email && (
        <a href={`mailto:${email}`} className={base} aria-label={`Email ${name ?? "tenant"}`} title="Email">
          <Mail className="h-4 w-4 text-amber-700" />{variant === "buttons" && "Email"}
        </a>
      )}
    </div>
  );
}
