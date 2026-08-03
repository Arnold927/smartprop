/**
 * payprop-landing.tsx — SmartProp public landing page (v3)
 *
 * Rewrite goals:
 *  - All 8 roles represented: Admin, Manager, Landlord, Staff,
 *    Caretaker, Tenant, Guard, Contractor
 *  - Stronger Kenya-specific hero headline
 *  - Guard & Caretaker explicitly called out in WhoItsFor
 *  - More specific "How it works" steps
 *  - Tighter, more credible copy throughout
 *
 * No mention of KRA or specific tax authorities anywhere on this page —
 * deliberate: could be misread as government affiliation and cost trust
 * with prospective clients. Compliance features still exist in-app for
 * signed-up customers; this page just doesn't lead with them.
 */

import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Building2, Users, Wrench, ShieldCheck, MessageSquare,
  BarChart3, CreditCard, Globe, Menu, X,
  Check, Phone, Mail, ArrowRight, Zap,
  Lock, Home, Smartphone, ChevronDown,
  FileText, Bell, Shield, DollarSign, LayoutDashboard,
  TrendingUp, Settings, HardHat, UserCheck,
  ClipboardList, Receipt, Scale, Camera,
  Landmark, AlertTriangle, UserCog,
} from "lucide-react";

// ─── hooks ─────────────────────────────────────────────────────────────────

function useScrolled(t = 20, containerRef?: React.RefObject<HTMLElement>) {
  const [s, set] = useState(false);
  useEffect(() => {
    const el = containerRef?.current ?? window;
    const h = () => {
      const top = containerRef?.current
        ? containerRef.current.scrollTop
        : window.scrollY;
      set(top > t);
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

function Fade({ children, className = "", delay = 0 }: {
  children: React.ReactNode; className?: string; delay?: number;
}) {
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

// ─── data ──────────────────────────────────────────────────────────────────

const NAV_LINKS = [
  { label: "Features",     href: "#features" },
  { label: "How it works", href: "#how" },
  { label: "Who it's for", href: "#who" },
  { label: "Records",      href: "#compliance" },
  { label: "Contact",      href: "#contact" },
  { label: "Find a Stay",  href: "/stays" },
];

const FEATURES = [
  {
    icon: CreditCard, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-950/30",
    border: "hover:border-t-emerald-500",
    title: "M-Pesa C2B Auto-Reconciliation",
    desc: "Tenants pay to your Paybill or till. SmartProp receives the C2B callback from Safaricom and matches it to the right unit automatically — no copy-pasting, no midnight phone checks.",
  },
  {
    icon: Building2, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-950/30",
    border: "hover:border-t-blue-500",
    title: "Property & Unit Management",
    desc: "Bedsitters, one-bedrooms, maisonettes, commercial stalls. Set up your full portfolio with floor plans, unit types, and per-property service charge rules.",
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
    desc: "Tenants report issues over WhatsApp. You assign a fundi, track progress, close the ticket with a photo. The full job history stays on record per unit.",
  },
  {
    icon: ShieldCheck, color: "text-rose-600", bg: "bg-rose-50 dark:bg-rose-950/30",
    border: "hover:border-t-rose-500",
    title: "Gate & Security Management",
    desc: "Guard mobile check-ins, visitor pre-authorisation by unit, QR code entry passes, vehicle blacklist, and parking management — built for Kenya's gated estates.",
  },
  {
    icon: BarChart3, color: "text-teal-600", bg: "bg-teal-50 dark:bg-teal-950/30",
    border: "hover:border-t-teal-500",
    title: "Finance & Owner Statements",
    desc: "Full double-entry ledger, owner disbursement statements, bank reconciliation, utility billing, and service charge accounts — with PDF and CSV export.",
  },
  {
    icon: Scale, color: "text-indigo-600", bg: "bg-indigo-50 dark:bg-indigo-950/30",
    border: "hover:border-t-indigo-500",
    title: "M-Pesa Payment Automation",
    desc: "STK Push and Paybill/Till reconciliation matched automatically to the right tenant and invoice. Per-landlord payment configuration for multi-owner portfolios — no manual matching, ever.",
  },
  {
    icon: Globe, color: "text-sky-600", bg: "bg-sky-50 dark:bg-sky-950/30",
    border: "hover:border-t-sky-500",
    title: "Diaspora Rent-to-Own Portal",
    desc: "Kenyans in London, Toronto, Dubai, and Melbourne manage their back-home portfolios in KES — instalment tracking, construction photos, and ownership certificates.",
  },
];

// All 8 roles — no one left out
const ROLES = [
  {
    icon: UserCog,
    title: "Property Managers & Admins",
    tag: "Full command",
    tagColor: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
    points: [
      "All properties, units, leases, and finances in one view",
      "Multi-property and multi-landlord support with full audit trail",
      "Assign roles, manage staff access, and control permissions",
      "Digital leases, document storage, and audit-ready records for every unit",
    ],
  },
  {
    icon: Landmark,
    title: "Landlords & Owners",
    tag: "Your money, clearly",
    tagColor: "bg-sky-500/15 text-sky-400 border-sky-500/25",
    points: [
      "Read-only portal showing your properties and income only",
      "Auto-generated disbursement statements every month",
      "Real-time M-Pesa payment visibility — no waiting for reports",
      "No software knowledge needed — just a phone and a login",
    ],
  },
  {
    icon: Home,
    title: "Tenants",
    tag: "Zero friction",
    tagColor: "bg-violet-500/15 text-violet-400 border-violet-500/25",
    points: [
      "Pay rent via M-Pesa STK push in one tap — no Paybill to remember",
      "Raise maintenance requests with photos directly from the portal",
      "Download receipts, view lease, and pre-authorise visitors",
      "WhatsApp updates for every payment and maintenance update",
    ],
  },
  {
    icon: ClipboardList,
    title: "Operations Staff",
    tag: "Daily ops",
    tagColor: "bg-amber-500/15 text-amber-400 border-amber-500/25",
    points: [
      "Dedicated staff portal — no access to financials or owner data",
      "Manage tenant relations, maintenance assignments, and prospects",
      "View unit occupancy and letting pipeline across properties",
      "Role-scoped so staff see only what they need to",
    ],
  },
  {
    icon: HardHat,
    title: "Caretakers",
    tag: "On-site control",
    tagColor: "bg-orange-500/15 text-orange-400 border-orange-500/25",
    points: [
      "Manage maintenance tickets and work orders from site",
      "Visitor management and guard check-in from a smartphone",
      "Upload construction progress photos for diaspora owners",
      "Daily property checks logged and accessible to managers",
    ],
  },
  {
    icon: Shield,
    title: "Security Guards",
    tag: "Gate ready",
    tagColor: "bg-rose-500/15 text-rose-400 border-rose-500/25",
    points: [
      "Dedicated guard portal — opens on any smartphone, no app install",
      "Scan visitor QR codes pre-authorised by tenants",
      "Check vehicles against the blacklist in real time",
      "Every entry and exit logged with timestamp automatically",
    ],
  },
  {
    icon: Globe,
    title: "Diaspora Buyers",
    tag: "Manage from abroad",
    tagColor: "bg-teal-500/15 text-teal-400 border-teal-500/25",
    points: [
      "Track rent-to-own instalments in GBP, USD, AED, CAD, or EUR",
      "View construction progress photos uploaded by the on-site caretaker",
      "Receive a QR-verified digital ownership certificate on completion",
      "Full portfolio visibility from any time zone — no caretaker calls",
    ],
  },
  {
    icon: Wrench,
    title: "Contractors & Fundis",
    tag: "Your jobs, clear",
    tagColor: "bg-lime-500/15 text-lime-400 border-lime-500/25",
    points: [
      "Dedicated fundi portal to view all assigned work orders",
      "Upload completion photos and close tickets directly from site",
      "Message the property manager without sharing personal numbers",
      "Full job history per property for invoicing and dispute resolution",
    ],
  },
];

const HOW_STEPS = [
  {
    step: "01",
    icon: Building2,
    title: "Set up your portfolio in minutes",
    desc: "Add your properties, units, and landlords. SmartProp structures any layout — bedsitters, flats, commercial, gated estates. No consultant, no IT team.",
    color: "emerald",
    detail: "Most managers are fully set up within a single working day.",
  },
  {
    step: "02",
    icon: Users,
    title: "Onboard tenants, assign staff & guards",
    desc: "Create tenant profiles, generate digital leases, and assign roles to your staff, caretaker, and guards. Each person gets exactly the access they need — nothing more.",
    color: "sky",
    detail: "Role permissions are pre-configured. No manual setup per person.",
  },
  {
    step: "03",
    icon: CreditCard,
    title: "Connect M-Pesa and go live",
    desc: "Link your existing Paybill or till number. From that moment, every tenant payment is received, matched to the right unit, receipted, and reconciled — automatically.",
    color: "violet",
    detail: "Your existing Paybill works. Nothing changes for your tenants.",
  },
];

const COMPLIANCE_MODULES = [
  {
    icon: Landmark,
    title: "Security Deposit Tracking",
    desc: "Deposits held, interest accrued, and end-of-tenancy settlements calculated automatically — shown on every tenant statement, no spreadsheet required.",
    color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-950/30",
  },
  {
    icon: FileText,
    title: "Digital Lease Lifecycle",
    desc: "Generate, sign, and store leases digitally. Renewal reminders fire automatically before expiry, and every signed document lives in one searchable vault.",
    color: "text-indigo-600", bg: "bg-indigo-50 dark:bg-indigo-950/30",
  },
  {
    icon: TrendingUp,
    title: "Portfolio Analytics",
    desc: "Occupancy, arrears, and performance across your entire portfolio — or drilled down to a single property — in one live dashboard.",
    color: "text-violet-600", bg: "bg-violet-50 dark:bg-violet-950/30",
  },
  {
    icon: UserCheck,
    title: "Caretaker & Staff Roles",
    desc: "On-site caretakers and staff get access scoped to exactly their assigned property — nothing more. Assign, reassign, or disable access in seconds.",
    color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-950/30",
  },
  {
    icon: Bell,
    title: "Automated Rent Reminders",
    desc: "WhatsApp nudges before rent is due and again if it's late — before an arrears conversation ever needs to happen.",
    color: "text-sky-600", bg: "bg-sky-50 dark:bg-sky-950/30",
  },
  {
    icon: Scale,
    title: "Audit-Ready Records",
    desc: "Every payment, maintenance job, and lease change is logged with a timestamp and an owner. Produce a full history for any unit in seconds.",
    color: "text-rose-600", bg: "bg-rose-50 dark:bg-rose-950/30",
  },
];

// ─── Dashboard mockup ──────────────────────────────────────────────────────

function DashboardMockup() {
  const sidebarItems = [
    { icon: LayoutDashboard, label: "Dashboard",   active: true },
    { icon: Home,            label: "Properties",  active: false },
    { icon: Users,           label: "Tenants",     active: false },
    { icon: DollarSign,      label: "Finances",    active: false },
    { icon: Wrench,          label: "Maintenance", active: false, badge: "!" },
    { icon: BarChart3,       label: "Reports",     active: false },
    { icon: Scale,           label: "Compliance",  active: false },
    { icon: Settings,        label: "Settings",    active: false },
  ];

  const kpis = [
    { label: "Total Properties", value: "12",       sub: "Managed properties",   color: "sky" },
    { label: "Occupied Units",   value: "47/52",    sub: "90% occupancy",        color: "emerald" },
    { label: "Pending Requests", value: "3",         sub: "Maintenance open",     color: "amber" },
    { label: "Monthly Revenue",  value: "KES 1.4M", sub: "Collected this month", color: "emerald" },
  ];

  const payments = [
    { name: "Achieng W.",  unit: "3B · Westlands Ct",  amount: "32,000", time: "08:14", ok: true },
    { name: "Kamau D.",    unit: "7A · Kileleshwa Pk", amount: "28,500", time: "08:31", ok: true },
    { name: "Otieno M.",   unit: "1C · Lavington Gr",  amount: "45,000", time: "09:02", ok: true },
    { name: "Njeri F.",    unit: "5D · Kilimani Hts",  amount: "22,000", time: "09:47", ok: false },
  ];

  return (
    <div className="rounded-2xl overflow-hidden border border-white/10 shadow-2xl shadow-black/60 bg-gray-950 ring-1 ring-white/5">
      <div className="flex items-center gap-1.5 px-4 py-3 bg-gray-900/80 border-b border-white/10">
        <span className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
        <span className="w-2.5 h-2.5 rounded-full bg-amber-500/70" />
        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/70" />
        <span className="ml-3 text-[11px] text-white/25 font-mono">smartprop.co.ke/dashboard</span>
      </div>

      <div className="flex" style={{ height: "420px" }}>
        <div className="w-40 bg-slate-900 border-r border-slate-800 flex flex-col p-3 gap-0.5 flex-shrink-0">
          <div className="flex items-center gap-2 px-2 py-2.5 mb-2">
            <div className="w-6 h-6 rounded-md bg-emerald-600 flex items-center justify-center shadow-sm flex-shrink-0">
              <Building2 className="w-3.5 h-3.5 text-white" />
            </div>
            <div>
              <span className="text-white text-[11px] font-bold leading-none">SmartProp</span>
              <p className="text-slate-400 text-[9px] leading-none mt-0.5">Property Mgmt</p>
            </div>
          </div>
          {sidebarItems.map(({ icon: Icon, label, active, badge }: any) => (
            <div
              key={label}
              className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-[11px] transition-colors relative ${
                active ? "bg-emerald-600 text-white shadow-sm" : "text-slate-400"
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

        <div className="flex-1 bg-gray-950 p-4 overflow-hidden flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/80 text-sm font-semibold">Dashboard</p>
              <p className="text-white/30 text-[10px]">Good morning · May 2026</p>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-6 h-6 rounded-md bg-gray-800 border border-white/10 flex items-center justify-center">
                <Bell className="w-3 h-3 text-white/40" />
              </div>
              <div className="w-6 h-6 rounded-full bg-emerald-700 flex items-center justify-center text-white text-[10px] font-bold">A</div>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {kpis.map(k => (
              <div key={k.label} className="bg-gray-900 rounded-xl p-2.5 border border-white/8">
                <p className="text-white/35 text-[9px] mb-1 leading-tight">{k.label}</p>
                <p className={`text-[13px] font-bold text-${k.color}-400 leading-none`}>{k.value}</p>
                <p className="text-white/25 text-[9px] mt-1 leading-tight">{k.sub}</p>
              </div>
            ))}
          </div>

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

// ─── Navbar ────────────────────────────────────────────────────────────────

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

// ─── Hero ──────────────────────────────────────────────────────────────────

function Hero({ containerRef }: { containerRef: React.RefObject<HTMLElement> }) {
  return (
    <section className="relative min-h-screen flex items-center bg-slate-900 pt-16">
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950" />
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{ backgroundImage: "radial-gradient(circle, #34d399 1px, transparent 1px)", backgroundSize: "32px 32px" }}
      />
      <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-emerald-500/8 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/3 left-1/3 w-72 h-72 bg-sky-500/6 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 right-0 h-72 bg-gradient-to-t from-slate-900/80 to-transparent" />

      <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 py-20 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

          <div>
            <div className="inline-flex items-center gap-2 bg-emerald-500/12 border border-emerald-500/20 rounded-full px-4 py-1.5 mb-7">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
              <span className="text-emerald-400 text-sm font-medium">Built for Kenya · M-Pesa C2B Native</span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-[3.2rem] font-bold tracking-tight text-white leading-[1.1] mb-5">
              Every Paybill payment.<br />
              Every WhatsApp request.<br />
              <span className="text-emerald-400">Every property, one place.</span>
            </h1>

            <p className="text-lg text-white/55 leading-relaxed mb-3 max-w-xl">
              SmartProp handles your M-Pesa C2B reconciliation, digital leases,
              WhatsApp maintenance, gate security, and owner
              statements — so your whole team runs from a single system, not a
              group of WhatsApp threads.
            </p>
            <p className="text-sm text-white/30 mb-9 max-w-lg">
              Built specifically for Kenyan property management. Not adapted. Not translated. Built here, for here.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 mb-9">
              <Link href="/auth">
                <Button size="lg" variant="outline" className="text-base px-8 border-white/20 text-white hover:bg-white/8 hover:text-white hover:border-white/30 bg-transparent gap-2">
                  Sign in to your account <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
              <a href="#contact">
                <Button size="lg" className="text-base px-8 bg-emerald-600 hover:bg-emerald-500 text-white gap-2">
                  Book a free demo
                </Button>
              </a>
            </div>

            <div className="flex flex-wrap gap-2">
              {[
                { icon: Zap,           text: "STK push & Paybill" },
                { icon: Scale,         text: "Digital leases" },
                { icon: MessageSquare, text: "WhatsApp native" },
                { icon: Shield,        text: "ODPC compliant" },
                { icon: Lock,          text: "Data encrypted" },
                { icon: UserCheck,     text: "8 role types" },
              ].map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-center gap-1.5 text-xs text-white/45 bg-white/5 border border-white/10 rounded-full px-3 py-1.5 hover:bg-white/8 transition-colors">
                  <Icon className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                  {text}
                </div>
              ))}
            </div>
          </div>

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

// ─── Pain Strip ────────────────────────────────────────────────────────────

function PainStrip() {
  const pains = [
    {
      icon: MessageSquare,
      before: "Forwarding M-Pesa texts to reconcile rent in Excel",
      after: "C2B callback auto-matches every payment to the right unit",
    },
    {
      icon: FileText,
      before: "Printing tenancy agreements and chasing wet signatures",
      after: "Digital leases generated, signed, and stored in minutes",
    },
    {
      icon: Phone,
      before: "Tenants calling your personal number for every update",
      after: "They self-serve on WhatsApp — you're not the middleman",
    },
    {
      icon: BarChart3,
      before: "Month-end panic assembling owner statements from M-Pesa logs",
      after: "Statements auto-generate from your live double-entry ledger",
    },
    {
      icon: Scale,
      before: "Digging through paper files when a record is needed urgently",
      after: "Every payment and document searchable, in seconds",
    },
    {
      icon: Shield,
      before: "Guard writing visitor names in a physical book at the gate",
      after: "QR code entry — pre-authorised by the tenant, scanned by the guard",
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {pains.map((p, i) => {
            const Icon = p.icon;
            return (
              <Fade key={p.before} delay={i * 60}>
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

// ─── M-Pesa Section ────────────────────────────────────────────────────────

function MpesaSection() {
  return (
    <section className="py-24 bg-white dark:bg-gray-950 overflow-hidden">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-14 items-center">

          <Fade>
            <div className="relative rounded-2xl bg-gray-50 dark:bg-gray-900 border border-border shadow-xl aspect-[4/3] flex flex-col justify-between p-6 overflow-hidden">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Live Payments</span>
                <span className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
                  C2B Active
                </span>
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
              <div className="absolute bottom-5 right-5 bg-white dark:bg-gray-900 rounded-xl border border-border shadow-xl p-4 max-w-[220px]">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center">
                    <Check className="w-3 h-3 text-emerald-600" />
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
                to your till or Paybill number, the payment is matched to their unit, a
                receipt is generated, and arrears are cleared — no copy-pasting, no
                phone checks, no midnight spreadsheet sessions.
              </p>
              <ul className="space-y-3">
                {[
                  "Your existing Paybill or till number works — nothing changes for tenants",
                  "STK Push for manager-initiated payment requests",
                  "Partial payments and overpayments handled automatically",
                  "Instant digital receipts sent to tenants via WhatsApp",
                  "Arrears flagged automatically the day rent falls overdue",
                  "Bank reconciliation report ready at month-end, one click",
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

// ─── Features ──────────────────────────────────────────────────────────────

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
              One platform for properties, people, money, maintenance, compliance, and security —
              built specifically for how Kenyan property management actually works.
            </p>
          </div>
        </Fade>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {FEATURES.map((f, i) => {
            const Icon = f.icon;
            return (
              <Fade key={f.title} delay={i * 45}>
                <div className={`bg-white dark:bg-gray-900 rounded-2xl p-6 border border-border border-t-2 border-t-transparent ${f.border} hover:shadow-md transition-all duration-200 h-full`}>
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

// ─── How it works ──────────────────────────────────────────────────────────

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
              No consultant. No IT team. No lengthy onboarding process.
              Three steps and your whole team is live.
            </p>
          </div>
        </Fade>
        <div className="relative">
          <div className="hidden md:block absolute top-10 left-[calc(16.67%-1px)] right-[calc(16.67%-1px)] h-px bg-border" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
            {HOW_STEPS.map((s, i) => {
              const Icon = s.icon;
              return (
                <Fade key={s.step} delay={i * 100}>
                  <div className="flex flex-col items-center text-center relative">
                    <div className={`w-16 h-16 rounded-2xl bg-${s.color}-50 dark:bg-${s.color}-950/40 border-2 border-${s.color}-200 dark:border-${s.color}-800 flex flex-col items-center justify-center mb-5 z-10 relative`}>
                      <span className={`text-lg font-bold text-${s.color}-600`}>{s.step}</span>
                    </div>
                    <div className={`w-8 h-8 rounded-lg bg-${s.color}-50 dark:bg-${s.color}-950/30 flex items-center justify-center mb-3`}>
                      <Icon className={`w-4 h-4 text-${s.color}-600`} />
                    </div>
                    <h3 className="font-semibold text-foreground mb-2">{s.title}</h3>
                    <p className="text-muted-foreground text-sm leading-relaxed mb-3">{s.desc}</p>
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium italic">{s.detail}</p>
                  </div>
                </Fade>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Gate Section ──────────────────────────────────────────────────────────

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
                Your guards run on smartphones.{" "}
                <span className="text-emerald-600">No special hardware. No app install.</span>
              </h2>
              <p className="text-muted-foreground text-lg leading-relaxed mb-6">
                Built specifically for Kenya's gated communities and managed estates.
                Guards get a dedicated mobile portal. Tenants pre-authorise visitors with
                a QR pass. Managers see every entry and exit in real time.
              </p>
              <ul className="space-y-3">
                {[
                  "Guard check-in portal opens on any smartphone browser — zero setup",
                  "Tenants pre-authorise visitors by name, ID, and arrival window",
                  "Visitors receive a QR code by email — guard scans to admit",
                  "Vehicle blacklist checked in real time at the gate",
                  "Parking slot assignment and live occupancy view",
                  "Full shift logs, incident reports, and audit trail on record",
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
                { name: "Mwangi J.",   unit: "12A", id: "ID: 32847291", time: "2:43 PM", type: "Visitor",  color: "emerald" },
                { name: "Deliveries+", unit: "08B", id: "PIN: 4821",    time: "2:29 PM", type: "Delivery", color: "sky"     },
                { name: "Auma C.",     unit: "03D", id: "ID: 29183746", time: "1:55 PM", type: "Visitor",  color: "emerald" },
                { name: "Boda #KBZ",  unit: "Pkg", id: "PIN: 9034",    time: "1:41 PM", type: "Vehicle",  color: "violet"  },
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
                <p className="text-xs font-semibold text-foreground mb-1">Visitor checked in ✓</p>
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

// ─── Who It's For — All 8 roles ────────────────────────────────────────────

function WhoItsFor() {
  return (
    <section id="who" className="py-24 bg-white dark:bg-gray-950">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <Fade>
          <div className="max-w-2xl mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
              One system, every person on your estate
            </h2>
            <p className="text-muted-foreground text-lg leading-relaxed">
              A managed property in Kenya has at least eight different stakeholders.
              SmartProp gives each one their own view with exactly the right access —
              and nothing they shouldn't see.
            </p>
          </div>
        </Fade>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {ROLES.map((role, i) => {
            const Icon = role.icon;
            return (
              <Fade key={role.title} delay={i * 55}>
                <div className="bg-gray-50 dark:bg-gray-900 rounded-2xl border border-border p-6 h-full hover:border-emerald-200 dark:hover:border-emerald-800 hover:shadow-md transition-all duration-200 flex flex-col">
                  <div className="flex items-start gap-3 mb-4">
                    <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center flex-shrink-0">
                      <Icon className="w-4 h-4 text-emerald-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground text-sm leading-tight">{role.title}</h3>
                      <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full border mt-1 ${role.tagColor}`}>
                        {role.tag}
                      </span>
                    </div>
                  </div>
                  <ul className="space-y-2 flex-1">
                    {role.points.map(p => (
                      <li key={p} className="flex items-start gap-2 text-xs text-muted-foreground">
                        <Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0 mt-0.5" />
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

// ─── Compliance Section ────────────────────────────────────────────────────

function ComplianceSection() {
  return (
    <section id="compliance" className="py-24 bg-gray-50 dark:bg-gray-900/50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <Fade>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-14 items-start mb-16">
            <div>
              <Badge className="mb-4 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
                Everything In One System
              </Badge>
              <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4 leading-tight">
                Month-end is no longer{" "}
                <span className="text-emerald-600">a scramble.</span>
              </h2>
              <p className="text-muted-foreground text-lg leading-relaxed mb-4">
                SmartProp keeps every payment, lease, and maintenance record organised
                from the moment it happens — not bolted on afterwards, but built into
                every transaction from day one.
              </p>
              <p className="text-muted-foreground text-base leading-relaxed">
                No separate spreadsheet for deposits. No manual reconciliation.
                No scramble assembling records at month-end. Everything is
                maintained in real time and ready the moment you need it.
              </p>
            </div>
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-border p-6 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">Everything tracked automatically</p>
              <div className="space-y-2.5">
                {[
                  { label: "M-Pesa Reconciliation",      status: "Matched on every transaction" },
                  { label: "Security Deposits",          status: "Interest accrued automatically" },
                  { label: "Digital Leases",             status: "Signed & stored per unit" },
                  { label: "Owner Statements",            status: "Auto-generated monthly" },
                  { label: "Maintenance History",        status: "Photo trail per job" },
                  { label: "Staff & Caretaker Access",    status: "Scoped per property" },
                  { label: "Visitor & Gate Logs",         status: "Timestamped & searchable" },
                ].map(item => (
                  <div key={item.label} className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-0">
                    <div className="flex items-center gap-2.5">
                      <div className="w-4 h-4 rounded-full bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center flex-shrink-0">
                        <Check className="w-2.5 h-2.5 text-emerald-600" />
                      </div>
                      <span className="text-sm font-medium text-foreground">{item.label}</span>
                    </div>
                    <span className="text-xs text-muted-foreground text-right flex-shrink-0">{item.status}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Fade>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {COMPLIANCE_MODULES.map((m, i) => {
            const Icon = m.icon;
            return (
              <Fade key={m.title} delay={i * 55}>
                <div className="bg-white dark:bg-gray-900 rounded-2xl border border-border p-6 hover:shadow-md transition-all duration-200 h-full">
                  <div className={`w-10 h-10 rounded-xl ${m.bg} flex items-center justify-center mb-4`}>
                    <Icon className={`w-5 h-5 ${m.color}`} />
                  </div>
                  <h3 className="font-semibold text-foreground text-sm mb-2">{m.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{m.desc}</p>
                </div>
              </Fade>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─── Diaspora Section ──────────────────────────────────────────────────────

function DiasporaSection() {
  return (
    <section className="py-24 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950" />
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{ backgroundImage: "radial-gradient(circle, #34d399 1px, transparent 1px)", backgroundSize: "28px 28px" }}
      />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-emerald-500/6 rounded-full blur-3xl pointer-events-none" />
      <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-14 items-center">
          <Fade>
            <div>
              <Badge className="mb-5 bg-white/10 text-emerald-300 border border-emerald-400/30">
                For the Kenyan Diaspora
              </Badge>
              <h2 className="text-3xl sm:text-4xl font-bold text-white mb-5 leading-tight">
                Own property back home.<br />
                Manage it from anywhere.
              </h2>
              <p className="text-white/55 text-lg leading-relaxed mb-4">
                Whether you're in London, Toronto, Dubai, or Melbourne — SmartProp's diaspora
                portal gives you full visibility into your Kenyan portfolio in KES, without
                depending on a caretaker's WhatsApp updates or flying home to sort arrears.
              </p>
              <ul className="space-y-3 mb-8">
                {[
                  "Track rent-to-own instalments in GBP, USD, AED, CAD, or EUR",
                  "Construction progress photos uploaded by on-site caretaker — visible to you instantly",
                  "QR-verified digital ownership certificate issued on contract completion",
                  "Full portfolio visibility — income, payments, expenses — any time zone",
                  "Integrated with Flutterwave, Stripe, WorldRemit, and Western Union",
                ].map(item => (
                  <li key={item} className="flex items-center gap-2.5 text-sm text-white/60">
                    <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <a href="#contact">
                <Button size="lg" className="bg-white text-slate-900 hover:bg-emerald-50 font-semibold px-8 shadow-lg gap-2">
                  Explore diaspora features <ArrowRight className="w-4 h-4" />
                </Button>
              </a>
            </div>
          </Fade>

          <Fade delay={120}>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "London, UK", flag: "🇬🇧", desc: "Instalment payments in GBP, portfolio in KES" },
                { label: "Toronto, CA", flag: "🇨🇦", desc: "CAD payments, live rent statements" },
                { label: "Dubai, UAE", flag: "🇦🇪", desc: "AED converted at live rates per payment" },
                { label: "Melbourne, AU", flag: "🇦🇺", desc: "Construction photos from your caretaker" },
                { label: "London → Nairobi", flag: "🏠", desc: "QR ownership certificate on completion" },
                { label: "Any time zone", flag: "🌍", desc: "Full portfolio dashboard, no phone calls needed" },
              ].map(item => (
                <div key={item.label} className="bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/8 transition-colors">
                  <div className="text-2xl mb-2">{item.flag}</div>
                  <p className="text-white text-sm font-semibold mb-1">{item.label}</p>
                  <p className="text-white/40 text-xs leading-snug">{item.desc}</p>
                </div>
              ))}
            </div>
          </Fade>
        </div>
      </div>
    </section>
  );
}

// ─── Founder Note ──────────────────────────────────────────────────────────

function FounderNote() {
  return (
    <section className="py-20 bg-slate-900">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <Fade>
          <div className="relative">
            <div className="absolute -top-4 -left-2 text-emerald-500/20 text-9xl font-serif leading-none select-none pointer-events-none">"</div>
            <div className="relative z-10 text-center">
              <div className="inline-flex items-center gap-2 bg-emerald-500/12 border border-emerald-500/20 rounded-full px-4 py-1.5 mb-8">
                <span className="text-emerald-400 text-xs font-semibold uppercase tracking-wider">Why we built this</span>
              </div>
              <p className="text-xl sm:text-2xl font-medium text-white leading-relaxed mb-6">
                We got tired of watching Kenyan landlords run million-shilling portfolios
                on WhatsApp threads and Excel sheets.{" "}
                <span className="text-white/40">
                  Rent paid. Screenshot forwarded. Excel updated. Guard writing names in a book.
                  Month-end arriving with no records pulled together. Repeat every month.
                </span>
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

// ─── Contact ───────────────────────────────────────────────────────────────

function Contact() {
  return (
    <section id="contact" className="py-24 bg-slate-900 border-t border-white/10">
      <div className="max-w-4xl mx-auto px-4 sm:px-6">

        <div className="text-center mb-14">
          <span className="inline-block bg-emerald-600/20 text-emerald-400 text-xs font-semibold tracking-widest uppercase px-4 py-1.5 rounded-full mb-5">
            No commitment · No pitch deck
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
            See SmartProp running<br className="hidden sm:block" /> with your portfolio.
          </h2>
          <p className="text-white/60 text-lg max-w-xl mx-auto mb-10">
            Book a free demo. We'll walk through your exact setup —
            property manager, landlord, gated estate, or diaspora investor —
            and answer every question you have. No pressure.
          </p>

          <div className="grid sm:grid-cols-3 gap-4 max-w-3xl mx-auto mb-10">
            {[
              { emoji: "💬", label: "WhatsApp", desc: "Message us to book a time", href: "https://wa.me/254759657590?text=Hi%2C%20I%27d%20like%20to%20book%20a%20SmartProp%20demo", cta: "Open WhatsApp" },
              { emoji: "📧", label: "Email", desc: "We'll reply within a few hours", href: "mailto:noreply@smartprop.co.ke?subject=SmartProp Demo Request", cta: "Send Email" },
              { emoji: "📞", label: "Call us", desc: "+254 759 657 590", href: "tel:+254759657590", cta: "Call Now" },
            ].map(({ emoji, label, desc, href, cta }) => (
              <a key={label} href={href}
                target={href.startsWith("http") ? "_blank" : undefined}
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

          <a href="https://wa.me/254759657590?text=Hi%2C%20I%27d%20like%20to%20book%20a%20SmartProp%20demo"
            target="_blank" rel="noopener noreferrer">
            <Button size="lg"
              className="bg-emerald-600 hover:bg-emerald-500 text-white gap-2 px-10 py-5 text-base font-semibold rounded-xl shadow-lg shadow-emerald-900/40 transition-all">
              <Phone className="w-5 h-5" />
              Book a free demo on WhatsApp
            </Button>
          </a>
          <p className="text-white/30 text-xs mt-4">Usually responds within minutes · Kenya time (EAT)</p>
        </div>

        <div className="border-t border-white/10 mb-10" />

        <div className="flex flex-col sm:flex-row items-center justify-between gap-6 text-center sm:text-left">
          <div>
            <p className="text-white font-semibold text-lg">Still have questions?</p>
            <p className="text-white/50 text-sm mt-1">We're a WhatsApp message away — any time.</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <a href="https://wa.me/254759657590" target="_blank" rel="noopener noreferrer">
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 w-full sm:w-auto">
                <Phone className="w-4 h-4" /> WhatsApp us
              </Button>
            </a>
            <a href="mailto:noreply@smartprop.co.ke">
              <Button size="sm" className="bg-transparent border border-white/30 text-white hover:bg-white/10 hover:border-white/50 gap-2 w-full sm:w-auto">
                <Mail className="w-4 h-4" /> Email us
              </Button>
            </a>
          </div>
        </div>

      </div>
    </section>
  );
}

// ─── Footer ────────────────────────────────────────────────────────────────

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
          <a href="#features"    className="hover:text-white transition-colors">Features</a>
          <a href="#how"         className="hover:text-white transition-colors">How it works</a>
          <a href="#who"         className="hover:text-white transition-colors">Who it's for</a>
          <a href="#compliance"  className="hover:text-white transition-colors">Records</a>
          <a href="#contact"     className="hover:text-white transition-colors">Contact</a>
        </div>
        <div className="flex items-center gap-2 text-xs text-white/30">
          <Shield className="w-3 h-3" />
          <span>ODPC compliant · Built in Kenya 🇰🇪</span>
        </div>
      </div>
    </footer>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────

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
      <ComplianceSection />
      <DiasporaSection />
      <FounderNote />
      <Contact />
      <Footer />
    </div>
  );
}