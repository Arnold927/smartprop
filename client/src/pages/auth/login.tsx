/**
 * AuthPage — login (v3)
 *
 * Fixes over v2:
 *  - Removed all unused sp-ui imports
 *  - Sharper, Kenya-specific left panel copy
 *  - Spinner replaced with a proper animated element
 *  - Remember me row given proper spacing and layout
 *  - Mobile panel gains trust signals below the form
 *  - "Learn more" link repositioned and styled as a real nav element
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Eye, EyeOff, Mail, Lock, User, Building2,
  Phone, ArrowRight, Shield, Smartphone, FileText,
  Scale, ShieldCheck, Loader2,
} from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

// ── SmartProp wordmark ────────────────────────────────────────────────────────
function Wordmark({ white = false }: { white?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center flex-shrink-0">
        <Building2 className="w-4 h-4 text-white" />
      </div>
      <span className={`text-lg font-semibold tracking-tight ${white ? "text-white" : "text-slate-900"}`}>
        SmartProp
      </span>
    </div>
  );
}

// ── Feature card ──────────────────────────────────────────────────────────────
function FeatureCard({ icon: Icon, title, desc }: { icon: any; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3.5 p-4 rounded-xl bg-white/5 border border-white/10 hover:bg-white/8 transition-colors">
      <div className="w-9 h-9 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Icon className="w-4 h-4 text-emerald-400" />
      </div>
      <div>
        <p className="text-white text-sm font-semibold leading-tight">{title}</p>
        <p className="text-white/50 text-xs mt-1 leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}

// ── Field wrapper ─────────────────────────────────────────────────────────────
function Field({
  label, type = "text", value, onChange, placeholder,
  icon: Icon, action,
}: {
  label: string; type?: string; value: string;
  onChange: (v: string) => void; placeholder?: string;
  icon: any; action?: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-slate-600">{label}</Label>
      <div className="relative">
        <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <Input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="pl-9 pr-9 h-10 border-slate-200 bg-white text-sm focus-visible:ring-emerald-500 focus-visible:border-emerald-400 rounded-lg"
        />
        {action && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">{action}</div>
        )}
      </div>
    </div>
  );
}

// ── Password requirements ─────────────────────────────────────────────────────
const PASSWORD_RULES = [
  { id: "length",  label: "At least 8 characters",        test: (p: string) => p.length >= 8 },
  { id: "upper",   label: "One uppercase letter (A–Z)",    test: (p: string) => /[A-Z]/.test(p) },
  { id: "number",  label: "One number (0–9)",              test: (p: string) => /[0-9]/.test(p) },
  { id: "special", label: "One special character (!@#$…)", test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

function validatePassword(password: string): string | null {
  for (const rule of PASSWORD_RULES) {
    if (!rule.test(password)) return rule.label;
  }
  return null;
}

function PasswordRequirements({ password }: { password: string }) {
  if (!password) return null;
  return (
    <ul className="space-y-1 mt-1.5">
      {PASSWORD_RULES.map(rule => {
        const ok = rule.test(password);
        return (
          <li key={rule.id} className={`flex items-center gap-1.5 text-xs ${ok ? "text-emerald-600" : "text-slate-400"}`}>
            <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center flex-shrink-0 ${ok ? "bg-emerald-100" : "bg-slate-100"}`}>
              {ok ? "✓" : "·"}
            </span>
            {rule.label}
          </li>
        );
      })}
    </ul>
  );
}

// ── Mobile trust strip ────────────────────────────────────────────────────────
function MobileTrustStrip() {
  return (
    <div className="lg:hidden mt-6 pt-6 border-t border-slate-100">
      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: Smartphone, label: "M-Pesa C2B",      sub: "Auto-reconciled" },
          { icon: Scale,      label: "KRA eTIMS",        sub: "Every invoice" },
          { icon: ShieldCheck,label: "ODPC compliant",   sub: "Data encrypted" },
        ].map(({ icon: Icon, label, sub }) => (
          <div key={label} className="flex flex-col items-center text-center gap-1.5 p-3 rounded-xl bg-slate-50 border border-slate-100">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
              <Icon className="w-4 h-4 text-emerald-600" />
            </div>
            <p className="text-xs font-semibold text-slate-700 leading-tight">{label}</p>
            <p className="text-[10px] text-slate-400 leading-tight">{sub}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Main
// ══════════════════════════════════════════════════════════════════════════════

export default function AuthPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = useState(false);

  // ── Login form state ──────────────────────────────────────────────────────
  const [loginData, setLoginData] = useState({ email: "", password: "", rememberMe: false });
  const setLogin = (k: keyof typeof loginData) => (v: string | boolean) =>
    setLoginData(d => ({ ...d, [k]: v }));

  // ── Signup form state ─────────────────────────────────────────────────────
  const [signupData, setSignupData] = useState({
    firstName: "", lastName: "", email: "", password: "",
    confirmPassword: "", organizationName: "", phoneNumber: "", agreeToTerms: false,
  });
  const setSignup = (k: keyof typeof signupData) => (v: string | boolean) =>
    setSignupData(d => ({ ...d, [k]: v }));

  // ── Mutations ─────────────────────────────────────────────────────────────
  const loginMutation = useMutation({
    mutationFn: async (data: typeof loginData) => {
      const res = await apiRequest("/api/auth/login", { method: "POST", data });
      const json = await res.json();
      if (!res.ok) {
        const err: any = new Error(json.message || "Login failed");
        err.status = res.status;
        err.emailVerified = json.emailVerified;
        throw err;
      }
      return json;
    },
    onSuccess: (data) => {
      const token   = data.accessToken  || data.access_token  || data.access;
      const refresh = data.refreshToken || data.refresh_token || data.refresh;
      const remember = data.rememberMe ?? loginData.rememberMe;
      const store = remember ? localStorage : sessionStorage;
      if (remember) {
        sessionStorage.removeItem("access_token");
        sessionStorage.removeItem("refresh_token");
      } else {
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
      }
      if (token)   store.setItem("access_token",  token);
      if (refresh) store.setItem("refresh_token", refresh);
      window.location.href = "/";
    },
    onError: (err: any) => {
      if (err.status === 403 && err.emailVerified === false) {
        toast({ title: "Email not verified", description: "Check your inbox and verify before logging in.", variant: "destructive" });
        setLocation("/auth/verify-email?pending=true");
        return;
      }
      toast({ title: "Login failed", description: err.message || "Invalid email or password", variant: "destructive" });
    },
  });

  const signupMutation = useMutation({
    mutationFn: async (data: typeof signupData) => {
      const pwdError = validatePassword(data.password);
      if (pwdError) throw new Error(`Password must include: ${pwdError.toLowerCase()}`);
      if (data.password !== data.confirmPassword) throw new Error("Passwords do not match");
      if (!data.agreeToTerms) throw new Error("Please agree to the terms and conditions");
      const res  = await apiRequest("/api/auth/signup", { method: "POST", data });
      const json = await res.json();
      if (!res.ok) {
        if (res.status === 409 && json.message?.includes("slug"))  throw new Error("Organisation already exists. Try logging in.");
        if (res.status === 409 && json.message?.includes("Email")) throw new Error("Email already registered. Try logging in.");
        throw new Error(json.message || "Failed to create account");
      }
      return json;
    },
    onSuccess: (data) => {
      toast({ title: "Account created!", description: data.message || "Check your email to verify your account." });
      setTab("login");
    },
    onError: (err: any) => {
      toast({ title: "Signup failed", description: err.message || "Failed to create account", variant: "destructive" });
    },
  });

  const eyeBtn = (show: boolean, toggle: () => void) => (
    <button type="button" onClick={toggle} className="text-slate-400 hover:text-slate-600 transition-colors">
      {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
    </button>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen bg-white">

      {/* ── Left panel — brand hero ── */}
      <div className="hidden lg:flex lg:w-[58%] relative flex-col justify-between p-10 bg-slate-900 h-screen sticky top-0 overflow-y-auto overscroll-contain">

        {/* Backgrounds */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: "url('https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=1400&q=80')" }}
          />
          <div className="absolute inset-0 bg-slate-900/75" />
          <div className="absolute bottom-0 left-0 right-0 h-64 bg-gradient-to-t from-slate-900/60 to-transparent" />
        </div>

        {/* Logo */}
        <div className="relative z-10">
          <Wordmark white />
        </div>

        {/* Main content */}
        <div className="relative z-10 space-y-8">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 text-xs font-medium mb-5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Built for Kenya. Works the way you do.
            </div>
            <h1 className="text-[2.6rem] font-bold text-white leading-[1.15] tracking-tight">
              Every payment matched.<br />
              Every tenant managed.<br />
              <span className="text-emerald-400">Every KRA return ready.</span>
            </h1>
            <p className="text-white/55 text-base mt-4 leading-relaxed max-w-sm">
              From M-Pesa C2B reconciliation to eTIMS invoices, digital leases to gate
              security — SmartProp is the one system your whole team runs on.
              No WhatsApp threads. No Excel arrears sheets. No audit panic.
            </p>
          </div>

          {/* Feature cards */}
          <div className="space-y-3">
            <FeatureCard
              icon={Smartphone}
              title="M-Pesa rent collection, automated"
              desc="Tenants pay via STK push or Paybill. Every payment auto-matched to the right unit — no copy-pasting, no midnight phone checks."
            />
            <FeatureCard
              icon={Scale}
              title="All 7 KRA obligations — covered"
              desc="eTIMS invoices, WHT at 10%/30%, Stamp Duty, CGT, CBK deposit interest, ARMA, and RRT. Maintained in real time, ready for iTax."
            />
            <FeatureCard
              icon={FileText}
              title="Every role gets their own portal"
              desc="Manager, landlord, tenant, guard, caretaker, staff, contractor — each person sees exactly what they need and nothing more."
            />
          </div>
        </div>

        {/* Bottom bar */}
        <div className="relative z-10 flex items-center gap-2.5 pt-5 border-t border-white/10">
          <Shield className="w-3.5 h-3.5 text-white/30 flex-shrink-0" />
          <p className="text-white/30 text-xs">
            ODPC compliant · KRA integrated · Data encrypted at rest
          </p>
        </div>
      </div>

      {/* ── Right panel — form ── */}
      <div className="flex-1 flex flex-col bg-background h-screen overflow-y-auto overscroll-contain">

        {/* Mobile logo */}
        <div className="lg:hidden flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <Wordmark />
          <a
            href="/payprop-landing"
            className="text-xs text-slate-400 hover:text-emerald-600 transition-colors font-medium"
          >
            Learn more →
          </a>
        </div>

        <div className="flex flex-col items-center justify-center px-6 py-8 flex-grow">
          <div className="w-full max-w-[400px] space-y-6">

            {/* Header */}
            <div>
              <h2 className="text-2xl font-bold text-slate-900">
                {tab === "login" ? "Welcome back" : "Create your account"}
              </h2>
              <p className="text-slate-500 text-sm mt-1">
                {tab === "login"
                  ? "Sign in to your SmartProp account"
                  : "Start managing your properties in minutes"
                }
              </p>
            </div>

            {/* ── Login form ── */}
            {tab === "login" && (
              <form
                onSubmit={e => { e.preventDefault(); loginMutation.mutate(loginData); }}
                className="space-y-4"
              >
                <Field
                  label="Email address" type="email"
                  value={loginData.email} onChange={setLogin("email")}
                  placeholder="you@company.com" icon={Mail}
                />
                <Field
                  label="Password" type={showPwd ? "text" : "password"}
                  value={loginData.password} onChange={setLogin("password")}
                  placeholder="Enter your password" icon={Lock}
                  action={eyeBtn(showPwd, () => setShowPwd(v => !v))}
                />

                {/* Remember me + forgot password — proper row */}
                <div className="flex items-center justify-between pt-1">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={loginData.rememberMe}
                      onChange={e => setLogin("rememberMe")(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="text-sm text-slate-600">Remember me</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setLocation("/auth/forgot-password")}
                    className="text-sm text-emerald-600 hover:text-emerald-700 font-medium transition-colors"
                  >
                    Forgot password?
                  </button>
                </div>

                <Button
                  type="submit"
                  disabled={loginMutation.isPending}
                  className="w-full h-10 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg text-sm gap-2"
                >
                  {loginMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Signing in…
                    </>
                  ) : (
                    <>
                      Sign in
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </Button>
              </form>
            )}

            {/* ── Signup form — disabled, admin creates accounts via User Management ── */}
            {false && tab === "signup" && (
              <form onSubmit={e => { e.preventDefault(); signupMutation.mutate(signupData); }} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="First name"  value={signupData.firstName}  onChange={setSignup("firstName")}  placeholder="Wanjiru"  icon={User} />
                  <Field label="Last name"   value={signupData.lastName}   onChange={setSignup("lastName")}   placeholder="Kamau"   icon={User} />
                </div>
                <Field label="Organisation name" value={signupData.organizationName} onChange={setSignup("organizationName")} placeholder="Kamau Properties Ltd" icon={Building2} />
                <Field label="Email address" type="email" value={signupData.email} onChange={setSignup("email")} placeholder="you@company.com" icon={Mail} />
                <Field label="Phone number" type="tel" value={signupData.phoneNumber} onChange={setSignup("phoneNumber")} placeholder="07XX XXX XXX" icon={Phone} />
                <div>
                  <Field
                    label="Password" type={showPwd ? "text" : "password"}
                    value={signupData.password} onChange={setSignup("password")}
                    placeholder="At least 8 characters" icon={Lock}
                    action={eyeBtn(showPwd, () => setShowPwd(v => !v))}
                  />
                  <PasswordRequirements password={signupData.password} />
                </div>
                <Field
                  label="Confirm password" type={showConfirmPwd ? "text" : "password"}
                  value={signupData.confirmPassword} onChange={setSignup("confirmPassword")}
                  placeholder="Repeat password" icon={Lock}
                  action={eyeBtn(showConfirmPwd, () => setShowConfirmPwd(v => !v))}
                />
                <label className="flex items-start gap-2.5 text-sm text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={signupData.agreeToTerms}
                    onChange={e => setSignup("agreeToTerms")(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>
                    I agree to the{" "}
                    <button type="button" className="text-emerald-600 hover:underline font-medium">Terms of Service</button>
                    {" "}and{" "}
                    <button type="button" className="text-emerald-600 hover:underline font-medium">Privacy Policy</button>
                  </span>
                </label>
                <Button
                  type="submit"
                  disabled={signupMutation.isPending}
                  className="w-full h-10 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg text-sm gap-2"
                >
                  {signupMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 animate-spin" />Creating account…</>
                  ) : (
                    <><span>Create account</span><ArrowRight className="w-4 h-4" /></>
                  )}
                </Button>
              </form>
            )}

            {/* Mobile trust strip */}
            <MobileTrustStrip />

            {/* Landing page link — desktop only (mobile has it in header) */}
            <div className="hidden lg:block text-center">
              <a
                href="/payprop-landing"
                className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-emerald-600 transition-colors font-medium"
              >
                <Building2 className="w-3.5 h-3.5" />
                Learn more about SmartProp
              </a>
            </div>

            {/* Footer */}
            <p className="text-center text-xs text-slate-400">
              By continuing you agree to SmartProp's{" "}
              <button className="underline hover:text-slate-600">Terms</button>
              {" "}·{" "}
              <button className="underline hover:text-slate-600">Privacy</button>
            </p>

          </div>
        </div>
      </div>
    </div>
  );
}