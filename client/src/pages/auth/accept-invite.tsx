import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Lock, Eye, EyeOff, CheckCircle, AlertCircle, Clock, Check, Circle } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import FuturisticLogo from "@/components/ui/futuristic-logo";

const ROLE_LABELS: Record<string, string> = {
  admin: "an administrator",
  manager: "a property manager",
  staff: "a team member",
  landlord: "a landlord",
  tenant: "a tenant",
  caretaker: "a caretaker",
  contractor: "a contractor",
  guard: "a security guard",
};

type InviteInfo = {
  email: string;
  role?: string;
  firstName?: string | null;
  lastName?: string | null;
  organizationName?: string | null;
};

/** apiRequest / the default query function throw Error(<raw response text>); pull the server's message out of it. */
function parseServerError(e: any): { message: string; expired: boolean } {
  const raw = e?.message ?? "";
  try {
    const j = JSON.parse(raw);
    return { message: j?.message || raw, expired: !!j?.expired };
  } catch {
    return { message: raw, expired: false };
  }
}

// Module-level on purpose: declared inside the page component it would be a new component type on every
// render, remounting the form (and dropping focus from the input being typed in) on each keystroke.
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}

export default function AcceptInvitePage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [doneEmail, setDoneEmail] = useState<string | null>(null);

  // Extract token from URL path /accept-invite/:token
  const token = (window.location.pathname.split("/accept-invite/")[1] ?? "").split(/[/?#]/)[0];

  const { data: invite, isLoading, error } = useQuery<InviteInfo>({
    queryKey: [`/api/auth/invite/${token}`],
    enabled: !!token,
    retry: false,
  });

  const needsName = !!invite && !invite.firstName;

  const rules = [
    { ok: password.length >= 8, label: "At least 8 characters" },
    { ok: /[A-Z]/.test(password), label: "An uppercase letter" },
    { ok: /[0-9]/.test(password), label: "A number" },
    { ok: /[^A-Za-z0-9]/.test(password), label: "A special character (e.g. ! @ #)" },
  ];
  const passwordOk = rules.every(r => r.ok);

  const activateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("/api/auth/activate", {
        method: "POST",
        data: {
          token,
          password,
          ...(needsName && firstName.trim() ? { firstName: firstName.trim() } : {}),
          ...(needsName && lastName.trim() ? { lastName: lastName.trim() } : {}),
        },
      });
      return await res.json();
    },
    onSuccess: (res: any) => {
      setDoneEmail(res?.email ?? invite?.email ?? "");
      toast({ title: "Account activated!", description: "Your account is ready. Please sign in." });
    },
    onError: (e: any) => {
      toast({
        title: "Activation failed",
        description: parseServerError(e).message || "This invite link may have expired.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (needsName && !firstName.trim()) {
      toast({ title: "Enter your name", description: "Please add your first name.", variant: "destructive" });
      return;
    }
    if (!passwordOk) {
      toast({ title: "Password too weak", description: "Please meet every requirement listed under the password.", variant: "destructive" });
      return;
    }
    if (password !== confirmPassword) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    activateMutation.mutate();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  if (error || !invite || !token) {
    const { message, expired } = parseServerError(error);
    return (
      <Shell>
        <Card className="shadow-xl border-0">
          <CardHeader className="text-center">
            <div className={`mx-auto w-12 h-12 rounded-full flex items-center justify-center mb-4 ${expired ? "bg-amber-100" : "bg-red-100"}`}>
              {expired ? <Clock className="h-6 w-6 text-amber-700" /> : <AlertCircle className="h-6 w-6 text-red-600" />}
            </div>
            <CardTitle>{expired ? "This invitation has expired" : "Invalid invitation"}</CardTitle>
            <CardDescription>
              {message && !message.startsWith("{")
                ? message
                : "This invitation link is invalid or has expired. Please ask your administrator to send a new invite."}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center space-y-2">
            <p className="text-xs text-muted-foreground">
              Already set up your account? Just sign in — or use “Forgot password” if you can't remember it.
            </p>
            <Button variant="outline" onClick={() => navigate("/auth")}>Go to Sign In</Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (doneEmail !== null) {
    return (
      <Shell>
        <div className="text-center">
          <FuturisticLogo className="mx-auto mb-6" />
          <Card className="shadow-xl border-0">
            <CardHeader>
              <div className="mx-auto w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mb-4">
                <CheckCircle className="h-6 w-6 text-emerald-600" />
              </div>
              <CardTitle>You're all set!</CardTitle>
              <CardDescription>Your account has been activated. Sign in with {doneEmail || "your email"} and the password you just chose.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" onClick={() => navigate(`/auth${doneEmail ? `?email=${encodeURIComponent(doneEmail)}` : ""}`)}>Sign in</Button>
            </CardContent>
          </Card>
        </div>
      </Shell>
    );
  }

  const roleLabel = invite.role ? ROLE_LABELS[invite.role] : undefined;

  return (
    <Shell>
      <div className="text-center mb-8">
        <FuturisticLogo className="mx-auto mb-4" />
        <p className="text-muted-foreground mt-1">
          {invite.organizationName
            ? <>You've been invited to join <strong className="text-foreground">{invite.organizationName}</strong>{roleLabel ? <> as {roleLabel}</> : null}</>
            : <>You've been invited to join{roleLabel ? <> as {roleLabel}</> : null}</>}
        </p>
      </div>

      <Card className="shadow-xl border-0">
        <CardHeader className="pb-4">
          <CardTitle className="text-2xl text-center">Activate your account</CardTitle>
          <CardDescription className="text-center">
            Set a password for <strong>{invite.email}</strong>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {needsName && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="first-name">First name</Label>
                  <Input id="first-name" autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required maxLength={100} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="last-name">Last name</Label>
                  <Input id="last-name" autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={100} />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="Create a password"
                  className="pl-10 pr-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1 pt-1" aria-label="Password requirements">
                {rules.map(r => (
                  <li key={r.label} className={`flex items-center gap-1.5 text-xs ${r.ok ? "text-emerald-600" : "text-muted-foreground"}`}>
                    {r.ok ? <Check className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
                    {r.label}
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm">Confirm password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="confirm"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="Repeat your password"
                  className="pl-10"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>
              {confirmPassword && password !== confirmPassword && (
                <p className="text-xs text-red-600">Passwords don't match yet.</p>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={activateMutation.isPending}>
              {activateMutation.isPending ? "Activating..." : "Activate account"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </Shell>
  );
}
