import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { announceInvite } from "@/lib/invite-notice";
import { InviteLinkDialog } from "@/components/invite-link-dialog";
import { Loader2 } from "lucide-react";
import { limitSummary, usePlatformPlans } from "@/lib/plans";

/** apiRequest throws on a non-2xx response with the raw response TEXT as e.message. */
function errMsg(e: any): string {
  try { const j = JSON.parse(e?.message); if (j?.message) return String(j.message); } catch { /* not JSON */ }
  return e?.message || "Something went wrong";
}


/**
 * Platform admin → "Add organisation": a landlord who runs their own properties (the common
 * case this exists for) or a property-management company. Creates the organisation and invites
 * its first person as the organisation's admin; the set-password link is emailed and can
 * always be copied / sent on WhatsApp.
 */
export function AddOrganisationDialog({
  open, onOpenChange, organisations = [],
}: { open: boolean; onOpenChange: (o: boolean) => void; organisations?: { id: number; name: string }[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [accountType, setAccountType] = useState<"landlord" | "property_manager">("landlord");
  const [plan, setPlan] = useState("");
  const { data: planData } = usePlatformPlans();
  const availablePlans = (planData?.plans ?? []).filter((p) => p.isActive);
  const chosenPlan = plan || availablePlans[0]?.id || "starter";
  /** "own": a workspace of their own. "under": they work under an existing property-management organisation. */
  const [placement, setPlacement] = useState<"own" | "under">("own");
  const [parentId, setParentId] = useState("");
  const [created, setCreated] = useState<{ link: string; email: string; emailSent: boolean; name: string } | null>(null);

  const reset = () => { setAccountType("landlord"); setPlan(""); setPlacement("own"); setParentId(""); };

  const create = useMutation({
    mutationFn: async (data: Record<string, any>) => (await apiRequest("/api/platform/organizations", { method: "POST", data })).json(),
    onSuccess: (r: any, vars) => {
      qc.invalidateQueries({ queryKey: ["/api/platform/organizations"] });
      onOpenChange(false);
      reset();
      if (r?.invite?.emailSent) {
        toast({ title: vars.linkToOrganizationId ? "Landlord added" : "Organisation created", description: `An invitation was emailed to ${vars.email}.` });
      } else if (r?.invite?.link) {
        toast({ title: vars.linkToOrganizationId ? "Landlord added" : "Organisation created", description: "The email could not be sent — share the link instead." });
        setCreated({ link: r.invite.link, email: vars.email, emailSent: false, name: vars.firstName ? `${vars.firstName} ${vars.lastName}`.trim() : (r.organization?.name ?? "") });
      } else {
        toast({ title: "Organisation created" });
      }
    },
    onError: (e: any) => toast({ title: "Couldn't create the organisation", description: errMsg(e), variant: "destructive" }),
  });

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add a landlord or organisation</DialogTitle>
            <DialogDescription>
              They get their own private workspace and an invitation link to set their password. They can then add
              properties, tenants, caretakers, staff and contractors themselves.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              if (accountType === "landlord" && placement === "under" && !parentId) {
                toast({ title: "Choose the property manager they will work under", variant: "destructive" });
                return;
              }
              create.mutate({
                organizationName: String(f.get("organizationName") ?? "").trim(),
                accountType,
                ...(accountType === "landlord" && placement === "under" ? { linkToOrganizationId: Number(parentId) } : {}),
                email: String(f.get("email") ?? "").trim(),
                firstName: String(f.get("firstName") ?? "").trim(),
                lastName: String(f.get("lastName") ?? "").trim(),
                plan: chosenPlan,
              });
            }}
          >
            <div className="space-y-1.5">
              <Label>This is a</Label>
              <Select value={accountType} onValueChange={(v) => setAccountType(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="landlord">Landlord managing their own properties</SelectItem>
                  <SelectItem value="property_manager">Property management company</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {accountType === "landlord" && organisations.length > 0 && (
              <div className="space-y-1.5">
                <Label>Who manages their properties?</Label>
                <Select value={placement} onValueChange={(v) => setPlacement(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="own">Nobody — they run their own workspace</SelectItem>
                    <SelectItem value="under">A property management company</SelectItem>
                  </SelectContent>
                </Select>
                {placement === "under" && (
                  <Select value={parentId} onValueChange={setParentId}>
                    <SelectTrigger><SelectValue placeholder="Choose the property manager" /></SelectTrigger>
                    <SelectContent>
                      {organisations.map((o) => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                {placement === "under" && (
                  <p className="text-[11px] text-muted-foreground">They join that company's organisation as a landlord; the company then links their properties.</p>
                )}
              </div>
            )}
            {!(accountType === "landlord" && placement === "under") && (
              <div className="space-y-1.5">
                <Label htmlFor="po-name">{accountType === "landlord" ? "Landlord / business name" : "Company name"}</Label>
                <Input id="po-name" name="organizationName" required minLength={2} placeholder={accountType === "landlord" ? "e.g. Wanjiku Properties" : "e.g. Acme Property Managers"} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="po-first">First name <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input id="po-first" name="firstName" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="po-last">Last name <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input id="po-last" name="lastName" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="po-email">Email address</Label>
              <Input id="po-email" name="email" type="email" required placeholder="name@example.com" />
            </div>
            {!(accountType === "landlord" && placement === "under") && (
            <div className="space-y-1.5">
              <Label>Plan</Label>
              <Select value={chosenPlan} onValueChange={setPlan}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {availablePlans.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} — {limitSummary(p)}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">Starts as a trial; change billing later as usual.</p>
            </div>
            )}
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{placement === "under" && accountType === "landlord" ? "Add landlord & send invitation" : "Create & send invitation"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <InviteLinkDialog
        open={!!created}
        onOpenChange={(o) => { if (!o) setCreated(null); }}
        link={created?.link ?? ""}
        email={created?.email}
        who={created?.name}
        emailSent={false}
      />
    </>
  );
}

/** Platform admin → on an organisation: a fresh set-password link for its admin (lost / expired link), or another admin. */
export function InviteOrgAdminDialog({
  org, onOpenChange,
}: { org: { id: number; name: string } | null; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const invite = useMutation({
    mutationFn: async (data: Record<string, string>) =>
      (await apiRequest(`/api/platform/organizations/${org!.id}/admin-invite`, { method: "POST", data })).json(),
    onSuccess: (r: any, vars) => {
      qc.invalidateQueries({ queryKey: ["/api/platform/organizations"] });
      onOpenChange(false);
      if (r?.invite?.status === "active") {
        toast({ title: "Already set up", description: `${vars.email} already has a working account — nothing to send.` });
      } else if (r?.invite?.emailSent) {
        toast({ title: "Invitation sent", description: `Emailed to ${vars.email}.` });
      } else {
        announceInvite(r?.invite, vars.email, org?.name);
      }
    },
    onError: (e: any) => toast({ title: "Couldn't create the invitation", description: errMsg(e), variant: "destructive" }),
  });

  return (
    <Dialog open={!!org} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite an admin to {org?.name}</DialogTitle>
          <DialogDescription>
            Use this for a lost or expired link, or to add another admin. An existing pending invitation is replaced by a fresh link.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            invite.mutate({
              email: String(f.get("email") ?? "").trim(),
              firstName: String(f.get("firstName") ?? "").trim(),
              lastName: String(f.get("lastName") ?? "").trim(),
            });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="oa-email">Email address</Label>
            <Input id="oa-email" name="email" type="email" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="oa-first">First name</Label><Input id="oa-first" name="firstName" /></div>
            <div className="space-y-1.5"><Label htmlFor="oa-last">Last name</Label><Input id="oa-last" name="lastName" /></div>
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={invite.isPending}>
              {invite.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Create invitation
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Platform admin → on a property-management organisation: link a landlord who already has an account
 * (but no properties yet) to it. Moves them into this organisation as a landlord; the manager then
 * picks them as the owner when adding or editing a property.
 */
export function LinkLandlordDialog({
  org, onOpenChange,
}: { org: { id: number; name: string } | null; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [error, setError] = useState("");

  const link = useMutation({
    mutationFn: async (email: string) =>
      (await apiRequest(`/api/platform/organizations/${org!.id}/link-landlord`, { method: "POST", data: { email } })).json(),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["/api/platform/organizations"] });
      toast({
        title: "Landlord linked",
        description: `${r.landlord?.name ?? "They"} now work under ${r.organization?.name}. They sign in again with the same password.`,
      });
      setError("");
      onOpenChange(false);
    },
    onError: (e: any) => setError(errMsg(e)),
  });

  return (
    <Dialog open={!!org} onOpenChange={(o) => { if (!o) setError(""); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Link a landlord to {org?.name}</DialogTitle>
          <DialogDescription>
            For a landlord who already has an account but no properties yet. They move into this organisation as a landlord,
            and {org?.name} can then add their properties.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            link.mutate(String(new FormData(e.currentTarget).get("email") ?? "").trim());
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="ll-email">Landlord's email address</Label>
            <Input id="ll-email" name="email" type="email" required onChange={() => error && setError("")} />
          </div>
          {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={link.isPending}>
              {link.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Link landlord
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
