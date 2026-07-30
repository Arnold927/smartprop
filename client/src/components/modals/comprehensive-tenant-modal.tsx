import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { withOrgParam } from "@/lib/platformOrgContext";
import { User, Zap, Receipt, CreditCard, FileText, Droplets, Flame, Save, Building } from "lucide-react";
import { z } from "zod";

// ─── Schema ───────────────────────────────────────────────────────────────────

const tenantOnboardingSchema = z.object({
  firstName: z.string().min(2, "First name is required"),
  lastName: z.string().min(2, "Last name is required"),
  email: z.string().email("Valid email is required"),
  phone: z.string().min(10, "Valid phone number is required"),
  whatsappNumber: z.string().min(10, "Valid WhatsApp number is required"),
  idPassport: z.string().min(5, "ID/Passport number is required"),
  propertyId: z.string().min(1, "Property is required"),
  unitId: z.string().min(1, "Unit is required"),
  monthlyRent: z.string().min(1, "Monthly rent is required"),
  leaseStartDate: z.string().min(1, "Lease start date is required"),
  waterMeterNumber: z.string().min(1, "Water meter number is required"),
  waterCurrentReading: z.string().min(1, "Water reading is required"),
  waterReadingDate: z.string().min(1, "Reading date is required"),
  electricityMeterNumber: z.string().min(1, "Electricity meter number is required"),
  electricityCurrentReading: z.string().min(1, "Electricity reading is required"),
  electricityReadingDate: z.string().min(1, "Reading date is required"),
  gasMeterNumber: z.string().optional(),
  gasCurrentReading: z.string().optional(),
  gasReadingDate: z.string().optional(),
  waterRatePerUnit: z.string().min(1, "Water rate is required"),
  electricityRatePerUnit: z.string().min(1, "Electricity rate is required"),
  gasRatePerUnit: z.string().optional(),
  monthlyServiceCharge: z.string().min(1, "Service charge is required"),
  garbageCollectionFee: z.string().optional(),
  securityFee: z.string().optional(),
  parkingFee: z.string().optional(),
  preferredPaymentMethod: z.string().min(1, "Payment method is required"),
  monthlyDueDate: z.string().min(1, "Due date is required"),
  depositPaid: z.string().min(1, "Deposit amount is required"),
  notesAgreements: z.string().optional(),
});

type TenantOnboardingForm = z.infer<typeof tenantOnboardingSchema>;

interface ComprehensiveTenantModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Pass the already-fetched properties array from the parent page.
   *  This eliminates the internal useQuery entirely, removing the only
   *  source of "properties.map is not a function" regardless of API shape. */
  properties?: any[];
  /** Required when the caller is platform_admin (no fixed org of their
   *  own) — carried as ?organizationId=X on the submit request. Ignored
   *  for every other role, whose org already comes from their own JWT. */
  organizationId?: string | null;
}

// ─── Utility ──────────────────────────────────────────────────────────────────

/**
 * toArray — safely coerce any API response shape to a plain array.
 * Handles: T[] | { results: T[] } | { data: T[] } | { items: T[] } | null | undefined
 */
function toArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d.results)) return d.results as T[];
    if (Array.isArray(d.data))    return d.data    as T[];
    if (Array.isArray(d.items))   return d.items   as T[];
  }
  return [];
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ComprehensiveTenantModal({ isOpen, onClose, properties: propertiesProp = [], organizationId }: ComprehensiveTenantModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const today = new Date().toISOString().split("T")[0];

  // ─── Properties ────────────────────────────────────────────────────────────
  // DEFINITIVE FIX: Do NOT fetch properties inside this modal at all.
  // The parent page (tenants.tsx) already fetches and normalises them.
  // We receive them as a prop and apply a final ensureArray() guard so
  // nothing can ever throw "properties.map is not a function" here.
  const properties: any[] = Array.isArray(propertiesProp) ? propertiesProp : [];
  const propertiesLoading = false;

  const form = useForm<TenantOnboardingForm>({
    resolver: zodResolver(tenantOnboardingSchema),
    defaultValues: {
      firstName: "", lastName: "", email: "", phone: "",
      whatsappNumber: "", idPassport: "",
      propertyId: "", unitId: "", monthlyRent: "", leaseStartDate: "",
      waterMeterNumber: "", waterCurrentReading: "", waterReadingDate: today,
      electricityMeterNumber: "", electricityCurrentReading: "", electricityReadingDate: today,
      gasMeterNumber: "", gasCurrentReading: "", gasReadingDate: today,
      waterRatePerUnit: "", electricityRatePerUnit: "", gasRatePerUnit: "",
      monthlyServiceCharge: "", garbageCollectionFee: "", securityFee: "", parkingFee: "",
      preferredPaymentMethod: "", monthlyDueDate: "", depositPaid: "",
      notesAgreements: "",
    },
  });

  const submitOnboardingMutation = useMutation({
    mutationFn: async (data: TenantOnboardingForm) => {
      return await apiRequest(withOrgParam("/api/tenant-onboarding", organizationId), { method: "POST", data });
    },
    onSuccess: () => {
      toast({
        title: "Tenant Onboarding Complete",
        description: "Comprehensive tenant onboarding completed successfully.",
      });
      form.reset();
      queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
      onClose();
    },
    onError: (error: any) => {
      toast({
        title: "Onboarding Failed",
        description: error?.message || "Failed to complete tenant onboarding. Please try again.",
        variant: "destructive",
      });
    },
    onSettled: () => { setIsSubmitting(false); },
  });

  const onSubmit = (data: TenantOnboardingForm) => {
    setIsSubmitting(true);
    submitOnboardingMutation.mutate(data);
  };

  const handleClose = () => {
    form.reset();
    onClose();
  };

  // Don't render the heavy form DOM at all when closed — prevents the modal
  // from mounting its queries and running any map() before data is ready.
  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-foreground">
            Comprehensive Tenant Onboarding
          </DialogTitle>
          <DialogDescription>
            Complete tenant information and utilities baseline capture for professional property management
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

          {/* ── Section 1: Tenant Information ── */}
          <Card className="border-0 shadow-sm bg-card">
            <CardHeader className="pb-4 border-b border-border">
              <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
                <User className="h-5 w-5 text-emerald-600" />
                Tenant Information
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  { id: "firstName",      label: "First Name",       placeholder: "Enter first name"       },
                  { id: "lastName",       label: "Last Name",        placeholder: "Enter last name"        },
                  { id: "email",          label: "Email Address",    placeholder: "Enter email address", type: "email" },
                  { id: "phone",          label: "Phone Number",     placeholder: "Enter phone number"     },
                  { id: "whatsappNumber", label: "WhatsApp Number",  placeholder: "Enter WhatsApp number"  },
                  { id: "idPassport",     label: "ID/Passport No.",  placeholder: "Enter ID or passport number" },
                ].map(({ id, label, placeholder, type }) => (
                  <div key={id} className="space-y-2">
                    <Label htmlFor={id} className="text-sm font-medium text-foreground">{label} *</Label>
                    <Input
                      id={id}
                      type={type ?? "text"}
                      {...form.register(id as keyof TenantOnboardingForm)}
                      placeholder={placeholder}
                      className="h-10 text-sm border-border"
                    />
                    {form.formState.errors[id as keyof TenantOnboardingForm] && (
                      <p className="text-xs text-red-600">
                        {form.formState.errors[id as keyof TenantOnboardingForm]?.message as string}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* ── Section 2: Property & Lease ── */}
          <Card className="border-0 shadow-sm bg-card">
            <CardHeader className="pb-4 border-b border-border">
              <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
                <Building className="h-5 w-5 text-emerald-600" />
                Property & Lease Information
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                {/* Property select — safe map over guaranteed array */}
                <div className="space-y-2">
                  <Label htmlFor="propertyId" className="text-sm font-medium text-foreground">Property *</Label>
                  <Select
                    onValueChange={(v) => form.setValue("propertyId", v)}
                    value={form.watch("propertyId")}
                  >
                    <SelectTrigger className="h-10 text-sm border-border">
                      <SelectValue placeholder="Select property" />
                    </SelectTrigger>
                    <SelectContent>
                      {propertiesLoading ? (
                        <SelectItem value="__loading__" disabled>Loading…</SelectItem>
                      ) : properties.length === 0 ? (
                        <SelectItem value="__empty__" disabled>No properties found</SelectItem>
                      ) : (
                        properties.map((p: any) => (
                          <SelectItem key={p.id} value={String(p.id)}>
                            {p.name || `Property #${p.id}`}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  {form.formState.errors.propertyId && (
                    <p className="text-xs text-red-600">{form.formState.errors.propertyId.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="unitId" className="text-sm font-medium text-foreground">Unit *</Label>
                  <Input
                    id="unitId"
                    {...form.register("unitId")}
                    placeholder="Enter unit number/ID"
                    className="h-10 text-sm border-border"
                  />
                  {form.formState.errors.unitId && (
                    <p className="text-xs text-red-600">{form.formState.errors.unitId.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="monthlyRent" className="text-sm font-medium text-foreground">Monthly Rent (KES) *</Label>
                  <Input
                    id="monthlyRent"
                    {...form.register("monthlyRent")}
                    placeholder="Enter monthly rent amount"
                    className="h-10 text-sm border-border"
                  />
                  {form.formState.errors.monthlyRent && (
                    <p className="text-xs text-red-600">{form.formState.errors.monthlyRent.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="leaseStartDate" className="text-sm font-medium text-foreground">Lease Start Date *</Label>
                  <Input
                    id="leaseStartDate"
                    type="date"
                    {...form.register("leaseStartDate")}
                    className="h-10 text-sm border-border"
                  />
                  {form.formState.errors.leaseStartDate && (
                    <p className="text-xs text-red-600">{form.formState.errors.leaseStartDate.message}</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── Section 3: Utility Baseline ── */}
          <Card className="border-0 shadow-sm bg-card">
            <CardHeader className="pb-4 border-b border-border">
              <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
                <Zap className="h-5 w-5 text-emerald-600" />
                Utility Baseline Meter Readings
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 font-semibold text-foreground w-24">Utility</th>
                      <th className="text-left py-2 font-semibold text-foreground">Meter Number *</th>
                      <th className="text-left py-2 font-semibold text-foreground">Current Reading *</th>
                      <th className="text-left py-2 font-semibold text-foreground">Reading Date *</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label: "Water",       icon: <Droplets className="h-4 w-4 mr-2 text-blue-500" />,   reg: "water"       },
                      { label: "Electricity", icon: <Zap      className="h-4 w-4 mr-2 text-yellow-500" />, reg: "electricity" },
                      { label: "Gas",         icon: <Flame    className="h-4 w-4 mr-2 text-orange-500" />, reg: "gas"         },
                    ].map(({ label, icon, reg }) => (
                      <tr key={reg} className="border-b border-border">
                        <td className="py-3">
                          <span className="flex items-center">{icon}{label}</span>
                        </td>
                        <td className="py-3 pr-2">
                          <Input {...form.register(`${reg}MeterNumber` as any)} placeholder={`${label[0]}M123456`} className="h-8 text-xs" />
                        </td>
                        <td className="py-3 pr-2">
                          <Input {...form.register(`${reg}CurrentReading` as any)} placeholder="e.g. 1234" className="h-8 text-xs" />
                        </td>
                        <td className="py-3">
                          <Input type="date" {...form.register(`${reg}ReadingDate` as any)} className="h-8 text-xs" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* ── Section 4: Rates & Charges ── */}
          <Card className="border-0 shadow-sm bg-card">
            <CardHeader className="pb-4 border-b border-border">
              <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
                <Receipt className="h-5 w-5 text-emerald-600" />
                Agreed Rates & Charges (KES)
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { id: "waterRatePerUnit",       label: "Water Rate per Unit *",     placeholder: "35.00",   required: true  },
                  { id: "electricityRatePerUnit",  label: "Electricity Rate per kWh *", placeholder: "24.50",  required: true  },
                  { id: "gasRatePerUnit",          label: "Gas Rate per m³",           placeholder: "45.00",   required: false },
                  { id: "monthlyServiceCharge",    label: "Monthly Service Charge *",  placeholder: "2500.00", required: true  },
                  { id: "garbageCollectionFee",    label: "Garbage Collection Fee",    placeholder: "500.00",  required: false },
                  { id: "securityFee",             label: "Security Fee",              placeholder: "1000.00", required: false },
                  { id: "parkingFee",              label: "Parking Fee",               placeholder: "1500.00", required: false },
                ].map(({ id, label, placeholder }) => (
                  <div key={id} className="space-y-2">
                    <Label className="text-sm font-medium text-foreground">{label}</Label>
                    <Input
                      {...form.register(id as keyof TenantOnboardingForm)}
                      placeholder={placeholder}
                      className="h-10 text-sm"
                    />
                    {form.formState.errors[id as keyof TenantOnboardingForm] && (
                      <p className="text-xs text-red-600">
                        {form.formState.errors[id as keyof TenantOnboardingForm]?.message as string}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* ── Section 5: Payment Information ── */}
          <Card className="border-0 shadow-sm bg-card">
            <CardHeader className="pb-4 border-b border-border">
              <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
                <CreditCard className="h-5 w-5 text-emerald-600" />
                Payment Information
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                <div className="space-y-2">
                  <Label className="text-sm font-medium text-foreground">Preferred Payment Method *</Label>
                  <Select
                    onValueChange={(v) => form.setValue("preferredPaymentMethod", v)}
                    value={form.watch("preferredPaymentMethod")}
                  >
                    <SelectTrigger className="h-10 text-sm">
                      <SelectValue placeholder="Select method" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mpesa">M-PESA</SelectItem>
                      <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="check">Check</SelectItem>
                    </SelectContent>
                  </Select>
                  {form.formState.errors.preferredPaymentMethod && (
                    <p className="text-xs text-red-600">{form.formState.errors.preferredPaymentMethod.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium text-foreground">Monthly Due Date *</Label>
                  <Select
                    onValueChange={(v) => form.setValue("monthlyDueDate", v)}
                    value={form.watch("monthlyDueDate")}
                  >
                    <SelectTrigger className="h-10 text-sm">
                      <SelectValue placeholder="Select day" />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 28 }, (_, i) => {
                        const day = i + 1;
                        const suffix = day === 1 ? "st" : day === 2 ? "nd" : day === 3 ? "rd" : "th";
                        return (
                          <SelectItem key={day} value={String(day)}>
                            {day}{suffix} of each month
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  {form.formState.errors.monthlyDueDate && (
                    <p className="text-xs text-red-600">{form.formState.errors.monthlyDueDate.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium text-foreground">Security Deposit Paid (KES) *</Label>
                  <Input
                    {...form.register("depositPaid")}
                    placeholder="50000.00"
                    className="h-10 text-sm"
                  />
                  {form.formState.errors.depositPaid && (
                    <p className="text-xs text-red-600">{form.formState.errors.depositPaid.message}</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── Section 6: Notes ── */}
          <Card className="border-0 shadow-sm bg-card">
            <CardHeader className="pb-4 border-b border-border">
              <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
                <FileText className="h-5 w-5 text-emerald-600" />
                Notes & Special Agreements
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <Textarea
                {...form.register("notesAgreements")}
                placeholder="Enter any special agreements, notes, or conditions…"
                className="min-h-[80px] text-sm border-border"
              />
            </CardContent>
          </Card>

          {/* ── Actions ── */}
          <div className="flex justify-end space-x-3 pt-4">
            <Button type="button" variant="outline" onClick={handleClose}>Cancel</Button>
            <Button
              type="submit"
              className="px-8 bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={isSubmitting}
            >
              <Save className="h-4 w-4 mr-2" />
              {isSubmitting ? "Processing…" : "Complete Onboarding"}
            </Button>
          </div>

        </form>
      </DialogContent>
    </Dialog>
  );
}