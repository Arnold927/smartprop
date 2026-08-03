/**
 * client/src/pages/public/stay-detail.tsx
 *
 * Public listing detail + booking page — reachable either from the
 * marketplace browse page or as someone's own direct/shared link
 * (/stay/:slug works regardless of marketplace opt-in, matching the
 * backend's design). The calendar is the functional and visual center of
 * this page: it has to make "which dates are actually free" immediately
 * legible, since that's the one thing a guest needs before anything else.
 */
import { useState, useMemo, useEffect } from "react";
import { useParams, useSearch } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Check, Loader2, Users as UsersIcon, Home, MapPin } from "lucide-react";

interface PublicListing {
  id: number;
  slug: string;
  listingTitle: string;
  description: string;
  nightlyRate: string;
  currency: string;
  minimumNights: number;
  maximumNights: number;
  amenities: string[];
  houseRules: string;
  checkInTime: string;
  checkOutTime: string;
  listingPhotos: string[];
  bedrooms: number | null;
  bathrooms: string | null;
  sqft: number | null;
  maxGuests: number;
  generalArea: string;
}
interface BookedRange { checkInDate: string; checkOutDate: string; }

const FONT_IMPORT = "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=Inter:wght@400;500;600&display=swap";

function toDateOnly(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function isSameDay(a: Date, b: Date) { return a.getTime() === b.getTime(); }
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

function MonthGrid({
  monthDate, bookedDates, selection, onPick,
}: { monthDate: Date; bookedDates: Set<number>; selection: { start: Date | null; end: Date | null }; onPick: (d: Date) => void }) {
  const year = monthDate.getFullYear(), month = monthDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = toDateOnly(new Date());

  const cells: (Date | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));

  return (
    <div>
      <div className="stays-serif" style={{ fontSize: 15, fontWeight: 600, marginBottom: 10, textAlign: "center" }}>
        {monthDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} style={{ textAlign: "center", fontSize: 11, color: "#6B6560", padding: "2px 0" }}>{d}</div>
        ))}
        {cells.map((date, i) => {
          if (!date) return <div key={i} />;
          const dOnly = toDateOnly(date);
          const isPast = dOnly < today;
          const isBooked = bookedDates.has(dOnly.getTime());
          const isStart = selection.start && isSameDay(dOnly, selection.start);
          const isEnd = selection.end && isSameDay(dOnly, selection.end);
          const inRange = selection.start && selection.end && dOnly > selection.start && dOnly < selection.end;
          const disabled = isPast || isBooked;

          let bg = "transparent", color = "#1C1917";
          if (isStart || isEnd) { bg = "#059669"; color = "white"; }
          else if (inRange) { bg = "#d1fae5"; color = "#065F46"; }
          else if (disabled) { color = "#C4BFB6"; }

          return (
            <button
              key={i}
              disabled={disabled}
              onClick={() => onPick(dOnly)}
              style={{
                aspectRatio: "1", borderRadius: 8, border: "none", background: bg, color,
                fontSize: 13, cursor: disabled ? "not-allowed" : "pointer",
                textDecoration: isBooked ? "line-through" : "none",
              }}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function StayDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const searchString = useSearch();
  const [monthOffset, setMonthOffset] = useState(0);
  const [selection, setSelection] = useState<{ start: Date | null; end: Date | null }>(() => {
    const params = new URLSearchParams(searchString);
    const ciRaw = params.get("checkIn");
    const coRaw = params.get("checkOut");
    if (!ciRaw || !coRaw) return { start: null, end: null };
    const ci = new Date(ciRaw);
    const co = new Date(coRaw);
    if (isNaN(ci.getTime()) || isNaN(co.getTime()) || co <= ci) return { start: null, end: null };
    return { start: ci, end: co };
  });
  const [guest, setGuest] = useState({ guestName: "", guestEmail: "", guestPhone: "", guestCount: 1, specialRequests: "" });
  const [confirmed, setConfirmed] = useState<any>(null);
  const [activePhoto, setActivePhoto] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [paymentPhone, setPaymentPhone] = useState("");
  // idle: awaiting phone number. initiating: STK request in flight.
  // waiting: prompt sent, polling for the async callback. paid: confirmed.
  // error: something went wrong. unavailable: no configured payment method
  // for this listing at all (see the multi-country note below).
  const [paymentState, setPaymentState] = useState<"idle" | "initiating" | "waiting" | "paid" | "error" | "unavailable">("idle");
  const [paymentErrorMsg, setPaymentErrorMsg] = useState<string | null>(null);

  const { data: listing, isLoading } = useQuery<PublicListing>({
    queryKey: [`/api/public/stays/${slug}`],
    queryFn: async () => { const r = await fetch(`/api/public/stays/${slug}`); if (!r.ok) throw new Error("not found"); return r.json(); },
    enabled: !!slug,
  });

  const { data: booked = [] } = useQuery<BookedRange[]>({
    queryKey: [`/api/public/stays/${slug}/booked-dates`],
    queryFn: async () => { const r = await fetch(`/api/public/stays/${slug}/booked-dates`); if (!r.ok) return []; return r.json(); },
    enabled: !!slug,
  });

  const bookedDateSet = useMemo(() => {
    const set = new Set<number>();
    for (const b of booked) {
      let cur = toDateOnly(new Date(b.checkInDate));
      const end = toDateOnly(new Date(b.checkOutDate));
      while (cur < end) { set.add(cur.getTime()); cur = addDays(cur, 1); }
    }
    return set;
  }, [booked]);

  function handlePick(day: Date) {
    setFormError(null);
    if (!selection.start || (selection.start && selection.end)) {
      setSelection({ start: day, end: null });
      return;
    }
    if (day <= selection.start) { setSelection({ start: day, end: null }); return; }
    // Reject a range that steps over any booked date in between.
    let cur = addDays(selection.start, 1);
    while (cur < day) {
      if (bookedDateSet.has(cur.getTime())) { setFormError("Your selected range crosses an already-booked date — pick a shorter or different range."); return; }
      cur = addDays(cur, 1);
    }
    setSelection({ start: selection.start, end: day });
  }

  const nights = selection.start && selection.end ? Math.round((selection.end.getTime() - selection.start.getTime()) / 86400000) : 0;
  const total = listing && nights > 0 ? (Number(listing.nightlyRate) * nights) : 0;

  const bookMutation = useMutation({
    mutationFn: async () => {
      if (!selection.start || !selection.end) throw new Error("Select your check-in and check-out dates first.");
      const r = await fetch(`/api/public/stays/${slug}/book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...guest,
          guestCount: Number(guest.guestCount),
          checkInDate: selection.start.toISOString(),
          checkOutDate: selection.end.toISOString(),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || "Could not complete booking.");
      return data;
    },
    onSuccess: (data) => setConfirmed(data),
    onError: (err: any) => setFormError(err.message),
  });

  const payMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/public/stays/${slug}/bookings/${confirmed.id}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: paymentPhone }),
      });
      const data = await r.json();
      if (!r.ok) {
        if (data.code === "STK_NOT_CONFIGURED") { setPaymentState("unavailable"); }
        throw new Error(data.message || "Could not start payment.");
      }
      return data;
    },
    onSuccess: () => setPaymentState("waiting"),
    onError: (err: any) => {
      setPaymentErrorMsg(err.message);
      if (paymentState !== "unavailable") setPaymentState("error");
    },
  });

  // Poll for the async STK callback while waiting — Safaricom confirms
  // payment out-of-band, so there's no direct response to await here.
  useEffect(() => {
    if (paymentState !== "waiting" || !confirmed) return;
    let cancelled = false;
    const startedAt = Date.now();
    const interval = setInterval(async () => {
      if (cancelled) return;
      try {
        const r = await fetch(`/api/public/stays/${slug}/bookings/${confirmed.id}/status`);
        if (r.ok) {
          const data = await r.json();
          if (data.paymentStatus === "paid") {
            setPaymentState("paid");
            clearInterval(interval);
            return;
          }
          if (data.paymentStatus === "failed") {
            clearInterval(interval);
            setPaymentErrorMsg("That payment didn't go through — check the prompt was completed correctly and try again.");
            setPaymentState("error");
            return;
          }
        }
      } catch { /* transient network hiccup — just try again next tick */ }
      if (Date.now() - startedAt > 120_000) {
        clearInterval(interval);
        setPaymentErrorMsg("We haven't received confirmation yet. If you completed the M-Pesa prompt, this can take a minute to reflect — otherwise, try again below.");
        setPaymentState("error");
      }
    }, 4000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [paymentState, confirmed, slug]);

  if (isLoading) {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#6B6560" }}>
      <Loader2 className="w-5 h-5 animate-spin" />
    </div>;
  }
  if (!listing) {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#6B6560" }}>Listing not found.</div>;
  }

  const month1 = new Date(new Date().getFullYear(), new Date().getMonth() + monthOffset, 1);
  const month2 = new Date(new Date().getFullYear(), new Date().getMonth() + monthOffset + 1, 1);

  return (
    <div style={{ background: "#FBF9F4", height: "100vh", overflowY: "auto", color: "#1C1917" }}>
      <link rel="stylesheet" href={FONT_IMPORT} />
      <style>{`
        .stays-serif { font-family: 'Fraunces', Georgia, serif; }
        .stays-sans { font-family: 'Inter', system-ui, sans-serif; }
        .book-input { width: 100%; padding: 10px 12px; border-radius: 9px; border: 1px solid #E7E2D9; font-size: 14px; outline: none; font-family: 'Inter', sans-serif; }
        .book-input:focus { border-color: #059669; }
        @media (max-width: 860px) { .stay-layout { grid-template-columns: 1fr !important; } }
      `}</style>

      <header style={{ borderBottom: "1px solid #E7E2D9" }} className="stays-sans">
        <div style={{ maxWidth: 1120, margin: "0 auto", padding: "18px 24px" }} className="flex items-center justify-between gap-2">
          <a href="/stays" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none", color: "inherit" }}>
            <div style={{ background: "#059669", width: 30, height: 30, borderRadius: 8 }} className="flex items-center justify-center">
              <Home className="w-3.5 h-3.5" color="white" />
            </div>
            <span className="stays-serif" style={{ fontSize: 17, fontWeight: 600 }}>SmartProp Stays</span>
          </a>
          <a href="/stays" style={{ fontSize: 13, color: "#6B6560", textDecoration: "none" }}>← Back to listings</a>
        </div>
      </header>

      <div style={{
        aspectRatio: "21 / 8", background: listing.listingPhotos?.[activePhoto]
          ? `url(${listing.listingPhotos[activePhoto]}) center/cover`
          : "linear-gradient(135deg, #d1fae5, #a7f3d0)",
      }} />
      {(listing.listingPhotos?.length ?? 0) > 1 && (
        <div className="stays-sans" style={{ maxWidth: 1120, margin: "0 auto", padding: "10px 24px 0", display: "flex", gap: 8, overflowX: "auto" }}>
          {listing.listingPhotos.map((url, i) => (
            <button
              key={url + i}
              onClick={() => setActivePhoto(i)}
              style={{
                flex: "0 0 auto", width: 72, height: 54, borderRadius: 8, border: i === activePhoto ? "2px solid #059669" : "2px solid transparent",
                background: `url(${url}) center/cover`, cursor: "pointer", padding: 0, opacity: i === activePhoto ? 1 : 0.7,
              }}
              aria-label={`View photo ${i + 1}`}
            />
          ))}
        </div>
      )}

      <div className="stay-layout stays-sans" style={{ maxWidth: 1120, margin: "0 auto", padding: "36px 24px 80px", display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 48 }}>
        {/* Left: details + calendar */}
        <div>
          <h1 className="stays-serif" style={{ fontSize: 30, fontWeight: 600, marginBottom: 6 }}>{listing.listingTitle}</h1>
          <p style={{ fontSize: 14, color: "#6B6560", marginBottom: 6, display: "flex", alignItems: "center", gap: 5 }}>
            <MapPin className="w-3.5 h-3.5" style={{ flexShrink: 0 }} /> {listing.generalArea}
            {listing.bedrooms != null && <> · {listing.bedrooms} bedroom{listing.bedrooms === 1 ? "" : "s"}</>}
            {listing.bathrooms != null && <> · {listing.bathrooms} bathroom{Number(listing.bathrooms) === 1 ? "" : "s"}</>}
            {listing.sqft != null && <> · {listing.sqft} sqft</>}
          </p>
          <p style={{ fontSize: 14, color: "#6B6560", marginBottom: 4 }}>
            Check-in {listing.checkInTime} · Check-out {listing.checkOutTime} · {listing.minimumNights}–{listing.maximumNights} night stays
          </p>
          <p style={{ fontSize: 15.5, lineHeight: 1.6, margin: "20px 0" }}>{listing.description}</p>

          {listing.amenities?.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <h3 className="stays-serif" style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>Amenities</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
                {listing.amenities.map((a, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 14 }}>
                    <Check className="w-3.5 h-3.5" color="#059669" /> {a}
                  </div>
                ))}
              </div>
            </div>
          )}

          {listing.houseRules && (
            <div style={{ marginBottom: 32 }}>
              <h3 className="stays-serif" style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>House rules</h3>
              <p style={{ fontSize: 14, color: "#6B6560", lineHeight: 1.6, whiteSpace: "pre-line" }}>{listing.houseRules}</p>
            </div>
          )}

          <div style={{ border: "1px solid #E7E2D9", borderRadius: 16, padding: 20, background: "white" }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
              <h3 className="stays-serif" style={{ fontSize: 16, fontWeight: 600 }}>Select your dates</h3>
              <div className="flex items-center gap-2">
                <button onClick={() => setMonthOffset(m => Math.max(0, m - 1))} style={{ border: "1px solid #E7E2D9", borderRadius: 7, padding: 5, background: "white", cursor: "pointer" }}><ChevronLeft className="w-3.5 h-3.5" /></button>
                <button onClick={() => setMonthOffset(m => m + 1)} style={{ border: "1px solid #E7E2D9", borderRadius: 7, padding: 5, background: "white", cursor: "pointer" }}><ChevronRight className="w-3.5 h-3.5" /></button>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28 }}>
              <MonthGrid monthDate={month1} bookedDates={bookedDateSet} selection={selection} onPick={handlePick} />
              <MonthGrid monthDate={month2} bookedDates={bookedDateSet} selection={selection} onPick={handlePick} />
            </div>
            <p style={{ fontSize: 12, color: "#6B6560", marginTop: 14 }}>Click a start date, then an end date. Booked dates are shown crossed out.</p>
          </div>
        </div>

        {/* Right: sticky booking form */}
        <div style={{ position: "sticky", top: 24, alignSelf: "start" }}>
          <div style={{ border: "1px solid #E7E2D9", borderRadius: 16, padding: 22, background: "white" }}>
            {confirmed ? (
              <div>
                {paymentState === "paid" ? (
                  <>
                    <div style={{ width: 44, height: 44, borderRadius: 22, background: "#d1fae5", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
                      <Check className="w-5 h-5" color="#065F46" />
                    </div>
                    <h3 className="stays-serif" style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>Payment confirmed</h3>
                    <p style={{ fontSize: 14, color: "#6B6560", marginBottom: 4 }}>Reference: <strong>{confirmed.bookingReference}</strong></p>
                    <p style={{ fontSize: 14, color: "#6B6560", marginBottom: 8 }}>
                      {confirmed.numberOfNights} night(s) · {listing.currency} {Number(confirmed.totalAmount).toLocaleString()} paid
                    </p>
                    <p style={{ fontSize: 12.5, color: "#6B6560" }}>The exact address will be shared with you directly by the host ahead of your stay.</p>
                    <a href="/manage-booking" style={{ fontSize: 12.5, color: "#059669", display: "block", marginTop: 8 }}>Need to view or cancel this later? Manage your booking →</a>
                  </>
                ) : paymentState === "waiting" ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" color="#059669" style={{ marginBottom: 14 }} />
                    <h3 className="stays-serif" style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>Check your phone</h3>
                    <p style={{ fontSize: 14, color: "#6B6560" }}>Enter your M-Pesa PIN on the prompt sent to {paymentPhone} to complete this booking.</p>
                  </>
                ) : paymentState === "unavailable" ? (
                  <>
                    <h3 className="stays-serif" style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>Booking held</h3>
                    <p style={{ fontSize: 14, color: "#6B6560", marginBottom: 4 }}>Reference: <strong>{confirmed.bookingReference}</strong></p>
                    <p style={{ fontSize: 14, color: "#6B6560" }}>
                      Automatic payment isn't set up for this listing yet — contact the host directly to arrange payment for {listing.currency} {Number(confirmed.totalAmount).toLocaleString()}.
                    </p>
                  </>
                ) : (
                  <>
                    <h3 className="stays-serif" style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>Booking held — pay to confirm</h3>
                    <p style={{ fontSize: 14, color: "#6B6560", marginBottom: 4 }}>Reference: <strong>{confirmed.bookingReference}</strong></p>
                    <p style={{ fontSize: 14, color: "#6B6560", marginBottom: 14 }}>
                      {confirmed.numberOfNights} night(s) · {listing.currency} {Number(confirmed.totalAmount).toLocaleString()} total
                    </p>
                    <input
                      className="book-input" placeholder="M-Pesa phone, e.g. 07XXXXXXXX"
                      value={paymentPhone} onChange={e => setPaymentPhone(e.target.value)}
                    />
                    {paymentErrorMsg && <p style={{ color: "#B91C1C", fontSize: 13, marginTop: 8 }}>{paymentErrorMsg}</p>}
                    <button
                      onClick={() => { setPaymentErrorMsg(null); setPaymentState("initiating"); payMutation.mutate(); }}
                      disabled={payMutation.isPending || !paymentPhone}
                      style={{
                        width: "100%", marginTop: 12, padding: "12px 0", borderRadius: 10, border: "none",
                        background: "#059669", color: "white", fontSize: 14.5, fontWeight: 600, cursor: "pointer",
                        opacity: (payMutation.isPending || !paymentPhone) ? 0.6 : 1,
                      }}
                    >
                      {payMutation.isPending ? "Sending prompt…" : "Pay with M-Pesa"}
                    </button>
                    <p style={{ fontSize: 12, color: "#6B6560", marginTop: 10 }}>Your dates are held while you complete payment, but not guaranteed until it's confirmed.</p>
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="stays-serif" style={{ fontSize: 22, fontWeight: 600, marginBottom: 2 }}>
                  {listing.currency} {Number(listing.nightlyRate).toLocaleString()}<span style={{ fontSize: 14, fontWeight: 400, color: "#6B6560" }}> / night</span>
                </div>
                {nights > 0 && (
                  <p style={{ fontSize: 13.5, color: "#6B6560", marginBottom: 16 }}>
                    {nights} night(s) · <strong style={{ color: "#1C1917" }}>{listing.currency} {total.toLocaleString()}</strong> total
                  </p>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
                  <input className="book-input" placeholder="Full name" value={guest.guestName} onChange={e => setGuest(g => ({ ...g, guestName: e.target.value }))} />
                  <input className="book-input" placeholder="Email" type="email" value={guest.guestEmail} onChange={e => setGuest(g => ({ ...g, guestEmail: e.target.value }))} />
                  <input className="book-input" placeholder="Phone (e.g. 07XXXXXXXX)" value={guest.guestPhone} onChange={e => setGuest(g => ({ ...g, guestPhone: e.target.value }))} />
                  <div className="flex items-center gap-2">
                    <UsersIcon className="w-4 h-4" color="#6B6560" />
                    <input
                      className="book-input" type="number" min={1} max={listing.maxGuests} placeholder="Guests"
                      value={guest.guestCount}
                      onChange={e => setGuest(g => ({ ...g, guestCount: Math.min(Number(e.target.value), listing.maxGuests) }))}
                    />
                  </div>
                  <p style={{ fontSize: 12, color: "#6B6560", marginTop: -4 }}>Sleeps up to {listing.maxGuests} guest{listing.maxGuests === 1 ? "" : "s"}.</p>
                  <textarea className="book-input" placeholder="Special requests (optional)" rows={2} value={guest.specialRequests} onChange={e => setGuest(g => ({ ...g, specialRequests: e.target.value }))} />
                </div>
                {formError && <p style={{ color: "#B91C1C", fontSize: 13, marginTop: 10 }}>{formError}</p>}
                <button
                  onClick={() => bookMutation.mutate()}
                  disabled={bookMutation.isPending || !selection.start || !selection.end || !guest.guestName || !guest.guestEmail || !guest.guestPhone}
                  style={{
                    width: "100%", marginTop: 16, padding: "12px 0", borderRadius: 10, border: "none",
                    background: "#059669", color: "white", fontSize: 14.5, fontWeight: 600, cursor: "pointer",
                    opacity: (bookMutation.isPending || !selection.start || !selection.end) ? 0.6 : 1,
                  }}
                >
                  {bookMutation.isPending ? "Requesting…" : "Request to book"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}