import React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DollarSign, UserPlus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

// Form validation schema
const staffFormSchema = z.object({
 employee_id: z.string().min(1, "Employee ID is required"),
 first_name: z.string().min(1, "First name is required"),
 last_name: z.string().min(1, "Last name is required"),
 position: z.string().min(1, "Position is required"),
 department: z.string().min(1, "Department is required"),
 employment_type: z.string().min(1, "Employment type is required"),
 hire_date: z.string().min(1, "Hire date is required"),
 status: z.string().min(1, "Status is required"),
 currency: z.string().min(1, "Currency is required"),
 address: z.string().optional(),
 phone: z.string().optional(),
 email: z.string().email("Invalid email address").optional().or(z.literal("")),
 salary: z.coerce.number().optional(),
 hourly_rate: z.coerce.number().optional(),
 emergency_contact_name: z.string().optional(),
 emergency_contact_phone: z.string().optional(),
});

export type StaffFormData = z.infer<typeof staffFormSchema>;

// Position options for dropdown
export const POSITION_OPTIONS = [
 { value: "property_manager", label: "Property Manager" },
 { value: "leasing_agent", label: "Leasing Agent" },
 { value: "maintenance_supervisor", label: "Maintenance Supervisor" },
 { value: "technician", label: "Maintenance Technician" },
 { value: "groundskeeper", label: "Groundskeeper" },
 { value: "janitor", label: "Janitor" },
 { value: "security_guard", label: "Security Guard" },
 { value: "concierge", label: "Concierge" },
 { value: "administrative_assistant", label: "Administrative Assistant" },
 { value: "accountant", label: "Accountant" },
 { value: "accounts_receivable", label: "Accounts Receivable Specialist" },
 { value: "accounts_payable", label: "Accounts Payable Specialist" },
 { value: "marketing_specialist", label: "Marketing Specialist" },
 { value: "it_specialist", label: "IT Specialist" },
 { value: "hr_manager", label: "HR Manager" },
 { value: "facilities_manager", label: "Facilities Manager" },
 { value: "portfolio_manager", label: "Portfolio Manager" },
 { value: "regional_manager", label: "Regional Manager" },
 { value: "compliance_officer", label: "Compliance Officer" },
 { value: "customer_service", label: "Customer Service Representative" },
 { value: "other", label: "Other" },
];

interface StaffFormModalProps {
 isOpen: boolean;
 onOpenChange: (open: boolean) => void;
 defaultValues?: Partial<StaffFormData>;
 mode?: "add" | "edit";
 staffId?: number;
 onSuccess?: () => void;
}

export default function StaffFormModal({
 isOpen,
 onOpenChange,
 defaultValues = {},
 mode = "add",
 staffId,
 onSuccess,
}: StaffFormModalProps) {
 const { toast } = useToast();
 const queryClient = useQueryClient();

 // Initialize form
 const form = useForm<StaffFormData>({
 resolver: zodResolver(staffFormSchema),
 defaultValues: {
 employee_id: "",
 first_name: "",
 last_name: "",
 position: "",
 department: "",
 employment_type: "full_time",
 hire_date: "",
 currency: "KES",
 status: "active",
 address: "",
 phone: "",
 email: "",
 salary: undefined,
 hourly_rate: undefined,
 emergency_contact_name: "",
 emergency_contact_phone: "",
 ...defaultValues,
 },
 });

 // Mutations
 const createStaffMutation = useMutation({
 mutationFn: async (data: StaffFormData) => {
 return apiRequest("/api/staff-members", {
 method: "POST",
 data,
 });
 },
 onSuccess: () => {
 toast({
 title: "Success",
 description: "Staff member added successfully",
 });
 queryClient.invalidateQueries({ queryKey: ["/api/staff-members"] });
 onOpenChange(false);
 form.reset();
 onSuccess?.();
 },
 onError: (error: any) => {
 toast({
 title: "Error",
 description: error.message || "Failed to add staff member",
 variant: "destructive",
 });
 },
 });

 const updateStaffMutation = useMutation({
 mutationFn: async (data: StaffFormData) => {
 return apiRequest(`/api/staff-members/${staffId}`, {
 method: "PATCH",
 data,
 });
 },
 onSuccess: () => {
 toast({
 title: "Success",
 description: "Staff member updated successfully",
 className: "bg-card text-foreground shadow-md",
 });
 queryClient.invalidateQueries({ queryKey: ["/api/staff-members"] });
 onOpenChange(false);
 onSuccess?.();
 },
 onError: (error: any) => {
 toast({
 title: "Error",
 description: error.message || "Failed to update staff member",
 variant: "destructive",
 });
 },
 });

 const handleSubmit = (data: StaffFormData) => {
 const toNumOrUndefined = (v: any) => {
   if (v === undefined || v === null || v === "") return undefined;
   const n = parseFloat(String(v));
   return isFinite(n) ? n : undefined;
 };
 const cleaned: StaffFormData = {
   ...data,
   salary: toNumOrUndefined(data.salary),
   hourly_rate: toNumOrUndefined(data.hourly_rate),
 };
 if (mode === "add") {
 createStaffMutation.mutate(cleaned);
 } else {
 updateStaffMutation.mutate(cleaned);
 }
 };

 const isPending = createStaffMutation.isPending || updateStaffMutation.isPending;
 const title = mode === "add" ? "Add New Staff Member" : "Edit Staff Member";
 const description = mode === "add" 
 ? "Enter the staff member's information to add them to the workforce" 
 : "Update the staff member's information";
 const submitButtonText = mode === "add" ? "Add Staff Member" : "Update Staff Member";

 return (
 <Dialog open={isOpen} onOpenChange={onOpenChange}>
 <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-card shadow-xl rounded-lg p-0 border-0">
 <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-6 py-4 border-b border-border">
 <DialogHeader>
 <DialogTitle className="text-2xl font-semibold text-foreground">{title}</DialogTitle>
 <DialogDescription className="text-muted-foreground">
 {description}
 </DialogDescription>
 </DialogHeader>
 </div>
 
 <div className="p-6">
 <Form {...form}>
 <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-8">
 {/* Basic Information */}
 <div className="space-y-6">
 <div className="flex items-center space-x-3">
 <div className="h-8 w-1 bg-blue-500 rounded-full"></div>
 <h3 className="text-lg font-semibold text-foreground">Basic Information</h3>
 </div>
 <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
 <FormField
 control={form.control}
 name="employee_id"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-sm font-medium text-foreground">Employee ID *</FormLabel>
 <FormControl>
 <Input 
 placeholder="EMP001" 
 {...field}
 className="border-border focus:border-blue-300 focus:ring-blue-200 transition-all"
 />
 </FormControl>
 <FormMessage className="text-xs" />
 </FormItem>
 )}
 />
 <FormField
 control={form.control}
 name="first_name"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-sm font-medium text-foreground">First Name *</FormLabel>
 <FormControl>
 <Input 
 {...field}
 className="border-border focus:border-blue-300 focus:ring-blue-200 transition-all"
 />
 </FormControl>
 <FormMessage className="text-xs" />
 </FormItem>
 )}
 />
 <FormField
 control={form.control}
 name="last_name"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-sm font-medium text-foreground">Last Name *</FormLabel>
 <FormControl>
 <Input 
 {...field}
 className="border-border focus:border-blue-300 focus:ring-blue-200 transition-all"
 />
 </FormControl>
 <FormMessage className="text-xs" />
 </FormItem>
 )}
 />
 </div>
 
 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
 <FormField
 control={form.control}
 name="email"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-sm font-medium text-foreground">Email</FormLabel>
 <FormControl>
 <Input 
 type="email" 
 {...field}
 className="border-border focus:border-blue-300 focus:ring-blue-200 transition-all"
 />
 </FormControl>
 <FormMessage className="text-xs" />
 </FormItem>
 )}
 />
 <FormField
 control={form.control}
 name="phone"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-sm font-medium text-foreground">Phone Number</FormLabel>
 <FormControl>
 <Input 
 {...field}
 className="border-border focus:border-blue-300 focus:ring-blue-200 transition-all"
 />
 </FormControl>
 <FormMessage className="text-xs" />
 </FormItem>
 )}
 />
 </div>
 </div>

 {/* Employment Details */}
 <div className="space-y-6">
 <div className="flex items-center space-x-3">
 <div className="h-8 w-1 bg-indigo-500 rounded-full"></div>
 <h3 className="text-lg font-semibold text-foreground">Employment Details</h3>
 </div>
 <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
 <FormField
 control={form.control}
 name="position"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-sm font-medium text-foreground">Position *</FormLabel>
 <Select onValueChange={field.onChange} value={field.value}>
 <FormControl>
 <SelectTrigger className="border-border focus:border-blue-300 focus:ring-blue-200 transition-all">
 <SelectValue placeholder="Select position" />
 </SelectTrigger>
 </FormControl>
 <SelectContent className="border-border shadow-lg max-h-60">
 {POSITION_OPTIONS.map((position) => (
 <SelectItem key={position.value} value={position.value}>
 {position.label}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 <FormMessage className="text-xs" />
 </FormItem>
 )}
 />
 
 <FormField
 control={form.control}
 name="department"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-sm font-medium text-foreground">Department *</FormLabel>
 <Select onValueChange={field.onChange} value={field.value}>
 <FormControl>
 <SelectTrigger className="border-border focus:border-blue-300 focus:ring-blue-200 transition-all">
 <SelectValue placeholder="Select department" />
 </SelectTrigger>
 </FormControl>
 <SelectContent className="border-border shadow-lg">
 <SelectItem value="property_management">Property Management</SelectItem>
 <SelectItem value="maintenance">Maintenance</SelectItem>
 <SelectItem value="security">Security</SelectItem>
 <SelectItem value="finance">Finance</SelectItem>
 <SelectItem value="hr">Human Resources</SelectItem>
 <SelectItem value="administration">Administration</SelectItem>
 <SelectItem value="marketing">Marketing</SelectItem>
 </SelectContent>
 </Select>
 <FormMessage className="text-xs" />
 </FormItem>
 )}
 />
 <FormField
 control={form.control}
 name="employment_type"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-sm font-medium text-foreground">Employment Type *</FormLabel>
 <Select onValueChange={field.onChange} value={field.value}>
 <FormControl>
 <SelectTrigger className="border-border focus:border-blue-300 focus:ring-blue-200 transition-all">
 <SelectValue placeholder="Select type" />
 </SelectTrigger>
 </FormControl>
 <SelectContent className="border-border shadow-lg">
 <SelectItem value="full_time">Full Time</SelectItem>
 <SelectItem value="part_time">Part Time</SelectItem>
 <SelectItem value="contract">Contract</SelectItem>
 <SelectItem value="casual">Casual</SelectItem>
 <SelectItem value="intern">Intern</SelectItem>
 </SelectContent>
 </Select>
 <FormMessage className="text-xs" />
 </FormItem>
 )}
 />
 </div>
 
 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
 <FormField
 control={form.control}
 name="hire_date"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-sm font-medium text-foreground">Hire Date *</FormLabel>
 <FormControl>
 <Input 
 type="date" 
 {...field}
 className="border-border focus:border-blue-300 focus:ring-blue-200 transition-all"
 />
 </FormControl>
 <FormMessage className="text-xs" />
 </FormItem>
 )}
 />
 <FormField
 control={form.control}
 name="status"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-sm font-medium text-foreground">Status</FormLabel>
 <Select onValueChange={field.onChange} value={field.value}>
 <FormControl>
 <SelectTrigger className="border-border focus:border-blue-300 focus:ring-blue-200 transition-all">
 <SelectValue placeholder="Select status" />
 </SelectTrigger>
 </FormControl>
 <SelectContent className="border-border shadow-lg">
 <SelectItem value="active">Active</SelectItem>
 <SelectItem value="inactive">Inactive</SelectItem>
 <SelectItem value="terminated">Terminated</SelectItem>
 <SelectItem value="on_leave">On Leave</SelectItem>
 </SelectContent>
 </Select>
 <FormMessage className="text-xs" />
 </FormItem>
 )}
 />
 </div>
 </div>

 {/* Compensation */}
 <div className="space-y-6">
 <div className="flex items-center space-x-3">
 <div className="h-8 w-1 bg-green-500 rounded-full"></div>
 <h3 className="text-lg font-semibold text-foreground">Compensation</h3>
 </div>
 <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
 <FormField
 control={form.control}
 name="salary"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-sm font-medium text-foreground">Monthly Salary (KES)</FormLabel>
 <FormControl>
 <Input 
 type="number" 
 {...field}
 value={field.value === undefined || field.value === null ? "" : field.value}
 onChange={(e) => field.onChange(e.target.value === '' ? undefined : parseFloat(e.target.value))}
 className="border-border focus:border-blue-300 focus:ring-blue-200 transition-all"
 />
 </FormControl>
 <FormMessage className="text-xs" />
 </FormItem>
 )}
 />
 <FormField
 control={form.control}
 name="hourly_rate"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-sm font-medium text-foreground">Hourly Rate (KES)</FormLabel>
 <FormControl>
 <Input 
 type="number" 
 {...field}
 value={field.value === undefined || field.value === null ? "" : field.value}
 onChange={(e) => field.onChange(e.target.value === '' ? undefined : parseFloat(e.target.value))}
 className="border-border focus:border-blue-300 focus:ring-blue-200 transition-all"
 />
 </FormControl>
 <FormMessage className="text-xs" />
 </FormItem>
 )}
 />
 <FormField
 control={form.control}
 name="currency"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-sm font-medium text-foreground">Currency</FormLabel>
 <Select onValueChange={field.onChange} value={field.value}>
 <FormControl>
 <SelectTrigger className="border-border focus:border-blue-300 focus:ring-blue-200 transition-all">
 <SelectValue placeholder="Select currency" />
 </SelectTrigger>
 </FormControl>
 <SelectContent className="border-border shadow-lg">
 <SelectItem value="KES">KES - Kenyan Shilling</SelectItem>
 <SelectItem value="USD">USD - US Dollar</SelectItem>
 <SelectItem value="EUR">EUR - Euro</SelectItem>
 <SelectItem value="GBP">GBP - British Pound</SelectItem>
 </SelectContent>
 </Select>
 <FormMessage className="text-xs" />
 </FormItem>
 )}
 />
 </div>
 </div>

 {/* Additional Information */}
 <div className="space-y-6">
 <div className="flex items-center space-x-3">
 <div className="h-8 w-1 bg-purple-500 rounded-full"></div>
 <h3 className="text-lg font-semibold text-foreground">Additional Information</h3>
 </div>
 <div className="grid grid-cols-1 gap-6">
 <FormField
 control={form.control}
 name="address"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-sm font-medium text-foreground">Address</FormLabel>
 <FormControl>
 <Textarea 
 placeholder="Full address..." 
 rows={2} 
 {...field}
 className="border-border focus:border-blue-300 focus:ring-blue-200 transition-all resize-none"
 />
 </FormControl>
 <FormMessage className="text-xs" />
 </FormItem>
 )}
 />
 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
 <FormField
 control={form.control}
 name="emergency_contact_name"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-sm font-medium text-foreground">Emergency Contact Name</FormLabel>
 <FormControl>
 <Input 
 {...field}
 className="border-border focus:border-blue-300 focus:ring-blue-200 transition-all"
 />
 </FormControl>
 <FormMessage className="text-xs" />
 </FormItem>
 )}
 />
 <FormField
 control={form.control}
 name="emergency_contact_phone"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-sm font-medium text-foreground">Emergency Contact Phone</FormLabel>
 <FormControl>
 <Input 
 {...field}
 className="border-border focus:border-blue-300 focus:ring-blue-200 transition-all"
 />
 </FormControl>
 <FormMessage className="text-xs" />
 </FormItem>
 )}
 />
 </div>
 </div>
 </div>

 <div className="flex justify-end space-x-3 pt-6 border-t border-border">
 <Button 
 type="button" 
 variant="outline" 
 onClick={() => onOpenChange(false)}
 disabled={isPending}
 className="border-border hover:bg-muted hover:border-border transition-all"
 >
 Cancel
 </Button>
 <Button 
 type="submit" 
 disabled={isPending}
 data-testid="button-submit-staff"
 className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-md hover:shadow-lg transition-all"
 >
 {isPending ? (
 <>
 <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
 {mode === "add" ? "Adding..." : "Updating..."}
 </>
 ) : (
 <>
 <UserPlus className="h-4 w-4 mr-2" />
 {submitButtonText}
 </>
 )}
 </Button>
 </div>
 </form>
 </Form>
 </div>
 </DialogContent>
 </Dialog>
 );
}