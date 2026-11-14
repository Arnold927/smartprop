import { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogOverlay,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { CheckCircle, UserPlus, Shield, Link2 } from "lucide-react";
import { InviteLinkDialog } from "@/components/invite-link-dialog";
import { Label } from "@/components/ui/label";

/** apiRequest throws on a non-2xx response with the raw response TEXT as e.message — for a JSON
 *  error body like {"message":"..."} that would show up as a literal JSON blob in a toast. */
function errMsg(e: any): string {
  try { const j = JSON.parse(e?.message); if (j?.message) return String(j.message); } catch { /* not JSON */ }
  return e?.message || "Failed to send invite";
}

/**
 * client/src/components/user-invite-modal.tsx
 *
 * Rebuilt. Previously this had two tabs — "Create User" (which set a
 * password on the client and sent it as a pre-hashed field the backend
 * schema doesn't even accept, silently discarding it — the account created
 * was functionally identical to an invite either way) and "Send Invite".
 * Since both paths ended up doing the exact same thing on the backend,
 * removed the misleading "Create User" tab entirely and kept the one that
 * actually works: an invite email the person uses to set their own password.
 *
 * Also previously offered admin, property_manager, tenant, diaspora_buyer,
 * project_manager, supplier_vendor, and casual_worker_staff as role
 * options — none of the last five are real, enforced roles anywhere in the
 * app (see server/routes/users.ts). tenant, contractor, and caretaker all
 * have their own dedicated invite flows elsewhere that correctly link the
 * login to a business record (a lease, a contractor record, or a property
 * assignment) — inviting any of the three through this general flow would
 * create a login with nothing behind it. caretaker was removed once the
 * dedicated Caretakers page was built, for the same reason.
 * Narrowed to the roles that actually belong here: admin, manager, staff,
 * landlord, guard.
 *
 * A manager using this modal never sees "Admin" as an option at all — the
 * backend also enforces this (a manager cannot grant admin access), but
 * hiding it here means they never hit that rejection in the first place.
 */

const ROLE_OPTIONS: { value: string; label: string; description: string }[] = [
  { value: "admin",      label: "Admin",      description: "Full system access and user management" },
  { value: "manager",    label: "Manager",     description: "Day-to-day operations across the organisation" },
  { value: "landlord",   label: "Landlord",    description: "Owns properties; sees their own portfolio and finances" },
  { value: "staff",      label: "Staff",       description: "General team member — rent collection, tenant support" },
  { value: "guard",      label: "Guard",       description: "Gate/visitor access control (usually via PIN, not email)" },
];

export default function UserInviteModal({ triggerText }: { triggerText: string }) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState("");
  const [linkResult, setLinkResult] = useState<{ link: string; email: string; emailSent: boolean; emailRequested: boolean } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  /** Which button was pressed: email the invite, or just hand me the link. */
  const sendEmailRef = useRef(true);
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // A manager cannot grant admin access — hide the option entirely rather
  // than let them pick it and only find out it's rejected on submit.
  const roleOptions = user?.role === "manager"
    ? ROLE_OPTIONS.filter(r => r.value !== "admin")
    : ROLE_OPTIONS;

  const inviteUserMutation = useMutation({
    mutationFn: async (data: { email: string; role: string; sendEmail: boolean; firstName?: string; lastName?: string }) => {
      const res = await apiRequest("/api/users", { method: "POST", data });
      return res.json();
    },
    onSuccess: (result: any, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setOpen(false);
      formRef.current?.reset();
      setRole("");
      if (result?.emailSent) {
        toast({ title: "Invite sent!", description: `The invitation was emailed to ${vars.email}.` });
      } else if (result?.inviteLink) {
        // Link-only was requested, or the email could not be sent — either way the link is the way in.
        setLinkResult({ link: result.inviteLink, email: vars.email, emailSent: false, emailRequested: !!vars.sendEmail });
      } else {
        toast({ title: "Invite created" });
      }
    },
    onError: (err: any) =>
      toast({
        title: "Error sending invite",
        description: errMsg(err),
        variant: "destructive",
      }),
  });

  const handleInviteUser = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!role) {
      toast({ title: "Choose a role", description: "Pick what this person will be able to do.", variant: "destructive" });
      return;
    }
    const formData = new FormData(e.currentTarget);
    const first = String(formData.get("firstName") ?? "").trim();
    const last = String(formData.get("lastName") ?? "").trim();
    inviteUserMutation.mutate({
      email: String(formData.get("email") ?? "").trim(),
      role,
      sendEmail: sendEmailRef.current,
      ...(first ? { firstName: first } : {}),
      ...(last ? { lastName: last } : {}),
    });
  };

  return (
    <>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <UserPlus className="h-4 w-4" />
          {triggerText}
        </Button>
      </DialogTrigger>
      <DialogOverlay className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
      <DialogContent className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 max-w-lg p-0 rounded-xl shadow-2xl bg-card border border-border overflow-hidden">
        <div className="max-h-[90vh] overflow-y-auto">
          <div className="p-8">
            <DialogHeader className="space-y-2">
              <DialogTitle className="text-2xl font-semibold text-foreground flex items-center gap-2">
                <UserPlus className="h-6 w-6" />
                Invite a User
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                They'll receive an email invitation to set up their own account and password.
              </DialogDescription>
            </DialogHeader>

            <form ref={formRef} onSubmit={handleInviteUser} className="space-y-6 mt-6">
              <div className="space-y-3">
                <Label htmlFor="invite-email" className="text-sm font-medium text-foreground">
                  Email Address
                </Label>
                <Input
                  id="invite-email"
                  name="email"
                  type="email"
                  placeholder="user@example.com"
                  required
                  className="border-border focus:border-emerald-500 focus:ring-emerald-500 transition-colors"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="invite-first" className="text-sm font-medium text-foreground">First name <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input id="invite-first" name="firstName" autoComplete="off" maxLength={100} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invite-last" className="text-sm font-medium text-foreground">Last name <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input id="invite-last" name="lastName" autoComplete="off" maxLength={100} />
                </div>
              </div>

              <div className="space-y-3">
                <Label htmlFor="invite-role" className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Assign Role
                </Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger
                    id="invite-role"
                    className="border-border focus:border-emerald-500 focus:ring-emerald-500 transition-colors"
                  >
                    <SelectValue placeholder="Select role for invited user" />
                  </SelectTrigger>
                  <SelectContent className="border-border shadow-lg">
                    {roleOptions.map(({ value, label, description }) => (
                      <SelectItem key={value} value={value} className="py-3">
                        <div className="flex flex-col">
                          <span className="font-medium">{label}</span>
                          <span className="text-xs text-muted-foreground mt-0.5">{description}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {role === "landlord" && (
                  <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-md px-2.5 py-2">
                    Once they've joined, link their properties: open the property (or add a new one) and choose them as its owner.
                    They'll only ever see the properties assigned to them.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Adding a tenant, contractor, or caretaker? Use the invite flow on the Tenants, Contractors, or Caretakers page instead — it links their unit/lease, contractor record, or property assignment automatically.
                </p>
              </div>

              <div className="p-4 bg-green-50 rounded-lg border border-green-100">
                <div className="flex items-start gap-3">
                  <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-green-800">Self-service setup</p>
                    <p className="text-xs text-green-600 mt-1">
                      They get an invitation link to set their own password, valid for 7 days. Email it, or create the link and send it yourself over WhatsApp. Their role is applied when they accept.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Button
                  type="submit"
                  disabled={inviteUserMutation.isPending}
                  onClick={() => { sendEmailRef.current = true; }}
                  className="w-full bg-green-600 hover:bg-green-700 transition-colors"
                >
                  {inviteUserMutation.isPending && sendEmailRef.current ? (
                    <>
                      <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                      Sending Invite...
                    </>
                  ) : (
                    "Send Invitation Email"
                  )}
                </Button>
                <Button
                  type="submit"
                  variant="outline"
                  disabled={inviteUserMutation.isPending}
                  onClick={() => { sendEmailRef.current = false; }}
                  className="w-full gap-2"
                >
                  <Link2 className="h-4 w-4" />
                  Create link only (share it yourself)
                </Button>
              </div>
            </form>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    <InviteLinkDialog
      open={!!linkResult}
      onOpenChange={(o) => { if (!o) setLinkResult(null); }}
      link={linkResult?.link ?? ""}
      email={linkResult?.email}
      emailSent={linkResult?.emailSent ?? false}
      emailRequested={linkResult?.emailRequested ?? true}
    />
    </>
  );
}
