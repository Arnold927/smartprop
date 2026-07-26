/**
 * client/src/pages/caretakers.tsx
 *
 * Admin/manager-facing caretaker management: list, add, edit, reassign to
 * a different property, and deactivate. Uses the combined invite+create
 * flow on the backend (POST /api/caretakers) — filling out this one form
 * creates both the login account and the caretaker record together.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useRoleGuard, ROLES } from "@/hooks/useRoleGuard";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserPlus, Shield, MoreVertical, Home, Phone } from "lucide-react";

interface CaretakerRow {
  id: number;
  userId: string;
  propertyId: number | null;
  caretakerType: string;
  shift: string | null;
  status: string;
  contactNumber: string | null;
  accommodationProvided: boolean;
  userName: string;
  userEmail: string | null;
  propertyName: string;
}

interface PropertyOption {
  id: number;
  name: string;
}

const CARETAKER_TYPES = [
  { value: "resident", label: "Resident (lives on-site)" },
  { value: "visiting", label: "Visiting (comes in for shifts)" },
  { value: "security", label: "Security-focused" },
];

export default function CaretakersPage() {
  const guard = useRoleGuard(ROLES.ADMIN_MANAGER_LANDLORD);
  if (guard.gate) return guard.gate;

  const { toast } = useToast();
  const { user } = useAuth();
  const isLandlord = user?.role === "landlord";
  const queryClient = useQueryClient();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editing, setEditing] = useState<CaretakerRow | null>(null);

  const { data: caretakers = [], isLoading } = useQuery<CaretakerRow[]>({
    queryKey: ["/api/caretakers"],
    queryFn: async () => {
      const r = await apiRequest("/api/caretakers");
      return r.json();
    },
  });

  const { data: properties = [] } = useQuery<PropertyOption[]>({
    queryKey: ["/api/properties"],
    queryFn: async () => {
      const r = await apiRequest("/api/properties");
      const body = await r.json();
      return (Array.isArray(body) ? body : body.results ?? []).map((p: any) => ({ id: p.id, name: p.name }));
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("/api/caretakers", { method: "POST", data }),
    onSuccess: async (r) => {
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.message || "Failed to add caretaker");
      }
      toast({ title: "Caretaker added", description: "An invite email has been sent to set up their account." });
      queryClient.invalidateQueries({ queryKey: ["/api/caretakers"] });
      setIsAddOpen(false);
    },
    onError: (e: any) => toast({ title: "Failed to add caretaker", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      apiRequest(`/api/caretakers/${id}`, { method: "PATCH", data }),
    onSuccess: () => {
      toast({ title: "Caretaker updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/caretakers"] });
      setEditing(null);
    },
    onError: (e: any) => toast({ title: "Failed to update", description: e.message, variant: "destructive" }),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/caretakers/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Caretaker deactivated" });
      queryClient.invalidateQueries({ queryKey: ["/api/caretakers"] });
    },
    onError: (e: any) => toast({ title: "Failed to deactivate", description: e.message, variant: "destructive" }),
  });

  const handleAdd = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const propertyId = fd.get("propertyId") ? Number(fd.get("propertyId")) : undefined;

    if (isLandlord && !propertyId) {
      toast({ title: "Select a property", description: "Choose one of your properties to assign this caretaker to.", variant: "destructive" });
      return;
    }

    createMutation.mutate({
      firstName: fd.get("firstName"),
      lastName: fd.get("lastName"),
      email: fd.get("email"),
      propertyId,
      caretakerType: fd.get("caretakerType"),
      shift: fd.get("shift") || undefined,
      contactNumber: fd.get("contactNumber") || undefined,
      accommodationProvided: fd.get("accommodationProvided") === "on",
    });
  };

  const handleUpdate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing) return;
    const fd = new FormData(e.currentTarget);
    updateMutation.mutate({
      id: editing.id,
      data: {
        propertyId: fd.get("propertyId") ? Number(fd.get("propertyId")) : null,
        shift: fd.get("shift") || null,
        contactNumber: fd.get("contactNumber") || null,
        accommodationProvided: fd.get("accommodationProvided") === "on",
      },
    });
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 md:py-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-emerald-500/10 p-2.5">
            <Shield className="h-5 w-5 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Caretakers</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              On-site property caretakers — their maintenance and visitor access is scoped to their assigned property.
            </p>
          </div>
        </div>
        <Button onClick={() => setIsAddOpen(true)} className="gap-2">
          <UserPlus className="h-4 w-4" /> Add Caretaker
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />)}
        </div>
      ) : caretakers.length === 0 ? (
        <Card>
          <CardContent className="text-center py-16">
            <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-20" />
            <h3 className="text-lg font-semibold">No caretakers yet</h3>
            <p className="text-muted-foreground mt-2">Add one to get started — they'll be invited to the portal automatically.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {caretakers.map(c => (
            <Card key={c.id}>
              <CardContent className="py-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">{c.userName}</p>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 capitalize">{c.caretakerType}</Badge>
                    <Badge
                      variant="outline"
                      className={`text-[10px] px-1.5 py-0 capitalize ${c.status === "active" ? "text-emerald-700 border-emerald-200" : "text-muted-foreground"}`}
                    >
                      {c.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{c.userEmail}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Home className="h-3 w-3" /> {c.propertyName}</span>
                    {c.shift && <span className="capitalize">{c.shift} shift</span>}
                    {c.contactNumber && <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {c.contactNumber}</span>}
                  </div>
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm"><MoreVertical className="h-4 w-4" /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setEditing(c)}>Edit / Reassign</DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-red-600"
                      onClick={() => deactivateMutation.mutate(c.id)}
                    >
                      Deactivate
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Add Caretaker dialog ── */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add a Caretaker</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="firstName">First Name</Label>
                <Input id="firstName" name="firstName" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lastName">Last Name</Label>
                <Input id="lastName" name="lastName" required />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required />
              <p className="text-xs text-muted-foreground">They'll get an invite email to set up their own password.</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="propertyId">Property{isLandlord && " *"}</Label>
                <Select name="propertyId" required={isLandlord}>
                  <SelectTrigger id="propertyId"><SelectValue placeholder={isLandlord ? "Select one of your properties" : "Assign later"} /></SelectTrigger>
                  <SelectContent>
                    {properties.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="caretakerType">Type</Label>
                <Select name="caretakerType" required defaultValue="resident">
                  <SelectTrigger id="caretakerType"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CARETAKER_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="shift">Shift</Label>
                <Input id="shift" name="shift" placeholder="e.g. day, night, rotating" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contactNumber">Contact Number</Label>
                <Input id="contactNumber" name="contactNumber" placeholder="07xx xxx xxx" />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="accommodationProvided" className="rounded border-border" />
              Accommodation provided on-site
            </label>
            <DialogFooter>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Adding..." : "Add Caretaker"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Edit / Reassign dialog ── */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit {editing?.userName}</DialogTitle>
          </DialogHeader>
          {editing && (
            <form onSubmit={handleUpdate} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="edit-propertyId">Property</Label>
                <Select name="propertyId" defaultValue={editing.propertyId ? String(editing.propertyId) : undefined}>
                  <SelectTrigger id="edit-propertyId"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                  <SelectContent>
                    {properties.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-shift">Shift</Label>
                  <Input id="edit-shift" name="shift" defaultValue={editing.shift ?? ""} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-contactNumber">Contact Number</Label>
                  <Input id="edit-contactNumber" name="contactNumber" defaultValue={editing.contactNumber ?? ""} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="accommodationProvided" defaultChecked={editing.accommodationProvided} className="rounded border-border" />
                Accommodation provided on-site
              </label>
              <DialogFooter>
                <Button type="submit" disabled={updateMutation.isPending}>
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