import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Plus, Car, MapPin, Settings, AlertCircle, CheckCircle, XCircle,
  Pencil, Trash2, DollarSign, User, Zap, Link2, Search, X,
  MoreVertical, ShieldCheck, ShieldX, RotateCcw, Ban,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { useRoleGuard, ROLES } from "@/hooks/useRoleGuard";
import { useAuth } from "@/hooks/useAuth";


interface ParkingSpace {
  id: number; propertyId: number; spaceNumber: string;
  floor?: string; section?: string;
  spaceType: "standard"|"compact"|"disabled"|"electric"|"visitor"|"reserved";
  monthlyRate?: number; currency: string; hasElectricCharging: boolean;
  isAvailable: boolean; isReserved: boolean; notes?: string;
  createdAt: string; updatedAt: string;
}
interface RegisteredVehicle {
  id: number; propertyId: number;
  ownerType: "tenant"|"visitor"|"staff"|"contractor"|"guest";
  plateNumber: string; vehicleType: string; make: string; model: string;
  year?: number; color: string;
  status: "active"|"inactive"|"pending_approval"|"blacklisted";
  isResident: boolean; notes?: string; createdAt: string; updatedAt: string;
}
interface ParkingAssignment {
  id: number; parkingSpaceId: number; vehicleId: number; tenantId?: number;
  assignmentType: "permanent"|"temporary"|"visitor"|"daily";
  startDate: string; endDate?: string; monthlyFee?: number; currency: string;
  status: "active"|"expired"|"suspended"|"terminated";
  notes?: string; assignedBy: string; createdAt: string; updatedAt: string;
  // Enriched fields from server joins
  tenantFirstName?: string | null;
  tenantLastName?: string | null;
  unitNumber?: string | null;
  visitorName?: string | null;
  visitorPurpose?: string | null;
}

// ── Derived occupancy ─────────────────────────────────────────────────────────
function useOccupiedIds(assignments: ParkingAssignment[]) {
  return useMemo(
    () => new Set(assignments.filter(a => a.status === "active").map(a => a.parkingSpaceId)),
    [assignments]
  );
}

// ── Pagination ────────────────────────────────────────────────────────────────
function usePagination<T>(items: T[], pageSize: number) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safe = Math.min(page, totalPages);
  return { page: safe, setPage, totalPages, paginated: items.slice((safe-1)*pageSize, safe*pageSize) };
}

function PaginationBar({ page, totalPages, onPage }: { page: number; totalPages: number; onPage:(p:number)=>void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-border">
      <span className="text-xs text-muted-foreground">{page} of {totalPages} pages</span>
      <div className="flex gap-1">
        <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={page===1} onClick={()=>onPage(page-1)}>Previous</Button>
        <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={page===totalPages} onClick={()=>onPage(page+1)}>Next</Button>
      </div>
    </div>
  );
}

// ── Search bar ────────────────────────────────────────────────────────────────
function SearchBar({ value, onChange, placeholder }: { value:string; onChange:(v:string)=>void; placeholder:string }) {
  return (
    <div className="relative flex-1 min-w-[180px]">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
      <Input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} className="pl-9 h-9" />
      {value && <button className="absolute right-2.5 top-1/2 -translate-y-1/2" onClick={()=>onChange("")}><X className="w-3.5 h-3.5 text-muted-foreground" /></button>}
    </div>
  );
}

// ── Type label maps ───────────────────────────────────────────────────────────
const SPACE_TYPE_STYLES: Record<string,string> = {
  standard: "bg-slate-100 text-muted-foreground",
  compact:  "bg-purple-50 text-purple-700",
  disabled: "bg-green-50 text-green-700",
  electric: "bg-yellow-50 text-yellow-700",
  visitor:  "bg-gray-100 text-muted-foreground",
  reserved: "bg-red-50 text-red-700",
};
const VEHICLE_STATUS_STYLES: Record<string,string> = {
  active:           "bg-emerald-50 text-emerald-700 border-emerald-200",
  inactive:         "bg-gray-100 text-muted-foreground border-gray-200",
  pending_approval: "bg-amber-50 text-amber-700 border-amber-200",
  blacklisted:      "bg-red-50 text-red-700 border-red-200",
};
const ASSIGN_STATUS_STYLES: Record<string,string> = {
  active:     "bg-emerald-50 text-emerald-700 border-emerald-200",
  expired:    "bg-gray-100 text-muted-foreground border-gray-200",
  suspended:  "bg-amber-50 text-amber-700 border-amber-200",
  terminated: "bg-red-50 text-red-700 border-red-200",
};

const spaceTypeOptions     = ["standard","compact","disabled","electric","visitor","reserved"];
const assignTypeOptions    = ["permanent","temporary","visitor","daily"];
const vehicleOwnerOptions  = ["tenant","visitor","staff","contractor","guest"];

export default function ParkingManagement() {
  const guard = useRoleGuard(ROLES.ADMIN_MANAGER_STAFF);
  if (guard.gate) return guard.gate;
  const { user } = useAuth();
  const canEdit = guard.canOperate;

  const [activeTab,       setActiveTab]       = useState("spaces");
  const [selectedProp,    setSelectedProp]    = useState("all");
  const [spacesSearch,    setSpacesSearch]    = useState("");
  const [vehiclesSearch,  setVehiclesSearch]  = useState("");
  const [assignSearch,    setAssignSearch]    = useState("");
  const [spacesAvail,     setSpacesAvail]     = useState("all");
  const [spacesPS,        setSpacesPS]        = useState(9);
  const [vehiclesPS,      setVehiclesPS]      = useState(15);
  const [assignPS,        setAssignPS]        = useState(15);
  const [isAddSpaceOpen,      setIsAddSpaceOpen]      = useState(false);
  const [isAddVehicleOpen,    setIsAddVehicleOpen]    = useState(false);
  const [isAddAssignOpen,     setIsAddAssignOpen]     = useState(false);
  const [editingSpace,        setEditingSpace]        = useState<ParkingSpace|null>(null);
  const [editingVehicle,      setEditingVehicle]      = useState<RegisteredVehicle|null>(null);
  const [editingAssignment,   setEditingAssignment]   = useState<ParkingAssignment|null>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ── Queries ───────────────────────────────────────────────────────────────
  const q = (key: string) => ({
    queryKey: [key],
    queryFn: async () => { try { return ensureArray(await (await apiRequest(key)).json()); } catch { return []; } },
  });
  const { data: propertiesRaw=[], isLoading: loadingProps } = useQuery(q("/api/properties"));
  const { data: tenantsRaw=[] }    = useQuery(q("/api/tenants"));
  const { data: spacesRaw=[],    isLoading: loadingSpaces }    = useQuery(q("/api/parking-spaces"));
  const { data: vehiclesRaw=[],  isLoading: loadingVehicles }  = useQuery(q("/api/registered-vehicles"));
  const { data: assignmentsRaw=[], isLoading: loadingAssigns } = useQuery(q("/api/parking-assignments"));

  const properties  = propertiesRaw  as any[];
  const tenants     = tenantsRaw     as any[];
  const spaces      = spacesRaw      as ParkingSpace[];
  const vehicles    = vehiclesRaw    as RegisteredVehicle[];
  const assignments = assignmentsRaw as ParkingAssignment[];

  const occupiedIds = useOccupiedIds(assignments);
  const isOccupied  = (id: number) => occupiedIds.has(id);

  // ── Filtered lists ────────────────────────────────────────────────────────
  const propId = selectedProp !== "all" ? parseInt(selectedProp) : null;

  const filteredSpaces = useMemo(() => {
    const q = spacesSearch.toLowerCase();
    return spaces.filter(s => {
      const mq = !q || s.spaceNumber?.toLowerCase().includes(q) || s.section?.toLowerCase().includes(q) || s.floor?.toLowerCase().includes(q);
      const mp = !propId || s.propertyId === propId;
      const occ = isOccupied(s.id);
      const ma = spacesAvail==="all" || (spacesAvail==="available"&&!occ) || (spacesAvail==="occupied"&&occ);
      return mq && mp && ma;
    });
  }, [spaces, spacesSearch, propId, spacesAvail, occupiedIds]);

  const filteredVehicles = useMemo(() => {
    const q = vehiclesSearch.toLowerCase();
    return vehicles.filter(v => {
      const mq = !q || v.plateNumber?.toLowerCase().includes(q) || `${v.make} ${v.model}`.toLowerCase().includes(q) || v.color?.toLowerCase().includes(q) || v.ownerType?.toLowerCase().includes(q);
      const mp = !propId || v.propertyId === propId;
      return mq && mp;
    });
  }, [vehicles, vehiclesSearch, propId]);

  const filteredAssigns = useMemo(() => {
    const q = assignSearch.toLowerCase();
    return assignments.filter(a => {
      const sp = spaces.find(s => s.id===a.parkingSpaceId);
      const ve = vehicles.find(v => v.id===a.vehicleId);
      const mq = !q || sp?.spaceNumber?.toLowerCase().includes(q) || ve?.plateNumber?.toLowerCase().includes(q) || `${ve?.make} ${ve?.model}`.toLowerCase().includes(q);
      const mp = !propId || sp?.propertyId === propId;
      return mq && mp;
    });
  }, [assignments, assignSearch, propId, spaces, vehicles]);

  const spacesPag  = usePagination(filteredSpaces,  spacesPS);
  const vehiclesPag = usePagination(filteredVehicles, vehiclesPS);
  const assignsPag  = usePagination(filteredAssigns,  assignPS);

  // ── Metrics ───────────────────────────────────────────────────────────────
  const totalSpaces    = spaces.length;
  const occupiedCount  = occupiedIds.size;
  const availableCount = totalSpaces - occupiedCount;
  const pendingCount   = vehicles.filter(v=>v.status==="pending_approval").length;
  const activeAssigns  = assignments.filter(a=>a.status==="active").length;

  // ── Mutations (condensed) ─────────────────────────────────────────────────
  const inv = (...keys: string[]) => keys.forEach(k=>queryClient.invalidateQueries({queryKey:[k]}));

  const createSpaceMut    = useMutation({ mutationFn:(d:any)=>apiRequest("/api/parking-spaces",{method:"POST",data:d}), onSuccess:()=>{inv("/api/parking-spaces");setIsAddSpaceOpen(false);toast({title:"Space created"});}, onError:(e:any)=>toast({title:"Error",description:e?.message,variant:"destructive"}) });
  const updateSpaceMut    = useMutation({ mutationFn:({id,data}:{id:number;data:any})=>apiRequest(`/api/parking-spaces/${id}`,{method:"PUT",data}), onSuccess:()=>{inv("/api/parking-spaces");setEditingSpace(null);toast({title:"Space updated"});}, onError:(e:any)=>toast({title:"Error",description:e?.message,variant:"destructive"}) });
  const deleteSpaceMut    = useMutation({ mutationFn:(id:number)=>apiRequest(`/api/parking-spaces/${id}`,{method:"DELETE"}), onSuccess:()=>{inv("/api/parking-spaces");toast({title:"Space deleted"});}, onError:(e:any)=>toast({title:"Error",description:e?.message,variant:"destructive"}) });

  const createVehicleMut  = useMutation({ mutationFn:(d:any)=>apiRequest("/api/registered-vehicles",{method:"POST",data:d}), onSuccess:()=>{inv("/api/registered-vehicles");setIsAddVehicleOpen(false);toast({title:"Vehicle registered"});}, onError:(e:any)=>toast({title:"Error",description:e?.message,variant:"destructive"}) });
  const updateVehicleMut  = useMutation({ mutationFn:({id,data}:{id:number;data:any})=>apiRequest(`/api/registered-vehicles/${id}`,{method:"PUT",data}), onSuccess:()=>{inv("/api/registered-vehicles");setEditingVehicle(null);toast({title:"Vehicle updated"});}, onError:(e:any)=>toast({title:"Error",description:e?.message,variant:"destructive"}) });
  const deleteVehicleMut  = useMutation({ mutationFn:(id:number)=>apiRequest(`/api/registered-vehicles/${id}`,{method:"DELETE"}), onSuccess:()=>{inv("/api/registered-vehicles");toast({title:"Vehicle deleted"});}, onError:(e:any)=>toast({title:"Error",description:e?.message,variant:"destructive"}) });
  const vehicleStatusMut  = useMutation({ mutationFn:({id,status}:{id:number;status:string})=>apiRequest(`/api/registered-vehicles/${id}/status`,{method:"PATCH",data:{status}}), onSuccess:()=>{inv("/api/registered-vehicles");toast({title:"Status updated"});}, onError:(e:any)=>toast({title:"Error",description:e?.message,variant:"destructive"}) });

  const createAssignMut   = useMutation({ mutationFn:(d:any)=>apiRequest("/api/parking-assignments",{method:"POST",data:d}), onSuccess:()=>{inv("/api/parking-assignments","/api/parking-spaces");setIsAddAssignOpen(false);toast({title:"Assignment created"});}, onError:(e:any)=>toast({title:"Error",description:e?.message,variant:"destructive"}) });
  const updateAssignMut   = useMutation({ mutationFn:({id,data}:{id:number;data:any})=>apiRequest(`/api/parking-assignments/${id}`,{method:"PUT",data}), onSuccess:()=>{inv("/api/parking-assignments","/api/parking-spaces");setEditingAssignment(null);toast({title:"Assignment updated"});}, onError:(e:any)=>toast({title:"Error",description:e?.message,variant:"destructive"}) });
  const deleteAssignMut   = useMutation({ mutationFn:(id:number)=>apiRequest(`/api/parking-assignments/${id}`,{method:"DELETE"}), onSuccess:()=>{inv("/api/parking-assignments","/api/parking-spaces");toast({title:"Assignment deleted"});}, onError:(e:any)=>toast({title:"Error",description:e?.message,variant:"destructive"}) });
  const assignStatusMut   = useMutation({ mutationFn:({id,status}:{id:number;status:string})=>apiRequest(`/api/parking-assignments/${id}/status`,{method:"PATCH",data:{status}}), onSuccess:()=>{inv("/api/parking-assignments","/api/parking-spaces");toast({title:"Status updated"});}, onError:(e:any)=>toast({title:"Error",description:e?.message,variant:"destructive"}) });

  // ── Form helpers ──────────────────────────────────────────────────────────
  const fd = (e: React.FormEvent<HTMLFormElement>) => new FormData(e.currentTarget);

  if (loadingProps) return (
    <div className="flex items-center justify-center h-96">
      <div className="text-center"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-3" /><p className="text-sm text-muted-foreground">Loading...</p></div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* ── Page header ────────────────────────────────────────────────────── */}
      <div className="bg-card border-b border-border px-4 md:px-6 py-4 md:py-5">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold">Parking & Vehicles</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {totalSpaces} spaces · {availableCount} available · {occupiedCount} occupied
              {pendingCount > 0 && <span className="ml-2 text-amber-600 font-medium">· {pendingCount} pending approval</span>}
            </p>
          </div>
          <div className="flex gap-2">
            {/* Add Space */}
            <Dialog open={isAddSpaceOpen} onOpenChange={setIsAddSpaceOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm"><MapPin className="h-4 w-4 mr-1.5" />Add Space</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Add Parking Space</DialogTitle><DialogDescription>Register a new space to this property.</DialogDescription></DialogHeader>
                <form onSubmit={e=>{e.preventDefault();const f=fd(e);createSpaceMut.mutate({spaceNumber:f.get("spaceNumber"),propertyId:parseInt(f.get("propertyId") as string),floor:f.get("floor")||undefined,section:f.get("section")||undefined,spaceType:f.get("spaceType"),monthlyRate:f.get("monthlyRate")?parseFloat(f.get("monthlyRate") as string):undefined,hasElectricCharging:f.get("ev")==="on",isAvailable:true,isReserved:false,currency:"KES"});}} className="space-y-4 pt-2">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5"><Label>Space Number *</Label><Input name="spaceNumber" required /></div>
                    <div className="space-y-1.5"><Label>Property *</Label>
                      <Select name="propertyId" required><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{properties.map((p:any)=><SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>)}</SelectContent></Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-1.5"><Label>Floor</Label><Input name="floor" placeholder="B1" /></div>
                    <div className="space-y-1.5"><Label>Section</Label><Input name="section" placeholder="A" /></div>
                    <div className="space-y-1.5"><Label>Type *</Label>
                      <Select name="spaceType" defaultValue="standard" required><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{spaceTypeOptions.map(t=><SelectItem key={t} value={t}>{t[0].toUpperCase()+t.slice(1)}</SelectItem>)}</SelectContent></Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5"><Label>Monthly Rate (KSh)</Label><Input type="number" name="monthlyRate" placeholder="0" /></div>
                    <div className="flex items-center gap-2 pt-6"><input type="checkbox" id="ev" name="ev" /><Label htmlFor="ev">EV Charging</Label></div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button type="submit" disabled={createSpaceMut.isPending} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white">{createSpaceMut.isPending?"Creating...":"Create Space"}</Button>
                    <Button type="button" variant="outline" onClick={()=>setIsAddSpaceOpen(false)}>Cancel</Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>

            {/* Register Vehicle */}
            <Dialog open={isAddVehicleOpen} onOpenChange={setIsAddVehicleOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white"><Car className="h-4 w-4 mr-1.5" />Register Vehicle</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Register Vehicle</DialogTitle><DialogDescription>Add a vehicle to the property registry.</DialogDescription></DialogHeader>
                <form onSubmit={e=>{e.preventDefault();const f=fd(e);createVehicleMut.mutate({plateNumber:f.get("plate"),propertyId:parseInt(f.get("propertyId") as string),ownerType:f.get("ownerType"),vehicleType:f.get("vehicleType"),make:f.get("make"),model:f.get("model"),year:f.get("year")?parseInt(f.get("year") as string):undefined,color:f.get("color"),isResident:f.get("ownerType")==="tenant",status:"pending_approval"});}} className="space-y-4 pt-2">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5"><Label>Plate Number *</Label><Input name="plate" placeholder="KCA 123A" required /></div>
                    <div className="space-y-1.5"><Label>Property *</Label>
                      <Select name="propertyId" required><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{properties.map((p:any)=><SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>)}</SelectContent></Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5"><Label>Owner Type *</Label>
                      <Select name="ownerType" defaultValue="tenant" required><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{vehicleOwnerOptions.map(t=><SelectItem key={t} value={t}>{t[0].toUpperCase()+t.slice(1)}</SelectItem>)}</SelectContent></Select>
                    </div>
                    <div className="space-y-1.5"><Label>Vehicle Type *</Label><Input name="vehicleType" placeholder="car, motorcycle..." required /></div>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-1.5"><Label>Make *</Label><Input name="make" required /></div>
                    <div className="space-y-1.5"><Label>Model *</Label><Input name="model" required /></div>
                    <div className="space-y-1.5"><Label>Year</Label><Input type="number" name="year" min="1900" max="2030" /></div>
                  </div>
                  <div className="space-y-1.5"><Label>Colour *</Label><Input name="color" required /></div>
                  <div className="flex gap-2 pt-1">
                    <Button type="submit" disabled={createVehicleMut.isPending} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white">{createVehicleMut.isPending?"Registering...":"Register"}</Button>
                    <Button type="button" variant="outline" onClick={()=>setIsAddVehicleOpen(false)}>Cancel</Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-6 space-y-5">
        {/* ── KPI strip ──────────────────────────────────────────────────────── */}
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
          {[
            { label:"Total Spaces",     value:totalSpaces,    icon:MapPin,    color:"text-blue-600",   bg:"bg-blue-50" },
            { label:"Available",        value:availableCount, icon:CheckCircle, color:"text-emerald-600", bg:"bg-emerald-50", click:()=>{setSpacesAvail("available");setActiveTab("spaces");} },
            { label:"Occupied",         value:occupiedCount,  icon:XCircle,   color:"text-red-500",    bg:"bg-red-50",     click:()=>{setSpacesAvail("occupied");setActiveTab("spaces");} },
            { label:"Vehicles",         value:vehicles.filter(v=>v.status==="active").length, icon:Car, color:"text-purple-600", bg:"bg-purple-50" },
            { label:"Active Assignments", value:activeAssigns, icon:Link2,   color:"text-amber-600",  bg:"bg-amber-50" },
          ].map(({ label, value, icon:Icon, color, bg, click }:any) => (
            <Card key={label} onClick={click} className={`rounded-xl border border-slate-100 shadow-sm ${click?"cursor-pointer hover:shadow-md transition-shadow":""}`}>
              <div className="p-4 flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${bg}`}><Icon className={`w-4 h-4 ${color}`} /></div>
                <div><p className="text-xl font-semibold">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div>
              </div>
            </Card>
          ))}
        </div>

        {/* ── Tabs ───────────────────────────────────────────────────────────── */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="spaces">Spaces ({filteredSpaces.length})</TabsTrigger>
            <TabsTrigger value="vehicles">
              Vehicles ({filteredVehicles.length})
              {pendingCount>0 && <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-500 text-white text-[9px] font-bold">{pendingCount}</span>}
            </TabsTrigger>
            <TabsTrigger value="assignments">Assignments ({filteredAssigns.length})</TabsTrigger>
          </TabsList>

          {/* ════════════════ SPACES TAB — cards grid ══════════════════════════ */}
          <TabsContent value="spaces" className="space-y-4 mt-4">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-2">
              <SearchBar value={spacesSearch} onChange={setSpacesSearch} placeholder="Space no., section, floor..." />
              <Select value={selectedProp} onValueChange={setSelectedProp}>
                <SelectTrigger className="w-44 h-9"><SelectValue placeholder="All Properties" /></SelectTrigger>
                <SelectContent><SelectItem value="all">All Properties</SelectItem>{properties.map((p:any)=><SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={spacesAvail} onValueChange={setSpacesAvail}>
                <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All spaces</SelectItem>
                  <SelectItem value="available">Available only</SelectItem>
                  <SelectItem value="occupied">Occupied only</SelectItem>
                </SelectContent>
              </Select>
              <Select value={spacesPS.toString()} onValueChange={v=>setSpacesPS(Number(v))}>
                <SelectTrigger className="w-28 h-9"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="6">6/page</SelectItem><SelectItem value="9">9/page</SelectItem><SelectItem value="12">12/page</SelectItem><SelectItem value="24">24/page</SelectItem></SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground ml-auto">{filteredSpaces.length} result{filteredSpaces.length!==1?"s":""}</span>
            </div>

            {/* Spaces keep the card grid — occupancy is visual and benefits from 2D layout */}
            {loadingSpaces ? (
              <div className="flex justify-center p-12"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>
            ) : spacesPag.paginated.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <MapPin className="h-12 w-12 text-muted-foreground/40 mb-3" />
                <p className="font-semibold text-foreground">No spaces found</p>
                <p className="text-sm text-muted-foreground mt-1">Try adjusting your filters or add a new space.</p>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {spacesPag.paginated.map(space => {
                  const occ = isOccupied(space.id);
                  const assignedVeh = occ ? vehicles.find(v=>assignments.find(a=>a.parkingSpaceId===space.id&&a.vehicleId===v.id&&a.status==="active")) : null;
                  return (
                    <div key={space.id} className={`relative rounded-xl border bg-card overflow-hidden transition-shadow hover:shadow-md ${occ?"border-red-200":"border-emerald-200"}`}>
                      {/* Left accent bar */}
                      <div className={`absolute left-0 top-0 bottom-0 w-1 ${occ?"bg-red-400":"bg-emerald-500"}`} />
                      <div className="pl-4 pr-4 py-4">
                        {/* Header row */}
                        <div className="flex items-start justify-between gap-2 mb-3">
                          <div>
                            <p className="text-base font-semibold leading-tight">Space {space.spaceNumber}</p>
                            {(space.floor||space.section) && (
                              <p className="text-xs text-muted-foreground mt-0.5">{[space.floor,space.section].filter(Boolean).join(" · ")}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${SPACE_TYPE_STYLES[space.spaceType] || SPACE_TYPE_STYLES.standard}`}>
                              {space.spaceType[0].toUpperCase()+space.spaceType.slice(1)}
                            </span>
                            {/* Actions dropdown */}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0"><MoreVertical className="w-4 h-4" /></Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-36">
                                <DropdownMenuItem onClick={()=>setEditingSpace(space)}><Pencil className="w-4 h-4 mr-2" />Edit</DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={()=>{if(confirm("Delete this space?"))deleteSpaceMut.mutate(space.id);}}><Trash2 className="w-4 h-4 mr-2" />Delete</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>

                        {/* Status + rate row */}
                        <div className="flex items-center gap-2 flex-wrap">
                          {occ ? (
                            <div className="flex flex-col gap-1">
                              <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">
                                <XCircle className="w-3 h-3" />Occupied{assignedVeh?` · ${assignedVeh.plateNumber}`:""}
                              </span>
                              {(() => {
                                const activeAssign = assignments.find(a => a.parkingSpaceId === space.id && a.status === "active");
                                const visitingTenant = activeAssign?.tenantFirstName
                                  ? `${activeAssign.tenantFirstName} ${activeAssign.tenantLastName ?? ""}`.trim()
                                  : tenants.find((t:any) => t.id === activeAssign?.tenantId)
                                    ? `${(tenants.find((t:any) => t.id === activeAssign?.tenantId) as any).firstName} ${(tenants.find((t:any) => t.id === activeAssign?.tenantId) as any).lastName}`
                                    : null;
                                const unitNo = activeAssign?.unitNumber || null;
                                return visitingTenant ? (
                                  <span className="inline-flex items-center gap-1 text-xs text-emerald-700 font-medium">
                                    <User className="w-3 h-3" />Visiting: {visitingTenant}{unitNo ? ` · Unit ${unitNo}` : ""}
                                  </span>
                                ) : null;
                              })()}
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <CheckCircle className="w-3 h-3" />Available
                            </span>
                          )}
                          {space.hasElectricCharging && (
                            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-700 border border-yellow-200">
                              <Zap className="w-3 h-3" />EV
                            </span>
                          )}
                          {space.monthlyRate != null && (
                            <span className="ml-auto text-xs font-semibold text-foreground">KSh {Number(space.monthlyRate).toLocaleString()}<span className="font-normal text-muted-foreground">/mo</span></span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Pagination outside the grid, full width */}
            {spacesPag.totalPages > 1 && (
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-muted-foreground">Page {spacesPag.page} of {spacesPag.totalPages}</span>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={spacesPag.page===1} onClick={()=>spacesPag.setPage(spacesPag.page-1)}>Previous</Button>
                  <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={spacesPag.page===spacesPag.totalPages} onClick={()=>spacesPag.setPage(spacesPag.page+1)}>Next</Button>
                </div>
              </div>
            )}
          </TabsContent>

          {/* ════════════════ VEHICLES TAB — table ═════════════════════════════ */}
          <TabsContent value="vehicles" className="space-y-4 mt-4">
            <div className="flex flex-wrap items-center gap-2">
              <SearchBar value={vehiclesSearch} onChange={setVehiclesSearch} placeholder="Plate, make, model, colour, type..." />
              <Select value={selectedProp} onValueChange={setSelectedProp}>
                <SelectTrigger className="w-44 h-9"><SelectValue placeholder="All Properties" /></SelectTrigger>
                <SelectContent><SelectItem value="all">All Properties</SelectItem>{properties.map((p:any)=><SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={vehiclesPS.toString()} onValueChange={v=>setVehiclesPS(Number(v))}>
                <SelectTrigger className="w-28 h-9"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="10">10/page</SelectItem><SelectItem value="15">15/page</SelectItem><SelectItem value="25">25/page</SelectItem><SelectItem value="50">50/page</SelectItem></SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground ml-auto">{filteredVehicles.length} result{filteredVehicles.length!==1?"s":""}</span>
            </div>

            {loadingVehicles ? (
              <div className="flex justify-center p-12"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>
            ) : vehiclesPag.paginated.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Car className="h-12 w-12 text-muted-foreground/40 mb-3" />
                <p className="font-semibold">No vehicles found</p>
                <p className="text-sm text-muted-foreground mt-1">Try adjusting your search.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                {/* Pending approval banner — shown above table when there are pending vehicles */}
                {filteredVehicles.some(v=>v.status==="pending_approval") && (
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border-b border-amber-100">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span className="text-sm text-amber-700 font-medium">{filteredVehicles.filter(v=>v.status==="pending_approval").length} vehicle{filteredVehicles.filter(v=>v.status==="pending_approval").length!==1?"s":""} awaiting approval</span>
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/60 border-b border-border">
                        <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Vehicle</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden md:table-cell">Type / Colour</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden lg:table-cell">Owner</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                        <th className="px-4 py-3 w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {vehiclesPag.paginated.map(v => (
                        <tr key={v.id} className="hover:bg-muted/30 transition-colors group">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                                <Car className="w-4 h-4 text-muted-foreground" />
                              </div>
                              <div>
                                <p className="font-semibold text-foreground">{v.plateNumber}</p>
                                <p className="text-xs text-muted-foreground">{[v.year,v.make,v.model].filter(Boolean).join(" ")}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 hidden md:table-cell">
                            <p className="capitalize text-foreground">{v.vehicleType}</p>
                            <p className="text-xs text-muted-foreground capitalize">{v.color}</p>
                          </td>
                          <td className="px-4 py-3 hidden lg:table-cell">
                            <span className="capitalize text-sm text-foreground">{v.ownerType}</span>
                            {v.isResident && <p className="text-xs text-muted-foreground">Resident</p>}
                          </td>
                          <td className="px-4 py-3">
                            {v.status === "pending_approval" ? (
                              /* Inline approve/reject — compact, doesn't overflow */
                              <div className="flex items-center gap-1.5">
                                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${VEHICLE_STATUS_STYLES.pending_approval}`}>Pending</span>
                                <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] border-emerald-300 text-emerald-700 hover:bg-emerald-50 shrink-0"
                                  disabled={vehicleStatusMut.isPending}
                                  onClick={()=>vehicleStatusMut.mutate({id:v.id,status:"active"})}>
                                  <CheckCircle className="w-3 h-3 mr-1" />Approve
                                </Button>
                                <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] border-red-300 text-red-700 hover:bg-red-50 shrink-0"
                                  disabled={vehicleStatusMut.isPending}
                                  onClick={()=>vehicleStatusMut.mutate({id:v.id,status:"inactive"})}>
                                  <XCircle className="w-3 h-3 mr-1" />Reject
                                </Button>
                              </div>
                            ) : (
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${VEHICLE_STATUS_STYLES[v.status] || VEHICLE_STATUS_STYLES.inactive}`}>
                                {v.status[0].toUpperCase()+v.status.slice(1)}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3" onClick={e=>e.stopPropagation()}>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100"><MoreVertical className="w-4 h-4" /></Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-40">
                                <DropdownMenuItem onClick={()=>setEditingVehicle(v)}><Pencil className="w-4 h-4 mr-2" />Edit</DropdownMenuItem>
                                {v.status==="active" && <DropdownMenuItem onClick={()=>vehicleStatusMut.mutate({id:v.id,status:"inactive"})}><Ban className="w-4 h-4 mr-2" />Deactivate</DropdownMenuItem>}
                                {v.status==="inactive" && <DropdownMenuItem onClick={()=>vehicleStatusMut.mutate({id:v.id,status:"active"})}><RotateCcw className="w-4 h-4 mr-2" />Reactivate</DropdownMenuItem>}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={()=>{if(confirm("Delete this vehicle?"))deleteVehicleMut.mutate(v.id);}}><Trash2 className="w-4 h-4 mr-2" />Delete</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <PaginationBar page={vehiclesPag.page} totalPages={vehiclesPag.totalPages} onPage={vehiclesPag.setPage} />
              </div>
            )}
          </TabsContent>

          {/* ════════════════ ASSIGNMENTS TAB — table ══════════════════════════ */}
          <TabsContent value="assignments" className="space-y-4 mt-4">
            <div className="flex flex-wrap items-center gap-2">
              <SearchBar value={assignSearch} onChange={setAssignSearch} placeholder="Space number or plate..." />
              <Select value={selectedProp} onValueChange={setSelectedProp}>
                <SelectTrigger className="w-44 h-9"><SelectValue placeholder="All Properties" /></SelectTrigger>
                <SelectContent><SelectItem value="all">All Properties</SelectItem>{properties.map((p:any)=><SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={assignPS.toString()} onValueChange={v=>setAssignPS(Number(v))}>
                <SelectTrigger className="w-28 h-9"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="10">10/page</SelectItem><SelectItem value="15">15/page</SelectItem><SelectItem value="25">25/page</SelectItem><SelectItem value="50">50/page</SelectItem></SelectContent>
              </Select>
              {/* New Assignment button sits in toolbar */}
              <Dialog open={isAddAssignOpen} onOpenChange={setIsAddAssignOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white ml-auto"><Plus className="h-4 w-4 mr-1.5" />New Assignment</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>New Assignment</DialogTitle><DialogDescription>Link a vehicle to an available space.</DialogDescription></DialogHeader>
                  <form onSubmit={e=>{e.preventDefault();const f=fd(e);createAssignMut.mutate({parkingSpaceId:parseInt(f.get("spaceId") as string),vehicleId:parseInt(f.get("vehicleId") as string),tenantId:f.get("tenantId")&&f.get("tenantId")!=="none"?parseInt(f.get("tenantId") as string):undefined,assignmentType:f.get("assignType"),startDate:f.get("startDate"),endDate:f.get("endDate")||undefined,monthlyFee:f.get("fee")?parseFloat(f.get("fee") as string):undefined,currency:"KES",status:"active",notes:f.get("notes")||undefined});}} className="space-y-4 pt-2">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5"><Label>Available Space *</Label>
                        <Select name="spaceId" required><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{spaces.filter(s=>!isOccupied(s.id)).map(s=><SelectItem key={s.id} value={s.id.toString()}>Space {s.spaceNumber}{s.floor?` – ${s.floor}`:""}</SelectItem>)}</SelectContent></Select>
                      </div>
                      <div className="space-y-1.5"><Label>Active Vehicle *</Label>
                        <Select name="vehicleId" required><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{vehicles.filter(v=>v.status==="active").map(v=><SelectItem key={v.id} value={v.id.toString()}>{v.plateNumber} – {v.make} {v.model}</SelectItem>)}</SelectContent></Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5"><Label>Type *</Label>
                        <Select name="assignType" defaultValue="permanent" required><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{assignTypeOptions.map(t=><SelectItem key={t} value={t}>{t[0].toUpperCase()+t.slice(1)}</SelectItem>)}</SelectContent></Select>
                      </div>
                      <div className="space-y-1.5"><Label>Tenant (optional)</Label>
                        <Select name="tenantId"><SelectTrigger><SelectValue placeholder="Select tenant" /></SelectTrigger><SelectContent><SelectItem value="none">None</SelectItem>{tenants.map((t:any)=><SelectItem key={t.id} value={t.id.toString()}>{t.firstName} {t.lastName}</SelectItem>)}</SelectContent></Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5"><Label>Start Date *</Label><Input type="date" name="startDate" required /></div>
                      <div className="space-y-1.5"><Label>End Date</Label><Input type="date" name="endDate" /></div>
                    </div>
                    <div className="space-y-1.5"><Label>Monthly Fee (KSh)</Label><Input type="number" name="fee" placeholder="0" /></div>
                    <div className="space-y-1.5"><Label>Notes</Label><Input name="notes" placeholder="Optional..." /></div>
                    <div className="flex gap-2 pt-1">
                      <Button type="submit" disabled={createAssignMut.isPending} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white">{createAssignMut.isPending?"Creating...":"Create Assignment"}</Button>
                      <Button type="button" variant="outline" onClick={()=>setIsAddAssignOpen(false)}>Cancel</Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
              <span className="text-sm text-muted-foreground">{filteredAssigns.length} result{filteredAssigns.length!==1?"s":""}</span>
            </div>

            {loadingAssigns ? (
              <div className="flex justify-center p-12"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>
            ) : assignsPag.paginated.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Settings className="h-12 w-12 text-muted-foreground/40 mb-3" />
                <p className="font-semibold">No assignments found</p>
                <p className="text-sm text-muted-foreground mt-1 mb-4">Link a vehicle to a space to get started.</p>
                <Button size="sm" onClick={()=>setIsAddAssignOpen(true)}><Plus className="h-4 w-4 mr-1.5" />New Assignment</Button>
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/60 border-b border-border">
                        <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Space</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Vehicle</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden md:table-cell">Type / Dates</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden lg:table-cell">Fee</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                        <th className="px-4 py-3 w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {assignsPag.paginated.map(a => {
                        const sp = spaces.find(s=>s.id===a.parkingSpaceId);
                        const ve = vehicles.find(v=>v.id===a.vehicleId);
                        const te = tenants.find((t:any)=>t.id===a.tenantId);
                        return (
                          <tr key={a.id} className="hover:bg-muted/30 transition-colors group">
                            <td className="px-4 py-3">
                              <p className="font-semibold">{sp?`Space ${sp.spaceNumber}`:`#${a.parkingSpaceId}`}</p>
                              {sp?.floor && <p className="text-xs text-muted-foreground">{sp.floor}</p>}
                            </td>
                            <td className="px-4 py-3">
                              <p className="font-semibold">{ve?.plateNumber??`Vehicle #${a.vehicleId}`}</p>
                              {ve && <p className="text-xs text-muted-foreground">{ve.make} {ve.model}</p>}
                              {a.visitorName && (
                                <p className="text-xs text-muted-foreground mt-0.5">Visitor: {a.visitorName}</p>
                              )}
                              {(a.tenantFirstName || te) && (
                                <p className="text-xs text-emerald-700 font-medium mt-0.5 flex items-center gap-1">
                                  <User className="w-3 h-3" />
                                  Visiting: {a.tenantFirstName ? `${a.tenantFirstName} ${a.tenantLastName ?? ""}`.trim() : `${te?.firstName} ${te?.lastName}`}
                                  {(a.unitNumber || (te as any)?.unitNumber) && (
                                    <span className="font-normal text-muted-foreground">· Unit {a.unitNumber || (te as any)?.unitNumber}</span>
                                  )}
                                </p>
                              )}
                              {a.visitorPurpose && (
                                <p className="text-xs text-muted-foreground italic">{a.visitorPurpose}</p>
                              )}
                            </td>
                            <td className="px-4 py-3 hidden md:table-cell">
                              <p className="capitalize text-foreground">{a.assignmentType}</p>
                              <p className="text-xs text-muted-foreground">{format(new Date(a.startDate),"MMM d, yyyy")}{a.endDate ? ` → ${format(new Date(a.endDate),"MMM d, yyyy")}` : ""}</p>
                            </td>
                            <td className="px-4 py-3 hidden lg:table-cell">
                              {a.monthlyFee!=null ? <span className="font-semibold">KSh {Number(a.monthlyFee).toLocaleString()}<span className="font-normal text-muted-foreground text-xs">/mo</span></span> : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${ASSIGN_STATUS_STYLES[a.status] || ASSIGN_STATUS_STYLES.expired}`}>
                                {a.status[0].toUpperCase()+a.status.slice(1)}
                              </span>
                            </td>
                            <td className="px-4 py-3" onClick={e=>e.stopPropagation()}>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100"><MoreVertical className="w-4 h-4" /></Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-40">
                                  <DropdownMenuItem onClick={()=>setEditingAssignment(a)}><Pencil className="w-4 h-4 mr-2" />Edit</DropdownMenuItem>
                                  {a.status==="active" && <>
                                    <DropdownMenuItem onClick={()=>assignStatusMut.mutate({id:a.id,status:"suspended"})}><Ban className="w-4 h-4 mr-2" />Suspend</DropdownMenuItem>
                                    <DropdownMenuItem className="text-red-600" onClick={()=>assignStatusMut.mutate({id:a.id,status:"terminated"})}><XCircle className="w-4 h-4 mr-2" />Terminate</DropdownMenuItem>
                                  </>}
                                  {a.status==="suspended" && <DropdownMenuItem onClick={()=>assignStatusMut.mutate({id:a.id,status:"active"})}><RotateCcw className="w-4 h-4 mr-2" />Reactivate</DropdownMenuItem>}
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={()=>{if(confirm("Delete this assignment?"))deleteAssignMut.mutate(a.id);}}><Trash2 className="w-4 h-4 mr-2" />Delete</DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <PaginationBar page={assignsPag.page} totalPages={assignsPag.totalPages} onPage={assignsPag.setPage} />
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Edit Space Dialog ────────────────────────────────────────────────── */}
      <Dialog open={!!editingSpace} onOpenChange={o=>!o&&setEditingSpace(null)}>
        <DialogContent><DialogHeader><DialogTitle>Edit Space</DialogTitle></DialogHeader>
          {editingSpace && (
            <form onSubmit={e=>{e.preventDefault();const f=fd(e);updateSpaceMut.mutate({id:editingSpace.id,data:{spaceNumber:f.get("sn"),floor:f.get("floor")||undefined,section:f.get("section")||undefined,spaceType:f.get("st"),monthlyRate:f.get("rate")?parseFloat(f.get("rate") as string):undefined,hasElectricCharging:f.get("ev")==="on",isAvailable:f.get("avail")==="true",currency:"KES"}});}} className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5"><Label>Space Number *</Label><Input name="sn" defaultValue={editingSpace.spaceNumber} required /></div>
                <div className="space-y-1.5"><Label>Type *</Label><Select name="st" defaultValue={editingSpace.spaceType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{spaceTypeOptions.map(t=><SelectItem key={t} value={t}>{t[0].toUpperCase()+t.slice(1)}</SelectItem>)}</SelectContent></Select></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5"><Label>Floor</Label><Input name="floor" defaultValue={editingSpace.floor||""} /></div>
                <div className="space-y-1.5"><Label>Section</Label><Input name="section" defaultValue={editingSpace.section||""} /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5"><Label>Monthly Rate (KSh)</Label><Input type="number" name="rate" defaultValue={editingSpace.monthlyRate||""} /></div>
                <div className="space-y-1.5"><Label>Status</Label><Select name="avail" defaultValue={editingSpace.isAvailable?"true":"false"}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="true">Available</SelectItem><SelectItem value="false">Occupied</SelectItem></SelectContent></Select></div>
              </div>
              <div className="flex items-center gap-2"><input type="checkbox" id="eev" name="ev" defaultChecked={editingSpace.hasElectricCharging} /><Label htmlFor="eev">EV Charging</Label></div>
              <div className="flex gap-2 pt-1"><Button type="submit" disabled={updateSpaceMut.isPending} className="flex-1">{updateSpaceMut.isPending?"Saving...":"Save"}</Button><Button type="button" variant="outline" onClick={()=>setEditingSpace(null)}>Cancel</Button></div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Edit Vehicle Dialog ──────────────────────────────────────────────── */}
      <Dialog open={!!editingVehicle} onOpenChange={o=>!o&&setEditingVehicle(null)}>
        <DialogContent><DialogHeader><DialogTitle>Edit Vehicle</DialogTitle></DialogHeader>
          {editingVehicle && (
            <form onSubmit={e=>{e.preventDefault();const f=fd(e);updateVehicleMut.mutate({id:editingVehicle.id,data:{plateNumber:f.get("plate"),ownerType:f.get("ot"),vehicleType:f.get("vt"),make:f.get("make"),model:f.get("model"),year:f.get("year")?parseInt(f.get("year") as string):undefined,color:f.get("color"),isResident:f.get("ot")==="tenant"}});}} className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5"><Label>Plate Number *</Label><Input name="plate" defaultValue={editingVehicle.plateNumber} required /></div>
                <div className="space-y-1.5"><Label>Owner Type *</Label><Select name="ot" defaultValue={editingVehicle.ownerType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{vehicleOwnerOptions.map(t=><SelectItem key={t} value={t}>{t[0].toUpperCase()+t.slice(1)}</SelectItem>)}</SelectContent></Select></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5"><Label>Vehicle Type *</Label><Input name="vt" defaultValue={editingVehicle.vehicleType} required /></div>
                <div className="space-y-1.5"><Label>Colour *</Label><Input name="color" defaultValue={editingVehicle.color} required /></div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1.5"><Label>Make *</Label><Input name="make" defaultValue={editingVehicle.make} required /></div>
                <div className="space-y-1.5"><Label>Model *</Label><Input name="model" defaultValue={editingVehicle.model} required /></div>
                <div className="space-y-1.5"><Label>Year</Label><Input type="number" name="year" defaultValue={editingVehicle.year||""} min="1900" max="2030" /></div>
              </div>
              <div className="flex gap-2 pt-1"><Button type="submit" disabled={updateVehicleMut.isPending} className="flex-1">{updateVehicleMut.isPending?"Saving...":"Save"}</Button><Button type="button" variant="outline" onClick={()=>setEditingVehicle(null)}>Cancel</Button></div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Edit Assignment Dialog ───────────────────────────────────────────── */}
      <Dialog open={!!editingAssignment} onOpenChange={o=>!o&&setEditingAssignment(null)}>
        <DialogContent><DialogHeader><DialogTitle>Edit Assignment</DialogTitle></DialogHeader>
          {editingAssignment && (() => {
            const sp=spaces.find(s=>s.id===editingAssignment.parkingSpaceId);
            const ve=vehicles.find(v=>v.id===editingAssignment.vehicleId);
            return (
              <form onSubmit={e=>{e.preventDefault();const f=fd(e);updateAssignMut.mutate({id:editingAssignment.id,data:{assignmentType:f.get("at"),startDate:f.get("sd"),endDate:f.get("ed")||undefined,monthlyFee:f.get("fee")?parseFloat(f.get("fee") as string):undefined,notes:f.get("notes")||undefined,currency:"KES"}});}} className="space-y-4 pt-2">
                <div className="p-3 rounded-lg bg-muted text-sm space-y-0.5">
                  <p><span className="font-medium">Space:</span> {sp?`Space ${sp.spaceNumber}`:`#${editingAssignment.parkingSpaceId}`}</p>
                  <p><span className="font-medium">Vehicle:</span> {ve?`${ve.plateNumber} – ${ve.make} ${ve.model}`:`#${editingAssignment.vehicleId}`}</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label>Type *</Label><Select name="at" defaultValue={editingAssignment.assignmentType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{assignTypeOptions.map(t=><SelectItem key={t} value={t}>{t[0].toUpperCase()+t.slice(1)}</SelectItem>)}</SelectContent></Select></div>
                  <div className="space-y-1.5"><Label>Monthly Fee (KSh)</Label><Input type="number" name="fee" defaultValue={editingAssignment.monthlyFee||""} /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label>Start *</Label><Input type="date" name="sd" defaultValue={editingAssignment.startDate?.split("T")[0]} required /></div>
                  <div className="space-y-1.5"><Label>End</Label><Input type="date" name="ed" defaultValue={editingAssignment.endDate?.split("T")[0]||""} /></div>
                </div>
                <div className="space-y-1.5"><Label>Notes</Label><Input name="notes" defaultValue={editingAssignment.notes||""} /></div>
                <div className="flex gap-2 pt-1"><Button type="submit" disabled={updateAssignMut.isPending} className="flex-1">{updateAssignMut.isPending?"Saving...":"Save"}</Button><Button type="button" variant="outline" onClick={()=>setEditingAssignment(null)}>Cancel</Button></div>
              </form>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}