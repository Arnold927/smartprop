import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, Calendar, DollarSign, User, Home, Building, Clock, CheckCircle, XCircle, AlertCircle, Wrench, MessageSquare,
  Paperclip, Send, Download, Printer, MoreVertical, Edit, Trash2, ExternalLink, Phone, Mail, MapPin,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import StatusBadge from "@/components/ui/status-badge";
import { Progress } from "@/components/ui/progress";
import { WorkOrderCostModal } from "@/components/work-order-cost-modal";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";

interface MaintenanceRequest {
  id: number;
  ticketNumber: string;
  title: string;
  description: string;
  tenantId?: number;
  unitId?: number;
  propertyId?: number;
  category: string;
  priority: "low" | "medium" | "high" | "urgent";
  status: "pending" | "assigned" | "in_progress" | "completed" | "cancelled";
  estimatedCost?: string;
  actualCost?: string;
  currency?: string;
  scheduledDate?: string;
  completedDate?: string;
  assignedTo?: string;
  createdAt: string;
  updatedAt: string;
  tenant?: {
    id: number;
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
  };
  unit?: {
    id: number;
    unitNumber: string;
    propertyId: number;
  };
  property?: {
    id: number;
    name: string;
    address?: string;
  };
  technician?: {
    id: string;
    name: string;
    email?: string;
    phone?: string;
  };
  internalNotes?: string;
}

interface Comment {
  id: number;
  content: string;
  authorId: string | number;
  authorName: string;
  createdAt: string;
  isTechnician: boolean;
}


interface Document {
  id: number;
  name: string;
  type: string;
  url: string;
  size: number;
  uploadedBy: {
    id: string;
    name: string;
  };
  createdAt: string;
}

interface StaffMember {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  department: "maintenance" | "security" | "cleaning" | "administrative";
  role?: string;
  isActive: boolean;
  hireDate?: string;
}

export default function MaintenanceDetails() {
  const { id } = useParams<{ id: string }>();
  const [location, setLocation] = useLocation();
  const [newComment, setNewComment] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  // BUG 8 FIX: Removed unused materials/charges/nextId useState — the modal manages its own state.
  // workOrderId is resolved lazily from the linked work order for the cost modal.
  const [workOrderId, setWorkOrderId] = useState<number | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);


  // Fetch maintenance request details
  // BUG 1 FIX: The response from GET /api/maintenance-requests/:id is a plain object,
  // not wrapped in { tenants: [...] }. Return data directly (falling back to data.data
  // for any generic wrapper, but never defaulting to []).
  const { data: request, isLoading } = useQuery<MaintenanceRequest>({
    queryKey: [`/api/maintenance-requests/${id}`],
    queryFn: async () => {
      const response = await apiRequest(`/api/maintenance-requests/${id}`);
      const data = await response.json();
      // The single-record endpoint returns a plain object. Handle any generic
      // { data: ... } wrapper but do NOT fall back to [] (that was the bug).
      return Array.isArray(data) ? data[0] : (data.data ?? data);
    },
    enabled: !!id,
  });

  const parsedInternalNotes: Comment[] = (() => {
    try {
      return JSON.parse(request?.internalNotes || "[]");
    } catch {
      return [];
    }
  })();


  // BUG 2 FIX: /api/staff-members does not accept a ?departments= filter — remove it.
  // Client-side filtering by department is done below when rendering the select.
  const { data: staffMembers = [], isLoading: isLoadingStaff } = useQuery({
    queryKey: [`/api/staff-members`],
    queryFn: async () => {
      const response = await apiRequest('/api/staff-members');
      const data = await response.json();

      if (Array.isArray(data)) {
        return data;
      }

      if (data.staff && Array.isArray(data.staff)) {
        return data.staff;
      }

      if (data.data && Array.isArray(data.data)) {
        return data.data;
      }

      if (typeof data === 'string') {
        try {
          const parsed = JSON.parse(data);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }

      return [];
    },
  });

  // BUG 3 FIX: tenant default changed from [] to null — it is a single object,
  // not an array. Calling .firstName on [] crashes.
  const { data: tenant = null, isLoading: isLoadingTenant } = useQuery({
    queryKey: [`/api/tenants/${request?.tenantId}`],
    queryFn: async () => {
      if (!request?.tenantId) return null;
      const response = await apiRequest(`/api/tenants/${request.tenantId}`);
      return response.json();
    },
    enabled: !!request?.tenantId,
  });

  // BUG 4 FIX: unit default changed from [] to null — same reason as tenant.
  const { data: unit = null } = useQuery({
    queryKey: [`/api/units/${request?.unitId}`],
    queryFn: async () => {
      if (!request?.unitId) return null;
      const response = await apiRequest(`/api/units/${request.unitId}`);
      return response.json();
    },
    enabled: !!request?.unitId,
  });

  // Fetch property
  const { data: property = null } = useQuery({
    queryKey: [`/api/properties/${unit?.propertyId}`],
    queryFn: async () => {
      if (!unit?.propertyId) return null;
      const response = await apiRequest(`/api/properties/${unit.propertyId}`);
      return response.json();
    },
    enabled: !!unit?.propertyId,
  });




  // Fetch comments
  const { data: comments = [], isLoading: isLoadingComments } = useQuery<Comment[]>({
    queryKey: [`/api/maintenance-requests/${id}/comments`],
    queryFn: async () => {
      const response = await apiRequest(`/api/maintenance-requests/${id}/comments`);
      return response.json();
    },
    enabled: !!id,
  });

  const commentTenantIds = [
    ...new Set(comments.map(c => c.authorId))
  ];

  // Step 1: Get all author IDs from comments + internal notes
  const allAuthorIds = [
    ...new Set([...parsedInternalNotes.map(c => c.authorId), ...(Array.isArray(comments) ? comments : []).map(c => c.authorId)])
  ];

  // Step 2: Separate by type
  const userIds = allAuthorIds.filter(id => typeof id === "string"); // UUIDs for users
  const tenantIds = allAuthorIds.filter(id => typeof id === "number"); // integers for tenants

  // Step 3: Fetch all authors at once
  const { data: authors = [] } = useQuery({
    queryKey: ["authors", allAuthorIds],
    queryFn: async () => {
      const results = await Promise.all(
        allAuthorIds.map(id =>
          typeof id === "string"
            ? apiRequest(`/api/users/${id}`).then(r => r.json())
            : apiRequest(`/api/tenants/${id}`).then(r => r.json())
        )
      );
      return results;
    },
    enabled: allAuthorIds.length > 0,
  });


  // Step 4: Build a robust map
  const authorMap = (authors || []).reduce((acc: Record<string | number, string>, a: any) => {
    const first = a.first_name ?? a.firstName ?? "";
    const last = a.last_name ?? a.lastName ?? "";
    acc[a.id] = [first, last].filter(Boolean).join(" ") || a.name || "Unknown";
    return acc;
  }, {} as Record<string | number, string>);




  const { data: commentTenants = [] } = useQuery({
    queryKey: ['comment-tenants', commentTenantIds],
    queryFn: async () => {
      const response = await apiRequest(
        `/api/tenants?ids=${commentTenantIds.join(',')}`
      );
      return response.json(); // [{ id, firstName, lastName }]
    },
    enabled: commentTenantIds.length > 0,
  });

  const tenantMap = commentTenants?.reduce((acc: Record<string, string>, t: any) => {
    acc[t.id] = `${t.firstName} ${t.lastName}`;
    return acc;
  }, {}) || {};

  // Merge both maps into one
  const combinedAuthorMap = { ...authorMap, ...tenantMap };

  // Enrich comments using combined map
  const enrichedComments = (Array.isArray(comments) ? comments : []).map(c => ({
    ...c,
    authorName: combinedAuthorMap[c.authorId] || "Unknown",
  }));




  // Fetch documents
  const { data: documents = [], isLoading: isLoadingDocuments } = useQuery<Document[]>({
    queryKey: [`/api/maintenance-requests/${id}/documents`],
    queryFn: async () => {
      const response = await apiRequest(`/api/maintenance-requests/${id}/documents`);
      return response.json();
    },
    enabled: !!id,
  });

  // BUG 5 FIX: Only include assignedTo in the payload when it is explicitly provided.
  // Sending assignedTo: undefined serialises to nothing in JSON.stringify but can
  // still fail certain schema validators. We explicitly omit the key instead.
  // BUG 6 FIX: "scheduled" is not a valid status enum value. When assigning a
  // technician, use "assigned" (the correct enum member).
  const updateStatusMutation = useMutation({
    mutationFn: async ({ status, assignedTo }: { status: string; assignedTo?: string | null }) => {
      const payload: Record<string, unknown> = { status };

      // Only add assignedTo when the caller explicitly passes it.
      // Pass null to clear the assignment; omit entirely when not touching it.
      if (assignedTo !== undefined) {
        payload.assignedTo = assignedTo ?? null;
      }

      const response = await apiRequest(`/api/maintenance-requests/${id}`, {
        method: "PUT",
        data: payload,
        headers: {
          "Content-Type": "application/json",
        },
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/maintenance-requests/${id}`] });
      toast({
        title: "Success",
        description: "Status updated successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update status",
        variant: "destructive",
      });
    },
  });

  // Add approval mutation
  const approveRequestMutation = useMutation({
    mutationFn: async ({ approvalStatus, comments, approvedAmount }: {
      approvalStatus: string;
      comments?: string;
      approvedAmount?: string
    }) => {
      const response = await apiRequest(`/api/maintenance-requests/${id}/approve`, {
        method: "POST",
        data: { approvalStatus, comments, approvedAmount },
        headers: {
          "Content-Type": "application/json",
        },
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/maintenance-requests/${id}`] });
      toast({
        title: "Success",
        description: "Request approved successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to approve request",
        variant: "destructive",
      });
    },
  });

  // Add comment mutation
  const addCommentMutation = useMutation({
    mutationFn: async (content: string) => {
      const response = await apiRequest(`/api/maintenance-requests/${id}/comments`, {
        method: "POST",
        data: { content },
        headers: {
          "Content-Type": "application/json",
        },
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/maintenance-requests/${id}/comments`] });
      setNewComment("");
      toast({
        title: "Success",
        description: "Comment added successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add comment",
        variant: "destructive",
      });
    },
  });

  // Delete request mutation
  const deleteRequestMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest(`/api/maintenance-requests/${id}`, {
        method: "DELETE",
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Maintenance request deleted successfully",
      });
      setLocation("/maintenance");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete maintenance request",
        variant: "destructive",
      });
    },
  });

  // Format currency
  const formatCurrency = (amount?: string, currency = "Ksh") => {
    if (!amount) return "Not specified";
    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount)) return amount;
    return new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(numericAmount);
  };

  // Get priority badge color
  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "urgent":
        return "bg-red-50 text-red-700 border-red-200";
      case "high":
        return "bg-orange-50 text-orange-700 border-orange-200";
      case "medium":
        return "bg-blue-50 text-blue-700 border-blue-200";
      case "low":
        return "bg-muted text-foreground border-border";
      default:
        return "bg-muted text-foreground";
    }
  };

  // Get status icon
  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "cancelled":
        return <XCircle className="h-4 w-4 text-muted-foreground" />;
      case "in_progress":
        return <Clock className="h-4 w-4 text-blue-500" />;
      case "assigned":
        return <User className="h-4 w-4 text-amber-500" />;
      case "pending":
        return <Clock className="h-4 w-4 text-muted-foreground" />;
      default:
        return null;
    }
  };

  // Get status color
  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-green-50 text-green-700 border-green-200";
      case "cancelled":
        return "bg-muted text-foreground border-border";
      case "in_progress":
        return "bg-blue-50 text-blue-700 border-blue-200";
      case "assigned":
        return "bg-amber-50 text-amber-700 border-amber-200";
      case "pending":
        return "bg-muted text-foreground border-border";
      default:
        return "bg-muted text-foreground";
    }
  };

  // Calculate days since creation
  const getDaysSinceCreation = () => {
    if (!request?.createdAt) return 0;
    const createdDate = new Date(request.createdAt);
    const today = new Date();
    const diffTime = Math.abs(today.getTime() - createdDate.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  // Handle status change
  const handleStatusChange = (status: string) => {
    updateStatusMutation.mutate({ status });
  };

  // BUG 6 FIX: Use "assigned" (valid enum) instead of "scheduled" (not in schema).
  const handleAssignTechnician = (technicianId: string) => {
    updateStatusMutation.mutate({ status: "assigned", assignedTo: technicianId });
  };

  // Handle add comment
  const handleAddComment = () => {
    if (newComment.trim()) {
      addCommentMutation.mutate(newComment.trim());
    }
  };

  // Handle delete request
  const handleDeleteRequest = () => {
    if (confirm("Are you sure you want to delete this maintenance request? This action cannot be undone.")) {
      deleteRequestMutation.mutate();
    }
  };

  // BUG 7 FIX: Resolve the actual work order ID that belongs to this maintenance
  // request, rather than passing the maintenance request's own ID to the cost modal.
  // BUG 8 FIX: The materials/charges state in [id].tsx is removed — the modal owns
  // that state internally. This effect only resolves the workOrderId for the modal.
  useEffect(() => {
    if (!id) return;
    async function resolveWorkOrderId() {
      const res = await apiRequest(`/api/work-orders?maintenanceRequestId=${id}`);
      if (!res.ok) return;
      const data = await res.json();
      const list = data.results ?? (Array.isArray(data) ? data : []);
      if (list.length > 0) {
        setWorkOrderId(list[0].id);
      }
    }
    resolveWorkOrderId();
  }, [id]);


  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center space-x-4">
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-8 w-64 rounded-lg" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="h-[400px] lg:col-span-2 rounded-xl" />
          <Skeleton className="h-[400px] rounded-xl" />
        </div>
      </div>
    );
  }
  if (!request) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <Wrench className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">Maintenance request not found</h3>
          <p className="text-muted-foreground mb-4">The maintenance request you're looking for doesn't exist or has been removed.</p>
          <Button asChild variant="outline" className="border-border">
            <Link to="/maintenance">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Maintenance
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <Button variant="ghost" size="sm" asChild className="hover:bg-muted border border-border">
            <Link to="/maintenance">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">
              {request.title}
            </h1>
            <div className="flex items-center space-x-3 mt-1">
              <span className="text-sm font-medium text-foreground">
                Ticket #{request.ticketNumber}
              </span>
              <Badge className={cn("capitalize", getPriorityColor(request.priority))}>
                {request.priority} Priority
              </Badge>
              <div className="flex items-center space-x-2">
                {getStatusIcon(request.status)}
                <Badge className={cn("capitalize", getStatusColor(request.status))}>
                  {request.status?.replace('_', ' ')}
                </Badge>
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <Button variant="outline" size="sm" className="border-border hover:bg-muted">
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
          <Button variant="outline" size="sm" className="border-border hover:bg-muted">
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="border-border hover:bg-muted">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 border-border">
              <DropdownMenuItem>
                <Edit className="mr-2 h-4 w-4" />
                Edit Request
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={handleDeleteRequest}>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Request
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card className="border-border hover:border-border transition-colors">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Days Open</p>
                <p className="text-2xl font-semibold text-foreground mt-1">
                  {getDaysSinceCreation()} days
                </p>
                <p className="text-xs text-muted-foreground mt-1">since creation</p>
              </div>
              <div className="p-3 bg-blue-50 rounded-lg">
                <Calendar className="h-6 w-6 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border hover:border-border transition-colors">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Estimated Cost</p>
                <p className="text-2xl font-semibold text-foreground mt-1">
                  {formatCurrency(request.estimatedCost, request.currency)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">budgeted amount</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border hover:border-border transition-colors">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Assigned To</p>
                <p className="text-2xl font-semibold text-foreground mt-1">
                  {request.assignedTo ? (
                    (() => {
                      const assignedStaff = staffMembers.find((s: any) => s.id?.toString() === request.assignedTo);
                      if (assignedStaff) {
                        const firstName = assignedStaff.first_name || assignedStaff.firstName || '';
                        const lastName = assignedStaff.last_name || assignedStaff.lastName || '';
                        return `${firstName} ${lastName}`.trim();
                      }
                      return request.technician?.name || "Technician";
                    })()
                  ) : "Unassigned"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {request.assignedTo ? (
                    <>
                      <span className="text-green-600 font-medium">● Assigned</span>
                      {request.status && ` • ${request.status.replace('_', ' ')}`}
                    </>
                  ) : (
                    "Awaiting assignment"
                  )}
                </p>
              </div>
              <div className={`p-3 rounded-lg ${request.assignedTo ? 'bg-green-50' : 'bg-muted'}`}>
                <User className={`h-6 w-6 ${request.assignedTo ? 'text-green-600' : 'text-muted-foreground'}`} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Details & Updates */}
        <div className="lg:col-span-2 space-y-6">
          {/* Request Details */}
          <Card className="border-border">
            <CardHeader>
              <CardTitle>Request Details</CardTitle>
              <CardDescription>Description and additional information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-2">Description</h4>
                <p className="text-foreground whitespace-pre-line">{request.description}</p>
              </div>

              <Separator className="bg-muted" />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-3">Timeline</h4>
                  <dl className="space-y-3">
                    <div>
                      <dt className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Created</dt>
                      <dd className="text-sm font-medium text-foreground">
                        {new Date(request.createdAt).toLocaleString()}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Last Updated</dt>
                      <dd className="text-sm font-medium text-foreground">
                        {new Date(request.updatedAt).toLocaleString()}
                      </dd>
                    </div>
                    {request.scheduledDate && (
                      <div>
                        <dt className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Scheduled Date</dt>
                        <dd className="text-sm font-medium text-foreground">
                          {new Date(request.scheduledDate).toLocaleDateString()}
                        </dd>
                      </div>
                    )}
                    {request.completedDate && (
                      <div>
                        <dt className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Completed Date</dt>
                        <dd className="text-sm font-medium text-foreground">
                          {new Date(request.completedDate).toLocaleDateString()}
                        </dd>
                      </div>
                    )}
                  </dl>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-3">Financials</h4>
                  <dl className="space-y-3">
                    <div>
                      <dt className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Estimated Cost</dt>
                      <dd className="text-sm font-medium text-foreground">
                        {formatCurrency(request.estimatedCost, request.currency)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Actual Cost</dt>
                      <dd className="text-sm font-medium text-foreground">
                        {request.actualCost
                          ? formatCurrency(request.actualCost, request.currency)
                          : "Not recorded"
                        }
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Cost Difference</dt>
                      <dd className="text-sm font-medium text-foreground">
                        {request.estimatedCost && request.actualCost
                          ? formatCurrency(
                            (parseFloat(request.actualCost) - parseFloat(request.estimatedCost)).toString(),
                            request.currency
                          )
                          : "N/A"
                        }
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Comments/Updates */}
          <Card className="border-border">
            <CardHeader>
              <CardTitle>Updates & Comments</CardTitle>
              <CardDescription>Communications and progress updates</CardDescription>
            </CardHeader>
            <CardContent>
              {/* Comments List */}
              {isLoadingComments ? (
                <div className="space-y-4">
                  {[1, 2, 3].map(i => (
                    <Skeleton key={i} className="h-20 w-full rounded-lg" />
                  ))}
                </div>
              ) : comments.length > 0 ? (
                <div className="space-y-4 mb-6">
                  {enrichedComments.map((comment) => (
                    <div key={comment.id} className="flex space-x-3">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback>
                          {comment.authorName
                            .split(" ")
                            .map((n: any) => n[0])
                            .join("")}
                        </AvatarFallback>
                      </Avatar>

                      <div className="flex-1">
                        <div className="bg-muted rounded-lg p-3">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium text-foreground">
                              {comment.authorName}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {new Date(comment.createdAt).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-sm text-foreground">{comment.content}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 mb-6">
                  <MessageSquare className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
                  <p className="text-sm text-muted-foreground">No comments yet</p>
                </div>
              )}

              {/* Add Comment */}
              <div className="space-y-2">
                <Label htmlFor="comment">Add Comment</Label>
                <Textarea
                  id="comment"
                  placeholder="Add an update or comment..."
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  className="min-h-[100px] border-border"
                />
                <div className="flex justify-between items-center">
                  <Button variant="ghost" size="sm" className="text-muted-foreground">
                    <Paperclip className="h-4 w-4 mr-2" />
                    Attach File
                  </Button>
                  <Button
                    onClick={handleAddComment}
                    disabled={!newComment.trim() || addCommentMutation.isPending}
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    <Send className="h-4 w-4 mr-2" />
                    Post Comment
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Sidebar */}
        <div className="space-y-6">
          {/* Status & Actions */}
          <Card className="border-border">
            <CardHeader>
              <CardTitle>Status & Actions</CardTitle>
              {request.assignedTo && (
                <CardDescription className="flex items-center space-x-2">
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200" >
                    <User className="h-3 w-3 mr-1" />
                    Assigned
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    to {staffMembers.find((s: any) => s.id?.toString() === request.assignedTo)?.firstName || "Technician"}
                  </span>
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Update Status */}
              <div>
                <Label htmlFor="status">Update Status</Label>
                <Select
                  value={request.status}
                  onValueChange={(value) => handleStatusChange(value)}
                  disabled={updateStatusMutation.isPending}
                >
                  <SelectTrigger className="border-border">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent className="border-border shadow-md">
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="assigned">Assigned</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Assign Technician */}
              {/* BUG 6 FIX: use "assigned" (valid enum) not "scheduled" */}
              <div>
                <Label htmlFor="assignedTo">
                  Assign Technician
                  {request.assignedTo && (
                    <span className="ml-2 text-xs font-normal text-green-600">
                      ✓ Currently assigned
                    </span>
                  )}
                </Label>

                <Select
                  value={request.assignedTo || ""}
                  onValueChange={(value) => {
                    updateStatusMutation.mutate({
                      status: value ? "assigned" : "pending",
                      assignedTo: value || null,
                    });
                  }}
                  disabled={updateStatusMutation.isPending || isLoadingStaff}
                >
                  <SelectTrigger className={`border-border ${request.assignedTo ? 'dark:bg-green-900/20 bg-green-50 border-green-200' : ''}`}>
                    {request.assignedTo ? (
                      <div className="flex items-center">
                        <User className="h-4 w-4 mr-2 text-green-600" />
                        <span className="font-medium text-green-800">
                          {(() => {
                            const assignedStaff = staffMembers.find((s: any) => s.id?.toString() === request.assignedTo);
                            if (assignedStaff) {
                              const firstName = assignedStaff.first_name || assignedStaff.firstName || '';
                              const lastName = assignedStaff.last_name || assignedStaff.lastName || '';
                              return `${firstName} ${lastName}`.trim();
                            }
                            return "Technician";
                          })()}
                        </span>
                      </div>
                    ) : (
                      <SelectValue placeholder="Select technician" />
                    )}
                  </SelectTrigger>
                  <SelectContent className="border-border shadow-md max-h-[300px]">
                    {isLoadingStaff ? (
                      <SelectItem value="loading" disabled className="text-muted-foreground">
                        Loading technicians...
                      </SelectItem>
                    ) : (Array.isArray(staffMembers) ? staffMembers : []).filter((staff: any) => {
                      // BUG 2 FIX: filter client-side since the API returns all staff.
                      const department = staff.department?.toString().toLowerCase() || '';
                      const cleanDepartment = department.replace(/[{}]/g, '').toLowerCase();
                      return cleanDepartment === 'maintenance';
                    }).length > 0 ? (
                      staffMembers
                        .filter((staff: any) => {
                          const department = staff.department?.toString().toLowerCase() || '';
                          const cleanDepartment = department.replace(/[{}]/g, '').toLowerCase();
                          return cleanDepartment === 'maintenance';
                        })
                        .map((staff: any) => {
                          const staffId = staff.id?.toString() || '';
                          const firstName = staff.first_name || staff.firstName || '';
                          const lastName = staff.last_name || staff.lastName || '';
                          const role = staff.role || staff.job_title || '';

                          return (
                            <SelectItem key={staffId} value={staffId}>
                              {firstName} {lastName}
                              {role && ` - ${role}`}
                            </SelectItem>
                          );
                        })
                    ) : (
                      <SelectItem value="none" disabled className="text-muted-foreground">
                        No maintenance technicians available
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>

                {/* Unassign button (only shown when assigned) */}
                {request.assignedTo && (
                  <div className="mt-2 flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                      onClick={() => {
                        // BUG 5 FIX: Pass null explicitly to clear assignedTo,
                        // rather than undefined which was silently dropped.
                        updateStatusMutation.mutate({
                          status: "pending",
                          assignedTo: null,
                        });
                      }}
                      disabled={updateStatusMutation.isPending}
                    >
                      <XCircle className="h-3 w-3 mr-1" />
                      Unassign Technician
                    </Button>
                  </div>
                )}

                {isLoadingStaff && (
                  <p className="text-xs text-muted-foreground mt-1">Loading staff members...</p>
                )}
              </div>

              {/* Schedule Visit Button */}
              <Button
                className="w-full bg-emerald-600 hover:bg-emerald-700 border-blue-600"
                onClick={() => {
                  toast({
                    title: "Schedule Visit",
                    description: "This feature will be implemented soon",
                  });
                }}
              >
                <Calendar className="h-4 w-4 mr-2" />
                Schedule Visit
              </Button>

              {/* Update Cost Button */}
              {/* BUG 7 FIX: Only show the modal when we have resolved a real work order ID.
                  The modal receives workOrderId (the linked work order) not request.id
                  (the maintenance request). If no work order is linked yet, disable the button. */}
              <Button
                variant="outline"
                onClick={() => setIsModalOpen(true)}
                disabled={workOrderId === null}
                title={workOrderId === null ? "No linked work order found" : undefined}
                className="w-full border-border hover:bg-muted hover:border-border transition-colors"
              >
                Update Cost
                {workOrderId === null && (
                  <span className="ml-2 text-xs text-muted-foreground">(no work order)</span>
                )}
              </Button>

              {/* Approval Section (if needed) */}
              {request.status === "pending" && (
                <>
                  <Separator className="my-2 bg-muted" />
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-foreground">Quick Approval</Label>
                    <div className="flex space-x-2">
                      <Button
                        variant="outline"
                        className="flex-1 border-green-200 text-green-700 hover:bg-green-50 hover:border-green-300"
                        onClick={() => {
                          const amount = prompt("Enter approved amount:", request.estimatedCost || "0");
                          if (amount !== null) {
                            approveRequestMutation.mutate({
                              approvalStatus: "approved",
                              approvedAmount: amount,
                              comments: "Approved via quick action"
                            });
                          }
                        }}
                        disabled={approveRequestMutation.isPending}
                      >
                        Approve
                      </Button>
                      <Button
                        variant="outline"
                        className="flex-1 border-red-200 text-red-700 hover:bg-red-50 hover:border-red-300"
                        onClick={() => {
                          const reason = prompt("Reason for rejection:");
                          if (reason !== null) {
                            approveRequestMutation.mutate({
                              approvalStatus: "rejected",
                              comments: reason
                            });
                          }
                        }}
                        disabled={approveRequestMutation.isPending}
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
          {/* Related Tenant */}
          <Card className="border-border">
            <CardHeader>
              <CardTitle>Related Tenant</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoadingTenant ? (
                <Skeleton className="h-20 w-full rounded-lg" />
              ) : tenant ? (
                <div className="space-y-4">
                  <div className="flex items-center space-x-3">
                    <Avatar>
                      <AvatarFallback className="bg-blue-50 text-blue-600">
                        {tenant.firstName?.charAt(0)}{tenant.lastName?.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium text-foreground">
                        {tenant.firstName} {tenant.lastName}
                      </p>
                      <p className="text-sm text-muted-foreground">Tenant</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {tenant.email && (
                      <Button variant="ghost" size="sm" className="w-full justify-start text-foreground">
                        <Mail className="h-4 w-4 mr-2" />
                        {tenant.email}
                      </Button>
                    )}
                    {tenant.phone && (
                      <Button variant="ghost" size="sm" className="w-full justify-start text-foreground">
                        <Phone className="h-4 w-4 mr-2" />
                        {tenant.phone}
                      </Button>
                    )}
                  </div>

                  <Button variant="outline" size="sm" className="w-full border-border" asChild>
                    <Link to={`/tenants/${tenant.id}`}>
                      <ExternalLink className="h-4 w-4 mr-2" />
                      View Tenant Profile
                    </Link>
                  </Button>
                </div>
              ) : (
                <div className="text-center py-4">
                  <User className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">No tenant associated</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Unit & Property */}
          <Card className="border-border">
            <CardHeader>
              <CardTitle>Location</CardTitle>
            </CardHeader>
            <CardContent>
              {unit || property ? (
                <div className="space-y-4">
                  {unit && (
                    <div>
                      <div className="flex items-center space-x-2 mb-2">
                        <Home className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium text-foreground">Unit {unit.unitNumber}</span>
                      </div>
                    </div>
                  )}

                  {property && (
                    <div>
                      <div className="flex items-center space-x-2 mb-2">
                        <Building className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium text-foreground">{property.name}</span>
                      </div>
                      {property.address && (
                        <div className="flex items-start space-x-2">
                          <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                          <span className="text-sm text-muted-foreground">{property.address}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {(unit?.id || property?.id) && (
                    <Button variant="outline" size="sm" className="w-full border-border" asChild>
                      <Link to={property?.id ? `/properties/${property.id}` : '#'}>
                        <ExternalLink className="h-4 w-4 mr-2" />
                        View Property
                      </Link>
                    </Button>
                  )}
                </div>
              ) : (
                <div className="text-center py-4">
                  <Home className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">No location specified</p>
                </div>
              )}

            </CardContent>
          </Card>

          {/* Attachments */}
          <Card className="border-border">
            <CardHeader>
              <CardTitle>Attachments</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoadingDocuments ? (
                <div className="space-y-2">
                  {[1, 2].map(i => (
                    <Skeleton key={i} className="h-10 w-full rounded-lg" />
                  ))}
                </div>
              ) : documents.length > 0 ? (
                <div className="space-y-2">
                  {(Array.isArray(documents) ? documents : []).map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between p-2 border border-border rounded hover:bg-muted">
                      <div className="flex items-center space-x-2">
                        <Paperclip className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm truncate max-w-[150px]">{doc.name}</span>
                      </div>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                        <Download className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-4">
                  <Paperclip className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">No attachments</p>
                </div>
              )}

              <Button variant="outline" size="sm" className="w-full mt-3 border-border">
                <Paperclip className="h-4 w-4 mr-2" />
                Add Attachment
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* BUG 7 FIX: Pass the resolved workOrderId (from the linked work order),
          not request.id (the maintenance request ID). Render nothing when no
          work order has been linked yet. */}
      {workOrderId !== null && (
        <WorkOrderCostModal
          workOrderId={workOrderId}
          isOpen={isModalOpen}
          setIsOpen={setIsModalOpen}
        />
      )}

    </div>
  );
}