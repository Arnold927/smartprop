import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { Loader2, Calendar as CalendarIcon, DollarSign } from "lucide-react";
import {
 Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
 Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
 Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { z } from "zod";

// Schema matching the create-work-order schema with date string validation
const editWorkOrderSchema = z.object({
 title: z.string().min(1, "Title is required").max(100),
 description: z.string().min(1, "Description is required").max(1000),
 workOrderType: z.enum(["maintenance", "project", "emergency", "preventive", "inspection"]),
 priority: z.enum(["low", "medium", "high", "critical"]),
 status: z.enum(["draft", "pending", "assigned", "in_progress", "completed", "cancelled"]),
 estimatedStartDate: z.string().optional().nullable(),
 estimatedEndDate: z.string().optional().nullable(),
 estimatedCost: z.string().optional().nullable(),
 maintenanceRequestId: z.coerce.number().int().positive().optional().nullable(),
}).refine(
 (data) => {
 if (!data.estimatedStartDate || !data.estimatedEndDate) return true;
 const start = new Date(data.estimatedStartDate);
 const end = new Date(data.estimatedEndDate);
 return end >= start;
 },
 {
 message: "End date must be after or equal to start date",
 path: ["estimatedEndDate"],
 }
);

type EditWorkOrderFormValues = z.infer<typeof editWorkOrderSchema>;

// Types for maintenance requests
interface MaintenanceRequest {
 id: number;
 title: string;
 description: string;
 status: string;
 priority: 'low' | 'medium' | 'high' | 'critical';
 createdAt: string;
 propertyId?: number;
 unitId?: number;
 requestedBy?: string;
}

interface WorkOrder {
 id: number;
 contractorId: number;
 workOrderNumber: string;
 propertyName: string;
 workOrderType: string;
 priority: 'high' | 'medium' | 'low' | 'critical';
 status: 'draft' | 'pending' | 'assigned' | 'in_progress' | 'completed' | 'cancelled';
 description?: string;
 createdAt: string;
 scheduledDate?: string;
 completedDate?: string;
 location?: string;
 estimatedCost?: number;
 assignedToName?: string;
 notes?: string;
 title?: string;
 estimatedStartDate?: string;
 estimatedEndDate?: string;
 maintenanceRequestId?: number;
 currency?: string;
 ticketNumber?: string;
}

interface EditWorkOrderDialogProps {
 open: boolean;
 onOpenChange: (open: boolean) => void;
 workOrder: WorkOrder | null;
 contractorName?: string;
 onSuccess?: () => void;
}

export function EditWorkOrderDialog({
 open,
 onOpenChange,
 workOrder,
 contractorName,
 onSuccess
}: EditWorkOrderDialogProps) {
 const { toast } = useToast();
 const queryClient = useQueryClient();
 const [userId, setUserId] = useState<string | null>(null);

 // Fetch maintenance requests
 const { data: maintenanceRequests = [], isLoading: isLoadingMR } = useQuery<MaintenanceRequest[]>({
 queryKey: ['/api/maintenance-requests'],
 queryFn: async () => {
 const response = await apiRequest('/api/maintenance-requests');
 if (!response.ok) {
 throw new Error('Failed to fetch maintenance requests');
 }
 return ensureArray(await response.json());
 },
 enabled: open,
 select: (data) => {
 const priorityOrder: Record<'critical' | 'high' | 'medium' | 'low', number> = {
 critical: 0,
 high: 1,
 medium: 2,
 low: 3
 };
 
 const filteredData = data.filter(mr => 
 mr.status === 'open' || mr.status === 'pending'
 );
 
 return filteredData.sort((a, b) => {
 const aPriority = priorityOrder[a.priority];
 const bPriority = priorityOrder[b.priority];
 return aPriority - bPriority || 
 new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
 });
 }
 });

 useEffect(() => {
 // Get user ID
 let storedUserId = localStorage.getItem('userId');
 
 if (!storedUserId) {
 const token = localStorage.getItem('access_token');
 if (token) {
 try {
 const payload = JSON.parse(atob(token.split('.')[1]));
 storedUserId = payload.id || payload.userId || payload.sub;
 } catch (error) {
 console.error("Failed to decode token:", error);
 }
 }
 }
 
 if (!storedUserId) {
 storedUserId = sessionStorage.getItem('userId');
 }
 
 if (storedUserId) {
 setUserId(storedUserId);
 } else {
 console.warn("No user ID found in storage");
 }
 }, []);

 const form = useForm<EditWorkOrderFormValues>({
 resolver: zodResolver(editWorkOrderSchema),
 defaultValues: {
 title: "",
 description: "",
 workOrderType: "maintenance",
 priority: "medium",
 status: "draft",
 estimatedCost: "",
 estimatedStartDate: null,
 estimatedEndDate: null,
 maintenanceRequestId: null,
 },
 });

 // Auto-fill fields when maintenance request is selected
 const maintenanceRequestId = form.watch("maintenanceRequestId");

 useEffect(() => {
 if (!maintenanceRequestId) return;

 const selectedMR = maintenanceRequests.find(
 (mr) => mr.id === maintenanceRequestId
 );

 if (!selectedMR) return;

 if (!form.getValues("title")) {
 form.setValue("title", selectedMR.title);
 }

 if (!form.getValues("description")) {
 form.setValue("description", selectedMR.description);
 }

 if (form.getValues("priority") === "medium") {
 form.setValue("priority", selectedMR.priority);
 }
 }, [maintenanceRequestId, maintenanceRequests, form]);

 // Reset form when workOrder changes or dialog opens
 useEffect(() => {
 if (workOrder && open) {
 const formattedCost = workOrder.estimatedCost 
 ? workOrder.estimatedCost.toString()
 : "";
 
 // Format dates for date input (YYYY-MM-DD)
 const formatDateForInput = (dateString?: string) => {
 if (!dateString) return null;
 try {
 const date = new Date(dateString);
 return date.toISOString().split('T')[0];
 } catch {
 return null;
 }
 };

 form.reset({
 title: workOrder.title || workOrder.description || `Work Order ${workOrder.workOrderNumber}`,
 description: workOrder.description || "",
 workOrderType: (workOrder.workOrderType as "maintenance" | "project" | "emergency" | "preventive" | "inspection") || "maintenance",
 priority: workOrder.priority,
 status: workOrder.status || "draft",
 estimatedCost: formattedCost,
 estimatedStartDate: formatDateForInput(workOrder.estimatedStartDate),
 estimatedEndDate: formatDateForInput(workOrder.estimatedEndDate),
 maintenanceRequestId: workOrder.maintenanceRequestId || null,
 });
 }
 }, [workOrder, open, form]);

 // Update mutation
 const updateWorkOrderMutation = useMutation({
 mutationFn: async (data: EditWorkOrderFormValues) => {
 if (!userId) {
 throw new Error("User not authenticated. Please log in.");
 }
 
 if (!workOrder) {
 throw new Error("No work order selected");
 }

 // Prepare update data - match the create mutation's format
 const updateData: any = {
 title: data.title,
 description: data.description,
 workOrderType: data.workOrderType,
 priority: data.priority,
 status: data.status,
 estimatedCost: data.estimatedCost ? data.estimatedCost.toString() : null,
 maintenanceRequestId: data.maintenanceRequestId || null,
 updatedBy: userId,
 currency: workOrder.currency || "USD",
 // Send dates as-is (strings) just like the create mutation does
 estimatedStartDate: data.estimatedStartDate || null,
 estimatedEndDate: data.estimatedEndDate || null,
 };

 const response = await apiRequest(`/api/work-orders/${workOrder.id}`, {
 method: 'PUT',
 data: updateData,
 headers: {
 'Content-Type': 'application/json',
 },
 });
 
 if (!response.ok) {
 let errorMessage = "Failed to update work order";
 try {
 const errorData = await response.json();
 errorMessage = errorData.message || errorMessage;
 if (errorData.errors) {
 errorMessage += `: ${errorData.errors.map((e: any) => e.message).join(', ')}`;
 }
 } catch (e) {
 errorMessage = `${response.status} ${response.statusText}`;
 }
 throw new Error(errorMessage);
 }
 
 const updatedWorkOrder = await response.json();
 
 // If linked to a maintenance request, update its status
 if (data.maintenanceRequestId && workOrder.maintenanceRequestId !== data.maintenanceRequestId) {
 try {
 await apiRequest(`/api/maintenance-requests/${data.maintenanceRequestId}/link-work-order`, {
 method: 'POST',
 data: {
 workOrderId: workOrder.id,
 workOrderTitle: data.title,
 contractorId: workOrder.contractorId,
 contractorName: contractorName,
 status: data.status === 'completed' ? 'completed' : 'in_progress'
 }
 });
 
 // Unlink previous maintenance request if changed
 if (workOrder.maintenanceRequestId && workOrder.maintenanceRequestId !== data.maintenanceRequestId) {
 await apiRequest(`/api/maintenance-requests/${workOrder.maintenanceRequestId}/unlink-work-order`, {
 method: 'POST',
 data: {
 workOrderId: workOrder.id
 }
 });
 }
 } catch (error) {
 console.warn('Failed to update maintenance request status:', error);
 }
 }
 
 return updatedWorkOrder;
 },
 onSuccess: (data) => {
 toast({
 title: "Success",
 description: `Work order "${data.title}" updated successfully`,
 className: "bg-card dark:bg-gray-900 border border-border dark:border-gray-800",
 });
 
 // Invalidate all relevant queries
 queryClient.invalidateQueries({ queryKey: ['/api/work-orders'] });
 queryClient.invalidateQueries({ queryKey: [`/api/contractors/${workOrder?.contractorId}/work-orders`] });
 queryClient.invalidateQueries({ queryKey: ['/api/maintenance-requests'] });
 
 onOpenChange(false);
 if (onSuccess) onSuccess();
 },
 onError: (error: any) => {
 console.error("Work order update error:", error);
 toast({
 title: "Error",
 description: error.message || "Failed to update work order. Please check the console.",
 variant: "destructive",
 });
 },
 });

 const onSubmit = (data: EditWorkOrderFormValues) => {
 if (!userId) {
 toast({
 title: "Authentication Required",
 description: "Please log in to update a work order",
 variant: "destructive",
 });
 return;
 }
 
 if (!workOrder) {
 toast({
 title: "Error",
 description: "No work order selected",
 variant: "destructive",
 });
 return;
 }
 
 updateWorkOrderMutation.mutate(data);
 };

 // Format cost input
 const handleCostChange = (e: React.ChangeEvent<HTMLInputElement>, onChange: (value: string) => void) => {
 const value = e.target.value;
 if (value === "" || /^\d*\.?\d{0,2}$/.test(value)) {
 onChange(value);
 }
 };

 // Handle date change to ensure end date is after start date
 const handleStartDateChange = (value: string) => {
 form.setValue("estimatedStartDate", value, { shouldValidate: true });
 
 // If end date is before start date, clear it
 const endDate = form.getValues("estimatedEndDate");
 if (endDate && new Date(endDate) < new Date(value)) {
 form.setValue("estimatedEndDate", null);
 }
 };

 // Quick action buttons
 const handleMarkComplete = () => {
 if (workOrder) {
 const currentValues = form.getValues();
 updateWorkOrderMutation.mutate({
 ...currentValues,
 status: 'completed'
 });
 }
 };

 const handleCancelOrder = () => {
 if (workOrder) {
 const currentValues = form.getValues();
 updateWorkOrderMutation.mutate({
 ...currentValues,
 status: 'cancelled'
 });
 }
 };

 // Get selected maintenance request details
 const selectedMR = form.watch('maintenanceRequestId')
 ? maintenanceRequests.find((mr) => mr.id === form.watch('maintenanceRequestId'))
 : null;

 // Format dates for display
 const formatDate = (dateString?: string) => {
 if (!dateString) return 'Not set';
 return new Date(dateString).toLocaleDateString('en-US', {
 weekday: 'short',
 year: 'numeric',
 month: 'short',
 day: 'numeric'
 });
 };

 return (
 <Dialog open={open} onOpenChange={onOpenChange}>
 <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-card shadow-xl">
 <DialogHeader className="space-y-3">
 <DialogTitle className="text-2xl font-bold text-foreground">
 Edit Work Order
 </DialogTitle>
 <DialogDescription className="text-muted-foreground">
 Update work order for{" "}
 <span className="font-medium text-blue-600">{contractorName}</span>
 </DialogDescription>
 
 {workOrder && (
 <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 mt-2">
 <div className="flex justify-between items-start">
 <div className="space-y-1">
 <p className="text-sm font-medium text-blue-800">
 Ticket: {workOrder.ticketNumber || `WO-${workOrder.id.toString().padStart(5, '0')}`}
 </p>
 <p className="text-xs text-blue-700">
 Created: {formatDate(workOrder.createdAt)}
 {workOrder.scheduledDate && ` • Scheduled: ${formatDate(workOrder.scheduledDate)}`}
 {workOrder.completedDate && ` • Completed: ${formatDate(workOrder.completedDate)}`}
 </p>
 </div>
 <div className="flex gap-2">
 <Button
 type="button"
 variant="outline"
 size="sm"
 onClick={handleMarkComplete}
 disabled={workOrder.status === 'completed' || updateWorkOrderMutation.isPending}
 className="h-8 text-xs bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
 >
 Mark Complete
 </Button>
 <Button
 type="button"
 variant="outline"
 size="sm"
 onClick={handleCancelOrder}
 disabled={workOrder.status === 'cancelled' || updateWorkOrderMutation.isPending}
 className="h-8 text-xs bg-red-50 text-red-700 border-red-200 hover:bg-red-100 hover:text-red-800"
 >
 Cancel Order
 </Button>
 </div>
 </div>
 </div>
 )}
 </DialogHeader>

 <Form {...form}>
 <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
 {/* Basic Information Section */}
 <div className="space-y-6">
 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
 <FormField
 control={form.control}
 name="title"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-sm font-medium text-foreground">
 Title <span className="text-red-500">*</span>
 </FormLabel>
 <FormControl>
 <Input
 placeholder="e.g., Fix leaking faucet in unit 101"
 {...field}
 className="border-border focus:border-emerald-500 focus:ring-emerald-500 rounded-lg transition-colors"
 />
 </FormControl>
 <FormMessage className="text-xs mt-1" />
 </FormItem>
 )}
 />

 <FormField
 control={form.control}
 name="workOrderType"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-sm font-medium text-foreground">
 Work Order Type <span className="text-red-500">*</span>
 </FormLabel>
 <Select onValueChange={field.onChange} value={field.value}>
 <FormControl>
 <SelectTrigger className="border-border focus:border-emerald-500 focus:ring-emerald-500 rounded-lg transition-colors">
 <SelectValue placeholder="Select type" />
 </SelectTrigger>
 </FormControl>
 <SelectContent className="border-border shadow-lg">
 <SelectItem value="maintenance">Maintenance</SelectItem>
 <SelectItem value="emergency">Emergency</SelectItem>
 <SelectItem value="preventive">Preventive</SelectItem>
 <SelectItem value="inspection">Inspection</SelectItem>
 <SelectItem value="project">Project</SelectItem>
 </SelectContent>
 </Select>
 <FormMessage className="text-xs mt-1" />
 </FormItem>
 )}
 />
 </div>

 {/* Maintenance Request Selector */}
 <div>
 <FormField
 control={form.control}
 name="maintenanceRequestId"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-sm font-medium text-foreground">
 Link to Maintenance Request (Optional)
 </FormLabel>
 <Select
 value={
 field.value === null || field.value === undefined
 ? "__none__"
 : field.value.toString()
 }
 onValueChange={(value) => {
 if (value === "__none__") {
 field.onChange(null);
 } else {
 field.onChange(Number(value));
 }
 }}
 disabled={isLoadingMR}
 >
 <FormControl>
 <SelectTrigger className="border-border focus:border-emerald-500 focus:ring-emerald-500 rounded-lg transition-colors">
 <SelectValue placeholder="Select maintenance request" />
 </SelectTrigger>
 </FormControl>

 <SelectContent className="border-border shadow-lg">
 <SelectItem value="__none__">None (No link)</SelectItem>
 {(Array.isArray(maintenanceRequests) ? maintenanceRequests : []).map((mr) => (
 <SelectItem key={mr.id} value={mr.id.toString()}>
 MR-{mr.id} — {mr.title}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>

 <FormMessage className="text-xs mt-1" />
 {maintenanceRequests.length === 0 && !isLoadingMR && (
 <p className="text-xs text-muted-foreground mt-1">No open maintenance requests available</p>
 )}
 </FormItem>
 )}
 />

 {/* Selected Maintenance Request Details */}
 {selectedMR && (
 <div className="mt-3 p-3 bg-blue-50 border border-blue-100 rounded-lg">
 <div className="flex justify-between items-start">
 <div className="flex-1">
 <h4 className="text-sm font-medium text-blue-800 flex items-center">
 <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
 <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
 </svg>
 Selected Maintenance Request
 </h4>
 <div className="mt-2 space-y-1 text-sm">
 <p><span className="font-medium text-blue-700">Title:</span> {selectedMR.title}</p>
 <p><span className="font-medium text-blue-700">Description:</span> {selectedMR.description.substring(0, 80)}{selectedMR.description.length > 80 ? '...' : ''}</p>
 <div className="flex flex-wrap gap-4">
 <p>
 <span className="font-medium text-blue-700">Status:</span>
 <span className={`ml-1 px-2 py-0.5 rounded-full text-xs font-medium ${
 selectedMR.status === 'open' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-gray-100 text-gray-600'
 }`}>
 {selectedMR.status === 'open' ? 'Open' : 'Closed'}
 </span>
 </p>
 <p>
 <span className="font-medium text-blue-700">Priority:</span>
 <span className={`ml-1 px-2 py-0.5 rounded-full text-xs font-medium ${
 selectedMR.priority === 'critical' ? 'bg-red-100 text-red-800' :
 selectedMR.priority === 'high' ? 'bg-orange-100 text-orange-800' :
 selectedMR.priority === 'medium' ? 'bg-yellow-100 text-yellow-800' :
 'bg-emerald-50 text-emerald-700 border border-emerald-200'
 }`}>
 {selectedMR.priority}
 </span>
 </p>
 <p>
 <span className="font-medium text-blue-700">Created:</span>
 <span className="ml-1 text-muted-foreground"> {new Date(selectedMR.createdAt).toLocaleDateString()}</span>
 </p>
 </div>
 </div>
 </div>
 <Button
 type="button"
 variant="ghost"
 size="sm"
 onClick={() => {
 form.setValue('maintenanceRequestId', null);
 }}
 className="text-blue-700 hover:text-blue-900 hover:bg-blue-100 h-8 px-3"
 >
 Clear
 </Button>
 </div>
 </div>
 )}
 </div>

 <FormField
 control={form.control}
 name="description"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-sm font-medium text-foreground">
 Description <span className="text-red-500">*</span>
 </FormLabel>
 <FormControl>
 <Textarea
 placeholder="Describe the work that needs to be done in detail..."
 className="min-h-[120px] border-border focus:border-emerald-500 focus:ring-emerald-500 rounded-lg transition-colors resize-none"
 {...field}
 />
 </FormControl>
 <div className="flex justify-between items-center mt-1">
 <FormMessage className="text-xs" />
 <span className="text-xs text-muted-foreground">
 {field.value?.length || 0}/1000 characters
 </span>
 </div>
 </FormItem>
 )}
 />
 </div>

 {/* Priority, Status, Dates & Cost Section */}
 <div className="space-y-6">
 <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
 <FormField
 control={form.control}
 name="priority"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-sm font-medium text-foreground">
 Priority <span className="text-red-500">*</span>
 </FormLabel>
 <Select onValueChange={field.onChange} value={field.value}>
 <FormControl>
 <SelectTrigger className="border-border focus:border-emerald-500 focus:ring-emerald-500 rounded-lg transition-colors">
 <SelectValue placeholder="Select priority" />
 </SelectTrigger>
 </FormControl>
 <SelectContent className="border-border shadow-lg">
 <SelectItem value="low">
 <div className="flex items-center space-x-2">
 <div className="w-2 h-2 rounded-full bg-green-500"></div>
 <span>Low</span>
 </div>
 </SelectItem>
 <SelectItem value="medium">
 <div className="flex items-center space-x-2">
 <div className="w-2 h-2 rounded-full bg-yellow-500"></div>
 <span>Medium</span>
 </div>
 </SelectItem>
 <SelectItem value="high">
 <div className="flex items-center space-x-2">
 <div className="w-2 h-2 rounded-full bg-orange-500"></div>
 <span>High</span>
 </div>
 </SelectItem>
 <SelectItem value="critical">
 <div className="flex items-center space-x-2">
 <div className="w-2 h-2 rounded-full bg-red-500"></div>
 <span>Critical</span>
 </div>
 </SelectItem>
 </SelectContent>
 </Select>
 <FormMessage className="text-xs mt-1" />
 </FormItem>
 )}
 />

 <FormField
 control={form.control}
 name="status"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-sm font-medium text-foreground">
 Status <span className="text-red-500">*</span>
 </FormLabel>
 <Select onValueChange={field.onChange} value={field.value}>
 <FormControl>
 <SelectTrigger className="border-border focus:border-emerald-500 focus:ring-emerald-500 rounded-lg transition-colors">
 <SelectValue placeholder="Select status" />
 </SelectTrigger>
 </FormControl>
 <SelectContent className="border-border shadow-lg">
 <SelectItem value="draft">
 <div className="flex items-center space-x-2">
 <div className="w-2 h-2 rounded-full bg-gray-400"></div>
 <span>Draft</span>
 </div>
 </SelectItem>
 <SelectItem value="pending">
 <div className="flex items-center space-x-2">
 <div className="w-2 h-2 rounded-full bg-yellow-400"></div>
 <span>Pending</span>
 </div>
 </SelectItem>
 <SelectItem value="assigned">
 <div className="flex items-center space-x-2">
 <div className="w-2 h-2 rounded-full bg-blue-400"></div>
 <span>Assigned</span>
 </div>
 </SelectItem>
 <SelectItem value="in_progress">
 <div className="flex items-center space-x-2">
 <div className="w-2 h-2 rounded-full bg-orange-400"></div>
 <span>In Progress</span>
 </div>
 </SelectItem>
 <SelectItem value="completed">
 <div className="flex items-center space-x-2">
 <div className="w-2 h-2 rounded-full bg-green-400"></div>
 <span>Completed</span>
 </div>
 </SelectItem>
 <SelectItem value="cancelled">
 <div className="flex items-center space-x-2">
 <div className="w-2 h-2 rounded-full bg-red-400"></div>
 <span>Cancelled</span>
 </div>
 </SelectItem>
 </SelectContent>
 </Select>
 <FormMessage className="text-xs mt-1" />
 </FormItem>
 )}
 />

 <FormField
 control={form.control}
 name="estimatedStartDate"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-sm font-medium text-foreground">
 Estimated Start Date
 </FormLabel>
 <div className="relative">
 <FormControl>
 <Input
 type="date"
 value={field.value || ""}
 onChange={(e) => handleStartDateChange(e.target.value)}
 className="border-border focus:border-emerald-500 focus:ring-emerald-500 rounded-lg transition-colors pl-10"
 />
 </FormControl>
 <CalendarIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
 </div>
 <FormMessage className="text-xs mt-1" />
 </FormItem>
 )}
 />

 <FormField
 control={form.control}
 name="estimatedEndDate"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-sm font-medium text-foreground">
 Estimated End Date
 </FormLabel>
 <div className="relative">
 <FormControl>
 <Input
 type="date"
 value={field.value || ""}
 onChange={field.onChange}
 className="border-border focus:border-emerald-500 focus:ring-emerald-500 rounded-lg transition-colors pl-10"
 />
 </FormControl>
 <CalendarIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
 </div>
 <FormMessage className="text-xs mt-1" />
 </FormItem>
 )}
 />
 </div>

 <FormField
 control={form.control}
 name="estimatedCost"
 render={({ field }) => (
 <FormItem className="max-w-xs">
 <FormLabel className="text-sm font-medium text-foreground">
 Estimated Cost ({workOrder?.currency || "USD"})
 </FormLabel>
 <div className="relative">
 <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
 <FormControl>
 <Input
 type="text"
 placeholder="0.00"
 value={field.value || ""}
 onChange={(e) => handleCostChange(e, field.onChange)}
 className="border-border focus:border-emerald-500 focus:ring-emerald-500 rounded-lg transition-colors pl-10"
 />
 </FormControl>
 </div>
 <FormMessage className="text-xs mt-1" />
 </FormItem>
 )}
 />
 </div>

 {/* Footer */}
 <DialogFooter className="border-t border-border pt-6">
 <div className="flex flex-col sm:flex-row w-full gap-4">
 <div className="flex-1 space-y-1">
 <p className="text-xs text-muted-foreground">
 Fields marked with <span className="text-red-500">*</span> are required
 </p>
 {workOrder && (
 <>
 <p className="text-xs text-muted-foreground">
 Contractor: <span className="font-medium">{contractorName} (ID: {workOrder.contractorId})</span>
 </p>
 <p className="text-xs text-muted-foreground">
 Work Order: <span className="font-medium">{workOrder.ticketNumber || `WO-${workOrder.id}`}</span>
 </p>
 </>
 )}
 {userId && (
 <p className="text-xs text-muted-foreground">
 Updated by: <span className="font-medium">User ID: {userId.substring(0, 8)}...</span>
 </p>
 )}
 {selectedMR && (
 <p className="text-xs text-blue-600">
 Linked to: <span className="font-medium">Maintenance Request MR-{selectedMR.id}</span>
 </p>
 )}
 </div>
 
 <div className="flex gap-3">
 <Button
 type="button"
 variant="outline"
 onClick={() => onOpenChange(false)}
 disabled={updateWorkOrderMutation.isPending}
 className="border-border hover:bg-muted text-foreground font-medium px-6 rounded-lg transition-colors"
 >
 Cancel
 </Button>
 <Button
 type="submit"
 disabled={updateWorkOrderMutation.isPending || !userId}
 className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-medium px-6 rounded-lg shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
 >
 {updateWorkOrderMutation.isPending ? (
 <>
 <Loader2 className="mr-2 h-4 w-4 animate-spin" />
 Updating...
 </>
 ) : (
 <>
 <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
 </svg>
 Update Work Order
 </>
 )}
 </Button>
 </div>
 </div>
 </DialogFooter>
 </form>
 </Form>
 </DialogContent>
 </Dialog>
 );
}