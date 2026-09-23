/**
 * quick-setup.tsx
 *
 * Post-onboarding "First 3 Steps" wizard.
 * Walks the manager through:
 *   Step 1 — Add your first property (manual form or skip)
 *   Step 2 — Add a unit to that property (same fields as AddUnitDialog)
 *   Step 3 — Preview a rent reminder (shows WhatsApp/SMS message preview)
 *
 * Tenant onboarding happens from the property/unit detail view once units exist.
 * The wizard can be dismissed at any time and revisited from the dashboard.
 */
import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Building2,
  Home,
  Bell,
  CheckCircle2,
  ChevronRight,
  SkipForward,
  Loader2,
  ArrowRight,
  Phone,
  MessageSquare,
  Plus,
  Trash2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { RESIDENTIAL_UNIT_TYPES, UNIT_TYPE_LABELS } from "@/components/add-unit-dialog";

// ─── Types ────────────────────────────────────────────────────────────────────

interface UnitFormData {
  unitNumber: string;
  unitType: string;
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  rentBasis: string;
  ratePerSqft: string;
  monthlyRent: string;
  currency: string;
  isOccupied: boolean;
}

const defaultUnit = (): UnitFormData => ({
  unitNumber: "",
  unitType: "apartment",
  bedrooms: 1,
  bathrooms: 1,
  sqft: 800,
  rentBasis: "fixed",
  ratePerSqft: "",
  monthlyRent: "",
  currency: "KSH",
  isOccupied: false,
});

// ─── Step indicator ──────────────────────────────────────────────────────────

function StepBadge({
  num,
  label,
  active,
  done,
}: {
  num: number;
  label: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 ${active ? "opacity-100" : "opacity-40"}`}>
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-semibold ${
          done
            ? "bg-green-500 text-white"
            : active
            ? "bg-blue-600 text-white"
            : "bg-slate-200 text-slate-500"
        }`}
      >
        {done ? <CheckCircle2 className="w-4 h-4" /> : num}
      </div>
      <span className={`text-sm font-medium ${active ? "text-slate-900" : "text-slate-400"}`}>
        {label}
      </span>
    </div>
  );
}

// ─── Unit form fields (mirrors AddUnitDialog fields exactly) ─────────────────

function UnitFields({
  data,
  onChange,
}: {
  data: UnitFormData;
  onChange: (updated: UnitFormData) => void;
}) {
  const isResidential = RESIDENTIAL_UNIT_TYPES.includes(data.unitType);

  const getBathroomsStringValue = (): string => {
    const value = data.bathrooms;
    if (value === 1.5) return "1.5";
    if (value === 2.5) return "2.5";
    if (value === 3.5) return "3.5";
    return value != null ? value.toString() : "1";
  };

  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="unitNumber" className="font-medium">
            Unit Number *
          </Label>
          <Input
            id="unitNumber"
            placeholder="e.g., 101, A1"
            value={data.unitNumber}
            onChange={(e) => onChange({ ...data, unitNumber: e.target.value })}
            className="border-border focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="monthlyRent" className="font-medium">
            Monthly Rent *
          </Label>
          <div className="flex">
            <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-border bg-muted text-sm">
              {data.currency === "KSH" ? "Ksh" : "$"}
            </span>
            <Input
              id="monthlyRent"
              type="number"
              placeholder="0.00"
              value={data.monthlyRent}
              onChange={(e) => onChange({ ...data, monthlyRent: e.target.value })}
              className="rounded-l-none border-border focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              min="0"
              step="0.01"
              required
            />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="font-medium">Unit Type *</Label>
        <Select
          value={data.unitType}
          onValueChange={(value) => onChange({ ...data, unitType: value })}
        >
          <SelectTrigger className="border-border focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500">
            <SelectValue placeholder="Select unit type" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(UNIT_TYPE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isResidential ? (
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label className="font-medium">Bedrooms</Label>
            <Select
              value={data.bedrooms.toString()}
              onValueChange={(value) => onChange({ ...data, bedrooms: parseInt(value) })}
            >
              <SelectTrigger className="border-border focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {[0, 1, 2, 3, 4, 5].map((num) => (
                  <SelectItem key={num} value={num.toString()}>
                    {num === 0 ? "Studio" : `${num} Bed${num !== 1 ? "s" : ""}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="font-medium">Bathrooms</Label>
            <Select
              value={getBathroomsStringValue()}
              onValueChange={(value) => onChange({ ...data, bathrooms: parseFloat(value) })}
            >
              <SelectTrigger className="border-border focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {[1, 1.5, 2, 2.5, 3, 3.5, 4].map((num) => (
                  <SelectItem key={num} value={num.toString()}>
                    {num} Bath{num !== 1 ? "s" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="font-medium">Square Feet</Label>
            <Input
              type="number"
              placeholder="800"
              value={data.sqft}
              onChange={(e) => onChange({ ...data, sqft: parseInt(e.target.value) || 0 })}
              className="border-border focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              min="0"
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="font-medium">Square Feet *</Label>
            <Input
              type="number"
              placeholder="800"
              value={data.sqft}
              onChange={(e) => onChange({ ...data, sqft: parseInt(e.target.value) || 0 })}
              className="border-border focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              min="0"
              required
            />
            <p className="text-xs text-muted-foreground">Used for per-sqft rent and pro-rata service charge billing.</p>
          </div>
          <div className="space-y-2">
            <Label className="font-medium">Rent Basis</Label>
            <Select
              value={data.rentBasis}
              onValueChange={(value) => onChange({ ...data, rentBasis: value })}
            >
              <SelectTrigger className="border-border focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed">Fixed monthly amount</SelectItem>
                <SelectItem value="per_sqft">Rate per sqft</SelectItem>
                <SelectItem value="percentage_of_sales">Percentage of sales (set on lease)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {!isResidential && data.rentBasis === "per_sqft" && (
        <div className="space-y-2">
          <Label className="font-medium">Rate per Sqft *</Label>
          <Input
            type="number"
            placeholder="e.g. 150"
            value={data.ratePerSqft}
            onChange={(e) => {
              const rate = e.target.value;
              const monthlyRent = (parseFloat(rate) || 0) * (data.sqft || 0);
              onChange({ ...data, ratePerSqft: rate, monthlyRent: monthlyRent ? monthlyRent.toString() : data.monthlyRent });
            }}
            className="border-border focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            min="0"
            step="0.01"
          />
          <p className="text-xs text-muted-foreground">Monthly rent is calculated automatically as rate × sqft — you can still adjust it above.</p>
        </div>
      )}

      <div className="space-y-2">
        <Label className="font-medium">Currency</Label>
        <Select
          value={data.currency}
          onValueChange={(value) => onChange({ ...data, currency: value })}
        >
          <SelectTrigger className="border-border focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500">
            <SelectValue placeholder="Select currency" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="KSH">Ksh (KE)</SelectItem>
            <SelectItem value="USD">USD ($)</SelectItem>
            <SelectItem value="EUR">EUR (€)</SelectItem>
            <SelectItem value="GBP">GBP (£)</SelectItem>
            <SelectItem value="CAD">CAD (C$)</SelectItem>
          </SelectContent>
        </Select>

      </div>

      <div className="flex items-center space-x-3 p-3 bg-muted rounded-lg">
        <input
          type="checkbox"
          id="isOccupied"
          checked={data.isOccupied}
          onChange={(e) => onChange({ ...data, isOccupied: e.target.checked })}
          className="h-5 w-5 rounded border-border text-blue-600 focus:ring-emerald-500"
        />
        <Label htmlFor="isOccupied" className="text-sm font-medium cursor-pointer">
          Mark as occupied
        </Label>
      </div>
    </div>
  );
}

// ─── Reminder preview ────────────────────────────────────────────────────────

function ReminderPreview({
  propertyName,
  unitNumber,
}: {
  propertyName: string;
  unitNumber: string;
}) {
  const property = propertyName || "Westlands Apartments";
  const unit = unitNumber || "A1";
  const dueDate = new Date();
  dueDate.setDate(1);
  dueDate.setMonth(dueDate.getMonth() + 1);
  const dueDateStr = dueDate.toLocaleDateString("en-KE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const message = `Dear Tenant,\n\nThis is a reminder that your rent for unit ${unit} at ${property} is due on ${dueDateStr}.\n\nPlease pay via M-Pesa Paybill 123456, Account: ${unit}.\n\nThank you,\n${property} Management`;

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
          <MessageSquare className="w-4 h-4 text-white" />
        </div>
        <div className="bg-[#DCF8C6] rounded-2xl rounded-tl-none px-4 py-3 max-w-sm shadow-sm">
          <p className="text-[13px] text-slate-800 whitespace-pre-line leading-relaxed">{message}</p>
          <div className="flex items-center justify-end gap-1 mt-1">
            <span className="text-[10px] text-slate-400">11:32</span>
            <span className="text-[10px] text-green-600">✓✓</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
        <Phone className="w-3.5 h-3.5" />
        <span>
          This reminder would be sent via WhatsApp and SMS to all tenants with unpaid rent.
        </span>
      </div>
    </div>
  );
}

// ─── Main wizard ──────────────────────────────────────────────────────────────

export default function QuickSetup() {
  const [step, setStep] = useState(1);
  const [doneSteps, setDoneSteps] = useState<Set<number>>(new Set());
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Step 1 — property
  const [propName, setPropName] = useState("");
  const [propAddress, setPropAddress] = useState("");
  const [propUnits, setPropUnits] = useState("10");
  const [propType, setPropType] = useState("residential");
  const [createdPropertyId, setCreatedPropertyId] = useState<number | null>(null);
  const [organizationId, setOrganizationId] = useState<number | null>(null);

  // Step 2 — units (support adding multiple before moving on)
  const [units, setUnits] = useState<UnitFormData[]>([defaultUnit()]);
  const [savedUnitNumbers, setSavedUnitNumbers] = useState<string[]>([]);

  // Step 3 — preview
  const [previewSent, setPreviewSent] = useState(false);

  // ── Mutations ────────────────────────────────────────────────────────────

  const createProperty = useMutation({
    mutationFn: async () =>
      apiRequest("/api/properties", {
        method: "POST",
        data: {
          name: propName,
          address: propAddress,
          totalUnits: parseInt(propUnits) || 1,
          propertyType: propType,
          description: "",
        },
      }),
    onSuccess: (data: any) => {
      setCreatedPropertyId(data?.id ?? null);
      setOrganizationId(data?.organizationId ?? null);
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      markDone(1);
      setStep(2);
      toast({ title: "Property added!", description: propName });
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const saveUnits = useMutation({
    mutationFn: async (unitsToSave: UnitFormData[]) => {
      const results = await Promise.all(
        unitsToSave.map((unit) => {
          const isResidential = RESIDENTIAL_UNIT_TYPES.includes(unit.unitType);
          return apiRequest("/api/units", {
            method: "POST",
            data: {
              propertyId: createdPropertyId,
              organizationId: organizationId,
              unitNumber: unit.unitNumber,
              unitType: unit.unitType,
              bedrooms: isResidential ? unit.bedrooms : null,
              bathrooms: isResidential ? unit.bathrooms.toString() : null,
              sqft: unit.sqft,
              rentBasis: unit.rentBasis,
              ratePerSqft: unit.rentBasis === "per_sqft" ? (parseFloat(unit.ratePerSqft) || 0) : null,
              monthlyRent: parseFloat(unit.monthlyRent).toString(),
              currency: unit.currency,
              isOccupied: unit.isOccupied,
            },
          });
        })
      );
      return results;
    },
    onSuccess: (_, unitsToSave) => {
      setSavedUnitNumbers(unitsToSave.map((u) => u.unitNumber));
      queryClient.invalidateQueries({
        queryKey: [`/api/properties/${createdPropertyId}/units`],
      });
      markDone(2);
      setStep(3);
      const count = unitsToSave.length;
      toast({
        title: `${count} unit${count !== 1 ? "s" : ""} added!`,
        description: unitsToSave.map((u) => u.unitNumber).join(", "),
      });
    },
    onError: (e: any) => {
      toast({ title: "Error saving units", description: e.message, variant: "destructive" });
    },
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  const markDone = (s: number) => setDoneSteps((prev) => new Set(prev).add(s));

  const updateUnit = (index: number, updated: UnitFormData) => {
    setUnits((prev) => prev.map((u, i) => (i === index ? updated : u)));
  };

  const addAnotherUnit = () => setUnits((prev) => [...prev, defaultUnit()]);

  const removeUnit = (index: number) =>
    setUnits((prev) => prev.filter((_, i) => i !== index));

  const canSaveUnits = units.every(
    (u) => u.unitNumber.trim() !== "" && u.monthlyRent.trim() !== ""
  );

  const handleGoToDashboard = () => {
    window.location.href = "/";
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      <div className="max-w-2xl mx-auto px-4 py-12">

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">Quick setup</h1>
              <p className="text-slate-500 text-sm mt-1">3 steps to send your first rent reminder</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleGoToDashboard}
              className="text-slate-500 gap-1"
            >
              Skip for now
              <SkipForward className="w-4 h-4" />
            </Button>
          </div>

          {/* Progress bar */}
          <div className="mt-6 flex items-center gap-3 flex-wrap">
            <StepBadge num={1} label="Add property" active={step === 1} done={doneSteps.has(1)} />
            <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0" />
            <StepBadge num={2} label="Add units" active={step === 2} done={doneSteps.has(2)} />
            <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0" />
            <StepBadge num={3} label="Preview reminder" active={step === 3} done={doneSteps.has(3)} />
          </div>
        </div>

        {/* ── STEP 1 — Property ───────────────────────────────────────────── */}
        {step === 1 && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                <Building2 className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h2 className="font-semibold text-slate-900">Add your first property</h2>
                <p className="text-sm text-slate-500">Just the basics — you can add details later</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Property name *</Label>
                <Input
                  value={propName}
                  onChange={(e) => setPropName(e.target.value)}
                  placeholder="e.g. Westlands Apartments"
                  className="h-11"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Address *</Label>
                <Input
                  value={propAddress}
                  onChange={(e) => setPropAddress(e.target.value)}
                  placeholder="e.g. Westlands Road, Nairobi"
                  className="h-11"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Number of units</Label>
                <Input
                  type="number"
                  value={propUnits}
                  onChange={(e) => setPropUnits(e.target.value)}
                  min="1"
                  className="h-11 w-32"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Property type</Label>
                <Select value={propType} onValueChange={setPropType}>
                  <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="residential">Residential (apartments, houses)</SelectItem>
                    <SelectItem value="commercial">Commercial (retail, office, mall)</SelectItem>
                    <SelectItem value="mixed_use">Mixed use (both)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-slate-500"
                onClick={() => { markDone(1); setStep(2); }}
              >
                Skip this step
              </Button>
              <Button
                onClick={() => createProperty.mutate()}
                disabled={!propName.trim() || !propAddress.trim() || createProperty.isPending}
                className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
              >
                {createProperty.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Save property
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {/* ── STEP 2 — Units ──────────────────────────────────────────────── */}
        {step === 2 && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center">
                <Home className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <h2 className="font-semibold text-slate-900">Add units</h2>
                <p className="text-sm text-slate-500">
                  {propName
                    ? `Add units to ${propName} — tenants are assigned to a unit, not a property directly.`
                    : "Add units to your property — tenants are assigned to a unit, not a property directly."}
                </p>
              </div>
            </div>

            {units.map((unit, index) => (
              <div
                key={index}
                className="relative border border-slate-200 rounded-xl p-5 space-y-5"
              >
                {units.length > 1 && (
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      Unit {index + 1}
                    </span>
                    <button
                      onClick={() => removeUnit(index)}
                      className="text-slate-400 hover:text-red-500 transition-colors"
                      aria-label="Remove unit"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
                <UnitFields data={unit} onChange={(updated) => updateUnit(index, updated)} />
              </div>
            ))}

            <button
              onClick={addAnotherUnit}
              className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add another unit
            </button>

            <div className="flex items-center justify-between pt-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-slate-500"
                onClick={() => { markDone(2); setStep(3); }}
              >
                Skip this step
              </Button>
              <Button
                onClick={() => saveUnits.mutate(units)}
                disabled={!canSaveUnits || saveUnits.isPending}
                className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
              >
                {saveUnits.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Save {units.length} unit{units.length !== 1 ? "s" : ""}
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {/* ── STEP 3 — Reminder preview ────────────────────────────────────── */}
        {step === 3 && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center">
                <Bell className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <h2 className="font-semibold text-slate-900">Your first rent reminder</h2>
                <p className="text-sm text-slate-500">This is what your tenants will receive</p>
              </div>
            </div>

            <ReminderPreview
              propertyName={propName}
              unitNumber={savedUnitNumbers[0] ?? units[0]?.unitNumber ?? ""}
            />

            {!previewSent ? (
              <div className="space-y-3 pt-2">
                <Button
                  onClick={() => {
                    setPreviewSent(true);
                    markDone(3);
                    toast({
                      title: "Reminder scheduled!",
                      description: "Tenants will be notified when rent is due.",
                    });
                  }}
                  className="w-full bg-green-600 hover:bg-green-700 text-white gap-2 h-11"
                >
                  <Bell className="w-4 h-4" />
                  Send reminder to all tenants
                </Button>
                <Button variant="outline" onClick={handleGoToDashboard} className="w-full h-11">
                  Go to dashboard first
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-green-50 rounded-xl p-5 flex items-center gap-3">
                  <CheckCircle2 className="w-6 h-6 text-green-600" />
                  <div>
                    <p className="font-semibold text-green-800">You're all set!</p>
                    <p className="text-sm text-green-600">
                      SmartProp will send reminders automatically before each due date. You can
                      now add tenants from the property page.
                    </p>
                  </div>
                </div>
                <Button
                  onClick={handleGoToDashboard}
                  className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
                >
                  Go to dashboard
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Step counter */}
        <p className="text-center text-xs text-slate-400 mt-6">
          Step {step} of 3 — you can always come back to finish this later
        </p>
      </div>
    </div>
  );
}