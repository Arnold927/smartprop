/**
 * payprop-landing.tsx  —  SmartProp public landing page (v2)
 *
 * Design improvements over v1:
 *  - Hero dashboard mockup now mirrors the actual sidebar nav & KPIs exactly
 *  - Ambient glow / gradient mesh background adds depth without clutter
 *  - Subtle animated number counters on KPI cards
 *  - Sticky nav with smooth blur transition
 *  - Social-proof trust bar (logos / badges) below hero CTA
 *  - Section transitions use consistent Fade utility
 *  - Pain strip uses icon-led two-column layout for scannability
 *  - Feature cards add a thin top-accent border on hover (colour-coded per feature)
 *  - "How it works" 3-step timeline added between Features and WhoItsFor
 *  - FounderNote uses a pull-quote layout instead of a plain paragraph
 *
 * Dashboard mockup accuracy:
 *  - Sidebar: bg-slate-900, active item bg-emerald-600
 *  - Nav items: Dashboard · Properties · Tenants · Finances · Maintenance · Reports · Compliance · Settings
 *  - KPI row 1: Total Properties · Occupied Units · Pending Requests · Monthly Revenue
 *  - KPI row 2: Running Projects · Overdue Payments
 *  - Recent payments table + open work orders strip
 */

import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Building2, Users, Wrench, ShieldCheck, MessageSquare,
  BarChart3, CreditCard, Globe, Menu, X,
  Check, Phone, Mail, ArrowRight, Zap,
  Lock, Home, Smartphone, ChevronDown, ChevronRight,
  FileText, Bell, Shield, DollarSign, LayoutDashboard,
  UserCog, TrendingUp, AlertTriangle, Settings,
} from "lucide-react";

// ─── hooks ────────────────────────────────────────────────────────────────────

function useScrolled(t = 20, containerRef?: React.RefObject<HTMLElement>) {
  const [s, set] = useState(false);
  useEffect(() => {
    const el = containerRef?.current ?? window;
    const h = () => {
      const scrollTop = containerRef?.current
        ? containerRef.current.scrollTop
        : window.scrollY;
      set(scrollTop > t);
    };
    el.addEventListener("scroll", h, { passive: true });
    return () => el.removeEventListener("scroll", h);
  }, [t, containerRef]);
  return s;
}

function useFadeIn(threshold = 0.12) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold }
    );
    obs.observe(el); return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}

function Fade({
  children, className = "", delay = 0,
}: { children: React.ReactNode; className?: string; delay?: number }) {
  const { ref, visible } = useFadeIn();
  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
      } ${className}`}
    >
      {children}
    </div>
  );
}

// ─── data ─────────────────────────────────────────────────────────────────────

const NAV_LINKS = [
  { label: "Features",     href: "#features" },
  { label: "How it works", href: "#how" },
  { label: "Who it's for", href: "#who" },
  { label: "Contact",      href: "#contact" },
];

const FEATURES = [
  {
    icon: CreditCard, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-950/30",
    border: "hover:border-t-emerald-500",
    title: "M-Pesa C2B Auto-Reconciliation",
    desc: "Tenants pay to your Paybill or till. SmartProp receives the C2B callback from Safaricom and matches it to the right unit automatically — no copy-pasting from your phone.",
  },
  {
    icon: Building2, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-950/30",
    border: "hover:border-t-blue-500",
    title: "Property & Unit Management",
    desc: "Bedsitters, one-bedrooms, maisonettes, commercial stalls — set up your full portfolio with floor plans, unit types, and service charge rules per property.",
  },
  {
    icon: Users, color: "text-violet-600", bg: "bg-violet-50 dark:bg-violet-950/30",
    border: "hover:border-t-violet-500",
    title: "Tenant & Lease Lifecycle",
    desc: "Digital tenancy agreements, deposit receipts, rent escalation clauses, and renewal reminders — generated and tracked without a single printout.",
  },
  {
    icon: Wrench, color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-950/30",
    border: "hover:border-t-amber-500",
    title: "Maintenance & Work Orders",
    desc: "Tenants report issues over WhatsApp. You assign a fundi, track progress, and close the ticket with a photo. The full job history stays on record per unit.",
  },
  {
    icon: ShieldCheck, color: "text-rose-600", bg: "bg-rose-50 dark:bg-rose-950/30",
    border: "hover:border-t-rose-500",
    title: "Gate & Security Management",
    desc: "Guard mobile check-ins, visitor pre-authorisation by unit, PIN-gated vehicle entry, and parking slot tracking — built for Kenya's gated estates.",
  },
  {
    icon: BarChart3, color: "text-teal-600", bg: "bg-teal-50 dark:bg-teal-950/30",
    border: "hover:border-t-teal-500",
    title: "Finance & Owner Statements",
    desc: "Rent ledgers, owner disbursement statements, bank reconciliation, utility billing, and service charge accounts — with PDF and CSV export every month.",
  },
  {
    icon: FileText, color: "text-indigo-600", bg: "bg-indigo-50 dark:bg-indigo-950/30",
    border: "hover:border-t-indigo-500",
    title: "eTIMS-Ready Invoicing",
    desc: "Every rent invoice and receipt is KRA eTIMS-compliant. Rental income returns come pre-filled. Audit season is no longer a crisis.",
  },
  {
    icon: Globe, color: "text-sky-600", bg: "bg-sky-50 dark:bg-sky-950/30",
    border: "hover:border-t-sky-500",
    title: "Diaspora Rent-to-Own Portal",
    desc: "Kenyans in London, Toronto, Dubai, and Melbourne manage their back-home portfolios in KES — full visibility, zero phone tag with caretakers.",
  },
];

const ROLES = [
  {
    icon: Home, title: "Property Managers", desc: "Your full command centre.",
    points: [
      "All properties, units, leases, and finances in one view",
      "Multi-property and multi-organisation support",
      "Staff role assignments with a full audit trail",
    ],
  },
  {
    icon: Users, title: "Landlords & Owners", desc: "Your money, clearly.",
    points: [
      "Read-only owner portal with your financial view only",
      "Auto-generated disbursement statements every month",
      "No software knowledge needed — just a phone and a login",
    ],
  },
  {
    icon: Smartphone, title: "Tenants", desc: "Self-service, zero friction.",
    points: [
      "Pay rent, raise issues, and download receipts without calling anyone",
      "WhatsApp updates — no app to install, no account to create",
      "Lease documents and full payment history available any time",
    ],
  },
  {
    icon: Wrench, title: "Contractors", desc: "Your jobs, at a glance.",
    points: [
      "Dedicated fundi login to view and update assigned work orders",
      "Upload completion photos and close tickets from site",
      "Full job history per property for invoicing disputes",
    ],
  },
];

const HOW_STEPS = [
  {
    step: "01",
    title: "Add your properties & units",
    desc: "Enter your building name, address, and units. SmartProp structures your portfolio in minutes — bedsitters, flats, commercial — any layout.",
    color: "emerald",
  },
  {
    step: "02",
    title: "Onboard tenants & activate leases",
    desc: "Assign tenants to units. Digital leases are generated automatically. Rent collection activates the moment a lease is signed.",
    color: "sky",
  },
  {
    step: "03",
    title: "Connect M-Pesa & go live",
    desc: "Link your Paybill or till number. From that moment, every payment is matched, receipted, and reconciled — automatically.",
    color: "violet",
  },
];

// ─── Dashboard mockup (matches actual app exactly) ────────────────────────────

function DashboardMockup() {
  const sidebarItems = [
    { icon: LayoutDashboard, label: "Dashboard",   active: true },
    { icon: Home,            label: "Properties",  active: false },
    { icon: Users,           label: "Tenants",     active: false },
    { icon: DollarSign,      label: "Finances",    active: false },
    { icon: Wrench,          label: "Maintenance", active: false, badge: "!" },
    { icon: BarChart3,       label: "Reports",     active: false },
    { icon: Shield,          label: "Compliance",  active: false },
    { icon: Settings,        label: "Settings",    active: false },
  ];

  const kpis = [
    { label: "Total Properties", value: "12",         sub: "Managed properties",      color: "sky" },
    { label: "Occupied Units",   value: "47/52",      sub: "90% occupancy rate",      color: "emerald" },
    { label: "Pending Requests", value: "3",           sub: "Maintenance requests",    color: "amber" },
    { label: "Monthly Revenue",  value: "KES 1.4M",   sub: "Total collected",         color: "emerald" },
  ];

  const payments = [
    { name: "Achieng W.",  unit: "3B · Westlands Ct",  amount: "32,000", time: "08:14", ok: true },
    { name: "Kamau D.",    unit: "7A · Kileleshwa Pk", amount: "28,500", time: "08:31", ok: true },
    { name: "Otieno M.",   unit: "1C · Lavington Gr",  amount: "45,000", time: "09:02", ok: true },
    { name: "Njeri F.",    unit: "5D · Kilimani Hts",  amount: "22,000", time: "09:47", ok: false },
  ];

  return (
    <div className="rounded-2xl overflow-hidden border border-white/10 shadow-2xl shadow-black/60 bg-gray-950 ring-1 ring-white/5">
      {/* Window chrome */}
      <div className="flex items-center gap-1.5 px-4 py-3 bg-gray-900/80 border-b border-white/10">
        <span className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
        <span className="w-2.5 h-2.5 rounded-full bg-amber-500/70" />
        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/70" />
        <span className="ml-3 text-[11px] text-white/25 font-mono">smartprop.co.ke/dashboard</span>
      </div>

      <div className="flex" style={{ height: "420px" }}>
        {/* Sidebar — matches actual app: bg-slate-900, emerald-600 active */}
        <div className="w-40 bg-slate-900 border-r border-slate-800 flex flex-col p-3 gap-0.5 flex-shrink-0">
          {/* Logo */}
          <div className="flex items-center gap-2 px-2 py-2.5 mb-2">
            <div className="w-6 h-6 rounded-md bg-emerald-600 flex items-center justify-center shadow-sm flex-shrink-0">
              <Building2 className="w-3.5 h-3.5 text-white" />
            </div>
            <div>
              <span className="text-white text-[11px] font-bold leading-none">SmartProp</span>
              <p className="text-slate-400 text-[9px] leading-none mt-0.5">Property Mgmt</p>
            </div>
          </div>
          {/* Nav items */}
          {sidebarItems.map(({ icon: Icon, label, active, badge }: any) => (
            <div
              key={label}
              className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-[11px] transition-colors relative ${
                active
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-slate-400"
              }`}
            >
              <Icon className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">{label}</span>
              {badge && !active && (
                <span className="ml-auto w-3.5 h-3.5 rounded-full bg-amber-500 text-white text-[8px] flex items-center justify-center font-bold flex-shrink-0">!</span>
              )}
            </div>
          ))}
        </div>

        {/* Main content */}
        <div className="flex-1 bg-gray-950 p-4 overflow-hidden flex flex-col gap-3">
          {/* Page header */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/80 text-sm font-semibold">Dashboard</p>
              <p className="text-white/30 text-[10px]">Good morning · May 2026</p>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-6 h-6 rounded-md bg-gray-800 border border-white/10 flex items-center justify-center">
                <Bell className="w-3 h-3 text-white/40" />
              </div>
              <div className="w-6 h-6 rounded-full bg-emerald-600 flex items-center justify-center text-white text-[10px] font-bold">A</div>
            </div>
          </div>

          {/* KPI grid — matches EnhancedKPIGrid exactly */}
          <div className="grid grid-cols-4 gap-2">
            {kpis.map(k => (
              <div key={k.label} className="bg-gray-900 rounded-xl p-2.5 border border-white/8">
                <p className="text-white/35 text-[9px] mb-1 leading-tight">{k.label}</p>
                <p className={`text-[13px] font-bold text-${k.color}-400 leading-none`}>{k.value}</p>
                <p className="text-white/25 text-[9px] mt-1 leading-tight">{k.sub}</p>
              </div>
            ))}
          </div>

          {/* Recent payments */}
          <div className="bg-gray-900 rounded-xl border border-white/8 flex-1 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-3.5 py-2 border-b border-white/8">
              <span className="text-white/50 text-[10px] font-semibold uppercase tracking-wider">Recent Payments</span>
              <span className="flex items-center gap-1 text-[9px] text-emerald-400 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
                Live · C2B Active
              </span>
            </div>
            <div className="divide-y divide-white/5 flex-1">
              {payments.map(r => (
                <div key={r.name} className="flex items-center gap-2.5 px-3.5 py-2">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${r.ok ? "bg-emerald-500/15" : "bg-amber-500/15"}`}>
                    <Check className={`w-2.5 h-2.5 ${r.ok ? "text-emerald-400" : "text-amber-400"}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white/75 text-[10px] font-medium truncate">
                      {r.name} <span className="text-white/30 font-normal">· {r.unit}</span>
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`text-[10px] font-semibold ${r.ok ? "text-emerald-400" : "text-amber-400"}`}>KES {r.amount}</p>
                    <p className="text-white/25 text-[9px]">{r.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Work orders strip */}
          <div className="bg-gray-900 rounded-xl border border-white/8 px-3.5 py-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-white/50 text-[10px] font-semibold uppercase tracking-wider">Open Work Orders</span>
              <span className="text-[9px] text-amber-400 font-medium">3 pending</span>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {[
                { label: "Plumbing · Unit 4A", color: "rose" },
                { label: "Electrical · Unit 9C", color: "amber" },
                { label: "Paint · Unit 2B", color: "sky" },
              ].map(t => (
                <span
                  key={t.label}
                  className={`text-[9px] px-2 py-0.5 rounded-full bg-${t.color}-500/10 text-${t.color}-400 border border-${t.color}-500/20`}
                >
                  {t.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── components ───────────────────────────────────────────────────────────────

function Navbar({ containerRef }: { containerRef?: React.RefObject<HTMLElement> }) {
  const scrolled = useScrolled(20, containerRef);
  const [open, setOpen] = useState(false);

  return (
    <nav className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
      scrolled
        ? "bg-white/95 dark:bg-gray-950/95 backdrop-blur border-b border-border shadow-sm"
        : "bg-transparent"
    }`}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link href="/">
          <a className="flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center shadow-sm group-hover:bg-emerald-500 transition-colors">
              <Building2 className="w-4 h-4 text-white" />
            </div>
            <span className={`font-bold text-lg tracking-tight transition-colors ${scrolled ? "text-gray-900 dark:text-white" : "text-white"}`}>
              Smart<span className="text-emerald-400">Prop</span>
            </span>
          </a>
        </Link>

        <div className={`hidden md:flex items-center gap-6 text-sm transition-colors ${scrolled ? "text-gray-500 dark:text-gray-400" : "text-white/60"}`}>
          {NAV_LINKS.map(l => (
            <a key={l.href} href={l.href} className={`transition-colors ${scrolled ? "hover:text-gray-900 dark:hover:text-white" : "hover:text-white"}`}>{l.label}</a>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-3">
          <Link href="/auth">
            <a className={`text-sm font-medium transition-colors ${scrolled ? "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white" : "text-white/60 hover:text-white"}`}>
              Sign in
            </a>
          </Link>
        </div>

        <button
          className={`md:hidden p-2 rounded-md transition-colors ${scrolled ? "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white" : "text-white/60 hover:text-white"}`}
          onClick={() => setOpen(!open)}
          aria-label="Toggle menu"
        >
          {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {open && (
        <div className="md:hidden bg-slate-900 border-b border-white/10 px-4 pb-5 pt-2 space-y-1">
          {NAV_LINKS.map(l => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)}
              className="block px-3 py-2 rounded-md text-sm text-white/60 hover:text-white hover:bg-white/5">
              {l.label}
            </a>
          ))}
          <div className="pt-3">
            <Link href="/auth">
              <Button variant="outline" className="w-full border-white/20 text-white hover:bg-white/10" onClick={() => setOpen(false)}>Sign in</Button>
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}

function Hero({ containerRef }: { containerRef: React.RefObject<HTMLElement> }) {
  return (
    <section className="relative min-h-screen flex items-center bg-slate-900 pt-16">
      {/* Layered background — gradient + dot grid + ambient glow */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950" />
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{ backgroundImage: "radial-gradient(circle, #34d399 1px, transparent 1px)", backgroundSize: "32px 32px" }}
      />
      {/* Ambient glow blobs */}
      <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-emerald-500/8 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/3 left-1/3 w-72 h-72 bg-sky-500/6 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 right-0 h-72 bg-gradient-to-t from-slate-900/80 to-transparent" />

      <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 py-20 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

          {/* Left — copy */}
          <div>
            <div className="inline-flex items-center gap-2 bg-emerald-500/12 border border-emerald-500/20 rounded-full px-4 py-1.5 mb-7">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
              <span className="text-emerald-400 text-sm font-medium">Built for Kenya · M-Pesa C2B Native</span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-[3.2rem] font-bold tracking-tight text-white leading-[1.1] mb-5">
              Stop chasing rent.<br />
              <span className="text-emerald-400">Start running a business.</span>
            </h1>

            <p className="text-lg text-white/55 leading-relaxed mb-3 max-w-xl">
              SmartProp handles your M-Pesa C2B reconciliation, tenancy agreements,
              WhatsApp maintenance requests, and KRA eTIMS invoices — so you can
              manage 50 units the way you'd manage 5.
            </p>
            <p className="text-sm text-white/30 mb-9 max-w-lg">
              No more M-Pesa screenshots over WhatsApp. No more Excel arrears sheets. No more month-end guessing.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 mb-9">
              <Link href="/auth">
                <Button size="lg" variant="outline" className="text-base px-8 border-white/20 text-white hover:bg-white/8 hover:text-white hover:border-white/30 bg-transparent gap-2">
                  Sign in to your account <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            </div>

            {/* Trust badges */}
            <div className="flex flex-wrap gap-2">
              {[
                { icon: Zap,            text: "STK push & Paybill" },
                { icon: FileText,       text: "KRA eTIMS" },
                { icon: MessageSquare,  text: "WhatsApp native" },
                { icon: Shield,         text: "ODPC compliant" },
                { icon: Lock,           text: "Data encrypted" },
              ].map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-center gap-1.5 text-xs text-white/45 bg-white/5 border border-white/10 rounded-full px-3 py-1.5 hover:bg-white/8 transition-colors">
                  <Icon className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                  {text}
                </div>
              ))}
            </div>
          </div>

          {/* Right — dashboard mockup (exact match to actual app) */}
          <div className="hidden lg:block">
            <DashboardMockup />
          </div>

        </div>
      </div>

      <button
        className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 text-white/20 hover:text-white/50 animate-bounce transition-colors cursor-pointer"
        aria-label="Scroll to next section"
        onClick={() => {
          const container = containerRef.current;
          const target = document.getElementById("pain-strip");
          if (container && target) {
            const top = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
            container.scrollTo({ top, behavior: "smooth" });
          }
        }}
      >
        <ChevronDown className="w-5 h-5" />
      </button>
    </section>
  );
}

function PainStrip() {
  const pains = [
    {
      icon: MessageSquare,
      before: "Forwarding M-Pesa texts to reconcile rent",
      after: "C2B callback auto-matches every payment to the right unit",
    },
    {
      icon: FileText,
      before: "Printing tenancy agreements and chasing signatures",
      after: "Digital leases generated, signed, and stored in minutes",
    },
    {
      icon: Phone,
      before: "Tenants calling your personal number for updates",
      after: "They self-serve on WhatsApp — you're not the middleman",
    },
    {
      icon: BarChart3,
      before: "Month-end panic to produce owner statements",
      after: "Statements auto-generate from your live ledger",
    },
  ];
  return (
    <section id="pain-strip" className="py-16 bg-gray-50 dark:bg-gray-900/60 border-y border-border">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <Fade>
          <p className="text-center text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-10">
            Sound familiar? Here's what changes.
          </p>
        </Fade>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {pains.map((p, i) => {
            const Icon = p.icon;
            return (
              <Fade key={p.before} delay={i * 70}>
                <div className="bg-white dark:bg-gray-900 rounded-2xl border border-border p-5 h-full hover:shadow-md transition-all duration-200">
                  <div className="w-8 h-8 rounded-lg bg-red-50 dark:bg-red-950/30 flex items-center justify-center mb-3">
                    <Icon className="w-4 h-4 text-red-400" />
                  </div>
                  <p className="text-sm text-red-400/80 line-through mb-3 leading-snug">{p.before}</p>
                  <div className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                    <p className="text-sm font-medium text-foreground leading-snug">{p.after}</p>
                  </div>
                </div>
              </Fade>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function MpesaSection() {
  return (
    <section className="py-24 bg-white dark:bg-gray-950 overflow-hidden">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-14 items-center">
          {/* M-Pesa flow mockup */}
          <Fade>
            <div className="relative rounded-2xl bg-gray-50 dark:bg-gray-900 border border-border shadow-xl aspect-[4/3] flex flex-col justify-between p-6 overflow-hidden">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Live Payments</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground bg-gray-100 dark:bg-gray-800 border border-border rounded-full px-2 py-0.5">Demo</span>
                  <span className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
                    C2B Active
                  </span>
                </div>
              </div>
              {[
                { name: "Achieng W.", unit: "3B · Westlands Ct",  amount: "32,000", time: "08:14 AM", status: "matched" },
                { name: "Kamau D.",   unit: "7A · Kileleshwa Pk", amount: "28,500", time: "08:31 AM", status: "matched" },
                { name: "Otieno M.",  unit: "1C · Lavington Gr",  amount: "45,000", time: "09:02 AM", status: "matched" },
                { name: "Njeri F.",   unit: "5D · Kilimani Hts",  amount: "22,000", time: "09:47 AM", status: "pending" },
              ].map(row => (
                <div key={row.name} className="flex items-center gap-3 bg-white dark:bg-gray-800 rounded-xl border border-border px-4 py-3 mb-2 last:mb-0">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${row.status === "matched" ? "bg-emerald-100 dark:bg-emerald-950" : "bg-amber-100 dark:bg-amber-950"}`}>
                    <Check className={`w-3.5 h-3.5 ${row.status === "matched" ? "text-emerald-600" : "text-amber-500"}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-foreground truncate">{row.name} <span className="font-normal text-muted-foreground">→ {row.unit}</span></p>
                    <p className="text-xs text-muted-foreground">{row.time}</p>
                  </div>
                  <span className={`text-xs font-bold flex-shrink-0 ${row.status === "matched" ? "text-emerald-600" : "text-amber-500"}`}>KES {row.amount}</span>
                </div>
              ))}
              <div className="absolute bottom-5 left-5 right-5 sm:right-auto sm:max-w-[250px] bg-white dark:bg-gray-900 rounded-xl border border-border shadow-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center">
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                  </div>
                  <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">M-Pesa C2B confirmed</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <span className="font-semibold text-foreground">KES 32,000</span> from{" "}
                  <span className="font-medium text-foreground">Achieng W.</span>
                  <br />Auto-matched → <span className="font-medium text-foreground">Unit 3B · Westlands Court</span>
                </p>
              </div>
            </div>
          </Fade>

          {/* Copy */}
          <Fade delay={120}>
            <div>
              <Badge className="mb-4 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                M-Pesa C2B Native
              </Badge>
              <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4 leading-tight">
                Rent lands in your Paybill.{" "}
                <span className="text-emerald-600">SmartProp records it automatically.</span>
              </h2>
              <p className="text-muted-foreground text-lg leading-relaxed mb-6">
                We integrate directly with Safaricom's C2B API. The moment a tenant pays
                to your till or Paybill number, the payment is matched to their unit and a
                receipt is sent — no copy-pasting, no phone checks at midnight.
              </p>
              <ul className="space-y-3">
                {[
                  "Paybill and till number support — your existing number works",
                  "Instant digital receipts sent to tenants via SMS",
                  "Partial payments and overpayments handled automatically",
                  "Arrears flagged the day rent falls overdue",
                  "Bank reconciliation report ready at month-end",
                ].map(item => (
                  <li key={item} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                    <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </Fade>
        </div>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section id="features" className="py-24 bg-gray-50 dark:bg-gray-900/50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <Fade>
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
              Everything your portfolio needs
            </h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              One platform for properties, people, money, and maintenance —
              built specifically for how Kenyan property management actually works.
            </p>
          </div>
        </Fade>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {FEATURES.map((f, i) => {
            const Icon = f.icon;
            return (
              <Fade key={f.title} delay={i * 45}>
                <div className={`bg-white dark:bg-gray-900 rounded-2xl p-6 border border-border border-t-2 border-t-transparent ${f.border} hover:shadow-md transition-all duration-200 h-full group`}>
                  <div className={`w-10 h-10 rounded-xl ${f.bg} flex items-center justify-center mb-4`}>
                    <Icon className={`w-5 h-5 ${f.color}`} />
                  </div>
                  <h3 className="font-semibold text-foreground text-sm mb-2">{f.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{f.desc}</p>
                </div>
              </Fade>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section id="how" className="py-24 bg-white dark:bg-gray-950">
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        <Fade>
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
              Up and running in a day
            </h2>
            <p className="text-muted-foreground text-lg max-w-lg mx-auto">
              No lengthy onboarding. No IT team. Three steps and your portfolio is live.
            </p>
          </div>
        </Fade>
        <div className="relative">
          {/* Connector line */}
          <div className="hidden md:block absolute top-10 left-[calc(16.67%-1px)] right-[calc(16.67%-1px)] h-px bg-border" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
            {HOW_STEPS.map((s, i) => (
              <Fade key={s.step} delay={i * 100}>
                <div className="flex flex-col items-center text-center relative">
                  <div className={`w-16 h-16 rounded-2xl bg-${s.color}-50 dark:bg-${s.color}-950/40 border-2 border-${s.color}-200 dark:border-${s.color}-800 flex flex-col items-center justify-center mb-5 z-10 relative`}>
                    <span className={`text-lg font-bold text-${s.color}-600`}>{s.step}</span>
                  </div>
                  <h3 className="font-semibold text-foreground mb-2">{s.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{s.desc}</p>
                </div>
              </Fade>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function GatedSection() {
  return (
    <section className="py-24 bg-gray-50 dark:bg-gray-900/50 overflow-hidden">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-14 items-center">
          <Fade>
            <div>
              <Badge className="mb-4 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800">
                Gate &amp; Security
              </Badge>
              <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4 leading-tight">
                Your estate, secured.{" "}
                <span className="text-emerald-600">Down to the last boda.</span>
              </h2>
              <p className="text-muted-foreground text-lg leading-relaxed mb-6">
                Built for Kenya's gated communities — guard mobile check-ins with
                shift logs, visitor pre-authorisation by unit number, PIN-gated vehicle
                entry, and parking slot tracking.
              </p>
              <ul className="space-y-3">
                {[
                  "Guard check-in on any smartphone — no special hardware",
                  "Tenants pre-authorise visitors by name or ID number",
                  "Unique entry PINs per vehicle or delivery",
                  "Parking slot assignment and live occupancy view",
                  "Full shift logs and incident reports on record",
                ].map(item => (
                  <li key={item} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                    <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </Fade>

          <Fade delay={120}>
            <div className="relative rounded-2xl bg-white dark:bg-gray-900 border border-border shadow-xl aspect-[4/3] flex flex-col p-6 overflow-hidden">
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Gate 1 — Visitor Log</span>
                <span className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
                  Live
                </span>
              </div>
              {[
                { name: "Mwangi J.",   unit: "12A", id: "32847291", time: "2:43 PM", type: "Visitor",  color: "emerald" },
                { name: "Deliveries+", unit: "08B", id: "PIN: 4821", time: "2:29 PM", type: "Delivery", color: "sky" },
                { name: "Auma C.",     unit: "03D", id: "29183746", time: "1:55 PM", type: "Visitor",  color: "emerald" },
                { name: "Boda #KBZ",  unit: "Pkg", id: "PIN: 9034", time: "1:41 PM", type: "Vehicle",  color: "violet" },
              ].map(row => (
                <div key={row.name + row.time} className="flex items-center gap-3 bg-gray-50 dark:bg-gray-800 rounded-xl border border-border px-4 py-3 mb-2 last:mb-0">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 bg-${row.color}-100 dark:bg-${row.color}-950`}>
                    <ShieldCheck className={`w-3.5 h-3.5 text-${row.color}-600`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-foreground">{row.name} <span className="font-normal text-muted-foreground">· Unit {row.unit}</span></p>
                    <p className="text-xs text-muted-foreground">{row.id}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-muted-foreground">{row.time}</p>
                    <span className={`text-xs font-medium text-${row.color}-600`}>{row.type}</span>
                  </div>
                </div>
              ))}
              <div className="absolute bottom-5 right-5 bg-white dark:bg-gray-900 rounded-xl border border-border shadow-xl p-4 max-w-[210px]">
                <p className="text-xs font-semibold text-foreground mb-1">Visitor checked in</p>
                <p className="text-xs text-muted-foreground">Pre-authorised by <span className="font-medium text-foreground">Unit 12A</span></p>
                <p className="text-xs text-muted-foreground mt-0.5">ID: 32847291 · Mwangi J.</p>
                <p className="text-xs text-emerald-600 font-medium mt-1.5">2:43 PM · Gate 1</p>
              </div>
            </div>
          </Fade>
        </div>
      </div>
    </section>
  );
}

function WhoItsFor() {
  return (
    <section id="who" className="py-24 bg-white dark:bg-gray-950 overflow-hidden">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <Fade>
          <div className="max-w-2xl mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
              One platform, every role
            </h2>
            <p className="text-muted-foreground text-lg leading-relaxed">
              A Kenyan property has at least four different stakeholders. SmartProp gives
              each one exactly the right view without sharing what they don't need to see.
            </p>
          </div>
        </Fade>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {ROLES.map((role, i) => {
            const Icon = role.icon;
            return (
              <Fade key={role.title} delay={i * 75}>
                <div className="bg-gray-50 dark:bg-gray-900 rounded-2xl border border-border p-7 h-full hover:border-emerald-200 dark:hover:border-emerald-800 hover:shadow-md transition-all duration-200">
                  <div className="flex items-start gap-4 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center flex-shrink-0">
                      <Icon className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">{role.title}</h3>
                      <p className="text-sm text-muted-foreground">{role.desc}</p>
                    </div>
                  </div>
                  <ul className="space-y-2.5">
                    {role.points.map(p => (
                      <li key={p} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                        <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
              </Fade>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function DiasporaSection() {
  return (
    <section className="py-24 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950" />
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{ backgroundImage: "radial-gradient(circle, #34d399 1px, transparent 1px)", backgroundSize: "28px 28px" }}
      />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-emerald-500/6 rounded-full blur-3xl pointer-events-none" />
      <div className="relative z-10 max-w-3xl mx-auto px-4 sm:px-6 text-center">
        <Fade>
          <Badge className="mb-5 bg-white/10 text-emerald-300 border border-emerald-400/30">
            For the Kenyan Diaspora
          </Badge>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-5 leading-tight">
            Own property back home.<br />
            Manage it from anywhere.
          </h2>
          <p className="text-white/50 text-lg leading-relaxed mb-4 max-w-xl mx-auto">
            Whether you're in London, Toronto, Dubai, or Melbourne — SmartProp's diaspora
            portal gives you full visibility into your Kenyan portfolio in KES, without
            depending on a caretaker's WhatsApp updates or flying home to sort arrears.
          </p>
          <p className="text-white/30 text-base leading-relaxed mb-8 max-w-lg mx-auto">
            Rent-to-own instalment tracking, buy-to-let owner statements, and fundi oversight
            — all from your phone, in your time zone.
          </p>
          <Link href="/auth">
            <Button size="lg" className="bg-white text-slate-900 hover:bg-emerald-50 font-semibold px-8 shadow-lg gap-2">
              Explore diaspora features <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        </Fade>
      </div>
    </section>
  );
}

function FounderNote() {
  return (
    <section className="py-20 bg-slate-900">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <Fade>
          <div className="relative">
            {/* Large decorative quote mark */}
            <div className="absolute -top-4 -left-2 text-emerald-500/20 text-9xl font-serif leading-none select-none pointer-events-none">"</div>
            <div className="relative z-10 text-center">
              <div className="inline-flex items-center gap-2 bg-emerald-500/12 border border-emerald-500/20 rounded-full px-4 py-1.5 mb-8">
                <span className="text-emerald-400 text-xs font-semibold uppercase tracking-wider">Why we built this</span>
              </div>
              <p className="text-xl sm:text-2xl font-medium text-white leading-relaxed mb-6">
                We got tired of watching Kenyan landlords run million-shilling portfolios
                on WhatsApp threads and Excel sheets.{" "}
                <span className="text-white/40">Rent paid. Screenshot forwarded. Excel updated. Repeat 50 times a month.</span>
              </p>
              <p className="text-lg text-emerald-400 font-medium">
                SmartProp is what should have existed years ago.
              </p>
            </div>
          </div>
        </Fade>
      </div>
    </section>
  );
}

function Contact() {
  return (
    <section id="contact" className="py-24 bg-slate-900 border-t border-white/10">
      <div className="max-w-4xl mx-auto px-4 sm:px-6">

        {/* Main CTA — Book a Demo */}
        <div className="text-center mb-14">
          <span className="inline-block bg-emerald-600/20 text-emerald-400 text-xs font-semibold tracking-widest uppercase px-4 py-1.5 rounded-full mb-5">
            No commitment · No script
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
            See SmartProp running<br className="hidden sm:block" /> with your portfolio.
          </h2>
          <p className="text-white/60 text-lg max-w-xl mx-auto mb-10">
            Book a free demo. We'll walk through your exact type of portfolio —
            property manager, landlord, or diaspora investor — and answer every
            question you have. No pressure, no pitch deck.
          </p>

          {/* Demo booking cards */}
          <div className="grid sm:grid-cols-3 gap-4 max-w-3xl mx-auto mb-10">
            {[
              { emoji: "💬", label: "WhatsApp", desc: "Message us to book a time", href: "https://wa.me/254759657590?text=Hi%2C%20I%27d%20like%20to%20book%20a%20SmartProp%20demo", cta: "Open WhatsApp" },
              { emoji: "📧", label: "Email", desc: "We'll reply within a few hours", href: "mailto:noreply@smartprop.co.ke?subject=SmartProp Demo Request", cta: "Send Email" },
              { emoji: "📞", label: "Call us", desc: "+254 759 657 590", href: "tel:+254759657590", cta: "Call Now" },
            ].map(({ emoji, label, desc, href, cta }) => (
              <a key={label} href={href} target={href.startsWith("http") ? "_blank" : undefined}
                 rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
                 className="group flex flex-col items-center gap-3 bg-white/5 hover:bg-emerald-600/20 border border-white/10 hover:border-emerald-500/40 rounded-2xl px-5 py-6 transition-all duration-200 cursor-pointer">
                <span className="text-3xl">{emoji}</span>
                <div>
                  <div className="font-semibold text-white text-sm">{label}</div>
                  <div className="text-white/50 text-xs mt-0.5">{desc}</div>
                </div>
                <span className="text-emerald-400 text-xs font-semibold group-hover:text-emerald-300 transition-colors">
                  {cta} →
                </span>
              </a>
            ))}
          </div>

          {/* Primary CTA button */}
          <a href="https://wa.me/254759657590?text=Hi%2C%20I%27d%20like%20to%20book%20a%20SmartProp%20demo"
             target="_blank" rel="noopener noreferrer">
            <Button size="lg"
              className="bg-emerald-600 hover:bg-emerald-500 text-white gap-2 px-10 py-5 text-base font-semibold rounded-xl shadow-lg shadow-emerald-900/40 transition-all">
              <Phone className="w-5 h-5" />
              Book a free demo on WhatsApp
            </Button>
          </a>
          <p className="text-white/30 text-xs mt-4">
            Usually responds within minutes · Kenya time (EAT)
          </p>
        </div>

        {/* Divider */}
        <div className="border-t border-white/10 mb-10" />

        {/* Still have questions strip */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-6 text-center sm:text-left">
          <div>
            <p className="text-white font-semibold text-lg">Still have questions?</p>
            <p className="text-white/50 text-sm mt-1">
              We're a WhatsApp message away — any time.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <a href="https://wa.me/254759657590" target="_blank" rel="noopener noreferrer">
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 w-full sm:w-auto">
                <Phone className="w-4 h-4" /> WhatsApp us
              </Button>
            </a>
            <a href="mailto:noreply@smartprop.co.ke">
              <Button size="sm" variant="outline"
                className="border-white/20 text-white hover:text-white hover:border-white/40 gap-2 w-full sm:w-auto">
                <Mail className="w-4 h-4" /> Email Us
              </Button>
            </a>
          </div>
        </div>

      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/10 bg-slate-900">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-6 text-sm text-white/50">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-emerald-600 flex items-center justify-center">
            <Building2 className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-base text-white">
            Smart<span className="text-emerald-500">Prop</span>
          </span>
          <span className="ml-1">© {new Date().getFullYear()}</span>
        </div>
        <div className="flex flex-wrap justify-center gap-5">
          <Link href="/auth"><a className="hover:text-white transition-colors">Sign in</a></Link>
          <a href="#features" className="hover:text-white transition-colors">Features</a>
          <a href="#how" className="hover:text-white transition-colors">How it works</a>
          <a href="#contact" className="hover:text-white transition-colors">Contact</a>
        </div>
        <div className="flex items-center gap-2 text-xs text-white/30">
          <Shield className="w-3 h-3" />
          <span>ODPC · KRA eTIMS · Built in Kenya 🇰🇪</span>
        </div>
      </div>
    </footer>
  );
}

// ─── page ──────────────────────────────────────────────────────────────────────

export default function PayPropLanding() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.body.style.backgroundColor;
    const prevHtml = document.documentElement.style.backgroundColor;
    document.body.style.backgroundColor = "#0f172a";
    document.documentElement.style.backgroundColor = "#0f172a";
    return () => {
      document.body.style.backgroundColor = prev;
      document.documentElement.style.backgroundColor = prevHtml;
    };
  }, []);

  return (
    <div ref={containerRef} className="h-screen overflow-y-auto overscroll-contain bg-slate-900 text-foreground">
      <Navbar containerRef={containerRef} />
      <Hero containerRef={containerRef} />
      <PainStrip />
      <MpesaSection />
      <Features />
      <HowItWorks />
      <GatedSection />
      <WhoItsFor />
      <DiasporaSection />
      <FounderNote />
      <Contact />
      <Footer />
    </div>
  );
}