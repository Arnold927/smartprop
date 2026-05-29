import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { 
  User, Phone, Mail, Building, Calendar, Droplets, Zap, Flame,
  CreditCard, FileText, PenTool, Save, ChevronRight, ChevronLeft,
  CheckCircle2, Loader2, Info
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";
import { useRoleGuard, ROLES } from "@/hooks/useRoleGuard";
import { useAuth } from "@/hooks/useAuth";


const tenantOnboardingSchema = z.object({
  // Step 1: Tenant Information
  tenantName: z.string().min(2, "Tenant name is required"),
  idPassport: z.string().min(5, "ID/Passport number is required"),
  phone: z.string().min(10, "Valid phone number is required"),
  whatsappNumber: z.string().min(10, "Valid WhatsApp number is required"),
  email: z.string().email("Valid email is required"),
  propertyName: z.string().min(1, "Property name is required"),
  unitNumber: z.string().min(1, "Unit number is required"),
  moveInDate: z.string().min(1, "Move-in date is required"),
  
  // Step 2: Utility Baseline Meter Readings (all optional — not every property tracks utilities)
  includeWater: z.boolean().default(false),
  waterMeterNumber: z.string().optional(),
  waterCurrentReading: z.string().optional(),
  waterReadingDate: z.string().optional(),
  
  includeElectricity: z.boolean().default(false),
  electricityMeterNumber: z.string().optional(),
  electricityCurrentReading: z.string().optional(),
  electricityReadingDate: z.string().optional(),
  
  includeGas: z.boolean().default(false),
  gasMeterNumber: z.string().optional(),
  gasCurrentReading: z.string().optional(),
  gasReadingDate: z.string().optional(),
  
  // Step 3: Agreed Rates & Charges
  // Default/estimated rates — actual rates are recorded per billing cycle in Utility Management
  waterDefaultRate: z.string().optional(),
  electricityDefaultRate: z.string().optional(),
  gasDefaultRate: z.string().optional(),
  monthlyServiceCharge: z.string().optional(),
  garbageCollectionFee: z.string().optional(),
  securityFee: z.string().optional(),
  parkingFee: z.string().optional(),
  
  // Step 4: Payment Information
  preferredPaymentMethod: z.string().min(1, "Payment method is required"),
  monthlyDueDate: z.string().min(1, "Due date is required"),
  depositPaid: z.string().min(1, "Deposit amount is required"),
  
  // Notes
  notesAgreements: z.string().optional(),
});

type TenantOnboardingForm = z.infer<typeof tenantOnboardingSchema>;

const STEPS = [
  { id: 1, title: "Tenant Info", icon: User },
  { id: 2, title: "Utilities", icon: Zap },
  { id: 3, title: "Rates", icon: CreditCard },
  { id: 4, title: "Payment", icon: Save },
];

export default function TenantOnboarding() {
  const guard = useRoleGuard(ROLES.ADMIN_MANAGER_STAFF);
  if (guard.gate) return guard.gate;
  const { user } = useAuth();

  const [currentStep, setCurrentStep] = useState(1);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch real properties so the dropdown only shows valid names
  const { data: propertiesRaw = [] } = useQuery<any>({
    queryKey: ["/api/properties"],
    queryFn: async () => {
      const r = await apiRequest("/api/properties");
      return ensureArray(await r.json());
    },
    staleTime: 5 * 60 * 1000,
  });
  const propertyList: { id: number; name: string }[] = Array.isArray(propertiesRaw)
    ? propertiesRaw
    : (propertiesRaw?.results ?? []);

  const form = useForm<TenantOnboardingForm, any, TenantOnboardingForm>({
    resolver: zodResolver(tenantOnboardingSchema) as any,
    mode: "onChange",
    defaultValues: {
      tenantName: "", idPassport: "", phone: "", whatsappNumber: "", email: "",
      propertyName: "", unitNumber: "", moveInDate: "",
      includeWater: false, waterMeterNumber: "", waterCurrentReading: "", waterReadingDate: new Date().toISOString().split('T')[0],
      includeElectricity: false, electricityMeterNumber: "", electricityCurrentReading: "", electricityReadingDate: new Date().toISOString().split('T')[0],
      includeGas: false, gasMeterNumber: "", gasCurrentReading: "", gasReadingDate: new Date().toISOString().split('T')[0],
      waterDefaultRate: "", electricityDefaultRate: "", gasDefaultRate: "",
      monthlyServiceCharge: "", garbageCollectionFee: "", securityFee: "", parkingFee: "",
      preferredPaymentMethod: "", monthlyDueDate: "", depositPaid: "",
      notesAgreements: "",
    },
  });

  const includeWater = form.watch("includeWater");
  const includeElectricity = form.watch("includeElectricity");
  const includeGas = form.watch("includeGas");

  const watchedPropertyName = form.watch("propertyName");
  const selectedProperty = propertyList.find((p) => p.name === watchedPropertyName);

  // Fetch units for the selected property only
  const { data: unitsRaw = [] } = useQuery<any>({
    queryKey: ["/api/properties", selectedProperty?.id, "units"],
    queryFn: async () => {
      const r = await apiRequest(`/api/properties/${selectedProperty!.id}/units`);
      return ensureArray(await r.json());
    },
    enabled: !!selectedProperty?.id,
    staleTime: 5 * 60 * 1000,
  });
  const unitList: { id: number; unitNumber: string; isOccupied?: boolean; hasActiveTenant?: boolean }[] =
    Array.isArray(unitsRaw) ? unitsRaw : (unitsRaw?.results ?? []);
  const vacantUnits = unitList.filter((u) => !u.hasActiveTenant);

  // Autosave to localStorage
  useEffect(() => {
    const savedData = localStorage.getItem("tenant_onboarding_draft");
    if (savedData) {
      try {
        const parsed = JSON.parse(savedData);
        form.reset(parsed);
      } catch (e) {
        console.error("Failed to load draft", e);
      }
    }
  }, []);

  useEffect(() => {
    const subscription = form.watch((value) => {
      localStorage.setItem("tenant_onboarding_draft", JSON.stringify(value));
    });
    return () => subscription.unsubscribe();
  }, [form]);

  const submitOnboardingMutation = useMutation({
    mutationFn: async (data: TenantOnboardingForm) => {
      try {
        const res = await apiRequest("/api/tenant-onboarding", { method: "POST", data });
        return res.json();
      } catch (err: any) {
        // apiRequest throws with the raw response body as the message — attempt to
        // parse it as JSON so the user sees the server's descriptive error string.
        let message = err.message || "Failed to complete tenant onboarding.";
        try { const parsed = JSON.parse(message); message = parsed.message || message; } catch {}
        throw new Error(message);
      }
    },
    onSuccess: () => {
      toast({ title: "Onboarding Complete", description: "Tenant has been registered and a portal invite has been sent to their email address." });
      form.reset();
      localStorage.removeItem("tenant_onboarding_draft");
      setCurrentStep(1);
      queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/units"] });
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      queryClient.invalidateQueries({ queryKey: ["/api/properties", selectedProperty?.id, "units"] });
    },
    onError: (error: Error) => {
      toast({ title: "Onboarding Failed", description: error.message, variant: "destructive" });
    },
  });

  const nextStep = async () => {
    const fields = getFieldsForStep(currentStep);
    const isValid = await form.trigger(fields as any);
    if (isValid) setCurrentStep(prev => Math.min(prev + 1, STEPS.length));
  };

  const prevStep = () => setCurrentStep(prev => Math.max(prev - 1, 1));

  const getFieldsForStep = (step: number) => {
    switch (step) {
      case 1: return ["tenantName", "idPassport", "phone", "whatsappNumber", "email", "propertyName", "unitNumber", "moveInDate"];
      case 2: return ["waterMeterNumber", "waterCurrentReading", "electricityMeterNumber", "electricityCurrentReading", "gasMeterNumber", "gasCurrentReading"];
      case 3: return [];
      case 4: return ["preferredPaymentMethod", "monthlyDueDate", "depositPaid"];
      default: return [];
    }
  };

  const onSubmit = (data: TenantOnboardingForm) => {
    submitOnboardingMutation.mutate(data);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Tenant Onboarding</h1>
          <p className="text-muted-foreground text-sm md:text-base">Follow the steps to complete tenant registration</p>
        </div>

        {/* Progress Stepper */}
        <div className="relative flex justify-between items-center px-2">
          <div className="absolute top-1/2 left-0 w-full h-0.5 bg-border -translate-y-1/2 z-0" />
          {STEPS.map((step) => {
            const Icon = step.icon;
            const isCompleted = currentStep > step.id;
            const isActive = currentStep === step.id;
            return (
              <div key={step.id} className="relative z-10 flex flex-col items-center gap-2">
                <div className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 border-2",
                  isCompleted ? "bg-blue-600 border-blue-600 text-white" :
                  isActive    ? "bg-card border-2 border-primary text-primary shadow-md scale-110" :
                               "bg-card border-2 border-border text-muted-foreground"
                )}>
                  {isCompleted ? <CheckCircle2 className="h-6 w-6" /> : <Icon className="h-5 w-5" />}
                </div>
                <span className={cn(
                  "text-[10px] md:text-xs font-medium uppercase tracking-wider hidden sm:block",
                  isActive ? "text-primary" : "text-muted-foreground"
                )}>
                  {step.title}
                </span>
              </div>
            );
          })}
        </div>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card className="border-0 shadow-lg bg-card overflow-hidden">
            <CardHeader className="bg-muted/50 border-b">
              <CardTitle className="text-lg flex items-center gap-2">
                {STEPS[currentStep - 1].title}
              </CardTitle>
              <CardDescription>Step {currentStep} of {STEPS.length}</CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              
              {/* Step 1: Tenant Information */}
              {currentStep === 1 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 animate-in fade-in slide-in-from-right-4 duration-300">
                  <FormField label="Tenant Name *" id="tenantName" error={form.formState.errors.tenantName?.message}>
                    <Input id="tenantName" {...form.register("tenantName")} placeholder="Full Name" className="h-11" />
                  </FormField>
                  <FormField label="ID/Passport Number *" id="idPassport" error={form.formState.errors.idPassport?.message}>
                    <Input id="idPassport" {...form.register("idPassport")} placeholder="ID Number" className="h-11" />
                  </FormField>
                  <FormField label="Phone Number *" id="phone" error={form.formState.errors.phone?.message}>
                    <Input id="phone" {...form.register("phone")} placeholder="+254..." className="h-11" />
                  </FormField>
                  <FormField label="WhatsApp Number *" id="whatsappNumber" error={form.formState.errors.whatsappNumber?.message}>
                    <Input id="whatsappNumber" {...form.register("whatsappNumber")} placeholder="+254..." className="h-11" />
                  </FormField>
                  <FormField label="Email Address *" id="email" error={form.formState.errors.email?.message} className="md:col-span-2">
                    <Input id="email" type="email" {...form.register("email")} placeholder="email@example.com" className="h-11" />
                    <div className="flex items-start gap-2 mt-1.5 px-3 py-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900">
                      <Mail className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
                      <p className="text-xs text-emerald-700 dark:text-emerald-300">
                        Once onboarding is complete, a <strong>portal invite link</strong> will be sent to this email so the tenant can set up their account and access their tenant portal.
                      </p>
                    </div>
                  </FormField>
                  <FormField label="Property Name *" id="propertyName" error={form.formState.errors.propertyName?.message}>
                    <Select
                      onValueChange={(v) => {
                        form.setValue("propertyName", v, { shouldValidate: true });
                        form.setValue("unitNumber", ""); // reset unit when property changes
                      }}
                      value={form.watch("propertyName")}
                    >
                      <SelectTrigger className="h-11">
                        <SelectValue placeholder="Select a property" />
                      </SelectTrigger>
                      <SelectContent>
                        {propertyList.map((p) => (
                          <SelectItem key={p.id} value={p.name}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                  <FormField label="Unit Number *" id="unitNumber" error={form.formState.errors.unitNumber?.message}>
                    <Select
                      onValueChange={(v) => form.setValue("unitNumber", v, { shouldValidate: true })}
                      value={form.watch("unitNumber")}
                      disabled={!selectedProperty}
                    >
                      <SelectTrigger className="h-11">
                        <SelectValue placeholder={!selectedProperty ? "Select a property first" : vacantUnits.length === 0 ? "No vacant units" : "Select a unit"} />
                      </SelectTrigger>
                      <SelectContent>
                        {vacantUnits.map((u) => (
                          <SelectItem key={u.id} value={u.unitNumber}>
                            {u.unitNumber}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                  <FormField label="Move-in Date *" id="moveInDate" error={form.formState.errors.moveInDate?.message} className="md:col-span-2">
                    <Input id="moveInDate" type="date" {...form.register("moveInDate")} className="h-11" />
                  </FormField>
                </div>
              )}

              {/* Step 2: Utilities (Progressive Disclosure) */}
              {currentStep === 2 && (
                <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
                  <div className="p-4 bg-blue-50 dark:bg-blue-950/30 rounded-xl border border-blue-100 dark:border-blue-900 flex gap-3">
                    <Info className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
                    <p className="text-sm text-blue-800 dark:text-blue-200">
                      Utility tracking is optional. Only enable utilities that apply to this tenancy — you can always add readings later.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <UtilityToggle label="Water" icon={Droplets} active={includeWater} onToggle={() => form.setValue("includeWater", !includeWater)} />
                    <UtilityToggle label="Electricity" icon={Zap} active={includeElectricity} onToggle={() => form.setValue("includeElectricity", !includeElectricity)} />
                    <UtilityToggle label="Gas" icon={Flame} active={includeGas} onToggle={() => form.setValue("includeGas", !includeGas)} />
                  </div>

                  <div className="space-y-6">
                    {includeWater && (
                      <UtilitySection title="Water Baseline" icon={Droplets} color="text-blue-500">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <FormField label="Meter Number" id="waterMeterNumber">
                            <Input id="waterMeterNumber" {...form.register("waterMeterNumber")} placeholder="W-000" />
                          </FormField>
                          <FormField label="Current Reading" id="waterCurrentReading">
                            <Input id="waterCurrentReading" {...form.register("waterCurrentReading")} placeholder="0.00" />
                          </FormField>
                          <FormField label="Reading Date" id="waterReadingDate">
                            <Input id="waterReadingDate" type="date" {...form.register("waterReadingDate")} />
                          </FormField>
                        </div>
                      </UtilitySection>
                    )}

                    {includeElectricity && (
                      <UtilitySection title="Electricity Baseline" icon={Zap} color="text-yellow-500">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <FormField label="Meter Number" id="electricityMeterNumber">
                            <Input id="electricityMeterNumber" {...form.register("electricityMeterNumber")} placeholder="E-000" />
                          </FormField>
                          <FormField label="Current Reading" id="electricityCurrentReading">
                            <Input id="electricityCurrentReading" {...form.register("electricityCurrentReading")} placeholder="0.00" />
                          </FormField>
                          <FormField label="Reading Date" id="electricityReadingDate">
                            <Input id="electricityReadingDate" type="date" {...form.register("electricityReadingDate")} />
                          </FormField>
                        </div>
                      </UtilitySection>
                    )}

                    {includeGas && (
                      <UtilitySection title="Gas Baseline" icon={Flame} color="text-orange-500">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <FormField label="Meter Number" id="gasMeterNumber">
                            <Input id="gasMeterNumber" {...form.register("gasMeterNumber")} placeholder="G-000" />
                          </FormField>
                          <FormField label="Current Reading" id="gasCurrentReading">
                            <Input id="gasCurrentReading" {...form.register("gasCurrentReading")} placeholder="0.00" />
                          </FormField>
                          <FormField label="Reading Date" id="gasReadingDate">
                            <Input id="gasReadingDate" type="date" {...form.register("gasReadingDate")} />
                          </FormField>
                        </div>
                      </UtilitySection>
                    )}
                  </div>
                </div>
              )}

              {/* Step 3: Rates */}
              {currentStep === 3 && (
                <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">

                  {/* Fixed charges */}
                  <div>
                    <h3 className="text-sm font-semibold text-foreground/80 mb-4">Fixed Monthly Charges</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <FormField label="Monthly Service Charge" id="monthlyServiceCharge" error={form.formState.errors.monthlyServiceCharge?.message}>
                        <Input id="monthlyServiceCharge" {...form.register("monthlyServiceCharge")} placeholder="KES" />
                      </FormField>
                      <FormField label="Garbage Collection Fee" id="garbageCollectionFee" error={form.formState.errors.garbageCollectionFee?.message}>
                        <Input id="garbageCollectionFee" {...form.register("garbageCollectionFee")} placeholder="KES" />
                      </FormField>
                      <FormField label="Security Fee" id="securityFee" error={form.formState.errors.securityFee?.message}>
                        <Input id="securityFee" {...form.register("securityFee")} placeholder="KES" />
                      </FormField>
                      <FormField label="Parking Fee" id="parkingFee" error={form.formState.errors.parkingFee?.message}>
                        <Input id="parkingFee" {...form.register("parkingFee")} placeholder="KES" />
                      </FormField>
                    </div>
                  </div>

                  {/* Utility default rates — only shown if a utility was enabled in Step 2 */}
                  {(includeWater || includeElectricity || includeGas) && (
                    <div>
                      <h3 className="text-sm font-semibold text-foreground/80 mb-2">Utility Default Rates (optional)</h3>
                      <div className="p-4 bg-amber-50 dark:bg-amber-950/30 rounded-xl border border-amber-100 dark:border-amber-900 flex gap-3 mb-4">
                        <Info className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                        <p className="text-sm text-amber-800 dark:text-amber-200">
                          These are starting estimates only. The actual rate is set each month when you record utility readings in <strong>Utility Management</strong>, since provider tariffs can change.
                        </p>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        {includeWater && (
                          <FormField label="Water — Default Rate (per unit)" id="waterDefaultRate">
                            <Input id="waterDefaultRate" {...form.register("waterDefaultRate")} placeholder="KES / m³" />
                          </FormField>
                        )}
                        {includeElectricity && (
                          <FormField label="Electricity — Default Rate (per unit)" id="electricityDefaultRate">
                            <Input id="electricityDefaultRate" {...form.register("electricityDefaultRate")} placeholder="KES / kWh" />
                          </FormField>
                        )}
                        {includeGas && (
                          <FormField label="Gas — Default Rate (per unit)" id="gasDefaultRate">
                            <Input id="gasDefaultRate" {...form.register("gasDefaultRate")} placeholder="KES / m³" />
                          </FormField>
                        )}
                      </div>
                    </div>
                  )}

                </div>
              )}

              {/* Step 4: Payment */}
              {currentStep === 4 && (
                <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                  <div className="flex items-start gap-3 p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                    <p className="text-sm text-emerald-700 dark:text-emerald-300">
                      After completing onboarding, a <strong>portal invite</strong> will be emailed to the tenant so they can set up their password and access rent payment history, maintenance requests, and documents.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <FormField label="Preferred Payment Method *" id="preferredPaymentMethod" error={form.formState.errors.preferredPaymentMethod?.message}>
                      <Select onValueChange={(v) => form.setValue("preferredPaymentMethod", v, { shouldValidate: true })} value={form.watch("preferredPaymentMethod")}>
                        <SelectTrigger className="h-11">
                          <SelectValue placeholder="Select method" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="mpesa">M-Pesa</SelectItem>
                          <SelectItem value="bank">Bank Transfer</SelectItem>
                          <SelectItem value="cash">Cash</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormField>
                    <FormField label="Monthly Due Date *" id="monthlyDueDate" error={form.formState.errors.monthlyDueDate?.message}>
                      <Input id="monthlyDueDate" type="number" min="1" max="31" {...form.register("monthlyDueDate")} placeholder="Day of month (1-31)" className="h-11" />
                    </FormField>
                    <FormField label="Security Deposit Paid *" id="depositPaid" error={form.formState.errors.depositPaid?.message} className="md:col-span-2">
                      <Input id="depositPaid" {...form.register("depositPaid")} placeholder="KES" className="h-11" />
                    </FormField>
                    <FormField label="Additional Notes & Agreements" id="notesAgreements" className="md:col-span-2">
                      <Textarea id="notesAgreements" {...form.register("notesAgreements")} placeholder="Any special terms or notes..." className="min-h-[100px]" />
                    </FormField>
                  </div>
                </div>
              )}

            </CardContent>
            <div className="bg-muted/30 p-6 border-t flex justify-between items-center">
              <Button 
                type="button" 
                variant="ghost" 
                onClick={prevStep} 
                disabled={currentStep === 1}
                className="gap-2"
              >
                <ChevronLeft className="h-4 w-4" /> Previous
              </Button>
              
              {currentStep < STEPS.length ? (
                <Button type="button" onClick={nextStep} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
                  Next Step <ChevronRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button 
                  type="submit" 
                  disabled={submitOnboardingMutation.isPending}
                  className="gap-2 bg-green-600 hover:bg-green-700 text-white min-w-[140px]"
                >
                  {submitOnboardingMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>Complete Onboarding <CheckCircle2 className="h-4 w-4" /></>
                  )}
                </Button>
              )}
            </div>
          </Card>
        </form>
      </div>
    </div>
  );
}

function FormField({ label, id, error, children, className }: any) {
  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={id} className="text-sm font-semibold text-foreground/80">{label}</Label>
      {children}
      {error && <p className="text-xs font-medium text-destructive animate-in fade-in slide-in-from-top-1">{error}</p>}
    </div>
  );
}

function UtilityToggle({ label, icon: Icon, active, onToggle }: any) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all gap-2",
        active 
          ? "bg-primary/5 border-2 border-primary text-primary shadow-sm" 
          : "bg-card border-2 border-border text-muted-foreground hover:border-muted-foreground/30"
      )}
    >
      <Icon className="h-6 w-6" />
      <span className="text-xs font-bold uppercase tracking-wider">{label}</span>
    </button>
  );
}

function UtilitySection({ title, icon: Icon, color, children }: any) {
  return (
    <div className="space-y-4 p-5 rounded-2xl border border-border bg-card/50">
      <div className="flex items-center gap-2">
        <div className={cn("p-2 rounded-lg bg-muted", color)}>
          <Icon className="h-5 w-5" />
        </div>
        <h3 className="font-bold text-foreground">{title}</h3>
      </div>
      {children}
    </div>
  );
}