/**
 * first-run-overlay.tsx
 *
 * A role-aware welcome overlay shown exactly once per user per browser.
 * Persistence is keyed by `sp_first_run_done_<userId>` in localStorage so it
 * survives page refreshes but clears if the user switches browsers or devices
 * (intentional — a new device is a new session worth welcoming).
 *
 * Each role gets:
 *   - A personalised greeting in the header
 *   - 3–4 step cards describing what they'll find and what to do first
 *   - A single "Get started" CTA that dismisses the overlay
 *
 * Roles handled:
 *   admin / manager  →  ManagerWelcome  (quick-setup prompt if no properties yet)
 *   landlord         →  LandlordWelcome
 *   staff            →  StaffWelcome    (position-aware subtitle)
 *   contractor       →  ContractorWelcome
 *
 * Tenant has its own deeper TenantOnboardingFlow (4-step wizard with phone
 * verification) and is NOT handled here.
 *
 * Usage:
 *   <FirstRunOverlay
 *     userId={user.id}
 *     role="manager"
 *     firstName="David"
 *     hasProperties={false}       // only relevant for manager role
 *     staffPosition="Technician"  // only relevant for staff role
 *     onDismiss={() => void}
 *   />
 *
 * Helper exports:
 *   needsFirstRun(userId)  → boolean
 *   markFirstRunDone(userId)
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard, Building2, Users, DollarSign, Wrench,
  FileText, Shield, ArrowRight, CheckCircle, Briefcase,
  ClipboardList, MessageSquare, Bell, Star, Receipt,
  ChevronRight, X,
} from "lucide-react";

// ── Persistence ───────────────────────────────────────────────────────────────

export function needsFirstRun(userId: number | string): boolean {
  try {
    return localStorage.getItem(`sp_first_run_done_${userId}`) !== "1";
  } catch {
    return false;
  }
}

export function markFirstRunDone(userId: number | string) {
  try {
    localStorage.setItem(`sp_first_run_done_${userId}`, "1");
  } catch { /* ignore */ }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type FirstRunRole = "admin" | "manager" | "landlord" | "staff" | "contractor";

interface Props {
  userId: number | string;
  role: FirstRunRole;
  firstName?: string;
  /** Manager only: skip quick-setup prompt when they already have properties */
  hasProperties?: boolean;
  /** Staff only: shown as subtitle under greeting */
  staffPosition?: string;
  onDismiss: () => void;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StepCard({
  icon: Icon,
  label,
  description,
  accent,
}: {
  icon: any;
  label: string;
  description: string;
  accent: string;
}) {
  return (
    <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-muted/40 border border-border">
      <div
        className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${accent}`}
      >
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground leading-tight">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

function InfoRow({ icon: Icon, text }: { icon: any; text: string }) {
  return (
    <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
      <Icon className="w-4 h-4 flex-shrink-0 text-emerald-500" />
      <span>{text}</span>
    </div>
  );
}

// ── Role-specific content ─────────────────────────────────────────────────────

function ManagerWelcome({
  firstName,
  hasProperties,
  onDismiss,
}: {
  firstName: string;
  hasProperties: boolean;
  onDismiss: () => void;
}) {
  const [, navigate] = useLocation();

  return (
    <>
      {/* Icon */}
      <div className="w-16 h-16 lg:w-20 lg:h-20 rounded-2xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-5">
        <LayoutDashboard className="w-8 h-8 lg:w-10 lg:h-10 text-emerald-600" />
      </div>

      {/* Greeting */}
      <div className="text-center mb-6">
        <h2 className="text-xl lg:text-2xl font-semibold text-foreground">
          Welcome to SmartProp{firstName ? `, ${firstName}` : ""}
        </h2>
        <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
          Your full property management suite is ready. Here's what you'll find — and what to do first.
        </p>
      </div>

      {/* Steps */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5 mb-6">
        <StepCard
          icon={Building2}
          label="1. Add a property"
          description="Start by adding your building — name, address, and how many units it has."
          accent="bg-blue-50 dark:bg-blue-950/60 text-blue-600"
        />
        <StepCard
          icon={FileText}
          label="2. Add units"
          description="Open the property and add individual units (e.g. A1, 101). Tenants are assigned to a unit, not the property directly."
          accent="bg-violet-50 dark:bg-violet-950/60 text-violet-600"
        />
        <StepCard
          icon={Users}
          label="3. Onboard tenants"
          description="Once units exist, assign tenants to them — generating a lease and activating rent collection."
          accent="bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600"
        />
        <StepCard
          icon={DollarSign}
          label="Finances & M-Pesa"
          description="Collect rent via M-Pesa STK push, track arrears, manage expenses, and generate owner statements."
          accent="bg-amber-50 dark:bg-amber-950/60 text-amber-600"
        />
        <StepCard
          icon={Wrench}
          label="Maintenance & contractors"
          description="Receive repair requests, assign work orders to vetted contractors, and close tickets with photos."
          accent="bg-purple-50 dark:bg-purple-950/60 text-purple-600"
        />
      </div>

      {/* Setup prompt if no properties yet */}
      {!hasProperties && (
        <div className="mb-5 p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 flex items-start gap-3">
          <Bell className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-200">
              You have no properties yet
            </p>
            <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-0.5 leading-relaxed">
              The setup wizard will walk you through adding your first property and its units. Tenants can only be assigned to a unit — so units come first.
            </p>
          </div>
        </div>
      )}

      {/* Units reminder for users who already have properties */}
      {hasProperties && (
        <div className="mb-4 p-3 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 flex items-start gap-2.5">
          <Building2 className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-blue-800 dark:text-blue-200 leading-relaxed">
            <span className="font-semibold">Remember:</span> Add units to a property before onboarding tenants — tenants are assigned to a specific unit.
          </p>
        </div>
      )}

      {/* CTA */}
      {!hasProperties ? (
        <div className="space-y-2">
          <Button
            className="w-full h-11 rounded-xl text-sm font-medium"
            onClick={() => { markFirstRunDone("_"); onDismiss(); navigate("/quick-setup"); }}
          >
            Run setup wizard <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
          <button
            onClick={onDismiss}
            className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
          >
            Skip — take me to the dashboard
          </button>
        </div>
      ) : (
        <Button
          className="w-full h-11 rounded-xl text-sm font-medium"
          onClick={onDismiss}
        >
          Go to dashboard <CheckCircle className="w-4 h-4 ml-1.5" />
        </Button>
      )}
    </>
  );
}

function LandlordWelcome({
  firstName,
  onDismiss,
}: {
  firstName: string;
  onDismiss: () => void;
}) {
  return (
    <>
      <div className="w-16 h-16 lg:w-20 lg:h-20 rounded-2xl bg-blue-500/10 flex items-center justify-center mx-auto mb-5">
        <Building2 className="w-8 h-8 lg:w-10 lg:h-10 text-blue-600" />
      </div>

      <div className="text-center mb-6">
        <h2 className="text-xl lg:text-2xl font-semibold text-foreground">
          Your portfolio{firstName ? `, ${firstName}` : ""}
        </h2>
        <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
          Here's your owner portal — a live view of your entire property portfolio.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5 mb-6">
        <StepCard
          icon={LayoutDashboard}
          label="Portfolio dashboard"
          description="See occupancy rates, monthly revenue, net income, and year-to-date trends at a glance."
          accent="bg-blue-50 dark:bg-blue-950/60 text-blue-600"
        />
        <StepCard
          icon={Receipt}
          label="Owner statements"
          description="Download monthly income statements per property. Forward them directly to your accountant."
          accent="bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600"
        />
        <StepCard
          icon={Wrench}
          label="Maintenance visibility"
          description="See all open repair requests across your properties and approve costs above your threshold."
          accent="bg-amber-50 dark:bg-amber-950/60 text-amber-600"
        />
        <StepCard
          icon={Shield}
          label="KRA & compliance"
          description="Track rental income returns, eTIMS invoices, and stamp duty obligations in one place."
          accent="bg-purple-50 dark:bg-purple-950/60 text-purple-600"
        />
      </div>

      <div className="space-y-2 mb-5">
        <InfoRow icon={Bell} text="You'll get notified when rent is received or a repair needs approval." />
        <InfoRow icon={MessageSquare} text="Message your property manager directly from the portal." />
      </div>

      <Button className="w-full h-11 rounded-xl text-sm font-medium" onClick={onDismiss}>
        View my portfolio <CheckCircle className="w-4 h-4 ml-1.5" />
      </Button>
    </>
  );
}

function StaffWelcome({
  firstName,
  staffPosition,
  onDismiss,
}: {
  firstName: string;
  staffPosition: string;
  onDismiss: () => void;
}) {
  // Derive a friendly role description from the position string
  const isMaintenanceRole = /technician|maintenance|janitor|groundskeeper|facilities/i.test(staffPosition);
  const isSecurityRole = /security|guard|concierge/i.test(staffPosition);
  const isFinanceRole = /accountant|finance|accounts/i.test(staffPosition);
  const isLeasingRole = /leasing|marketing|customer/i.test(staffPosition);

  const roleHint = isMaintenanceRole
    ? "Your work orders and assigned jobs are front and centre."
    : isSecurityRole
    ? "Your duty screen shows today's visitors, gate passes, and vehicle log."
    : isFinanceRole
    ? "Your view focuses on rent collection, arrears, and pending payment actions."
    : isLeasingRole
    ? "Your view shows tenant enquiries, unit availability, and broadcast messages."
    : "Your dashboard gives you an overview of all key operations.";

  return (
    <>
      <div className="w-16 h-16 lg:w-20 lg:h-20 rounded-2xl bg-slate-500/10 flex items-center justify-center mx-auto mb-5">
        <Briefcase className="w-8 h-8 text-slate-600 dark:text-slate-400" />
      </div>

      <div className="text-center mb-6">
        <h2 className="text-xl lg:text-2xl font-semibold text-foreground">
          Welcome{firstName ? `, ${firstName}` : ""}
        </h2>
        {staffPosition && (
          <p className="text-xs font-medium text-muted-foreground mt-1 capitalize">
            {staffPosition}
          </p>
        )}
        <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{roleHint}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5 mb-6">
        <StepCard
          icon={ClipboardList}
          label="Your work queue"
          description="Jobs and tasks assigned to you appear here. Update status as you go — the manager sees it live."
          accent="bg-amber-50 dark:bg-amber-950/60 text-amber-600"
        />
        <StepCard
          icon={MessageSquare}
          label="Messages"
          description="Communicate with your property manager or colleagues without leaving the app."
          accent="bg-blue-50 dark:bg-blue-950/60 text-blue-600"
        />
        <StepCard
          icon={Star}
          label="Your profile"
          description="Keep your contact details and department up to date so you receive the right notifications."
          accent="bg-purple-50 dark:bg-purple-950/60 text-purple-600"
        />
      </div>

      <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-border text-xs text-muted-foreground leading-relaxed mb-5">
        <span className="font-semibold text-foreground">Not seeing your role?</span>{" "}
        Ask your manager to update your job title in Staff Management — the portal adapts automatically.
      </div>

      <Button className="w-full h-11 rounded-xl text-sm font-medium" onClick={onDismiss}>
        Go to my dashboard <CheckCircle className="w-4 h-4 ml-1.5" />
      </Button>
    </>
  );
}

function ContractorWelcome({
  firstName,
  onDismiss,
}: {
  firstName: string;
  onDismiss: () => void;
}) {
  return (
    <>
      <div className="w-16 h-16 lg:w-20 lg:h-20 rounded-2xl bg-amber-500/10 flex items-center justify-center mx-auto mb-5">
        <Wrench className="w-8 h-8 text-amber-600" />
      </div>

      <div className="text-center mb-6">
        <h2 className="text-xl lg:text-2xl font-semibold text-foreground">
          Welcome{firstName ? `, ${firstName}` : ""}
        </h2>
        <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
          Your contractor portal shows every work order assigned to you and lets you update progress without a phone call.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5 mb-6">
        <StepCard
          icon={ClipboardList}
          label="Work orders"
          description="Accept or decline new jobs. Mark work in progress, then completed — with notes and photos."
          accent="bg-amber-50 dark:bg-amber-950/60 text-amber-600"
        />
        <StepCard
          icon={Receipt}
          label="Submit invoices"
          description="Once a job is complete, submit your invoice directly from the work order — no email needed."
          accent="bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600"
        />
        <StepCard
          icon={Star}
          label="Build your rating"
          description="Fast responses and quality work increase your rating, leading to more job assignments."
          accent="bg-blue-50 dark:bg-blue-950/60 text-blue-600"
        />
      </div>

      <div className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 mb-5">
        <Bell className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
          You'll receive a WhatsApp or email notification whenever a new work order is assigned to you.
        </p>
      </div>

      <Button className="w-full h-11 rounded-xl text-sm font-medium" onClick={onDismiss}>
        See my work orders <CheckCircle className="w-4 h-4 ml-1.5" />
      </Button>
    </>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function FirstRunOverlay({
  userId,
  role,
  firstName = "",
  hasProperties = true,
  staffPosition = "",
  onDismiss,
}: Props) {
  function handleDismiss() {
    markFirstRunDone(userId);
    onDismiss();
  }

  return (
    // Backdrop
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4 sm:p-6 lg:p-8">
      <div className="w-full max-w-sm sm:max-w-lg lg:max-w-2xl bg-background rounded-3xl shadow-2xl overflow-hidden">
        {/* Dismiss X */}
        <div className="flex justify-end px-5 sm:px-8 pt-5 sm:pt-6 pb-0">
          <button
            onClick={handleDismiss}
            className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            aria-label="Dismiss welcome screen"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="px-5 sm:px-8 lg:px-12 pb-6 sm:pb-8 overflow-y-auto max-h-[85vh]">
          {(role === "admin" || role === "manager") && (
            <ManagerWelcome
              firstName={firstName}
              hasProperties={hasProperties}
              onDismiss={handleDismiss}
            />
          )}
          {role === "landlord" && (
            <LandlordWelcome firstName={firstName} onDismiss={handleDismiss} />
          )}
          {role === "staff" && (
            <StaffWelcome
              firstName={firstName}
              staffPosition={staffPosition}
              onDismiss={handleDismiss}
            />
          )}
          {role === "contractor" && (
            <ContractorWelcome firstName={firstName} onDismiss={handleDismiss} />
          )}
        </div>
      </div>
    </div>
  );
}

export default FirstRunOverlay;