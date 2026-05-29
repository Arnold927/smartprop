import { useState } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
 Dialog,
 DialogContent,
 DialogHeader,
 DialogTitle,
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
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";

const addTenantSchema = z.object({
 firstName: z.string().min(1, "First name is required"),
 lastName: z.string().min(1, "Last name is required"),
 email: z.string().email("Invalid email address"),
 phone: z.string().optional(),
 unitId: z.number().min(1, "Unit selection is required"),
 monthlyRent: z.string().min(1, "Monthly rent is required"),
 leaseStartDate: z.string().min(1, "Lease start date is required"),
 status: z.string().default("active"),
});

type AddTenantForm = z.infer<typeof addTenantSchema>;

interface AddTenantModalProps {
 isOpen: boolean;
 onClose: () => void;
}

export default function AddTenantModal({ isOpen, onClose }: AddTenantModalProps) {
 const queryClient = useQueryClient();
 const { toast } = useToast();
 const [selectedProperty, setSelectedProperty] = useState<string>("");

 const { data: properties = [] } = useQuery({
 queryKey: ["/api/properties"],
 });

 const { data: units = [] } = useQuery({
 queryKey: ["/api/properties", selectedProperty, "units"],
 queryFn: async () => {
 const res = await apiRequest(`/api/properties/${selectedProperty}/units`);
 return res.json();
 },
 enabled: !!selectedProperty,
 });

 const form = useForm<AddTenantForm>({
 resolver: zodResolver(addTenantSchema),
 defaultValues: {
 firstName: "",
 lastName: "",
 email: "",
 phone: "",
 monthlyRent: "",
 leaseStartDate: "",
 status: "active",
 },
 });

 const addTenantMutation = useMutation({
 mutationFn: async (data: AddTenantForm) => {
 const payload = {
 ...data,
 unitId: Number(data.unitId),
 monthlyRent: data.monthlyRent,
 };
 await apiRequest("/api/tenants", { method: "POST", data: payload });
 },
 onSuccess: () => {
 queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
 queryClient.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
 form.reset();
 onClose();
 toast({
 title: "Success",
 description: "Tenant added successfully",
 });
 },
 onError: (error) => {
 if (isUnauthorizedError(error)) {
 toast({
 title: "Unauthorized",
 description: "You are logged out. Logging in again...",
 variant: "destructive",
 });
 setTimeout(() => {
 window.location.href = "/auth";
 }, 500);
 return;
 }
 console.error("Error adding tenant:", error);
 toast({
 title: "Error",
 description: "Failed to add tenant. Please try again.",
 variant: "destructive",
 });
 },
 });

 const onSubmit = (data: AddTenantForm) => {
 addTenantMutation.mutate(data);
 };

 const handleClose = () => {
 form.reset();
 setSelectedProperty("");
 onClose();
 };

 return (
 <Dialog open={isOpen} onOpenChange={handleClose}>
 <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
 <DialogHeader>
 <DialogTitle>Add New Tenant</DialogTitle>
 </DialogHeader>
 
 <Form {...form}>
 <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
 <FormField
 control={form.control}
 name="firstName"
 render={({ field }) => (
 <FormItem>
 <FormLabel>First Name *</FormLabel>
 <FormControl>
 <Input placeholder="Enter first name" {...field} />
 </FormControl>
 <FormMessage />
 </FormItem>
 )}
 />

 <FormField
 control={form.control}
 name="lastName"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Last Name *</FormLabel>
 <FormControl>
 <Input placeholder="Enter last name" {...field} />
 </FormControl>
 <FormMessage />
 </FormItem>
 )}
 />

 <FormField
 control={form.control}
 name="email"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Email Address *</FormLabel>
 <FormControl>
 <Input type="email" placeholder="Enter email address" {...field} />
 </FormControl>
 <FormMessage />
 </FormItem>
 )}
 />

 <FormField
 control={form.control}
 name="phone"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Phone Number</FormLabel>
 <FormControl>
 <Input type="tel" placeholder="Enter phone number" {...field} />
 </FormControl>
 <FormMessage />
 </FormItem>
 )}
 />

 <FormItem>
 <FormLabel>Property *</FormLabel>
 <Select value={selectedProperty} onValueChange={setSelectedProperty}>
 <SelectTrigger>
 <SelectValue placeholder="Select Property" />
 </SelectTrigger>
 <SelectContent>
 {(properties as any[] || []).map((property: any) => (
 <SelectItem key={property.id} value={property.id.toString()}>
 {property.name}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </FormItem>

 <FormField
 control={form.control}
 name="unitId"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Unit *</FormLabel>
 <Select
 value={field.value?.toString()}
 onValueChange={(value) => field.onChange(Number(value))}
 disabled={!selectedProperty}
 >
 <SelectTrigger>
 <SelectValue placeholder="Select Unit" />
 </SelectTrigger>
 <SelectContent>
 {(units as any[] || []).map((unit: any) => (
 <SelectItem key={unit.id} value={unit.id.toString()}>
 {unit.unitNumber}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 <FormMessage />
 </FormItem>
 )}
 />

 <FormField
 control={form.control}
 name="monthlyRent"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Monthly Rent *</FormLabel>
 <FormControl>
 <Input type="number" step="0.01" placeholder="0.00" {...field} />
 </FormControl>
 <FormMessage />
 </FormItem>
 )}
 />

 <FormField
 control={form.control}
 name="leaseStartDate"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Lease Start Date *</FormLabel>
 <FormControl>
 <Input type="date" {...field} />
 </FormControl>
 <FormMessage />
 </FormItem>
 )}
 />
 </div>

 <div className="flex justify-end space-x-3">
 <Button type="button" variant="outline" onClick={handleClose}>
 Cancel
 </Button>
 <Button 
 type="submit" 
 disabled={addTenantMutation.isPending}
 >
 {addTenantMutation.isPending ? "Adding..." : "Add Tenant"}
 </Button>
 </div>
 </form>
 </Form>
 </DialogContent>
 </Dialog>
 );
}
