import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { announceInvite } from "@/lib/invite-notice";
import { Loader2, UserPlus, UserX, Wrench } from "lucide-react";

/** apiRequest throws on a non-2xx response with the raw response TEXT as e.message. */
function errMsg(e: any): string {
  try { const j = JSON.parse(e?.message); if (j?.message) return String(j.message); } catch { /* not JSON */ }
  return e?.message || "Something went wrong";
}

export type AssignableStaff = {
  id: number;
  firstName: string;
  lastName: string;
  position: string;
  department: string;
  isMaintenance: boolean;
  addedByLandlord: boolean;
  mine: boolean;
  phone: string | null;
};

const label = (p: string) => p.replace(/_/g, " ");
const fullName = (s: Pick<AssignableStaff, "firstName" | "lastName">) => `${s.firstName} ${s.lastName}`.trim();

/**
 * Everyone work can be handed to. Replaces the old per-page lists that only showed staff in the
 * "maintenance" department (or a fixed set of positions) and could not be read by landlords at all.
 */
export function useAssignableStaff() {
  return useQuery<AssignableStaff[]>({
    queryKey: ["/api/assignable-staff"],
    queryFn: async () => {
      const r = await apiRequest("/api/assignable-staff");
      const d = await r.json();
      return Array.isArray(d) ? d : [];
    },
    retry: false,
    staleTime: 30_000,
  });
}

const NONE = "__none__";

/** Technician drop-down: maintenance people first, then everyone else; "Unassigned" clears it. */
export function TechnicianSelect({
  value, onChange, disabled, placeholder = "Assign to…", className,
}: {
  value: number | null | undefined;
  onChange: (id: number | null) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const { data: staff = [], isLoading } = useAssignableStaff();
  const maintenance = staff.filter((s) => s.isMaintenance);
  const others = staff.filter((s) => !s.isMaintenance);
  const item = (s: AssignableStaff) => (
    <SelectItem key={s.id} value={String(s.id)}>
      {fullName(s)} <span className="text-muted-foreground capitalize">· {label(s.position)}</span>
    </SelectItem>
  );

  return (
    <Select
      value={value ? String(value) : ""}
      onValueChange={(v) => onChange(v === NONE ? null : Number(v))}
      disabled={disabled || isLoading}
    >
      <SelectTrigger className={className}>
        <SelectValue placeholder={isLoading ? "Loading…" : placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-[320px]">
        {staff.length === 0 && (
          <div className="px-3 py-2 text-xs text-muted-foreground">No staff added yet — add a technician below.</div>
        )}
        {value ? <SelectItem value={NONE}><span className="text-red-600">Unassign</span></SelectItem> : null}
        {maintenance.length > 0 && (
          <SelectGroup>
            <SelectLabel>Maintenance team</SelectLabel>
            {maintenance.map(item)}
          </SelectGroup>
        )}
        {others.length > 0 && (
          <SelectGroup>
            <SelectLabel>Other staff</SelectLabel>
            {others.map(item)}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}

/** Assign (or unassign) a technician on one maintenance request — one endpoint for every screen. */
export function useAssignTechnician(onDone?: () => void) {
  const { toast } = useToast();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ requestId, technicianId }: { requestId: number; technicianId: number | null }) => {
      const r = await apiRequest(`/api/maintenance-requests/${requestId}/assign-technician`, {
        method: "PATCH",
        data: { technicianId },
      });
      return r.json();
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["/api/maintenance-requests"] });
      qc.invalidateQueries({ queryKey: [`/api/maintenance-requests/${v.requestId}`] });
      toast({ title: v.technicianId ? "Technician assigned" : "Technician removed" });
      onDone?.();
    },
    onError: (e: any) => toast({ title: "Couldn't assign", description: errMsg(e), variant: "destructive" }),
  });
}

const POSITIONS: { value: string; label: string }[] = [
  { value: "technician", label: "Technician / fundi" },
  { value: "maintenance_supervisor", label: "Maintenance supervisor" },
  { value: "groundskeeper", label: "Groundskeeper" },
  { value: "janitor", label: "Cleaner / janitor" },
  { value: "security_guard", label: "Security guard" },
  { value: "administrative_assistant", label: "Administrative assistant" },
  { value: "accountant", label: "Accountant" },
  { value: "other", label: "Other" },
];

/**
 * Add a technician or team member. A landlord's people can be assigned work straight away and, if
 * given an email + a property, also get a property-scoped portal login (see routes/assignable-staff.ts).
 */
export function AddTeamMemberDialog({
  open, onOpenChange, onCreated,
}: { open: boolean; onOpenChange: (o: boolean) => void; onCreated?: (id: number) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth() as any;
  const isLandlord = user?.role === "landlord";
  const [position, setPosition] = useState("technician");
  const [propertyId, setPropertyId] = useState("");
  const [email, setEmail] = useState("");
  const [giveAccess, setGiveAccess] = useState(false);

  const { data: props = [] } = useQuery<any[]>({
    queryKey: ["/api/properties", "for-team-member"],
    enabled: open,
    queryFn: async () => {
      const r = await apiRequest("/api/properties");
      const d = await r.json();
      return Array.isArray(d) ? d : (d?.results ?? []);
    },
  });

  const reset = () => { setPosition("technician"); setPropertyId(""); setEmail(""); setGiveAccess(false); };

  const add = useMutation({
    mutationFn: async (data: Record<string, unknown>) => (await apiRequest("/api/assignable-staff", { method: "POST", data })).json(),
    onSuccess: (r: any, vars: any) => {
      qc.invalidateQueries({ queryKey: ["/api/assignable-staff"] });
      qc.invalidateQueries({ queryKey: ["/api/staff-members"] });
      onOpenChange(false);
      reset();
      toast({ title: `${r.firstName} ${r.lastName} added`, description: "You can assign work to them now." });
      if (r.invite) announceInvite(r.invite, vars.email, `${r.firstName} ${r.lastName}`);
      onCreated?.(r.id);
    },
    onError: (e: any) => toast({ title: "Couldn't add them", description: errMsg(e), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Wrench className="h-4 w-4" /> Add a technician or team member</DialogTitle>
          <DialogDescription>
            They appear in the "assign to" lists straight away. Give them portal access if they should see and update their work themselves.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            add.mutate({
              firstName: String(f.get("firstName") ?? "").trim(),
              lastName: String(f.get("lastName") ?? "").trim(),
              phone: String(f.get("phone") ?? "").trim(),
              email: email.trim(),
              position,
              propertyId: propertyId ? Number(propertyId) : undefined,
              giveAccess: giveAccess && !!email.trim(),
            });
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="tm-first">First name</Label><Input id="tm-first" name="firstName" required /></div>
            <div className="space-y-1.5"><Label htmlFor="tm-last">Last name</Label><Input id="tm-last" name="lastName" required /></div>
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={position} onValueChange={setPosition}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{POSITIONS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="tm-phone">Phone / WhatsApp</Label><Input id="tm-phone" name="phone" inputMode="tel" placeholder="07…" /></div>
            <div className="space-y-1.5"><Label htmlFor="tm-email">Email <span className="text-muted-foreground font-normal">(optional)</span></Label><Input id="tm-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          </div>
          <label className={`flex items-start gap-2 text-sm ${email.trim() ? "" : "opacity-50"}`}>
            <input type="checkbox" className="mt-1" checked={giveAccess && !!email.trim()} disabled={!email.trim()} onChange={(e) => setGiveAccess(e.target.checked)} />
            <span>
              Give portal access
              <span className="block text-xs text-muted-foreground">
                {isLandlord
                  ? "They get a login limited to the property you choose below."
                  : "They get a staff login with an invitation link."}
              </span>
            </span>
          </label>
          {(giveAccess || isLandlord) && (
            <div className="space-y-1.5">
              <Label>{giveAccess && isLandlord ? "Works at property" : "Works at property (optional)"}</Label>
              <Select value={propertyId} onValueChange={setPropertyId}>
                <SelectTrigger><SelectValue placeholder="Choose a property" /></SelectTrigger>
                <SelectContent>
                  {props.map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={add.isPending}>
              {add.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Assign technician" dialog for one request (list pages, mobile cards). */
export function AssignTechnicianDialog({
  request, onOpenChange,
}: { request: { id: number; title?: string; technicianId?: number | null } | null; onOpenChange: (o: boolean) => void }) {
  const [addOpen, setAddOpen] = useState(false);
  const assign = useAssignTechnician(() => onOpenChange(false));
  const { user } = useAuth() as any;
  const canAdd = ["landlord", "admin", "manager"].includes(user?.role);

  return (
    <>
      <Dialog open={!!request} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Assign technician</DialogTitle>
            <DialogDescription className="line-clamp-2">{request?.title}</DialogDescription>
          </DialogHeader>
          <TechnicianSelect
            value={request?.technicianId ?? null}
            disabled={assign.isPending}
            onChange={(id) => request && assign.mutate({ requestId: request.id, technicianId: id })}
            placeholder="Choose who will do the work"
            className="w-full"
          />
          {canAdd && (
            <Button variant="ghost" size="sm" className="justify-start gap-1.5 text-xs -ml-2" onClick={() => setAddOpen(true)}>
              <UserPlus className="h-3.5 w-3.5" /> Add a technician
            </Button>
          )}
          {request?.technicianId ? (
            <p className="text-[11px] text-muted-foreground flex items-center gap-1"><UserX className="h-3 w-3" /> Pick "Unassign" in the list to take them off.</p>
          ) : null}
        </DialogContent>
      </Dialog>
      <AddTeamMemberDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={(id) => request && assign.mutate({ requestId: request.id, technicianId: id })}
      />
    </>
  );
}
