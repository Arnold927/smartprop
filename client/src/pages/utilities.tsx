import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Zap, Droplet, Flame, Wifi, Trash2, DollarSign, TrendingUp, FileText, Activity, CheckCircle2, Clock, BarChart3, PieChart } from "lucide-react";
import { LineChart, Line, BarChart, Bar, PieChart as RePieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, ensureArray } from "@/lib/queryClient";
import DataTable from "@/components/ui/data-table";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";

// Utility type icons
const utilityIcons: Record<string, React.ReactNode> = {
 electricity: <Zap className="h-4 w-4" />,
 water: <Droplet className="h-4 w-4" />,
 gas: <Flame className="h-4 w-4" />,
 internet: <Wifi className="h-4 w-4" />,
};

// Provider form schema
const providerSchema = z.object({
 name: z.string().min(1, "Provider name is required"),
 type: z.string().min(1, "Type is required"),
 contactEmail: z.string().email().optional().or(z.literal("")),
 contactPhone: z.string().optional(),
 billingCycle: z.string().min(1, "Billing cycle is required"),
 averageRate: z.string().optional(),
 currency: z.string().default("KES"),
});

// Account form schema
const accountSchema = z.object({
 propertyId: z.number(),
 unitId: z.number().optional(),
 providerId: z.number(),
 accountNumber: z.string().min(1, "Account number is required"),
 meterNumber: z.string().optional(),
 connectionDate: z.string().optional(),
 notes: z.string().optional(),
});

// Bill form schema
const billSchema = z.object({
 accountId: z.number(),
 billNumber: z.string().optional(),
 billingPeriodStart: z.string(),
 billingPeriodEnd: z.string(),
 dueDate: z.string(),
 amount: z.string().min(1, "Amount is required"),
 currency: z.string().default("KES"),
 unitsConsumed: z.string().optional(),
 unitRate: z.string().optional(),
 previousReading: z.string().optional(),
 currentReading: z.string().optional(),
 status: z.string().default("pending"),
 notes: z.string().optional(),
});

// Meter reading form schema
const meterReadingSchema = z.object({
 accountId: z.number(),
 readingDate: z.string(),
 reading: z.string().min(1, "Reading is required"),
 readingType: z.string().default("manual"),
 consumption: z.string().optional(),
 readBy: z.string().optional(),
 imageUrl: z.string().optional(),
 notes: z.string().optional(),
});

export default function Utilities() {
 const [isProviderModalOpen, setIsProviderModalOpen] = useState(false);
 const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
 const [isBillModalOpen, setIsBillModalOpen] = useState(false);
 const [isReadingModalOpen, setIsReadingModalOpen] = useState(false);
 const { toast } = useToast();

 // Fetch utility data
 const { data: providers = [] , isError , isLoading } = useQuery({
 queryKey: ["/api/utility-providers"],
 queryFn: async () => { const r = await apiRequest("/api/utility-providers"); return ensureArray(await r.json()); },
 });

 const { data: accounts = [] } = useQuery({
 queryKey: ["/api/utility-accounts"],
 queryFn: async () => { const r = await apiRequest("/api/utility-accounts"); return ensureArray(await r.json()); },
 });

 const { data: bills = [] } = useQuery({
 queryKey: ["/api/utility-bills"],
 queryFn: async () => { const r = await apiRequest("/api/utility-bills"); return ensureArray(await r.json()); },
 });

 const { data: readings = [] } = useQuery({
 queryKey: ["/api/utility-meter-readings"],
 queryFn: async () => { const r = await apiRequest("/api/utility-meter-readings"); return ensureArray(await r.json()); },
 });

 const { data: properties = [] } = useQuery({
 queryKey: ["/api/properties"],
 queryFn: async () => { const r = await apiRequest("/api/properties"); return ensureArray(await r.json()); },
 });

 // Forms
 const providerForm = useForm({
 resolver: zodResolver(providerSchema),
 defaultValues: {
 name: "",
 type: "",
 contactEmail: "",
 contactPhone: "",
 billingCycle: "monthly",
 averageRate: "",
 currency: "KES",
 },
 });

 const accountForm = useForm({
 resolver: zodResolver(accountSchema),
 defaultValues: {
 propertyId: 0,
 providerId: 0,
 accountNumber: "",
 meterNumber: "",
 connectionDate: new Date().toISOString().split('T')[0],
 notes: "",
 },
 });

 const billForm = useForm({
 resolver: zodResolver(billSchema),
 defaultValues: {
 accountId: 0,
 billNumber: "",
 billingPeriodStart: "",
 billingPeriodEnd: "",
 dueDate: "",
 amount: "",
 currency: "KES",
 unitsConsumed: "",
 unitRate: "",
 previousReading: "",
 currentReading: "",
 status: "pending",
 notes: "",
 },
 });

 const readingForm = useForm({
 resolver: zodResolver(meterReadingSchema),
 defaultValues: {
 accountId: 0,
 readingDate: new Date().toISOString().split('T')[0],
 reading: "",
 readingType: "manual",
 consumption: "",
 readBy: "",
 imageUrl: "",
 notes: "",
 },
 });

 // Mutations
 const createProviderMutation = useMutation({
 mutationFn: (data: z.infer<typeof providerSchema>) =>
 apiRequest("/api/utility-providers", { method: "POST", data: data }),
 onSuccess: () => {
 queryClient.invalidateQueries({ queryKey: ["/api/utility-providers"] });
 setIsProviderModalOpen(false);
 providerForm.reset();
 toast({ title: "Success", description: "Provider created successfully" });
 },
 });

 const createAccountMutation = useMutation({
 mutationFn: (data: z.infer<typeof accountSchema>) =>
 apiRequest("/api/utility-accounts", { method: "POST", data: data }),
 onSuccess: () => {
 queryClient.invalidateQueries({ queryKey: ["/api/utility-accounts"] });
 setIsAccountModalOpen(false);
 accountForm.reset();
 toast({ title: "Success", description: "Account created successfully" });
 },
 });

 const createBillMutation = useMutation({
 mutationFn: (data: z.infer<typeof billSchema>) =>
 apiRequest("/api/utility-bills", { method: "POST", data: data }),
 onSuccess: () => {
 queryClient.invalidateQueries({ queryKey: ["/api/utility-bills"] });
 setIsBillModalOpen(false);
 billForm.reset();
 toast({ title: "Success", description: "Bill created successfully" });
 },
 });

 const createReadingMutation = useMutation({
 mutationFn: (data: z.infer<typeof meterReadingSchema>) =>
 apiRequest("/api/utility-meter-readings", { method: "POST", data: data }),
 onSuccess: () => {
 queryClient.invalidateQueries({ queryKey: ["/api/utility-meter-readings"] });
 setIsReadingModalOpen(false);
 readingForm.reset();
 toast({ title: "Success", description: "Meter reading recorded successfully" });
 },
 });

 const updateBillMutation = useMutation({
 mutationFn: ({ id, data }: { id: number; data: Partial<z.infer<typeof billSchema>> }) =>
 apiRequest(`/api/utility-bills/${id}`, { method: "PUT", data: data }),
 onSuccess: () => {
 queryClient.invalidateQueries({ queryKey: ["/api/utility-bills"] });
 toast({ title: "Success", description: "Bill updated successfully" });
 },
 });

 // Calculate analytics
 const totalBills = bills.length;
 const pendingBills = (Array.isArray(bills) ? bills : []).filter((b: any) => b.status === "pending").length;
 const paidBills = (Array.isArray(bills) ? bills : []).filter((b: any) => b.status === "paid").length;
 const overdueBills = (Array.isArray(bills) ? bills : []).filter((b: any) => b.status === "overdue").length;
 const totalAmount = bills.reduce((sum: number, b: any) => sum + parseFloat(b.amount || 0), 0);
 const paidAmount = bills
 .filter((b: any) => b.status === "paid")
 .reduce((sum: number, b: any) => sum + parseFloat(b.amount || 0), 0);

 // Provider columns
 const providerColumns = [
 {
 header: "Provider",
 accessorKey: "name",
 cell: (provider: any) => (
 <div className="flex items-center space-x-2">
 {utilityIcons[provider.type.toLowerCase()] || <Activity className="h-4 w-4" />}
 <div>
 <p className="font-medium">{provider.name}</p>
 <p className="text-sm text-muted-foreground capitalize">{provider.type}</p>
 </div>
 </div>
 ),
 },
 {
 header: "Contact",
 accessorKey: "contactEmail",
 cell: (provider: any) => (
 <div>
 {provider.contactEmail && <p className="text-sm">{provider.contactEmail}</p>}
 {provider.contactPhone && <p className="text-sm text-muted-foreground">{provider.contactPhone}</p>}
 </div>
 ),
 },
 {
 header: "Billing Cycle",
 accessorKey: "billingCycle",
 cell: (provider: any) => <Badge variant="outline" className="capitalize">{provider.billingCycle}</Badge>,
 },
 {
 header: "Average Rate",
 accessorKey: "averageRate",
 cell: (provider: any) => provider.averageRate ? `${provider.currency} ${provider.averageRate}` : "N/A",
 },
 ];

 // Account columns
 const accountColumns = [
 {
 header: "Account",
 accessorKey: "accountNumber",
 cell: (account: any) => (
 <div>
 <p className="font-medium">{account.accountNumber}</p>
 {account.meterNumber && <p className="text-sm text-muted-foreground">Meter: {account.meterNumber}</p>}
 </div>
 ),
 },
 {
 header: "Provider",
 accessorKey: "providerId",
 cell: (account: any) => {
 const provider = providers.find((p: any) => p.id === account.providerId);
 return provider ? provider.name : "Unknown";
 },
 },
 {
 header: "Property",
 accessorKey: "propertyId",
 cell: (account: any) => {
 const property = properties.find((p: any) => p.id === account.propertyId);
 return property ? property.name : "Unknown";
 },
 },
 {
 header: "Status",
 accessorKey: "isActive",
 cell: (account: any) => (
 <Badge variant={account.isActive ? "default" : "secondary"}>
 {account.isActive ? "Active" : "Inactive"}
 </Badge>
 ),
 },
 ];

 // Bill columns
 const billColumns = [
 {
 header: "Bill #",
 accessorKey: "billNumber",
 cell: (bill: any) => bill.billNumber || `#${bill.id}`,
 },
 {
 header: "Account",
 accessorKey: "accountId",
 cell: (bill: any) => {
 const account = accounts.find((a: any) => a.id === bill.accountId);
 return account ? account.accountNumber : "Unknown";
 },
 },
 {
 header: "Period",
 accessorKey: "billingPeriod",
 cell: (bill: any) => {
 const start = new Date(bill.billingPeriodStart).toLocaleDateString();
 const end = new Date(bill.billingPeriodEnd).toLocaleDateString();
 return `${start} - ${end}`;
 },
 },
 {
 header: "Amount",
 accessorKey: "amount",
 cell: (bill: any) => (
 <span className="font-semibold">{bill.currency} {parseFloat(bill.amount).toLocaleString()}</span>
 ),
 },
 {
 header: "Due Date",
 accessorKey: "dueDate",
 cell: (bill: any) => new Date(bill.dueDate).toLocaleDateString(),
 },
 {
 header: "Status",
 accessorKey: "status",
 cell: (bill: any) => (
 <Badge
 variant={
 bill.status === "paid" ? "default" :
 bill.status === "overdue" ? "destructive" :
 "secondary"
 }
 className="capitalize"
 >
 {bill.status}
 </Badge>
 ),
 },
 {
 header: "Actions",
 accessorKey: "actions",
 cell: (bill: any) => (
 <div className="flex items-center space-x-2">
 {bill.status === "pending" && (
 <Button
 size="sm"
 variant="outline"
 onClick={() => updateBillMutation.mutate({ id: bill.id, data: { status: "paid", paidDate: new Date().toISOString() } })}
 data-testid={`button-pay-bill-${bill.id}`}
 >
 <CheckCircle2 className="h-4 w-4 mr-1" />
 Mark Paid
 </Button>
 )}
 </div>
 ),
 },
 ];

 // Meter reading columns
 const readingColumns = [
 {
 header: "Date",
 accessorKey: "readingDate",
 cell: (reading: any) => new Date(reading.readingDate).toLocaleDateString(),
 },
 {
 header: "Account",
 accessorKey: "accountId",
 cell: (reading: any) => {
 const account = accounts.find((a: any) => a.id === reading.accountId);
 return account ? account.accountNumber : "Unknown";
 },
 },
 {
 header: "Reading",
 accessorKey: "reading",
 cell: (reading: any) => <span className="font-medium">{reading.reading}</span>,
 },
 {
 header: "Consumption",
 accessorKey: "consumption",
 cell: (reading: any) => reading.consumption || "N/A",
 },
 {
 header: "Type",
 accessorKey: "readingType",
 cell: (reading: any) => (
 <Badge variant="outline" className="capitalize">{reading.readingType}</Badge>
 ),
 },
 {
 header: "Verified",
 accessorKey: "verified",
 cell: (reading: any) => (
 reading.verified ? (
 <CheckCircle2 className="h-4 w-4 text-green-600" />
 ) : (
 <Clock className="h-4 w-4 text-muted-foreground" />
 )
 ),
 },
 ];

 if (isLoading) return <div className="p-6 animate-pulse space-y-4"><div className="h-8 bg-muted dark:bg-gray-700 rounded w-48" /><div className="h-64 bg-muted dark:bg-gray-700 rounded-2xl" /></div>;
 return (
 <div className="p-6 space-y-6">
 {/* Header */}
 <div>
 <h1 className="text-2xl font-semibold text-foreground">Utility Management</h1>
 <p className="text-muted-foreground">Manage providers, accounts, bills, and meter readings</p>
 </div>

 {/* Analytics Cards */}
 <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
 <Card>
 <CardContent className="p-6">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm text-muted-foreground">Total Bills</p>
 <p className="text-2xl font-semibold">{totalBills}</p>
 </div>
 <FileText className="h-8 w-8 text-blue-600" />
 </div>
 </CardContent>
 </Card>
 <Card>
 <CardContent className="p-6">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm text-muted-foreground">Pending</p>
 <p className="text-2xl font-semibold">{pendingBills}</p>
 </div>
 <Clock className="h-8 w-8 text-orange-600" />
 </div>
 </CardContent>
 </Card>
 <Card>
 <CardContent className="p-6">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm text-muted-foreground">Total Amount</p>
 <p className="text-2xl font-semibold">KSh {totalAmount.toLocaleString()}</p>
 </div>
 <DollarSign className="h-8 w-8 text-green-600" />
 </div>
 </CardContent>
 </Card>
 <Card>
 <CardContent className="p-6">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm text-muted-foreground">Paid Amount</p>
 <p className="text-2xl font-semibold">KSh {paidAmount.toLocaleString()}</p>
 </div>
 <TrendingUp className="h-8 w-8 text-purple-600" />
 </div>
 </CardContent>
 </Card>
 </div>

 {/* Main Content */}
 <Tabs defaultValue="providers" className="space-y-6">
 <TabsList className="grid w-full grid-cols-5">
 <TabsTrigger value="providers">Providers</TabsTrigger>
 <TabsTrigger value="accounts">Accounts</TabsTrigger>
 <TabsTrigger value="bills">Bills</TabsTrigger>
 <TabsTrigger value="readings">Meter Readings</TabsTrigger>
 <TabsTrigger value="analytics">Analytics</TabsTrigger>
 </TabsList>

 {/* Providers Tab */}
 <TabsContent value="providers" className="space-y-4">
 <div className="flex justify-between items-center">
 <h2 className="text-lg font-semibold">Utility Providers</h2>
 <Dialog open={isProviderModalOpen} onOpenChange={setIsProviderModalOpen}>
 <DialogTrigger asChild>
 <Button data-testid="button-add-provider">
 <Plus className="h-4 w-4 mr-2" />
 Add Provider
 </Button>
 </DialogTrigger>
 <DialogContent className="max-w-xl">
 <DialogHeader>
 <DialogTitle>Add Utility Provider</DialogTitle>
 </DialogHeader>
 <Form {...providerForm}>
 <form onSubmit={providerForm.handleSubmit((data) => createProviderMutation.mutate(data))} className="space-y-4">
 <FormField
 control={providerForm.control}
 name="name"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Provider Name</FormLabel>
 <FormControl>
 <Input {...field} placeholder="e.g., Kenya Power" data-testid="input-provider-name" />
 </FormControl>
 <FormMessage />
 </FormItem>
 )}
 />
 <FormField
 control={providerForm.control}
 name="type"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Type</FormLabel>
 <Select onValueChange={field.onChange} defaultValue={field.value}>
 <FormControl>
 <SelectTrigger data-testid="select-provider-type">
 <SelectValue placeholder="Select type" />
 </SelectTrigger>
 </FormControl>
 <SelectContent>
 <SelectItem value="electricity">Electricity</SelectItem>
 <SelectItem value="water">Water</SelectItem>
 <SelectItem value="gas">Gas</SelectItem>
 <SelectItem value="internet">Internet</SelectItem>
 <SelectItem value="garbage">Garbage Collection</SelectItem>
 <SelectItem value="other">Other</SelectItem>
 </SelectContent>
 </Select>
 <FormMessage />
 </FormItem>
 )}
 />
 <FormField
 control={providerForm.control}
 name="contactEmail"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Contact Email</FormLabel>
 <FormControl>
 <Input {...field} type="email" placeholder="provider@example.com" data-testid="input-provider-email" />
 </FormControl>
 <FormMessage />
 </FormItem>
 )}
 />
 <FormField
 control={providerForm.control}
 name="contactPhone"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Contact Phone</FormLabel>
 <FormControl>
 <Input {...field} placeholder="+254..." data-testid="input-provider-phone" />
 </FormControl>
 <FormMessage />
 </FormItem>
 )}
 />
 <FormField
 control={providerForm.control}
 name="billingCycle"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Billing Cycle</FormLabel>
 <Select onValueChange={field.onChange} defaultValue={field.value}>
 <FormControl>
 <SelectTrigger data-testid="select-billing-cycle">
 <SelectValue />
 </SelectTrigger>
 </FormControl>
 <SelectContent>
 <SelectItem value="monthly">Monthly</SelectItem>
 <SelectItem value="quarterly">Quarterly</SelectItem>
 <SelectItem value="annually">Annually</SelectItem>
 </SelectContent>
 </Select>
 <FormMessage />
 </FormItem>
 )}
 />
 <Button type="submit" className="w-full" disabled={createProviderMutation.isPending} data-testid="button-submit-provider">
 {createProviderMutation.isPending ? "Creating..." : "Create Provider"}
 </Button>
 </form>
 </Form>
 </DialogContent>
 </Dialog>
 </div>
 <Card>
 <CardContent className="p-6">
 <DataTable
 data={providers}
 columns={providerColumns}
 emptyMessage="No providers found. Add your first utility provider."
 />
 </CardContent>
 </Card>
 </TabsContent>

 {/* Accounts Tab */}
 <TabsContent value="accounts" className="space-y-4">
 <div className="flex justify-between items-center">
 <h2 className="text-lg font-semibold">Utility Accounts</h2>
 <Dialog open={isAccountModalOpen} onOpenChange={setIsAccountModalOpen}>
 <DialogTrigger asChild>
 <Button data-testid="button-add-account">
 <Plus className="h-4 w-4 mr-2" />
 Add Account
 </Button>
 </DialogTrigger>
 <DialogContent className="max-w-xl">
 <DialogHeader>
 <DialogTitle>Add Utility Account</DialogTitle>
 </DialogHeader>
 <Form {...accountForm}>
 <form onSubmit={accountForm.handleSubmit((data) => createAccountMutation.mutate(data))} className="space-y-4">
 <FormField
 control={accountForm.control}
 name="propertyId"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Property</FormLabel>
 <Select onValueChange={(value) => field.onChange(parseInt(value))} defaultValue={field.value?.toString()}>
 <FormControl>
 <SelectTrigger data-testid="select-property">
 <SelectValue placeholder="Select property" />
 </SelectTrigger>
 </FormControl>
 <SelectContent>
 {(Array.isArray(properties) ? properties : []).map((property: any) => (
 <SelectItem key={property.id} value={property.id.toString()}>
 {property.name}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 <FormMessage />
 </FormItem>
 )}
 />
 <FormField
 control={accountForm.control}
 name="providerId"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Provider</FormLabel>
 <Select onValueChange={(value) => field.onChange(parseInt(value))} defaultValue={field.value?.toString()}>
 <FormControl>
 <SelectTrigger data-testid="select-provider">
 <SelectValue placeholder="Select provider" />
 </SelectTrigger>
 </FormControl>
 <SelectContent>
 {(Array.isArray(providers) ? providers : []).map((provider: any) => (
 <SelectItem key={provider.id} value={provider.id.toString()}>
 {provider.name}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 <FormMessage />
 </FormItem>
 )}
 />
 <FormField
 control={accountForm.control}
 name="accountNumber"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Account Number</FormLabel>
 <FormControl>
 <Input {...field} placeholder="Account number" data-testid="input-account-number" />
 </FormControl>
 <FormMessage />
 </FormItem>
 )}
 />
 <FormField
 control={accountForm.control}
 name="meterNumber"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Meter Number (Optional)</FormLabel>
 <FormControl>
 <Input {...field} placeholder="Meter number" data-testid="input-meter-number" />
 </FormControl>
 <FormMessage />
 </FormItem>
 )}
 />
 <Button type="submit" className="w-full" disabled={createAccountMutation.isPending} data-testid="button-submit-account">
 {createAccountMutation.isPending ? "Creating..." : "Create Account"}
 </Button>
 </form>
 </Form>
 </DialogContent>
 </Dialog>
 </div>
 <Card>
 <CardContent className="p-6">
 <DataTable
 data={accounts}
 columns={accountColumns}
 emptyMessage="No accounts found. Add your first utility account."
 />
 </CardContent>
 </Card>
 </TabsContent>

 {/* Bills Tab */}
 <TabsContent value="bills" className="space-y-4">
 <div className="flex justify-between items-center">
 <h2 className="text-lg font-semibold">Utility Bills</h2>
 <Dialog open={isBillModalOpen} onOpenChange={setIsBillModalOpen}>
 <DialogTrigger asChild>
 <Button data-testid="button-add-bill">
 <Plus className="h-4 w-4 mr-2" />
 Add Bill
 </Button>
 </DialogTrigger>
 <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
 <DialogHeader>
 <DialogTitle>Add Utility Bill</DialogTitle>
 </DialogHeader>
 <Form {...billForm}>
 <form onSubmit={billForm.handleSubmit((data) => createBillMutation.mutate(data))} className="space-y-4">
 <FormField
 control={billForm.control}
 name="accountId"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Account</FormLabel>
 <Select onValueChange={(value) => field.onChange(parseInt(value))} defaultValue={field.value?.toString()}>
 <FormControl>
 <SelectTrigger data-testid="select-bill-account">
 <SelectValue placeholder="Select account" />
 </SelectTrigger>
 </FormControl>
 <SelectContent>
 {(Array.isArray(accounts) ? accounts : []).map((account: any) => (
 <SelectItem key={account.id} value={account.id.toString()}>
 {account.accountNumber}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 <FormMessage />
 </FormItem>
 )}
 />
 <div className="grid grid-cols-2 gap-4">
 <FormField
 control={billForm.control}
 name="billingPeriodStart"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Period Start</FormLabel>
 <FormControl>
 <Input {...field} type="date" data-testid="input-period-start" />
 </FormControl>
 <FormMessage />
 </FormItem>
 )}
 />
 <FormField
 control={billForm.control}
 name="billingPeriodEnd"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Period End</FormLabel>
 <FormControl>
 <Input {...field} type="date" data-testid="input-period-end" />
 </FormControl>
 <FormMessage />
 </FormItem>
 )}
 />
 </div>
 <div className="grid grid-cols-2 gap-4">
 <FormField
 control={billForm.control}
 name="amount"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Amount</FormLabel>
 <FormControl>
 <Input {...field} type="number" step="0.01" placeholder="0.00" data-testid="input-bill-amount" />
 </FormControl>
 <FormMessage />
 </FormItem>
 )}
 />
 <FormField
 control={billForm.control}
 name="dueDate"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Due Date</FormLabel>
 <FormControl>
 <Input {...field} type="date" data-testid="input-due-date" />
 </FormControl>
 <FormMessage />
 </FormItem>
 )}
 />
 </div>
 <div className="grid grid-cols-2 gap-4">
 <FormField
 control={billForm.control}
 name="previousReading"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Previous Reading</FormLabel>
 <FormControl>
 <Input {...field} placeholder="Previous reading" data-testid="input-previous-reading" />
 </FormControl>
 <FormMessage />
 </FormItem>
 )}
 />
 <FormField
 control={billForm.control}
 name="currentReading"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Current Reading</FormLabel>
 <FormControl>
 <Input {...field} placeholder="Current reading" data-testid="input-current-reading" />
 </FormControl>
 <FormMessage />
 </FormItem>
 )}
 />
 </div>
 <Button type="submit" className="w-full" disabled={createBillMutation.isPending} data-testid="button-submit-bill">
 {createBillMutation.isPending ? "Creating..." : "Create Bill"}
 </Button>
 </form>
 </Form>
 </DialogContent>
 </Dialog>
 </div>
 <Card>
 <CardContent className="p-6">
 <DataTable
 data={bills}
 columns={billColumns}
 emptyMessage="No bills found. Add your first utility bill."
 />
 </CardContent>
 </Card>
 </TabsContent>

 {/* Meter Readings Tab */}
 <TabsContent value="readings" className="space-y-4">
 <div className="flex justify-between items-center">
 <h2 className="text-lg font-semibold">Meter Readings</h2>
 <Dialog open={isReadingModalOpen} onOpenChange={setIsReadingModalOpen}>
 <DialogTrigger asChild>
 <Button data-testid="button-add-reading">
 <Plus className="h-4 w-4 mr-2" />
 Record Reading
 </Button>
 </DialogTrigger>
 <DialogContent className="max-w-xl">
 <DialogHeader>
 <DialogTitle>Record Meter Reading</DialogTitle>
 </DialogHeader>
 <Form {...readingForm}>
 <form onSubmit={readingForm.handleSubmit((data) => createReadingMutation.mutate(data))} className="space-y-4">
 <FormField
 control={readingForm.control}
 name="accountId"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Account</FormLabel>
 <Select onValueChange={(value) => field.onChange(parseInt(value))} defaultValue={field.value?.toString()}>
 <FormControl>
 <SelectTrigger data-testid="select-reading-account">
 <SelectValue placeholder="Select account" />
 </SelectTrigger>
 </FormControl>
 <SelectContent>
 {(Array.isArray(accounts) ? accounts : []).map((account: any) => (
 <SelectItem key={account.id} value={account.id.toString()}>
 {account.accountNumber}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 <FormMessage />
 </FormItem>
 )}
 />
 <FormField
 control={readingForm.control}
 name="readingDate"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Reading Date</FormLabel>
 <FormControl>
 <Input {...field} type="date" data-testid="input-reading-date" />
 </FormControl>
 <FormMessage />
 </FormItem>
 )}
 />
 <FormField
 control={readingForm.control}
 name="reading"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Meter Reading</FormLabel>
 <FormControl>
 <Input {...field} type="number" placeholder="Enter reading" data-testid="input-reading-value" />
 </FormControl>
 <FormMessage />
 </FormItem>
 )}
 />
 <FormField
 control={readingForm.control}
 name="readingType"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Reading Type</FormLabel>
 <Select onValueChange={field.onChange} defaultValue={field.value}>
 <FormControl>
 <SelectTrigger data-testid="select-reading-type">
 <SelectValue />
 </SelectTrigger>
 </FormControl>
 <SelectContent>
 <SelectItem value="manual">Manual</SelectItem>
 <SelectItem value="auto">Automatic</SelectItem>
 <SelectItem value="estimated">Estimated</SelectItem>
 </SelectContent>
 </Select>
 <FormMessage />
 </FormItem>
 )}
 />
 <FormField
 control={readingForm.control}
 name="notes"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Notes (Optional)</FormLabel>
 <FormControl>
 <Input {...field} placeholder="Any notes" data-testid="input-reading-notes" />
 </FormControl>
 <FormMessage />
 </FormItem>
 )}
 />
 <Button type="submit" className="w-full" disabled={createReadingMutation.isPending} data-testid="button-submit-reading">
 {createReadingMutation.isPending ? "Recording..." : "Record Reading"}
 </Button>
 </form>
 </Form>
 </DialogContent>
 </Dialog>
 </div>
 <Card>
 <CardContent className="p-6">
 <DataTable
 data={readings}
 columns={readingColumns}
 emptyMessage="No meter readings found. Record your first meter reading."
 />
 </CardContent>
 </Card>
 </TabsContent>

 {/* Analytics Tab */}
 <TabsContent value="analytics" className="space-y-6">
 <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
 {/* Bill Status Distribution */}
 <Card>
 <CardHeader>
 <CardTitle className="flex items-center space-x-2">
 <PieChart className="h-5 w-5" />
 <span>Bill Status Distribution</span>
 </CardTitle>
 </CardHeader>
 <CardContent>
 <ResponsiveContainer width="100%" height={300}>
 <RePieChart>
 <Pie
 data={[
 { name: "Pending", value: pendingBills, color: "#f59e0b" },
 { name: "Paid", value: paidBills, color: "#10b981" },
 { name: "Overdue", value: overdueBills, color: "#ef4444" },
 ]}
 cx="50%"
 cy="50%"
 labelLine={false}
 label={(entry) => `${entry.name}: ${entry.value}`}
 outerRadius={80}
 fill="#8884d8"
 dataKey="value"
 >
 {[
 { name: "Pending", value: pendingBills, color: "#f59e0b" },
 { name: "Paid", value: paidBills, color: "#10b981" },
 { name: "Overdue", value: overdueBills, color: "#ef4444" },
 ].map((entry, index) => (
 <Cell key={`cell-${index}`} fill={entry.color} />
 ))}
 </Pie>
 <Tooltip />
 </RePieChart>
 </ResponsiveContainer>
 </CardContent>
 </Card>

 {/* Utility Type Breakdown */}
 <Card>
 <CardHeader>
 <CardTitle className="flex items-center space-x-2">
 <BarChart3 className="h-5 w-5" />
 <span>Utility Type Breakdown</span>
 </CardTitle>
 </CardHeader>
 <CardContent>
 <ResponsiveContainer width="100%" height={300}>
 <BarChart
 data={providers.reduce((acc: any[], provider: any) => {
 const existing = acc.find((item) => item.type === provider.type);
 if (existing) {
 existing.count += 1;
 } else {
 acc.push({ type: provider.type, count: 1 });
 }
 return acc;
 }, [])}
 >
 <CartesianGrid strokeDasharray="3 3" />
 <XAxis dataKey="type" />
 <YAxis />
 <Tooltip />
 <Bar dataKey="count" fill="#3b82f6" />
 </BarChart>
 </ResponsiveContainer>
 </CardContent>
 </Card>

 {/* Monthly Consumption Trend */}
 <Card>
 <CardHeader>
 <CardTitle className="flex items-center space-x-2">
 <TrendingUp className="h-5 w-5" />
 <span>Monthly Bill Trends</span>
 </CardTitle>
 </CardHeader>
 <CardContent>
 <ResponsiveContainer width="100%" height={300}>
 <LineChart
 data={bills
 .reduce((acc: any[], bill: any) => {
 const month = new Date(bill.billingPeriodStart).toLocaleDateString("en-US", {
 month: "short",
 year: "numeric",
 });
 const existing = acc.find((item) => item.month === month);
 if (existing) {
 existing.amount += parseFloat(bill.amount || 0);
 existing.count += 1;
 } else {
 acc.push({
 month,
 amount: parseFloat(bill.amount || 0),
 count: 1,
 });
 }
 return acc;
 }, [])
 .slice(-6)}
 >
 <CartesianGrid strokeDasharray="3 3" />
 <XAxis dataKey="month" />
 <YAxis />
 <Tooltip />
 <Legend />
 <Line type="monotone" dataKey="amount" stroke="#3b82f6" name="Amount (KES)" />
 <Line type="monotone" dataKey="count" stroke="#10b981" name="Bill Count" />
 </LineChart>
 </ResponsiveContainer>
 </CardContent>
 </Card>

 {/* Cost Analysis by Provider */}
 <Card>
 <CardHeader>
 <CardTitle className="flex items-center space-x-2">
 <DollarSign className="h-5 w-5" />
 <span>Cost by Provider</span>
 </CardTitle>
 </CardHeader>
 <CardContent>
 <ResponsiveContainer width="100%" height={300}>
 <BarChart
 data={(Array.isArray(providers) ? providers : []).map((provider: any) => {
 const providerAccounts = accounts.filter((a: any) => a.providerId === provider.id);
 const accountIds = providerAccounts.map((a: any) => a.id);
 const providerBills = (Array.isArray(bills) ? bills : []).filter((b: any) => accountIds.includes(b.accountId));
 const totalCost = providerBills.reduce((sum: number, b: any) => sum + parseFloat(b.amount || 0), 0);
 return {
 name: provider.name,
 cost: totalCost,
 };
 })}
 >
 <CartesianGrid strokeDasharray="3 3" />
 <XAxis dataKey="name" />
 <YAxis />
 <Tooltip />
 <Bar dataKey="cost" fill="#8b5cf6" />
 </BarChart>
 </ResponsiveContainer>
 </CardContent>
 </Card>
 </div>

 {/* Summary Statistics */}
 <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
 <Card>
 <CardContent className="p-6">
 <div>
 <p className="text-sm text-muted-foreground">Average Bill Amount</p>
 <p className="text-2xl font-semibold">
 KSh {bills.length > 0 ? (totalAmount / bills.length).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "0"}
 </p>
 </div>
 </CardContent>
 </Card>
 <Card>
 <CardContent className="p-6">
 <div>
 <p className="text-sm text-muted-foreground">Payment Rate</p>
 <p className="text-2xl font-semibold">
 {bills.length > 0 ? ((paidBills / bills.length) * 100).toFixed(1) : "0"}%
 </p>
 </div>
 </CardContent>
 </Card>
 <Card>
 <CardContent className="p-6">
 <div>
 <p className="text-sm text-muted-foreground">Active Accounts</p>
 <p className="text-2xl font-semibold">
 {accounts.filter((a: any) => a.isActive).length}
 </p>
 </div>
 </CardContent>
 </Card>
 </div>
 </TabsContent>
 </Tabs>
 </div>
 );
}
