/**
 * client/src/pages/external-landlords.tsx
 *
 * Manages landlords who have no user account in the system — genuinely
 * common, not an edge case. Reachable by admin, manager, and platform_admin.
 *
 * Flow: list existing external landlords → "Add External Landlord" for a
 * new one (name/phone/email/notes only) → select one to configure their
 * payment details and (admin/platform_admin only) Daraja credentials via
 * the same PaymentConfigPanel used everywhere else in this app.
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoleGuard, ROLES } from "@/hooks/useRoleGuard";
import { apiRequest } from "@/lib/queryClient";
import { getOrgIdFromSearch, withOrgParam } from "@/lib/platformOrgContext";
import PaymentConfigPanel from "@/components/payment-config-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { UserPlus, Phone, Mail, Home, Trash2, ArrowLeft, Building2, Loader2 } from "lucide-react";

interface ExternalLandlordRow {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  propertyCount: number;
  mpesaCredentials: { configured: boolean; verified: boolean };
}

export default function ExternalLandlordsPage() {
  const guard = useRoleGuard([...ROLES.ADMIN_MANAGER, "platform_admin"]);
  if (guard.gate) return guard.gate;

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [location] = useLocation();
  const orgIdParam = getOrgIdFromSearch(location.includes("?") ? location.slice(location.indexOf("?")) : window.location.search);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ExternalLandlordRow | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "", notes: "" });

  const listEndpoint = withOrgParam("/api/external-landlords", orgIdParam);
  const { data: landlords = [], isLoading } = useQuery<ExternalLandlordRow[]>({
    queryKey: [listEndpoint],
    queryFn: async () => {
      const r = await apiRequest(listEndpoint);
      return r.json();
    },
  });

  const selected = landlords.find(l => l.id === selectedId) ?? null;

  const create = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Name is required");
      const r = await apiRequest(withOrgParam("/api/external-landlords", orgIdParam), { method: "POST", data: form });
      if (!r.ok) throw new Error((await r.json()).message ?? "Failed to create");
      return r.json();
    },
    onSuccess: (created) => {
      toast({ title: "External landlord added", description: `${created.name} can now be assigned to properties and have payment details configured.` });
      setIsAddOpen(false);
      setForm({ name: "", phone: "", email: "", notes: "" });
      queryClient.invalidateQueries({ queryKey: [listEndpoint] });
      setSelectedId(created.id);
    },
    onError: (e: any) => toast({ title: "Failed to add", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => {
      const r = await apiRequest(withOrgParam(`/api/external-landlords/${id}`, orgIdParam), { method: "DELETE" });
      if (!r.ok && r.status !== 204) throw new Error((await r.json()).message ?? "Failed to delete");
    },
    onSuccess: () => {
      toast({ title: "External landlord removed" });
      setDeleteTarget(null);
      if (selectedId === deleteTarget?.id) setSelectedId(null);
      queryClient.invalidateQueries({ queryKey: [listEndpoint] });
    },
    onError: (e: any) => toast({ title: "Couldn't remove", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 md:py-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-indigo-500/10 p-2.5">
            <Building2 className="h-5 w-5 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">External Landlords</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Landlords with no login of their own — assign them to properties and set up their payment details here.
            </p>
          </div>
        </div>
        {!selected && (
          <Button onClick={() => setIsAddOpen(true)} className="gap-2">
            <UserPlus className="h-4 w-4" /> Add External Landlord
          </Button>
        )}
      </div>

      {selected ? (
        <div className="space-y-4">
          <Button variant="ghost" size="sm" className="gap-1.5 -ml-2" onClick={() => setSelectedId(null)}>
            <ArrowLeft className="h-4 w-4" /> Back to list
          </Button>
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-base font-semibold">{selected.name}</h2>
            {selected.phone && <span className="text-sm text-muted-foreground flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> {selected.phone}</span>}
            {selected.email && <span className="text-sm text-muted-foreground flex items-center gap-1"><Mail className="h-3.5 w-3.5" /> {selected.email}</span>}
          </div>
          <PaymentConfigPanel scope="external" externalLandlordId={selected.id} organizationId={orgIdParam} />
        </div>
      ) : isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : landlords.length === 0 ? (
        <div className="text-center py-16 text-sm text-muted-foreground border border-dashed rounded-xl">
          No external landlords yet. Add one to assign them to a property and set up how their tenants should pay.
        </div>
      ) : (
        <div className="space-y-2.5">
          {landlords.map(l => (
            <div
              key={l.id}
              className="flex items-center justify-between gap-4 p-4 rounded-xl border border-border hover:border-indigo-200 cursor-pointer transition-colors"
              onClick={() => setSelectedId(l.id)}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{l.name}</span>
                  {l.mpesaCredentials.configured && (
                    <Badge variant="outline" className={l.mpesaCredentials.verified ? "text-green-700 border-green-200 bg-green-50" : "text-amber-700 border-amber-200 bg-amber-50"}>
                      {l.mpesaCredentials.verified ? "STK Push verified" : "STK Push not verified"}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
                  {l.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {l.phone}</span>}
                  {l.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> {l.email}</span>}
                  <span className="flex items-center gap-1"><Home className="h-3 w-3" /> {l.propertyCount} propert{l.propertyCount === 1 ? "y" : "ies"}</span>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-red-600 shrink-0"
                onClick={(e) => { e.stopPropagation(); setDeleteTarget(l); }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Add dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add External Landlord</DialogTitle>
            <DialogDescription>
              For a landlord who won't have a login of their own. You can assign them to properties and set up their payment details right after.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Name *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Jane Wanjiru" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Phone</Label>
                <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="07XXXXXXXX" />
              </div>
              <div>
                <Label className="text-xs">Email</Label>
                <Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="jane@example.com" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Notes</Label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional — anything worth remembering about this landlord" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending || !form.name.trim()}>
              {create.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Add Landlord
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && deleteTarget.propertyCount > 0
                ? `This landlord still has ${deleteTarget.propertyCount} propert${deleteTarget.propertyCount === 1 ? "y" : "ies"} assigned — reassign those first, then remove them.`
                : "This can't be undone. Their saved payment details and credentials will be deleted."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={!!deleteTarget && deleteTarget.propertyCount > 0}
              onClick={() => deleteTarget && remove.mutate(deleteTarget.id)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}