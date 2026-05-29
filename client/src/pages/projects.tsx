import { apiRequest, ensureArray } from "@/lib/queryClient";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { 
 Plus, 
 Search, 
 BarChart3,
 Calendar,
 Clock,
 DollarSign,
 Users,
 FileText,
 Hammer,
 Building,
 Wrench,
 CheckCircle,
 AlertTriangle,
 Timer,
 PlayCircle,
 PauseCircle,
 Target,
 TrendingUp,
 Filter,
 Download,
 Settings,
 ClipboardList
} from "lucide-react";
import DataTable from "@/components/ui/data-table";
import StatusBadge from "@/components/ui/status-badge";
import { format } from "date-fns";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";

interface Project {
 id: number;
 name: string;
 description?: string;
 type: 'construction' | 'renovation' | 'maintenance';
 status: 'planning' | 'in_progress' | 'completed' | 'on_hold' | 'cancelled';
 priority: 'low' | 'medium' | 'high' | 'urgent';
 budget?: string;
 actualCost?: string;
 startDate?: string;
 endDate?: string;
 completionPercentage: number;
 managerId: string;
 property?: {
 name: string;
 address: string;
 };
 unit?: {
 unitNumber: string;
 };
 tasks: ProjectTask[];
 milestones: ProjectMilestone[];
 team: ProjectTeamMember[];
}

interface ProjectTask {
 id: number;
 projectId: number;
 name: string;
 description?: string;
 status: 'todo' | 'in_progress' | 'completed' | 'blocked';
 priority: 'low' | 'medium' | 'high' | 'urgent';
 assignedTo?: string;
 dueDate?: string;
 completedDate?: string;
 estimatedHours?: number;
 actualHours?: number;
}

interface ProjectMilestone {
 id: number;
 projectId: number;
 name: string;
 description?: string;
 targetDate: string;
 completedDate?: string;
 status: 'pending' | 'completed' | 'overdue';
 importance: 'low' | 'normal' | 'high' | 'critical';
}

interface ProjectTeamMember {
 id: number;
 projectId: number;
 memberId: string;
 memberType: 'manager' | 'contractor' | 'supervisor' | 'worker';
 role?: string;
 hourlyRate?: string;
 isActive: boolean;
}

export default function Projects() {
 const [searchTerm, setSearchTerm] = useState("");
 const [statusFilter, setStatusFilter] = useState("all");
 const [typeFilter, setTypeFilter] = useState("all");
 const [selectedProject, setSelectedProject] = useState<Project | null>(null);

 const { data: projects = [], isLoading } = useQuery<Project[]>({
 queryKey: ["/api/projects"],
 queryFn: async () => { const r = await apiRequest("/api/projects"); return ensureArray(await r.json()); },
 });

 const { data: projectTasks = [] } = useQuery<ProjectTask[]>({
 queryKey: ["/api/project-tasks"],
 queryFn: async () => { const r = await apiRequest("/api/project-tasks"); return ensureArray(await r.json()); },
 });

 const { data: projectMilestones = [] } = useQuery<ProjectMilestone[]>({
 queryKey: ["/api/project-milestones"],
 queryFn: async () => { const r = await apiRequest("/api/project-milestones"); return ensureArray(await r.json()); },
 });

 // Add WorkOrder interface for projects
 interface WorkOrder {
 id: number;
 title: string;
 description: string;
 status: string;
 priority: string;
 workOrderType: string;
 contractorId?: number;
 projectId?: number;
 maintenanceRequestId?: number;
 estimatedCost?: string;
 actualCost?: string;
 scheduledDate?: string;
 completedDate?: string;
 }

 const { data: workOrders = [] } = useQuery<WorkOrder[]>({
 queryKey: ["/api/work-orders"],
 queryFn: async () => { const r = await apiRequest("/api/work-orders"); return ensureArray(await r.json()); },
 });

 const getStatusBadge = (status: string) => {
 const variants = {
 planning: "bg-blue-100 text-blue-800",
 in_progress: "bg-yellow-100 text-yellow-800",
 completed: "bg-emerald-50 text-emerald-700 border border-emerald-200",
 on_hold: "bg-muted text-foreground",
 cancelled: "bg-red-100 text-red-800",
 };
 return (
 <Badge className={variants[status as keyof typeof variants] || variants.planning}>
 {status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
 </Badge>
 );
 };

 const getTypeBadge = (type: string) => {
 const variants = {
 construction: "bg-orange-100 text-orange-800",
 renovation: "bg-purple-100 text-purple-800",
 maintenance: "bg-blue-100 text-blue-800",
 };
 const icons = {
 construction: <Building className="w-3 h-3 mr-1" />,
 renovation: <Hammer className="w-3 h-3 mr-1" />,
 maintenance: <Wrench className="w-3 h-3 mr-1" />,
 };
 return (
 <Badge className={`${variants[type as keyof typeof variants] || variants.maintenance} flex items-center`}>
 {icons[type as keyof typeof icons]}
 {type.charAt(0).toUpperCase() + type.slice(1)}
 </Badge>
 );
 };

 const getPriorityBadge = (priority: string) => {
 const variants = {
 low: "bg-muted text-foreground",
 medium: "bg-yellow-100 text-yellow-800",
 high: "bg-orange-100 text-orange-800",
 urgent: "bg-red-100 text-red-800",
 };
 return (
 <Badge className={variants[priority as keyof typeof variants] || variants.medium}>
 {priority.charAt(0).toUpperCase() + priority.slice(1)}
 </Badge>
 );
 };

 const projectColumns = [
 {
 header: "Project",
 accessorKey: "name",
 cell: (project: Project) => (
 <div>
 <p className="font-medium text-foreground">{project.name}</p>
 <p className="text-sm text-muted-foreground">
 {project.property?.name} {project.unit && `- Unit ${project.unit.unitNumber}`}
 </p>
 </div>
 ),
 },
 {
 header: "Type",
 accessorKey: "type",
 cell: (project: Project) => getTypeBadge(project.type),
 },
 {
 header: "Status",
 accessorKey: "status",
 cell: (project: Project) => getStatusBadge(project.status),
 },
 {
 header: "Priority",
 accessorKey: "priority",
 cell: (project: Project) => getPriorityBadge(project.priority),
 },
 {
 header: "Progress",
 accessorKey: "completionPercentage",
 cell: (project: Project) => (
 <div className="w-full bg-muted rounded-full h-2">
 <div 
 className="bg-blue-600 h-2 rounded-full" 
 style={{ width: `${project.completionPercentage}%` }}
 ></div>
 <p className="text-xs text-muted-foreground mt-1">{project.completionPercentage}%</p>
 </div>
 ),
 },
 {
 header: "Budget",
 accessorKey: "budget",
 cell: (project: Project) => (
 <div>
 <p className="text-sm font-medium">${project.budget || '0'}</p>
 {project.actualCost && (
 <p className="text-xs text-muted-foreground">Actual: ${project.actualCost}</p>
 )}
 </div>
 ),
 },
 {
 header: "Timeline",
 accessorKey: "timeline",
 cell: (project: Project) => (
 <div className="text-sm">
 {project.startDate && (
 <p className="text-muted-foreground">
 Start: {new Date(project.startDate).toLocaleDateString()}
 </p>
 )}
 {project.endDate && (
 <p className="text-muted-foreground">
 End: {new Date(project.endDate).toLocaleDateString()}
 </p>
 )}
 </div>
 ),
 },
 {
 header: "Actions",
 accessorKey: "actions",
 cell: (project: Project) => (
 <div className="flex items-center space-x-2">
 <Button 
 variant="ghost" 
 size="sm"
 onClick={() => setSelectedProject(project)}
 >
 View
 </Button>
 <Button variant="ghost" size="sm">
 Edit
 </Button>
 </div>
 ),
 },
 ];

 // Calculate project summary statistics
 const completedProjects = (Array.isArray(projects) ? projects : []).filter((p: Project) => p.status === 'completed').length;
 const activeProjects = (Array.isArray(projects) ? projects : []).filter((p: Project) => p.status === 'in_progress').length;
 const totalBudget = projects.reduce((sum: number, p: Project) => sum + parseFloat(p.budget || '0'), 0);
 const totalActualCost = projects.reduce((sum: number, p: Project) => sum + parseFloat(p.actualCost || '0'), 0);
 const avgCompletion = projects.length > 0 ? 
 projects.reduce((sum: number, p: Project) => sum + p.completionPercentage, 0) / projects.length : 0;

 return (
 <div className="p-6 space-y-6">
 {/* Header */}
 <div className="flex items-center justify-between">
 <div>
 <h1 className="text-2xl font-semibold text-foreground">Project Management</h1>
 <p className="text-muted-foreground">Construction, renovations, and maintenance projects</p>
 </div>
 <div className="flex items-center space-x-3">
 <Button variant="outline">
 <Download className="mr-2 h-4 w-4" />
 Export Report
 </Button>
 <Button>
 <Plus className="mr-2 h-4 w-4" />
 New Project
 </Button>
 </div>
 </div>

 {/* Project Overview Cards */}
 <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
 <Card>
 <CardContent className="p-6">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-muted-foreground">Total Projects</p>
 <p className="text-2xl font-semibold text-foreground">{projects.length}</p>
 </div>
 <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
 <BarChart3 className="text-blue-600 h-6 w-6" />
 </div>
 </div>
 </CardContent>
 </Card>

 <Card>
 <CardContent className="p-6">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-muted-foreground">Active Projects</p>
 <p className="text-2xl font-semibold text-yellow-600">{activeProjects}</p>
 </div>
 <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
 <PlayCircle className="text-yellow-600 h-6 w-6" />
 </div>
 </div>
 </CardContent>
 </Card>

 <Card>
 <CardContent className="p-6">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-muted-foreground">Completed</p>
 <p className="text-2xl font-semibold text-green-600">{completedProjects}</p>
 </div>
 <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
 <CheckCircle className="text-green-600 h-6 w-6" />
 </div>
 </div>
 </CardContent>
 </Card>

 <Card>
 <CardContent className="p-6">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-muted-foreground">Total Budget</p>
 <p className="text-2xl font-semibold text-blue-600">${totalBudget.toLocaleString()}</p>
 </div>
 <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
 <DollarSign className="text-blue-600 h-6 w-6" />
 </div>
 </div>
 </CardContent>
 </Card>

 <Card>
 <CardContent className="p-6">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-muted-foreground">Avg Progress</p>
 <p className="text-2xl font-semibold text-purple-600">{avgCompletion.toFixed(0)}%</p>
 </div>
 <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
 <Target className="text-purple-600 h-6 w-6" />
 </div>
 </div>
 </CardContent>
 </Card>
 </div>

 {/* Project Management Tabs */}
 <Tabs defaultValue="projects" className="space-y-6">
 <TabsList className="grid w-full grid-cols-5">
 <TabsTrigger value="projects">Projects</TabsTrigger>
 <TabsTrigger value="tasks">Tasks</TabsTrigger>
 <TabsTrigger value="work-orders">Work Orders</TabsTrigger>
 <TabsTrigger value="timeline">Timeline</TabsTrigger>
 <TabsTrigger value="reports">Reports</TabsTrigger>
 </TabsList>

 <TabsContent value="projects" className="space-y-6">
 {/* Search and Filter Bar */}
 <Card>
 <CardContent className="p-4">
 <div className="flex flex-col md:flex-row md:items-center space-y-4 md:space-y-0 md:space-x-4">
 <div className="flex-1 relative">
 <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
 <Input
 placeholder="Search projects..."
 className="pl-10"
 value={searchTerm}
 onChange={(e) => setSearchTerm(e.target.value)}
 />
 </div>
 <Select value={statusFilter} onValueChange={setStatusFilter}>
 <SelectTrigger className="w-[150px]">
 <SelectValue placeholder="Status" />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="all">All Status</SelectItem>
 <SelectItem value="planning">Planning</SelectItem>
 <SelectItem value="in_progress">In Progress</SelectItem>
 <SelectItem value="completed">Completed</SelectItem>
 <SelectItem value="on_hold">On Hold</SelectItem>
 </SelectContent>
 </Select>
 <Select value={typeFilter} onValueChange={setTypeFilter}>
 <SelectTrigger className="w-[150px]">
 <SelectValue placeholder="Type" />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="all">All Types</SelectItem>
 <SelectItem value="construction">Construction</SelectItem>
 <SelectItem value="renovation">Renovation</SelectItem>
 <SelectItem value="maintenance">Maintenance</SelectItem>
 </SelectContent>
 </Select>
 </div>
 </CardContent>
 </Card>

 {/* Projects Table */}
 <Card>
 <CardHeader>
 <CardTitle>All Projects ({projects.length})</CardTitle>
 </CardHeader>
 <CardContent>
 <DataTable
 data={projects}
 columns={projectColumns}
 emptyMessage="No projects found"
 />
 </CardContent>
 </Card>
 </TabsContent>

 <TabsContent value="tasks" className="space-y-6">
 <Card>
 <CardHeader>
 <CardTitle>Project Tasks</CardTitle>
 </CardHeader>
 <CardContent>
 <div className="text-center py-12">
 <Timer className="mx-auto h-16 w-16 text-muted-foreground mb-4" />
 <h3 className="text-lg font-semibold text-foreground mb-2">
 Task Management
 </h3>
 <p className="text-muted-foreground max-w-2xl mx-auto">
 Detailed task management, assignment tracking, and progress monitoring 
 will be available once projects are created.
 </p>
 </div>
 </CardContent>
 </Card>
 </TabsContent>

 <TabsContent value="work-orders" className="space-y-6">
 {/* Work Orders Overview Cards */}
 <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
 <Card>
 <CardContent className="p-6">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-muted-foreground">Total Work Orders</p>
 <p className="text-2xl font-semibold text-blue-600">{workOrders.length}</p>
 </div>
 <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
 <ClipboardList className="text-blue-600 h-6 w-6" />
 </div>
 </div>
 </CardContent>
 </Card>
 
 <Card>
 <CardContent className="p-6">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-muted-foreground">Active Orders</p>
 <p className="text-2xl font-semibold text-yellow-600">
 {workOrders.filter(wo => wo.status === 'in_progress' || wo.status === 'assigned').length}
 </p>
 </div>
 <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
 <Wrench className="text-yellow-600 h-6 w-6" />
 </div>
 </div>
 </CardContent>
 </Card>
 
 <Card>
 <CardContent className="p-6">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-muted-foreground">Completed</p>
 <p className="text-2xl font-semibold text-green-600">
 {workOrders.filter(wo => wo.status === 'completed').length}
 </p>
 </div>
 <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
 <CheckCircle className="text-green-600 h-6 w-6" />
 </div>
 </div>
 </CardContent>
 </Card>
 
 <Card>
 <CardContent className="p-6">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-muted-foreground">Total Cost</p>
 <p className="text-2xl font-semibold text-purple-600">
 ${workOrders.reduce((sum, wo) => sum + parseFloat(wo.actualCost || wo.estimatedCost || '0'), 0).toLocaleString()}
 </p>
 </div>
 <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
 <DollarSign className="text-purple-600 h-6 w-6" />
 </div>
 </div>
 </CardContent>
 </Card>
 </div>

 {/* Work Orders Actions */}
 <Card>
 <CardContent className="p-4">
 <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0">
 <div className="flex flex-col md:flex-row md:items-center space-y-4 md:space-y-0 md:space-x-4">
 <div className="flex-1 relative">
 <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
 <Input
 placeholder="Search work orders..."
 className="pl-10"
 />
 </div>
 <Select defaultValue="all">
 <SelectTrigger className="w-[150px]">
 <SelectValue placeholder="Status" />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="all">All Status</SelectItem>
 <SelectItem value="draft">Draft</SelectItem>
 <SelectItem value="assigned">Assigned</SelectItem>
 <SelectItem value="in_progress">In Progress</SelectItem>
 <SelectItem value="completed">Completed</SelectItem>
 </SelectContent>
 </Select>
 <Select defaultValue="all">
 <SelectTrigger className="w-[150px]">
 <SelectValue placeholder="Type" />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="all">All Types</SelectItem>
 <SelectItem value="project">Project</SelectItem>
 <SelectItem value="maintenance">Maintenance</SelectItem>
 <SelectItem value="emergency">Emergency</SelectItem>
 <SelectItem value="preventive">Preventive</SelectItem>
 </SelectContent>
 </Select>
 </div>
 <Button>
 <Plus className="mr-2 h-4 w-4" />
 New Work Order
 </Button>
 </div>
 </CardContent>
 </Card>

 {/* Work Orders Table */}
 <Card>
 <CardHeader>
 <CardTitle>All Work Orders ({workOrders.length})</CardTitle>
 </CardHeader>
 <CardContent>
 {workOrders.length > 0 ? (
 <div className="space-y-4">
 {(Array.isArray(workOrders) ? workOrders : []).map((workOrder) => (
 <div key={workOrder.id} className="border rounded-lg p-4 hover:bg-muted transition-colors">
 <div className="flex items-center justify-between">
 <div className="flex-1">
 <div className="flex items-center space-x-3 mb-2">
 <h3 className="font-semibold text-foreground">
 {workOrder.title}
 </h3>
 <Badge className={
 workOrder.status === 'completed' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-muted text-foreground'
}>
 {workOrder.workOrderType.charAt(0).toUpperCase() + workOrder.workOrderType.slice(1)}
</Badge>
 </div>
 <p className="text-muted-foreground text-sm mb-2">
 {workOrder.description}
 </p>
 <div className="flex items-center space-x-4 text-sm text-muted-foreground">
 {workOrder.estimatedCost && (
 <span className="flex items-center">
 <DollarSign className="w-4 h-4 mr-1" />
 Est. ${workOrder.estimatedCost}
 </span>
 )}
 {workOrder.scheduledDate && (
 <span className="flex items-center">
 <Calendar className="w-4 h-4 mr-1" />
 {format(new Date(workOrder.scheduledDate), 'MMM dd, yyyy')}
 </span>
 )}
 </div>
 </div>
 <div className="flex items-center space-x-2">
 <Button variant="outline" size="sm">
 View
 </Button>
 <Button variant="outline" size="sm">
 Edit
 </Button>
 </div>
 </div>
 </div>
 ))}
 </div>
 ) : (
 <div className="text-center py-12">
 <ClipboardList className="mx-auto h-16 w-16 text-muted-foreground mb-4" />
 <h3 className="text-lg font-semibold text-foreground mb-2">
 No Work Orders Found
 </h3>
 <p className="text-muted-foreground max-w-2xl mx-auto mb-6">
 Create work orders to track maintenance, repairs, and project tasks. 
 Work orders help organize and manage all project-related activities.
 </p>
 <Button>
 <Plus className="mr-2 h-4 w-4" />
 Create First Work Order
 </Button>
 </div>
 )}
 </CardContent>
 </Card>
 </TabsContent>

 <TabsContent value="timeline" className="space-y-6">
 <Card>
 <CardHeader>
 <CardTitle>Project Timeline</CardTitle>
 </CardHeader>
 <CardContent>
 <div className="text-center py-12">
 <Calendar className="mx-auto h-16 w-16 text-muted-foreground mb-4" />
 <h3 className="text-lg font-semibold text-foreground mb-2">
 Timeline View
 </h3>
 <p className="text-muted-foreground max-w-2xl mx-auto">
 Gantt charts, milestone tracking, and project scheduling 
 will be displayed here once projects are active.
 </p>
 </div>
 </CardContent>
 </Card>
 </TabsContent>

 <TabsContent value="reports" className="space-y-6">
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
 <Card className="cursor-pointer hover:shadow-lg transition-shadow">
 <CardContent className="p-6 text-center">
 <BarChart3 className="mx-auto h-12 w-12 text-blue-600 mb-4" />
 <h3 className="text-lg font-semibold text-foreground mb-2">Progress Report</h3>
 <p className="text-muted-foreground text-sm mb-4">Track completion rates and milestones</p>
 <Button className="w-full">
 <Download className="mr-2 h-4 w-4" />
 Generate Report
 </Button>
 </CardContent>
 </Card>

 <Card className="cursor-pointer hover:shadow-lg transition-shadow">
 <CardContent className="p-6 text-center">
 <DollarSign className="mx-auto h-12 w-12 text-green-600 mb-4" />
 <h3 className="text-lg font-semibold text-foreground mb-2">Budget Analysis</h3>
 <p className="text-muted-foreground text-sm mb-4">Compare budgets vs actual costs</p>
 <Button className="w-full">
 <Download className="mr-2 h-4 w-4" />
 Generate Report
 </Button>
 </CardContent>
 </Card>

 <Card className="cursor-pointer hover:shadow-lg transition-shadow">
 <CardContent className="p-6 text-center">
 <Users className="mx-auto h-12 w-12 text-purple-600 mb-4" />
 <h3 className="text-lg font-semibold text-foreground mb-2">Team Performance</h3>
 <p className="text-muted-foreground text-sm mb-4">Analyze team productivity and hours</p>
 <Button className="w-full">
 <Download className="mr-2 h-4 w-4" />
 Generate Report
 </Button>
 </CardContent>
 </Card>
 </div>
 </TabsContent>
 </Tabs>
 </div>
 );
}