import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, startOfWeek, endOfWeek, addDays } from "date-fns";
import { Plus, Hammer, Clock, CheckCircle, AlertTriangle, Calendar, Users, MapPin, Camera, FileText, Target, TrendingUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { formatCurrency } from "@shared/currency";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";

interface ConstructionProject {
 id: number;
 propertyId: number;
 projectName: string;
 description: string;
 projectType: string;
 projectStatus: string;
 priorityLevel: string;
 totalBudget: number;
 budgetSpent: number;
 currency: string;
 startDate: string;
 plannedEndDate: string;
 actualEndDate?: string;
 completionPercentage: number;
 projectManagerId: string;
 createdBy: string;
 createdAt: string;
}

interface ProjectTask {
 id: number;
 projectId: number;
 taskName: string;
 description: string;
 status: string;
 priority: string;
 assignedTo?: number;
 startDate: string;
 endDate: string;
 estimatedHours: number;
 actualHours?: number;
 progressPercentage: number;
 dependencies: number[];
 location?: string;
 requiredMaterials: string[];
 completionNotes?: string;
 createdAt: string;
}

interface Employee {
 id: number;
 employeeId: string;
 firstName: string;
 lastName: string;
 role: string;
 department: string;
 phoneNumber: string;
 email?: string;
 skills: string[];
 isActive: boolean;
 biometricEnabled: boolean;
 currentLocation?: string;
 lastCheckIn?: string;
 createdAt: string;
}

interface TimeEntry {
 id: number;
 employeeId: number;
 projectId: number;
 taskId?: number;
 clockInTime: string;
 clockOutTime?: string;
 totalHours?: number;
 location: string;
 workDescription: string;
 verificationMethod: string;
 photoUrl?: string;
 supervisorApproval?: string;
 createdAt: string;
}

const StatusBadge = ({ status }: { status: string }) => {
 const variants: Record<string, { label: string; variant: any; color: string }> = {
 planning: { label: "Planning", variant: "outline", color: "text-blue-600" },
 in_progress: { label: "In Progress", variant: "default", color: "text-yellow-600" },
 on_hold: { label: "On Hold", variant: "secondary", color: "text-muted-foreground" },
 completed: { label: "Completed", variant: "default", color: "text-green-600" },
 cancelled: { label: "Cancelled", variant: "destructive", color: "text-red-600" },
 };

 const config = variants[status] || variants.planning;

 return (
 <Badge variant={config.variant} className={config.color}>
 {config.label}
 </Badge>
 );
};

const PriorityBadge = ({ priority }: { priority: string }) => {
 const variants: Record<string, { label: string; variant: any; color: string }> = {
 low: { label: "Low", variant: "outline", color: "text-green-600" },
 medium: { label: "Medium", variant: "secondary", color: "text-yellow-600" },
 high: { label: "High", variant: "default", color: "text-orange-600" },
 urgent: { label: "Urgent", variant: "destructive", color: "text-red-600" },
 };

 const config = variants[priority] || variants.medium;

 return (
 <Badge variant={config.variant} className={config.color}>
 {config.label}
 </Badge>
 );
};

// Simple Gantt Chart Component
const GanttChart = ({ tasks }: { tasks: ProjectTask[] }) => {
 const startDate = new Date(Math.min(...(Array.isArray(tasks) ? tasks : []).map(t => new Date(t.startDate).getTime())));
 const endDate = new Date(Math.max(...(Array.isArray(tasks) ? tasks : []).map(t => new Date(t.endDate).getTime())));
 const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

 const getTaskPosition = (task: ProjectTask) => {
 const taskStart = new Date(task.startDate);
 const taskEnd = new Date(task.endDate);
 const startOffset = Math.ceil((taskStart.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
 const duration = Math.ceil((taskEnd.getTime() - taskStart.getTime()) / (1000 * 60 * 60 * 24));
 
 return {
 left: `${(startOffset / totalDays) * 100}%`,
 width: `${(duration / totalDays) * 100}%`
 };
 };

 return (
 <div className="space-y-4">
 <div className="flex justify-between text-sm text-muted-foreground border-b pb-2">
 <span>{format(startDate, 'MMM dd, yyyy')}</span>
 <span>{format(endDate, 'MMM dd, yyyy')}</span>
 </div>
 <div className="space-y-3">
 {(Array.isArray(tasks) ? tasks : []).map((task) => {
 const position = getTaskPosition(task);
 return (
 <div key={task.id} className="flex items-center space-x-4">
 <div className="w-48 text-sm truncate">
 {task.taskName}
 </div>
 <div className="flex-1 relative h-6 bg-muted rounded">
 <div
 className="absolute h-full bg-blue-500 rounded flex items-center justify-center text-white text-xs"
 style={position}
 >
 {task.progressPercentage}%
 </div>
 </div>
 </div>
 );
 })}
 </div>
 </div>
 );
};

export default function ConstructionProjectManagement() {
 const [selectedProject, setSelectedProject] = useState<ConstructionProject | null>(null);
 const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);
 const [isTimeTrackingOpen, setIsTimeTrackingOpen] = useState(false);
 const { toast } = useToast();
 const queryClient = useQueryClient();

 // Queries
 const { data: projects = [], isLoading: projectsLoading } = useQuery<ConstructionProject[]>({
 queryKey: ["/api/construction-projects"],
 queryFn: async () => { const r = await apiRequest("/api/construction-projects"); return ensureArray(await r.json()); },
 retry: false
 });

 const { data: tasks = [], isLoading: tasksLoading } = useQuery<ProjectTask[]>({
 queryKey: ["/api/construction-tasks", selectedProject?.id],
 enabled: !!selectedProject,
 retry: false
 });

 const { data: employees = [], isLoading: employeesLoading } = useQuery<Employee[]>({
 queryKey: ["/api/construction-employees"],
 queryFn: async () => { const r = await apiRequest("/api/construction-employees"); return ensureArray(await r.json()); },
 retry: false
 });

 const { data: timeEntries = [], isLoading: timeEntriesLoading } = useQuery<TimeEntry[]>({
 queryKey: ["/api/construction-time-entries"],
 queryFn: async () => { const r = await apiRequest("/api/construction-time-entries"); return ensureArray(await r.json()); },
 retry: false
 });

 // Mutations
 const createProjectMutation = useMutation({
 mutationFn: (data: any) => apiRequest("/api/construction-projects", { method: "POST", data: data }),
 onSuccess: () => {
 queryClient.invalidateQueries({ queryKey: ["/api/construction-projects"] });
 setIsCreateProjectOpen(false);
 toast({ title: "Success", description: "Construction project created successfully" });
 },
 onError: () => {
 toast({ title: "Error", description: "Failed to create construction project", variant: "destructive" });
 },
 });

 const recordTimeMutation = useMutation({
 mutationFn: (data: any) => apiRequest("/api/construction-time-entries", { method: "POST", data: data }),
 onSuccess: () => {
 queryClient.invalidateQueries({ queryKey: ["/api/construction-time-entries"] });
 setIsTimeTrackingOpen(false);
 toast({ title: "Success", description: "Time entry recorded successfully" });
 },
 onError: () => {
 toast({ title: "Error", description: "Failed to record time entry", variant: "destructive" });
 },
 });

 const handleCreateProject = (data: any) => {
 createProjectMutation.mutate(data);
 };

 const handleTimeEntry = (data: any) => {
 recordTimeMutation.mutate({
 ...data,
 location: "Construction Site", // Default location
 verificationMethod: "biometric", // Default method
 });
 };

 if (projectsLoading) {
 return (
 <div className="p-6">
 <div className="flex items-center space-x-2 mb-6">
 <Hammer className="h-6 w-6" />
 <h1 className="text-2xl font-semibold">Construction Project Management</h1>
 </div>
 <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
 {[...Array(6)].map((_, i) => (
 <div key={i} className="animate-pulse">
 <div className="h-32 bg-muted rounded-lg"></div>
 </div>
 ))}
 </div>
 </div>
 );
 }

 return (
 <div className="p-6 space-y-6">
 {/* Header */}
 <div className="flex justify-between items-center">
 <div className="flex items-center space-x-2">
 <Hammer className="h-6 w-6" />
 <h1 className="text-2xl font-semibold">Construction Project Management</h1>
 </div>
 <div className="flex space-x-2">
 <Dialog open={isTimeTrackingOpen} onOpenChange={setIsTimeTrackingOpen}>
 <DialogTrigger asChild>
 <Button variant="outline">
 <Clock className="h-4 w-4 mr-2" />
 Time Tracking
 </Button>
 </DialogTrigger>
 <DialogContent className="max-w-xl">
 <DialogHeader>
 <DialogTitle>Record Time Entry</DialogTitle>
 <DialogDescription>
 Record work hours with biometric verification
 </DialogDescription>
 </DialogHeader>
 <form onSubmit={(e) => {
 e.preventDefault();
 const formData = new FormData(e.target as HTMLFormElement);
 handleTimeEntry({
 employeeId: parseInt(formData.get("employeeId") as string),
 projectId: selectedProject?.id || parseInt(formData.get("projectId") as string),
 clockInTime: new Date().toISOString(),
 workDescription: formData.get("workDescription") as string,
 });
 }}>
 <div className="space-y-4">
 <div>
 <Label htmlFor="employeeId">Employee</Label>
 <Select name="employeeId" required>
 <SelectTrigger>
 <SelectValue placeholder="Select employee" />
 </SelectTrigger>
 <SelectContent>
 {(Array.isArray(employees) ? employees : []).map((emp: Employee) => (
 <SelectItem key={emp.id} value={emp.id.toString()}>
 {emp.firstName} {emp.lastName} - {emp.role}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 
 {!selectedProject && (
 <div>
 <Label htmlFor="projectId">Project</Label>
 <Select name="projectId" required>
 <SelectTrigger>
 <SelectValue placeholder="Select project" />
 </SelectTrigger>
 <SelectContent>
 {(Array.isArray(projects) ? projects : []).map((project: ConstructionProject) => (
 <SelectItem key={project.id} value={project.id.toString()}>
 {project.projectName}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 )}

 <div>
 <Label htmlFor="workDescription">Work Description</Label>
 <Textarea 
 name="workDescription" 
 placeholder="Describe the work being performed..."
 required
 />
 </div>

 <Button type="submit" disabled={recordTimeMutation.isPending}>
 {recordTimeMutation.isPending ? "Recording..." : "Clock In"}
 </Button>
 </div>
 </form>
 </DialogContent>
 </Dialog>

 <Dialog open={isCreateProjectOpen} onOpenChange={setIsCreateProjectOpen}>
 <DialogTrigger asChild>
 <Button>
 <Plus className="h-4 w-4 mr-2" />
 New Project
 </Button>
 </DialogTrigger>
 <DialogContent className="max-w-2xl">
 <DialogHeader>
 <DialogTitle>Create Construction Project</DialogTitle>
 <DialogDescription>
 Set up a new construction project with timeline and budget
 </DialogDescription>
 </DialogHeader>
 <form onSubmit={(e) => {
 e.preventDefault();
 const formData = new FormData(e.target as HTMLFormElement);
 handleCreateProject({
 propertyId: parseInt(formData.get("propertyId") as string),
 projectName: formData.get("projectName") as string,
 description: formData.get("description") as string,
 projectType: formData.get("projectType") as string,
 priority: formData.get("priority") as string,
 budgetAllocated: parseFloat(formData.get("budgetAllocated") as string),
 currency: "KES",
 startDate: formData.get("startDate") as string,
 plannedEndDate: formData.get("plannedEndDate") as string,
 projectManagerId: 1, // Default for now
 createdBy: "system"
 });
 }}>
 <div className="grid grid-cols-2 gap-4">
 <div className="col-span-2">
 <Label htmlFor="projectName">Project Name</Label>
 <Input name="projectName" placeholder="e.g., Kitchen Renovation" required />
 </div>

 <div>
 <Label htmlFor="projectType">Project Type</Label>
 <Select name="projectType" required>
 <SelectTrigger>
 <SelectValue placeholder="Select type" />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="renovation">Renovation</SelectItem>
 <SelectItem value="new_construction">New Construction</SelectItem>
 <SelectItem value="maintenance">Maintenance</SelectItem>
 <SelectItem value="repair">Repair</SelectItem>
 </SelectContent>
 </Select>
 </div>

 <div>
 <Label htmlFor="priority">Priority</Label>
 <Select name="priority" required>
 <SelectTrigger>
 <SelectValue placeholder="Select priority" />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="low">Low</SelectItem>
 <SelectItem value="medium">Medium</SelectItem>
 <SelectItem value="high">High</SelectItem>
 <SelectItem value="urgent">Urgent</SelectItem>
 </SelectContent>
 </Select>
 </div>

 <div>
 <Label htmlFor="budgetAllocated">Budget (KES)</Label>
 <Input 
 name="budgetAllocated" 
 type="number" 
 placeholder="0"
 step="0.01"
 required 
 />
 </div>

 <div>
 <Label htmlFor="propertyId">Property</Label>
 <Input 
 name="propertyId" 
 type="number" 
 placeholder="Property ID"
 required 
 />
 </div>

 <div>
 <Label htmlFor="startDate">Start Date</Label>
 <Input name="startDate" type="date" required />
 </div>

 <div>
 <Label htmlFor="plannedEndDate">Planned End Date</Label>
 <Input name="plannedEndDate" type="date" required />
 </div>

 <div className="col-span-2">
 <Label htmlFor="description">Description</Label>
 <Textarea 
 name="description" 
 placeholder="Project details and requirements..."
 />
 </div>

 <div className="col-span-2">
 <Button type="submit" disabled={createProjectMutation.isPending}>
 {createProjectMutation.isPending ? "Creating..." : "Create Project"}
 </Button>
 </div>
 </div>
 </form>
 </DialogContent>
 </Dialog>
 </div>
 </div>

 {/* Summary Cards */}
 <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
 <Card>
 <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
 <CardTitle className="text-sm font-medium">Total Projects</CardTitle>
 <Target className="h-4 w-4 text-muted-foreground" />
 </CardHeader>
 <CardContent>
 <div className="text-2xl font-semibold">{projects.length}</div>
 <p className="text-xs text-muted-foreground">
 Active construction projects
 </p>
 </CardContent>
 </Card>

 <Card>
 <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
 <CardTitle className="text-sm font-medium">In Progress</CardTitle>
 <Clock className="h-4 w-4 text-muted-foreground" />
 </CardHeader>
 <CardContent>
 <div className="text-2xl font-semibold">
 {projects.filter((p) => p.projectStatus === 'in_progress').length}
 </div>
 <p className="text-xs text-muted-foreground">
 Currently active projects
 </p>
 </CardContent>
 </Card>

 <Card>
 <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
 <CardTitle className="text-sm font-medium">Total Budget</CardTitle>
 <TrendingUp className="h-4 w-4 text-muted-foreground" />
 </CardHeader>
 <CardContent>
 <div className="text-2xl font-semibold">
 {formatCurrency(
 projects.reduce((sum, p) => sum + p.totalBudget, 0),
 'KES' as const
 )}
 </div>
 <p className="text-xs text-muted-foreground">
 Allocated across all projects
 </p>
 </CardContent>
 </Card>

 <Card>
 <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
 <CardTitle className="text-sm font-medium">Active Workers</CardTitle>
 <Users className="h-4 w-4 text-muted-foreground" />
 </CardHeader>
 <CardContent>
 <div className="text-2xl font-semibold">
 {employees.filter((e) => e.isActive).length}
 </div>
 <p className="text-xs text-muted-foreground">
 Available construction workers
 </p>
 </CardContent>
 </Card>
 </div>

 {/* Projects List & Project Details */}
 <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
 {/* Projects List */}
 <Card>
 <CardHeader>
 <CardTitle>Construction Projects</CardTitle>
 <CardDescription>Manage all construction and renovation projects</CardDescription>
 </CardHeader>
 <CardContent>
 <div className="space-y-4">
 {(Array.isArray(projects) ? projects : []).map((project) => (
 <div
 key={project.id}
 className={`p-4 border rounded-lg cursor-pointer transition-colors ${
 selectedProject?.id === project.id ? 'border-primary bg-primary/5' : 'hover:border-border'
 }`}
 onClick={() => setSelectedProject(project)}
 >
 <div className="flex justify-between items-start mb-2">
 <div>
 <h3 className="font-medium">{project.projectName}</h3>
 <p className="text-sm text-muted-foreground">{project.projectType}</p>
 </div>
 <div className="flex space-x-2">
 <StatusBadge status={project.projectStatus} />
 <PriorityBadge priority={project.priorityLevel} />
 </div>
 </div>
 
 <div className="space-y-2">
 <div className="flex justify-between text-sm">
 <span>Progress</span>
 <span>{project.completionPercentage}%</span>
 </div>
 <Progress value={project.completionPercentage} className="h-2" />
 </div>
 
 <div className="flex justify-between items-center mt-3">
 <span className="text-sm text-muted-foreground">
 Budget: {formatCurrency(project.totalBudget, project.currency as any)}
 </span>
 <span className="text-sm text-muted-foreground">
 Due: {format(new Date(project.plannedEndDate), 'MMM dd, yyyy')}
 </span>
 </div>
 </div>
 ))}
 </div>
 </CardContent>
 </Card>

 {/* Project Details & Gantt Chart */}
 <Card>
 <CardHeader>
 <CardTitle>
 {selectedProject ? `${selectedProject.projectName} - Timeline` : 'Select a Project'}
 </CardTitle>
 <CardDescription>
 {selectedProject ? 'Gantt chart and task details' : 'Click on a project to view details'}
 </CardDescription>
 </CardHeader>
 <CardContent>
 {selectedProject ? (
 <Tabs defaultValue="timeline" className="w-full">
 <TabsList>
 <TabsTrigger value="timeline">Timeline</TabsTrigger>
 <TabsTrigger value="details">Details</TabsTrigger>
 <TabsTrigger value="team">Team</TabsTrigger>
 </TabsList>
 
 <TabsContent value="timeline" className="space-y-4">
 {tasks.length > 0 ? (
 <GanttChart tasks={tasks} />
 ) : (
 <div className="text-center py-8 text-muted-foreground">
 No tasks available for this project
 </div>
 )}
 </TabsContent>
 
 <TabsContent value="details" className="space-y-4">
 <div className="grid grid-cols-2 gap-4">
 <div>
 <Label>Start Date</Label>
 <p className="text-sm">{format(new Date(selectedProject.startDate), 'PPP')}</p>
 </div>
 <div>
 <Label>End Date</Label>
 <p className="text-sm">{format(new Date(selectedProject.plannedEndDate), 'PPP')}</p>
 </div>
 <div>
 <Label>Budget</Label>
 <p className="text-sm">{formatCurrency(selectedProject.totalBudget, selectedProject.currency as any)}</p>
 </div>
 <div>
 <Label>Progress</Label>
 <p className="text-sm">{selectedProject.completionPercentage}%</p>
 </div>
 </div>
 <div>
 <Label>Description</Label>
 <p className="text-sm text-muted-foreground">{selectedProject.description}</p>
 </div>
 </TabsContent>
 
 <TabsContent value="team" className="space-y-4">
 <div className="space-y-2">
 {employees.slice(0, 5).map((employee) => (
 <div key={employee.id} className="flex items-center justify-between p-2 border rounded">
 <div className="flex items-center space-x-3">
 <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
 <span className="text-xs font-medium">
 {employee.firstName[0]}{employee.lastName[0]}
 </span>
 </div>
 <div>
 <p className="text-sm font-medium">{employee.firstName} {employee.lastName}</p>
 <p className="text-xs text-muted-foreground">{employee.role}</p>
 </div>
 </div>
 <Badge variant={employee.isActive ? "default" : "secondary"}>
 {employee.isActive ? "Active" : "Inactive"}
 </Badge>
 </div>
 ))}
 </div>
 </TabsContent>
 </Tabs>
 ) : (
 <div className="text-center py-8 text-muted-foreground">
 Select a project from the list to view timeline and details
 </div>
 )}
 </CardContent>
 </Card>
 </div>

 {/* Recent Time Entries */}
 <Card>
 <CardHeader>
 <CardTitle>Recent Time Entries</CardTitle>
 <CardDescription>Latest time tracking and biometric check-ins</CardDescription>
 </CardHeader>
 <CardContent>
 {timeEntries.length > 0 ? (
 <div className="space-y-3">
 {(Array.isArray(timeEntries) ? timeEntries : []).slice(0, 10).map((entry) => (
 <div key={entry.id} className="flex items-center justify-between p-3 border rounded">
 <div className="flex items-center space-x-3">
 <Clock className="h-4 w-4 text-muted-foreground" />
 <div>
 <p className="text-sm font-medium">Employee #{entry.employeeId}</p>
 <p className="text-xs text-muted-foreground">{entry.workDescription}</p>
 </div>
 </div>
 <div className="text-right">
 <p className="text-sm">{format(new Date(entry.clockInTime), 'MMM dd, HH:mm')}</p>
 <p className="text-xs text-muted-foreground">
 {entry.verificationMethod === 'biometric' ? '🔒 Biometric' : '📱 Mobile'}
 </p>
 </div>
 </div>
 ))}
 </div>
 ) : (
 <div className="text-center py-8 text-muted-foreground">
 No time entries recorded yet
 </div>
 )}
 </CardContent>
 </Card>
 </div>
 );
}