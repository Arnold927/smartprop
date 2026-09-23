"use client";

import { useEffect, useMemo } from "react";
import { useForm, Controller, useWatch } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import type { Tenant } from "@/types/tenant";

export interface Unit {
  id: number;
  unitNumber: string;
  bedrooms?: number | null;
  bathrooms?: number | null;
  sqft: number;
  monthlyRent: number;
  isOccupied: boolean;
}

interface AddTenantDialogProps {
  open: boolean;
  onClose: () => void;
  propertyName?: string;
  units: Unit[];
  tenant?: Tenant | null;
  isSubmitting?: boolean;
  onSubmit: (data: TenantFormValues) => Promise<boolean>;
}

/* =========================
   Schema
========================= */
const tenantSchema = z.object({
  firstName:       z.string().min(1, "Required"),
  lastName:        z.string().min(1, "Required"),
  email:           z.string().email("Invalid email"),
  phone:           z.string().optional(),
  unitId:          z.number().min(1).optional(),
  leaseStartDate:  z.string().min(1, "Required"),
  leaseEndDate:    z.string().min(1, "Required"),
  monthlyRent:     z.string().min(1, "Required"),
  securityDeposit: z.string().optional(),
  status:          z.enum(["active", "pending", "inactive"]),
});

export type TenantFormValues = z.infer<typeof tenantSchema>;

/* =========================
   Field wrapper for consistent styling
========================= */
function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</Label>
      {children}
      {error && <p className="text-xs text-red-500 mt-0.5">{error}</p>}
    </div>
  );
}

const inputCls = "h-9 border-border dark:border-gray-700 bg-background dark:bg-gray-800 text-sm rounded-lg focus-visible:ring-1 focus-visible:ring-emerald-500";

/* =========================
   Component
========================= */
export default function AddTenantDialog({
  open,
  onClose,
  propertyName,
  units,
  tenant,
  isSubmitting = false,
  onSubmit,
}: AddTenantDialogProps) {
  const isEditing = Boolean(tenant);

  const form = useForm<TenantFormValues>({
    resolver: zodResolver(tenantSchema),
    defaultValues: {
      firstName:       "",
      lastName:        "",
      email:           "",
      phone:           "",
      unitId:          0,
      leaseStartDate:  "",
      leaseEndDate:    "",
      monthlyRent:     "",
      securityDeposit: "",
      status:          "active",
    },
  });

  const errors = form.formState.errors;

  // Reset form when tenant changes or dialog opens
  useEffect(() => {
    if (tenant) {
      form.reset({
        firstName:       tenant.firstName,
        lastName:        tenant.lastName,
        email:           tenant.email,
        phone:           tenant.phone ?? "",
        unitId:          tenant.unitId ?? 0,
        leaseStartDate:  tenant.leaseStartDate?.split("T")[0] ?? "",
        leaseEndDate:    tenant.leaseEndDate?.split("T")[0] ?? "",
        monthlyRent:     tenant.monthlyRent?.toString() ?? "",
        securityDeposit: tenant.securityDeposit?.toString() ?? "",
        status:          tenant.status,
      });
    } else if (open) {
      form.reset();
    }
  }, [tenant?.id, open]);

  // Only show vacant units when adding a new tenant; show all when editing
  const availableUnits = useMemo(
    () => units.filter(u => isEditing ? true : !u.isOccupied),
    [units, isEditing]
  );

  // Auto-fill rent when a unit is selected
  const unitId = useWatch({ control: form.control, name: "unitId" });
  useEffect(() => {
    if (!unitId || isEditing) return;
    const unit = availableUnits.find(u => u.id === unitId);
    if (unit) {
      form.setValue("monthlyRent", unit.monthlyRent.toString(), { shouldDirty: true });
      // Suggest 1-month deposit as a sensible default if field is still empty
      if (!form.getValues("securityDeposit")) {
        form.setValue("securityDeposit", unit.monthlyRent.toString(), { shouldDirty: true });
      }
    }
  }, [unitId, isEditing, availableUnits]);

  const handleFormSubmit = async (data: TenantFormValues) => {
    try {
      const success = await onSubmit(data);
      if (success) {
        form.reset();
        onClose();
      }
    } catch (err) {
      console.error("Failed to submit tenant:", err);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="fixed top-1/2 left-1/2 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-auto max-h-[92vh] rounded-2xl bg-card dark:bg-gray-900 border border-border dark:border-gray-800 shadow-2xl p-0">

        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-border dark:border-gray-800" >
          <DialogTitle className="text-lg font-semibold text-foreground">
            {isEditing ? "Edit Tenant" : "Add Tenant"}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground mt-0.5">
            {isEditing
              ? "Update the tenant's information below."
              : `Fill in the details to add a tenant${propertyName ? ` to ${propertyName}` : ""}.`}
          </DialogDescription>
        </div>

        <form onSubmit={form.handleSubmit(handleFormSubmit)}>
          <div className="px-6 py-5 space-y-5 overflow-y-auto max-h-[calc(92vh-160px)]">

            {/* Section: Personal */}
            <div>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-3">Personal Information</p>
              <div className="grid grid-cols-2 gap-4">
                <Field label="First Name" error={errors.firstName?.message}>
                  <Input {...form.register("firstName")} className={inputCls} placeholder="e.g. Jane" />
                </Field>
                <Field label="Last Name" error={errors.lastName?.message}>
                  <Input {...form.register("lastName")} className={inputCls} placeholder="e.g. Doe" />
                </Field>
                <Field label="Email" error={errors.email?.message}>
                  <Input type="email" {...form.register("email")} className={inputCls} placeholder="jane@example.com" />
                </Field>
                <Field label="Phone" error={errors.phone?.message}>
                  <Input {...form.register("phone")} className={inputCls} placeholder="+254 700 000 000" />
                </Field>
              </div>
            </div>

            {/* Section: Unit & Status */}
            <div>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-3">Unit & Status</p>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Unit" error={errors.unitId?.message}>
                  <Controller
                    control={form.control}
                    name="unitId"
                    render={({ field }) => (
                      <Select
                        value={field.value ? String(field.value) : ""}
                        onValueChange={v => field.onChange(Number(v))}
                      >
                        <SelectTrigger className={inputCls}>
                          <SelectValue placeholder="Select unit" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableUnits.length === 0 ? (
                            <SelectItem value="_none" disabled>No vacant units</SelectItem>
                          ) : (
                            availableUnits.map(u => (
                              <SelectItem key={u.id} value={String(u.id)}>
                                Unit {u.unitNumber} — Ksh {u.monthlyRent.toLocaleString()}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>

                <Field label="Status" error={errors.status?.message}>
                  <Controller
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger className={inputCls}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="pending">Pending</SelectItem>
                          <SelectItem value="inactive">Inactive</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>
              </div>
            </div>

            {/* Section: Lease */}
            <div>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-3">Lease Details</p>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Lease Start" error={errors.leaseStartDate?.message}>
                  <Input type="date" {...form.register("leaseStartDate")} className={inputCls} />
                </Field>
                <Field label="Lease End" error={errors.leaseEndDate?.message}>
                  <Input type="date" {...form.register("leaseEndDate")} className={inputCls} />
                </Field>
              </div>
            </div>

            {/* Section: Financials */}
            <div>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-3">Financials</p>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Monthly Rent (Ksh)" error={errors.monthlyRent?.message}>
                  <Input
                    type="number"
                    min={0}
                    {...form.register("monthlyRent")}
                    className={inputCls}
                    placeholder="e.g. 25000"
                  />
                </Field>
                <Field label="Security Deposit (Ksh)" error={errors.securityDeposit?.message}>
                  <Input
                    type="number"
                    min={0}
                    {...form.register("securityDeposit")}
                    className={inputCls}
                    placeholder="e.g. 25000"
                  />
                  <p className="text-[11px] text-muted-foreground">Auto-filled to 1 month's rent</p>
                </Field>
              </div>
            </div>

          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-border dark:border-gray-800 flex justify-end gap-2.5 bg-muted/20">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isSubmitting}
              className="bg-blue-600 hover:bg-blue-700 text-white min-w-[110px]"
            >
              {isSubmitting && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              {isEditing ? "Update Tenant" : "Add Tenant"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}