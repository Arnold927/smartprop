// import { useState } from "react";
// import { useLocation } from "wouter";
// import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
// import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
// import { Button } from "@/components/ui/button";
// import { Input } from "@/components/ui/input";
// import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
// import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
// import {
// Plus,
// Search,
// Eye,
// Mail,
// Edit,
// Phone,
// MapPin,
// Calendar,
// DollarSign,
// FileText,
// Download,
// BarChart3,
// Users,
// MoreVertical,
// CheckCircle,
// XCircle,
// Clock,
// Filter,
// UserPlus,
// Building,
// ChevronRight,
// Home,
// Shield,
// CreditCard,
// TrendingUp,
// CalendarDays,
// RefreshCw
// } from "lucide-react";
// import ComprehensiveTenantModal from "@/components/modals/comprehensive-tenant-modal";
// import DataTable from "@/components/ui/data-table";
// import StatusBadge from "@/components/ui/status-badge";
// import { TenantAnalytics } from "@/components/analytics/TenantAnalytics";
// import { EmbeddedAnalytics } from "@/components/analytics/EmbeddedAnalytics";
// import { apiRequest } from "@/lib/queryClient";
// import { useToast } from "@/hooks/use-toast";
// import { isUnauthorizedError } from "@/lib/authUtils";
// import {
// DropdownMenu,
// DropdownMenuContent,
// DropdownMenuItem,
// DropdownMenuSeparator,
// DropdownMenuTrigger,
// } from "@/components/ui/dropdown-menu";
// import { Badge } from "@/components/ui/badge";
// import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
// import { Skeleton } from "@/components/ui/skeleton";
// import { Separator } from "@/components/ui/separator";
// import { Progress } from "@/components/ui/progress";

// interface Tenant {
// id: number;
// firstName: string;
// lastName: string;
// email: string;
// phone?: string;
// status: "active" | "inactive" | "pending";
// monthlyRent?: string;
// leaseStartDate?: string;
// leaseEndDate?: string;
// unit?: {
// id: number;
// unitNumber: string;
// propertyId: number;
// };
// property?: {
// id: number;
// name: string;
// address?: string;
// image?: string;
// };
// avatarUrl?: string;
// paymentStatus?: "paid" | "overdue" | "pending";
// }

// interface Property {
// id: number;
// name: string;
// totalUnits: number;
// address: string;
// occupancyRate: number;
// }

// export default function Tenants() {
// const [isAddModalOpen, setIsAddModalOpen] = useState(false);
// const [searchTerm, setSearchTerm] = useState("");
// const [statusFilter, setStatusFilter] = useState("all");
// const [propertyFilter, setPropertyFilter] = useState("all");
// const [activeTab, setActiveTab] = useState("management");
// const queryClient = useQueryClient();
// const { toast } = useToast();
// const [location, navigate] = useLocation();

// // Fetch tenants with enhanced data
// const { data: tenants = [], isLoading } = useQuery<Tenant[]>({
// queryKey: ["/api/tenants"],
// queryFn: async () => {
// const response = await apiRequest("/api/tenants", {
//
// });
// return response.json();
// },
// staleTime: 5 * 60 * 1000,
// });

// // Fetch properties
// const { data: properties = [], isLoading: isLoadingProperties } = useQuery<Property[]>({
// queryKey: ["/api/properties"],
// queryFn: async () => {
// const response = await apiRequest("/api/properties", {
//,
// });
// const data = await response.json();
// return data.properties ?? [];
// },
// });

// // Calculate statistics
// const totalRent = tenants.reduce((sum, tenant) => 
// sum + (parseFloat(tenant.monthlyRent || "0")), 0
// );
 
// const occupancyRate = properties.length > 0 
// ? properties.reduce((sum, property) => sum + property.occupancyRate, 0) / properties.length
// : 0;

// // Status statistics
// const statusStats = {
// active: tenants.filter(t => t.status === "active").length,
// pending: tenants.filter(t => t.status === "pending").length,
// inactive: tenants.filter(t => t.status === "inactive").length,
// };

// // Payment statistics
// const paymentStats = {
// paid: tenants.filter(t => t.paymentStatus === "paid").length,
// overdue: tenants.filter(t => t.paymentStatus === "overdue").length,
// pending: tenants.filter(t => t.paymentStatus === "pending").length,
// };

// // Filter tenants
// const filteredTenants = tenants.filter((tenant) => {
// const matchesSearch = 
// tenant.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
// tenant.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
// tenant.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
// tenant.unit?.unitNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
// tenant.phone?.toLowerCase().includes(searchTerm.toLowerCase());
 
// const matchesStatus = statusFilter === "all" || tenant.status === statusFilter;
 
// const matchesProperty = propertyFilter === "all" || 
// tenant.property?.id.toString() === propertyFilter;

// return matchesSearch && matchesStatus && matchesProperty;
// });

// // Action handlers
// const handleViewTenant = (tenant: Tenant) => {
// navigate(`/tenants/${tenant.id}`);
// };

// const handleExportTenant = (tenant: Tenant) => {
// const tenantData = {
// name: `${tenant.firstName} ${tenant.lastName}`,
// email: tenant.email,
// phone: tenant.phone || 'N/A',
// status: tenant.status,
// monthlyRent: tenant.monthlyRent || '0',
// unit: tenant.unit?.unitNumber || 'N/A',
// property: tenant.property?.name || 'N/A',
// leaseStart: tenant.leaseStartDate || 'N/A',
// leaseEnd: tenant.leaseEndDate || 'N/A'
// };

// const csvContent = `Name,Email,Phone,Status,Monthly Rent,Unit,Property,Lease Start,Lease End
// "${tenantData.name}","${tenantData.email}","${tenantData.phone}","${tenantData.status}","${tenantData.monthlyRent}","${tenantData.unit}","${tenantData.property}","${tenantData.leaseStart}","${tenantData.leaseEnd}"`;

// const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
// const link = document.createElement("a");
// const url = URL.createObjectURL(blob);
// link.setAttribute("href", url);
// link.setAttribute("download", `tenant-${tenant.firstName}-${tenant.lastName}-${new Date().toISOString().split('T')[0]}.csv`);
// document.body.appendChild(link);
// link.click();
// document.body.removeChild(link);

// toast({
// title: "Export Successful",
// description: `Tenant data exported to CSV file`,
// });
// };

// const handleExportAllTenants = () => {
// if (!tenants || tenants.length === 0) {
// toast({
// title: "No Data to Export",
// description: "No tenant data available for export",
// variant: "destructive"
// });
// return;
// }

// const headers = "Name,Email,Phone,Status,Monthly Rent,Unit,Property,Lease Start,Lease End";
// const csvRows = (Array.isArray(tenants) ? tenants : []).map(tenant => {
// return `"${tenant.firstName} ${tenant.lastName}","${tenant.email}","${tenant.phone || ''}","${tenant.status}","${tenant.monthlyRent || ''}","${tenant.unit?.unitNumber || ''}","${tenant.property?.name || ''}","${tenant.leaseStartDate || ''}","${tenant.leaseEndDate || ''}"`;
// });

// const csvContent = [headers, ...csvRows].join('\n');
// const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
// const link = document.createElement("a");
// const url = URL.createObjectURL(blob);
// link.setAttribute("href", url);
// link.setAttribute("download", `all-tenants-${new Date().toISOString().split('T')[0]}.csv`);
// document.body.appendChild(link);
// link.click();
// document.body.removeChild(link);

// toast({
// title: "Export Successful",
// description: `${tenants.length} tenants exported to CSV file`,
// });
// };

// const deleteTenantMutation = useMutation({
// mutationFn: async (id: number) => {
// await apiRequest(`/api/tenants/${id}`, {
// method: "DELETE"
// });
// },
// onSuccess: () => {
// queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
// toast({
// title: "Success",
// description: "Tenant deleted successfully",
// });
// },
// onError: (error) => {
// if (isUnauthorizedError(error)) {
// toast({
// title: "Unauthorized",
// description: "You are logged out. Logging in again...",
// variant: "destructive",
// });
// setTimeout(() => {
// window.location.href = "/auth";
// }, 500);
// return;
// }
// toast({
// title: "Error",
// description: "Failed to delete tenant",
// variant: "destructive",
// });
// },
// });

// // Status icon mapping
// const getStatusIcon = (status: string) => {
// switch (status) {
// case "active":
// return <CheckCircle className="h-4 w-4 text-green-500" />;
// case "pending":
// return <Clock className="h-4 w-4 text-amber-500" />;
// case "inactive":
// return <XCircle className="h-4 w-4 text-muted-foreground" />;
// default:
// return null;
// }
// };

// // Payment status badge
// const getPaymentStatusBadge = (status?: string) => {
// switch (status) {
// case "paid":
// return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200" >Paid</Badge>;
// case "overdue":
// return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200" >Overdue</Badge>;
// case "pending":
// return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200" >Pending</Badge>;
// default:
// return <Badge variant="outline" className="bg-muted text-muted-foreground border-border">No data</Badge>;
// }
// };

// // Table columns with modern design
// const columns = [
// {
// header: "Tenant",
// accessorKey: "name",
// cell: (tenant: Tenant) => (
// <div className="flex items-center space-x-3 group">
// <Avatar className="h-10 w-10 ring-2 ring-white shadow-sm">
// {tenant.avatarUrl && <AvatarImage src={tenant.avatarUrl} />}
// <AvatarFallback className="bg-gradient-to-br from-blue-100 to-blue-200 text-blue-700 font-semibold">
// {tenant.firstName?.charAt(0)}
// {tenant.lastName?.charAt(0)}
// </AvatarFallback>
// </Avatar>
// <div className="space-y-1">
// <button 
// onClick={() => handleViewTenant(tenant)}
// className="flex items-center gap-1 text-left hover:text-blue-600 transition-colors"
// >
// <span className="font-medium text-foreground group-hover:text-blue-600">
// {tenant.firstName} {tenant.lastName}
// </span>
// <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
// </button>
// <div className="flex items-center space-x-3 text-sm">
// <div className="flex items-center text-muted-foreground">
// <Mail className="h-3 w-3 mr-1" />
// <span className="truncate max-w-[150px]">{tenant.email}</span>
// </div>
// {tenant.phone && (
// <div className="flex items-center text-muted-foreground">
// <Phone className="h-3 w-3 mr-1" />
// <span>{tenant.phone}</span>
// </div>
// )}
// </div>
// </div>
// </div>
// ),
// },
// {
// header: "Property & Unit",
// accessorKey: "property",
// cell: (tenant: Tenant) => (
// <div className="space-y-2">
// {tenant.property ? (
// <>
// <div className="flex items-center gap-2">
// <Home className="h-4 w-4 text-muted-foreground" />
// <span className="font-medium">{tenant.property.name}</span>
// </div>
// {tenant.unit && (
// <Badge variant="secondary" className="bg-muted">
// Unit {tenant.unit.unitNumber}
// </Badge>
// )}
// {tenant.property.address && (
// <p className="text-xs text-muted-foreground truncate">
// {tenant.property.address}
// </p>
// )}
// </>
// ) : (
// <span className="text-muted-foreground text-sm">Not assigned</span>
// )}
// </div>
// ),
// },
// {
// header: "Lease & Payment",
// accessorKey: "lease",
// cell: (tenant: Tenant) => (
// <div className="space-y-2">
// <div className="flex items-center justify-between">
// <span className="text-sm text-muted-foreground">Monthly Rent</span>
// <div className="flex items-center font-semibold">
// <DollarSign className="h-3 w-3 text-muted-foreground mr-1" />
// <span>{tenant.monthlyRent || "0"}</span>
// </div>
// </div>
// <div className="flex items-center justify-between">
// <span className="text-sm text-muted-foreground">Payment Status</span>
// {getPaymentStatusBadge(tenant.paymentStatus)}
// </div>
// {tenant.leaseStartDate && (
// <div className="text-xs text-muted-foreground">
// Lease: {new Date(tenant.leaseStartDate).toLocaleDateString()}
// </div>
// )}
// </div>
// ),
// },
// {
// header: "Status",
// accessorKey: "status",
// cell: (tenant: Tenant) => (
// <div className="flex items-center space-x-2">
// {getStatusIcon(tenant.status)}
// <StatusBadge status={tenant.status} />
// </div>
// ),
// },
// {
// header: "Actions",
// accessorKey: "actions",
// cell: (tenant: Tenant) => (
// <div className="flex items-center space-x-2">
// <Button
// variant="ghost"
// size="sm"
// className="h-8 w-8 p-0 hover:bg-muted"
// onClick={() => handleViewTenant(tenant)}
// >
// <Eye className="h-4 w-4" />
// </Button>
// <DropdownMenu>
// <DropdownMenuTrigger asChild>
// <Button 
// variant="ghost" 
// size="sm" 
// className="h-8 w-8 p-0 hover:bg-muted border border-border"
// >
// <MoreVertical className="h-4 w-4" />
// </Button>
// </DropdownMenuTrigger>
// <DropdownMenuContent align="end" className="w-48 shadow-lg">
// <DropdownMenuItem onClick={() => handleViewTenant(tenant)} className="cursor-pointer">
// <Eye className="mr-2 h-4 w-4" />
// View Details
// </DropdownMenuItem>
// <DropdownMenuItem className="cursor-pointer">
// <Edit className="mr-2 h-4 w-4" />
// Edit Tenant
// </DropdownMenuItem>
// <DropdownMenuItem onClick={() => window.open(`mailto:${tenant.email}`, '_blank')} className="cursor-pointer">
// <Mail className="mr-2 h-4 w-4" />
// Send Email
// </DropdownMenuItem>
// <DropdownMenuSeparator />
// <DropdownMenuItem onClick={() => handleExportTenant(tenant)} className="cursor-pointer">
// <Download className="mr-2 h-4 w-4" />
// Export Data
// </DropdownMenuItem>
// <DropdownMenuSeparator />
// <DropdownMenuItem 
// onClick={() => {
// if (confirm(`Delete ${tenant.firstName} ${tenant.lastName}?`)) {
// deleteTenantMutation.mutate(tenant.id);
// }
// }}
// className="cursor-pointer text-red-600 focus:text-red-600"
// >
// <XCircle className="mr-2 h-4 w-4" />
// Delete Tenant
// </DropdownMenuItem>
// </DropdownMenuContent>
// </DropdownMenu>
// </div>
// ),
// },
// ];

// if (isLoading) {
// return (
// <div className="p-6 space-y-6">
// <Skeleton className="h-10 w-64" />
// <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
// {[1, 2, 3, 4].map(i => (
// <Skeleton key={i} className="h-32 rounded-xl" />
// ))}
// </div>
// <Skeleton className="h-64 rounded-xl" />
// </div>
// );
// }

// return (
// <div className="p-6 space-y-6">
// {/* Header with subtle design */}
// <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
// <div>
// <h1 className="text-2xl font-semibold text-foreground">Tenant Management</h1>
// <p className="text-muted-foreground mt-1">Manage tenants, leases, and rental operations</p>
// </div>
// <div className="flex items-center gap-2">
// <Button
// variant="outline"
// onClick={handleExportAllTenants}
// className="gap-2 border-border hover:bg-muted"
// >
// <FileText className="h-4 w-4" />
// Export All
// </Button>
// <Button 
// onClick={() => setIsAddModalOpen(true)} 
// className="gap-2 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 shadow-sm"
// >
// <UserPlus className="h-4 w-4" />
// Add Tenant
// </Button>
// </div>
// </div>

// {/* Stats Cards with soft design */}
// <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
// <Card className="border border-border shadow-sm hover:shadow-md transition-shadow">
// <CardContent className="p-6">
// <div className="flex items-center justify-between">
// <div>
// <p className="text-sm font-medium text-muted-foreground mb-1">Total Tenants</p>
// <p className="text-2xl font-semibold text-foreground">{tenants.length}</p>
// <p className="text-xs text-muted-foreground mt-1">Active: {statusStats.active}</p>
// </div>
// <div className="p-3 bg-blue-50 rounded-lg">
// <Users className="h-6 w-6 text-blue-600" />
// </div>
// </div>
// <Progress value={(statusStats.active / tenants.length) * 100} className="mt-4" />
// </CardContent>
// </Card>

// <Card className="border border-border shadow-sm hover:shadow-md transition-shadow">
// <CardContent className="p-6">
// <div className="flex items-center justify-between">
// <div>
// <p className="text-sm font-medium text-muted-foreground mb-1">Monthly Revenue</p>
// <p className="text-2xl font-semibold text-foreground">
// ${totalRent.toLocaleString()}
// </p>
// <p className="text-xs text-muted-foreground mt-1">From {tenants.length} tenants</p>
// </div>
// <div className="p-3 bg-green-50 rounded-lg">
// <CreditCard className="h-6 w-6 text-green-600" />
// </div>
// </div>
// </CardContent>
// </Card>

// <Card className="border border-border shadow-sm hover:shadow-md transition-shadow">
// <CardContent className="p-6">
// <div className="flex items-center justify-between">
// <div>
// <p className="text-sm font-medium text-muted-foreground mb-1">Occupancy Rate</p>
// <p className="text-2xl font-semibold text-foreground">
// {occupancyRate.toFixed(1)}%
// </p>
// <p className="text-xs text-muted-foreground mt-1">Across {properties.length} properties</p>
// </div>
// <div className="p-3 bg-purple-50 rounded-lg">
// <TrendingUp className="h-6 w-6 text-purple-600" />
// </div>
// </div>
// </CardContent>
// </Card>

// <Card className="border border-border shadow-sm hover:shadow-md transition-shadow">
// <CardContent className="p-6">
// <div className="flex items-center justify-between">
// <div>
// <p className="text-sm font-medium text-muted-foreground mb-1">Payment Status</p>
// <div className="flex items-center space-x-4">
// <div>
// <p className="text-lg font-semibold text-green-600">{paymentStats.paid}</p>
// <p className="text-xs text-muted-foreground">Paid</p>
// </div>
// <div>
// <p className="text-lg font-semibold text-red-600">{paymentStats.overdue}</p>
// <p className="text-xs text-muted-foreground">Overdue</p>
// </div>
// </div>
// </div>
// <div className="p-3 bg-amber-50 rounded-lg">
// <Shield className="h-6 w-6 text-amber-600" />
// </div>
// </div>
// </CardContent>
// </Card>
// </div>

// <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
// <TabsList className="inline-flex h-10 items-center justify-center rounded-lg bg-muted p-1">
// <TabsTrigger 
// value="management" 
// className="inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm"
// >
// <Users className="h-4 w-4 mr-2" />
// Management
// </TabsTrigger>
// <TabsTrigger 
// value="analytics" 
// className="inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm"
// >
// <BarChart3 className="h-4 w-4 mr-2" />
// Analytics
// </TabsTrigger>
// <TabsTrigger 
// value="insights" 
// className="inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm"
// >
// <TrendingUp className="h-4 w-4 mr-2" />
// Insights
// </TabsTrigger>
// </TabsList>
 
// <TabsContent value="management" className="space-y-6">
// {/* Search and Filter Bar with modern design */}
// <Card className="border border-border shadow-sm">
// <CardContent className="p-5">
// <div className="flex flex-col lg:flex-row gap-4">
// <div className="flex-1 relative">
// <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
// <Input
// placeholder="Search tenants by name, email, phone, or unit..."
// className="pl-10 border-border focus:border-emerald-500 focus:ring-emerald-500"
// value={searchTerm}
// onChange={(e) => setSearchTerm(e.target.value)}
// />
// </div>
// <div className="flex flex-col sm:flex-row gap-3">
// <div className="flex items-center gap-2">
// <Select value={propertyFilter} onValueChange={setPropertyFilter}>
// <SelectTrigger className="w-[180px] border-border">
// <SelectValue placeholder="All Properties" />
// </SelectTrigger>
// <SelectContent>
// <SelectItem value="all">All Properties</SelectItem>
// {(Array.isArray(properties) ? properties : []).map((property) => (
// <SelectItem key={property.id} value={property.id.toString()}>
// <div className="flex items-center gap-2">
// <Home className="h-3 w-3" />
// {property.name}
// </div>
// </SelectItem>
// ))}
// </SelectContent>
// </Select>
// </div>
// <Select value={statusFilter} onValueChange={setStatusFilter}>
// <SelectTrigger className="w-[150px] border-border">
// <SelectValue placeholder="All Statuses" />
// </SelectTrigger>
// <SelectContent>
// <SelectItem value="all">All Statuses</SelectItem>
// <SelectItem value="active" className="flex items-center gap-2">
// <CheckCircle className="h-3 w-3 text-green-500" />
// Active
// </SelectItem>
// <SelectItem value="pending" className="flex items-center gap-2">
// <Clock className="h-3 w-3 text-amber-500" />
// Pending
// </SelectItem>
// <SelectItem value="inactive" className="flex items-center gap-2">
// <XCircle className="h-3 w-3 text-muted-foreground" />
// Inactive
// </SelectItem>
// </SelectContent>
// </Select>
// {(searchTerm || statusFilter !== "all" || propertyFilter !== "all") && (
// <Button
// variant="ghost"
// size="sm"
// onClick={() => {
// setSearchTerm("");
// setStatusFilter("all");
// setPropertyFilter("all");
// }}
// className="text-muted-foreground hover:text-foreground"
// >
// <RefreshCw className="h-3 w-3 mr-1" />
// Reset
// </Button>
// )}
// </div>
// </div>
// </CardContent>
// </Card>

// {/* Tenants Table with modern card */}
// <Card className="border border-border shadow-sm overflow-hidden">
// <CardHeader className="bg-gradient-to-r from-gray-50 to-white border-b">
// <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
// <div>
// <CardTitle className="text-lg font-semibold">Tenant Directory</CardTitle>
// <CardDescription>
// {filteredTenants.length} tenant{filteredTenants.length !== 1 ? 's' : ''} found
// </CardDescription>
// </div>
// <div className="flex items-center gap-2">
// <Button
// variant="outline"
// size="sm"
// className="border-border hover:bg-muted"
// onClick={() => setIsAddModalOpen(true)}
// >
// <Plus className="h-4 w-4 mr-1" />
// Add New
// </Button>
// </div>
// </div>
// </CardHeader>
// <CardContent className="p-0">
// {filteredTenants.length > 0 ? (
// <DataTable
// data={filteredTenants}
// columns={columns}
// />
// ) : (
// <div className="text-center py-16">
// <div className="mx-auto w-24 h-24 rounded-full bg-muted flex items-center justify-center mb-4">
// <Users className="h-12 w-12 text-muted-foreground" />
// </div>
// <h3 className="text-lg font-medium text-foreground mb-2">No tenants found</h3>
// <p className="text-muted-foreground mb-6 max-w-md mx-auto">
// {searchTerm || statusFilter !== "all" || propertyFilter !== "all"
// ? "No tenants match your current filters. Try adjusting your search criteria."
// : "Get started by adding your first tenant to manage."}
// </p>
// <Button 
// onClick={() => setIsAddModalOpen(true)}
// className="bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600"
// >
// <UserPlus className="h-4 w-4 mr-2" />
// Add First Tenant
// </Button>
// </div>
// )}
// </CardContent>
// </Card>
// </TabsContent>

// <TabsContent value="analytics" className="space-y-6">
// <TenantAnalytics />
// </TabsContent>

// <TabsContent value="insights" className="space-y-6">
// <EmbeddedAnalytics module="tenants" />
// </TabsContent>
// </Tabs>

// {/* Tenant Modal */}
// <ComprehensiveTenantModal
// isOpen={isAddModalOpen}
// onClose={() => setIsAddModalOpen(false)}
// />
// </div>
// );
// }