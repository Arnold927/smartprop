import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, addDays, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isWithinInterval, parseISO, getDay } from "date-fns";
import {
  Plus, Home, Calendar, TrendingUp, DollarSign, Users, CheckCircle, XCircle,
  Clock, Star, Camera, Bed, Wifi, Car, Utensils, Dumbbell, Waves,
  MapPin, ChevronLeft, ChevronRight, ExternalLink, Filter, Search,
  ArrowUpRight, ArrowDownRight, Zap, Shield, Phone, Mail, Info,
  BarChart2, PieChart, Download, RefreshCw, Eye, Edit2, MoreVertical, Trash2,
  Globe, Lock, Unlock, AlertCircle, ThumbsUp
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { formatCurrency } from "@shared/currency";
import type { CurrencyCode } from "@shared/schema";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";

// ─── Types ───────────────────────────────────────────────────────────────────

interface TenantShortRental {
  id: number;
  unitId: number;
  tenantId: number | null;
  ownerId: string | null;
  listingTitle: string;
  description: string;
  nightlyRate: string;
  currency: CurrencyCode;
  minimumNights: number;
  maximumNights: number;
  maxGuests: number;
  landlordNotifiedAt?: string | null;
  landlordConsentConfirmed: boolean;
  amenities: string[];
  houseRules: string;
  checkInTime: string;
  checkOutTime: string;
  listingPhotos: string[];
  isActive: boolean;
  isPubliclyListed: boolean;
  slug: string | null;
  approvalStatus: string;
  approvedBy?: string;
  approvedAt?: string;
  calendarSyncEnabled: boolean;
  autoPricingEnabled: boolean;
  instantBookingEnabled: boolean;
  propertyManagerCommission: string;
  tenantEarningsShare: string;
  platformFees: string;
  notes?: string;
  createdAt: string;
}

interface ShortTermBooking {
  id: number;
  rentalListingId: number;
  bookingReference: string;
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  guestCount: number;
  checkInDate: string;
  checkOutDate: string;
  numberOfNights: number;
  nightlyRate: string;
  totalAmount: string;
  platformFees: string;
  propertyManagerCommission: string;
  tenantPayout: string;
  currency: CurrencyCode;
  bookingStatus: string;
  paymentStatus: string;
  refundStatus: string;
  refundAmount?: string | null;
  refundedAt?: string | null;
  platformSource: string;
  specialRequests?: string;
  checkInCode?: string;
  cleaningFee: number;
  securityDeposit: number;
  createdAt: string;
}

// ─── Amenity icon map ─────────────────────────────────────────────────────────

const AMENITY_ICONS: Record<string, React.ReactNode> = {
  "Wi-Fi": <Wifi className="h-3 w-3" />,
  "WiFi": <Wifi className="h-3 w-3" />,
  "Parking": <Car className="h-3 w-3" />,
  "Kitchen": <Utensils className="h-3 w-3" />,
  "Gym": <Dumbbell className="h-3 w-3" />,
  "Pool": <Waves className="h-3 w-3" />,
  "default": <Star className="h-3 w-3" />,
};

// ─── Badges ───────────────────────────────────────────────────────────────────

const StatusBadge = ({ status }: { status: string }) => {
  const variants: Record<string, { label: string; color: string }> = {
    pending: { label: "Pending Approval", color: "bg-amber-100 text-amber-800 border-amber-200" },
    approved: { label: "Approved", color: "bg-emerald-50 text-emerald-700 border border-emerald-200" },
    rejected: { label: "Rejected", color: "bg-red-100 text-red-800 border-red-200" },
    suspended: { label: "Suspended", color: "bg-slate-100 text-muted-foreground border-slate-200" },
  };
  const config = variants[status] || variants.pending;
  return <Badge className={`${config.color} border font-medium text-xs`}>{config.label}</Badge>;
};

const BookingStatusBadge = ({ status }: { status: string }) => {
  const variants: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    pending: { label: "Pending", color: "bg-amber-50 text-amber-700 border-amber-200", icon: <Clock className="h-3 w-3" /> },
    confirmed: { label: "Confirmed", color: "bg-blue-50 text-blue-700 border-blue-200", icon: <CheckCircle className="h-3 w-3" /> },
    checked_in: { label: "Checked In", color: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: <Unlock className="h-3 w-3" /> },
    checked_out: { label: "Checked Out", color: "bg-slate-100 text-muted-foreground border-slate-200", icon: <Lock className="h-3 w-3" /> },
    cancelled: { label: "Cancelled", color: "bg-red-50 text-red-700 border-red-200", icon: <XCircle className="h-3 w-3" /> },
    no_show: { label: "No Show", color: "bg-red-50 text-red-700 border-red-200", icon: <AlertCircle className="h-3 w-3" /> },
  };
  const config = variants[status] || variants.pending;
  return (
    <Badge className={`${config.color} border font-medium text-xs flex items-center gap-1`}>
      {config.icon}{config.label}
    </Badge>
  );
};

const PlatformBadge = ({ platform }: { platform: string }) => {
  const configs: Record<string, { color: string; icon: string }> = {
    airbnb: { color: "bg-rose-50 text-rose-600 border-rose-200", icon: "🏠" },
    booking: { color: "bg-blue-50 text-blue-700 border-blue-200", icon: "🌐" },
    direct: { color: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: "✓" },
    vrbo: { color: "bg-purple-50 text-purple-700 border-purple-200", icon: "🏡" },
  };
  const cfg = configs[platform?.toLowerCase()] || { color: "bg-slate-100 text-muted-foreground border-slate-200", icon: "•" };
  return (
    <Badge className={`${cfg.color} border font-medium text-xs`}>
      {cfg.icon} {platform}
    </Badge>
  );
};

const PaymentBadge = ({ status }: { status: string }) => {
  const variants: Record<string, { label: string; color: string }> = {
    paid: { label: "Paid", color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    pending: { label: "Pending", color: "bg-amber-50 text-amber-700 border-amber-200" },
    refunded: { label: "Refunded", color: "bg-blue-50 text-blue-700 border-blue-200" },
    failed: { label: "Failed", color: "bg-red-50 text-red-700 border-red-200" },
  };
  const config = variants[status] || variants.pending;
  return <Badge className={`${config.color} border text-xs`}>{config.label}</Badge>;
};

// ─── Calendar helpers ──────────────────────────────────────────────────────────

function getBookedIntervals(bookings: ShortTermBooking[]) {
  return bookings
    .filter(b => b.bookingStatus !== "cancelled")
    .map(b => ({
      start: parseISO(b.checkInDate),
      end: parseISO(b.checkOutDate),
      booking: b,
    }));
}

// ─── Pagination Component ───────────────────────────────────────────────────────

function Pagination({ 
  currentPage, 
  totalItems, 
  pageSize, 
  onPageChange, 
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100]
}: { 
  currentPage: number; 
  totalItems: number; 
  pageSize: number; 
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSizeOptions?: number[];
}) {
  const totalPages = Math.ceil(totalItems / pageSize);
  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  return (
    <div className="flex items-center justify-between mt-4 pt-4 border-t">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Show</span>
        <Select value={pageSize.toString()} onValueChange={(v) => onPageSizeChange(parseInt(v))}>
          <SelectTrigger className="w-20 h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pageSizeOptions.map(option => (
              <SelectItem key={option} value={option.toString()}>{option}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span>entries</span>
        <span className="ml-4">
          Showing {startItem} to {endItem} of {totalItems} results
        </span>
      </div>
      <div className="flex gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex gap-1">
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            let pageNum = currentPage;
            if (totalPages <= 5) {
              pageNum = i + 1;
            } else if (currentPage <= 3) {
              pageNum = i + 1;
            } else if (currentPage >= totalPages - 2) {
              pageNum = totalPages - 4 + i;
            } else {
              pageNum = currentPage - 2 + i;
            }
            
            if (pageNum < 1 || pageNum > totalPages) return null;
            
            return (
              <Button
                key={pageNum}
                variant={currentPage === pageNum ? "default" : "outline"}
                size="sm"
                className={currentPage === pageNum ? "bg-blue-600 hover:bg-blue-700" : ""}
                onClick={() => onPageChange(pageNum)}
              >
                {pageNum}
              </Button>
            );
          })}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages || totalPages === 0}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TenantSubletting() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [activeTab, setActiveTab] = useState("listings");
  const [isAddListingOpen, setIsAddListingOpen] = useState(false);
  const [editingListing, setEditingListing] = useState<TenantShortRental | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [selectedBooking, setSelectedBooking] = useState<ShortTermBooking | null>(null);
  const [managingBlocksFor, setManagingBlocksFor] = useState<TenantShortRental | null>(null);
  const [managingSyncFor, setManagingSyncFor] = useState<TenantShortRental | null>(null);
  const [bookingSearch, setBookingSearch] = useState("");
  const [bookingStatusFilter, setBookingStatusFilter] = useState("all");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [selectedCalendarListingId, setSelectedCalendarListingId] = useState<number | null>(null);

  // Pagination states
  const [listingsPage, setListingsPage] = useState(1);
  const [listingsPageSize, setListingsPageSize] = useState(10);
  const [bookingsPage, setBookingsPage] = useState(1);
  const [bookingsPageSize, setBookingsPageSize] = useState(10);
  const [payoutsPage, setPayoutsPage] = useState(1);
  const [payoutsPageSize, setPayoutsPageSize] = useState(10);

  // Reset page when filters change
  useEffect(() => {
    setListingsPage(1);
  }, [searchTerm, selectedStatus]);
  
  useEffect(() => {
    setBookingsPage(1);
  }, [bookingSearch, bookingStatusFilter, platformFilter]);

  // Controlled values for required Select fields (Radix Select bypasses native `required` validation)
  const [formUnitId, setFormUnitId] = useState<string>("");
  const [formTenantId, setFormTenantId] = useState<string>("");
  // "tenant" = subletting an existing tenant's own leased unit (the
  // original flow this page was built for). "owner" = a landlord/admin/
  // manager listing a property directly, with no tenant behind it — only
  // offered to roles the backend actually permits to create these.
  const [listingMode, setListingMode] = useState<"tenant" | "owner">("tenant");
  const [formOwnerId, setFormOwnerId] = useState<string>("");

  // Sync controlled Select state when editingListing is set from the dropdown
  useEffect(() => {
    if (editingListing) {
      setFormUnitId(editingListing.unitId.toString());
      if (editingListing.tenantId) {
        setListingMode("tenant");
        setFormTenantId(editingListing.tenantId.toString());
        setFormOwnerId("");
      } else {
        setListingMode("owner");
        setFormOwnerId(editingListing.ownerId ?? "");
        setFormTenantId("");
      }
    } else {
      setFormUnitId("");
      setFormTenantId("");
      setFormOwnerId("");
      setListingMode("tenant");
    }
  }, [editingListing]);

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isManager = user?.role === "admin" || user?.role === "manager";
  const isLandlord = user?.role === "landlord";
  // Only admin/manager/landlord can create an owner-managed listing at all —
  // a plain tenant only ever sublets their own unit (matches the backend's
  // own role restrictions in tenant-subletting.ts).
  const canCreateOwnerManaged = isManager || isLandlord;

  // ── Queries ───────────────────────────────────────────────────────────────────
  const { data: units = [] } = useQuery({
    queryKey: ["/api/units"],
    // The generic CRUD factory backing this endpoint paginates at 20 by
    // default with no follow-through in this dropdown — an org with more
    // than 20 units would silently lose access to the rest. Requesting a
    // high page size here sidesteps that without touching the shared
    // factory other pages also depend on.
    queryFn: async () => { const r = await apiRequest("/api/units?page_size=1000"); return ensureArray(await r.json()); },
  });
  const { data: properties = [] } = useQuery({
    queryKey: ["/api/properties"],
    // Needed because /api/units never joins property data — its rows have
    // no .property.name to read, which is why the unit picker was
    // rendering "Unit 101 -" with nothing after the dash.
    queryFn: async () => { const r = await apiRequest("/api/properties?page_size=1000"); return ensureArray(await r.json()); },
  });
  // Units enriched with their property's name, joined client-side, plus
  // grouped by property for the dropdown below — both fixes for the same
  // underlying gap.
  const unitsWithProperty = useMemo(() => {
    const propById = new Map((Array.isArray(properties) ? properties : []).map((p: any) => [p.id, p]));
    return (Array.isArray(units) ? units : []).map((u: any) => ({
      ...u,
      propertyName: propById.get(u.propertyId)?.name ?? "Unknown property",
    }));
  }, [units, properties]);
  const unitsByProperty = useMemo(() => {
    const groups = new Map<string, any[]>();
    for (const u of unitsWithProperty) {
      const key = u.propertyName;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(u);
    }
    return Array.from(groups.entries()).map(([propertyName, groupUnits]) => ({ propertyName, units: groupUnits }));
  }, [unitsWithProperty]);

  const { data: tenants = [] } = useQuery({
    queryKey: ["/api/tenants"],
    // This endpoint defaults to 20 too (its own custom pagination, capped
    // at 100 server-side) — same underlying issue as /api/units above.
    queryFn: async () => { const r = await apiRequest("/api/tenants?limit=100"); return ensureArray(await r.json()); },
  });
  // Only admin/manager need this — a landlord creating an owner-managed
  // listing is always listing it under themselves, no picker needed.
  const { data: landlords = [] } = useQuery({
    queryKey: ["/api/users", "landlords-for-listing"],
    queryFn: async () => { const r = await apiRequest("/api/users?role=landlord"); if (!r.ok) return []; return ensureArray(await r.json()); },
    enabled: isManager,
  });

  // A unit has at most one current tenant, and belongs to exactly one
  // property with exactly one owner — both are fully determined the
  // moment a unit is picked. Asking for them again separately was
  // redundant, and a real risk: nothing stopped picking a unit from one
  // property while manually selecting an unrelated landlord.
  const tenantByUnitId = useMemo(() => {
    const map = new Map<number, any>();
    for (const t of (Array.isArray(tenants) ? tenants : [])) {
      if (t.unitId) map.set(t.unitId, t);
    }
    return map;
  }, [tenants]);

  const propertyById = useMemo(() => {
    const map = new Map<number, any>();
    for (const p of (Array.isArray(properties) ? properties : [])) map.set(p.id, p);
    return map;
  }, [properties]);

  const landlordById = useMemo(() => {
    const map = new Map<string, any>();
    for (const l of (Array.isArray(landlords) ? landlords : [])) map.set(l.id, l);
    return map;
  }, [landlords]);

  // Only units that actually have a current tenant make sense in "tenant"
  // mode — subletting requires an existing lease, so a vacant unit simply
  // isn't a valid option there.
  const unitsByPropertyForMode = useMemo(() => {
    if (listingMode !== "tenant") return unitsByProperty;
    return unitsByProperty
      .map(group => ({ ...group, units: group.units.filter((u: any) => tenantByUnitId.has(u.id)) }))
      .filter(group => group.units.length > 0);
  }, [unitsByProperty, listingMode, tenantByUnitId]);

  const derivedTenant = formUnitId ? tenantByUnitId.get(parseInt(formUnitId)) : undefined;
  const derivedOwnerId = formUnitId
    ? propertyById.get(unitsWithProperty.find((u: any) => u.id === parseInt(formUnitId))?.propertyId)?.ownerId ?? null
    : null;
  const derivedLandlord = derivedOwnerId ? landlordById.get(derivedOwnerId) : undefined;

  // Keep the actual submitted values in sync with what the unit determines
  // — these are no longer independently chosen, just mirrored from the
  // derivation above so the existing submit logic doesn't need to change.
  useEffect(() => {
    if (listingMode === "tenant" && derivedTenant) setFormTenantId(String(derivedTenant.id));
    if (listingMode === "owner" && isManager && derivedOwnerId) setFormOwnerId(derivedOwnerId);
  }, [formUnitId, listingMode, derivedTenant, derivedOwnerId, isManager]);

  const { data: listings = [], isLoading: loadingListings } = useQuery({
    queryKey: ["/api/tenant-short-rentals"],
    queryFn: async () => { const r = await apiRequest("/api/tenant-short-rentals"); return ensureArray(await r.json()); },
  });
  const { data: bookings = [] } = useQuery({
    queryKey: ["/api/short-term-bookings"],
    queryFn: async () => { const r = await apiRequest("/api/short-term-bookings"); return ensureArray(await r.json()); },
  });

  const safeListings: TenantShortRental[] = Array.isArray(listings) ? listings : [];
  const safeBookings: ShortTermBooking[] = Array.isArray(bookings) ? bookings : [];

  // ── Derived ───────────────────────────────────────────────────────────────────
  const filteredListings = safeListings.filter(listing => {
    const matchesSearch = listing.listingTitle.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = selectedStatus === "all" || listing.approvalStatus === selectedStatus;
    return matchesSearch && matchesStatus;
  });

  const filteredBookings = useMemo(() => {
    return safeBookings.filter(b => {
      const matchSearch = bookingSearch === "" ||
        b.guestName?.toLowerCase().includes(bookingSearch.toLowerCase()) ||
        b.bookingReference?.toLowerCase().includes(bookingSearch.toLowerCase());
      const matchStatus = bookingStatusFilter === "all" || b.bookingStatus === bookingStatusFilter;
      const matchPlatform = platformFilter === "all" || b.platformSource?.toLowerCase() === platformFilter;
      return matchSearch && matchStatus && matchPlatform;
    });
  }, [safeBookings, bookingSearch, bookingStatusFilter, platformFilter]);

  // Paginated data
  const paginatedListings = useMemo(() => {
    const start = (listingsPage - 1) * listingsPageSize;
    return filteredListings.slice(start, start + listingsPageSize);
  }, [filteredListings, listingsPage, listingsPageSize]);

  const paginatedBookings = useMemo(() => {
    const start = (bookingsPage - 1) * bookingsPageSize;
    return filteredBookings.slice(start, start + bookingsPageSize);
  }, [filteredBookings, bookingsPage, bookingsPageSize]);

  const paginatedPayouts = useMemo(() => {
    const start = (payoutsPage - 1) * payoutsPageSize;
    return safeBookings.slice(start, start + payoutsPageSize);
  }, [safeBookings, payoutsPage, payoutsPageSize]);

  const totalListings = safeListings.length;
  const approvedListings = safeListings.filter(l => l.approvalStatus === "approved").length;
  const activeListings = safeListings.filter(l => l.isActive && l.approvalStatus === "approved").length;
  const totalBookings = safeBookings.length;
  const totalRevenue = safeBookings.reduce((s, b) => s + Number(b.totalAmount || 0), 0);
  const tenantEarnings = safeBookings.reduce((s, b) => s + Number(b.tenantPayout || 0), 0);

  const earningsData = useMemo(() => {
    const platformBreakdown: Record<string, { revenue: number; bookings: number; payout: number }> = {};
    safeBookings.forEach(b => {
      const p = b.platformSource || "Direct";
      if (!platformBreakdown[p]) platformBreakdown[p] = { revenue: 0, bookings: 0, payout: 0 };
      platformBreakdown[p].revenue += Number(b.totalAmount || 0);
      platformBreakdown[p].bookings += 1;
      platformBreakdown[p].payout += Number(b.tenantPayout || 0);
    });
    const confirmed = safeBookings.filter(b => ["confirmed","checked_in","checked_out"].includes(b.bookingStatus));
    const avgNightlyRate = confirmed.length > 0 ? confirmed.reduce((s, b) => s + Number(b.nightlyRate || 0), 0) / confirmed.length : 0;
    const totalNights = confirmed.reduce((s, b) => s + b.numberOfNights, 0);
    const totalFees = safeBookings.reduce((s, b) => s + Number(b.platformFees || 0) + Number(b.propertyManagerCommission || 0), 0);
    return { platformBreakdown, avgNightlyRate, totalNights, totalFees };
  }, [safeBookings]);

  const calendarBookings = useMemo(() =>
    selectedCalendarListingId !== null
      ? safeBookings.filter(b => b.rentalListingId === selectedCalendarListingId)
      : safeBookings,
    [safeBookings, selectedCalendarListingId]
  );

  const bookedIntervals = useMemo(() => getBookedIntervals(calendarBookings), [calendarBookings]);

  // ── Mutations ─────────────────────────────────────────────────────────────────
  const createListingMutation = useMutation({
    mutationFn: (data: Partial<TenantShortRental>) => apiRequest("/api/tenant-short-rentals", { method: "POST", data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenant-short-rentals"] });
      setIsAddListingOpen(false);
      toast({ title: "Success", description: "Short-term rental listing created successfully" });
    },
    onError: () => toast({ title: "Error", description: "Failed to create listing", variant: "destructive" }),
  });

  const updateListingStatusMutation = useMutation({
    mutationFn: ({ id, status, landlordConsentConfirmed }: { id: number; status: string; landlordConsentConfirmed?: boolean }) =>
      apiRequest(`/api/tenant-short-rentals/${id}/status`, { method: "PATCH", data: { status, landlordConsentConfirmed } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenant-short-rentals"] });
      toast({ title: "Success", description: "Listing status updated" });
    },
    onError: (err: any) => {
      if (err?.code === "LANDLORD_CONSENT_REQUIRED") {
        toast({ title: "Landlord consent required", description: err.message, variant: "destructive" });
        return;
      }
      toast({ title: "Error", description: "Failed to update listing status", variant: "destructive" });
    },
  });

  const updateListingVisibilityMutation = useMutation({
    mutationFn: ({ id, isPubliclyListed }: { id: number; isPubliclyListed: boolean }) =>
      apiRequest(`/api/tenant-short-rentals/${id}/visibility`, { method: "PATCH", data: { isPubliclyListed } }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenant-short-rentals"] });
      toast({
        title: "Success",
        description: variables.isPubliclyListed
          ? "Listing is now visible in the public marketplace"
          : "Listing removed from the public marketplace — still bookable via its direct link",
      });
    },
    onError: (err: any) => toast({ title: "Error", description: err?.message || "Failed to update visibility", variant: "destructive" }),
  });

  const updateListingMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<TenantShortRental> }) =>
      apiRequest(`/api/tenant-short-rentals/${id}`, { method: "PUT", data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenant-short-rentals"] });
      setEditingListing(null);
      toast({ title: "Success", description: "Listing updated successfully" });
    },
    onError: () => toast({ title: "Error", description: "Failed to update listing", variant: "destructive" }),
  });

  const deleteListingMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/tenant-short-rentals/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenant-short-rentals"] });
      toast({ title: "Success", description: "Listing deleted successfully" });
    },
    onError: () => toast({ title: "Error", description: "Failed to delete listing", variant: "destructive" }),
  });

  const cancelBookingMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/short-term-bookings/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/short-term-bookings"] });
      toast({ title: "Booking cancelled", description: "The dates are now available again." });
      setSelectedBooking(null);
    },
    onError: (err: any) => toast({ title: "Error", description: err?.message || "Failed to cancel booking", variant: "destructive" }),
  });

  const markRefundedMutation = useMutation({
    mutationFn: ({ id, notes }: { id: number; notes?: string }) =>
      apiRequest(`/api/short-term-bookings/${id}/mark-refunded`, { method: "POST", data: { notes } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/short-term-bookings"] });
      toast({ title: "Refund recorded", description: "The guest has been notified it was sent." });
    },
    onError: (err: any) => toast({ title: "Error", description: err?.message || "Failed to record refund", variant: "destructive" }),
  });

  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const uploadPhotoMutation = useMutation({
    mutationFn: async ({ listingId, file }: { listingId: number; file: File }) => {
      setUploadingPhoto(true);
      const formData = new FormData();
      formData.append("photo", file);
      const token = localStorage.getItem("access_token") || sessionStorage.getItem("access_token");
      const r = await fetch(`/api/tenant-short-rentals/${listingId}/photos`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || "Upload failed");
      return data;
    },
    onSuccess: (data) => {
      setUploadingPhoto(false);
      queryClient.invalidateQueries({ queryKey: ["/api/tenant-short-rentals"] });
      setEditingListing(data.listing); // keep the open dialog's local copy in sync
      toast({ title: "Photo uploaded" });
    },
    onError: (err: any) => {
      setUploadingPhoto(false);
      toast({ title: "Error", description: err?.message || "Failed to upload photo", variant: "destructive" });
    },
  });

  const removePhotoMutation = useMutation({
    mutationFn: ({ listingId, url }: { listingId: number; url: string }) =>
      apiRequest(`/api/tenant-short-rentals/${listingId}/photos`, { method: "DELETE", data: { url } }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenant-short-rentals"] });
      setEditingListing(data);
      toast({ title: "Photo removed" });
    },
    onError: (err: any) => toast({ title: "Error", description: err?.message || "Failed to remove photo", variant: "destructive" }),
  });

  const handleSubmitListing = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    // Client-side validation for Radix Select fields (bypassed by e.preventDefault())
    if (!formUnitId) {
      toast({ title: "Validation Error", description: "Please select a unit", variant: "destructive" });
      return;
    }
    if (listingMode === "tenant" && !formTenantId) {
      toast({ title: "Validation Error", description: "This unit doesn't have a current tenant — select a different unit", variant: "destructive" });
      return;
    }
    if (listingMode === "owner" && isManager && !formOwnerId) {
      toast({ title: "Validation Error", description: "This unit's property has no assigned landlord — select a different unit", variant: "destructive" });
      return;
    }

    const formData = new FormData(e.currentTarget);
    const data = Object.fromEntries(formData.entries());
    const amenities = (data.amenities as string)?.split(",").map(a => a.trim()).filter(Boolean) || [];

    const payload: any = {
      unitId: parseInt(formUnitId),
      // A landlord's ownerId is set automatically server-side regardless of
      // what's sent here — omitting it for them isn't a gap, the backend
      // doesn't trust this field from a landlord caller anyway. Only
      // admin/manager actually need to specify which landlord.
      ...(listingMode === "tenant"
        ? { tenantId: parseInt(formTenantId) }
        : (isManager ? { ownerId: formOwnerId } : {})),
      listingTitle: data.listingTitle as string,
      description: data.description as string,
      nightlyRate: data.nightlyRate as string,
      currency: "KES",
      minimumNights: parseInt(data.minimumNights as string),
      maximumNights: parseInt(data.maximumNights as string),
      maxGuests: parseInt(data.maxGuests as string),
      amenities,
      houseRules: data.houseRules as string,
      checkInTime: data.checkInTime as string,
      checkOutTime: data.checkOutTime as string,
      calendarSyncEnabled: data.calendarSyncEnabled === "on",
      autoPricingEnabled: data.autoPricingEnabled === "on",
      instantBookingEnabled: data.instantBookingEnabled === "on",
      notes: (data.notes as string) || undefined,
    };

    if (editingListing) {
      updateListingMutation.mutate({ id: editingListing.id, data: payload });
    } else {
      createListingMutation.mutate({
        ...payload,
        approvalStatus: "pending",
        isActive: true,
        propertyManagerCommission: "10.00",
        tenantEarningsShare: "70.00",
        platformFees: "20.00",
      });
    }
  };

  // ── Calendar Component ────────────────────────────────────────────────────────
  const CalendarGrid = () => {
    const monthStart = startOfMonth(calendarMonth);
    const monthEnd = endOfMonth(calendarMonth);
    const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
    const startOffset = getDay(monthStart);
    const today = new Date();

    return (
      <div>
        <div className="flex items-center justify-between mb-4">
          <Button variant="outline" size="sm" onClick={() => setCalendarMonth(d => addDays(startOfMonth(d), -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h3 className="text-lg font-semibold">{format(calendarMonth, "MMMM yyyy")}</h3>
          <Button variant="outline" size="sm" onClick={() => setCalendarMonth(d => addDays(endOfMonth(d), 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid grid-cols-7 gap-1 mb-1">
          {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => (
            <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">{d}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: startOffset }).map((_, i) => <div key={`e-${i}`} />)}
          {days.map(day => {
            const dayBookings = bookedIntervals.filter(({ start, end }) => isWithinInterval(day, { start, end }));
            const isToday = isSameDay(day, today);
            const hasBooking = dayBookings.length > 0;
            const isCheckIn = dayBookings.some(({ start }) => isSameDay(day, start));
            const isCheckOut = dayBookings.some(({ end }) => isSameDay(day, end));
            const firstBooking = dayBookings[0]?.booking;
            const firstListing = firstBooking ? safeListings.find(l => l.id === firstBooking.rentalListingId) : null;
            const isSelectedListing = firstListing ? selectedCalendarListingId === firstListing.id : false;

            return (
              <div
                key={day.toISOString()}
                onClick={() => {
                  if (hasBooking && firstBooking) {
                    setSelectedBooking(firstBooking);
                    if (firstListing) setSelectedCalendarListingId(firstListing.id);
                  }
                }}
                className={`
                  relative min-h-[52px] rounded-lg p-1.5 text-xs border transition-colors
                  ${hasBooking ? "cursor-pointer" : ""}
                  ${isToday ? "border-rose-400 bg-rose-50" : "border-transparent hover:border-slate-200 hover:bg-slate-50"}
                  ${hasBooking && !isToday ? "bg-rose-50 border-rose-200" : ""}
                  ${isSelectedListing && !isToday ? "ring-2 ring-rose-500 ring-offset-1" : ""}
                `}
                title={firstListing ? firstListing.listingTitle : undefined}
              >
                <span className={`font-medium ${isToday ? "text-rose-600" : "text-foreground"}`}>
                  {format(day, "d")}
                </span>
                {isCheckIn && (
                  <div className="mt-0.5 rounded text-[10px] bg-emerald-500 text-white px-1 leading-tight truncate">
                    ↙ {dayBookings.find(({ start }) => isSameDay(day, start))?.booking.guestName?.split(" ")[0]}
                  </div>
                )}
                {isCheckOut && !isCheckIn && (
                  <div className="mt-0.5 rounded text-[10px] bg-slate-400 text-white px-1 leading-tight">↗ out</div>
                )}
                {hasBooking && !isCheckIn && !isCheckOut && (
                  <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-rose-400" />
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ── Booking Detail Dialog ─────────────────────────────────────────────────────
  const BookingDetailDialog = ({ booking, onClose }: { booking: ShortTermBooking; onClose: () => void }) => {
    const listing = safeListings.find(l => l.id === booking.rentalListingId);
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Booking <span className="font-mono text-sm bg-muted px-2 py-0.5 rounded">{booking.bookingReference}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-rose-400 to-rose-600 flex items-center justify-center text-white font-bold text-lg">
                {booking.guestName?.charAt(0)}
              </div>
              <div>
                <p className="font-semibold">{booking.guestName}</p>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{booking.guestEmail}</span>
                  {booking.guestPhone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{booking.guestPhone}</span>}
                </div>
              </div>
            </div>

            {listing && (
              <div className="rounded-lg bg-muted/50 p-3 text-sm flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{listing.listingTitle}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <p className="text-muted-foreground text-xs">Unit #{listing.unitId}</p>
                    <StatusBadge status={listing.approvalStatus} />
                  </div>
                </div>
                <button
                  onClick={() => { onClose(); setSelectedCalendarListingId(listing.id); setActiveTab("calendar"); }}
                  className="text-rose-500 hover:text-rose-700 text-xs font-medium flex items-center gap-1 shrink-0 transition-colors"
                >
                  <Calendar className="h-3 w-3" /> View in Calendar
                </button>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">Check-in</p>
                <p className="font-semibold text-sm">{format(parseISO(booking.checkInDate), "dd MMM yyyy")}</p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">Check-out</p>
                <p className="font-semibold text-sm">{format(parseISO(booking.checkOutDate), "dd MMM yyyy")}</p>
              </div>
            </div>

            <div className="rounded-lg border divide-y text-sm">
              <div className="flex justify-between px-3 py-2">
                <span className="text-muted-foreground">{formatCurrency(Number(booking.nightlyRate), booking.currency)} × {booking.numberOfNights} nights</span>
                <span>{formatCurrency(Number(booking.nightlyRate) * booking.numberOfNights, booking.currency)}</span>
              </div>
              {booking.cleaningFee > 0 && (
                <div className="flex justify-between px-3 py-2">
                  <span className="text-muted-foreground">Cleaning fee</span>
                  <span>{formatCurrency(booking.cleaningFee, booking.currency)}</span>
                </div>
              )}
              <div className="flex justify-between px-3 py-2">
                <span className="text-muted-foreground">Platform fees ({booking.platformSource})</span>
                <span className="text-red-500">−{formatCurrency(Number(booking.platformFees), booking.currency)}</span>
              </div>
              <div className="flex justify-between px-3 py-2">
                <span className="text-muted-foreground">Manager commission</span>
                <span className="text-red-500">−{formatCurrency(Number(booking.propertyManagerCommission), booking.currency)}</span>
              </div>
              <div className="flex justify-between px-3 py-2 font-semibold bg-emerald-50">
                <span>Tenant payout</span>
                <span className="text-emerald-700">{formatCurrency(Number(booking.tenantPayout), booking.currency)}</span>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <BookingStatusBadge status={booking.bookingStatus} />
              <PaymentBadge status={booking.paymentStatus} />
              <PlatformBadge platform={booking.platformSource} />
              {booking.guestCount && (
                <Badge variant="outline" className="text-xs">
                  <Users className="h-3 w-3 mr-1" />{booking.guestCount} guest{booking.guestCount !== 1 ? "s" : ""}
                </Badge>
              )}
            </div>

            {booking.checkInCode && (
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 flex items-start gap-2">
                <Shield className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-medium text-blue-800">Check-in Code</p>
                  <p className="font-mono text-lg font-bold text-blue-700 tracking-widest">{booking.checkInCode}</p>
                </div>
              </div>
            )}

            {booking.specialRequests && (
              <div className="rounded-lg bg-muted/50 p-3 text-sm">
                <p className="font-medium mb-1 flex items-center gap-1"><Info className="h-3 w-3" /> Special Requests</p>
                <p className="text-muted-foreground">{booking.specialRequests}</p>
              </div>
            )}

            {booking.refundStatus === "owed" && (
              <div className="pt-2 border-t space-y-2">
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
                  <p className="text-sm font-medium text-amber-800 flex items-center gap-1.5">
                    <Info className="h-3.5 w-3.5" /> Refund owed
                  </p>
                  <p className="text-xs text-amber-700 mt-1">
                    {booking.currency} {Number(booking.refundAmount ?? booking.totalAmount).toLocaleString()} needs to be sent to {booking.guestName} ({booking.guestPhone})
                    via M-Pesa. Mark it below once sent.
                  </p>
                </div>
                <Button
                  className="w-full bg-emerald-600 hover:bg-emerald-700"
                  disabled={markRefundedMutation.isPending}
                  onClick={() => {
                    const notes = prompt("Optional note (e.g. M-Pesa confirmation code):") ?? undefined;
                    markRefundedMutation.mutate({ id: booking.id, notes });
                  }}
                >
                  <CheckCircle className="h-4 w-4 mr-2" /> {markRefundedMutation.isPending ? "Recording…" : "Mark refund as sent"}
                </Button>
              </div>
            )}
            {booking.refundStatus === "completed" && booking.refundedAt && (
              <div className="pt-2 border-t">
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <CheckCircle className="h-3.5 w-3.5 text-emerald-600" /> Refunded on {new Date(booking.refundedAt).toLocaleDateString()}
                </p>
              </div>
            )}

            {!["cancelled", "checked_out"].includes(booking.bookingStatus) && (
              <div className="pt-2 border-t">
                <Button
                  variant="outline"
                  className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                  disabled={cancelBookingMutation.isPending}
                  onClick={() => {
                    if (confirm("Cancel this booking? This will free up the dates for someone else.")) {
                      cancelBookingMutation.mutate(booking.id);
                    }
                  }}
                >
                  <XCircle className="h-4 w-4 mr-2" /> Cancel Booking
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    );
  };

  const BlockedDatesDialog = ({ listing, onClose }: { listing: TenantShortRental; onClose: () => void }) => {
    const [blockStart, setBlockStart] = useState("");
    const [blockEnd, setBlockEnd] = useState("");
    const [blockReason, setBlockReason] = useState("");

    const { data: blocks = [], isLoading: loadingBlocks } = useQuery({
      queryKey: ["/api/tenant-short-rentals", listing.id, "blocked-dates"],
      queryFn: async () => { const r = await apiRequest(`/api/tenant-short-rentals/${listing.id}/blocked-dates`); return ensureArray(await r.json()); },
    });

    const addBlockMutation = useMutation({
      mutationFn: () => apiRequest(`/api/tenant-short-rentals/${listing.id}/blocked-dates`, {
        method: "POST",
        data: { startDate: blockStart, endDate: blockEnd, reason: blockReason || undefined },
      }),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/tenant-short-rentals", listing.id, "blocked-dates"] });
        setBlockStart(""); setBlockEnd(""); setBlockReason("");
        toast({ title: "Dates blocked", description: "Those dates are no longer bookable." });
      },
      onError: (err: any) => toast({ title: "Error", description: err?.message || "Failed to block dates", variant: "destructive" }),
    });

    const removeBlockMutation = useMutation({
      mutationFn: (blockId: number) => apiRequest(`/api/tenant-short-rentals/${listing.id}/blocked-dates/${blockId}`, { method: "DELETE" }),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/tenant-short-rentals", listing.id, "blocked-dates"] });
        toast({ title: "Unblocked", description: "Those dates are bookable again." });
      },
      onError: (err: any) => toast({ title: "Error", description: err?.message || "Failed to unblock dates", variant: "destructive" }),
    });

    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Blocked dates — {listing.listingTitle}</DialogTitle>
            <DialogDescription>Block dates for personal use or maintenance — guests won't be able to book them.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {loadingBlocks ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : blocks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No blocked dates yet.</p>
            ) : (
              <div className="space-y-2">
                {blocks.map((b: any) => (
                  <div key={b.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                    <div>
                      <p className="font-medium">{format(new Date(b.startDate), "dd MMM yyyy")} – {format(new Date(b.endDate), "dd MMM yyyy")}</p>
                      {b.reason && <p className="text-xs text-muted-foreground">{b.reason}</p>}
                    </div>
                    <Button
                      size="sm" variant="ghost"
                      disabled={removeBlockMutation.isPending}
                      onClick={() => removeBlockMutation.mutate(b.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-red-500" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <div className="border-t pt-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Start date</Label>
                  <Input type="date" value={blockStart} onChange={e => setBlockStart(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">End date</Label>
                  <Input type="date" value={blockEnd} onChange={e => setBlockEnd(e.target.value)} />
                </div>
              </div>
              <Input placeholder="Reason (optional) — e.g. personal use, maintenance" value={blockReason} onChange={e => setBlockReason(e.target.value)} />
              <Button
                className="w-full bg-emerald-600 hover:bg-emerald-700"
                disabled={!blockStart || !blockEnd || addBlockMutation.isPending}
                onClick={() => addBlockMutation.mutate()}
              >
                {addBlockMutation.isPending ? "Blocking…" : "Block these dates"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  };

  const CalendarSyncDialog = ({ listing, onClose }: { listing: TenantShortRental; onClose: () => void }) => {
    const [platform, setPlatform] = useState<"airbnb" | "vrbo" | "booking" | "google" | "other">("airbnb");
    const [feedUrl, setFeedUrl] = useState("");
    const [copied, setCopied] = useState(false);

    const { data: exportInfo } = useQuery({
      queryKey: ["/api/tenant-short-rentals", listing.id, "export-info"],
      queryFn: async () => { const r = await apiRequest(`/api/tenant-short-rentals/${listing.id}/export-info`); return r.json(); },
    });
    const { data: feeds = [], isLoading: loadingFeeds } = useQuery({
      queryKey: ["/api/tenant-short-rentals", listing.id, "ical-feeds"],
      queryFn: async () => { const r = await apiRequest(`/api/tenant-short-rentals/${listing.id}/ical-feeds`); return ensureArray(await r.json()); },
    });

    const addFeedMutation = useMutation({
      mutationFn: () => apiRequest(`/api/tenant-short-rentals/${listing.id}/ical-feeds`, { method: "POST", data: { platform, feedUrl } }),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/tenant-short-rentals", listing.id, "ical-feeds"] });
        setFeedUrl("");
        toast({ title: "Calendar added", description: "Click Sync now to import its dates." });
      },
      onError: (err: any) => toast({ title: "Error", description: err?.message || "Failed to add calendar", variant: "destructive" }),
    });

    const removeFeedMutation = useMutation({
      mutationFn: (feedId: number) => apiRequest(`/api/tenant-short-rentals/${listing.id}/ical-feeds/${feedId}`, { method: "DELETE" }),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/tenant-short-rentals", listing.id, "ical-feeds"] });
        toast({ title: "Calendar removed" });
      },
      onError: () => toast({ title: "Error", description: "Failed to remove calendar", variant: "destructive" }),
    });

    const syncFeedMutation = useMutation({
      mutationFn: (feedId: number) => apiRequest(`/api/tenant-short-rentals/${listing.id}/ical-feeds/${feedId}/sync`, { method: "POST" }),
      onSuccess: (data: any) => {
        queryClient.invalidateQueries({ queryKey: ["/api/tenant-short-rentals", listing.id, "ical-feeds"] });
        toast({ title: "Synced", description: `Imported ${data.eventsImported ?? 0} date range(s).` });
      },
      onError: (err: any) => toast({ title: "Sync failed", description: err?.message || "Could not sync that calendar.", variant: "destructive" }),
    });

    const platformLabel: Record<string, string> = { airbnb: "🏠 Airbnb", vrbo: "🏡 VRBO", booking: "🌐 Booking.com", google: "📅 Google Calendar", other: "Other" };

    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Calendar sync — {listing.listingTitle}</DialogTitle>
            <DialogDescription>Keep this listing's availability in sync with other platforms you list on.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            <div className="space-y-2">
              <Label className="text-xs">Your export link — paste this into Airbnb/VRBO's "import calendar" option</Label>
              <div className="flex gap-2">
                <Input readOnly value={exportInfo ? `${window.location.origin}${exportInfo.exportUrl}` : "Loading…"} className="text-xs" />
                <Button
                  size="sm" variant="outline"
                  onClick={() => {
                    if (!exportInfo) return;
                    navigator.clipboard.writeText(`${window.location.origin}${exportInfo.exportUrl}`);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>

            <div className="border-t pt-4 space-y-2">
              <Label className="text-xs">Import a calendar from another platform</Label>
              {loadingFeeds ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : feeds.length === 0 ? (
                <p className="text-sm text-muted-foreground">No calendars connected yet.</p>
              ) : (
                <div className="space-y-2">
                  {feeds.map((feed: any) => (
                    <div key={feed.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                      <div>
                        <p className="font-medium">{platformLabel[feed.platform] ?? feed.platform}</p>
                        <p className="text-xs text-muted-foreground">
                          {feed.lastSyncStatus === "success" && feed.lastSyncedAt && `Synced ${new Date(feed.lastSyncedAt).toLocaleString()}`}
                          {feed.lastSyncStatus === "error" && <span className="text-red-600">Last sync failed: {feed.lastSyncError}</span>}
                          {!feed.lastSyncStatus && "Never synced"}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" disabled={syncFeedMutation.isPending} onClick={() => syncFeedMutation.mutate(feed.id)}>
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" disabled={removeFeedMutation.isPending} onClick={() => removeFeedMutation.mutate(feed.id)}>
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-3 gap-2 pt-2">
                <Select value={platform} onValueChange={(v: any) => setPlatform(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="airbnb">🏠 Airbnb</SelectItem>
                    <SelectItem value="vrbo">🏡 VRBO</SelectItem>
                    <SelectItem value="booking">🌐 Booking.com</SelectItem>
                    <SelectItem value="google">📅 Google Calendar</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
                <Input className="col-span-2" placeholder="Paste their calendar export URL" value={feedUrl} onChange={e => setFeedUrl(e.target.value)} />
              </div>
              <Button className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={!feedUrl || addFeedMutation.isPending} onClick={() => addFeedMutation.mutate()}>
                {addFeedMutation.isPending ? "Adding…" : "Add calendar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Short-Term Rental Listings</h1>
          <p className="text-muted-foreground">Short-term rental listings — tenant sublets and owner-managed properties</p>
        </div>
        <Dialog open={isAddListingOpen || !!editingListing} onOpenChange={(open) => {
          if (!open) {
            setIsAddListingOpen(false);
            setEditingListing(null);
            setFormUnitId("");
            setFormTenantId("");
            setFormOwnerId("");
            setListingMode("tenant");
          } else if (editingListing) {
            setFormUnitId(editingListing.unitId.toString());
            if (editingListing.tenantId) {
              setListingMode("tenant");
              setFormTenantId(editingListing.tenantId.toString());
            } else {
              setListingMode("owner");
              setFormOwnerId(editingListing.ownerId ?? "");
            }
          }
        }}>
          <DialogTrigger asChild>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setIsAddListingOpen(true)}>
              <Plus className="h-4 w-4 mr-2" /> Create Listing
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingListing ? "Edit Listing" : "Create Short-Term Rental Listing"}</DialogTitle>
              <DialogDescription>
                {editingListing
                  ? "Update your listing details"
                  : listingMode === "owner"
                  ? "Set up a new listing for an owner-managed short-term rental property"
                  : "Set up a new listing for tenant subletting"}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmitListing} className="space-y-4">
              {canCreateOwnerManaged && !editingListing && (
                <div className="space-y-2">
                  <Label>Listing type *</Label>
                  <div className="flex gap-2">
                    <Button type="button" variant={listingMode === "tenant" ? "default" : "outline"}
                      className={listingMode === "tenant" ? "bg-emerald-600 hover:bg-emerald-700" : ""}
                      onClick={() => setListingMode("tenant")}>
                      Tenant subletting their unit
                    </Button>
                    <Button type="button" variant={listingMode === "owner" ? "default" : "outline"}
                      className={listingMode === "owner" ? "bg-emerald-600 hover:bg-emerald-700" : ""}
                      onClick={() => setListingMode("owner")}>
                      Owner-managed property
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {listingMode === "tenant"
                      ? "An existing tenant lists their own leased unit."
                      : "A property run directly as a short-term rental, with no regular tenant behind it."}
                  </p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Unit *</Label>
                  <Select
                    name="unitId"
                    required
                    value={formUnitId}
                    onValueChange={setFormUnitId}
                  >
                    <SelectTrigger className={!formUnitId ? "border-red-300" : ""}>
                      <SelectValue placeholder={listingMode === "tenant" ? "Select occupied unit" : "Select unit"} />
                    </SelectTrigger>
                    <SelectContent>
                      {unitsByPropertyForMode.map(group => (
                        <SelectGroup key={group.propertyName}>
                          <SelectLabel>{group.propertyName}</SelectLabel>
                          {group.units.map((unit: any) => (
                            <SelectItem key={unit.id} value={unit.id.toString()}>
                              Unit {unit.unitNumber}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                  {listingMode === "tenant" && (
                    <p className="text-xs text-muted-foreground">Only units with a current tenant are shown — subletting needs an existing lease.</p>
                  )}
                  {isLandlord && listingMode === "owner" && (
                    <p className="text-xs text-muted-foreground">Only units in properties you own will be accepted.</p>
                  )}
                </div>
                {listingMode === "tenant" ? (
                  <div className="space-y-2">
                    <Label>Tenant</Label>
                    <div className={`h-10 flex items-center px-3 rounded-md border text-sm ${derivedTenant ? "bg-muted text-foreground" : "bg-muted text-muted-foreground"}`}>
                      {derivedTenant ? `${derivedTenant.firstName} ${derivedTenant.lastName}` : "Select a unit first"}
                    </div>
                    <p className="text-xs text-muted-foreground">Determined automatically from the unit's current tenant.</p>
                  </div>
                ) : isManager ? (
                  <div className="space-y-2">
                    <Label>Landlord</Label>
                    <div className={`h-10 flex items-center px-3 rounded-md border text-sm ${derivedLandlord ? "bg-muted text-foreground" : "bg-muted text-muted-foreground"}`}>
                      {formUnitId
                        ? (derivedLandlord ? `${derivedLandlord.firstName} ${derivedLandlord.lastName}` : "This property has no assigned landlord account")
                        : "Select a unit first"}
                    </div>
                    <p className="text-xs text-muted-foreground">Determined automatically from the unit's property owner.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label>Owner</Label>
                    <div className="h-10 flex items-center px-3 rounded-md border bg-muted text-sm text-muted-foreground">
                      Listed under your own account
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="listingTitle">Listing Title *</Label>
                <Input id="listingTitle" name="listingTitle" required defaultValue={editingListing?.listingTitle} placeholder="e.g., Cozy 2BR Apartment in Westlands" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description *</Label>
                <Textarea id="description" name="description" required rows={4} defaultValue={editingListing?.description}
                  placeholder="Describe the property, location, and what makes it special..." />
              </div>

              <div className="grid grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="nightlyRate">Nightly Rate (KSh) *</Label>
                  <Input type="number" step="0.01" id="nightlyRate" name="nightlyRate" required defaultValue={editingListing?.nightlyRate} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="minimumNights">Min Nights *</Label>
                  <Input type="number" id="minimumNights" name="minimumNights" required defaultValue={editingListing?.minimumNights || "1"} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maximumNights">Max Nights</Label>
                  <Input type="number" id="maximumNights" name="maximumNights" defaultValue={editingListing?.maximumNights || "30"} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maxGuests">Max Guests *</Label>
                  <Input type="number" min={1} id="maxGuests" name="maxGuests" required defaultValue={editingListing?.maxGuests || "2"} />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="amenities">Amenities</Label>
                <Input id="amenities" name="amenities" defaultValue={editingListing?.amenities.join(", ")} placeholder="Wi-Fi, Kitchen, Parking, Pool, Gym (comma-separated)" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="checkInTime">Check-in Time</Label>
                  <Input type="time" id="checkInTime" name="checkInTime" defaultValue={editingListing?.checkInTime || "15:00"} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="checkOutTime">Check-out Time</Label>
                  <Input type="time" id="checkOutTime" name="checkOutTime" defaultValue={editingListing?.checkOutTime || "11:00"} />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="houseRules">House Rules</Label>
                <Textarea id="houseRules" name="houseRules" rows={3} defaultValue={editingListing?.houseRules} placeholder="No smoking, No parties, Check-out by 11 AM..." />
              </div>

              {editingListing ? (
                <div className="space-y-2">
                  <Label>Photos</Label>
                  {(editingListing.listingPhotos ?? []).length > 0 && (
                    <div className="grid grid-cols-4 gap-2 mb-2">
                      {(editingListing.listingPhotos ?? []).map((url: string) => (
                        <div key={url} className="relative group">
                          <img src={url} className="w-full h-20 object-cover rounded-md border" />
                          <button
                            type="button"
                            className="absolute top-1 right-1 bg-black/60 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => removePhotoMutation.mutate({ listingId: editingListing.id, url })}
                          >
                            <Trash2 className="h-3 w-3 text-white" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <Input
                    type="file" accept="image/*"
                    disabled={uploadingPhoto}
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) uploadPhotoMutation.mutate({ listingId: editingListing.id, file });
                      e.target.value = "";
                    }}
                  />
                  {uploadingPhoto && <p className="text-xs text-muted-foreground">Uploading…</p>}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Photos can be added once the listing is created — edit it afterward to upload some.</p>
              )}

              <div className="grid grid-cols-3 gap-4">
                <div className="flex items-center space-x-2">
                  <Switch id="calendarSyncEnabled" name="calendarSyncEnabled" defaultChecked={editingListing?.calendarSyncEnabled} />
                  <Label htmlFor="calendarSyncEnabled">Calendar Sync</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch id="autoPricingEnabled" name="autoPricingEnabled" defaultChecked={editingListing?.autoPricingEnabled} />
                  <Label htmlFor="autoPricingEnabled">Auto Pricing</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch id="instantBookingEnabled" name="instantBookingEnabled" defaultChecked={editingListing?.instantBookingEnabled} />
                  <Label htmlFor="instantBookingEnabled">Instant Booking</Label>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" name="notes" defaultValue={editingListing?.notes} placeholder="Additional notes for property manager review" />
              </div>

              <div className="flex gap-2 pt-4">
                <Button type="submit" disabled={createListingMutation.isPending || updateListingMutation.isPending} className="flex-1 bg-emerald-600 hover:bg-emerald-700">
                  {createListingMutation.isPending || updateListingMutation.isPending ? "Saving..." : (editingListing ? "Update Listing" : "Create Listing")}
                </Button>
                <Button type="button" variant="outline" onClick={() => {
                  setIsAddListingOpen(false);
                  setEditingListing(null);
                }}>Cancel</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
        {[
          { title: "Total Listings", value: totalListings, sub: "All tenant listings", icon: <Home className="h-4 w-4 text-rose-500" />, color: "text-rose-500" },
          { title: "Approved", value: approvedListings, sub: "Manager approved", icon: <CheckCircle className="h-4 w-4 text-emerald-500" />, color: "text-emerald-500" },
          { title: "Active", value: activeListings, sub: "Currently live", icon: <Zap className="h-4 w-4 text-amber-500" />, color: "text-amber-500" },
          { title: "Total Bookings", value: totalBookings, sub: "All time", icon: <Calendar className="h-4 w-4 text-blue-500" />, color: "text-blue-500" },
          { title: "Total Revenue", value: formatCurrency(totalRevenue, "KES"), sub: "Gross revenue", icon: <TrendingUp className="h-4 w-4 text-violet-500" />, color: "text-violet-500" },
          { title: "Tenant Earnings", value: formatCurrency(tenantEarnings, "KES"), sub: "Tenant payouts", icon: <DollarSign className="h-4 w-4 text-emerald-600" />, color: "text-emerald-600" },
        ].map(({ title, value, sub, icon, color }) => (
          <Card key={title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{title}</CardTitle>
              {icon}
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${color}`}>{value}</div>
              <p className="text-xs text-muted-foreground">{sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="listings"><Home className="h-4 w-4 mr-1.5" />Listings</TabsTrigger>
          <TabsTrigger value="bookings"><Bed className="h-4 w-4 mr-1.5" />Bookings</TabsTrigger>
          <TabsTrigger value="earnings"><BarChart2 className="h-4 w-4 mr-1.5" />Earnings Tracker</TabsTrigger>
          <TabsTrigger value="calendar"><Calendar className="h-4 w-4 mr-1.5" />Calendar</TabsTrigger>
        </TabsList>

        {/* ══════════ LISTINGS TAB ══════════ */}
        <TabsContent value="listings" className="space-y-4 pt-4">
          <Card>
            <CardContent className="pt-4 flex gap-4 flex-col md:flex-row">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Search listings..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
              </div>
              <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                <SelectTrigger className="w-48"><Filter className="h-4 w-4 mr-2" /><SelectValue placeholder="All Statuses" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <div className="grid gap-4">
            {loadingListings ? (
              <div className="flex justify-center p-8">
                <div className="animate-spin w-8 h-8 border-4 border-rose-400 border-t-transparent rounded-full" />
              </div>
            ) : paginatedListings.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center p-12">
                  <div className="w-16 h-16 rounded-full bg-rose-50 flex items-center justify-center mb-4">
                    <Home className="h-8 w-8 text-rose-400" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">No listings found</h3>
                  <p className="text-muted-foreground text-center text-sm mb-4">No short-term rental listings match your current filters.</p>
                  <Button onClick={() => setIsAddListingOpen(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                    <Plus className="h-4 w-4 mr-2" /> Create your first listing
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <>
                {paginatedListings.map(listing => {
                  const listingBookings = safeBookings.filter(b => b.rentalListingId === listing.id);
                  const listingRevenue = listingBookings.reduce((s, b) => s + Number(b.tenantPayout || 0), 0);
                  return (
                    <Card key={listing.id} className="hover:shadow-md transition-shadow border-l-4 border-l-transparent hover:border-l-rose-300">
                      <CardContent className="p-6">
                        <div className="flex items-start justify-between">
                          <div className="space-y-3 flex-1">
                            <div className="flex items-center gap-3 flex-wrap">
                              <h3 className="text-lg font-semibold">{listing.listingTitle}</h3>
                              <StatusBadge status={listing.approvalStatus} />
                              {listing.isActive && (
                                <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200" >
                                  <Star className="h-3 w-3 mr-1 fill-emerald-500" /> Live
                                </Badge>
                              )}
                              {listing.instantBookingEnabled && (
                                <Badge variant="outline" className="text-rose-500 border-rose-300 text-xs">
                                  <Zap className="h-3 w-3 mr-1" /> Instant Book
                                </Badge>
                              )}
                            </div>

                            <p className="text-muted-foreground text-sm line-clamp-2">{listing.description}</p>

                            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                              <div className="bg-rose-50 rounded-lg p-2 text-center">
                                <p className="text-xs text-muted-foreground">Nightly Rate</p>
                                <p className="font-bold text-rose-600">{formatCurrency(Number(listing.nightlyRate), listing.currency)}</p>
                              </div>
                              <div className="bg-muted/50 rounded-lg p-2 text-center">
                                <p className="text-xs text-muted-foreground">Stay</p>
                                <p className="font-medium">{listing.minimumNights}–{listing.maximumNights} nights</p>
                              </div>
                              <div className="bg-muted/50 rounded-lg p-2 text-center">
                                <p className="text-xs text-muted-foreground">Check-in/out</p>
                                <p className="font-medium">{listing.checkInTime} / {listing.checkOutTime}</p>
                              </div>
                              <div className="bg-emerald-50 rounded-lg p-2 text-center">
                                <p className="text-xs text-muted-foreground">Tenant Share</p>
                                <p className="font-bold text-emerald-600">{listing.tenantEarningsShare}%</p>
                              </div>
                              <div className="bg-blue-50 rounded-lg p-2 text-center">
                                <p className="text-xs text-muted-foreground">Total Earned</p>
                                <p className="font-bold text-blue-600">{formatCurrency(listingRevenue, listing.currency)}</p>
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              {listing.amenities.slice(0, 6).map((amenity, idx) => (
                                <Badge key={idx} variant="outline" className="text-xs flex items-center gap-1">
                                  {AMENITY_ICONS[amenity] || AMENITY_ICONS.default} {amenity}
                                </Badge>
                              ))}
                              {listing.amenities.length > 6 && (
                                <Badge variant="outline" className="text-xs">+{listing.amenities.length - 6} more</Badge>
                              )}
                            </div>

                            <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                              {listing.calendarSyncEnabled && <span className="flex items-center gap-1 text-blue-600"><RefreshCw className="h-3 w-3" /> Calendar Sync</span>}
                              {listing.autoPricingEnabled && <span className="flex items-center gap-1 text-violet-600"><TrendingUp className="h-3 w-3" /> Smart Pricing</span>}
                              <span className="flex items-center gap-1"><Bed className="h-3 w-3" /> {listingBookings.length} booking{listingBookings.length !== 1 ? "s" : ""}</span>
                              <span className="text-muted-foreground/60">Created {format(parseISO(listing.createdAt), "dd MMM yyyy")}</span>
                              <button
                                className="flex items-center gap-1 text-rose-500 hover:text-rose-700 font-medium transition-colors ml-auto"
                                onClick={(e) => { e.stopPropagation(); setSelectedCalendarListingId(listing.id); setActiveTab("calendar"); }}
                              >
                                <Calendar className="h-3 w-3" /> View in Calendar
                              </button>
                            </div>
                          </div>

                          <div className="ml-4 flex-shrink-0">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0"
                                  disabled={updateListingStatusMutation.isPending || deleteListingMutation.isPending}
                                >
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-44">
                                <DropdownMenuItem onClick={() => setEditingListing(listing)}>
                                  <Edit2 className="h-4 w-4 mr-2" /> Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setManagingBlocksFor(listing)}>
                                  <Lock className="h-4 w-4 mr-2" /> Manage blocked dates
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setManagingSyncFor(listing)}>
                                  <RefreshCw className="h-4 w-4 mr-2" /> Calendar sync
                                </DropdownMenuItem>
                                {listing.approvalStatus === "pending" && isManager && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      className="text-emerald-600 focus:text-emerald-600"
                                      onClick={() => {
                                        if (listing.tenantId) {
                                          const notice = listing.landlordNotifiedAt
                                            ? `The landlord was automatically notified on ${new Date(listing.landlordNotifiedAt).toLocaleDateString()}.`
                                            : "The automatic landlord notification email does not appear to have gone out.";
                                          const ok = confirm(
                                            `This is a tenant sublet listing. ${notice}\n\nConfirm the landlord is aware of this arrangement and hasn't objected before approving.`
                                          );
                                          if (!ok) return;
                                          updateListingStatusMutation.mutate({ id: listing.id, status: "approved", landlordConsentConfirmed: true });
                                        } else {
                                          updateListingStatusMutation.mutate({ id: listing.id, status: "approved" });
                                        }
                                      }}
                                    >
                                      <CheckCircle className="h-4 w-4 mr-2" /> Approve
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      className="text-red-600 focus:text-red-600"
                                      onClick={() => updateListingStatusMutation.mutate({ id: listing.id, status: "rejected" })}
                                    >
                                      <XCircle className="h-4 w-4 mr-2" /> Reject
                                    </DropdownMenuItem>
                                  </>
                                )}
                                {listing.approvalStatus === "rejected" && isManager && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onClick={() => updateListingStatusMutation.mutate({ id: listing.id, status: "pending" })}
                                    >
                                      <RefreshCw className="h-4 w-4 mr-2" /> Re-submit
                                    </DropdownMenuItem>
                                  </>
                                )}
                                {listing.approvalStatus === "approved" && listing.slug && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onClick={() => {
                                        const url = `${window.location.origin}/stay/${listing.slug}`;
                                        navigator.clipboard.writeText(url);
                                        toast({ title: "Link copied", description: url });
                                      }}
                                    >
                                      <ExternalLink className="h-4 w-4 mr-2" /> Copy booking link
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      disabled={updateListingVisibilityMutation.isPending}
                                      onClick={() => updateListingVisibilityMutation.mutate({ id: listing.id, isPubliclyListed: !listing.isPubliclyListed })}
                                    >
                                      {listing.isPubliclyListed ? (
                                        <><Lock className="h-4 w-4 mr-2" /> Remove from marketplace</>
                                      ) : (
                                        <><Globe className="h-4 w-4 mr-2" /> List in public marketplace</>
                                      )}
                                    </DropdownMenuItem>
                                  </>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-red-600 focus:text-red-600"
                                  onClick={() => {
                                    if (confirm("Are you sure you want to delete this listing?")) {
                                      deleteListingMutation.mutate(listing.id);
                                    }
                                  }}
                                >
                                  <Trash2 className="h-4 w-4 mr-2" /> Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
                
                {/* Pagination for Listings */}
                <Pagination
                  currentPage={listingsPage}
                  totalItems={filteredListings.length}
                  pageSize={listingsPageSize}
                  onPageChange={setListingsPage}
                  onPageSizeChange={(size) => {
                    setListingsPageSize(size);
                    setListingsPage(1);
                  }}
                />
              </>
            )}
          </div>
        </TabsContent>

        {/* ══════════ BOOKINGS TAB ══════════ */}
        <TabsContent value="bookings" className="space-y-4 pt-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex flex-col md:flex-row gap-3">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-9" placeholder="Search by guest name or booking reference..." value={bookingSearch} onChange={e => setBookingSearch(e.target.value)} />
                </div>
                <Select value={bookingStatusFilter} onValueChange={setBookingStatusFilter}>
                  <SelectTrigger className="w-44"><SelectValue placeholder="All Statuses" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="confirmed">Confirmed</SelectItem>
                    <SelectItem value="checked_in">Checked In</SelectItem>
                    <SelectItem value="checked_out">Checked Out</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                    <SelectItem value="expired">Expired (never paid)</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={platformFilter} onValueChange={setPlatformFilter}>
                  <SelectTrigger className="w-44"><SelectValue placeholder="All Platforms" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Platforms</SelectItem>
                    <SelectItem value="airbnb">🏠 Airbnb</SelectItem>
                    <SelectItem value="booking">🌐 Booking.com</SelectItem>
                    <SelectItem value="vrbo">🏡 VRBO</SelectItem>
                    <SelectItem value="direct">✓ Direct</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {paginatedBookings.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center p-12">
                <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center mb-4">
                  <Bed className="h-8 w-8 text-blue-400" />
                </div>
                <h3 className="text-lg font-semibold mb-2">No bookings found</h3>
                <p className="text-muted-foreground text-center text-sm">
                  {bookingSearch || bookingStatusFilter !== "all" || platformFilter !== "all"
                    ? "No bookings match your current filters."
                    : "Bookings from Airbnb, Booking.com, and direct reservations will appear here."}
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="space-y-3">
                {paginatedBookings.map(booking => {
                  const listing = safeListings.find(l => l.id === booking.rentalListingId);
                  return (
                    <Card key={booking.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => setSelectedBooking(booking)}>
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between flex-wrap gap-3">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-rose-400 to-rose-600 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
                              {booking.guestName?.charAt(0)}
                            </div>
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-semibold">{booking.guestName}</p>
                                <span className="font-mono text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{booking.bookingReference}</span>
                              </div>
                              <div className="flex items-center gap-2 text-sm text-muted-foreground mt-0.5">
                                <span>{listing?.listingTitle || `Listing #${booking.rentalListingId}`}</span>
                                <span>·</span>
                                <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {booking.guestCount || 1} guest{(booking.guestCount || 1) !== 1 ? "s" : ""}</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-6 text-sm">
                            <div className="hidden md:block text-center">
                              <p className="text-xs text-muted-foreground">Check-in</p>
                              <p className="font-medium">{format(parseISO(booking.checkInDate), "dd MMM")}</p>
                            </div>
                            <div className="hidden md:block text-center">
                              <p className="text-xs text-muted-foreground">Check-out</p>
                              <p className="font-medium">{format(parseISO(booking.checkOutDate), "dd MMM")}</p>
                            </div>
                            <div className="hidden md:block text-center">
                              <p className="text-xs text-muted-foreground">Nights</p>
                              <p className="font-medium">{booking.numberOfNights}</p>
                            </div>
                            <div className="text-right">
                              <p className="font-bold text-emerald-600">{formatCurrency(Number(booking.tenantPayout), booking.currency)}</p>
                              <p className="text-xs text-muted-foreground">payout</p>
                            </div>
                            <div className="flex flex-col gap-1 items-end">
                              <BookingStatusBadge status={booking.bookingStatus} />
                              <div className="flex gap-1">
                                <PlatformBadge platform={booking.platformSource} />
                                <PaymentBadge status={booking.paymentStatus} />
                              </div>
                            </div>
                            <Eye className="h-4 w-4 text-muted-foreground" />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
              
              {/* Pagination for Bookings */}
              <Pagination
                currentPage={bookingsPage}
                totalItems={filteredBookings.length}
                pageSize={bookingsPageSize}
                onPageChange={setBookingsPage}
                onPageSizeChange={(size) => {
                  setBookingsPageSize(size);
                  setBookingsPage(1);
                }}
              />
            </>
          )}
        </TabsContent>

        {/* ══════════ EARNINGS TAB ══════════ */}
        <TabsContent value="earnings" className="space-y-4 pt-4">
          <div className="grid gap-4 md:grid-cols-4">
            <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50 to-white">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-emerald-700">Total Tenant Earnings</p>
                  <DollarSign className="h-5 w-5 text-emerald-500" />
                </div>
                <p className="text-3xl font-bold text-emerald-700">{formatCurrency(tenantEarnings, "KES")}</p>
                <p className="text-xs text-emerald-600 mt-1">All-time payouts to tenants</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium">Gross Revenue</p>
                  <TrendingUp className="h-5 w-5 text-violet-500" />
                </div>
                <p className="text-3xl font-bold">{formatCurrency(totalRevenue, "KES")}</p>
                <p className="text-xs text-muted-foreground mt-1">Before all deductions</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium">Avg. Nightly Rate</p>
                  <Star className="h-5 w-5 text-amber-500" />
                </div>
                <p className="text-3xl font-bold">{formatCurrency(earningsData.avgNightlyRate, "KES")}</p>
                <p className="text-xs text-muted-foreground mt-1">Across confirmed bookings</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium">Total Nights Booked</p>
                  <Bed className="h-5 w-5 text-blue-500" />
                </div>
                <p className="text-3xl font-bold">{earningsData.totalNights}</p>
                <p className="text-xs text-muted-foreground mt-1">Nights across all bookings</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Platform Breakdown */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><PieChart className="h-4 w-4 text-rose-500" /> Revenue by Platform</CardTitle>
                <CardDescription>Booking and revenue distribution across platforms</CardDescription>
              </CardHeader>
              <CardContent>
                {Object.keys(earningsData.platformBreakdown).length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-6 text-center">
                    <Globe className="h-8 w-8 text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">No bookings yet. Platform breakdown will appear here.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {Object.entries(earningsData.platformBreakdown).map(([platform, data]) => {
                      const pct = totalRevenue > 0 ? Math.round((data.revenue / totalRevenue) * 100) : 0;
                      const barColors: Record<string, string> = { airbnb: "bg-rose-500", booking: "bg-blue-500", direct: "bg-emerald-500", vrbo: "bg-purple-500" };
                      const barColor = barColors[platform.toLowerCase()] || "bg-slate-400";
                      return (
                        <div key={platform}>
                          <div className="flex items-center justify-between text-sm mb-1">
                            <div className="flex items-center gap-2">
                              <PlatformBadge platform={platform} />
                              <span className="text-muted-foreground">{data.bookings} booking{data.bookings !== 1 ? "s" : ""}</span>
                            </div>
                            <div className="text-right">
                              <span className="font-semibold">{formatCurrency(data.revenue, "KES")}</span>
                              <span className="text-muted-foreground ml-1 text-xs">({pct}%)</span>
                            </div>
                          </div>
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                          </div>
                          <p className="text-xs text-emerald-600 mt-0.5">Tenant payout: {formatCurrency(data.payout, "KES")}</p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Revenue Breakdown */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><BarChart2 className="h-4 w-4 text-violet-500" /> Revenue Breakdown</CardTitle>
                <CardDescription>How gross revenue is distributed</CardDescription>
              </CardHeader>
              <CardContent>
                {totalRevenue === 0 ? (
                  <div className="flex flex-col items-center justify-center p-6 text-center">
                    <DollarSign className="h-8 w-8 text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">Revenue breakdown will appear here once bookings are made.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {[
                      { label: "Tenant Earnings", value: tenantEarnings, pct: totalRevenue > 0 ? Math.round((tenantEarnings / totalRevenue) * 100) : 0, color: "bg-emerald-500", textColor: "text-emerald-700" },
                      { label: "Platform & Manager Fees", value: earningsData.totalFees, pct: totalRevenue > 0 ? Math.round((earningsData.totalFees / totalRevenue) * 100) : 0, color: "bg-red-400", textColor: "text-red-600" },
                    ].map(({ label, value, pct, color, textColor }) => (
                      <div key={label}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="font-medium">{label}</span>
                          <span className={`font-semibold ${textColor}`}>
                            {formatCurrency(value, "KES")} <span className="font-normal text-muted-foreground">({pct}%)</span>
                          </span>
                        </div>
                        <div className="h-3 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    ))}

                    <div className="border-t pt-3 space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Gross Revenue</span>
                        <span className="font-medium">{formatCurrency(totalRevenue, "KES")}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Platform & Manager Fees</span>
                        <span className="text-red-500">−{formatCurrency(earningsData.totalFees, "KES")}</span>
                      </div>
                      <div className="flex justify-between font-semibold border-t pt-2">
                        <span>Net Tenant Earnings</span>
                        <span className="text-emerald-600">{formatCurrency(tenantEarnings, "KES")}</span>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Payout History Table */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Download className="h-4 w-4" /> Payout History</CardTitle>
              <CardDescription>Individual booking payouts to tenants</CardDescription>
            </CardHeader>
            <CardContent>
              {safeBookings.length === 0 ? (
                <div className="text-center p-6 text-muted-foreground text-sm">No payout records yet.</div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-xs text-muted-foreground">
                          <th className="text-left pb-2 font-medium">Booking Ref</th>
                          <th className="text-left pb-2 font-medium">Guest</th>
                          <th className="text-left pb-2 font-medium">Platform</th>
                          <th className="text-left pb-2 font-medium">Dates</th>
                          <th className="text-right pb-2 font-medium">Gross</th>
                          <th className="text-right pb-2 font-medium">Fees</th>
                          <th className="text-right pb-2 font-medium">Payout</th>
                          <th className="text-left pb-2 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {paginatedPayouts.map(b => (
                          <tr key={b.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => setSelectedBooking(b)}>
                            <td className="py-2 font-mono text-xs text-muted-foreground">{b.bookingReference}</td>
                            <td className="py-2 font-medium">{b.guestName}</td>
                            <td className="py-2"><PlatformBadge platform={b.platformSource} /></td>
                            <td className="py-2 text-muted-foreground">{format(parseISO(b.checkInDate), "dd MMM")} – {format(parseISO(b.checkOutDate), "dd MMM yyyy")}</td>
                            <td className="py-2 text-right">{formatCurrency(Number(b.totalAmount), b.currency)}</td>
                            <td className="py-2 text-right text-red-500">−{formatCurrency(Number(b.platformFees || 0) + Number(b.propertyManagerCommission || 0), b.currency)}</td>
                            <td className="py-2 text-right font-semibold text-emerald-600">{formatCurrency(Number(b.tenantPayout), b.currency)}</td>
                            <td className="py-2"><BookingStatusBadge status={b.bookingStatus} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  
                  {/* Pagination for Payouts */}
                  <Pagination
                    currentPage={payoutsPage}
                    totalItems={safeBookings.length}
                    pageSize={payoutsPageSize}
                    onPageChange={setPayoutsPage}
                    onPageSizeChange={(size) => {
                      setPayoutsPageSize(size);
                      setPayoutsPage(1);
                    }}
                  />
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ══════════ CALENDAR TAB ══════════ */}
        <TabsContent value="calendar" className="space-y-4 pt-4">
          {/* Listing filter bar */}
          <Card>
            <CardContent className="pt-4 flex flex-col sm:flex-row gap-3 items-start sm:items-center">
              <div className="flex items-center gap-2 text-sm font-medium shrink-0">
                <Home className="h-4 w-4 text-rose-500" /> Filter by listing:
              </div>
              <div className="flex flex-wrap gap-2 flex-1">
                <button
                  onClick={() => setSelectedCalendarListingId(null)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${selectedCalendarListingId === null ? "bg-rose-500 text-white border-rose-500" : "bg-muted hover:bg-muted/80 border-transparent text-muted-foreground hover:text-foreground"}`}
                >
                  All Listings
                </button>
                {safeListings.map(l => (
                  <button
                    key={l.id}
                    onClick={() => setSelectedCalendarListingId(l.id === selectedCalendarListingId ? null : l.id)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors flex items-center gap-1.5 ${selectedCalendarListingId === l.id ? "bg-rose-500 text-white border-rose-500" : "bg-muted hover:bg-muted/80 border-transparent text-muted-foreground hover:text-foreground"}`}
                  >
                    {l.listingTitle}
                    <StatusBadge status={l.approvalStatus} />
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-3">
            {/* Calendar grid */}
            <div className="md:col-span-2">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-rose-500" /> Availability Calendar
                    </CardTitle>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" /> Check-in</span>
                      <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-rose-300 inline-block" /> Booked</span>
                      <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-slate-400 inline-block" /> Check-out</span>
                    </div>
                  </div>
                  <CardDescription>
                    {selectedCalendarListingId !== null
                      ? (() => { const l = safeListings.find(x => x.id === selectedCalendarListingId); return l ? <>Showing bookings for <span className="font-medium text-foreground">{l.listingTitle}</span> &mdash; <StatusBadge status={l.approvalStatus} /></> : "Showing selected listing"; })()
                      : "Showing all bookings across active listings"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <CalendarGrid />

                  {/* Platform sync */}
                  <div className="mt-6 pt-4 border-t">
                    <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                      <RefreshCw className="h-4 w-4 text-blue-500" /> Calendar Sync
                    </h4>
                    <p className="text-sm text-muted-foreground">
                      Calendar sync (export link + connecting Airbnb, VRBO, Booking.com, or Google Calendar) is set up per
                      listing — open a listing's menu below and choose <strong>Calendar sync</strong> to manage it.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Sidebar */}
            <div className="space-y-4">
              {/* Selected listing info card */}
              {selectedCalendarListingId !== null && (() => {
                const l = safeListings.find(x => x.id === selectedCalendarListingId);
                if (!l) return null;
                const lBookings = safeBookings.filter(b => b.rentalListingId === l.id);
                const lRevenue = lBookings.reduce((s, b) => s + Number(b.tenantPayout || 0), 0);
                return (
                  <Card className="border-rose-200 bg-gradient-to-br from-rose-50 to-white">
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-sm font-semibold text-rose-800 leading-tight">{l.listingTitle}</CardTitle>
                        <button
                          onClick={() => setSelectedCalendarListingId(null)}
                          className="text-rose-400 hover:text-rose-600 text-xs shrink-0 mt-0.5"
                          title="Clear filter"
                        >✕</button>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <StatusBadge status={l.approvalStatus} />
                        {l.isActive && <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200"><Star className="h-3 w-3 mr-1 fill-emerald-500" />Live</Badge>}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2 text-xs">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-md bg-white border p-2 text-center">
                          <p className="text-muted-foreground">Nightly Rate</p>
                          <p className="font-bold text-rose-600">{formatCurrency(Number(l.nightlyRate), l.currency)}</p>
                        </div>
                        <div className="rounded-md bg-white border p-2 text-center">
                          <p className="text-muted-foreground">Bookings</p>
                          <p className="font-bold">{lBookings.length}</p>
                        </div>
                        <div className="rounded-md bg-white border p-2 text-center">
                          <p className="text-muted-foreground">Stay</p>
                          <p className="font-medium">{l.minimumNights}–{l.maximumNights} nights</p>
                        </div>
                        <div className="rounded-md bg-white border p-2 text-center">
                          <p className="text-muted-foreground">Tenant Share</p>
                          <p className="font-bold text-emerald-600">{l.tenantEarningsShare}%</p>
                        </div>
                      </div>
                      <div className="rounded-md bg-emerald-50 border border-emerald-200 p-2 flex justify-between items-center">
                        <span className="text-emerald-700 font-medium">Total Earned</span>
                        <span className="font-bold text-emerald-700">{formatCurrency(lRevenue, l.currency)}</span>
                      </div>
                      {l.amenities.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {l.amenities.slice(0, 4).map((a, i) => (
                            <Badge key={i} variant="outline" className="text-[10px] flex items-center gap-0.5">
                              {AMENITY_ICONS[a] || AMENITY_ICONS.default} {a}
                            </Badge>
                          ))}
                          {l.amenities.length > 4 && <Badge variant="outline" className="text-[10px]">+{l.amenities.length - 4}</Badge>}
                        </div>
                      )}
                      <button
                        onClick={() => { setActiveTab("listings"); }}
                        className="w-full text-center text-rose-500 hover:text-rose-700 font-medium flex items-center justify-center gap-1 pt-1 transition-colors"
                      >
                        <ArrowUpRight className="h-3 w-3" /> View in Listings
                      </button>
                    </CardContent>
                  </Card>
                );
              })()}

              {/* Upcoming arrivals */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Clock className="h-4 w-4 text-amber-500" /> Upcoming Arrivals
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {(() => {
                    const today = new Date();
                    const upcoming = calendarBookings
                      .filter(b => ["confirmed","pending"].includes(b.bookingStatus) && parseISO(b.checkInDate) >= today)
                      .sort((a, b) => parseISO(a.checkInDate).getTime() - parseISO(b.checkInDate).getTime())
                      .slice(0, 5);
                    if (upcoming.length === 0) return (
                      <div className="text-center py-6">
                        <Calendar className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">No upcoming arrivals</p>
                      </div>
                    );
                    return (
                      <div className="space-y-3">
                        {upcoming.map(b => {
                          const daysUntil = Math.ceil((parseISO(b.checkInDate).getTime() - today.getTime()) / 86400000);
                          return (
                            <div key={b.id} className="flex items-start gap-3 cursor-pointer hover:bg-muted/50 rounded-lg p-2 -mx-2 transition-colors" onClick={() => setSelectedBooking(b)}>
                              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-rose-400 to-rose-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                                {b.guestName?.charAt(0)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{b.guestName}</p>
                                <p className="text-xs text-muted-foreground">{format(parseISO(b.checkInDate), "dd MMM")} · {b.numberOfNights} nights</p>
                              </div>
                              <Badge className={`text-xs flex-shrink-0 border ${daysUntil <= 3 ? "bg-amber-100 text-amber-700 border-amber-200" : "bg-blue-50 text-blue-700 border-blue-200"}`}>
                                {daysUntil === 0 ? "Today" : daysUntil === 1 ? "Tomorrow" : `in ${daysUntil}d`}
                              </Badge>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>

              {/* Active stays */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Unlock className="h-4 w-4 text-emerald-500" /> Active Stays
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {(() => {
                    const activeStays = calendarBookings.filter(b => b.bookingStatus === "checked_in");
                    if (activeStays.length === 0) return (
                      <div className="text-center py-4">
                        <p className="text-sm text-muted-foreground">No active stays right now</p>
                      </div>
                    );
                    return (
                      <div className="space-y-3">
                        {activeStays.map(b => (
                          <div key={b.id} className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 cursor-pointer hover:bg-emerald-100 transition-colors" onClick={() => setSelectedBooking(b)}>
                            <div className="flex items-center justify-between">
                              <p className="text-sm font-medium text-emerald-800">{b.guestName}</p>
                              <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 border text-xs">
                                <Unlock className="h-3 w-3 mr-1" /> In
                              </Badge>
                            </div>
                            <p className="text-xs text-emerald-600 mt-1">Checks out {format(parseISO(b.checkOutDate), "dd MMM yyyy")}</p>
                            {b.checkInCode && <p className="text-xs text-muted-foreground mt-1 font-mono">Code: {b.checkInCode}</p>}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Booking detail modal */}
      {selectedBooking && (
        <BookingDetailDialog booking={selectedBooking} onClose={() => setSelectedBooking(null)} />
      )}
      {managingBlocksFor && (
        <BlockedDatesDialog listing={managingBlocksFor} onClose={() => setManagingBlocksFor(null)} />
      )}
      {managingSyncFor && (
        <CalendarSyncDialog listing={managingSyncFor} onClose={() => setManagingSyncFor(null)} />
      )}
    </div>
  );
}