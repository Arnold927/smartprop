import React, { useState } from "react";
import {
 Dialog,
 DialogContent,
 DialogDescription,
 DialogHeader,
 DialogOverlay,
 DialogTitle,
 DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { CheckCircle, UserPlus, Mail, Shield } from "lucide-react";
import { Label } from "@/components/ui/label";

// ----------------------
// Roles & Labels
// ----------------------
const roleLabels: Record<string, string> = {
 admin: "Admin",
 property_manager: "Property Manager",
 tenant: "Tenant",
 diaspora_buyer: "Diaspora Buyer",
 project_manager: "Project Manager",
 supplier_vendor: "Supplier/Vendor",
 casual_worker_staff: "Casual Worker/Staff",
};

// ----------------------
// Role Descriptions
// ----------------------
const roleDescriptions: Record<string, string> = {
 admin: "Full system access and user management",
 property_manager: "Manage properties, tenants, and maintenance",
 tenant: "Resident with lease and payment access",
 diaspora_buyer: "Overseas property investor",
 project_manager: "Construction project oversight",
 supplier_vendor: "Service provider and contractor",
 casual_worker_staff: "On-site staff and workers",
};

// ----------------------
// Default Permissions
// ----------------------
const getDefaultPermissions = (roleName: string): Record<string, any> => {
 const permissionSets: Record<string, Record<string, any>> = {
 admin: {
 full_access: true,
 can_manage_users: true,
 can_manage_properties: true,
 can_view_financials: true,
 can_manage_construction: true,
 can_assign_roles: true,
 },
 property_manager: {
 can_manage_tenants: true,
 can_view_reports: true,
 can_manage_maintenance: true,
 can_collect_rent: true,
 can_manage_visitors: true,
 can_view_financials: true,
 },
 tenant: {
 can_view_own_data: true,
 can_make_payments: true,
 can_submit_maintenance: true,
 can_view_lease: true,
 },
 diaspora_buyer: {
 can_view_properties: true,
 can_express_interest: true,
 can_submit_offers: true,
 },
 project_manager: {
 can_manage_construction: true,
 can_assign_tasks: true,
 can_view_budgets: true,
 can_manage_contractors: true,
 can_track_progress: true,
 },
 supplier_vendor: {
 can_view_assigned_requests: true,
 can_update_work_status: true,
 can_submit_quotes: true,
 can_upload_completion_photos: true,
 },
 casual_worker_staff: {
 can_clock_in_out: true,
 can_view_assigned_tasks: true,
 can_update_task_progress: true,
 can_request_materials: true,
 },
 };
 return permissionSets[roleName] || {};
};

// ----------------------
// User Invite Modal
// ----------------------
export default function UserInviteModal({ triggerText }: { triggerText: string }) {
 const [open, setOpen] = useState(false);
 const [modalTab, setModalTab] = useState("create");
 const { toast } = useToast();
 const queryClient = useQueryClient();

 // ----------------------
 // Mutations
 // ----------------------
 const createUserMutation = useMutation({
 mutationFn: (data: any) => apiRequest("/api/users", { method: "POST", data }),
 onSuccess: () => {
 toast({ 
 title: "User created successfully",
 description: "The user has been added to the system."
 });
 queryClient.invalidateQueries({ queryKey: ["/api/users"] });
 setOpen(false);
 },
 onError: (err: any) =>
 toast({
 title: "Error creating user",
 description: err.message || "Failed to create user",
 variant: "destructive",
 }),
 });

 const inviteUserMutation = useMutation({
 mutationFn: (data: any) => apiRequest("/api/users", { method: "POST", data }),
 onSuccess: () => {
 toast({ 
 title: "Invite sent!",
 description: "The invitation has been sent to the user's email."
 });
 queryClient.invalidateQueries({ queryKey: ["/api/users"] });
 setOpen(false);
 },
 onError: (err: any) =>
 toast({
 title: "Error sending invite",
 description: err.message || "Failed to send invite",
 variant: "destructive",
 }),
 });

 // ----------------------
 // Form Handlers
 // ----------------------
 const handleCreateUser = (e: React.FormEvent<HTMLFormElement>) => {
 e.preventDefault();
 const formData = new FormData(e.currentTarget);
 const role = formData.get("role") as string;

 createUserMutation.mutate({
 email: formData.get("email"),
 passwordHash: btoa(formData.get("password") as string),
 firstName: formData.get("firstName"),
 lastName: formData.get("lastName"),
 role,
 permissions: getDefaultPermissions(role),
 });
 };

 const handleInviteUser = (e: React.FormEvent<HTMLFormElement>) => {
 e.preventDefault();
 const formData = new FormData(e.currentTarget);
 const role = formData.get("role") as string;

 inviteUserMutation.mutate({
 email: formData.get("email"),
 role,
 permissions: getDefaultPermissions(role),
 invite: true,
 });
 };

 // ----------------------
 // Render
 // ----------------------
 return (
 <Dialog open={open} onOpenChange={setOpen}>
 <DialogTrigger asChild>
 <Button className="gap-2">
 <UserPlus className="h-4 w-4" />
 {triggerText}
 </Button>
 </DialogTrigger>
 <DialogOverlay className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
 <DialogContent className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 max-w-2xl p-0 rounded-xl shadow-2xl bg-card border border-border overflow-hidden">
 <div className="max-h-[90vh] overflow-y-auto">
 <div className="p-8">
 <DialogHeader className="space-y-2">
 <DialogTitle className="text-2xl font-semibold text-foreground flex items-center gap-2">
 <UserPlus className="h-6 w-6" />
 Add New User
 </DialogTitle>
 <DialogDescription className="text-muted-foreground">
 Choose between creating a user directly or sending an invitation link for them to set up their own account.
 </DialogDescription>
 </DialogHeader>

 <Tabs value={modalTab} onValueChange={setModalTab} className="mt-6">
 <TabsList className="grid grid-cols-2 mb-8 bg-muted p-1 rounded-lg">
 <TabsTrigger value="create" className="rounded-md data-[state=active]:bg-card data-[state=active]:shadow-sm">
 <div className="flex items-center gap-2">
 <UserPlus className="h-4 w-4" />
 <span>Create User</span>
 </div>
 </TabsTrigger>
 <TabsTrigger value="invite" className="rounded-md data-[state=active]:bg-card data-[state=active]:shadow-sm">
 <div className="flex items-center gap-2">
 <Mail className="h-4 w-4" />
 <span>Send Invite</span>
 </div>
 </TabsTrigger>
 </TabsList>

 {/* ------------------- Create User Tab ------------------- */}
 <TabsContent value="create" className="space-y-6 mt-2 animate-in fade-in duration-300">
 <form onSubmit={handleCreateUser} className="space-y-6">
 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
 <div className="space-y-3">
 <Label htmlFor="firstName" className="text-sm font-medium text-foreground">
 First Name
 </Label>
 <Input 
 id="firstName"
 name="firstName" 
 placeholder="Enter first name" 
 required 
 className="border-border focus:border-emerald-500 focus:ring-emerald-500 transition-colors"
 />
 </div>
 <div className="space-y-3">
 <Label htmlFor="lastName" className="text-sm font-medium text-foreground">
 Last Name
 </Label>
 <Input 
 id="lastName"
 name="lastName" 
 placeholder="Enter last name" 
 required 
 className="border-border focus:border-emerald-500 focus:ring-emerald-500 transition-colors"
 />
 </div>
 </div>
 
 <div className="space-y-3">
 <Label htmlFor="email" className="text-sm font-medium text-foreground">
 Email Address
 </Label>
 <Input 
 id="email"
 name="email" 
 type="email" 
 placeholder="user@example.com" 
 required 
 className="border-border focus:border-emerald-500 focus:ring-emerald-500 transition-colors"
 />
 </div>
 
 <div className="space-y-3">
 <Label htmlFor="password" className="text-sm font-medium text-foreground">
 Password
 </Label>
 <Input 
 id="password"
 name="password" 
 type="password" 
 placeholder="Create a secure password" 
 required 
 className="border-border focus:border-emerald-500 focus:ring-emerald-500 transition-colors"
 />
 </div>
 
 <div className="space-y-3">
 <Label htmlFor="create-role" className="text-sm font-medium text-foreground flex items-center gap-2">
 <Shield className="h-4 w-4" />
 Role Selection
 </Label>
 <Select name="role" required>
 <SelectTrigger 
 id="create-role"
 className="border-border focus:border-emerald-500 focus:ring-emerald-500 transition-colors"
 >
 <SelectValue placeholder="Select a role for this user" />
 </SelectTrigger>
 <SelectContent className="border-border shadow-lg">
 {Object.entries(roleLabels).map(([key, label]) => (
 <SelectItem key={key} value={key} className="py-3">
 <div className="flex flex-col">
 <span className="font-medium">{label}</span>
 <span className="text-xs text-muted-foreground mt-0.5">
 {roleDescriptions[key]}
 </span>
 </div>
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>

 <div className="p-4 bg-blue-50 rounded-lg border border-blue-100" >
 <div className="flex items-start gap-3">
 <CheckCircle className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
 <div>
 <p className="text-sm font-medium text-blue-800">Permissions configured automatically</p>
 <p className="text-xs text-blue-600 mt-1">
 All necessary permissions for the selected role will be assigned automatically.
 You can customize permissions later from the user management page.
 </p>
 </div>
 </div>
 </div>

 <Button 
 type="submit" 
 disabled={createUserMutation.isPending}
 className="w-full bg-blue-600 hover:bg-blue-700 transition-colors"
 >
 {createUserMutation.isPending ? (
 <>
 <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
 Creating User...
 </>
 ) : (
 "Create User Account"
 )}
 </Button>
 </form>
 </TabsContent>

 {/* ------------------- Send Invite Tab ------------------- */}
 <TabsContent value="invite" className="space-y-6 mt-2 animate-in fade-in duration-300">
 <form onSubmit={handleInviteUser} className="space-y-6">
 <div className="space-y-3">
 <Label htmlFor="invite-email" className="text-sm font-medium text-foreground">
 Email Address
 </Label>
 <Input 
 id="invite-email"
 name="email" 
 type="email" 
 placeholder="user@example.com" 
 required 
 className="border-border focus:border-emerald-500 focus:ring-emerald-500 transition-colors"
 />
 <p className="text-xs text-muted-foreground mt-1">
 The user will receive an invitation email to join the platform.
 </p>
 </div>
 
 <div className="space-y-3">
 <Label htmlFor="invite-role" className="text-sm font-medium text-foreground flex items-center gap-2">
 <Shield className="h-4 w-4" />
 Assign Role
 </Label>
 <Select name="role" required>
 <SelectTrigger 
 id="invite-role"
 className="border-border focus:border-emerald-500 focus:ring-emerald-500 transition-colors"
 >
 <SelectValue placeholder="Select role for invited user" />
 </SelectTrigger>
 <SelectContent className="border-border shadow-lg">
 {Object.entries(roleLabels).map(([key, label]) => (
 <SelectItem key={key} value={key} className="py-3">
 <div className="flex flex-col">
 <span className="font-medium">{label}</span>
 <span className="text-xs text-muted-foreground mt-0.5">
 {roleDescriptions[key]}
 </span>
 </div>
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>

 <div className="p-4 bg-green-50 rounded-lg border border-green-100" >
 <div className="flex items-start gap-3">
 <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
 <div>
 <p className="text-sm font-medium text-green-800">Self-service setup</p>
 <p className="text-xs text-green-600 mt-1">
 The user will receive an invitation link and can set up their own password.
 Role and permissions will be applied automatically when they accept the invite.
 </p>
 </div>
 </div>
 </div>

 <Button 
 type="submit" 
 disabled={inviteUserMutation.isPending}
 className="w-full bg-green-600 hover:bg-green-700 transition-colors"
 >
 {inviteUserMutation.isPending ? (
 <>
 <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
 Sending Invite...
 </>
 ) : (
 "Send Invitation Email"
 )}
 </Button>
 </form>
 </TabsContent>
 </Tabs>
 </div>
 </div>
 </DialogContent>
 </Dialog>
 );
}