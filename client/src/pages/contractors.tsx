import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Wrench, Users, Star, Plus, Shield, CheckCircle, Eye, Edit, Trash2, MoreHorizontal, Search, ChevronLeft, ChevronRight, Mail, Phone, MapPin, FileText, ShieldCheck, ShieldOff } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { Checkbox } from '@/components/ui/checkbox';
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { CurrencyDisplay } from '@/components/ui/currency-display';
import { useRoleGuard, ROLES } from "@/hooks/useRoleGuard";
import { useAuth } from "@/hooks/useAuth";


// Standard property services offered as specialty options
const PROPERTY_SERVICES = [
  "Plumbing",
  "Electrical",
  "HVAC / Air Conditioning",
  "Carpentry & Joinery",
  "Painting & Decorating",
  "Roofing",
  "Tiling & Flooring",
  "Masonry & Structural",
  "Landscaping & Gardening",
  "Cleaning & Housekeeping",
  "Pest Control",
  "Security Systems",
  "Elevator & Lift Maintenance",
  "Generator & Power Backup",
  "Water & Borehole Systems",
  "Swimming Pool Maintenance",
  "Glass & Glazing",
  "Welding & Metalwork",
  "Appliance Repair",
  "General Handyman",
];

interface Contractor {
  id: number;
  name: string;
  email: string;
  phone: string;
  specialty: string;
  rate: string;
  isAvailable: boolean;
  rating: number | string;
  completedJobs: number;
  address: string;
  notes: string;
  companyName?: string;
  phoneNumber?: string;
  hourlyRate?: string;
  isVerified?: boolean;
  totalJobs?: number;
  services?: string[];
  createdAt: string;
}

const parseRating = (rating: any): number => {
  if (typeof rating === 'number') return rating;
  if (typeof rating === 'string') return parseFloat(rating) || 0;
  return 0;
};

// Specialty select used in both create and edit forms
function SpecialtySelect({ defaultValue }: { defaultValue?: string }) {
  return (
    <Select name="specialty" defaultValue={defaultValue ?? ""} required>
      <SelectTrigger>
        <SelectValue placeholder="Select a service" />
      </SelectTrigger>
      <SelectContent>
        {PROPERTY_SERVICES.map(s => (
          <SelectItem key={s} value={s}>{s}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function ContractorsManagement() {
  const guard = useRoleGuard(ROLES.ADMIN_MANAGER_STAFF);
  if (guard.gate) return guard.gate;
  const { user } = useAuth();

  const [selectedSpecialty, setSelectedSpecialty] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [pageSize, setPageSize] = useState(9);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedContractor, setSelectedContractor] = useState<Contractor | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: contractorsRaw = [], isLoading } = useQuery<Contractor[]>({
    queryKey: ["/api/contractors"],
    queryFn: async () => {
      try {
        const r = await apiRequest("/api/contractors");
        return ensureArray(await r.json());
      } catch { return []; }
    },
  });
  const contractors = ensureArray(contractorsRaw);

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("/api/contractors", { method: "POST", data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contractors"] });
      setIsCreateOpen(false);
      toast({ title: "Contractor registered successfully" });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.message || "Failed to register contractor", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest(`/api/contractors/${id}`, { method: "PUT", data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contractors"] });
      setIsEditOpen(false);
      setSelectedContractor(null);
      toast({ title: "Contractor updated successfully" });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.message || "Failed to update contractor", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/contractors/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contractors"] });
      setIsViewOpen(false);
      setSelectedContractor(null);
      toast({ title: "Contractor removed" });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.message || "Failed to delete contractor", variant: "destructive" }),
  });

  const verifyMutation = useMutation({
    mutationFn: ({ id, verifiedBy }: { id: number; verifiedBy: string }) =>
      apiRequest(`/api/contractors/${id}/verify`, { method: "POST", data: { verifiedBy } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contractors"] });
      toast({ title: "Contractor verified" });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.message || "Failed to verify contractor", variant: "destructive" }),
  });

  const parseForm = (e: React.FormEvent<HTMLFormElement>) => {
    const fd = new FormData(e.currentTarget);
    const name = fd.get("name") as string;
    return {
      name,
      companyName: name, // DB requires both; treat the entered name as both
      email: fd.get("email") as string,
      phone: fd.get("phone") as string,
      specialty: fd.get("specialty") as string,
      rate: fd.get("rate") as string || undefined,
      address: fd.get("address") as string || undefined,
      notes: fd.get("notes") as string || undefined,
      isAvailable: fd.get("isAvailable") === "true",
      isVerified: fd.get("isVerified") === "true",
    };
  };

  // Derive unique specialties present in the current data for filter dropdown
  const specialtiesInUse = Array.from(new Set(contractors.map((c: Contractor) => c.specialty).filter(Boolean))).sort();

  const q = searchQuery.toLowerCase();
  const filtered = contractors.filter((c: Contractor) => {
    const matchSpec = selectedSpecialty === "all" || c.specialty === selectedSpecialty;
    const matchQ = !q ||
      (c.name || c.companyName || "").toLowerCase().includes(q) ||
      (c.specialty || "").toLowerCase().includes(q) ||
      (c.email || "").toLowerCase().includes(q) ||
      (c.phone || c.phoneNumber || "").toLowerCase().includes(q);
    return matchSpec && matchQ;
  });

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  if (isLoading) return (
    <div className="h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-muted-foreground">Loading contractors...</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Page header */}
      <div className="bg-card border-b border-border px-4 md:px-6 py-4 md:py-5">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Contractors</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {contractors.length} registered · {contractors.filter((c: Contractor) => c.isAvailable !== false).length} available
            </p>
          </div>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="bg-emerald-600 hover:bg-emerald-700 text-white">
                <Plus className="h-4 w-4 mr-1.5" />
                Register Contractor
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[560px]">
              <DialogHeader>
                <DialogTitle>Register New Contractor</DialogTitle>
                <DialogDescription>Add a new service provider to your roster.</DialogDescription>
              </DialogHeader>
              <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate(parseForm(e)); }}>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="name">Name / Company</Label>
                      <Input id="name" name="name" placeholder="ABC Services Ltd" required />
                    </div>
                    <div>
                      <Label htmlFor="specialty">Specialty</Label>
                      <SpecialtySelect />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="email">Email <span className="text-red-500">*</span></Label>
                      <Input id="email" name="email" type="email" placeholder="contact@company.com" required />
                      <p className="text-[11px] text-muted-foreground mt-1">A portal invite will be sent to this address.</p>
                    </div>
                    <div>
                      <Label htmlFor="phone">Phone</Label>
                      <Input id="phone" name="phone" placeholder="+254 700 000 000" required />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="rate">Hourly Rate (KES)</Label>
                      <Input id="rate" name="rate" type="number" placeholder="1500" />
                    </div>
                    <div>
                      <Label htmlFor="isAvailable">Availability</Label>
                      <Select name="isAvailable" defaultValue="true">
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="true">Available</SelectItem>
                          <SelectItem value="false">Unavailable</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="address">Address</Label>
                    <Input id="address" name="address" placeholder="123 Main Street, Nairobi" />
                  </div>
                  <div>
                    <Label htmlFor="notes">Notes</Label>
                    <Textarea id="notes" name="notes" placeholder="Additional notes..." rows={2} />
                  </div>
                  <div className="flex items-start gap-2.5 p-3 rounded-lg bg-muted/50 border border-border">
                    <Checkbox id="isVerified" name="isVerified" value="true" className="mt-0.5" />
                    <div>
                      <label htmlFor="isVerified" className="text-sm font-medium cursor-pointer">Mark as verified</label>
                      <p className="text-xs text-muted-foreground mt-0.5">Tick this if you have already vetted this contractor before registering them.</p>
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={createMutation.isPending} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                    {createMutation.isPending ? "Registering..." : "Register"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-6 space-y-4">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search by name, specialty, email..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              className="pl-9"
            />
          </div>
          <Select value={selectedSpecialty} onValueChange={(v) => { setSelectedSpecialty(v); setCurrentPage(1); }}>
            <SelectTrigger className="w-52">
              <SelectValue placeholder="All Specialties" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Specialties</SelectItem>
              {specialtiesInUse.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={pageSize.toString()} onValueChange={(v) => { setPageSize(parseInt(v)); setCurrentPage(1); }}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="6">6 per page</SelectItem>
              <SelectItem value="9">9 per page</SelectItem>
              <SelectItem value="12">12 per page</SelectItem>
              <SelectItem value="24">24 per page</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {filtered.length} result{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {paginated.length === 0 ? (
            <div className="col-span-full text-center py-16">
              <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No contractors found</h3>
              <p className="text-muted-foreground text-sm">
                {searchQuery || selectedSpecialty !== "all" ? "No contractors match your search." : "Register your first contractor to get started."}
              </p>
            </div>
          ) : paginated.map((c: Contractor) => {
            const rating = parseRating(c.rating);
            return (
              <Card key={c.id} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="text-base leading-snug truncate">{c.name || c.companyName}</CardTitle>
                      <CardDescription className="mt-0.5">{c.specialty}</CardDescription>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      {(c.isVerified || false) && (
                        <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px]">
                          <CheckCircle className="h-2.5 w-2.5 mr-1" />Verified
                        </Badge>
                      )}
                      <Badge variant={c.isAvailable !== false ? "default" : "secondary"} className="text-[10px]">
                        {c.isAvailable !== false ? "Available" : "Unavailable"}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2.5 pt-0">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Rate</span>
                    <CurrencyDisplay amount={parseFloat(c.rate || c.hourlyRate || "0")} />
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Jobs done</span>
                    <span className="font-medium">{c.completedJobs || c.totalJobs || 0}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Rating</span>
                    <div className="flex items-center gap-1">
                      <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
                      <span className="font-medium">{rating.toFixed(1)}</span>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => { setSelectedContractor(c); setIsViewOpen(true); }}>
                      <Eye className="h-3.5 w-3.5 mr-1.5" />View
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="px-2">
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem onClick={() => { setSelectedContractor(c); setIsEditOpen(true); }}>
                          <Edit className="h-4 w-4 mr-2" />Edit
                        </DropdownMenuItem>

                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => deleteMutation.mutate(c.id)}>
                          <Trash2 className="h-4 w-4 mr-2" />Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-2">
            <span className="text-sm text-muted-foreground">Page {currentPage} of {totalPages}</span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                .reduce<(number | string)[]>((acc, p, i, arr) => {
                  if (i > 0 && (p as number) - (arr[i - 1] as number) > 1) acc.push("…");
                  acc.push(p);
                  return acc;
                }, [])
                .map((p, i) => p === "…" ? (
                  <span key={`el-${i}`} className="px-2 text-muted-foreground text-sm">…</span>
                ) : (
                  <Button key={p} variant={currentPage === p ? "default" : "outline"} size="sm" onClick={() => setCurrentPage(p as number)} className="w-8 h-8 p-0">{p}</Button>
                ))}
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* View Contractor Dialog */}
      <Dialog open={isViewOpen} onOpenChange={(open) => { setIsViewOpen(open); if (!open) setSelectedContractor(null); }}>
        <DialogContent className="sm:max-w-[520px] p-0 overflow-hidden">
          {selectedContractor && (
            <>
              <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 px-6 pt-6 pb-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-full bg-white/20 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
                      {(selectedContractor.name || selectedContractor.companyName || "?")[0].toUpperCase()}
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-white leading-tight">{selectedContractor.name || selectedContractor.companyName}</h2>
                      <p className="text-emerald-100 text-sm mt-0.5">{selectedContractor.specialty || "Contractor"}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    {(selectedContractor.isVerified || false) && (
                      <Badge className="bg-white/20 text-white border-white/30 text-[10px]">
                        <CheckCircle className="h-2.5 w-2.5 mr-1" />Verified
                      </Badge>
                    )}
                    <Badge variant={selectedContractor.isAvailable !== false ? "default" : "secondary"} className="text-[10px]">
                      {selectedContractor.isAvailable !== false ? "Available" : "Unavailable"}
                    </Badge>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 mt-4">
                  {[
                    { label: "Rating", value: <div className="flex items-center justify-center gap-1"><Star className="h-3.5 w-3.5 fill-yellow-300 text-yellow-300" /><span>{parseRating(selectedContractor.rating).toFixed(1)}</span></div> },
                    { label: "Jobs Done", value: selectedContractor.completedJobs || selectedContractor.totalJobs || 0 },
                    { label: "Hourly Rate", value: `KSh ${parseFloat(selectedContractor.rate || selectedContractor.hourlyRate || "0").toLocaleString()}/hr` },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-white/10 rounded-lg px-3 py-2.5 text-center">
                      <p className="font-semibold text-sm text-white">{value}</p>
                      <p className="text-xs text-emerald-100">{label}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="px-6 py-5 space-y-3">
                {/* Contact info rows */}
                {[
                  { icon: Mail, label: "Email", value: selectedContractor.email },
                  { icon: Phone, label: "Phone", value: selectedContractor.phone || selectedContractor.phoneNumber },
                  { icon: MapPin, label: "Address", value: selectedContractor.address },
                ].filter(r => r.value).map(({ icon: Icon, label, value }) => (
                  <div key={label} className="flex items-center gap-3 py-2 border-b border-border last:border-0">
                    <div className="w-7 h-7 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                      <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">{label}</p>
                      <p className="text-sm font-medium text-foreground truncate">{value}</p>
                    </div>
                  </div>
                ))}
                {/* Verification status */}
                <div className="flex items-center gap-3 py-2 border-b border-border">
                  <div className="w-7 h-7 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                    <Shield className="w-3.5 h-3.5 text-muted-foreground" />
                  </div>
                  <div className="flex-1">
                    <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Verification</p>
                    {selectedContractor.isVerified
                      ? <p className="text-sm font-medium text-emerald-600 flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" />Verified contractor</p>
                      : <p className="text-sm text-amber-600 font-medium">Not yet verified</p>
                    }
                  </div>
                  {!selectedContractor.isVerified && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-emerald-700 border-emerald-200 hover:bg-emerald-50 h-7 text-xs"
                      disabled={verifyMutation.isPending}
                      onClick={() => verifyMutation.mutate({ id: selectedContractor.id, verifiedBy: "admin" })}
                    >
                      <ShieldCheck className="w-3 h-3 mr-1" />
                      Verify Now
                    </Button>
                  )}
                </div>
                {selectedContractor.notes && (
                  <div className="flex items-start gap-3 py-2">
                    <div className="w-7 h-7 rounded-md bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                      <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Notes</p>
                      <p className="text-sm text-muted-foreground">{selectedContractor.notes}</p>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between px-6 py-4 border-t bg-muted/20">
                <Button variant="destructive" size="sm" onClick={() => { deleteMutation.mutate(selectedContractor.id); }}>
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />Delete
                </Button>
                <Button size="sm" onClick={() => { setIsViewOpen(false); setIsEditOpen(true); }}>
                  <Edit className="h-3.5 w-3.5 mr-1.5" />Edit
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Contractor Dialog */}
      <Dialog open={isEditOpen} onOpenChange={(open) => { setIsEditOpen(open); if (!open) setSelectedContractor(null); }}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Edit Contractor</DialogTitle>
            <DialogDescription>Update contractor information.</DialogDescription>
          </DialogHeader>
          {selectedContractor && (
            <form onSubmit={(e) => {
              e.preventDefault();
              updateMutation.mutate({ id: selectedContractor.id, data: parseForm(e) });
            }}>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Name / Company</Label>
                    <Input name="name" defaultValue={selectedContractor.name || selectedContractor.companyName || ""} required />
                  </div>
                  <div>
                    <Label>Specialty</Label>
                    <SpecialtySelect defaultValue={selectedContractor.specialty} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Email</Label>
                    <Input name="email" type="email" defaultValue={selectedContractor.email || ""} />
                  </div>
                  <div>
                    <Label>Phone</Label>
                    <Input name="phone" defaultValue={selectedContractor.phone || selectedContractor.phoneNumber || ""} required />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Hourly Rate (KES)</Label>
                    <Input name="rate" type="number" defaultValue={selectedContractor.rate || selectedContractor.hourlyRate || ""} />
                  </div>
                  <div>
                    <Label>Availability</Label>
                    <Select name="isAvailable" defaultValue={selectedContractor.isAvailable !== false ? "true" : "false"}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true">Available</SelectItem>
                        <SelectItem value="false">Unavailable</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>Address</Label>
                  <Input name="address" defaultValue={selectedContractor.address || ""} />
                </div>
                <div>
                  <Label>Notes</Label>
                  <Textarea name="notes" rows={2} defaultValue={selectedContractor.notes || ""} />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={updateMutation.isPending} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                  {updateMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}