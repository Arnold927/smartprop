// components/add-unit-dialog.tsx
import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
 Dialog,
 DialogContent,
 DialogDescription,
 DialogFooter,
 DialogHeader,
 DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import type { Unit } from "@/types/unit";

interface AddUnitDialogProps {
 open: boolean;
 onClose: () => void;
 unitToEdit?: Unit | null;
 propertyId: number;
 organizationId: number;
 propertyName?: string;
}

interface CreateUnitData {
 propertyId: number;
 unitNumber: string;
 bedrooms: number;
 bathrooms: number;
 sqft: number;
 monthlyRent: number;
 currency: string;
 isOccupied: boolean;
 organizationId: number;
}

export default function AddUnitDialog({
 open,
 onClose,
 unitToEdit,
 propertyId,
 organizationId,
 propertyName
}: AddUnitDialogProps) {
 const { toast } = useToast();
 const queryClient = useQueryClient();
 const isEditing = !!unitToEdit;
 
 // Get the bathroom value from unitToEdit, ensuring it's a valid number
 const initialBathrooms = unitToEdit?.bathrooms 
 ? (typeof unitToEdit.bathrooms === 'string' 
 ? parseFloat(unitToEdit.bathrooms) 
 : unitToEdit.bathrooms)
 : 1;

 const [formData, setFormData] = useState({
 unitNumber: unitToEdit?.unitNumber || "",
 bedrooms: unitToEdit?.bedrooms || 1,
 bathrooms: initialBathrooms,
 sqft: unitToEdit?.sqft || 800,
 monthlyRent: unitToEdit?.monthlyRent.toString() || "",
 currency: unitToEdit?.currency || "USD",
 isOccupied: unitToEdit?.isOccupied || false,
 });

 // Reset form when unitToEdit changes
 useEffect(() => {
 if (unitToEdit) {
 const bathroomsValue = typeof unitToEdit.bathrooms === 'string' 
 ? parseFloat(unitToEdit.bathrooms) 
 : unitToEdit.bathrooms;
 
 setFormData({
 unitNumber: unitToEdit.unitNumber,
 bedrooms: unitToEdit.bedrooms,
 bathrooms: bathroomsValue,
 sqft: unitToEdit.sqft,
 monthlyRent: unitToEdit.monthlyRent.toString(),
 currency: unitToEdit.currency,
 isOccupied: unitToEdit.isOccupied,
 });
 } else {
 // Reset to defaults for adding new unit
 setFormData({
 unitNumber: "",
 bedrooms: 1,
 bathrooms: 1,
 sqft: 800,
 monthlyRent: "",
 currency: "USD",
 isOccupied: false,
 });
 }
 }, [unitToEdit]);

 // Format the bathroom value for the select
 const getBathroomsStringValue = (): string => {
 const value = formData.bathrooms;
 if (value === 1.5) return "1.5";
 if (value === 2.5) return "2.5";
 if (value === 3.5) return "3.5";
 return value.toString();
 };

 // Mutation for creating a new unit
 const createUnitMutation = useMutation({
 mutationFn: async (unitData: CreateUnitData) => {
 const payload = {
 ...unitData,
 bathrooms: unitData.bathrooms.toString(),
 monthlyRent: unitData.monthlyRent.toString(),
 };
 
 const response = await apiRequest('/api/units', {
 method: 'POST',
 data: payload,
 });
 
 return await response.json();
 },
 onMutate: async (newUnit) => {
 // Cancel any outgoing refetches
 await queryClient.cancelQueries({ queryKey: [`/api/properties/${propertyId}/units`] });
 
 // Snapshot the previous value
 const previousUnits = queryClient.getQueryData<Unit[]>([`/api/properties/${propertyId}/units`]);
 
 // Generate a temporary ID for optimistic update
 const tempId = Date.now();
 const optimisticUnit = {
 ...newUnit,
 id: tempId,
 };
 
 // Optimistically update to the new value
 queryClient.setQueryData<Unit[]>([`/api/properties/${propertyId}/units`], (old = []) => [
 ...old,
 optimisticUnit,
 ]);
 
 return { previousUnits, tempId };
 },
 onError: (err, newUnit, context) => {
 // If the mutation fails, use the context returned from onMutate to roll back
 if (context?.previousUnits) {
 queryClient.setQueryData([`/api/properties/${propertyId}/units`], context.previousUnits);
 }
 toast({
 title: "Error",
 description: "Failed to add unit",
 variant: "destructive",
 });
 },
 onSuccess: (newUnit, variables, context) => {
 // Replace the optimistic unit with the real one
 queryClient.setQueryData<Unit[]>([`/api/properties/${propertyId}/units`], (old = []) =>
 old.map(unit => 
 unit.id === context?.tempId ? newUnit : unit
 )
 );
 
 onClose();
 toast({
 title: "Success",
 description: "Unit added successfully",
 });
 },
 onSettled: () => {
 // Always refetch after error or success to ensure sync with server
 queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/units`] });
 },
 });

 // Create update unit mutation
 const updateUnitMutation = useMutation({
 mutationFn: async ({ unitId, ...data }: any) => {
 const payload = {
 ...data,
 bathrooms: data.bathrooms.toString(),
 monthlyRent: data.monthlyRent.toString(),
 };
 
 const response = await apiRequest(`/api/units/${unitId}`, {
 method: 'PUT',
 data: payload,
 });
 
 return await response.json();
 },
 onMutate: async ({ unitId, ...data }) => {
 await queryClient.cancelQueries({ queryKey: [`/api/properties/${propertyId}/units`] });
 const previousUnits = queryClient.getQueryData<Unit[]>([`/api/properties/${propertyId}/units`]);
 
 queryClient.setQueryData<Unit[]>([`/api/properties/${propertyId}/units`], (old = []) =>
 old.map(unit => 
 unit.id === unitId ? { ...unit, ...data } : unit
 )
 );
 
 return { previousUnits };
 },
 onError: (err, variables, context) => {
 if (context?.previousUnits) {
 queryClient.setQueryData([`/api/properties/${propertyId}/units`], context.previousUnits);
 }
 toast({
 title: "Error",
 description: "Failed to update unit",
 variant: "destructive",
 });
 },
 onSuccess: (updatedUnit) => {
 onClose();
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/units`] });
 },
 });

 const handleSubmit = (e: React.FormEvent) => {
 e.preventDefault();
 
 if (!organizationId) {
 toast({
 title: "Error",
 description: "Organization ID is required",
 variant: "destructive",
 });
 return;
 }

 const unitData = {
 propertyId: propertyId,
 organizationId: organizationId,
 unitNumber: formData.unitNumber,
 bedrooms: formData.bedrooms,
 bathrooms: formData.bathrooms,
 sqft: formData.sqft,
 monthlyRent: parseFloat(formData.monthlyRent),
 currency: formData.currency,
 isOccupied: formData.isOccupied,
 };

 if (isEditing && unitToEdit) {
 updateUnitMutation.mutate({
 unitId: unitToEdit.id,
 ...unitData
 });
 } else {
 createUnitMutation.mutate(unitData);
 }
 };

 return (
 <Dialog open={open} onOpenChange={(open) => {
 if (!open) {
 onClose();
 }
 }}>
 <DialogContent className="sm:max-w-[600px] bg-card border border-border shadow-2xl max-h-[90vh] flex flex-col overflow-hidden">
 <DialogHeader className="sticky top-0 bg-card z-10 pb-4 border-b border-border">
 <DialogTitle className="text-xl font-bold">
 {isEditing ? 'Edit Unit' : 'Add New Unit'}
 </DialogTitle>
 <DialogDescription>
 {isEditing 
 ? `Edit unit ${unitToEdit?.unitNumber}`
 : `Add a new unit to ${propertyName || 'this property'}`
 }
 </DialogDescription>
 </DialogHeader>
 <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
 <div className="flex-1 overflow-y-auto py-4 px-1">
 <div className="grid gap-5">
 <div className="grid grid-cols-2 gap-4">
 <div className="space-y-2">
 <Label htmlFor="unitNumber" className="font-medium">Unit Number *</Label>
 <Input
 id="unitNumber"
 placeholder="e.g., 101, A1"
 value={formData.unitNumber}
 onChange={(e) => setFormData({ ...formData, unitNumber: e.target.value })}
 className="border-border focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
 required
 />
 </div>
 <div className="space-y-2">
 <Label htmlFor="monthlyRent" className="font-medium">Monthly Rent *</Label>
 <div className="flex">
 <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-border bg-muted">
 {formData.currency === 'KSH' ? 'Ksh' : '$'}
 </span>
 <Input
 id="monthlyRent"
 type="number"
 placeholder="0.00"
 value={formData.monthlyRent}
 onChange={(e) => setFormData({ ...formData, monthlyRent: e.target.value })}
 className="rounded-l-none border-border focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
 min="0"
 step="0.01"
 required
 />
 </div>
 </div>
 </div>

 <div className="grid grid-cols-3 gap-4">
 <div className="space-y-2">
 <Label htmlFor="bedrooms" className="font-medium">Bedrooms</Label>
 <Select
 value={formData.bedrooms.toString()}
 onValueChange={(value) => setFormData({ ...formData, bedrooms: parseInt(value) })}
 >
 <SelectTrigger className="border-border focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500">
 <SelectValue placeholder="Select" />
 </SelectTrigger>
 <SelectContent>
 {[0, 1, 2, 3, 4, 5].map(num => (
 <SelectItem key={num} value={num.toString()}>
 {num === 0 ? "Studio" : `${num} Bed${num !== 1 ? 's' : ''}`}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 <div className="space-y-2">
 <Label htmlFor="bathrooms" className="font-medium">Bathrooms</Label>
 <Select
 value={getBathroomsStringValue()}
 onValueChange={(value) => setFormData({ ...formData, bathrooms: parseFloat(value) })}
 >
 <SelectTrigger className="border-border focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500">
 <SelectValue placeholder="Select" />
 </SelectTrigger>
 <SelectContent>
 {[1, 1.5, 2, 2.5, 3, 3.5, 4].map(num => (
 <SelectItem key={num} value={num.toString()}>
 {num} Bath{num !== 1 ? 's' : ''}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 <div className="space-y-2">
 <Label htmlFor="sqft" className="font-medium">Square Feet</Label>
 <Input
 id="sqft"
 type="number"
 placeholder="800"
 value={formData.sqft}
 onChange={(e) => setFormData({ ...formData, sqft: parseInt(e.target.value) || 0 })}
 className="border-border focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
 min="0"
 />
 </div>
 </div>

 <div className="space-y-2">
 <Label htmlFor="currency" className="font-medium">Currency</Label>
 <Select
 value={formData.currency}
 onValueChange={(value) => setFormData({ ...formData, currency: value })}
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
 checked={formData.isOccupied}
 onChange={(e) => setFormData({ ...formData, isOccupied: e.target.checked })}
 className="h-5 w-5 rounded border-border text-blue-600 focus:ring-emerald-500"
 />
 <Label htmlFor="isOccupied" className="text-sm font-medium cursor-pointer">
 Mark as occupied
 </Label>
 </div>
 </div>
 </div>
 <DialogFooter className="sticky bottom-0 bg-card pt-4 border-t border-border">
 <Button
 type="button"
 variant="outline"
 onClick={onClose}
 className="border-border hover:border-border hover:bg-muted"
 >
 Cancel
 </Button>
 <Button 
 type="submit"
 disabled={createUnitMutation.isPending || updateUnitMutation.isPending}
 className="bg-blue-600 hover:bg-blue-700 text-white border border-blue-600"
 >
 {(createUnitMutation.isPending || updateUnitMutation.isPending) && (
 <Loader2 className="mr-2 h-4 w-4 animate-spin" />
 )}
 {isEditing ? 'Update Unit' : 'Add Unit'}
 </Button>
 </DialogFooter>
 </form>
 </DialogContent>
 </Dialog>
 );
}