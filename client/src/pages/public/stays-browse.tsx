/**
 * client/src/pages/public/stays-browse.tsx
 *
 * Public, unauthenticated marketplace browse page — the "Airbnb-style"
 * discovery experience. Deliberately styled differently from the rest of
 * the app: this is a hospitality/travel booking moment for a stranger,
 * not an admin dashboard, so it leans warmer and more editorial while
 * keeping the brand's emerald accent for continuity.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Search, MapPin, Users as UsersIcon, Loader2, Home, Calendar, Camera } from "lucide-react";

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
  listingPhotos: string[];
  bedrooms: number | null;
  bathrooms: string | null;
  maxGuests: number;
  generalArea: string;
}

const FONT_IMPORT = "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=Inter:wght@400;500;600&display=swap";

function fmtPrice(rate: string, currency: string) {
  const n = Number(rate);
  return `${currency} ${n.toLocaleString()}`;
}

export default function StaysBrowsePage() {
  const [search, setSearch] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const datesInvalid = !!checkIn && !!checkOut && checkOut <= checkIn;

  const { data: listings = [], isLoading } = useQuery<PublicListing[]>({
    // Dates are part of the cache key deliberately — different date
    // ranges are genuinely different result sets, not the same query
    // re-rendered.
    queryKey: ["/api/public/stays", checkIn, checkOut],
    queryFn: async () => {
      const hasValidDates = checkIn && checkOut && !datesInvalid;
      const url = hasValidDates
        ? `/api/public/stays?checkIn=${checkIn}&checkOut=${checkOut}`
        : "/api/public/stays";
      const r = await fetch(url);
      if (!r.ok) return [];
      return r.json();
    },
  });

  const filtered = listings.filter(l =>
    !search.trim() ||
    l.listingTitle.toLowerCase().includes(search.toLowerCase()) ||
    l.description.toLowerCase().includes(search.toLowerCase())
  );

  // Carried through to the detail page so a guest who already picked dates
  // here doesn't have to re-select them on the next page.
  const dateParams = (checkIn && checkOut && !datesInvalid) ? `?checkIn=${checkIn}&checkOut=${checkOut}` : "";

  return (
    <div style={{ background: "#FBF9F4", height: "100vh", overflowY: "auto", color: "#1C1917" }}>
      <a href="/" style={{ display: "block", padding: "10px 24px", fontSize: 13, color: "#6B6560", textDecoration: "none", borderBottom: "1px solid #E7E2D9" }}>← Back to SmartProp</a>
      <link rel="stylesheet" href={FONT_IMPORT} />
      <style>{`
        .stays-serif { font-family: 'Fraunces', Georgia, serif; }
        .stays-sans { font-family: 'Inter', system-ui, sans-serif; }
        .stay-card { transition: transform 0.18s ease, box-shadow 0.18s ease; }
        .stay-card:hover { transform: translateY(-3px); box-shadow: 0 12px 28px rgba(28,25,23,0.12); }
        .stay-card:focus-within { outline: 2px solid #059669; outline-offset: 3px; }
        .stays-date-input { font-family: 'Inter', sans-serif; }
      `}</style>

      {/* Header */}
      <header style={{ borderBottom: "1px solid #E7E2D9" }} className="stays-sans">
        <div style={{ maxWidth: 1120, margin: "0 auto", padding: "20px 24px" }} className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div style={{ background: "#059669", width: 34, height: 34, borderRadius: 9 }} className="flex items-center justify-center">
              <Home className="w-4 h-4" color="white" />
            </div>
            <span className="stays-serif" style={{ fontSize: 20, fontWeight: 600 }}>SmartProp Stays</span>
          </div>
          <span style={{ fontSize: 13, color: "#6B6560" }}>Book direct — no fees, no middlemen</span>
        </div>
      </header>

      {/* Hero */}
      <section style={{ maxWidth: 1120, margin: "0 auto", padding: "56px 24px 32px" }} className="stays-sans">
        <h1 className="stays-serif" style={{ fontSize: 42, lineHeight: 1.1, fontWeight: 600, maxWidth: 640, marginBottom: 14 }}>
          Places to stay, direct from the people who own them.
        </h1>
        <p style={{ fontSize: 16, color: "#6B6560", maxWidth: 520, marginBottom: 28 }}>
          Every listing here is managed and confirmed by its actual owner — no anonymous hosts, no surprise fees at checkout.
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, maxWidth: 720 }}>
          <div style={{ position: "relative", flex: "1 1 260px" }}>
            <Search className="w-4 h-4" style={{ position: "absolute", left: 16, top: 14, color: "#6B6560" }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name or description…"
              style={{
                width: "100%", padding: "12px 16px 12px 44px", borderRadius: 12,
                border: "1px solid #E7E2D9", background: "white", fontSize: 15, outline: "none", boxSizing: "border-box",
              }}
              onFocus={e => e.currentTarget.style.borderColor = "#059669"}
              onBlur={e => e.currentTarget.style.borderColor = "#E7E2D9"}
            />
          </div>
          <div style={{ position: "relative", flex: "1 1 150px" }}>
            <Calendar className="w-3.5 h-3.5" style={{ position: "absolute", left: 14, top: 15, color: "#6B6560" }} />
            <input
              type="date" className="stays-date-input" value={checkIn}
              onChange={e => setCheckIn(e.target.value)}
              style={{ width: "100%", padding: "12px 12px 12px 38px", borderRadius: 12, border: "1px solid #E7E2D9", background: "white", fontSize: 14, outline: "none", boxSizing: "border-box" }}
              aria-label="Check-in date"
            />
          </div>
          <div style={{ position: "relative", flex: "1 1 150px" }}>
            <Calendar className="w-3.5 h-3.5" style={{ position: "absolute", left: 14, top: 15, color: "#6B6560" }} />
            <input
              type="date" className="stays-date-input" value={checkOut}
              onChange={e => setCheckOut(e.target.value)}
              style={{ width: "100%", padding: "12px 12px 12px 38px", borderRadius: 12, border: "1px solid #E7E2D9", background: "white", fontSize: 14, outline: "none", boxSizing: "border-box" }}
              aria-label="Check-out date"
            />
          </div>
        </div>
        {datesInvalid && <p style={{ fontSize: 12.5, color: "#B91C1C", marginTop: 8 }}>Check-out must be after check-in.</p>}
        {checkIn && checkOut && !datesInvalid && (
          <p style={{ fontSize: 12.5, color: "#6B6560", marginTop: 8 }}>Showing places free for those dates.</p>
        )}
      </section>

      {/* Listings grid */}
      <section style={{ maxWidth: 1120, margin: "0 auto", padding: "8px 24px 80px" }} className="stays-sans">
        {isLoading ? (
          <div className="flex items-center gap-2" style={{ color: "#6B6560", padding: "48px 0" }}>
            <Loader2 className="w-4 h-4 animate-spin" /> Loading places to stay…
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "64px 0", color: "#6B6560" }}>
            <MapPin className="w-8 h-8" style={{ margin: "0 auto 12px", opacity: 0.4 }} />
            <p>{checkIn && checkOut ? "Nothing's free for those dates right now." : "No listings match your search right now."}</p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 24 }}>
            {filtered.map(listing => (
              <Link key={listing.id} href={`/stay/${listing.slug}${dateParams}`}>
                <a className="stay-card" style={{ display: "block", borderRadius: 16, overflow: "hidden", background: "white", border: "1px solid #E7E2D9", textDecoration: "none", color: "inherit" }}>
                  <div style={{ position: "relative" }}>
                    <div style={{
                      aspectRatio: "4 / 3", background: listing.listingPhotos?.[0]
                        ? `url(${listing.listingPhotos[0]}) center/cover`
                        : "linear-gradient(135deg, #d1fae5, #a7f3d0)",
                    }} />
                    {(listing.listingPhotos?.length ?? 0) > 1 && (
                      <span style={{
                        position: "absolute", bottom: 8, right: 8, background: "rgba(0,0,0,0.6)", color: "white",
                        fontSize: 11.5, padding: "3px 8px", borderRadius: 20, display: "flex", alignItems: "center", gap: 4,
                      }}>
                        <Camera className="w-3 h-3" /> {listing.listingPhotos.length}
                      </span>
                    )}
                  </div>
                  <div style={{ padding: "16px 18px" }}>
                    <h3 className="stays-serif" style={{ fontSize: 17, fontWeight: 600, marginBottom: 2 }}>{listing.listingTitle}</h3>
                    <p style={{ fontSize: 12.5, color: "#6B6560", marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>
                      <MapPin className="w-3 h-3" style={{ flexShrink: 0 }} /> {listing.generalArea}
                      {listing.bedrooms != null && <> · {listing.bedrooms} bed</>}
                      {listing.bathrooms != null && <> · {listing.bathrooms} bath</>}
                      {" "}· sleeps {listing.maxGuests}
                    </p>
                    <p style={{ fontSize: 13.5, color: "#6B6560", marginBottom: 10, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {listing.description}
                    </p>
                    <div className="flex items-center justify-between">
                      <span style={{ fontSize: 15, fontWeight: 600 }}>{fmtPrice(listing.nightlyRate, listing.currency)}<span style={{ fontWeight: 400, color: "#6B6560" }}> / night</span></span>
                      <span style={{ fontSize: 12, color: "#6B6560", display: "flex", alignItems: "center", gap: 4 }}>
                        <UsersIcon className="w-3.5 h-3.5" /> {listing.minimumNights}–{listing.maximumNights} nights
                      </span>
                    </div>
                  </div>
                </a>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}