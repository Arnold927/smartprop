import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { useAuth } from '../../hooks/useAuth';
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";
import {
 Plus,
 Wrench,
 Clock,
 CheckCircle,
 AlertTriangle,
 Eye,
 Edit,
 RefreshCw,
} from 'lucide-react';

interface MaintenanceRequest {
 id: number;
 ticketNumber: string;
 title: string;
 priority: 'low' | 'medium' | 'high' | 'urgent';
 status: string;
 category: string;
 createdAt: string;
 tenant: {
 firstName: string;
 lastName: string;
 };
 unit: {
 unitNumber: string;
 };
 property: {
 name: string;
 };
 estimatedCost?: string;
}

export default function MaintenancePage() {
 const navigate = useLocation();
 const { isAuthenticated } = useAuth();
 const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'in_progress' | 'completed'>('all');

 // Fetch maintenance requests using React Query
 const {
 data: requests = [],
 isLoading,
 error,
 refetch,
 } = useQuery<MaintenanceRequest[]>({
 queryKey: ['/api/maintenance-requests'],
 queryFn: async () => {
 const response = await apiRequest('/api/maintenance-requests');
 return ensureArray(await response.json());
 },
 enabled: isAuthenticated,
 });

 const priorityColors = {
 low: 'bg-muted text-foreground',
 medium: 'bg-blue-100 text-blue-800',
 high: 'bg-orange-100 text-orange-800',
 urgent: 'bg-red-100 text-red-800'
 };

 const statusGroups = {
 all: requests,
 pending: (Array.isArray(requests) ? requests : []).filter(r => r.status === 'pending'),
 in_progress: (Array.isArray(requests) ? requests : []).filter(r => r.status === 'in_progress'),
 completed: (Array.isArray(requests) ? requests : []).filter(r => r.status === 'completed'),
 };

 const displayRequests = statusGroups[activeTab];

 if (isLoading) {
 return (
 <PageShell>
 <div className="flex items-center justify-center h-64">
 <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" ></div>
 <span className="ml-3 text-muted-foreground">Loading maintenance requests...</span>
 </div>
 </PageShell>
 );
 }

 if (error) {
 return (
 <PageShell>
 <div className="p-6">
 <div className="bg-red-50 border border-red-200 rounded-lg p-4">
 <div className="flex items-center justify-between">
 <div className="flex items-center">
 <AlertTriangle className="h-5 w-5 text-red-400 mr-3" />
 <div>
 <p className="text-sm font-medium text-red-800">
 Failed to load maintenance requests
 </p>
 <p className="text-sm text-red-600 mt-1">
 {error instanceof Error ? error.message : 'Unknown error'}
 </p>
 </div>
 </div>
 <button
 onClick={() => refetch()}
 className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-red-700 bg-red-100 hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
 >
 <RefreshCw className="h-4 w-4 mr-2" />
 Retry
 </button>
 </div>
 </div>
 </div>
 </PageShell>
 );
 }

 return (
 <PageShell>
 <div className="p-4 md:p-6 space-y-6">
 {/* Header */}
 <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
 <div>
 <h1 className="text-2xl md:text-3xl font-bold text-foreground">Maintenance Requests</h1>
 <p className="text-muted-foreground mt-1">
 {requests.length} request{requests.length !== 1 ? 's' : ''} found
 </p>
 </div>
 <div className="flex space-x-2">
 <button
 onClick={() => refetch()}
 className="px-4 py-2 border border-border rounded-lg text-foreground hover:bg-muted flex items-center"
 >
 <RefreshCw className="h-4 w-4 mr-2" />
 Refresh
 </button>
 <Link to="/maintenance/new">
 <button className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg flex items-center transition-colors">
 <Plus className="h-4 w-4 mr-2" />
 New Request
 </button>
 </Link>
 </div>
 </div>

 {/* Stats */}
 <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
 <div className="bg-card p-4 rounded-lg border shadow-sm">
 <div className="flex items-center">
 <Wrench className="h-5 w-5 text-muted-foreground mr-3" />
 <div>
 <p className="text-sm text-muted-foreground">Total</p>
 <p className="text-2xl font-semibold">{requests.length}</p>
 </div>
 </div>
 </div>
 
 <div className="bg-card p-4 rounded-lg border shadow-sm">
 <div className="flex items-center">
 <Clock className="h-5 w-5 text-yellow-500 mr-3" />
 <div>
 <p className="text-sm text-muted-foreground">Pending</p>
 <p className="text-2xl font-semibold">{statusGroups.pending.length}</p>
 </div>
 </div>
 </div>
 
 <div className="bg-card p-4 rounded-lg border shadow-sm">
 <div className="flex items-center">
 <Wrench className="h-5 w-5 text-blue-500 mr-3" />
 <div>
 <p className="text-sm text-muted-foreground">In Progress</p>
 <p className="text-2xl font-semibold">{statusGroups.in_progress.length}</p>
 </div>
 </div>
 </div>
 
 <div className="bg-card p-4 rounded-lg border shadow-sm">
 <div className="flex items-center">
 <CheckCircle className="h-5 w-5 text-green-500 mr-3" />
 <div>
 <p className="text-sm text-muted-foreground">Completed</p>
 <p className="text-2xl font-semibold">{statusGroups.completed.length}</p>
 </div>
 </div>
 </div>
 </div>

 {/* Tabs and Table */}
 <div className="bg-card rounded-lg border shadow-sm">
 {/* Tabs */}
 <div className="border-b">
 <div className="flex space-x-1 px-4">
 {(['all', 'pending', 'in_progress', 'completed'] as const).map((tab) => (
 <button
 key={tab}
 onClick={() => setActiveTab(tab)}
 className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
 activeTab === tab
 ? 'border-blue-500 text-blue-600'
 : 'border-transparent text-muted-foreground hover:text-foreground'
 }`}
 >
 {tab === 'all' ? 'All' : tab.replace('_', ' ')}
 <span className="ml-2 bg-muted text-muted-foreground py-0.5 px-2 rounded-full text-xs">
 {statusGroups[tab].length}
 </span>
 </button>
 ))}
 </div>
 </div>

 {/* Table */}
 <div className="p-4">
 {displayRequests.length > 0 ? (
 <div className="overflow-x-auto">
 <table className="w-full">
 <thead>
 <tr className="border-b">
 <th className="text-left py-3 px-4 text-sm font-medium text-foreground">Ticket #</th>
 <th className="text-left py-3 px-4 text-sm font-medium text-foreground">Issue</th>
 <th className="text-left py-3 px-4 text-sm font-medium text-foreground">Tenant/Unit</th>
 <th className="text-left py-3 px-4 text-sm font-medium text-foreground">Priority</th>
 <th className="text-left py-3 px-4 text-sm font-medium text-foreground">Status</th>
 <th className="text-left py-3 px-4 text-sm font-medium text-foreground">Date</th>
 <th className="text-left py-3 px-4 text-sm font-medium text-foreground">Actions</th>
 </tr>
 </thead>
 <tbody>
 {displayRequests.map((request) => (
 <tr key={request.id} className="border-b hover:bg-muted">
 <td className="py-3 px-4">
 <span className="font-medium text-sm font-mono">{request.ticketNumber}</span>
 </td>
 <td className="py-3 px-4">
 <div>
 <p className="font-medium">{request.title}</p>
 <p className="text-sm text-muted-foreground capitalize">{request.category}</p>
 </div>
 </td>
 <td className="py-3 px-4">
 <div>
 <p className="font-medium">
 {request.tenant.firstName} {request.tenant.lastName}
 </p>
 <p className="text-sm text-muted-foreground">Unit {request.unit.unitNumber}</p>
 <p className="text-xs text-muted-foreground">{request.property.name}</p>
 </div>
 </td>
 <td className="py-3 px-4">
 <span className={`px-3 py-1 rounded-full text-xs font-medium ${priorityColors[request.priority]}`}>
 {request.priority}
 </span>
 </td>
 <td className="py-3 px-4">
 <span className={`px-3 py-1 rounded-full text-xs font-medium ${
 request.status === 'completed' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' py-3 px-4">
 <p className="text-sm text-foreground">
 {new Date(request.createdAt).toLocaleDateString('en-US', {
 month: 'short',
 day: 'numeric',
 year: 'numeric'
 })}
 </p>
 </td>
 <td className="py-3 px-4">
 <div className="flex items-center space-x-3">
 <Link to={`/maintenance/${request.id}`}>
 <button 
 className="text-blue-600 hover:text-blue-800 flex items-center text-sm"
 title="View details"
 >
 <Eye className="h-4 w-4 mr-1" />
 View
 </button>
 </Link>
 <Link to={`/maintenance/${request.id}/edit`}>
 <button 
 className="text-muted-foreground hover:text-foreground flex items-center text-sm"
 title="Edit request"
 >
 <Edit className="h-4 w-4 mr-1" />
 Edit
 </button>
 </Link>
 </div>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 ) : (
 <div className="text-center py-12">
 <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-muted mb-4">
 <Wrench className="h-6 w-6 text-muted-foreground" />
 </div>
 <h3 className="text-lg font-medium text-foreground mb-1">No maintenance requests</h3>
 <p className="text-muted-foreground max-w-md mx-auto mb-6">
 {activeTab === 'all' 
 ? 'Get started by creating your first maintenance request.'
 : `No ${activeTab.replace('_', ' ')} maintenance requests found.`
 }
 </p>
 <Link to="/maintenance/new">
 <button className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-emerald-600 hover:bg-emerald-700">
 <Plus className="h-4 w-4 mr-2" />
 New Maintenance Request
 </button>
 </Link>
 </div>
 )}
 </div>
 </div>
 </div>
 </PageShell>
 );
}