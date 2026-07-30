/**
 * Profile & Settings — /profile
 *
 * Lets any logged-in user update their own safe fields:
 *   - First / last name
 *   - Phone number
 *   - Preferred currency
 *   - Password (requires current password)
 *
 * Read-only (not editable here):
 *   - Email        — critical, must go through a verified-change flow
 *   - Role         — admin-managed only
 *   - Organisation — admin-managed only
 */
import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, User, Lock, Shield, CheckCircle2, Eye, EyeOff, Check, X } from "lucide-react";
import { format } from "date-fns";

const CURRENCIES = ["KES", "USD", "GBP", "EUR", "UGX", "TZS"];

const roleColour: Record<string, string> = {
  admin:    "bg-purple-100 text-purple-700",
  manager:  "bg-blue-100 text-blue-700",
  landlord: "bg-emerald-100 text-emerald-700",
  staff:    "bg-amber-100 text-amber-700",
  tenant:   "bg-sky-100 text-sky-700",
  guard:    "bg-rose-100 text-rose-700",
};

// ── Password strength rules ───────────────────────────────────────────────────
const PWD_RULES = [
  { id: "length",    label: "At least 8 characters",            test: (p: string) => p.length >= 8 },
  { id: "uppercase", label: "At least one uppercase letter (A–Z)", test: (p: string) => /[A-Z]/.test(p) },
  { id: "lowercase", label: "At least one lowercase letter (a–z)", test: (p: string) => /[a-z]/.test(p) },
  { id: "number",    label: "At least one number (0–9)",         test: (p: string) => /\d/.test(p) },
  { id: "special",   label: "At least one special character (!@#$%^&*)", test: (p: string) => /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(p) },
];

function strengthLabel(passed: number): { label: string; color: string; bar: string } {
  if (passed <= 1) return { label: "Very weak",  color: "text-red-600",    bar: "bg-red-500"    };
  if (passed === 2) return { label: "Weak",       color: "text-orange-600", bar: "bg-orange-500" };
  if (passed === 3) return { label: "Fair",       color: "text-yellow-600", bar: "bg-yellow-400" };
  if (passed === 4) return { label: "Strong",     color: "text-emerald-600",bar: "bg-emerald-500"};
  return              { label: "Very strong", color: "text-emerald-700", bar: "bg-emerald-600"};
}

// ── Read-only field component ─────────────────────────────────────────────────
function ReadOnlyField({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div>
      <Label className="text-xs flex items-center gap-1.5 text-muted-foreground mb-1.5">
        <Lock className="w-3 h-3" /> {label}
      </Label>
      <div className="flex items-center h-9 px-3 rounded-md border border-input bg-muted/40 text-sm text-foreground/60 cursor-not-allowed select-none">
        {value}
      </div>
      <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>
    </div>
  );
}

export default function ProfilePage() {
  const { user, refetch } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isPlatformAdmin = user?.role === "platform_admin";

  // ── Profile form ─────────────────────────────────────────────────────────────
  const [profile, setProfile] = useState({
    firstName:         user?.firstName ?? "",
    lastName:          user?.lastName  ?? "",
    phoneNumber:       (user as any)?.phoneNumber ?? "",
    preferredCurrency: (user as any)?.preferredCurrency ?? "KES",
    // Only meaningfully editable for platform_admin — see the render section
    // below and the server-side enforcement in PATCH /api/users/me, which
    // silently ignores these fields from anyone else regardless of what's
    // sent in the request body.
    email: user?.email ?? "",
    role:  user?.role ?? "",
  });
  const [savingProfile, setSavingProfile] = useState(false);

  async function saveProfile() {
    setSavingProfile(true);
    try {
      const data = isPlatformAdmin ? profile : {
        firstName: profile.firstName, lastName: profile.lastName,
        phoneNumber: profile.phoneNumber, preferredCurrency: profile.preferredCurrency,
      };
      await apiRequest("/api/users/me", { method: "PATCH", data });
      await refetch();
      qc.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: "Profile updated" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSavingProfile(false);
    }
  }

  // ── Password form ─────────────────────────────────────────────────────────────
  const [pwd, setPwd] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [savingPwd, setSavingPwd] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew]         = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pwdTouched, setPwdTouched]   = useState(false);

  const ruleResults = useMemo(() =>
    PWD_RULES.map(r => ({ ...r, passed: r.test(pwd.newPassword) })),
    [pwd.newPassword]
  );
  const passedCount  = ruleResults.filter(r => r.passed).length;
  const strength     = strengthLabel(passedCount);
  const allRulesMet  = passedCount === PWD_RULES.length;
  const passwordsMatch = pwd.newPassword === pwd.confirmPassword;

  async function changePassword() {
    setPwdTouched(true);
    if (!allRulesMet) {
      toast({ title: "Password doesn't meet requirements", variant: "destructive" });
      return;
    }
    if (!passwordsMatch) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    setSavingPwd(true);
    try {
      await apiRequest("/api/users/me/password", {
        method: "PATCH",
        data: { currentPassword: pwd.currentPassword, newPassword: pwd.newPassword },
      });
      setPwd({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setPwdTouched(false);
      toast({ title: "Password changed successfully" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSavingPwd(false);
    }
  }

  if (!user) return null;

  const initials = `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`.toUpperCase() || "U";

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold">Profile & Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manage your personal details and account security.</p>
      </div>

      {/* Account overview */}
      <Card>
        <CardContent className="pt-5">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center flex-shrink-0 shadow">
              <span className="text-white font-bold text-lg">{initials}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-base">{user.firstName} {user.lastName}</p>
              <p className="text-sm text-muted-foreground truncate">{user.email}</p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <Badge variant="outline" className={`capitalize text-xs ${roleColour[user.role ?? ""] ?? "bg-muted text-muted-foreground"}`}>
                  {user.role}
                </Badge>
                {(user as any).emailVerified && (
                  <span className="flex items-center gap-1 text-xs text-emerald-600">
                    <CheckCircle2 className="h-3 w-3" /> Email verified
                  </span>
                )}
              </div>
            </div>
          </div>

          {(user as any).lastLoginAt && (
            <div className="mt-4 pt-4 border-t text-sm">
              <p className="text-xs text-muted-foreground">Last login</p>
              <p className="font-medium">{format(new Date((user as any).lastLoginAt), "dd MMM yyyy, HH:mm")}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Editable profile fields */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" /> Personal details
          </CardTitle>
          <CardDescription>You can update your name, phone number and preferred currency.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* Email & role — editable only for platform_admin, who has no
              organisation admin above them to "contact" for these changes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-4 border-b">
            {isPlatformAdmin ? (
              <div>
                <Label className="text-xs">Email address</Label>
                <Input
                  type="email"
                  value={profile.email}
                  onChange={(e) => setProfile(p => ({ ...p, email: e.target.value }))}
                />
              </div>
            ) : (
              <ReadOnlyField
                label="Email address"
                value={user.email ?? ""}
                hint="To change your email, contact an admin."
              />
            )}
            {isPlatformAdmin ? (
              <div>
                <Label className="text-xs">Role</Label>
                <Select value={profile.role} onValueChange={(v) => setProfile(p => ({ ...p, role: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="platform_admin">Platform Admin</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground mt-1">Changing this away from Platform Admin removes your platform-wide access.</p>
              </div>
            ) : (
              <ReadOnlyField
                label="Role"
                value={user.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : ""}
                hint="Managed by your organisation admin."
              />
            )}
          </div>

          {/* Editable fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">First name</Label>
              <Input
                value={profile.firstName}
                onChange={e => setProfile(p => ({ ...p, firstName: e.target.value }))}
                placeholder="First name"
                className="mt-1.5"
              />
            </div>
            <div>
              <Label className="text-xs">Last name</Label>
              <Input
                value={profile.lastName}
                onChange={e => setProfile(p => ({ ...p, lastName: e.target.value }))}
                placeholder="Last name"
                className="mt-1.5"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">Phone number</Label>
            <Input
              value={profile.phoneNumber}
              onChange={e => setProfile(p => ({ ...p, phoneNumber: e.target.value }))}
              placeholder="+254 7XX XXX XXX"
              type="tel"
              className="mt-1.5"
            />
            <p className="text-[11px] text-muted-foreground mt-1">Include country code, e.g. +254 for Kenya.</p>
          </div>

          <div>
            <Label className="text-xs">Preferred currency</Label>
            <Select
              value={profile.preferredCurrency}
              onValueChange={v => setProfile(p => ({ ...p, preferredCurrency: v }))}
            >
              <SelectTrigger className="w-40 mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end pt-1">
            <Button onClick={saveProfile} disabled={savingProfile}>
              {savingProfile && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Save changes
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Change password */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Lock className="h-4 w-4 text-muted-foreground" /> Change password
          </CardTitle>
          <CardDescription>Choose a strong password you haven't used before.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* Current password */}
          <div>
            <Label className="text-xs">Current password</Label>
            <div className="relative mt-1.5">
              <Input
                type={showCurrent ? "text" : "password"}
                value={pwd.currentPassword}
                onChange={e => setPwd(p => ({ ...p, currentPassword: e.target.value }))}
                placeholder="Enter your current password"
                autoComplete="current-password"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowCurrent(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* New password */}
          <div>
            <Label className="text-xs">New password</Label>
            <div className="relative mt-1.5">
              <Input
                type={showNew ? "text" : "password"}
                value={pwd.newPassword}
                onChange={e => { setPwd(p => ({ ...p, newPassword: e.target.value })); setPwdTouched(true); }}
                placeholder="Create a new password"
                autoComplete="new-password"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowNew(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {/* Strength bar */}
            {pwd.newPassword.length > 0 && (
              <div className="mt-2 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Password strength</span>
                  <span className={`font-medium ${strength.color}`}>{strength.label}</span>
                </div>
                <div className="flex gap-1">
                  {[0,1,2,3,4].map(i => (
                    <div
                      key={i}
                      className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
                        i < passedCount ? strength.bar : "bg-muted"
                      }`}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Requirements checklist */}
            {(pwdTouched || pwd.newPassword.length > 0) && (
              <div className="mt-3 p-3 bg-muted/40 rounded-lg border border-border space-y-1.5">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Password requirements</p>
                {ruleResults.map(r => (
                  <div key={r.id} className="flex items-center gap-2">
                    {r.passed
                      ? <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      : <X    className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />}
                    <span className={`text-xs ${r.passed ? "text-foreground" : "text-muted-foreground"}`}>
                      {r.label}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Confirm password */}
          <div>
            <Label className="text-xs">Confirm new password</Label>
            <div className="relative mt-1.5">
              <Input
                type={showConfirm ? "text" : "password"}
                value={pwd.confirmPassword}
                onChange={e => setPwd(p => ({ ...p, confirmPassword: e.target.value }))}
                placeholder="Re-enter your new password"
                autoComplete="new-password"
                className={`pr-10 ${
                  pwd.confirmPassword.length > 0
                    ? passwordsMatch ? "border-emerald-400 focus-visible:ring-emerald-300" : "border-red-400 focus-visible:ring-red-300"
                    : ""
                }`}
              />
              <button
                type="button"
                onClick={() => setShowConfirm(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {pwd.confirmPassword.length > 0 && !passwordsMatch && (
              <p className="text-xs text-red-600 mt-1">Passwords do not match.</p>
            )}
            {pwd.confirmPassword.length > 0 && passwordsMatch && (
              <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                <Check className="w-3 h-3" /> Passwords match
              </p>
            )}
          </div>

          <div className="flex justify-end pt-1">
            <Button
              variant="outline"
              onClick={changePassword}
              disabled={savingPwd || !pwd.currentPassword || !pwd.newPassword || !pwd.confirmPassword}
            >
              {savingPwd && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Update password
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Security info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4 text-muted-foreground" /> Security
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2 text-muted-foreground">
          <p>Your email and role can only be changed by an organisation admin in <strong>User Management</strong>.</p>
          <p>If you believe your account has been compromised, change your password immediately or contact your admin.</p>
        </CardContent>
      </Card>

    </div>
  );
}