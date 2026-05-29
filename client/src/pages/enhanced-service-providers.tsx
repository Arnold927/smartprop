import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { useForm, SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { DropdownMenu, DropdownMenuItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import * as z from "zod";
import { 
  Plus, Search, Building2, Shield, Sparkles, TreePine, Trash2, Zap, Droplets, Bug, Flame, Star, Phone, Mail, MapPin, Calendar, Clock,
  CheckCircle, AlertTriangle, Eye, Edit, FileText, Award, TrendingUp, User, MoreVertical, Download, X
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { format } from "date-fns";
import DataTable from "@/components/ui/data-table";
import StatusBadge from "@/components/ui/status-badge";
import CategoryManagementModal from "./../components/category-management-modal"; 
import { useLocation } from "wouter";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";

const contractorSchema = z.object({
  company_name: z.string().min(2, "Company name must be at least 2 characters"),
  category_id: z.string().min(1, "Please select a category"),
  contact_person: z.string().min(2, "Contact person name is required"),
  phone: z.string().min(10, "Valid phone number is required"),
  email: z.string().email("Valid email address is required"),
  hourly_rate: z.number().min(0, "Hourly rate must be positive"),
  services_offered: z.array(z.string()).min(1, "At least one service must be specified"),
});

const categorySchema = z.object({
  name: z.string().min(2, "Category name must be at least 2 characters"),
  description: z.string().default(""),
  requiredCertifications: z.array(z.string()).default([]),
  typicalServices: z.array(z.string()).default([]),
  defaultHourlyRate: z.number().min(0).default(0),
  defaultDailyRate: z.number().min(0).default(0),
  isActive: z.boolean().default(true),
});

type CategoryFormData = {
  name: string;
  description: string;
  requiredCertifications: string[];
  typicalServices: string[];
  defaultHourlyRate: number;
  defaultDailyRate: number;
  isActive: boolean;
};

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
  contractStartDate?: string;
  contractEndDate?: string;
  slaAdherenceScore?: number;
  category?: {
    name: string;
    description: string;
  };
}

interface ServiceCategory {
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

interface ContractorWorkOrder {
  id: number;
  contractorId: number;
  workOrderNumber: string;
  propertyName: string;
  description: string;
  priority: string;
  status: string;
  scheduledDate: string;
  completedDate?: string;
  amount: number;
  currency: string;
  contractor?: {
    companyName: string;
  };
}

const categoryIcons = {
  'Cleaning Services': Sparkles,
  'Security Services': Shield,
  'Maintenance & Repairs': Building2,
  'Landscaping': TreePine,
  'Waste Management': Trash2,
  'HVAC Services': Zap,
  'Generator Services': Zap,
  'Water Treatment': Droplets,
  'Pest Control': Bug,
  'Fire Safety': Flame,
};

const getVettingStatusColor = (status: string) => {
  switch (status) {
    case 'approved': return 'bg-emerald-50 text-emerald-700 border border-emerald-200';
    case 'pending': return 'bg-yellow-100 text-yellow-800';
    case 'under_review': return 'bg-blue-100 text-blue-800';
    case 'rejected': return 'bg-red-100 text-red-800';
    default: return 'bg-muted text-foreground';
  }
};

export default function EnhancedServiceProviders() {
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [vettingFilter, setVettingFilter] = useState("all");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<ServiceCategory | null>(null);
  const [serviceInput, setServiceInput] = useState("");
  const [certificationInput, setCertificationInput] = useState("");
  const [, setLocation] = useLocation();
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("contractors");

  const navigate = (path: string) => {
    setLocation(path);
  };

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const categoryForm = useForm<CategoryFormData>({
    resolver: zodResolver(categorySchema as any),
    defaultValues: {
      name: "",
      description: "",
      requiredCertifications: [],
      typicalServices: [],
      defaultHourlyRate: 0,
      defaultDailyRate: 0,
      isActive: true,
    },
  });

  const createCategoryMutation = useMutation({
    mutationFn: async (data: CategoryFormData) => {
      const response = await apiRequest("/api/service-contractor-categories", {
        method: "POST",
        data,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-contractor-categories"] });
      toast({
        title: "Success",
        description: "Service category created successfully",
        className: "bg-card dark:bg-gray-900 border border-border dark:border-gray-700",
      });
      setIsCategoryDialogOpen(false);
      categoryForm.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create service category",
        variant: "destructive",
        className: "bg-card dark:bg-gray-900 border border-border dark:border-gray-700",
      });
    },
  });

  const updateCategoryMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: CategoryFormData }) => {
      const response = await apiRequest(`/api/service-contractor-categories/${id}`, {
        method: "PUT",
        data,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-contractor-categories"] });
      toast({
        title: "Success",
        description: "Service category updated successfully",
      });
      setIsCategoryDialogOpen(false);
      setEditingCategory(null);
      categoryForm.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update service category",
        variant: "destructive",
      });
    },
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest(`/api/service-contractor-categories/${id}`, {
        method: "DELETE",
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-contractor-categories"] });
      toast({
        title: "Success",
        description: "Service category deleted successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete service category",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, categoryFilter, statusFilter, vettingFilter]);

  const handleCategorySubmit: SubmitHandler<CategoryFormData> = (data) => {
    if (editingCategory) {
      updateCategoryMutation.mutate({ id: editingCategory.id, data });
    } else {
      createCategoryMutation.mutate(data);
    }
  };

  const handleEditCategory = (category: ServiceCategory) => {
    setEditingCategory(category);
    setServiceInput("");
    setCertificationInput("");
    categoryForm.reset({
      name: category.name,
      description: category.description || "",
      requiredCertifications: category.requiredCertifications || [],
      typicalServices: category.typicalServices || [],
      defaultHourlyRate: category.defaultHourlyRate || 0,
      defaultDailyRate: category.defaultDailyRate || 0,
      isActive: category.isActive !== false,
    });
    setIsCategoryDialogOpen(true);
  };

  const handleDeleteCategory = (id: number) => {
    if (window.confirm("Are you sure you want to delete this category?")) {
      deleteCategoryMutation.mutate(id);
    }
  };

  const form = useForm<z.infer<typeof contractorSchema>>({
    resolver: zodResolver(contractorSchema),
    defaultValues: {
      company_name: "",
      category_id: "",
      contact_person: "",
      phone: "",
      email: "",
      hourly_rate: 0,
      services_offered: [],
    },
  });

  const createContractorMutation = useMutation({
    mutationFn: async (data: z.infer<typeof contractorSchema>) => {
      const response = await apiRequest("/api/service-contractors", {
        method: "POST",
        data: {
          ...data,
          hourly_rate: Number(data.hourly_rate),
        },
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-contractors"] });
      toast({
        title: "Success",
        description: "Service contractor created successfully",
      });
      setIsCreateDialogOpen(false);
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create service contractor",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: z.infer<typeof contractorSchema>) => {
    createContractorMutation.mutate(data);
  };

  const handleViewContractor = (contractor: ServiceContractor) => {
    toast({
      title: "Viewing Contractor",
      description: `Opening details for ${contractor.companyName}`,
    });
  };

  const handleEditContractor = (contractor: ServiceContractor) => {
    toast({
      title: "Edit Contractor",
      description: `Opening edit form for ${contractor.companyName}`,
    });
  };

  const handleExportContractor = (contractor: ServiceContractor) => {
    const contractorData = {
      company: contractor.companyName || 'N/A',
      contact: contractor.contactPerson || 'N/A',
      email: contractor.email || 'N/A',
      phone: contractor.phone || 'N/A',
      services: contractor.servicesOffered?.join("; ") || 'N/A',
      rating: contractor.overallRating || 0,
      status: contractor.status || 'N/A',
      vettingStatus: contractor.vettingStatus || 'N/A',
      hourlyRate: `${contractor.currency || 'KES'} ${contractor.hourlyRate || 0}`,
      dailyRate: `${contractor.currency || 'KES'} ${contractor.dailyRate || 0}`,
      jobsCompleted: contractor.totalJobsCompleted || 0,
      slaAdherence: `${contractor.slaAdherenceScore || 0}%`,
      contractStart: contractor.contractStartDate || 'N/A',
      contractEnd: contractor.contractEndDate || 'N/A'
    };

    const csvContent = `Company Name,Contact Person,Email,Phone,Services,Rating,Status,Vetting Status,Hourly Rate,Daily Rate,Jobs Completed,SLA Adherence,Contract Start,Contract End
"${contractorData.company}","${contractorData.contact}","${contractorData.email}","${contractorData.phone}","${contractorData.services}",${contractorData.rating},"${contractorData.status}","${contractorData.vettingStatus}","${contractorData.hourlyRate}","${contractorData.dailyRate}",${contractorData.jobsCompleted},"${contractorData.slaAdherence}","${contractorData.contractStart}","${contractorData.contractEnd}"`;

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `contractor-${contractor.companyName?.replace(/\s+/g, '-') || 'export'}-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({
      title: "Export Successful",
      description: `Contractor data exported to CSV file`,
    });
  };

  const handleExportReport = () => {
    if (!contractors || contractors.length === 0) {
      toast({
        title: "No Data to Export",
        description: "No contractor data available for export",
        variant: "destructive"
      });
      return;
    }

    const headers = "Company Name,Contact Person,Email,Phone,Services,Rating,Status,Vetting Status,Hourly Rate,Daily Rate,Jobs Completed,SLA Adherence,Contract Start,Contract End";
    const csvRows = (Array.isArray(contractors) ? contractors : []).map(contractor => {
      const services = contractor.servicesOffered?.join("; ") || "";
      return `"${contractor.companyName || ''}","${contractor.contactPerson || ''}","${contractor.email || ''}","${contractor.phone || ''}","${services}",${contractor.overallRating || 0},"${contractor.status || ''}","${contractor.vettingStatus || ''}","${contractor.currency || 'KES'} ${contractor.hourlyRate || 0}","${contractor.currency || 'KES'} ${contractor.dailyRate || 0}",${contractor.totalJobsCompleted || 0},"${contractor.slaAdherenceScore || 0}%","${contractor.contractStartDate || ''}","${contractor.contractEndDate || ''}"`;
    });

    const csvContent = [headers, ...csvRows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `service-providers-report-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({
      title: "Export Successful",
      description: `${contractors.length} service providers exported to CSV file`,
    });
  };

  const { data: contractors = [], isLoading: contractorsLoading } = useQuery<ServiceContractor[]>({
    queryKey: ["/api/service-contractors"],
    queryFn: async () => { const r = await apiRequest("/api/service-contractors"); return ensureArray(await r.json()); },
    enabled: activeTab === 'contractors',
  });

  const { data: categories = [], isLoading: categoriesLoading } = useQuery<ServiceCategory[]>({
    queryKey: ["/api/service-contractor-categories"],
    queryFn: async () => { const r = await apiRequest("/api/service-contractor-categories"); return ensureArray(await r.json()); },
    enabled: activeTab === 'categories',
  });

  const { data: workOrders = [], isLoading: workOrdersLoading } = useQuery<ContractorWorkOrder[]>({
    queryKey: ["/api/work-orders"],
    queryFn: async () => { const r = await apiRequest("/api/work-orders"); return ensureArray(await r.json()); },
    enabled: activeTab === 'workorders',
  });

  const activeContractors = contractors.filter(c => c.status === 'active');
  const approvedContractors = contractors.filter(c => c.vettingStatus === 'approved');
  const averageRating = contractors.length > 0 
    ? contractors.reduce((sum, c) => sum + (c.overallRating || 0), 0) / contractors.length 
    : 0;
  const totalJobsCompleted = contractors.reduce((sum, c) => sum + (c.totalJobsCompleted || 0), 0);

  const filteredContractors = contractors.filter(contractor => {
    const searchLower = searchTerm.toLowerCase();
    const matchesSearch = 
      (contractor.companyName || '').toLowerCase().includes(searchLower) ||
      (contractor.contactPerson || '').toLowerCase().includes(searchLower) ||
      (contractor.email || '').toLowerCase().includes(searchLower) ||
      (contractor.phone || '').toLowerCase().includes(searchLower) ||
      (contractor.category?.name || '').toLowerCase().includes(searchLower) ||
      (contractor.servicesOffered || []).some(service => 
        service.toLowerCase().includes(searchLower)
      );
    
    const matchesCategory = categoryFilter === 'all' || 
      contractor.categoryId?.toString() === categoryFilter;
    const matchesStatus = statusFilter === 'all' || contractor.status === statusFilter;
    const matchesVetting = vettingFilter === 'all' || contractor.vettingStatus === vettingFilter;
    
    return matchesSearch && matchesCategory && matchesStatus && matchesVetting;
  });

  const indexOfLastRow = currentPage * rowsPerPage;
  const indexOfFirstRow = indexOfLastRow - rowsPerPage;
  const currentContractors = filteredContractors.slice(indexOfFirstRow, indexOfLastRow);

  useEffect(() => {
    setTotalPages(Math.ceil(filteredContractors.length / rowsPerPage));
    if (currentPage > Math.ceil(filteredContractors.length / rowsPerPage) && currentPage > 1) {
      setCurrentPage(1);
    }
  }, [filteredContractors, rowsPerPage, currentPage]);

  const filteredWorkOrders = (Array.isArray(workOrders) ? workOrders : []).filter(order => {
    const searchLower = searchTerm.toLowerCase();
    const matchesSearch = 
      (order.workOrderNumber || '').toLowerCase().includes(searchLower) ||
      (order.description || '').toLowerCase().includes(searchLower) ||
      (order.propertyName || '').toLowerCase().includes(searchLower) ||
      (order.contractor?.companyName || '').toLowerCase().includes(searchLower) ||
      (order.priority || '').toLowerCase().includes(searchLower) ||
      (order.status || '').toLowerCase().includes(searchLower);
    return matchesSearch;
  });

  const filteredCategories = categories.filter(category => {
    const searchLower = searchTerm.toLowerCase();
    const matchesSearch =
      (category.name || '').toLowerCase().includes(searchLower) ||
      (category.description || '').toLowerCase().includes(searchLower) ||
      (category.typicalServices || []).some(service => 
        service.toLowerCase().includes(searchLower)
      ) ||
      (category.requiredCertifications || []).some(cert => 
        cert.toLowerCase().includes(searchLower)
      );
    
    return matchesSearch;
  });

  const getRatingColor = (rating: number) => {
    if (rating >= 4.5) return 'text-green-600';
    if (rating >= 4.0) return 'text-blue-600';
    if (rating >= 3.0) return 'text-yellow-600';
    return 'text-red-600';
  };

  const workOrderColumns = [
    {
      header: "WO #",
      accessorKey: "ticketNumber",
      cell: (order: any) => (
        <span className="font-mono font-medium">{order.ticketNumber}</span>
      ),
    },
    {
      header: "Title",
      accessorKey: "title",
      cell: (order: any) => (
        <div className="max-w-md truncate" title={order.title}>
          {order.title}
        </div>
      ),
    },
    {
      header: "Status",
      accessorKey: "status",
      cell: (order: any) => <StatusBadge status={order.status} />,
    },
    {
      header: "Scheduled",
      accessorKey: "estimatedStartDate",
      cell: (order: any) => {
        if (!order.estimatedStartDate) {
          return <span className="text-muted-foreground text-sm">Not set</span>;
        }
        try {
          const date = new Date(order.estimatedStartDate);
          return format(date, 'MMM dd');
        } catch {
          return <span className="text-muted-foreground text-sm">Invalid</span>;
        }
      },
    },
    {
      header: "",
      accessorKey: "actions",
      cell: (order: any) => (
        <Button 
          size="sm" 
          variant="ghost"
          onClick={() => navigate(`/work-orders/${order.id}`)}
        >
          Details
        </Button>
      ),
    },
  ];

  useEffect(() => {
    setSearchTerm("");
    setCategoryFilter("all");
    setStatusFilter("all");
    setVettingFilter("all");
  }, [activeTab]);

  return (
    <div className="space-y-4 max-w-full overflow-x-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Enhanced Service Providers</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Comprehensive service provider and contractor management</p>
        </div>
        <div className="flex items-center space-x-2 w-full sm:w-auto">
          <div className="relative">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button 
                  variant="outline" 
                  size="sm"
                  className="h-8 w-8 p-0 border-border dark:border-gray-700 hover:bg-muted dark:hover:bg-gray-800"
                  title="Quick Actions"
                >
                  <div className="flex flex-col items-center justify-center">
                    <div className="w-1 h-1 rounded-full bg-gray-400 mb-0.5"></div>
                    <div className="w-1 h-1 rounded-full bg-gray-400 mb-0.5"></div>
                    <div className="w-1 h-1 rounded-full bg-gray-400"></div>
                  </div>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent 
                align="end" 
                className="w-48 border-border dark:border-gray-700 bg-card dark:bg-gray-900 shadow-lg"
              >
                <DropdownMenuLabel className="text-xs font-semibold text-slate-500">
                  Quick Actions
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-muted dark:bg-gray-800" />
                <DropdownMenuItem 
                  onClick={handleExportReport}
                  className="text-sm cursor-pointer hover:bg-muted dark:hover:bg-gray-800"
                >
                  <FileText className="w-3.5 h-3.5 mr-2 text-slate-500" />
                  Export Report
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => {
                    setEditingCategory(null);
                    categoryForm.reset({
                      name: "",
                      description: "",
                      requiredCertifications: [],
                      typicalServices: [],
                      defaultHourlyRate: 0,
                      defaultDailyRate: 0,
                      isActive: true,
                    });
                    setIsCategoryDialogOpen(true);
                  }}
                  className="text-sm cursor-pointer hover:bg-muted dark:hover:bg-gray-800"
                >
                  <Building2 className="w-3.5 h-3.5 mr-2 text-slate-500" />
                  Add Service Category
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="bg-blue-500/85 text-white hover:bg-blue-600/90 shadow-sm whitespace-nowrap">
                <Plus className="w-4 h-4 mr-1" />
                Add Contractor
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-card dark:bg-gray-900 shadow-2xl rounded-lg border-0">
              <DialogHeader className="border-b border-border dark:border-gray-800 pb-3 px-5 pt-4">
                <div className="flex items-center gap-2">
                  <div className="p-1 rounded-md bg-blue-50 dark:bg-blue-900/20">
                    <Building2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <DialogTitle className="text-lg font-bold text-foreground">
                      Create New Service Contractor
                    </DialogTitle>
                    <DialogDescription className="text-xs text-slate-500 mt-0.5">
                      Add a new service contractor to your network
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>
              
              <div className="px-5 py-3">
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    {/* Contact Information */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <div className="w-1 h-3 rounded-full bg-blue-500"></div>
                        <h3 className="text-sm font-semibold text-foreground">
                          Contact Information
                        </h3>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <FormField
                          control={form.control}
                          name="company_name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs font-medium text-foreground dark:text-muted-foreground">
                                Company Name <span className="text-red-500">*</span>
                              </FormLabel>
                              <FormControl>
                                <Input 
                                  placeholder="Enter company name" 
                                  {...field} 
                                  className="h-8 text-xs border-border dark:border-gray-700"
                                />
                              </FormControl>
                              <FormMessage className="text-xs mt-0.5" />
                            </FormItem>
                          )}
                        />
                        
                        <FormField
                          control={form.control}
                          name="category_id"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs font-medium text-foreground dark:text-muted-foreground">
                                Service Category <span className="text-red-500">*</span>
                              </FormLabel>
                              <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl>
                                  <SelectTrigger className="h-8 text-xs border-border dark:border-gray-700">
                                    <SelectValue placeholder="Select category" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent className="border-border dark:border-gray-700">
                                  {(Array.isArray(categories) ? categories : []).map((category) => (
                                    <SelectItem 
                                      key={category.id} 
                                      value={category.id.toString()}
                                      className="text-xs"
                                    >
                                      {category.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage className="text-xs mt-0.5" />
                            </FormItem>
                          )}
                        />
                        
                        <FormField
                          control={form.control}
                          name="contact_person"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs font-medium text-foreground dark:text-muted-foreground">
                                Contact Person <span className="text-red-500">*</span>
                              </FormLabel>
                              <FormControl>
                                <div className="relative">
                                  <div className="absolute inset-y-0 left-0 flex items-center pl-2 pointer-events-none">
                                    <User className="w-3 h-3 text-muted-foreground" />
                                  </div>
                                  <Input 
                                    placeholder="Primary contact" 
                                    {...field} 
                                    className="h-8 pl-7 text-xs border-border dark:border-gray-700"
                                  />
                                </div>
                              </FormControl>
                              <FormMessage className="text-xs mt-0.5" />
                            </FormItem>
                          )}
                        />
                        
                        <FormField
                          control={form.control}
                          name="email"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs font-medium text-foreground dark:text-muted-foreground">
                                Email Address <span className="text-red-500">*</span>
                              </FormLabel>
                              <FormControl>
                                <div className="relative">
                                  <div className="absolute inset-y-0 left-0 flex items-center pl-2 pointer-events-none">
                                    <Mail className="w-3 h-3 text-muted-foreground" />
                                  </div>
                                  <Input 
                                    type="email" 
                                    placeholder="contact@company.com" 
                                    {...field} 
                                    className="h-8 pl-7 text-xs border-border dark:border-gray-700"
                                  />
                                </div>
                              </FormControl>
                              <FormMessage className="text-xs mt-0.5" />
                            </FormItem>
                          )}
                        />
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <FormField
                          control={form.control}
                          name="phone"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs font-medium text-foreground dark:text-muted-foreground">
                                Phone Number <span className="text-red-500">*</span>
                              </FormLabel>
                              <FormControl>
                                <div className="relative">
                                  <div className="absolute inset-y-0 left-0 flex items-center pl-2 pointer-events-none">
                                    <Phone className="w-3 h-3 text-muted-foreground" />
                                  </div>
                                  <Input 
                                    placeholder="+254 712 345 678" 
                                    {...field} 
                                    className="h-8 pl-7 text-xs border-border dark:border-gray-700"
                                  />
                                </div>
                              </FormControl>
                              <FormMessage className="text-xs mt-0.5" />
                            </FormItem>
                          )}
                        />
                        
                        <FormField
                          control={form.control}
                          name="hourly_rate"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs font-medium text-foreground dark:text-muted-foreground">
                                Hourly Rate (KES) <span className="text-red-500">*</span>
                              </FormLabel>
                              <FormControl>
                                <div className="relative">
                                  <div className="absolute inset-y-0 left-0 flex items-center pl-2 pointer-events-none">
                                    <span className="text-xs text-muted-foreground">KES</span>
                                  </div>
                                  <Input 
                                    type="number" 
                                    placeholder="1500" 
                                    {...field}
                                    onChange={(e) => field.onChange(e.target.value === '' ? 0 : Number(e.target.value))}
                                    className="h-8 pl-10 text-xs border-border dark:border-gray-700"
                                  />
                                </div>
                              </FormControl>
                              <FormMessage className="text-xs mt-0.5" />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>
                    
                    {/* Services Offered */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <div className="w-1 h-3 rounded-full bg-green-500"></div>
                        <h3 className="text-sm font-semibold text-foreground">
                          Services Offered
                        </h3>
                      </div>
                      
                      <FormField
                        control={form.control}
                        name="services_offered"
                        render={({ field }) => {
                          const services = field.value || [];
                          
                          return (
                            <FormItem>
                              <FormLabel className="text-xs font-medium text-foreground dark:text-muted-foreground">
                                Services <span className="text-red-500">*</span>
                              </FormLabel>
                              <FormControl>
                                <div className="space-y-2">
                                  <div className="flex gap-2">
                                    <Input
                                      placeholder="Add a service"
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                                          e.preventDefault();
                                          const newServices = [...services, e.currentTarget.value.trim()];
                                          field.onChange(newServices);
                                          e.currentTarget.value = '';
                                        }
                                      }}
                                      className="h-7 text-xs flex-1 border-border dark:border-gray-700"
                                    />
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-7 px-2 border-border dark:border-gray-700"
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
                                    <div className="space-y-1">
                                      <div className="flex justify-between items-center">
                                        <span className="text-xs text-slate-500">
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
                                      <div className="flex flex-wrap gap-1">
                                        {services.map((service, index) => (
                                          <div
                                            key={index}
                                            className="group flex items-center gap-1 px-1.5 py-0.5 bg-green-50 dark:bg-green-900/10 text-green-700 dark:text-green-300 rounded text-xs border border-green-100 dark:border-green-900/30"
                                          >
                                            <span className="text-xs">{service}</span>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                const newServices = services.filter((_, i) => i !== index);
                                                field.onChange(newServices);
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
                              <FormMessage className="text-xs mt-0.5" />
                            </FormItem>
                          );
                        }}
                      />
                    </div>
                    
                    {/* Footer */}
                    <DialogFooter className="border-t border-border dark:border-gray-800 pt-3 mt-3">
                      <div className="flex flex-col sm:flex-row w-full gap-2">
                        <div className="flex-1">
                          <p className="text-xs text-slate-500">
                            All fields marked with <span className="text-red-500">*</span> are required
                          </p>
                        </div>
                        
                        <div className="flex gap-2">
                          <Button 
                            type="button" 
                            variant="outline" 
                            size="sm"
                            onClick={() => setIsCreateDialogOpen(false)}
                            className="h-7 px-3 text-xs border-border dark:border-gray-700"
                          >
                            Cancel
                          </Button>
                          <Button 
                            type="submit" 
                            size="sm"
                            disabled={createContractorMutation.isPending}
                            className="h-7 px-3 text-xs bg-emerald-600 hover:bg-emerald-700 dark:bg-blue-700 dark:hover:bg-blue-800"
                          >
                            {createContractorMutation.isPending ? (
                              <>
                                <div className="animate-spin h-3 w-3 mr-1 border-2 border-white border-t-transparent rounded-full" />
                                Creating...
                              </>
                            ) : (
                              <>
                                <Plus className="w-3 h-3 mr-1" />
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
        </div>
      </div>

      {/* Enhanced Metrics Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="border border-border">
          <CardContent className="p-3">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Building2 className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Active Contractors</p>
                <p className="text-lg font-bold text-foreground">{activeContractors.length}</p>
                <p className="text-xs text-muted-foreground">
                  {approvedContractors.length} approved
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-border">
          <CardContent className="p-3">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <Award className="w-4 h-4 text-green-600" />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Average Rating</p>
                <p className="text-lg font-bold text-green-600">
                  {averageRating.toFixed(1)} ★
                </p>
                <p className="text-xs text-muted-foreground">
                  Across all
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-border">
          <CardContent className="p-3">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <CheckCircle className="w-4 h-4 text-purple-600" />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Jobs Completed</p>
                <p className="text-lg font-bold text-purple-600">{totalJobsCompleted}</p>
                <p className="text-xs text-muted-foreground">
                  Total jobs
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-border">
          <CardContent className="p-3">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-orange-100 rounded-lg">
                <TrendingUp className="w-4 h-4 text-orange-600" />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Categories</p>
                <p className="text-lg font-bold text-orange-600">{categories.length}</p>
                <p className="text-xs text-muted-foreground">
                  Service types
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Navigation Tabs */}
      <div className="border-b border-border">
        <nav className="-mb-px flex space-x-6">
          <button
            onClick={() => setActiveTab('contractors')}
            className={`py-2 px-0.5 border-b-2 font-medium text-sm ${
              activeTab === 'contractors'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Contractors
          </button>
          <button
            onClick={() => setActiveTab('categories')}
            className={`py-2 px-0.5 border-b-2 font-medium text-sm ${
              activeTab === 'categories'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Categories
          </button>
          <button
            onClick={() => setActiveTab('workorders')}
            className={`py-2 px-0.5 border-b-2 font-medium text-sm ${
              activeTab === 'workorders'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Work Orders
          </button>
        </nav>
      </div>

      {/* Enhanced Filters */}
      <Card className="border border-border shadow-sm rounded-lg">
        <CardContent className="p-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 text-muted-foreground w-3.5 h-3.5" />
                <Input
                  placeholder={`Search ${activeTab === 'contractors' ? 'contractors' : activeTab === 'categories' ? 'categories' : 'work orders'}...`}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 h-8 text-sm border-border dark:border-gray-700 focus:border-emerald-500 dark:focus:border-emerald-500 focus:ring-0"
                />
              </div>
            </div>
            {activeTab === 'contractors' && (
              <div className="flex flex-wrap gap-2">
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="w-32 h-8 text-xs border-border dark:border-gray-700">
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent className="border-border dark:border-gray-700">
                    <SelectItem value="all" className="text-xs">All Categories</SelectItem>
                    {(Array.isArray(categories) ? categories : []).map((category) => (
                      <SelectItem key={category.id} value={category.id.toString()} className="text-xs">
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-28 h-8 text-xs border-border dark:border-gray-700">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent className="border-border dark:border-gray-700">
                    <SelectItem value="all" className="text-xs">All Status</SelectItem>
                    <SelectItem value="active" className="text-xs">Active</SelectItem>
                    <SelectItem value="inactive" className="text-xs">Inactive</SelectItem>
                    <SelectItem value="suspended" className="text-xs">Suspended</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={vettingFilter} onValueChange={setVettingFilter}>
                  <SelectTrigger className="w-28 h-8 text-xs border-border dark:border-gray-700">
                    <SelectValue placeholder="Vetting" />
                  </SelectTrigger>
                  <SelectContent className="border-border dark:border-gray-700">
                    <SelectItem value="all" className="text-xs">All Vetting</SelectItem>
                    <SelectItem value="approved" className="text-xs">Approved</SelectItem>
                    <SelectItem value="pending" className="text-xs">Pending</SelectItem>
                    <SelectItem value="under_review" className="text-xs">Under Review</SelectItem>
                    <SelectItem value="rejected" className="text-xs">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {activeTab === 'categories' && (
              <div className="flex items-center">
                <span className="text-xs text-muted-foreground">
                  {filteredCategories.length} of {categories.length} categories
                </span>
              </div>
            )}
            {activeTab === 'workorders' && (
              <div className="flex items-center">
                <span className="text-xs text-muted-foreground">
                  {filteredWorkOrders.length} of {workOrders.length} work orders
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Active Filters */}
      {(activeTab === 'contractors' && 
        (categoryFilter !== 'all' || statusFilter !== 'all' || vettingFilter !== 'all' || searchTerm)) && (
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-xs text-muted-foreground">Filters:</span>
          {searchTerm && (
            <Badge variant="outline" className="flex items-center gap-1 px-1.5 py-0.5 text-xs">
              "{searchTerm}"
              <button onClick={() => setSearchTerm("")} className="text-muted-foreground hover:text-muted-foreground">
                <X className="w-3 h-3" />
              </button>
            </Badge>
          )}
          {categoryFilter !== 'all' && (
            <Badge variant="outline" className="flex items-center gap-1 px-1.5 py-0.5 text-xs">
              {categories.find(c => c.id.toString() === categoryFilter)?.name}
              <button onClick={() => setCategoryFilter("all")} className="text-muted-foreground hover:text-muted-foreground">
                <X className="w-3 h-3" />
              </button>
            </Badge>
          )}
          {statusFilter !== 'all' && (
            <Badge variant="outline" className="flex items-center gap-1 px-1.5 py-0.5 text-xs">
              {statusFilter}
              <button onClick={() => setStatusFilter("all")} className="text-muted-foreground hover:text-muted-foreground">
                <X className="w-3 h-3" />
              </button>
            </Badge>
          )}
          {vettingFilter !== 'all' && (
            <Badge variant="outline" className="flex items-center gap-1 px-1.5 py-0.5 text-xs">
              {vettingFilter.replace('_', ' ')}
              <button onClick={() => setVettingFilter("all")} className="text-muted-foreground hover:text-muted-foreground">
                <X className="w-3 h-3" />
              </button>
            </Badge>
          )}
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => {
              setSearchTerm("");
              setCategoryFilter("all");
              setStatusFilter("all");
              setVettingFilter("all");
            }}
            className="text-xs h-6 px-2"
          >
            Clear all
          </Button>
        </div>
      )}

      {/* Content based on active tab */}
      <Card className="border border-border shadow-sm overflow-hidden">
        <CardHeader className="px-4 py-3 border-b border-border">
          <CardTitle className="text-sm font-semibold">
            {activeTab === 'contractors' && 'Service Contractors'}
            {activeTab === 'categories' && 'Service Categories'}
            {activeTab === 'workorders' && 'Contractor Work Orders'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {activeTab === 'contractors' && (
            <>
              {contractorsLoading ? (
                <div className="flex justify-center items-center py-8">
                  <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
                </div>
              ) : (
                <div className="flex flex-col">
                  {/* Table with horizontal scroll only within card */}
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[800px] table-fixed">
                      <thead className="bg-muted">
                        <tr>
                          <th className="text-left py-2 px-3 text-xs font-semibold text-foreground border-b border-border w-[200px]">Company</th>
                          <th className="text-left py-2 px-3 text-xs font-semibold text-foreground border-b border-border w-[160px]">Contact</th>
                          <th className="text-left py-2 px-3 text-xs font-semibold text-foreground border-b border-border w-[130px]">Performance</th>
                          <th className="text-left py-2 px-3 text-xs font-semibold text-foreground border-b border-border w-[100px]">Rates(KES)</th>
                          <th className="text-left py-2 px-3 text-xs font-semibold text-foreground border-b border-border w-[140px]">Services</th>
                          <th className="text-left py-2 px-3 text-xs font-semibold text-foreground border-b border-border w-[110px]">Status</th>
                          <th className="text-left py-2 px-3 text-xs font-semibold text-foreground border-b border-border w-[50px]"></th>
                        </tr>
                      </thead>
                      <tbody className="bg-card divide-y divide-gray-100">
                        {currentContractors.length > 0 ? (
                          currentContractors.map((contractor) => {
                            const Icon = categoryIcons[contractor.category?.name as keyof typeof categoryIcons] || Building2;
                            const rating = Number(contractor.overallRating) || 0;
                            const slaScore = Number(contractor.slaAdherenceScore) || 0;
                            const hourlyRate = Number(contractor.hourlyRate) || 0;
                            const dailyRate = Number(contractor.dailyRate) || 0;
                            const services = contractor.servicesOffered || [];
                            
                            return (
                              <tr key={contractor.id} className="hover:bg-muted transition-colors">
                                {/* Company Column */}
                                <td className="py-2 px-3 text-xs border-b border-border align-top">
                                  <div className="flex items-start gap-2">
                                    <div className="flex-shrink-0 mt-0.5">
                                      <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center">
                                        <Icon className="w-3 h-3 text-blue-600" />
                                      </div>
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <p className="font-medium text-foreground truncate text-xs">
                                        {contractor.companyName || 'N/A'}
                                      </p>
                                      <p className="text-xs text-muted-foreground truncate">
                                        {contractor.contactPerson || 'N/A'}
                                      </p>
                                      <p className="text-xs text-muted-foreground truncate">
                                        {contractor.category?.name || 'N/A'}
                                      </p>
                                    </div>
                                  </div>
                                </td>
                                
                                {/* Contact Column */}
                                <td className="py-2 px-3 text-xs border-b border-border align-top">
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-1.5">
                                      <Mail className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                                      <span className="text-foreground truncate block text-xs" title={contractor.email || 'N/A'}>
                                        {contractor.email || 'N/A'}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      <Phone className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                                      <span className="text-muted-foreground truncate block text-xs">{contractor.phone || 'N/A'}</span>
                                    </div>
                                  </div>
                                </td>
                                
                                {/* Performance Column */}
                                <td className="py-2 px-3 text-xs border-b border-border align-top">
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-1.5">
                                      <div className="flex items-center">
                                        {[1, 2, 3, 4, 5].map((star) => (
                                          <Star
                                            key={star}
                                            className={`w-3 h-3 ${
                                              star <= Math.round(rating)
                                                ? 'fill-yellow-400 text-yellow-400'
                                                : 'fill-gray-200 text-gray-200'
                                            }`}
                                          />
                                        ))}
                                      </div>
                                      <span className={`font-medium text-xs ${getRatingColor(rating)}`}>
                                        {rating.toFixed(1)}
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between text-xs">
                                      <span className="text-muted-foreground truncate text-xs" title={`${contractor.totalJobsCompleted || 0} jobs`}>
                                        {contractor.totalJobsCompleted || 0} jobs
                                      </span>
                                      <span 
                                        className={`px-1 py-0.5 rounded text-xs ${
                                          slaScore >= 95 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 
                                          slaScore >= 80 ? 'bg-blue-50 text-blue-700 border border-blue-200' : 
                                          'bg-red-50 text-red-700 border border-red-200'
                                        }`}
                                      >
                                        {slaScore}% SLA
                                      </span>
                                    </div>
                                  </div>
                                </td>

                                {/* Rates Column */}
                                <td className="py-2 px-3 text-xs border-b border-border align-top">
                                  <div className="space-y-1">
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs text-muted-foreground">Hourly</span>
                                      <span className="text-xs font-medium ml-1">
                                        {hourlyRate.toLocaleString()}
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs text-muted-foreground">Daily</span>
                                      <span className="text-xs font-medium ml-1">
                                        {dailyRate.toLocaleString()}
                                      </span>
                                    </div>
                                  </div>
                                </td>
                                
                                {/* Services Column */}
                                <td className="py-2 px-3 text-xs border-b border-border align-top">
                                  <div className="flex flex-wrap gap-1">
                                    {services.slice(0, 2).map((service, index) => (
                                      <span
                                        key={index}
                                        className="px-1 py-0.5 bg-muted text-foreground rounded text-xs border border-border truncate max-w-[80px]"
                                        title={service}
                                      >
                                        {service}
                                      </span>
                                    ))}
                                    {services.length > 2 && (
                                      <span 
                                        className="px-1 py-0.5 bg-muted text-muted-foreground rounded text-xs"
                                        title={`${services.length - 2} more services`}
                                      >
                                        +{services.length - 2}
                                      </span>
                                    )}
                                    {services.length === 0 && (
                                      <span className="text-xs text-muted-foreground italic">No services</span>
                                    )}
                                  </div>
                                </td>
                                
                                {/* Status Column */}
                                <td className="py-2 px-3 text-xs border-b border-border align-top">
                                  <div className="space-y-1">
                                    <div 
                                      className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${
                                        (contractor.status || '') === 'active' 
                                          ? 'bg-green-50 text-green-700 border border-green-200' 
                                          : 'bg-muted text-foreground border border-border'
                                      }`}
                                    >
                                      <div className={`w-1 h-1 rounded-full mr-1 flex-shrink-0 ${
                                        (contractor.status || '') === 'active' ? 'bg-green-500' : 'bg-gray-400'
                                      }`} />
                                      <span className="text-xs">
                                        {(contractor.status || 'inactive').charAt(0).toUpperCase() + (contractor.status || 'inactive').slice(1)}
                                      </span>
                                    </div>
                                    <div 
                                      className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${
                                        getVettingStatusColor(contractor.vettingStatus || 'pending')
                                      }`}
                                    >
                                      <span className="text-xs">
                                        {(contractor.vettingStatus || 'pending').replace('_', ' ')}
                                      </span>
                                    </div>
                                  </div>
                                </td>
                                
                                {/* Actions Column */}
                                <td className="py-2 px-3 text-xs border-b border-border align-top">
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 w-6 p-0 hover:bg-muted"
                                      >
                                        <MoreVertical className="h-3.5 w-3.5 text-muted-foreground" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="w-40 border-border shadow-lg bg-card">
                                      <DropdownMenuItem 
                                        onClick={() => navigate(`/contractors/${contractor.id}`)}
                                        className="text-xs cursor-pointer py-1.5"
                                      >
                                        <Eye className="mr-2 h-3 w-3 text-muted-foreground" />
                                        View Details
                                      </DropdownMenuItem>
                                      <DropdownMenuItem 
                                        onClick={() => handleEditContractor(contractor)}
                                        className="text-xs cursor-pointer py-1.5"
                                      >
                                        <Edit className="mr-2 h-3 w-3 text-muted-foreground" />
                                        Edit
                                      </DropdownMenuItem>
                                      <DropdownMenuItem 
                                        onClick={() => handleExportContractor(contractor)}
                                        className="text-xs cursor-pointer py-1.5"
                                      >
                                        <FileText className="mr-2 h-3 w-3 text-muted-foreground" />
                                        Export
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan={7} className="py-8 px-3 text-center">
                              <div className="w-12 h-12 mx-auto mb-2 bg-muted rounded-full flex items-center justify-center">
                                <Building2 className="w-6 h-6 text-muted-foreground" />
                              </div>
                              <p className="text-foreground font-medium text-sm mb-1">
                                {searchTerm || categoryFilter !== 'all' || statusFilter !== 'all' || vettingFilter !== 'all'
                                  ? "No contractors match your filters"
                                  : "No contractors found"
                                }
                              </p>
                              <p className="text-muted-foreground text-xs">
                                {searchTerm || categoryFilter !== 'all' || statusFilter !== 'all' || vettingFilter !== 'all'
                                  ? "Try adjusting your search criteria"
                                  : "Add your first service contractor"
                                }
                              </p>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  
                  {/* Pagination */}
                  {filteredContractors.length > 0 && (
                    <div className="flex flex-col sm:flex-row items-center justify-between px-3 py-2 border-t border-border bg-muted/30 text-xs">
                      <div className="flex items-center space-x-2 mb-2 sm:mb-0">
                        <span className="text-muted-foreground">Show</span>
                        <Select
                          value={rowsPerPage.toString()}
                          onValueChange={(value) => {
                            setRowsPerPage(Number(value));
                            setCurrentPage(1);
                          }}
                        >
                          <SelectTrigger className="h-6 w-16 text-xs border-border">
                            <SelectValue placeholder="10" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="5" className="text-xs">5</SelectItem>
                            <SelectItem value="10" className="text-xs">10</SelectItem>
                            <SelectItem value="20" className="text-xs">20</SelectItem>
                          </SelectContent>
                        </Select>
                        <span className="text-muted-foreground">entries</span>
                      </div>
                      
                      <div className="text-muted-foreground text-xs">
                        {indexOfFirstRow + 1}-{Math.min(indexOfLastRow, filteredContractors.length)} of {filteredContractors.length}
                      </div>
                      
                      <div className="flex items-center space-x-1 mt-2 sm:mt-0">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                          disabled={currentPage === 1}
                          className="h-6 px-2 text-xs border-border"
                        >
                          Prev
                        </Button>
                        
                        {Array.from({ length: Math.min(3, totalPages) }, (_, i) => {
                          let pageNum;
                          if (totalPages <= 3) {
                            pageNum = i + 1;
                          } else if (currentPage === 1) {
                            pageNum = i + 1;
                          } else if (currentPage === totalPages) {
                            pageNum = totalPages - 2 + i;
                          } else {
                            pageNum = currentPage - 1 + i;
                          }
                          
                          return (
                            <Button
                              key={pageNum}
                              variant={currentPage === pageNum ? "default" : "outline"}
                              size="sm"
                              onClick={() => setCurrentPage(pageNum)}
                              className={`h-6 min-w-6 p-0 text-xs ${
                                currentPage === pageNum 
                                  ? "bg-blue-600 hover:bg-blue-700" 
                                  : "border-border hover:bg-muted"
                              }`}
                            >
                              {pageNum}
                            </Button>
                          );
                        })}
                        
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                          disabled={currentPage === totalPages}
                          className="h-6 px-2 text-xs border-border"
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          {activeTab === 'categories' && (
            <div className="p-3">
              {categoriesLoading ? (
                <div className="flex justify-center items-center py-8">
                  <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
                </div>
              ) : (
                <>
                  {filteredCategories.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {filteredCategories.map((category) => {
                        const Icon = categoryIcons[category.name as keyof typeof categoryIcons] || Building2;
                        const contractorCount = contractors.filter(c => c.categoryId === category.id).length;
                        const isActive = category.isActive !== false;
                        
                        return (
                          <Card key={category.id} className={`border border-border ${!isActive ? 'opacity-80' : ''}`}>
                            <CardContent className="p-3">
                              <div className="flex items-start justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <div className={`p-1.5 rounded-lg ${isActive ? 'bg-blue-50' : 'bg-muted'}`}>
                                    <Icon className={`w-4 h-4 ${isActive ? 'text-blue-600' : 'text-muted-foreground'}`} />
                                  </div>
                                  <div>
                                    <h3 className="font-medium text-foreground text-xs">{category.name}</h3>
                                    <span className="text-xs text-muted-foreground">
                                      {contractorCount} contractor{contractorCount !== 1 ? 's' : ''}
                                    </span>
                                  </div>
                                </div>
                                <Badge variant={isActive ? "default" : "secondary"} className="text-[10px] h-4 px-1">
                                  {isActive ? 'Active' : 'Inactive'}
                                </Badge>
                              </div>
                              
                              {category.description && (
                                <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
                                  {category.description}
                                </p>
                              )}
                              
                              {(category.defaultHourlyRate || category.defaultDailyRate) && (
                                <div className="mb-2 p-2 rounded-md bg-muted border border-border">
                                  <p className="text-[10px] font-medium text-muted-foreground mb-1">Default Rates</p>
                                  <div className="flex flex-wrap gap-2">
                                    {category.defaultHourlyRate && category.defaultHourlyRate > 0 && (
                                      <div className="flex items-center gap-1">
                                        <Clock className="w-3 h-3 text-muted-foreground" />
                                        <span className="text-xs font-medium">
                                          KES {category.defaultHourlyRate.toLocaleString()}<span className="text-[10px] text-muted-foreground">/hr</span>
                                        </span>
                                      </div>
                                    )}
                                    {category.defaultDailyRate && category.defaultDailyRate > 0 && (
                                      <div className="flex items-center gap-1">
                                        <Calendar className="w-3 h-3 text-muted-foreground" />
                                        <span className="text-xs font-medium">
                                          KES {category.defaultDailyRate.toLocaleString()}<span className="text-[10px] text-muted-foreground">/day</span>
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                              
                              <div className="flex justify-between items-center pt-2 border-t border-border">
                                <span className="text-[10px] text-muted-foreground">ID: {category.id}</span>
                                <div className="flex gap-1">
                                  <Button size="sm" variant="ghost" onClick={() => handleEditCategory(category)} className="h-5 px-2 text-[10px]">
                                    <Edit className="w-3 h-3 mr-1" />
                                    Edit
                                  </Button>
                                  <Button
                                    size="sm" 
                                    variant="ghost"
                                    onClick={() => handleDeleteCategory(category.id)}
                                    disabled={deleteCategoryMutation.isPending || contractorCount > 0}
                                    className="h-5 px-2 text-[10px] text-red-600 hover:text-red-700 hover:bg-red-50"
                                  >
                                    <Trash2 className="w-3 h-3 mr-1" />
                                    Delete
                                  </Button>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <div className="p-3 rounded-full bg-muted w-12 h-12 mx-auto mb-2 flex items-center justify-center">
                        <Building2 className="w-6 h-6 text-muted-foreground" />
                      </div>
                      <h3 className="text-sm font-medium text-foreground mb-1">
                        {searchTerm ? "No matching categories" : "No Service Categories"}
                      </h3>
                      <p className="text-xs text-muted-foreground mb-3">
                        {searchTerm ? "Try adjusting your search" : "Create your first category"}
                      </p>
                      {searchTerm ? (
                        <Button onClick={() => setSearchTerm("")} variant="outline" size="sm" className="h-7 text-xs">
                          Clear search
                        </Button>
                      ) : (
                        <Button 
                          onClick={() => {
                            setEditingCategory(null);
                            categoryForm.reset();
                            setIsCategoryDialogOpen(true);
                          }}
                          size="sm"
                          className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
                        >
                          <Plus className="w-3 h-3 mr-1" />
                          Create Category
                        </Button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          {activeTab === 'workorders' && (
            <div className="p-3">
              {workOrdersLoading ? (
                <div className="flex justify-center items-center py-8">
                  <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
                </div>
              ) : (
                <DataTable
                  data={filteredWorkOrders}
                  columns={workOrderColumns}
                />
              )}
            </div>
          )}
        </CardContent>
      </Card>
      <CategoryManagementModal
        isCategoryDialogOpen={isCategoryDialogOpen}
        setIsCategoryDialogOpen={setIsCategoryDialogOpen}
        editingCategory={editingCategory}
        categoryForm={categoryForm}
        serviceInput={serviceInput}
        setServiceInput={setServiceInput}
        certificationInput={certificationInput}
        setCertificationInput={setCertificationInput}
        createCategoryMutation={createCategoryMutation}
        updateCategoryMutation={updateCategoryMutation}
        handleCategorySubmit={handleCategorySubmit}
      />
    </div>
  );
}