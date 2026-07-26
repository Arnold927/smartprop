import { useState } from "react";
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
import { CheckCircle, UserPlus, Shield } from "lucide-react";
import { Label } from "@/components/ui/label";

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
 * app (see server/routes/users.ts). tenant and contractor both have their
 * own dedicated invite flows elsewhere that correctly link the login to a
 * business record (a lease, or a contractor record) — inviting either
 * through this general flow would create a login with nothing behind it.
 * Narrowed to the roles that actually belong here: admin, manager, staff,
 * landlord, caretaker, guard.
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
  { value: "caretaker",  label: "Caretaker",   description: "On-site property upkeep and day-to-day presence" },
  { value: "guard",      label: "Guard",       description: "Gate/visitor access control (usually via PIN, not email)" },
];

export default function UserInviteModal({ triggerText }: { triggerText: string }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // A manager cannot grant admin access — hide the option entirely rather
  // than let them pick it and only find out it's rejected on submit.
  const roleOptions = user?.role === "manager"
    ? ROLE_OPTIONS.filter(r => r.value !== "admin")
    : ROLE_OPTIONS;

  const inviteUserMutation = useMutation({
    mutationFn: (data: { email: string; role: string }) =>
      apiRequest("/api/users", { method: "POST", data }),
    onSuccess: () => {
      toast({
        title: "Invite sent!",
        description: "The invitation has been sent to the user's email.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setOpen(false);
    },
    onError: (err: any) =>
      toast({
        title: "Error sending invite",
        description: err.message || "Failed to send invite",
        variant: "destructive",
      }),
  });

  const handleInviteUser = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    inviteUserMutation.mutate({
      email: formData.get("email") as string,
      role: formData.get("role") as string,
    });
  };

  return (
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

            <form onSubmit={handleInviteUser} className="space-y-6 mt-6">
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

              <div className="space-y-3">
                <Label htmlFor="invite-role" className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Assign Role
                </Label>
                <Select name="role" required>
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
                <p className="text-xs text-muted-foreground">
                  Adding a tenant or contractor? Use the invite flow on the Tenants or Contractors page instead — it links their unit/lease or contractor record automatically.
                </p>
              </div>

              <div className="p-4 bg-green-50 rounded-lg border border-green-100">
                <div className="flex items-start gap-3">
                  <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-green-800">Self-service setup</p>
                    <p className="text-xs text-green-600 mt-1">
                      The user will receive an invitation link and can set up their own password. Their role is applied automatically when they accept.
                    </p>
                  </div>
                </div>
              </div>

              <Button
                type="submit"
                disabled={inviteUserMutation.isPending}
                className="w-full bg-green-600 hover:bg-green-700 transition-colors"
              >
                {inviteUserMutation.isPending ? (
                  <>
                    <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                    Sending Invite...
                  </>
                ) : (
                  "Send Invitation Email"
                )}
              </Button>
            </form>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}