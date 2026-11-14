import { apiErrorMessage } from "@/lib/maintenance-flow";
import React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
 Dialog,
 DialogContent,
 DialogDescription,
 DialogHeader,
 DialogTitle,
} from "@/components/ui/dialog";
import {
 Form,
 FormControl,
 FormDescription,
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface MaintenanceRequest {
 id: number;
 title: string;
 description: string;
 priority: string;
 status: string;
 assignedTo?: string;
 estimatedCost?: string;
 actualCost?: string;
 tenantId?: number;
 unitId?: number;
}

interface EditMaintenanceModalProps {
 isOpen: boolean;
 onClose: () => void;
 request: MaintenanceRequest | null;
}

const editMaintenanceSchema = z.object({
 title: z.string().min(1, "Title is required"),
 description: z.string().min(1, "Description is required"),
 priority: z.enum(["low", "medium", "high", "urgent"]),
 estimatedCost: z.string().optional(),
 actualCost: z.string().optional(),
});

type EditMaintenanceFormData = z.infer<typeof editMaintenanceSchema>;

export default function EditMaintenanceModal({ isOpen, onClose, request }: EditMaintenanceModalProps) {
 const { toast } = useToast();
 const queryClient = useQueryClient();

 const form = useForm<EditMaintenanceFormData>({
 resolver: zodResolver(editMaintenanceSchema),
 defaultValues: {
 title: request?.title || "",
 description: request?.description || "",
 priority: (request?.priority as any) || "medium",
 estimatedCost: request?.estimatedCost || "",
 actualCost: request?.actualCost || "",
 },
 });

 // Reset form when request changes
 React.useEffect(() => {
 if (request) {
 form.reset({
 title: request.title,
 description: request.description,
 priority: request.priority as any,
 estimatedCost: request.estimatedCost || "",
 actualCost: request.actualCost || "",
 });
 }
 }, [request, form]);

 const updateMutation = useMutation({
 mutationFn: async (data: EditMaintenanceFormData) => {
 if (!request) throw new Error("No request to update");
 const payload = {
 ...data,
 estimatedCost: data.estimatedCost && data.estimatedCost.trim() !== "" ? data.estimatedCost.trim() : undefined,
 actualCost: data.actualCost && data.actualCost.trim() !== "" ? data.actualCost.trim() : undefined,
 };
 return await apiRequest(`/api/maintenance-requests/${request.id}`, { method: "PUT", data: payload });
 },
 onSuccess: async (res: any) => {
 queryClient.invalidateQueries({ queryKey: ["/api/maintenance-requests"] });
 const updated = await res?.json?.().catch(() => null);
 const gated = updated?.status === "pending_approval" && request?.status !== "pending_approval";
 toast({
 title: gated ? "Sent for approval" : "Success",
 description: gated ? "That cost is above the property's approval limit, so the owner/manager has to approve it first." : "Maintenance request updated successfully.",
 });
 onClose();
 },
 onError: (error: any) => {
 toast({
 title: "Error",
 description: apiErrorMessage(error, "Failed to update maintenance request."),
 variant: "destructive",
 });
 },
 });

 const onSubmit = (data: EditMaintenanceFormData) => {
 updateMutation.mutate(data);
 };

 const handleClose = () => {
 form.reset();
 onClose();
 };

 if (!request) return null;

 return (
 <Dialog open={isOpen} onOpenChange={handleClose}>
 <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
 <DialogHeader>
 <DialogTitle>
 Edit Maintenance Request #MR-{request.id.toString().padStart(3, '0')}
 </DialogTitle>
 <DialogDescription>
 Update the details of this maintenance request
 </DialogDescription>
 </DialogHeader>

 <Form {...form}>
 <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 <FormField
 control={form.control}
 name="title"
 render={({ field }) => (
 <FormItem className="md:col-span-2">
 <FormLabel>Title</FormLabel>
 <FormControl>
 <Input placeholder="Brief description of the issue" {...field} />
 </FormControl>
 <FormMessage />
 </FormItem>
 )}
 />

 <FormField
 control={form.control}
 name="description"
 render={({ field }) => (
 <FormItem className="md:col-span-2">
 <FormLabel>Description</FormLabel>
 <FormControl>
 <Textarea 
 placeholder="Detailed description of the maintenance request"
 className="min-h-[100px]"
 {...field}
 />
 </FormControl>
 <FormMessage />
 </FormItem>
 )}
 />

 <FormField
 control={form.control}
 name="priority"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Priority</FormLabel>
 <Select onValueChange={field.onChange} defaultValue={field.value}>
 <FormControl>
 <SelectTrigger>
 <SelectValue placeholder="Select priority" />
 </SelectTrigger>
 </FormControl>
 <SelectContent>
 <SelectItem value="low">Low</SelectItem>
 <SelectItem value="medium">Medium</SelectItem>
 <SelectItem value="high">High</SelectItem>
 <SelectItem value="urgent">Urgent</SelectItem>
 </SelectContent>
 </Select>
 <FormMessage />
 </FormItem>
 )}
 />

 <p className="md:col-span-2 text-xs text-muted-foreground rounded-md bg-muted/50 px-3 py-2">
 Status and assignment aren't edited here — use the request's own actions (assign, start, complete, cancel) so the tenant and team are told and the timestamps are recorded.
 </p>

 <FormField
 control={form.control}
 name="estimatedCost"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Estimated Cost</FormLabel>
 <FormControl>
 <Input placeholder="0.00" type="number" step="0.01" {...field} />
 </FormControl>
 <FormDescription>
 Estimated cost for the repair
 </FormDescription>
 <FormMessage />
 </FormItem>
 )}
 />

 {request && ["in_progress", "completed"].includes(request.status) && (
 <FormField
 control={form.control}
 name="actualCost"
 render={({ field }) => (
 <FormItem className="md:col-span-2">
 <FormLabel>Actual Cost</FormLabel>
 <FormControl>
 <Input placeholder="0.00" type="number" step="0.01" {...field} />
 </FormControl>
 <FormDescription>
 Final cost of the completed work
 </FormDescription>
 <FormMessage />
 </FormItem>
 )}
 />
 )}
 </div>

 <div className="flex justify-end space-x-4">
 <Button type="button" variant="outline" onClick={handleClose}>
 Cancel
 </Button>
 <Button type="submit" disabled={updateMutation.isPending}>
 {updateMutation.isPending ? "Updating..." : "Update Request"}
 </Button>
 </div>
 </form>
 </Form>
 </DialogContent>
 </Dialog>
 );
}