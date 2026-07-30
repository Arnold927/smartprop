import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { useEffect, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { useAuth } from "@/hooks/useAuth";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Property } from "@shared/schema";
// import { TitleVerificationPanel } from "@/components/title-verification-panel"; // Ardhisasa pending — panel hidden

const addPropertySchema = z.object({
  name: z.string().min(1, "Property name is required"),
  address: z.string().min(1, "Address is required"),
  totalUnits: z.number().min(1, "Total units must be at least 1"),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  ownerId: z.string().optional(),
  // Mutually exclusive with ownerId — for a landlord with no user account.
  // Only one of the two is ever set; selecting one in the combined picker
  // clears the other.
  externalLandlordId: z.number().nullable().optional(),
  titleDeedNumber: z.string().optional(),
  estimatedValue: z.string().optional(),             // stored as decimal string
  // No .default() here — the form's own defaultValues already supplies
  // "KES" at every reset point (initial, edit-mode, new-mode). A zod
  // .default() creates a real input/output type asymmetry (the field is
  // optional going in, but required coming out of .parse()), which is what
  // was actually breaking zodResolver's generic type inference here — not
  // the externalLandlordId addition, which just tipped a pre-existing
  // borderline case into an outright mismatch.
  estimatedValueCurrency: z.string().optional(),
  estimatedValueNote: z.string().optional(),
});


type AddPropertyForm = z.infer<typeof addPropertySchema>;

interface AddPropertyModalProps {
 isOpen: boolean;
 onClose: () => void;
 onSuccess?: () => void;
 property?: EditableProperty | null;
}

export interface EditableProperty {
  id: number;
  name: string;
  address: string;
  totalUnits: number;
  description?: string | null;
  imageUrl?: string | null;
  ownerId?: string | null;
  externalLandlordId?: number | null;
  titleDeedNumber?: string | null;
  siteSettings?: any;
  estimatedValue?: string | null;
  estimatedValueCurrency?: string | null;
  estimatedValueNote?: string | null;
}


export default function AddPropertyModal({ isOpen, onClose, onSuccess, property, }: AddPropertyModalProps) {
 const queryClient = useQueryClient();
 const { toast } = useToast();
 const { user } = useAuth();

 const isEditMode = Boolean(property);

 // Track the newly created property's ID so the TitleVerificationPanel can
 // persist its result to the right property immediately after creation.
 const [createdPropertyId, setCreatedPropertyId] = useState<number | null>(null);
 const [titleVerified, setTitleVerified] = useState<{ titleNumber: string; status: string } | null>(null);

 const form = useForm<AddPropertyForm>({
 resolver: zodResolver(addPropertySchema),
 defaultValues: {
 name: "",
 address: "",
 totalUnits: 1,
 description: "",
 imageUrl: "",
 ownerId: "",
 externalLandlordId: null,
 titleDeedNumber: "",
 estimatedValue: "",
 estimatedValueCurrency: "KES",
 estimatedValueNote: "",
 },
 });

 useEffect(() => {
 if (property) {
 form.reset({
 name: property.name,
 address: property.address,
 totalUnits: property.totalUnits,
 description: property.description ?? "",
 imageUrl: property.imageUrl ?? "",
 ownerId: property.ownerId ?? "",
 externalLandlordId: property.externalLandlordId ?? null,
 titleDeedNumber: property.titleDeedNumber ?? "",
 estimatedValue: property.estimatedValue ?? "",
 estimatedValueCurrency: property.estimatedValueCurrency ?? "KES",
 estimatedValueNote: property.estimatedValueNote ?? "",
 });
 } else {
 form.reset({
 name: "",
 address: "",
 totalUnits: 1,
 description: "",
 imageUrl: "",
 ownerId: user?.role === "landlord" ? (user?.id ?? "") : "",
 externalLandlordId: null,
 titleDeedNumber: "",
 estimatedValue: "",
 estimatedValueCurrency: "KES",
 estimatedValueNote: "",
 });
 setCreatedPropertyId(null);
 setTitleVerified(null);
 }
 }, [property, form, user?.id, user?.role]);


 // Fetch landlord users so managers can pick an owner
 const { data: landlordUsers = [] } = useQuery<any[]>({
   queryKey: ["/api/users", "landlords"],
   queryFn: async () => {
     const { apiRequest } = await import("@/lib/queryClient");
     const res = await apiRequest("/api/users?role=landlord&limit=100");
     if (!res.ok) return [];
     const d = await res.json();
     return Array.isArray(d) ? d : (d?.results ?? d?.data ?? []);
   },
   enabled: user?.role !== "landlord",
 });

 // Fetch external landlords too — landlords with no user account, an
 // alternative to picking from landlordUsers above
 const { data: externalLandlordOptions = [] } = useQuery<any[]>({
   queryKey: ["/api/external-landlords"],
   queryFn: async () => {
     const { apiRequest } = await import("@/lib/queryClient");
     const res = await apiRequest("/api/external-landlords");
     if (!res.ok) return [];
     return res.json();
   },
   enabled: user?.role !== "landlord",
 });

 const addPropertyMutation = useMutation({
 mutationFn: async (data: AddPropertyForm) => {
 const organizationId = user?.organizationId;

 if (!organizationId) {
 throw new Error("Organization ID not found. Please log in again.");
 }

 const payload = {
 ...data,
 organizationId,
 // Mutually exclusive — selecting one in the combined picker clears the other.
 ownerId: data.ownerId || null,
 externalLandlordId: data.ownerId ? null : (data.externalLandlordId || null),
 };

 const res = await apiRequest("/api/properties", {
 method: "POST",
 data: payload,
 });
 // Return created property so we can grab the ID
 try { return await res.json(); } catch { return null; }
 },
 onSuccess: (created) => {
 queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
 queryClient.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
 // Keep modal open so PM can run title verification on the new property
 if (created?.id) setCreatedPropertyId(created.id);
 toast({
 title: "Property added ✓",
 description: "Enter a title deed number below to verify land ownership with Ardhisasa.",
 });
 onSuccess?.();
 },
 onError: (error) => {
 if (isUnauthorizedError(error)) {
 toast({
 title: "Unauthorized",
 description: "You are logged out. Logging in again...",
 variant: "destructive",
 });
 setTimeout(() => { window.location.href = "/auth"; }, 500);
 return;
 }
 console.error("Error adding property:", error);
 toast({
 title: "Error",
 description: "Failed to add property. Please try again.",
 variant: "destructive",
 });
 },
 });

 const updatePropertyMutation = useMutation({
 mutationFn: async (data: AddPropertyForm) => {
 if (!property) return;

 const payload = {
 ...data,
 ownerId: data.ownerId || null,
 externalLandlordId: data.ownerId ? null : (data.externalLandlordId || null),
 };

 await apiRequest(`/api/properties/${property.id}`, {
 method: "PUT",
 data: payload,
 });
 },
 onSuccess: () => {
 queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
 queryClient.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
 onClose();
 toast({
 title: "Success",
 description: "Property updated successfully",
 });
 },
 onError: () => {
 toast({
 title: "Error",
 description: "Failed to update property",
 variant: "destructive",
 });
 },
});


 const onSubmit = (data: AddPropertyForm) => {
 if (isEditMode) {
 updatePropertyMutation.mutate(data);
 } else {
 addPropertyMutation.mutate(data);
 }
 };


 const handleClose = () => {
 form.reset();
 setCreatedPropertyId(null);
 setTitleVerified(null);
 onClose();
 };

 return (
 <Dialog open={isOpen} onOpenChange={(open) => {
 if (!open) handleClose();
 }}>
 {/* Add explicit background and text colors */}
 <DialogContent 
 className="max-w-2xl bg-card text-foreground"
 style={{
 backgroundColor: 'white',
 color: '#1f2937', // gray-900
 }}
 >
 <div className="bg-card text-foreground">
 <DialogHeader>
 <DialogTitle className="text-foreground">
 {isEditMode ? "Edit Property" : "Add New Property"}
 </DialogTitle>
 </DialogHeader>
 
 <div className="mt-4">
 <Form {...form}>
 <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
 <FormField
 control={form.control}
 name="name"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-foreground">Property Name *</FormLabel>
 <FormControl>
 <Input 
 placeholder="Enter property name" 
 {...field}
 className="bg-card text-foreground border-border"
 />
 </FormControl>
 <FormMessage className="text-red-600" />
 </FormItem>
 )}
 />

 <FormField
 control={form.control}
 name="totalUnits"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-foreground">Total Units *</FormLabel>
 <FormControl>
 <Input 
 type="number" 
 min="1"
 placeholder="Number of units"
 className="bg-card text-foreground border-border"
 {...field}
 onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
 />
 </FormControl>
 <FormMessage className="text-red-600" />
 </FormItem>
 )}
 />
 </div>

 <FormField
 control={form.control}
 name="address"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-foreground">Address *</FormLabel>
 <FormControl>
 <Input 
 placeholder="Enter full address" 
 {...field}
 className="bg-card text-foreground border-border"
 />
 </FormControl>
 <FormMessage className="text-red-600" />
 </FormItem>
 )}
 />

 {/* Property Owner */}
 <FormField
 control={form.control}
 name="ownerId"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-foreground">
 Property Owner
 </FormLabel>
 {user?.role === "landlord" ? (
 <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-muted/40 text-sm">
 <span className="text-foreground">{user.firstName} {user.lastName}</span>
 <span className="text-xs text-muted-foreground">({user.email})</span>
 <input type="hidden" name={field.name} value={user?.id ?? ""} onChange={field.onChange} />
 </div>
 ) : (
 <Select
 value={field.value ? `user:${field.value}` : (form.watch("externalLandlordId") ? `external:${form.watch("externalLandlordId")}` : "none")}
 onValueChange={(v) => {
 if (v === "none") {
 field.onChange("");
 form.setValue("externalLandlordId", null);
 } else if (v.startsWith("external:")) {
 field.onChange("");
 form.setValue("externalLandlordId", parseInt(v.slice("external:".length)));
 } else {
 field.onChange(v.slice("user:".length));
 form.setValue("externalLandlordId", null);
 }
 }}
 >
 <SelectTrigger className="bg-card text-foreground border-border">
 <SelectValue placeholder="Select the property owner (landlord)…" />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="none">— No owner assigned —</SelectItem>
 {landlordUsers.length > 0 && (
 <>
 <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Landlord accounts</div>
 {landlordUsers.map((u: any) => (
 <SelectItem key={`user:${u.id}`} value={`user:${u.id}`}>
 {u.firstName} {u.lastName} · {u.email}
 </SelectItem>
 ))}
 </>
 )}
 {externalLandlordOptions.length > 0 && (
 <>
 <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">External landlords (no account)</div>
 {externalLandlordOptions.map((l: any) => (
 <SelectItem key={`external:${l.id}`} value={`external:${l.id}`}>
 {l.name}{l.phone ? ` · ${l.phone}` : ""}
 </SelectItem>
 ))}
 </>
 )}
 </SelectContent>
 </Select>
 )}
 <p className="text-xs text-muted-foreground mt-0.5">
 The owner sees this property in their Landlord Portal.
 </p>
 <FormMessage className="text-red-600" />
 </FormItem>
 )}
 />

 <FormField
 control={form.control}
 name="description"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-foreground">Description</FormLabel>
 <FormControl>
 <Textarea 
 placeholder="Enter property description (optional)"
 rows={3}
 {...field}
 className="bg-card text-foreground border-border"
 />
 </FormControl>
 <FormMessage className="text-red-600" />
 </FormItem>
 )}
 />

 <FormField
 control={form.control}
 name="imageUrl"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-foreground">Image URL</FormLabel>
 <FormControl>
 <Input 
 placeholder="Enter image URL (optional)"
 {...field}
 className="bg-card text-foreground border-border"
 />
 </FormControl>
 <FormMessage className="text-red-600" />
 </FormItem>
 )}
 />

 
            {/* ── Portfolio Valuation ── */}
            <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-4">
              <div>
                <p className="text-sm font-semibold text-foreground">Portfolio Valuation</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Used in the Senior Manager dashboard to calculate portfolio value and net ROI.
                  Enter the estimated market or purchase value of this property.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <FormField
                  control={form.control}
                  name="estimatedValueCurrency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-foreground">Currency</FormLabel>
                      <FormControl>
                        <select {...field} className="w-full h-10 px-3 text-sm rounded-md border border-border bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
                          {["KES","USD","GBP","EUR","AED","CAD","AUD","ZAR"].map(cur => (
                            <option key={cur} value={cur}>{cur}</option>
                          ))}
                        </select>
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="estimatedValue"
                  render={({ field }) => (
                    <FormItem className="col-span-2">
                      <FormLabel className="text-foreground">Estimated Value</FormLabel>
                      <FormControl>
                        <Input type="number" min="0" step="1000" placeholder="e.g. 25000000" {...field} className="bg-card text-foreground border-border" />
                      </FormControl>
                      <FormMessage className="text-red-600" />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="estimatedValueNote"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground">Valuation Note <span className="font-normal text-muted-foreground">(optional)</span></FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Independent valuation — Jan 2025" {...field} className="bg-card text-foreground border-border" />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>
<div className="flex justify-end space-x-3 pt-4">
 <Button 
 type="button" 
 variant="outline" 
 onClick={handleClose}
 className="border-border text-foreground hover:bg-muted"
 >
 Cancel
 </Button>
 <Button 
 type="submit" 
 disabled={addPropertyMutation.isPending || updatePropertyMutation.isPending}
 className="bg-blue-600 hover:bg-blue-700 text-white"
 >
 {isEditMode
 ? updatePropertyMutation.isPending
 ? "Saving..."
 : "Save Changes"
 : addPropertyMutation.isPending
 ? "Adding..."
 : "Add Property"}
 </Button>
 </div>
 </form>
 </Form>

 {/* ── Title Deed Verification ── */}
 {/* NOTE: Ardhisasa API integration pending. Panel preserved in code,
     hidden from UI. Users directed to the official portal instead. */}
 <div className="mt-5 pt-5 border-t border-border">
   <div className="rounded-lg border border-dashed border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/10 p-3 flex items-start gap-2">
     <svg className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
     </svg>
     <p className="text-xs text-amber-700 dark:text-amber-400">
       <strong>Title deed verification:</strong> Please confirm this title deed on the official{" "}
       <a
         href="https://ardhisasa.lands.go.ke"
         target="_blank"
         rel="noopener noreferrer"
         className="underline font-medium hover:text-amber-900 dark:hover:text-amber-200"
       >
         Ardhisasa land registry portal
       </a>{" "}
       before transacting.
     </p>
   </div>
 </div>
 {/* RESTORE when Ardhisasa API credentials are available:
 {(createdPropertyId || isEditMode) && (
   <div className="mt-5 pt-5 border-t border-border">
     <TitleVerificationPanel
       propertyId={createdPropertyId ?? property?.id}
       initialTitle={form.getValues("titleDeedNumber") ?? property?.titleDeedNumber ?? ""}
       initialResult={(property?.siteSettings as any)?.titleVerification ?? null}
       onVerified={(tn, status) => {
         setTitleVerified({ titleNumber: tn, status });
         queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
       }}
     />
   </div>
 )}
 */}
 </div>
 </div>
 </DialogContent>
 </Dialog>
 );
}