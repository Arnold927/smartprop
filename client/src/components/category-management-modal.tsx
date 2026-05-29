import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Building2, Plus, CheckCircle } from "lucide-react";
import { format } from "date-fns";
import { UseFormReturn } from "react-hook-form";

export interface ServiceCategory {
 id: number;
 name: string;
 description: string | null;
 requiredCertifications: string[] | null;
 typicalServices: string[] | null;
 defaultHourlyRate: number | null;
 defaultDailyRate: number | null;
 isActive: boolean | null;
 createdAt: Date | null;
 updatedAt: Date | null;
 slaRequirements?: Record<string, string>;
}

export type CategoryFormData = {
 name: string;
 description: string;
 requiredCertifications: string[];
 typicalServices: string[];
 defaultHourlyRate: number;
 defaultDailyRate: number;
 isActive: boolean;
};

interface CategoryManagementModalProps {
 isCategoryDialogOpen: boolean;
 setIsCategoryDialogOpen: (open: boolean) => void;
 editingCategory: ServiceCategory | null;
 categoryForm: UseFormReturn<CategoryFormData>;
 serviceInput: string;
 setServiceInput: (input: string) => void;
 certificationInput: string;
 setCertificationInput: (input: string) => void;
 createCategoryMutation: any;
 updateCategoryMutation: any;
 handleCategorySubmit: (data: CategoryFormData) => void;
}

const CategoryManagementModal = ({
 isCategoryDialogOpen,
 setIsCategoryDialogOpen,
 editingCategory,
 categoryForm,
 serviceInput,
 setServiceInput,
 certificationInput,
 setCertificationInput,
 createCategoryMutation,
 updateCategoryMutation,
 handleCategorySubmit,
}: CategoryManagementModalProps) => {
 return (
 <Dialog open={isCategoryDialogOpen} onOpenChange={setIsCategoryDialogOpen}>
 <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto bg-card dark:bg-gray-900 shadow-2xl rounded-lg">
 <DialogHeader className="border-b border-border dark:border-gray-800 pb-4 px-6 pt-5">
 <div className="flex items-center gap-3">
 <div className="p-1.5 rounded-md bg-blue-50 dark:bg-blue-900/20">
 <Building2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
 </div>
 <div>
 <DialogTitle className="text-xl font-bold text-foreground ">
 {editingCategory ? "Edit Service Category" : "New Service Category"}
 </DialogTitle>
 <DialogDescription className="text-sm text-muted-foreground dark:text-muted-foreground mt-0.5">
 {editingCategory 
 ? "Update the service category details"
 : "Create a new service category for contractors"}
 </DialogDescription>
 </div>
 </div>
 </DialogHeader>
 
 <div className="px-6 py-3">
 <Form {...categoryForm}>
 <form onSubmit={categoryForm.handleSubmit(handleCategorySubmit)} className="space-y-6">
 {/* Basic Information Section */}
 <div className="space-y-4">
 <div className="flex items-center gap-2">
 <div className="w-1.5 h-4 rounded-full bg-blue-500"></div>
 <h3 className="text-base font-semibold text-foreground ">
 Basic Information
 </h3>
 </div>
 
 <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
 <FormField
 control={categoryForm.control}
 name="name"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-sm font-medium text-foreground dark:text-muted-foreground">
 Category Name <span className="text-red-500">*</span>
 </FormLabel>
 <FormControl>
 <div className="relative">
 <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
 <Building2 className="w-3.5 h-3.5 text-muted-foreground dark:text-muted-foreground" />
 </div>
 <Input 
 placeholder="e.g., Cleaning Services"
 {...field}
 className="h-10 pl-9 text-sm border-border dark:border-gray-700 hover:border-border dark:hover:border-gray-600 focus:border-emerald-500 dark:focus:border-emerald-500"
 />
 </div>
 </FormControl>
 <FormMessage className="text-xs mt-1" />
 </FormItem>
 )}
 />
 
 <FormField
 control={categoryForm.control}
 name="isActive"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-sm font-medium text-foreground dark:text-muted-foreground">
 Status
 </FormLabel>
 <FormControl>
 <div className="flex items-center gap-2 p-2.5 rounded-md border border-border dark:border-gray-800 bg-muted dark:bg-gray-900/50">
 <div className={`w-2 h-2 rounded-full ${field.value ? 'bg-green-500' : 'bg-gray-400'}`}></div>
 <span className="text-sm text-foreground dark:text-muted-foreground">
 {field.value ? 'Active' : 'Inactive'}
 </span>
 <button
 type="button"
 onClick={() => field.onChange(!field.value)}
 className={`ml-auto relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${field.value ? 'bg-green-500' : 'bg-muted dark:bg-gray-700'}`}
 >
 <span
 className={`inline-block h-3 w-3 transform rounded-full bg-card transition-transform shadow-sm ${field.value ? 'translate-x-4' : 'translate-x-0.5'}`}
 />
 </button>
 </div>
 </FormControl>
 </FormItem>
 )}
 />
 </div>
 
 <FormField
 control={categoryForm.control}
 name="description"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-sm font-medium text-foreground dark:text-muted-foreground">
 Description
 </FormLabel>
 <FormControl>
 <Textarea 
 placeholder="Describe this service category..."
 {...field}
 className="min-h-[80px] text-sm border-border dark:border-gray-700 hover:border-border dark:hover:border-gray-600 focus:border-emerald-500 dark:focus:border-emerald-500"
 />
 </FormControl>
 </FormItem>
 )}
 />
 </div>
 
 {/* Pricing Section */}
 <div className="space-y-4">
 <div className="flex items-center gap-2">
 <div className="w-1.5 h-4 rounded-full bg-green-500"></div>
 <h3 className="text-base font-semibold text-foreground ">
 Default Pricing
 </h3>
 </div>
 
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 <FormField
 control={categoryForm.control}
 name="defaultHourlyRate"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-sm font-medium text-foreground dark:text-gray-gray-300">
 Hourly Rate (KES)
 </FormLabel>
 <FormControl>
 <div className="relative">
 <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
 <span className="text-sm text-muted-foreground dark:text-muted-foreground">KES</span>
 </div>
 <Input 
 type="number"
 placeholder="0"
 value={field.value || ''}
 onChange={(e) => field.onChange(e.target.value === '' ? 0 : Number(e.target.value))}
 className="h-10 pl-12 text-sm border-border dark:border-gray-700 hover:border-border dark:hover:border-gray-600 focus:border-green-500 dark:focus:border-green-500"
 />
 </div>
 </FormControl>
 </FormItem>
 )}
 />
 
 <FormField
 control={categoryForm.control}
 name="defaultDailyRate"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-sm font-medium text-foreground dark:text-muted-foreground">
 Daily Rate (KES)
 </FormLabel>
 <FormControl>
 <div className="relative">
 <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
 <span className="text-sm text-muted-foreground dark:text-muted-foreground">KES</span>
 </div>
 <Input 
 type="number"
 placeholder="0"
 value={field.value || ''}
 onChange={(e) => field.onChange(e.target.value === '' ? 0 : Number(e.target.value))}
 className="h-10 pl-12 text-sm border-border dark:border-gray-700 hover:border-border dark:hover:border-gray-600 focus:border-green-500 dark:focus:border-green-500"
 />
 </div>
 </FormControl>
 </FormItem>
 )}
 />
 </div>
 </div>
 
 {/* Services & Certifications Section */}
 <div className="space-y-4">
 <div className="flex items-center gap-2">
 <div className="w-1.5 h-4 rounded-full bg-purple-500"></div>
 <h3 className="text-base font-semibold text-foreground ">
 Services & Requirements
 </h3>
 </div>
 
 <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
 {/* Typical Services */}
 <div className="space-y-3">
 <FormField
 control={categoryForm.control}
 name="typicalServices"
 render={({ field }) => {
 const services = field.value || [];
 
 return (
 <FormItem>
 <FormLabel className="text-sm font-medium text-foreground dark:text-muted-foreground">
 Typical Services
 </FormLabel>
 <FormControl>
 <div className="space-y-2">
 <div className="flex gap-2">
 <Input
 placeholder="Add service"
 value={serviceInput}
 onChange={(e) => setServiceInput(e.target.value)}
 onKeyDown={(e) => {
 if (e.key === 'Enter' && serviceInput.trim()) {
 e.preventDefault();
 const newServices = [...services, serviceInput.trim()];
 field.onChange(newServices);
 setServiceInput('');
 }
 }}
 className="h-8 text-sm flex-1 border-border dark:border-gray-700 hover:border-border dark:hover:border-gray-600 focus:border-emerald-500 dark:focus:border-emerald-500"
 />
 <Button
 type="button"
 variant="outline"
 size="sm"
 className="h-8 px-2 border-border dark:border-gray-700 hover:bg-muted dark:hover:bg-gray-800"
 onClick={(e) => {
 e.preventDefault();
 if (serviceInput.trim()) {
 const newServices = [...services, serviceInput.trim()];
 field.onChange(newServices);
 setServiceInput('');
 }
 }}
 >
 <Plus className="w-3 h-3" />
 </Button>
 </div>
 
 {services.length > 0 && (
 <div className="space-y-1.5">
 <div className="flex justify-between items-center">
 <span className="text-xs text-muted-foreground dark:text-muted-foreground">
 {services.length} service(s)
 </span>
 <button
 type="button"
 onClick={() => field.onChange([])}
 className="text-xs text-red-500 hover:text-red-600 dark:text-red-400"
 >
 Clear all
 </button>
 </div>
 <div className="flex flex-wrap gap-1.5">
 {services.map((service:any, index:any) => (
 <div
 key={index}
 className="group flex items-center gap-1 px-2 py-1 bg-blue-50 dark:bg-blue-900/10 text-blue-700 dark:text-blue-300 rounded text-xs border border-blue-100 dark:border-blue-900/30"
 >
 <span>{service}</span>
 <button
 type="button"
 onClick={() => {
 const newServices = services.filter((_:any, i:any) => i !== index);
 field.onChange(newServices);
 }}
 className="opacity-0 group-hover:opacity-100 ml-0.5 text-blue-500 hover:text-blue-700 dark:text-blue-400"
 >
 ×
 </button>
 </div>
 ))}
 </div>
 </div>
 )}
 </div>
 </FormControl>
 </FormItem>
 );
 }}
 />
 </div>
 
 {/* Required Certifications */}
 <div className="space-y-3">
 <FormField
 control={categoryForm.control}
 name="requiredCertifications"
 render={({ field }) => {
 const certifications = field.value || [];
 
 return (
 <FormItem>
 <FormLabel className="text-sm font-medium text-foreground dark:text-muted-foreground">
 Required Certifications
 </FormLabel>
 <FormControl>
 <div className="space-y-2">
 <div className="flex gap-2">
 <Input
 placeholder="Add certification"
 value={certificationInput}
 onChange={(e) => setCertificationInput(e.target.value)}
 onKeyDown={(e) => {
 if (e.key === 'Enter' && certificationInput.trim()) {
 e.preventDefault();
 const newCerts = [...certifications, certificationInput.trim()];
 field.onChange(newCerts);
 setCertificationInput('');
 }
 }}
 className="h-8 text-sm flex-1 border-border dark:border-gray-700 hover:border-border dark:hover:border-gray-600 focus:border-green-500 dark:focus:border-green-500"
 />
 <Button
 type="button"
 variant="outline"
 size="sm"
 className="h-8 px-2 border-border dark:border-gray-700 hover:bg-muted dark:hover:bg-gray-800"
 onClick={(e) => {
 e.preventDefault();
 if (certificationInput.trim()) {
 const newCerts = [...certifications, certificationInput.trim()];
 field.onChange(newCerts);
 setCertificationInput('');
 }
 }}
 >
 <Plus className="w-3 h-3" />
 </Button>
 </div>
 
 {certifications.length > 0 && (
 <div className="space-y-1.5">
 <div className="flex justify-between items-center">
 <span className="text-xs text-muted-foreground dark:text-muted-foreground">
 {certifications.length} certification(s)
 </span>
 <button
 type="button"
 onClick={() => field.onChange([])}
 className="text-xs text-red-500 hover:text-red-600 dark:text-red-400"
 >
 Clear all
 </button>
 </div>
 <div className="flex flex-wrap gap-1.5">
 {certifications.map((cert:any, index:any) => (
 <div
 key={index}
 className="group flex items-center gap-1 px-2 py-1 bg-green-50 dark:bg-green-900/10 text-green-700 dark:text-green-300 rounded text-xs border border-green-100 dark:border-green-900/30"
 >
 <span>{cert}</span>
 <button
 type="button"
 onClick={() => {
 const newCerts = certifications.filter((_:any, i:any) => i !== index);
 field.onChange(newCerts);
 }}
 className="opacity-0 group-hover:opacity-100 ml-0.5 text-green-500 hover:text-green-700 dark:text-green-400"
 >
 ×
 </button>
 </div>
 ))}
 </div>
 </div>
 )}
 </div>
 </FormControl>
 </FormItem>
 );
 }}
 />
 </div>
 </div>
 </div>
 
 {/* Footer */}
 <DialogFooter className="border-t border-border dark:border-gray-800 pt-4 mt-4">
 <div className="flex flex-col sm:flex-row w-full gap-3">
 <div className="flex-1">
 {editingCategory && (
 <div className="space-y-0.5">
 <p className="text-xs text-muted-foreground dark:text-muted-foreground">
 ID: <span className="font-medium">{editingCategory.id}</span>
 </p>
 <p className="text-xs text-muted-foreground dark:text-muted-foreground">
 Updated: {editingCategory.updatedAt ? format(new Date(editingCategory.updatedAt), 'MMM dd, yyyy') : 'N/A'}
 </p>
 </div>
 )}
 </div>
 
 <div className="flex gap-2">
 <Button 
 type="button" 
 variant="outline" 
 onClick={() => setIsCategoryDialogOpen(false)}
 className="h-9 px-4 text-sm border-border dark:border-gray-700 hover:bg-muted dark:hover:bg-gray-800"
 >
 Cancel
 </Button>
 <Button 
 type="submit" 
 disabled={createCategoryMutation.isPending || updateCategoryMutation.isPending}
 className="h-9 px-4 text-sm bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800"
 >
 {createCategoryMutation.isPending || updateCategoryMutation.isPending ? (
 <>
 <div className="animate-spin h-3 w-3 mr-1.5 border-2 border-white border-t-transparent rounded-full" />
 {editingCategory ? "Saving..." : "Creating..."}
 </>
 ) : editingCategory ? (
 <>
 <CheckCircle className="w-3 h-3 mr-1.5" />
 Save
 </>
 ) : (
 <>
 <Plus className="w-3 h-3 mr-1.5" />
 Create
 </>
 )}
 </Button>
 </div>
 </div>
 </DialogFooter>
 </form>
 </Form>
 </div>
 </DialogContent>
 </Dialog>
 );
};

export default CategoryManagementModal;