import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { Loader2, Calendar as CalendarIcon, DollarSign } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
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

// Updated schema to match backend expectations
const createWorkOrderSchema = z.object({
 title: z.string().min(1, "Title is required").max(100),
 description: z.string().min(1, "Description is required").max(1000),
 workOrderType: z.enum(["maintenance", "project", "emergency", "preventive", "inspection"]),
 priority: z.enum(["low", "medium", "high", "critical"]),
 estimatedStartDate: z.string().optional().nullable(),
 estimatedEndDate: z.string().optional().nullable(),
 estimatedCost: z.string().optional().nullable(),
 maintenanceRequestId: z.coerce.number().int().positive().optional().nullable(),
});

type CreateWorkOrderFormValues = z.infer<typeof createWorkOrderSchema>;

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

interface CreateWorkOrderDialogProps {
 open: boolean;
 onOpenChange: (open: boolean) => void;
 contractorId: number;
 contractorName?: string;
}

export function CreateWorkOrderDialog({
 open,
 onOpenChange,
 contractorId,
 contractorName,
}: CreateWorkOrderDialogProps) {
 const { toast } = useToast();
 const queryClient = useQueryClient();
 // Use the auth context — never read userId from localStorage/sessionStorage directly.
 const { user } = useAuth();
 const userId = user?.id?.toString() ?? null;

 // Updated maintenance request query
 const { data: maintenanceRequests = [], isLoading: isLoadingMR } = useQuery<MaintenanceRequest[]>({
 queryKey: ['/api/maintenance-requests'],
 queryFn: async () => {
 const response = await apiRequest('/api/maintenance-requests');
 if (!response.ok) {
 throw new Error('Failed to fetch maintenance requests');
 }
 return ensureArray(await response.json());
 },
 enabled: open, // Only fetch when dialog is open
 select: (data) => {
 // Type-safe priority order
 const priorityOrder: Record<'critical' | 'high' | 'medium' | 'low', number> = {
 critical: 0,
 high: 1,
 medium: 2,
 low: 3
 };
 
 // Filter for open/pending requests first
 const filteredData = data.filter(mr => 
 mr.status === 'open' || mr.status === 'pending'
 );
 
 // Then sort
 return filteredData.sort((a, b) => {
 const aPriority = priorityOrder[a.priority];
 const bPriority = priorityOrder[b.priority];
 
 // Sort by priority first, then by creation date
 return aPriority - bPriority || 
 new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
 });
 }
 });



 const form = useForm<CreateWorkOrderFormValues>({
 resolver: zodResolver(createWorkOrderSchema),
 defaultValues: {
 title: "",
 description: "",
 workOrderType: "maintenance",
 priority: "medium",
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

 // Updated mutation with maintenance request linking
 const createWorkOrderMutation = useMutation({
 mutationFn: async (data: CreateWorkOrderFormValues) => {
 if (!userId) {
 throw new Error("User not authenticated. Please log in.");
 }
 
 // Generate a unique ticket number
 const ticketNumber = `WO-${Date.now()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
 
 // Prepare the data according to backend schema
 const workOrderData = {
 ticketNumber,
 maintenanceRequestId: data.maintenanceRequestId || null,
 workOrderType: data.workOrderType,
 title: data.title,
 description: data.description,
 priority: data.priority,
 status: "draft",
 assignedTo: contractorName || null,
 contractorId: contractorId,
 estimatedStartDate: data.estimatedStartDate || null,
 estimatedEndDate: data.estimatedEndDate || null,
 // Convert cost string to decimal string or null
 estimatedCost: data.estimatedCost ? data.estimatedCost.toString() : null,
 approvalRequired: true,
 approvalLevel: "supervisor",
 createdBy: userId,
 currency: "KES",
 };

 // First, create the work order
 const response = await apiRequest('/api/work-orders', {
 method: 'POST',
 data: workOrderData,
 headers: {
 'Content-Type': 'application/json',
 },
 });
 
 if (!response.ok) {
 let errorMessage = "Failed to create work order";
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
 
 const workOrder = await response.json();
 
 // If linked to a maintenance request, update its status to in_progress
 // via the standard CRUD PUT endpoint (no separate link-work-order route exists).
 if (data.maintenanceRequestId) {
 try {
 await apiRequest(`/api/maintenance-requests/${data.maintenanceRequestId}`, {
 method: 'PUT',
 data: { status: 'in_progress' },
 });
 } catch (error) {
 // Non-fatal: work order was created; just log the status update failure.
 console.warn('Failed to update maintenance request status to in_progress:', error);
 }
 }
 
 return workOrder;
 },
 onSuccess: (data) => {
 toast({
 title: "Success",
 description: `Work order "${data.title}" created successfully`,
 className: "bg-card dark:bg-gray-900 border border-border dark:border-gray-800",
 });
 
 // Invalidate all relevant queries
 queryClient.invalidateQueries({ queryKey: ['/api/work-orders'] });
 queryClient.invalidateQueries({ queryKey: ['/api/contractors'] });
 queryClient.invalidateQueries({ queryKey: ['/api/maintenance-requests'] });
 queryClient.invalidateQueries({ queryKey: [`/api/contractors/${contractorId}/performance`] });
 
 onOpenChange(false);
 form.reset();
 },
 onError: (error: any) => {
 console.error("Work order creation error:", error);
 toast({
 title: "Error",
 description: error.message || "Failed to create work order. Please check the console.",
 variant: "destructive",
 });
 },
 });

 const onSubmit = (data: CreateWorkOrderFormValues) => {
 if (!userId) {
 toast({
 title: "Authentication Required",
 description: "Please log in to create a work order",
 variant: "destructive",
 });
 return;
 }
 createWorkOrderMutation.mutate(data);
 };

 // Format cost input
 const handleCostChange = (e: React.ChangeEvent<HTMLInputElement>, onChange: (value: string) => void) => {
 const value = e.target.value;
 // Allow only numbers and decimal point
 if (value === "" || /^\d*\.?\d{0,2}$/.test(value)) {
 onChange(value);
 }
 };

 // Handle date change to ensure end date is after start date
 const handleStartDateChange = (value: string) => {
 form.setValue("estimatedStartDate", value);
 
 // If end date is before start date, clear it
 const endDate = form.getValues("estimatedEndDate");
 if (endDate && new Date(endDate) < new Date(value)) {
 form.setValue("estimatedEndDate", null);
 }
 };

 // Get selected maintenance request details
 const selectedMR = form.watch('maintenanceRequestId')
 ? maintenanceRequests.find((mr) => mr.id === form.watch('maintenanceRequestId'))
 : null;

 return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-card shadow-xl">
        <DialogHeader className="space-y-3">
          <DialogTitle className="text-2xl font-bold text-foreground">
            Create Work Order
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Create a new work order for{" "}
            <span className="font-medium text-blue-600">{contractorName}</span>
          </DialogDescription>
          {!userId && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 mt-2">
              <p className="text-sm text-yellow-800 flex items-center">
                <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                You need to be logged in to create a work order
              </p>
            </div>
          )}
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">

            {/* ── Basic Information ── */}
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
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
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
                        value={field.value === null || field.value === undefined ? "__none__" : field.value.toString()}
                        onValueChange={(value) => {
                          if (value === "__none__") { field.onChange(null); }
                          else { field.onChange(Number(value)); }
                        }}
                        disabled={isLoadingMR}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select maintenance request" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="__none__">None (Create new)</SelectItem>
                          {maintenanceRequests.map((mr) => (
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
                          <div className="flex gap-4 flex-wrap">
                            <p>
                              <span className="font-medium text-blue-700">Status:</span>
                              <span className={`ml-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                                selectedMR.status === 'open' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'text-muted-foreground'
                              }`}>
                                {selectedMR.status === 'open' ? 'Open' : 'Closed'}
                              </span>
                            </p>
                            <p>
                              <span className="font-medium text-blue-700">Priority:</span>
                              <span className={`ml-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                                selectedMR.priority === 'critical' ? 'bg-red-100 text-red-800' :
                                selectedMR.priority === 'high'     ? 'bg-orange-100 text-orange-800' :
                                selectedMR.priority === 'medium'   ? 'bg-yellow-100 text-yellow-800' :
                                                                     'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              }`}>
                                {selectedMR.priority}
                              </span>
                            </p>
                            <p>
                              <span className="font-medium text-blue-700">Created:</span>{' '}
                              {new Date(selectedMR.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => form.setValue('maintenanceRequestId', null)}
                        className="text-blue-700 hover:text-blue-900 hover:bg-blue-100 h-8 px-3"
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div> {/* ── end Basic Information ── */}

            {/* ── Priority, Dates & Cost ── */}
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <FormField
                  control={form.control}
                  name="priority"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-foreground">
                        Priority <span className="text-red-500">*</span>
                      </FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger className="border-border focus:border-emerald-500 focus:ring-emerald-500 rounded-lg transition-colors">
                            <SelectValue placeholder="Select priority" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="border-border shadow-lg">
                          <SelectItem value="low">
                            <div className="flex items-center space-x-2">
                              <div className="w-2 h-2 rounded-full bg-green-500" />
                              <span>Low</span>
                            </div>
                          </SelectItem>
                          <SelectItem value="medium">
                            <div className="flex items-center space-x-2">
                              <div className="w-2 h-2 rounded-full bg-yellow-500" />
                              <span>Medium</span>
                            </div>
                          </SelectItem>
                          <SelectItem value="high">
                            <div className="flex items-center space-x-2">
                              <div className="w-2 h-2 rounded-full bg-orange-500" />
                              <span>High</span>
                            </div>
                          </SelectItem>
                          <SelectItem value="critical">
                            <div className="flex items-center space-x-2">
                              <div className="w-2 h-2 rounded-full bg-red-500" />
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
                  name="estimatedStartDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-foreground">Estimated Start Date</FormLabel>
                      <div className="relative">
                        <FormControl>
                          <Input
                            type="date"
                            value={field.value || ""}
                            onChange={(e) => { field.onChange(e.target.value); handleStartDateChange(e.target.value); }}
                            min={new Date().toISOString().split('T')[0]}
                            className="border-border focus:border-emerald-500 focus:ring-emerald-500 rounded-lg transition-colors pl-10"
                          />
                        </FormControl>
                        <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
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
                      <FormLabel className="text-sm font-medium text-foreground">Estimated End Date</FormLabel>
                      <div className="relative">
                        <FormControl>
                          <Input
                            type="date"
                            value={field.value || ""}
                            onChange={field.onChange}
                            min={form.getValues('estimatedStartDate') || new Date().toISOString().split('T')[0]}
                            className="border-border focus:border-emerald-500 focus:ring-emerald-500 rounded-lg transition-colors pl-10"
                          />
                        </FormControl>
                        <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
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
                    <FormLabel className="text-sm font-medium text-foreground">Estimated Cost (KES)</FormLabel>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground pointer-events-none select-none">Ksh</span>
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
            </div> {/* ── end Priority, Dates & Cost ── */}

            {/* ── Description ── */}
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
                      placeholder="Detailed description of the work to be done..."
                      className="min-h-[100px] border-border focus:border-emerald-500 focus:ring-emerald-500 rounded-lg transition-colors"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage className="text-xs mt-1" />
                </FormItem>
              )}
            />

            {/* ── Footer ── */}
            <DialogFooter className="border-t border-border pt-6">
              <div className="flex flex-col sm:flex-row w-full gap-4">
                <div className="flex-1 space-y-1">
                  <p className="text-xs text-muted-foreground">
                    Fields marked with <span className="text-red-500">*</span> are required
                  </p>
                  {contractorId && (
                    <p className="text-xs text-muted-foreground">
                      Contractor: <span className="font-medium">{contractorName} (ID: {contractorId})</span>
                    </p>
                  )}
                  {userId && (
                    <p className="text-xs text-muted-foreground">
                      Created by: <span className="font-medium">User ID: {userId.substring(0, 8)}...</span>
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
                    disabled={createWorkOrderMutation.isPending}
                    className="border-border hover:bg-muted text-foreground font-medium px-6 rounded-lg transition-colors"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={createWorkOrderMutation.isPending || !userId}
                    className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-medium px-6 rounded-lg shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {createWorkOrderMutation.isPending ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating...</>
                    ) : (
                      <><svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>Create Work Order</>
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