import { useState, useEffect } from "react"; // Add useEffect
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
 Dialog,
 DialogContent,
 DialogHeader,
 DialogTitle,
 DialogDescription,
} from "@/components/ui/dialog";
import {
 Form,
 FormControl,
 FormField,
 FormItem,
 FormLabel,
 FormMessage,
} from "@/components/ui/form";
import {
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { AlertCircle, CheckCircle2, AlertTriangle, Info, Home, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const addMaintenanceSchema = z.object({
 tenantId: z.number().min(1, "Tenant selection is required"),
 unitId: z.number().min(1, "Unit selection is required"),
 title: z.string().min(1, "Title is required").max(100, "Title must be less than 100 characters"),
 description: z.string().min(1, "Description is required").max(500, "Description must be less than 500 characters"),
 priority: z.enum(["low", "medium", "high", "urgent"]),
 estimatedCost: z.string().regex(/^\d*\.?\d{0,2}$/, "Enter a valid amount").optional(),
});

type AddMaintenanceForm = z.infer<typeof addMaintenanceSchema>;

interface AddMaintenanceModalProps {
 isOpen: boolean;
 onClose: () => void;
 onSuccess?: () => void;
 preSelectedTenantId?: number;
}

interface Tenant {
 id: number;
 firstName: string;
 lastName: string;
 email: string;
 phone?: string;
 unitId: number | null;
 unit?: {
 id: number;
 unitNumber: string;
 propertyId: number;
 } | null;
 property?: {
 id: number;
 name: string;
 ownerId: string;
 } | null;
 leaseStartDate?: string | null;
 leaseEndDate?: string | null;
 monthlyRent?: string | null;
 status: string;
}


function getPriorityConfigModal(t: (k:string)=>string) { return {
 low: {
 label: t("tenantPortal.priorityLow"),
 color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
 icon: Info,
 description: "Non-urgent, can be scheduled"
 },
 medium: {
 label: t("tenantPortal.priorityMedium"),
 color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
 icon: AlertCircle,
 description: "Should be addressed soon"
 },
 high: {
 label: t("tenantPortal.priorityHigh"),
 color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
 icon: AlertTriangle,
 description: "Needs prompt attention"
 },
 urgent: {
 label: t("tenantPortal.priorityUrgent"),
 color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
 icon: AlertCircle,
 description: "Immediate action required"
 }
}; };

export default function AddMaintenanceModal({ 
 isOpen, 
 onClose, 
 preSelectedTenantId // Add this prop
}: AddMaintenanceModalProps) {
  const { t } = useTranslation();
  const priorityConfig = getPriorityConfigModal(t);
 const queryClient = useQueryClient();
 const { toast } = useToast();
 const [selectedTenant, setSelectedTenant] = useState<string>("");
 const [selectedPriority, setSelectedPriority] = useState<string>("medium");

 const { data: tenants = [], isLoading: isLoadingTenants } = useQuery<Tenant[]>({
 queryKey: ["/api/tenants"],
 });

 const form = useForm<AddMaintenanceForm>({
 resolver: zodResolver(addMaintenanceSchema),
 defaultValues: {
 tenantId: 0,
 unitId: 0,
 title: "",
 description: "",
 priority: "medium",
 estimatedCost: "",
 },
 mode: "onChange",
 });

 // Effect to pre-select tenant when modal opens
 useEffect(() => {
 if (isOpen && preSelectedTenantId && tenants.length > 0) {
 const tenant = tenants.find(t => t.id === preSelectedTenantId);
 if (tenant) {
 const tenantIdStr = tenant.id.toString();
 setSelectedTenant(tenantIdStr);
 
 if (tenant.unitId) {
 form.setValue("tenantId", tenant.id, { shouldValidate: true });
 form.setValue("unitId", tenant.unitId, { shouldValidate: true });
 } else {
 toast({
 title: "Cannot proceed",
 description: "This tenant is not assigned to any unit. Please assign a unit first.",
 variant: "destructive",
 });
 }
 }
 }
 }, [isOpen, preSelectedTenantId, tenants, form, toast]);

 const addMaintenanceMutation = useMutation({
 mutationFn: async (data: AddMaintenanceForm) => {
 const payload = {
 ...data,
 tenantId: Number(data.tenantId),
 unitId: Number(data.unitId),
 estimatedCost: data.estimatedCost ? parseFloat(data.estimatedCost) : undefined,
 };
 return await apiRequest("/api/maintenance-requests", {
 method: "POST",
 data: payload,
 });
 },
 onSuccess: () => {
 queryClient.invalidateQueries({ queryKey: ["/api/maintenance-requests"] });
 queryClient.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
 form.reset();
 setSelectedTenant("");
 toast({
 title: "Success!",
 description: "Maintenance request has been created successfully",
 });
 onSuccess?.();
 onClose();
 },
 onError: (error) => {
 if (isUnauthorizedError(error)) {
 toast({
 title: "Session expired",
 description: "Please log in again to continue",
 variant: "destructive",
 });
 setTimeout(() => {
 window.location.href = "/auth";
 }, 500);
 return;
 }
 toast({
 title: "Unable to create request",
 description: "There was an error creating the maintenance request. Please try again.",
 variant: "destructive",
 });
 },
 });

 const onSubmit = (data: AddMaintenanceForm) => {
 addMaintenanceMutation.mutate(data);
 };

 const handleClose = () => {
 form.reset();
 setSelectedTenant("");
 onClose();
 };

 const handleTenantChange = (tenantId: string) => {
 setSelectedTenant(tenantId);
 
 const tenant = tenants?.find((t: Tenant) => t.id.toString() === tenantId);
 
 if (tenant) {
 if (tenant.unitId) {
 form.setValue("tenantId", parseInt(tenantId), { shouldValidate: true });
 form.setValue("unitId", tenant.unitId, { shouldValidate: true });
 } else {
 toast({
 title: "Cannot proceed",
 description: "This tenant is not assigned to any unit. Please assign a unit first.",
 variant: "destructive",
 });
 setSelectedTenant("");
 form.setValue("tenantId", 0, { shouldValidate: true });
 form.setValue("unitId", 0, { shouldValidate: true });
 }
 }
 };

 const handlePriorityChange = (priority: string) => {
 setSelectedPriority(priority);
 form.setValue("priority", priority as any, { shouldValidate: true });
 };

 const selectedTenantData = tenants?.find(t => t.id.toString() === selectedTenant);
 const PriorityIcon = priorityConfig[selectedPriority as keyof typeof priorityConfig]?.icon || AlertCircle;

 return (
 <Dialog open={isOpen} onOpenChange={handleClose}>
 <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto p-0 bg-card dark:bg-gray-900 border border-border dark:border-gray-800 rounded-lg shadow-xl">
 <div className="relative">
 {/* Header with gradient background */}
 <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 dark:from-emerald-800 dark:to-emerald-900 px-6 py-4">
 <DialogHeader className="space-y-1">
 <DialogTitle className="text-white text-lg font-semibold flex items-center gap-2">
 <AlertCircle className="h-5 w-5" />
 New Maintenance Request
 {preSelectedTenantId && selectedTenantData && (
 <span className="text-sm font-normal ml-2">
 for {selectedTenantData.firstName} {selectedTenantData.lastName}
 </span>
 )}
 </DialogTitle>
 <DialogDescription className="text-emerald-100">
 {preSelectedTenantId 
 ? "Report an issue for this tenant" 
 : "Report an issue that needs attention"}
 </DialogDescription>
 </DialogHeader>
 </div>

 {/* Form content */}
 <div className="px-6 py-4">
 <Form {...form}>
 <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
 {/* Tenant Selection */}
 <div className="space-y-3">
 <div className="flex items-center gap-2">
 <User className="h-4 w-4 text-muted-foreground" />
 <h3 className="text-sm font-medium text-foreground dark:text-muted-foreground">Tenant Information</h3>
 {preSelectedTenantId && (
 <Badge variant="secondary" className="ml-2">
 Pre-selected
 </Badge>
 )}
 </div>
 
 {preSelectedTenantId ? (
 // When tenant is pre-selected, show read-only info
 <div className="space-y-3">
 <div className="p-3 bg-muted dark:bg-gray-800 rounded-md border">
 <p className="text-sm font-medium">
 {selectedTenantData?.firstName} {selectedTenantData?.lastName}
 </p>
 </div>
 <p className="text-xs text-muted-foreground">
 Tenant is pre-selected from the tenant detail page. 
 {!selectedTenantData?.unitId && " To change tenant, close this modal and open it from a different page."}
 </p>
 </div>
 ) : (
 // When no pre-selected tenant, show dropdown
 <FormField
 control={form.control}
 name="tenantId"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-sm font-medium">Select Tenant *</FormLabel>
 <Select 
 value={selectedTenant} 
 onValueChange={(value) => {
 handleTenantChange(value);
 field.onChange(parseInt(value));
 }}
 disabled={isLoadingTenants}
 >
 <SelectTrigger className="h-10 w-full border-border dark:border-gray-700 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" >
 <SelectValue placeholder={isLoadingTenants ? "Loading tenants..." : "Choose a tenant"} />
 </SelectTrigger>
 <SelectContent className="max-h-60">
 {tenants?.map((tenant: Tenant) => (
 <SelectItem 
 key={tenant.id} 
 value={tenant.id.toString()}
 disabled={!tenant.unitId}
 className="flex items-center justify-between"
 >
 <div className="flex flex-col">
 <span className="font-medium">
 {tenant.firstName} {tenant.lastName}
 </span>
 {tenant.unitId && tenant.unit ? (
 <span className="text-xs text-muted-foreground flex items-center gap-1">
 <Home className="h-3 w-3" />
 Unit {tenant.unit.unitNumber}
 {tenant.property?.name && (
 <span className="text-muted-foreground">• {tenant.property.name}</span>
 )}
 </span>
 ) : (
 <span className="text-xs text-amber-600">No unit assigned</span>
 )}
 </div>
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 <FormMessage />
 </FormItem>
 )}
 />
 )}
 </div>

 {/* Only show rest of form if tenant has a unit */}
 {selectedTenantData?.unitId && (
 <>
 <Separator />

 {/* Priority Selection */}
 <div className="space-y-3">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2">
 <AlertTriangle className="h-4 w-4 text-muted-foreground" />
 <h3 className="text-sm font-medium text-foreground dark:text-muted-foreground">Priority Level</h3>
 </div>
 {selectedPriority && (
 <Badge className={priorityConfig[selectedPriority as keyof typeof priorityConfig]?.color}>
 <PriorityIcon className="h-3 w-3 mr-1" />
 {priorityConfig[selectedPriority as keyof typeof priorityConfig]?.label}
 </Badge>
 )}
 </div>
 
 <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
 {Object.entries(priorityConfig).map(([value, config]) => {
 const Icon = config.icon;
 return (
 <button
 key={value}
 type="button"
 onClick={() => handlePriorityChange(value)}
 className={`relative flex flex-col items-center justify-center p-3 rounded-md border transition-all duration-200 ${
 selectedPriority === value
 ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30 ring-2 ring-blue-500/20"
 : "border-border dark:border-gray-800 hover:border-border dark:hover:border-gray-700 hover:bg-muted dark:hover:bg-gray-800/50"
 }`}
 >
 <Icon className={`h-5 w-5 mb-2 ${
 selectedPriority === value 
 ? "text-blue-600 dark:text-blue-400"
 : "text-muted-foreground"
 }`} />
 <span className={`text-xs font-medium ${
 selectedPriority === value
 ? "text-blue-700 dark:text-blue-300"
 : "text-foreground dark:text-muted-foreground"
 }`}>
 {config.label}
 </span>
 </button>
 );
 })}
 </div>
 {selectedPriority && (
 <p className="text-xs text-muted-foreground dark:text-muted-foreground px-1">
 {priorityConfig[selectedPriority as keyof typeof priorityConfig]?.description}
 </p>
 )}
 <FormField
 control={form.control}
 name="priority"
 render={({ field }) => (
 <FormItem className="hidden">
 <FormControl>
 <Input type="hidden" {...field} />
 </FormControl>
 <FormMessage />
 </FormItem>
 )}
 />
 </div>

 <Separator />

 {/* Issue Details */}
 <div className="space-y-3">
 <h3 className="text-sm font-medium text-foreground dark:text-muted-foreground">Issue Details</h3>
 <FormField
 control={form.control}
 name="title"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-sm font-medium">Issue Title *</FormLabel>
 <FormControl>
 <Input 
 placeholder="e.g., Kitchen sink leaking, AC not working"
 className="h-10 border-border dark:border-gray-700 focus:ring-2 focus:ring-emerald-500"
 {...field}
 />
 </FormControl>
 <div className="flex justify-between">
 <FormMessage />
 <span className="text-xs text-muted-foreground">
 {field.value.length}/100
 </span>
 </div>
 </FormItem>
 )}
 />

 <FormField
 control={form.control}
 name="description"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-sm font-medium">Detailed Description *</FormLabel>
 <FormControl>
 <Textarea 
 className="min-h-[100px] border-border dark:border-gray-700 focus:ring-2 focus:ring-emerald-500"
 {...field}
 />
 </FormControl>
 <div className="flex justify-between">
 <FormMessage />
 <span className="text-xs text-muted-foreground">
 {field.value.length}/500
 </span>
 </div>
 </FormItem>
 )}
 />
 </div>

 {/* Form Actions */}
 <div className="flex items-center justify-between pt-4 border-t border-border dark:border-gray-800" >
 <Button 
 type="button" 
 variant="outline" 
 onClick={handleClose}
 className="border-border dark:border-gray-700"
 >
 Cancel
 </Button>
 <Button 
 type="submit" 
 disabled={addMaintenanceMutation.isPending || !form.formState.isValid}
 className="px-6 bg-emerald-600 hover:bg-emerald-700 text-white"
 >
 {addMaintenanceMutation.isPending ? (
 <>
 <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent mr-2" />
 Creating...
 </>
 ) : (
 <>
 <CheckCircle2 className="h-4 w-4 mr-2" />
 Create Maintenance Request
 </>
 )}
 </Button>
 </div>
 </>
 )}

 {/* Hidden unitId field */}
 <FormField
 control={form.control}
 name="unitId"
 render={({ field }) => (
 <FormItem className="hidden">
 <FormControl>
 <Input type="hidden" {...field} />
 </FormControl>
 <FormMessage />
 </FormItem>
 )}
 />
 </form>
 </Form>
 </div>
 </div>
 </DialogContent>
 </Dialog>
 );
}