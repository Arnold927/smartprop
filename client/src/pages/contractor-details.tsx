import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { 
 ArrowLeft, Building2, Phone, Mail, MapPin, Star, Calendar, Clock, Award, FileText, CheckCircle, AlertTriangle, Users, DollarSign, Briefcase,
 Shield, TrendingUp, BarChart3, Download, Edit, Share2, ExternalLink, Globe, PhoneCall, MessageSquare, History, FileCheck,
 ClipboardCheck, Upload, Zap, Tag, ChevronRight, MoreVertical, Eye, Copy, UserCheck, Timer, Target, Globe2, AlertCircle, Info,
 User, Plus, ArrowRight, HardHat, Wrench, Hammer, Settings, Truck, PenTool, Home, Boxes, Drill
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import StatusBadge from "@/components/ui/status-badge";
import {
 DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import z from "zod";
import { useForm } from "react-hook-form";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, } from "@/components/ui/form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { CreateWorkOrderDialog } from "@/components/create-work-order-dialog";
import { EditWorkOrderDialog } from "@/components/edit-work-order-dialog";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";

interface ServiceContractor {
 id: number;
 organizationId?: number;
 categoryId?: number;
 companyName?: string;
 contactPerson?: string;
 email?: string;
 phone?: string;
 address?: string;
 hourlyRate?: number;
 dailyRate?: number;
 currency?: string;
 servicesOffered?: string[];
 coverageAreas?: string[];
 status?: string;
 vettingStatus?: string;
 overallRating?: number;
 totalJobsCompleted?: number;
 createdAt?: string;
 contractEndDate?: string;
 slaAdherenceScore?: number;
 category?: {
 name: string;
 description: string;
 };
 website?: string;
 description?: string;
 logoUrl?: string;
}

interface ContractorPerformance {
 id: number;
 contractorId: number;
 month: string;
 jobsCompleted: number;
 averageRating: number;
 slaCompliance: number;
 revenueGenerated: number;
}

interface ContractorDocument {
 id: number;
 contractorId: number;
 name: string;
 type: string;
 url: string;
 uploadedAt: string;
 size: string;
}

interface ContractorReview {
 id: number;
 contractorId: number;
 reviewer: string;
 rating: number;
 comment: string;
 date: string;
 property: string;
}

interface WorkOrder {
 id: number;
 contractorId: number;
 workOrderNumber: string;
 propertyName: string;
 workOrderType: string;
 priority: 'high' | 'medium' | 'low';
 status: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'cancelled';
 description?: string;
 createdAt: string;
 scheduledDate?: string;
 completedDate?: string;
}

const categoryIcons = {
 'Cleaning Services': Briefcase,
 'Security Services': Shield,
 'Maintenance & Repairs': Building2,
 'Landscaping': Users,
 'Waste Management': FileText,
 'HVAC Services': TrendingUp,
 'Generator Services': BarChart3,
 'Water Treatment': Globe,
 'Pest Control': AlertTriangle,
 'Fire Safety': Shield,
};

const getVettingStatusColor = (status: string) => {
 switch (status) {
 case 'approved': return { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', icon: CheckCircle };
 case 'pending': return { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', icon: AlertCircle };
 case 'rejected': return { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', icon: AlertTriangle };
 case 'under_review': return { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', icon: Info };
 default: return { bg: 'bg-muted', text: 'text-foreground', border: 'border-border', icon: AlertCircle };
 }
};

const getStatusColor = (status: string) => {
 switch (status) {
 case 'active': return { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', icon: CheckCircle };
 case 'inactive': return { bg: 'bg-muted', text: 'text-foreground', border: 'border-border', icon: AlertCircle };
 case 'suspended': return { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', icon: AlertTriangle };
 default: return { bg: 'bg-muted', text: 'text-foreground', border: 'border-border', icon: AlertCircle };
 }
};

const formatCurrency = (amount: number, currency: string = 'KES') => {
 return new Intl.NumberFormat('en-KE', {
 style: 'currency',
 currency: currency,
 minimumFractionDigits: 0,
 maximumFractionDigits: 0,
 }).format(amount);
};

const getInitials = (name: string) => {
 return name
 .split(' ')
 .map(part => part[0])
 .join('')
 .toUpperCase()
 .slice(0, 2);
};

const ContractPeriod = ({ startDate, endDate }: { startDate?: string; endDate?: string }) => {
 const now = new Date();
 const start = startDate ? new Date(startDate) : null;
 const end = endDate ? new Date(endDate) : null;
 
 let status = 'default';
 let progress = 0;
 
 if (start && end) {
 const totalDuration = end.getTime() - start.getTime();
 const elapsed = now.getTime() - start.getTime();
 progress = Math.min(Math.max((elapsed / totalDuration) * 100, 0), 100);
 
 if (now < start) {
 status = 'upcoming';
 } else if (now > end) {
 status = 'expired';
 } else {
 status = 'active';
 }
 }
 
 return (
 <div className="space-y-3">
 <div className="flex items-center justify-between text-sm">
 <span className="text-muted-foreground">Contract Progress</span>
 <span className="font-medium">{Math.round(progress)}%</span>
 </div>
 <Progress value={progress} className="h-2" />
 <div className="grid grid-cols-2 gap-4">
 <div>
 <p className="text-xs text-muted-foreground mb-1">Start Date</p>
 <p className="text-sm font-medium">
 {startDate ? format(new Date(startDate), 'MMM dd, yyyy') : 'Not set'}
 </p>
 </div>
 <div>
 <p className="text-xs text-muted-foreground mb-1">End Date</p>
 <p className="text-sm font-medium">
 {endDate ? format(new Date(endDate), 'MMM dd, yyyy') : 'Not set'}
 </p>
 </div>
 </div>
 </div>
 );
};

const editContractorSchema = z.object({
 company_name: z.string().min(1, "Company name is required"),
 category_id: z.string().min(1, "Category is required"),
 contact_person: z.string().min(1, "Contact person is required"),
 email: z.string().email("Invalid email address"),
 phone: z.string().min(1, "Phone number is required"),
 hourly_rate: z.number().min(0, "Hourly rate must be a positive number"),
 services_offered: z.array(z.string()).min(1, "At least one service is required"),
})

type EditContractorFormValues = z.infer<typeof editContractorSchema>;

export default function ContractorDetailsPage() {
 const { id } = useParams();
 const [location, setLocation] = useLocation();
 const { toast } = useToast();
 const [activeTab, setActiveTab] = useState('overview');
 const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
 const [isCreateWorkOrderDialogOpen, setIsCreateWorkOrderDialogOpen] = useState(false);
 const [selectedWorkOrder, setSelectedWorkOrder] = useState<WorkOrder | null>(null);
 const [isEditDialogOpenWO, setIsEditDialogOpenWO] = useState(false);

 const navigate = (path: string) => {
 setLocation(path);
 };

 const form = useForm<EditContractorFormValues>({
 resolver: zodResolver(editContractorSchema),
 defaultValues: {
 company_name: "",
 category_id: "",
 contact_person: "",
 email: "",
 phone: "",
 hourly_rate: 0,
 services_offered: [],
 },
 });
 
const { data: contractor, isLoading, error } = useQuery<ServiceContractor>({
  queryKey: [`/api/service-contractors/${id}`],
 queryFn: async () => {
 const response = await apiRequest(`/api/service-contractors/${id}`);
 return response.json();
 },
 enabled: !!id,
 });

 const { data: workOrders = [], isLoading: isLoadingWorkOrders } = useQuery<WorkOrder[]>({
 queryKey: [`/api/contractors/${id}/work-orders`],
 queryFn: async () => { const r = await apiRequest(`/api/contractors/${id}/work-orders`); const d = await r.json(); return d; },
 enabled: !!id && activeTab === 'performance',
 });

 const { data: documents = [], isLoading: isLoadingDocuments } = useQuery<ContractorDocument[]>({
 queryKey: [`/api/contractors/${id}/documents`],
 queryFn: async () => { const r = await apiRequest(`/api/contractors/${id}/documents`); const d = await r.json(); return d; },
 enabled: !!id && activeTab === 'documents',
 });

 const { data: reviews = [], isLoading: isLoadingReviews } = useQuery<ContractorReview[]>({
 queryKey: [`/api/contractors/${id}/reviews`],
 queryFn: async () => { const r = await apiRequest(`/api/contractors/${id}/reviews`); const d = await r.json(); return d; },
 enabled: !!id && activeTab === 'reviews',
 });

 useEffect(() => {
 if (error) {
 toast({
 title: "Error",
 description: "Failed to load contractor details",
 variant: "destructive",
 className: "bg-red-50/90 dark:bg-red-950/90 backdrop-blur-sm border border-red-200/60 dark:border-red-900/60 rounded-xl shadow-sm transition-all duration-200",
 });
 }
 }, [error, toast]);

 const handleCopyToClipboard = (text: string) => {
 navigator.clipboard.writeText(text);
 toast({
 title: "Copied!",
 description: "Text copied to clipboard",
 });
 };

 const handleShare = async () => {
 if (navigator.share) {
 try {
 await navigator.share({
 title: contractor?.companyName || 'Contractor',
 text: `Check out ${contractor?.companyName} on our platform`,
 url: window.location.href,
 });
 } catch (error) {
 }
 } else {
 navigator.clipboard.writeText(window.location.href);
 toast({
 title: "Link copied!",
 description: "Page link copied to clipboard",
 className: "bg-card dark:bg-gray-900/90 backdrop-blur-sm border border-border dark:border-gray-800/60 rounded-xl shadow-sm",
 });
 }
 };

 useEffect(() => {
 if (contractor && isEditDialogOpen) {
 form.reset({
 company_name: contractor.companyName || "",
 category_id: contractor.categoryId?.toString() || "",
 contact_person: contractor.contactPerson || "",
 email: contractor.email || "",
 phone: contractor.phone || "",
 hourly_rate: contractor.hourlyRate || 0,
 services_offered: contractor.servicesOffered || [],
 });
 }
 }, [contractor, isEditDialogOpen, form]);

 const { data: categories = [] } = useQuery<any[]>({
 queryKey: ['/api/service-contractor-categories'],
 enabled: isEditDialogOpen,
 });

 const editContractorMutation = useMutation({
 mutationFn: async (data: EditContractorFormValues) => {
 const response = await apiRequest(`/api/contractors/${id}`, {
 method: 'PUT',
 headers: { 'Content-Type': 'application/json' },
 data: {
 ...data,
 categoryId: parseInt(data.category_id),
 },
 });
 return response.json();
 },
 onSuccess: () => {
 setIsEditDialogOpen(false);
 toast({
 description: "Contractor updated successfully",
 className: "bg-card dark:bg-gray-900 border border-border dark:border-gray-800",
 });
 },
 onError: () => {
 toast({
 title: "Update failed",
 description: "Failed to update contractor",
 variant: "destructive",
 className: "bg-red-50/90 dark:bg-red-950/90 backdrop-blur-sm border border-red-200/60 dark:border-red-900/60 rounded-xl shadow-sm transition-all duration-200",
 });
 },
 });

 const onSubmit = (data: EditContractorFormValues) => {
 editContractorMutation.mutate(data);
 };


 if (isLoading) {
 return (
 <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
 <div className="container mx-auto px-4 py-6">
 <div className="flex items-center space-x-4 mb-6">
 <Skeleton className="h-9 w-24" />
 <Skeleton className="h-4 flex-1" />
 </div>
 <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
 <div className="lg:col-span-2 space-y-6">
 <Skeleton className="h-[200px] w-full" />
 <Skeleton className="h-[400px] w-full" />
 </div>
 <div className="space-y-6">
 <Skeleton className="h-[200px] w-full" />
 <Skeleton className="h-[150px] w-full" />
 </div>
 </div>
 </div>
 </div>
 );
 }

 if (!contractor) {
 return (
 <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white flex items-center justify-center">
 <div className="text-center max-w-md">
 <div className="relative">
 <div className="w-24 h-24 mx-auto mb-6 bg-gradient-to-br from-red-100 to-red-50 rounded-full flex items-center justify-center">
 <AlertTriangle className="w-12 h-12 text-red-500" />
 </div>
 <div className="absolute -top-2 -right-2">
 <div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center">
 <AlertTriangle className="w-4 h-4 text-white" />
 </div>
 </div>
 </div>
 <h2 className="mt-4 text-2xl font-semibold text-foreground">Contractor Not Found</h2>
 <p className="mt-2 text-muted-foreground">The contractor you're looking for doesn't exist or has been removed.</p>
 <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
 <Button 
 onClick={() => navigate('/enhanced-service-providers')}
 className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800"
 >
 <ArrowLeft className="w-4 h-4 mr-2" />
 Back to Service Providers
 </Button>
 <Button 
 variant="outline"
 onClick={() => navigate('/')}
 >
 Go to Dashboard
 </Button>
 </div>
 </div>
 </div>
 );
 }

 const Icon = categoryIcons[contractor.category?.name as keyof typeof categoryIcons] || Building2;
 const rating = Number(contractor.overallRating) || 0;
 const slaScore = Number(contractor.slaAdherenceScore) || 0;
 const hourlyRate = Number(contractor.hourlyRate) || 0;
 const dailyRate = Number(contractor.dailyRate) || 0;
 
 const statusColors = getStatusColor(contractor.status || 'inactive');
 const vettingColors = getVettingStatusColor(contractor.vettingStatus || 'pending');
 const StatusIcon = statusColors.icon;
 const VettingIcon = vettingColors.icon;

 const handleExportData = () => {
 const contractorData = {
 company: contractor.companyName || 'N/A',
 contact: contractor.contactPerson || 'N/A',
 email: contractor.email || 'N/A',
 phone: contractor.phone || 'N/A',
 services: contractor.servicesOffered?.join("; ") || 'N/A',
 rating: rating,
 status: contractor.status || 'N/A',
 vettingStatus: contractor.vettingStatus || 'N/A',
 hourlyRate: `${contractor.currency || 'KES'} ${hourlyRate}`,
 dailyRate: `${contractor.currency || 'KES'} ${dailyRate}`,
 jobsCompleted: contractor.totalJobsCompleted || 0,
 slaAdherence: `${slaScore}%`,
 createdAt: contractor.createdAt || 'N/A',
 contractEnd: contractor.contractEndDate || 'N/A'
 };

 const csvContent = `Company Name,Contact Person,Email,Phone,Services,Rating,Status,Vetting Status,Hourly Rate,Daily Rate,Jobs Completed,Contract Start,Contract End
"${contractorData.company}","${contractorData.contact}","${contractorData.email}","${contractorData.phone}","${contractorData.services}",${contractorData.rating},"${contractorData.status}","${contractorData.vettingStatus}","${contractorData.hourlyRate}","${contractorData.dailyRate}",${contractorData.jobsCompleted},"${contractorData.slaAdherence}","${contractorData.createdAt}","${contractorData.contractEnd}"`;

 const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
 const link = document.createElement("a");
 const url = URL.createObjectURL(blob);
 link.setAttribute("href", url);
 link.setAttribute("download", `contractor-${contractor.companyName?.replace(/\s+/g, '-') || 'export'}-${format(new Date(), 'yyyy-MM-dd')}.csv`);
 link.click();

 toast({
 title: "Export Successful",
 description: "Contractor data exported to CSV",
 className: "bg-card dark:bg-gray-900 border border-border dark:border-gray-800",
 });
 };

 return (
 <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
 {/* Enhanced Header with improved layout and clear contractor identification */}
 <div className="bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-800 text-white">
 <div className="container mx-auto px-4 py-4">
 {/* Breadcrumb and navigation */}
 <div className="flex items-center justify-between mb-4">
 <div className="flex items-center space-x-2 text-sm text-white/80">
 <button 
 onClick={() => navigate('/dashboard')}
 className="hover:text-white transition-colors"
 >
 Dashboard
 </button>
 <ChevronRight className="w-4 h-4" />
 <button 
 onClick={() => navigate('/enhanced-service-providers')}
 className="hover:text-white transition-colors"
 >
 Service Providers
 </button>
 <ChevronRight className="w-4 h-4" />
 <span className="text-white font-medium">Contractor Details</span>
 </div>
 
 <Badge className="bg-card text-white border-white/30 px-3 py-1">
 <HardHat className="w-3.5 h-3.5 mr-1.5" />
 Contractor Profile
 </Badge>
 </div>
 </div>

 <div className="container mx-auto px-4 pb-8">
 <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
 <div className="flex items-start space-x-4">
 <Button
 variant="ghost"
 size="sm"
 onClick={() => navigate('/enhanced-service-providers')}
 className="hover:bg-card text-white mb-2"
 >
 <ArrowLeft className="w-4 h-4 mr-2" />
 Back to Contractors
 </Button>
 <div className="flex items-start space-x-6">
 <div className="relative">
 <div className="w-20 h-20 rounded-2xl bg-card backdrop-blur-sm border-2 border-white/20 flex items-center justify-center shadow-lg">
 {contractor.logoUrl ? (
 <img 
 src={contractor.logoUrl} 
 alt={contractor.companyName}
 className="w-14 h-14 object-contain"
 />
 ) : (
 <div className="relative">
 <Icon className="w-10 h-10 text-white" />
 <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-blue-500 rounded-full border-2 border-white flex items-center justify-center">
 <Wrench className="w-2 h-2 text-white" />
 </div>
 </div>
 )}
 </div>
 <div className="absolute -bottom-2 -right-2">
 <Badge className={`${vettingColors.bg} ${vettingColors.text} ${vettingColors.border} px-2.5 py-1 text-xs font-medium`}>
 <VettingIcon className="w-3.5 h-3.5 mr-1.5" />
 {contractor.vettingStatus?.replace('_', ' ').toUpperCase() || 'PENDING'}
 </Badge>
 </div>
 </div>
 <div>
 <div className="flex items-center flex-wrap gap-3 mb-3">
 {/* Clear contractor indicator */}
 <div className="flex items-center gap-2 bg-card px-3 py-1.5 rounded-full">
 <HardHat className="w-4 h-4" />
 <span className="text-xs font-medium uppercase tracking-wider">CONTRACTOR</span>
 </div>
 <h1 className="text-3xl font-bold tracking-tight">{contractor.companyName}</h1>
 <Badge className={`${statusColors.bg} ${statusColors.text} ${statusColors.border} px-3 py-1.5 text-sm font-medium`}>
 <StatusIcon className="w-3.5 h-3.5 mr-1.5" />
 {contractor.status?.toUpperCase() || 'INACTIVE'}
 </Badge>
 </div>
 <div className="flex flex-wrap items-center gap-4 text-sm text-white/90">
 <div className="flex items-center space-x-2 bg-card px-3 py-1.5 rounded-full">
 <Icon className="w-4 h-4" />
 <span className="font-medium">{contractor.category?.name || 'Service Provider'}</span>
 </div>
 {contractor.coverageAreas?.[0] && (
 <div className="flex items-center space-x-2">
 <MapPin className="w-4 h-4" />
 <span>{contractor.coverageAreas[0]}</span>
 </div>
 )}
 {contractor.website && (
 <a 
 href={contractor.website} 
 target="_blank" 
 rel="noopener noreferrer"
 className="flex items-center space-x-2 hover:text-white transition-colors"
 >
 <Globe2 className="w-4 h-4" />
 <span>Website</span>
 </a>
 )}
 </div>
 </div>
 </div>
 </div>

 <div className="flex flex-wrap gap-3">
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button
 variant="outline"
 size="sm"
 className="bg-card backdrop-blur-sm border-white/20 hover:bg-card text-white hover:text-white"
 >
 <MoreVertical className="w-4 h-4 mr-2" />
 More
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-48">
 <DropdownMenuLabel>Contractor Actions</DropdownMenuLabel>
 <DropdownMenuItem onClick={handleExportData}>
 <Download className="w-4 h-4 mr-2" />
 Export Contractor Data
 </DropdownMenuItem>
 <DropdownMenuItem onClick={handleShare}>
 <Share2 className="w-4 h-4 mr-2" />
 Share Contractor
 </DropdownMenuItem>
 <DropdownMenuItem 
 onClick={() => setIsEditDialogOpen(true)}
 >
 <Edit className="w-4 h-4 mr-2" />
 Edit Contractor
 </DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem 
 onClick={() => setIsCreateWorkOrderDialogOpen(true)}
 className="text-blue-600"
 >
 <Plus className="w-4 h-4 mr-2" />
 Assign Work Order
 </DropdownMenuItem>
 </DropdownMenuContent>
 </DropdownMenu>
 
 <Button
 className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white shadow-lg hover:shadow-xl transition-all duration-200"
 size="sm"
 onClick={() => {
 toast({
 title: "Contact Initiated",
 description: `Opening communication with contractor ${contractor.contactPerson}...`,
 });
 }}
 >
 <PhoneCall className="w-4 h-4 mr-2" />
 Contact Contractor
 </Button>
 </div>
 </div>

 {/* Contractor stats row */}
 <div className="grid grid-cols-2 md:grid-cols-2 gap-4 mt-8">
 {/* <div className="bg-card backdrop-blur-sm rounded-lg p-4">
 <div className="flex items-center gap-4">
 <div className="p-2 bg-card rounded-lg">
 <Briefcase className="w-5 h-5" />
 </div>
 <div>
 <p className="text-xs text-white/70">Contractor Since</p>
 <p className="text-lg font-semibold">
 {contractor.createdAt 
 ? format(new Date(contractor.createdAt), 'MMM yyyy')
 : 'N/A'}
 </p>
 </div>
 </div>
 </div> */}
 
 <div className="bg-card backdrop-blur-sm rounded-lg p-4">
 <div className="flex items-center gap-4">
 <div className="p-2 bg-card rounded-lg">
 <FileCheck className="w-5 h-5" />
 </div>
 <div>
 <p className="text-xs text-white/70">Jobs Completed</p>
 <p className="text-lg font-semibold">{contractor.totalJobsCompleted || 0}</p>
 </div>
 </div>
 </div>
 
 <div className="bg-card backdrop-blur-sm rounded-lg p-4">
 <div className="flex items-center gap-4">
 <div className="p-2 bg-card rounded-lg">
 <Star className="w-5 h-5" />
 </div>
 <div>
 <p className="text-xs text-white/70">Rating</p>
 <p className="text-lg font-semibold">{rating.toFixed(1)} / 5.0</p>
 </div>
 </div>
 </div>
 
 </div>
 </div>
 </div>

 <div className="container mx-auto px-4 py-8">
 <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
 {/* Left Column - Main Content */}
 <div className="lg:col-span-2 space-y-8">

 {/* Enhanced Tabs Section with contractor context */}
 <Card className="border border-border shadow-sm overflow-hidden bg-card">
 <CardHeader className="pb-2 border-b border-border bg-muted/50">
 <div className="flex items-center justify-between">
 <CardTitle className="text-base font-semibold flex items-center text-foreground">
 <HardHat className="w-5 h-5 mr-2 text-blue-600" />
 Contractor Information
 </CardTitle>
 <Badge variant="outline" className="bg-card">
 ID: CTR-{contractor.id.toString().padStart(5, '0')}
 </Badge>
 </div>
 </CardHeader>
 <CardContent className="p-0">
 <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
 <div className="border-b border-border">
 <div className="overflow-x-auto scrollbar-hide">
 <TabsList className="bg-transparent p-0 h-auto px-4 pt-4">
 <TabsTrigger 
 value="overview" 
 className="data-[state=active]:bg-card data-[state=active]:shadow-md data-[state=active]:border data-[state=active]:border-border rounded-lg m-1 px-5 py-3 text-sm font-medium"
 >
 <ClipboardCheck className="w-4 h-4 mr-2.5" />
 Contractor Overview
 </TabsTrigger>
 <TabsTrigger 
 value="services" 
 className="data-[state=active]:bg-card data-[state=active]:shadow-md data-[state=active]:border data-[state=active]:border-border rounded-lg m-1 px-5 py-3 text-sm font-medium"
 >
 <Briefcase className="w-4 h-4 mr-2.5" />
 Services & Pricing
 </TabsTrigger>
 <TabsTrigger 
 value="performance" 
 className="data-[state=active]:bg-card data-[state=active]:shadow-md data-[state=active]:border data-[state=active]:border-border rounded-lg m-1 px-5 py-3 text-sm font-medium"
 >
 <TrendingUp className="w-4 h-4 mr-2.5" />
 Work Orders
 </TabsTrigger>
 {/* <TabsTrigger 
 value="reviews" 
 className="data-[state=active]:bg-card data-[state=active]:shadow-md data-[state=active]:border data-[state=active]:border-border rounded-lg m-1 px-5 py-3 text-sm font-medium"
 >
 <Star className="w-4 h-4 mr-2.5" />
 Reviews
 {reviews.length > 0 && (
 <Badge variant="secondary" className="ml-2.5 h-5 px-1.5 text-xs">
 {reviews.length}
 </Badge>
 )}
 </TabsTrigger> */}
 </TabsList>
 </div>
 </div>

 {/* Enhanced Overview Tab with contractor context */}
 <TabsContent value="overview" className="p-6">
 <div className="space-y-8">
 <div className="space-y-5">
 <div className="flex items-center justify-between">
 <h3 className="text-lg font-semibold text-foreground flex items-center">
 <Users className="w-5 h-5 mr-3 text-blue-600" />
 Contractor Contact Information
 </h3>
 <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200" >
 Primary Contractor
 </Badge>
 </div>
 <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
 <div className="bg-gradient-to-br from-gray-50 to-white border border-border rounded-xl p-5 hover:border-border transition-colors">
 <div className="flex items-center space-x-4">
 <Avatar className="h-12 w-12 border-2 border-white shadow-sm">
 <AvatarFallback className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-sm font-semibold">
 {getInitials(contractor.contactPerson || '')}
 </AvatarFallback>
 </Avatar>
 <div className="flex-1 min-w-0">
 <p className="font-semibold text-foreground truncate">{contractor.contactPerson || 'N/A'}</p>
 <p className="text-sm text-muted-foreground">Primary Contact Person</p>
 </div>
 </div>
 </div>

 <div className="space-y-3">
 <a 
 href={`mailto:${contractor.email}`}
 className="flex items-center justify-between p-4 bg-gradient-to-br from-blue-50 to-white border border-blue-100 rounded-xl hover:border-blue-200 hover:shadow-sm transition-all group"
 >
 <div className="flex items-center space-x-4">
 <div className="p-2.5 rounded-lg bg-blue-100">
 <Mail className="w-4 h-4 text-blue-600" />
 </div>
 <div>
 <p className="text-sm font-medium text-foreground">Contractor Email</p>
 <p className="text-sm text-blue-600 font-medium truncate max-w-[180px]">{contractor.email || 'N/A'}</p>
 </div>
 </div>
 <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-blue-500 transition-colors" />
 </a>

 <a 
 href={`tel:${contractor.phone}`}
 className="flex items-center justify-between p-4 bg-gradient-to-br from-green-50 to-white border border-green-100 rounded-xl hover:border-green-200 hover:shadow-sm transition-all group"
 >
 <div className="flex items-center space-x-4">
 <div className="p-2.5 rounded-lg bg-green-100">
 <Phone className="w-4 h-4 text-green-600" />
 </div>
 <div>
 <p className="text-sm font-medium text-foreground">Contractor Phone</p>
 <p className="text-sm text-green-600 font-medium">{contractor.phone || 'N/A'}</p>
 </div>
 </div>
 <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-green-500 transition-colors" />
 </a>
 </div>
 </div>

 {contractor.address && (
 <div className="bg-gradient-to-br from-gray-50 to-white border border-border rounded-xl p-5">
 <div className="flex items-start space-x-3">
 <div className="p-2.5 rounded-lg bg-muted">
 <MapPin className="w-5 h-5 text-muted-foreground" />
 </div>
 <div className="flex-1">
 <p className="font-medium text-foreground mb-1">Contractor Address</p>
 <p className="text-foreground">{contractor.address}</p>
 </div>
 </div>
 </div>
 )}
 </div>

 <div className="space-y-5">
 <h3 className="text-lg font-semibold text-foreground flex items-center">
 <Briefcase className="w-5 h-5 mr-3 text-blue-600" />
 Services Provided by Contractor
 </h3>
 <div className="flex flex-wrap gap-3">
 {(contractor.servicesOffered || []).map((service, index) => (
 <Badge 
 key={index} 
 className="bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-700 border border-blue-200 hover:from-blue-100 hover:to-indigo-100 transition-all px-4 py-2 text-sm font-medium"
 >
 <Wrench className="w-3.5 h-3.5 mr-1.5" />
 {service}
 </Badge>
 ))}
 {(!contractor.servicesOffered || contractor.servicesOffered.length === 0) && (
 <div className="text-center py-8 w-full">
 <div className="w-12 h-12 mx-auto mb-3 bg-muted rounded-full flex items-center justify-center">
 <Briefcase className="w-5 h-5 text-muted-foreground" />
 </div>
 <p className="text-muted-foreground">No services listed for this contractor</p>
 </div>
 )}
 </div>
 </div>
 </div>
 </TabsContent>

 {/* Enhanced Services Tab */}
 <TabsContent value="services" className="p-6">
 <div className="space-y-8">
 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
 <Card className="border border-border shadow-sm">
 <CardHeader className="pb-3">
 <CardTitle className="text-base font-semibold flex items-center text-foreground">
 <DollarSign className="w-5 h-5 mr-2.5 text-blue-600" />
 Contractor Pricing Details
 </CardTitle>
 </CardHeader>
 <CardContent className="space-y-5">
 <div className="flex items-center justify-between p-3 bg-emerald-50 rounded-lg">
 <div>
 <p className="text-sm text-muted-foreground mb-1">Hourly Rate</p>
 <p className="text-xl font-semibold text-foreground">
 {formatCurrency(hourlyRate, contractor.currency)}
 </p>
 </div>
 <div className="p-2 rounded-lg bg-card">
 <Clock className="w-5 h-5 text-emerald-600" />
 </div>
 </div>
 <Separator />
 <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
 <div>
 <p className="text-sm text-muted-foreground mb-1">Daily Rate</p>
 <p className="text-xl font-semibold text-foreground">
 {formatCurrency(dailyRate, contractor.currency)}
 </p>
 </div>
 <Badge variant="outline" className="text-sm bg-card">
 {contractor.currency || 'KES'}
 </Badge>
 </div>
 </CardContent>
 </Card>

 <Card className="border border-border shadow-sm">
 <CardHeader className="pb-3">
 <CardTitle className="text-base font-semibold flex items-center text-foreground">
 <Clock className="w-5 h-5 mr-2.5 text-blue-600" />
 Contractor Availability
 </CardTitle>
 </CardHeader>
 <CardContent className="space-y-4">
 <div className="space-y-3">
 <div className="flex justify-between items-center py-2.5 px-3 bg-muted rounded-lg">
 <div className="flex items-center space-x-2.5">
 <div className="w-2 h-2 rounded-full bg-blue-500"></div>
 <span className="text-sm font-medium text-foreground">Standard Hours</span>
 </div>
 <span className="font-medium">8:00 AM - 5:00 PM</span>
 </div>
 <div className="flex justify-between items-center py-2.5 px-3 bg-red-50 rounded-lg">
 <div className="flex items-center space-x-2.5">
 <div className="w-2 h-2 rounded-full bg-red-500"></div>
 <span className="text-sm font-medium text-foreground">Emergency Service</span>
 </div>
 <Badge className="bg-red-100 text-red-700 border-red-200 font-medium">
 24/7 Available
 </Badge>
 </div>
 <div className="flex justify-between items-center py-2.5 px-3 bg-emerald-50 rounded-lg">
 <div className="flex items-center space-x-2.5">
 <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
 <span className="text-sm font-medium text-foreground">Response Time</span>
 </div>
 <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 font-medium">
 ≤ 2 hours
 </Badge>
 </div>
 </div>
 </CardContent>
 </Card>
 </div>

 <div className="space-y-4">
 <h3 className="text-lg font-semibold text-foreground">Contractor Description</h3>
 <div className="bg-gradient-to-br from-gray-50 to-white border border-border rounded-xl p-6">
 <p className="text-foreground leading-relaxed">
 {contractor.description || contractor.category?.description || 
 'Professional service contractor with expertise in their field. Committed to delivering high-quality services with excellent customer satisfaction.'}
 </p>
 </div>
 </div>
 </div>
 </TabsContent>

 {/* Enhanced Performance Tab with contractor context */}
 <TabsContent value="performance" className="p-6">
 <div className="space-y-6">
 <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
 <div>
 <h3 className="text-lg font-semibold text-foreground flex items-center">
 <Briefcase className="w-5 h-5 mr-2 text-blue-600" />
 Contractor Work Orders
 </h3>
 <p className="text-sm text-muted-foreground">Work orders assigned to this contractor</p>
 </div>
 <div className="flex items-center gap-2">
 <Button variant="outline" size="sm" className="w-full sm:w-auto">
 <Download className="w-4 h-4 mr-2" />
 Export Work Orders
 </Button>
 <Button 
 size="sm" 
 className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white w-full sm:w-auto"
 onClick={() => setIsCreateWorkOrderDialogOpen(true)}
 >
 <Plus className="w-4 h-4 mr-2" />
 Assign New Work Order
 </Button>
 </div>
 </div>
 
 {/* Work Orders List */}
 {workOrders.length > 0 ? (
 <div className="border border-border rounded-lg overflow-hidden bg-card">
 <div className="overflow-x-auto">
 <table className="w-full">
 <thead className="bg-muted">
 <tr>
 <th className="px-6 py-3.5 text-left text-xs font-semibold text-foreground uppercase tracking-wider">
 Work Order ID
 </th>
 <th className="px6 py-3.5 text-left text-xs font-semibold text-foreground uppercase tracking-wider">
 Service Type
 </th>
 <th className="px-6 py-3.5 text-left text-xs font-semibold text-foreground uppercase tracking-wider">
 Priority
 </th>
 <th className="px-6 py-3.5 text-left text-xs font-semibold text-foreground uppercase tracking-wider">
 Status
 </th>
 <th className="px-6 py-3.5 text-left text-xs font-semibold text-foreground uppercase tracking-wider">
 Created
 </th>
 <th className="px-6 py-3.5 text-left text-xs font-semibold text-foreground uppercase tracking-wider">
 Actions
 </th>
 </tr>
 </thead>
 <tbody className="divide-y divide-gray-100">
 {(Array.isArray(workOrders) ? workOrders : []).map((order) => {
 const statusColors = {
 'pending': { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
 'assigned': { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
 'in_progress': { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
 'completed': { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
 'cancelled': { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
 }[order.status] || { bg: 'bg-muted', text: 'text-foreground', border: 'border-border' };
 
 const priorityColors = {
 'high': { bg: 'bg-red-100', text: 'text-red-700' },
 'medium': { bg: 'bg-amber-100', text: 'text-amber-700' },
 'low': { bg: 'bg-blue-100', text: 'text-blue-700' },
 }[order.priority] || { bg: 'bg-muted', text: 'text-foreground' };
 
 return (
 <tr key={order.id} className="hover:bg-muted transition-colors">
 <td className="px-6 py-4 whitespace-nowrap">
 <div className="flex items-center space-x-2.5">
 <div className="p-1.5 rounded-md bg-muted">
 <FileText className="w-3.5 h-3.5 text-muted-foreground" />
 </div>
 <span className="font-medium text-foreground font-mono">
 WO-{order.id.toString().padStart(5, '0')}
 </span>
 </div>
 </td>
 <td className="px-6 py-4 whitespace-nowrap">
 <Badge variant="outline" className="text-xs bg-muted text-foreground">
 {order.workOrderType}
 </Badge>
 </td>
 <td className="px-6 py-4 whitespace-nowrap">
 <Badge 
 className={`text-xs font-medium px-2 py-1 ${priorityColors.bg} ${priorityColors.text}`}
 >
 {order.priority.charAt(0).toUpperCase() + order.priority.slice(1)}
 </Badge>
 </td>
 <td className="px-6 py-4 whitespace-nowrap">
 <div className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${statusColors.bg} ${statusColors.text} ${statusColors.border} border`}>
 {order.status.replace('_', ' ').toUpperCase()}
 </div>
 </td>
 <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
 {format(new Date(order.createdAt), 'MMM dd, yyyy')}
 </td>
 <td className="px-6 py-4 whitespace-nowrap">
 <div className="flex items-center space-x-1">
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button
 variant="ghost"
 size="sm"
 className="h-7 w-7 p-0 text-muted-foreground hover:text-muted-foreground"
 >
 <MoreVertical className="w-3.5 h-3.5" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-40">
 <DropdownMenuItem asChild>
 <Button
 variant="ghost"
 size="sm"
 className="h-auto w-full justify-start px-2 py-1.5 text-muted-foreground hover:text-blue-600 hover:bg-blue-50"
 onClick={() => setLocation(`/work-orders/${order.id}`)}
 >
 <Eye className="w-3.5 h-3.5" />
 View Details
 </Button>
 </DropdownMenuItem>
 <DropdownMenuItem onClick={() => {
 setSelectedWorkOrder(order);
 setIsEditDialogOpenWO(true);
 }}>
 <Clock className="w-3.5 h-3.5 mr-2" />
 Edit
 </DropdownMenuItem>
 <DropdownMenuSeparator />
 </DropdownMenuContent>
 </DropdownMenu>
 </div>
 </td>
 </tr>
 );
 })}
 </tbody>
 </table>
 </div>
 
 {/* Pagination */}
 {workOrders.length > 10 && (
 <div className="border-t border-border px-6 py-4">
 <div className="flex items-center justify-between">
 <div className="text-sm text-muted-foreground">
 Showing 1-10 of {workOrders.length} work orders
 </div>
 <div className="flex items-center space-x-2">
 <Button
 variant="outline"
 size="sm"
 className="h-8 w-8 p-0"
 disabled={true}
 >
 <ArrowLeft className="h-3.5 w-3.5" />
 </Button>
 <Button
 variant="outline"
 size="sm"
 className="h-8 w-8 p-0"
 >
 <span className="sr-only">Next page</span>
 <ArrowRight className="h-3.5 w-3.5" />
 </Button>
 </div>
 </div>
 </div>
 )}
 </div>
 ) : (
 <div className="text-center py-12">
 <div className="w-20 h-20 mx-auto mb-4 bg-gradient-to-br from-gray-100 to-gray-50 rounded-full flex items-center justify-center shadow-sm">
 <FileCheck className="w-10 h-10 text-muted-foreground" />
 </div>
 <h3 className="text-lg font-semibold text-foreground mb-2">No Work Orders Yet</h3>
 <p className="text-muted-foreground max-w-md mx-auto mb-6">
 This contractor hasn't been assigned any work orders yet. Assign a work order to get started.
 </p>
 <Button 
 className="bg-gradient-to-r from-blue-600 to-indigo-600"
 onClick={() => setIsCreateWorkOrderDialogOpen(true)}
 >
 <Plus className="w-4 h-4 mr-2" />
 Assign First Work Order
 </Button>
 </div>
 )}
 
 {/* Performance Summary */}
 {workOrders.length > 0 && (
 <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
 <Card className="border border-border shadow-sm">
 <CardContent className="p-4">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm text-muted-foreground mb-1">Completed</p>
 <p className="text-2xl font-semibold text-foreground">
 {workOrders.filter(o => o.status === 'completed').length}
 </p>
 </div>
 <div className="p-2 rounded-lg bg-emerald-50">
 <CheckCircle className="w-5 h-5 text-emerald-600" />
 </div>
 </div>
 <p className="text-xs text-muted-foreground mt-2">Total completed work orders</p>
 </CardContent>
 </Card>
 
 <Card className="border border-border shadow-sm">
 <CardContent className="p-4">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm text-muted-foreground mb-1">In Progress</p>
 <p className="text-2xl font-semibold text-foreground">
 {workOrders.filter(o => o.status === 'in_progress').length}
 </p>
 </div>
 <div className="p-2 rounded-lg bg-blue-50">
 <Clock className="w-5 h-5 text-blue-600" />
 </div>
 </div>
 <p className="text-xs text-muted-foreground mt-2">Active work orders</p>
 </CardContent>
 </Card>
 
 <Card className="border border-border shadow-sm">
 <CardContent className="p-4">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm text-muted-foreground mb-1">Completion Rate</p>
 <p className="text-2xl font-semibold text-foreground">
 {workOrders.length > 0 
 ? Math.round((workOrders.filter(o => o.status === 'completed').length / workOrders.length) * 100)
 : 0
 }%
 </p>
 </div>
 <div className="p-2 rounded-lg bg-purple-50">
 <TrendingUp className="w-5 h-5 text-purple-600" />
 </div>
 </div>
 <p className="text-xs text-muted-foreground mt-2">Overall completion rate</p>
 </CardContent>
 </Card>
 </div>
 )}
 </div>
 </TabsContent>

 {/* Enhanced Reviews Tab */}
 <TabsContent value="reviews" className="p-6">
 {isLoadingReviews ? (
 <div className="space-y-6">
 <Skeleton className="h-8 w-48" />
 <div className="space-y-4">
 <Skeleton className="h-36" />
 <Skeleton className="h-36" />
 </div>
 </div>
 ) : reviews.length > 0 ? (
 <div className="space-y-6">
 <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
 <div>
 <h3 className="text-lg font-semibold text-foreground flex items-center">
 <Star className="w-5 h-5 mr-2 text-blue-600" />
 Contractor Reviews
 </h3>
 <div className="flex items-center space-x-3 mt-1.5">
 <div className="flex items-center bg-muted px-3 py-1.5 rounded-lg">
 <span className="text-xl font-semibold mr-2">{rating.toFixed(1)}</span>
 <div className="flex">
 {[1, 2, 3, 4, 5].map((star) => (
 <Star
 key={star}
 className={`w-4 h-4 mx-0.5 ${
 star <= Math.round(rating)
 ? 'fill-yellow-400 text-yellow-400'
 : 'fill-gray-200 text-gray-200'
 }`}
 />
 ))}
 </div>
 </div>
 <span className="text-muted-foreground">•</span>
 <span className="text-muted-foreground">{reviews.length} contractor reviews</span>
 </div>
 </div>
 <Button variant="outline" className="border-border">
 <MessageSquare className="w-4 h-4 mr-2" />
 Add Contractor Review
 </Button>
 </div>
 
 <div className="space-y-4">
 {(Array.isArray(reviews) ? reviews : []).map((review) => (
 <Card key={review.id} className="border border-border hover:shadow-sm transition-shadow bg-card">
 <CardContent className="p-6">
 <div className="flex items-start justify-between mb-4">
 <div className="flex items-center space-x-3">
 <Avatar className="h-10 w-10">
 <AvatarFallback className="bg-gradient-to-br from-blue-100 to-indigo-200 text-blue-600 font-medium">
 {getInitials(review.reviewer)}
 </AvatarFallback>
 </Avatar>
 <div>
 <p className="font-semibold text-foreground">{review.reviewer}</p>
 <p className="text-sm text-muted-foreground">{review.property}</p>
 </div>
 </div>
 <div className="flex items-center space-x-1 bg-muted px-2.5 py-1 rounded-lg">
 <div className="flex">
 {[1, 2, 3, 4, 5].map((star) => (
 <Star
 key={star}
 className={`w-3.5 h-3.5 mx-0.5 ${
 star <= review.rating
 ? 'fill-yellow-400 text-yellow-400'
 : 'fill-gray-200 text-gray-200'
 }`}
 />
 ))}
 </div>
 <span className="text-sm font-semibold ml-1">{review.rating.toFixed(1)}</span>
 </div>
 </div>
 <p className="text-foreground mb-5 leading-relaxed">{review.comment}</p>
 <div className="flex items-center justify-between text-sm text-muted-foreground">
 <span>{format(new Date(review.date), 'MMMM dd, yyyy')}</span>
 <div className="flex items-center space-x-2">
 <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
 Helpful
 </Button>
 <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
 Reply
 </Button>
 </div>
 </div>
 </CardContent>
 </Card>
 ))}
 </div>
 </div>
 ) : (
 <div className="text-center py-12">
 <div className="w-20 h-20 mx-auto mb-4 bg-gradient-to-br from-yellow-100 to-yellow-50 rounded-full flex items-center justify-center shadow-sm">
 <Star className="w-10 h-10 text-yellow-400" />
 </div>
 <h3 className="text-lg font-semibold text-foreground mb-2">No Contractor Reviews Yet</h3>
 <p className="text-muted-foreground max-w-md mx-auto mb-6">
 This contractor hasn't received any reviews yet. Be the first to share your experience!
 </p>
 <Button className="bg-gradient-to-r from-yellow-500 to-amber-500 hover:from-yellow-600 hover:to-amber-600">
 <MessageSquare className="w-4 h-4 mr-2" />
 Be the First to Review
 </Button>
 </div>
 )}
 </TabsContent>
 </Tabs>
 </CardContent>
 </Card>
 </div>

 {/* Enhanced Right Column with contractor context */}
 <div className="space-y-6">
 <Card className="border border-border shadow-sm bg-card">
 <CardHeader className="pb-3">
 <CardTitle className="text-base font-semibold flex items-center text-foreground">
 <Zap className="w-5 h-5 mr-2.5 text-blue-600" />
 Contractor Quick Actions
 </CardTitle>
 </CardHeader>
 <CardContent className="space-y-2">
 {[
 {
 icon: FileCheck,
 label: 'Assign Work Order',
 description: 'Create new work order for this contractor',
 color: 'text-purple-600',
 bgColor: 'bg-purple-50',
 hoverColor: 'hover:bg-purple-50',
 action: () => setIsCreateWorkOrderDialogOpen(true),
 },
 {
 icon: Users,
 label: 'Contact Contractor',
 description: 'Send email to contractor',
 color: 'text-blue-600',
 bgColor: 'bg-blue-50',
 hoverColor: 'hover:bg-blue-50',
 action: () => window.open(`mailto:${contractor.email}`, '_blank'),
 },
 {
 icon: PhoneCall,
 label: 'Call Contractor',
 description: contractor.phone || 'No phone available',
 color: 'text-green-600',
 bgColor: 'bg-green-50',
 hoverColor: 'hover:bg-green-50',
 action: () => window.open(`tel:${contractor.phone}`, '_blank'),
 },
 ].map((action, index) => (
 <Button
 key={index}
 variant="ghost"
 className={`w-full justify-start ${action.hoverColor} transition-all group py-3 h-auto`}
 onClick={action.action}
 >
 <div className={`p-2 rounded-lg ${action.bgColor} group-hover:scale-110 transition-transform mr-3`}>
 <action.icon className={`w-4 h-4 ${action.color}`} />
 </div>
 <div className="flex-1 text-left">
 <span className="font-medium text-foreground block">{action.label}</span>
 {action.description && (
 <span className="text-xs text-muted-foreground">{action.description}</span>
 )}
 </div>
 <ChevronRight className="w-4 h-4 text-muted-foreground ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
 </Button>
 ))}
 </CardContent>
 </Card>

 {/* Additional Information Card */}
 <Card className="border border-border shadow-sm bg-card">
 <CardHeader className="pb-3">
 <CardTitle className="text-base font-semibold flex items-center text-foreground">
 <Info className="w-5 h-5 mr-2.5 text-blue-600" />
 Contractor Details
 </CardTitle>
 </CardHeader>
 <CardContent className="space-y-4">
 {contractor.createdAt && contractor.contractEndDate && (
 <div className="space-y-3">
 <h4 className="text-sm font-medium text-foreground">Contract Period with Contractor</h4>
 <ContractPeriod 
 startDate={contractor.createdAt}
 endDate={contractor.contractEndDate}
 />
 </div>
 )}
 
 {contractor.coverageAreas && contractor.coverageAreas.length > 0 && (
 <div className="space-y-2">
 <h4 className="text-sm font-medium text-foreground">Contractor Coverage Areas</h4>
 <div className="flex flex-wrap gap-1.5">
 {contractor.coverageAreas.map((area, index) => (
 <Badge 
 key={index}
 variant="outline" 
 className="text-xs bg-blue-50 border-blue-200 text-blue-700"
 >
 <MapPin className="w-3 h-3 mr-1" />
 {area}
 </Badge>
 ))}
 </div>
 </div>
 )}

 {/* Contractor Stats */}
 <div className="space-y-2 pt-2">
 <div className="flex justify-between items-center py-2 border-b border-border">
 <span className="text-sm text-muted-foreground">Total Jobs</span>
 <span className="font-semibold">{contractor.totalJobsCompleted || 0}</span>
 </div>
 <div className="flex justify-between items-center py-2">
 <span className="text-sm text-muted-foreground">Contractor ID</span>
 <span className="font-mono text-sm">CTR-{contractor.id.toString().padStart(5, '0')}</span>
 </div>
 </div>
 </CardContent>
 </Card>
 </div>
 </div>
 </div>
 {/* Edit Dialog */}
 <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
 <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto bg-card shadow-lg rounded-lg">
 <DialogHeader className="border-b border-border pb-4 px-6 pt-5">
 <div className="flex items-center gap-3">
 <div className="p-1.5 rounded-md bg-blue-50">
 <HardHat className="w-5 h-5 text-blue-600" />
 </div>
 <div>
 <DialogTitle className="text-xl font-semibold text-foreground">
 Edit Contractor Information
 </DialogTitle>
 <DialogDescription className="text-sm text-muted-foreground mt-0.5">
 Update details for {contractor?.companyName}
 </DialogDescription>
 </div>
 </div>
 </DialogHeader>
 
 <div className="px-12 py-3">
 <Form {...form}>
 <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
 {/* Contact Information */}
 <div className="space-y-4">
 <div className="flex items-center gap-2">
 <div className="w-1.5 h-4 rounded-full bg-blue-500"></div>
 <h3 className="text-base font-semibold text-foreground">
 Contractor Contact Information
 </h3>
 </div>
 
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 <FormField
 control={form.control}
 name="company_name"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-sm font-medium text-foreground">
 Company Name <span className="text-red-500">*</span>
 </FormLabel>
 <FormControl>
 <Input 
 placeholder="Enter company name" 
 {...field} 
 className="h-10 text-sm border-border hover:border-border focus:border-emerald-500"
 />
 </FormControl>
 <FormMessage className="text-xs mt-1" />
 </FormItem>
 )}
 />
 
 <FormField
 control={form.control}
 name="category_id"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-sm font-medium text-foreground">
 Service Category <span className="text-red-500">*</span>
 </FormLabel>
 <Select onValueChange={field.onChange} value={field.value}>
 <FormControl>
 <SelectTrigger className="h-10 text-sm border-border hover:border-border focus:border-emerald-500" >
 <SelectValue placeholder="Select category" />
 </SelectTrigger>
 </FormControl>
 <SelectContent className="border-border">
 {(Array.isArray(categories) ? categories : []).map((category) => (
 <SelectItem 
 key={category.id} 
 value={category.id.toString()}
 className="text-sm"
 >
 {category.name}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 <FormMessage className="text-xs mt-1" />
 </FormItem>
 )}
 />
 
 <FormField
 control={form.control}
 name="contact_person"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-sm font-medium text-foreground">
 Contact Person <span className="text-red-500">*</span>
 </FormLabel>
 <FormControl>
 <div className="relative">
 <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
 <User className="w-3.5 h-3.5 text-muted-foreground" />
 </div>
 <Input 
 placeholder="Primary contact person" 
 {...field} 
 className="h-10 pl-9 text-sm border-border hover:border-border focus:border-emerald-500"
 />
 </div>
 </FormControl>
 <FormMessage className="text-xs mt-1" />
 </FormItem>
 )}
 />
 
 <FormField
 control={form.control}
 name="email"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-sm font-medium text-foreground">
 Email Address <span className="text-red-500">*</span>
 </FormLabel>
 <FormControl>
 <div className="relative">
 <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
 <Mail className="w-3.5 h-3.5 text-muted-foreground" />
 </div>
 <Input 
 type="email" 
 placeholder="contact@company.com" 
 {...field} 
 className="h-10 pl-9 text-sm border-border hover:border-border focus:border-emerald-500"
 />
 </div>
 </FormControl>
 <FormMessage className="text-xs mt-1" />
 </FormItem>
 )}
 />
 </div>
 
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 <FormField
 control={form.control}
 name="phone"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-sm font-medium text-foreground">
 Phone Number <span className="text-red-500">*</span>
 </FormLabel>
 <FormControl>
 <div className="relative">
 <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
 <Phone className="w-3.5 h-3.5 text-muted-foreground" />
 </div>
 <Input 
 placeholder="+254 712 345 678" 
 {...field} 
 className="h-10 pl-9 text-sm border-border hover:border-border focus:border-emerald-500"
 />
 </div>
 </FormControl>
 <FormMessage className="text-xs mt-1" />
 </FormItem>
 )}
 />
 
 <FormField
 control={form.control}
 name="hourly_rate"
 render={({ field }) => (
 <FormItem>
 <FormLabel className="text-sm font-medium text-foreground">
 Hourly Rate (KES) <span className="text-red-500">*</span>
 </FormLabel>
 <FormControl>
 <div className="relative">
 <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
 <span className="text-sm text-muted-foreground">KES</span>
 </div>
 <Input 
 type="number" 
 placeholder="1500" 
 {...field}
 onChange={(e) => field.onChange(e.target.value === '' ? 0 : Number(e.target.value))}
 className="h-10 pl-12 text-sm border-border hover:border-border focus:border-emerald-500"
 />
 </div>
 </FormControl>
 <FormMessage className="text-xs mt-1" />
 </FormItem>
 )}
 />
 </div>
 </div>
 
 {/* Services Offered */}
 <div className="space-y-4">
 <div className="flex items-center gap-2">
 <div className="w-1.5 h-4 rounded-full bg-green-500"></div>
 <h3 className="text-base font-semibold text-foreground">
 Contractor Services
 </h3>
 </div>
 
 <FormField
 control={form.control}
 name="services_offered"
 render={({ field }) => {
 const services = field.value || [];
 
 return (
 <FormItem>
 <FormLabel className="text-sm font-medium text-foreground">
 Services Provided <span className="text-red-500">*</span>
 <span className="text-xs font-normal text-muted-foreground block mt-1">
 Add services this contractor provides
 </span>
 </FormLabel>
 <FormControl>
 <div className="space-y-2">
 <div className="flex gap-2">
 <Input
 placeholder="Add a service (e.g., Plumbing, Electrical)"
 onKeyDown={(e) => {
 if (e.key === 'Enter' && e.currentTarget.value.trim()) {
 e.preventDefault();
 const newServices = [...services, e.currentTarget.value.trim()];
 field.onChange(newServices);
 e.currentTarget.value = '';
 }
 }}
 className="h-8 text-sm flex-1 border-border hover:border-border focus:border-green-500"
 />
 <Button
 type="button"
 variant="outline"
 size="sm"
 className="h-8 px-2 border-border hover:bg-muted"
 onClick={(e) => {
 e.preventDefault();
 const input = e.currentTarget.previousElementSibling as HTMLInputElement;
 if (input?.value.trim()) {
 const newServices = [...services, input.value.trim()];
 field.onChange(newServices);
 input.value = '';
 }
 }}
 >
 <Plus className="w-3 h-3" />
 </Button>
 </div>
 
 {services.length > 0 && (
 <div className="space-y-1.5">
 <div className="flex justify-between items-center">
 <span className="text-xs text-muted-foreground">
 {services.length} service(s)
 </span>
 <button
 type="button"
 onClick={() => field.onChange([])}
 className="text-xs text-red-500 hover:text-red-600"
 >
 Clear all
 </button>
 </div>
 <div className="flex flex-wrap gap-1.5">
 {services.map((service, index) => (
 <div
 key={index}
 className="group flex items-center gap-1 px-2 py-1 bg-green-50 text-green-700 rounded text-xs border border-green-100"
 >
 <Wrench className="w-3 h-3 mr-1" />
 <span>{service}</span>
 <button
 type="button"
 onClick={() => {
 const newServices = services.filter((_, i) => i !== index);
 field.onChange(newServices);
 }}
 className="opacity-0 group-hover:opacity-100 ml-0.5 text-green-500 hover:text-green-700"
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
 <FormMessage className="text-xs mt-1" />
 </FormItem>
 );
 }}
 />
 </div>
 
 {/* Footer */}
 <DialogFooter className="border-t border-border pt-4 mt-4">
 <div className="flex flex-col sm:flex-row w-full gap-3">
 <div className="flex-1">
 <p className="text-xs text-muted-foreground">
 All fields marked with <span className="text-red-500">*</span> are required
 </p>
 </div>
 
 <div className="flex gap-2">
 <Button 
 type="button" 
 variant="outline" 
 onClick={() => setIsEditDialogOpen(false)}
 className="h-9 px-4 text-sm border-border hover:bg-muted"
 >
 Cancel
 </Button>
 <Button 
 type="submit" 
 disabled={editContractorMutation.isPending}
 className="h-9 px-4 text-sm bg-emerald-600 hover:bg-emerald-700"
 >
 {editContractorMutation.isPending ? (
 <>
 <div className="animate-spin h-3 w-3 mr-1.5 border-2 border-white border-t-transparent rounded-full" />
 Updating...
 </>
 ) : (
 <>
 <Edit className="w-3 h-3 mr-1.5" />
 Update Contractor
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
 {contractor && (
 <CreateWorkOrderDialog
 open={isCreateWorkOrderDialogOpen}
 onOpenChange={setIsCreateWorkOrderDialogOpen}
 contractorId={contractor.id}
 contractorName={contractor.companyName}
 />
 )}

 {selectedWorkOrder && (
 <EditWorkOrderDialog
 open={isEditDialogOpenWO}
 onOpenChange={setIsEditDialogOpenWO}
 workOrder={selectedWorkOrder}
 contractorName={contractor?.companyName}
 onSuccess={() => {
 // queryClient.invalidateQueries({ queryKey: [`/api/contractors/${id}/work-orders`] });
 }}
 />
 )}

 </div>
 );
}