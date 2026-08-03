/**
 * client/src/pages/public/manage-booking.tsx
 *
 * Public, unauthenticated booking lookup/cancellation — a guest's only
 * proof of booking was previously a reference number shown once with no
 * way back to it. This is that way back: reference + the email they
 * booked with (both required, so a guessed reference alone can't expose
 * or cancel someone else's booking).
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, Home, Search, XCircle, CheckCircle } from "lucide-react";

const FONT_IMPORT = "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=Inter:wght@400;500;600&display=swap";

interface LookupResult {
  bookingReference: string;
  listingTitle: string;
  listingSlug: string | null;
  checkInDate: string;
  checkOutDate: string;
  numberOfNights: number;
  totalAmount: string;
  currency: string;
  bookingStatus: string;
  paymentStatus: string;
  refundStatus: string;
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function ManageBookingPage() {
  const [reference, setReference] = useState("");
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState<{ reference: string; email: string } | null>(null);
  const [cancelled, setCancelled] = useState(false);

  const { data: booking, isLoading, isError, error } = useQuery<LookupResult>({
    queryKey: ["manage-booking-lookup", submitted?.reference, submitted?.email],
    queryFn: async () => {
      const params = new URLSearchParams({ bookingReference: submitted!.reference, guestEmail: submitted!.email });
      const r = await fetch(`/api/public/stays/bookings/lookup?${params}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || "Booking not found.");
      return data;
    },
    enabled: !!submitted,
    retry: false,
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/public/stays/bookings/${submitted!.reference}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestEmail: submitted!.email }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || "Could not cancel this booking.");
      return data;
    },
    onSuccess: () => setCancelled(true),
  });

  return (
    <div style={{ background: "#FBF9F4", height: "100vh", overflowY: "auto", color: "#1C1917" }}>
      <link rel="stylesheet" href={FONT_IMPORT} />
      <style>{`
        .stays-serif { font-family: 'Fraunces', Georgia, serif; }
        .stays-sans { font-family: 'Inter', system-ui, sans-serif; }
        .book-input { width: 100%; padding: 10px 12px; border-radius: 9px; border: 1px solid #E7E2D9; font-size: 14px; outline: none; font-family: 'Inter', sans-serif; box-sizing: border-box; }
        .book-input:focus { border-color: #059669; }
      `}</style>

      <a href="/" style={{ display: "block", padding: "10px 24px", fontSize: 13, color: "#6B6560", textDecoration: "none", borderBottom: "1px solid #E7E2D9" }}>← Back to SmartProp</a>

      <header style={{ borderBottom: "1px solid #E7E2D9" }} className="stays-sans">
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "18px 24px" }} className="flex items-center gap-2">
          <a href="/stays" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none", color: "inherit" }}>
            <div style={{ background: "#059669", width: 30, height: 30, borderRadius: 8 }} className="flex items-center justify-center">
              <Home className="w-3.5 h-3.5" color="white" />
            </div>
            <span className="stays-serif" style={{ fontSize: 17, fontWeight: 600 }}>SmartProp Stays</span>
          </a>
        </div>
      </header>

      <div className="stays-sans" style={{ maxWidth: 480, margin: "0 auto", padding: "48px 24px 80px" }}>
        <h1 className="stays-serif" style={{ fontSize: 28, fontWeight: 600, marginBottom: 8 }}>Manage your booking</h1>
        <p style={{ fontSize: 14.5, color: "#6B6560", marginBottom: 28 }}>
          Enter your booking reference and the email you booked with to look up or cancel your stay.
        </p>

        {!submitted || isError ? (
          <div style={{ border: "1px solid #E7E2D9", borderRadius: 16, padding: 22, background: "white" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input className="book-input" placeholder="Booking reference (e.g. BK-1234567890-ABCDE)" value={reference} onChange={e => setReference(e.target.value)} />
              <input className="book-input" placeholder="Email you booked with" type="email" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            {isError && <p style={{ color: "#B91C1C", fontSize: 13, marginTop: 10 }}>{(error as Error)?.message}</p>}
            <button
              onClick={() => { setCancelled(false); setSubmitted({ reference: reference.trim(), email: email.trim() }); }}
              disabled={!reference.trim() || !email.trim() || isLoading}
              style={{
                width: "100%", marginTop: 14, padding: "12px 0", borderRadius: 10, border: "none",
                background: "#059669", color: "white", fontSize: 14.5, fontWeight: 600, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                opacity: (!reference.trim() || !email.trim() || isLoading) ? 0.6 : 1,
              }}
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {isLoading ? "Looking up…" : "Find my booking"}
            </button>
          </div>
        ) : (
          <div style={{ border: "1px solid #E7E2D9", borderRadius: 16, padding: 22, background: "white" }}>
            {isLoading ? (
              <div className="flex items-center gap-2" style={{ color: "#6B6560" }}><Loader2 className="w-4 h-4 animate-spin" /> Looking up your booking…</div>
            ) : booking ? (
              <>
                <h3 className="stays-serif" style={{ fontSize: 19, fontWeight: 600, marginBottom: 4 }}>{booking.listingTitle}</h3>
                <p style={{ fontSize: 13.5, color: "#6B6560", marginBottom: 14 }}>Reference: <strong>{booking.bookingReference}</strong></p>
                <div style={{ fontSize: 14, marginBottom: 4 }}>{fmtDate(booking.checkInDate)} → {fmtDate(booking.checkOutDate)} · {booking.numberOfNights} night(s)</div>
                <div style={{ fontSize: 14, marginBottom: 14 }}>{booking.currency} {Number(booking.totalAmount).toLocaleString()} total</div>

                <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 20, background: "#f3f4f6", color: "#374151" }}>
                    Status: {booking.bookingStatus}
                  </span>
                  <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 20, background: "#f3f4f6", color: "#374151" }}>
                    Payment: {booking.paymentStatus}
                  </span>
                  {booking.refundStatus !== "none" && (
                    <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 20, background: booking.refundStatus === "owed" ? "#fef3c7" : "#d1fae5", color: booking.refundStatus === "owed" ? "#92400e" : "#065f46" }}>
                      Refund: {booking.refundStatus}
                    </span>
                  )}
                </div>

                {cancelled || booking.bookingStatus === "cancelled" ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#065F46", fontSize: 14 }}>
                    <CheckCircle className="w-4 h-4" /> This booking is cancelled.
                    {booking.paymentStatus === "paid" && " Your refund is being processed by the host."}
                  </div>
                ) : booking.bookingStatus === "checked_out" ? (
                  <p style={{ fontSize: 14, color: "#6B6560" }}>This stay has already been completed.</p>
                ) : (
                  <button
                    onClick={() => { if (confirm("Cancel this booking? This can't be undone.")) cancelMutation.mutate(); }}
                    disabled={cancelMutation.isPending}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                      width: "100%", padding: "11px 0", borderRadius: 10, border: "1px solid #fecaca",
                      background: "white", color: "#B91C1C", fontSize: 14, fontWeight: 600, cursor: "pointer",
                    }}
                  >
                    <XCircle className="w-4 h-4" /> {cancelMutation.isPending ? "Cancelling…" : "Cancel this booking"}
                  </button>
                )}
                {cancelMutation.isError && <p style={{ color: "#B91C1C", fontSize: 13, marginTop: 10 }}>{(cancelMutation.error as Error)?.message}</p>}

                <button onClick={() => setSubmitted(null)} style={{ marginTop: 14, fontSize: 13, color: "#6B6560", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
                  Look up a different booking
                </button>
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}