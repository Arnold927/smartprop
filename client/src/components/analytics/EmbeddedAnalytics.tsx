import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Area,
  AreaChart
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Users,
  DollarSign,
  AlertTriangle,
  CheckCircle,
  Calendar,
  Clock,
  Target,
  Activity
} from "lucide-react";
import { cn } from "@/lib/utils";

interface AnalyticsWidgetProps {
  title: string;
  value: string | number;
  change?: string;
  trend?: 'up' | 'down' | 'neutral';
  icon: React.ReactNode;
  description?: string;
  color?: 'blue' | 'green' | 'purple' | 'orange' | 'red';
}

function AnalyticsWidget({ title, value, change, trend, icon, description, color = "blue" }: AnalyticsWidgetProps) {
  const getTrendColor = () => {
    switch (trend) {
      case 'up': return 'text-green-600';
      case 'down': return 'text-red-600';
      default: return 'text-muted-foreground';
    }
  };

  const getTrendIcon = () => {
    switch (trend) {
      case 'up': return <TrendingUp className="h-4 w-4" />;
      case 'down': return <TrendingDown className="h-4 w-4" />;
      default: return null;
    }
  };

  const colorClasses = {
    blue: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
    green: "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400",
    purple: "bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400",
    orange: "bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400",
    red: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
  };

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className={cn("p-2 rounded-full", colorClasses[color])}>
              {icon}
            </div>
          </div>
          {change && (
            <div className={cn("flex items-center space-x-1", getTrendColor())}>
              {getTrendIcon()}
              <span className="text-sm font-medium">{change}</span>
            </div>
          )}
        </div>
        <div className="mt-4">
          <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
          <p className="text-2xl font-bold text-foreground">{value}</p>
          {description && (
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface EmbeddedAnalyticsProps {
  module: 'tenants' | 'properties' | 'maintenance' | 'financial' | 'security' | 'workforce';
  data?: any;
}

export function EmbeddedAnalytics({ module, data }: EmbeddedAnalyticsProps) {
  const COLORS = ['#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6', '#f97316'];

  const { data: analyticsData } = useQuery({
    queryKey: ["/api/analytics", module],
    queryFn: async () => {
      const res = await apiRequest(`/api/analytics/${module}`);
      return res.json();
    },
    enabled: !data,
  });

  const displayData = data || analyticsData;

  const renderTenantAnalytics = () => {
    const tenantData = [
      { month: 'Jan', active: 45, new: 8, churned: 2 },
      { month: 'Feb', active: 51, new: 12, churned: 6 },
      { month: 'Mar', active: 48, new: 9, churned: 12 },
      { month: 'Apr', active: 52, new: 15, churned: 11 },
      { month: 'May', active: 58, new: 18, churned: 12 },
      { month: 'Jun', active: 64, new: 22, churned: 16 }
    ];

    const occupancyData = [
      { name: 'Occupied', value: 85, color: '#10b981' },
      { name: 'Vacant', value: 15, color: '#ef4444' }
    ];

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <AnalyticsWidget
            title="Total Tenants"
            value="64"
            change="+12%"
            trend="up"
            icon={<Users className="h-5 w-5" />}
            description="Active tenants this month"
            color="blue"
          />
          <AnalyticsWidget
            title="Occupancy Rate"
            value="85%"
            change="+3%"
            trend="up"
            icon={<Target className="h-5 w-5" />}
            description="Above industry average"
            color="green"
          />
          <AnalyticsWidget
            title="Avg Lease Duration"
            value="18 mo"
            change="+2 mo"
            trend="up"
            icon={<Calendar className="h-5 w-5" />}
            description="Tenant retention improving"
            color="purple"
          />
          <AnalyticsWidget
            title="Monthly Churn"
            value="16"
            change="-8%"
            trend="down"
            icon={<Activity className="h-5 w-5" />}
            description="Below target threshold"
            color="orange"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Tenant Growth Trend</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={tenantData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="active" stroke="#3b82f6" strokeWidth={2} />
                  <Line type="monotone" dataKey="new" stroke="#10b981" strokeWidth={2} />
                  <Line type="monotone" dataKey="churned" stroke="#ef4444" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Current Occupancy Status</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={occupancyData}
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${value}%`}
                  >
                    {occupancyData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  };

  const renderPropertyAnalytics = () => {
    const propertyData = (Array.isArray(displayData?.byProperty) ? displayData.byProperty : [])
      .map((p: any) => ({ name: p.property || p.name, occupancy: p.occupancy || p.occupancyRate || 0, revenue: p.revenue || 0, units: p.units || p.total || 0 }));

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <AnalyticsWidget
            title="Total Properties"
            value="5"
            change="+1"
            trend="up"
            icon={<Target className="h-5 w-5" />}
            description="Active properties managed"
            color="blue"
          />
          <AnalyticsWidget
            title="Avg Occupancy"
            value="87.6%"
            change="+2.1%"
            trend="up"
            icon={<Users className="h-5 w-5" />}
            description="Across all properties"
            color="green"
          />
          <AnalyticsWidget
            title="Monthly Revenue"
            value="KES 1.96M"
            change="+8.5%"
            trend="up"
            icon={<DollarSign className="h-5 w-5" />}
            description="Total property income"
            color="purple"
          />
          <AnalyticsWidget
            title="Maintenance Requests"
            value="23"
            change="-12%"
            trend="down"
            icon={<AlertTriangle className="h-5 w-5" />}
            description="Open requests"
            color="orange"
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Property Performance Dashboard</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={propertyData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis yAxisId="left" />
                <YAxis yAxisId="right" orientation="right" />
                <Tooltip />
                <Bar yAxisId="left" dataKey="occupancy" fill="#3b82f6" />
                <Bar yAxisId="right" dataKey="revenue" fill="#10b981" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    );
  };

  const renderMaintenanceAnalytics = () => {
    const maintenanceData = [
      { month: 'Jan', open: 12, inProgress: 8, completed: 15, urgent: 3 },
      { month: 'Feb', open: 18, inProgress: 12, completed: 20, urgent: 5 },
      { month: 'Mar', open: 15, inProgress: 10, completed: 18, urgent: 4 },
      { month: 'Apr', open: 22, inProgress: 15, completed: 25, urgent: 7 },
      { month: 'May', open: 19, inProgress: 13, completed: 22, urgent: 6 },
      { month: 'Jun', open: 23, inProgress: 16, completed: 28, urgent: 8 }
    ];

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <AnalyticsWidget
            title="Open Requests"
            value="23"
            change="+4"
            trend="up"
            icon={<AlertTriangle className="h-5 w-5" />}
            description="Pending maintenance"
            color="red"
          />
          <AnalyticsWidget
            title="In Progress"
            value="16"
            change="+3"
            trend="up"
            icon={<Clock className="h-5 w-5" />}
            description="Currently being resolved"
            color="orange"
          />
          <AnalyticsWidget
            title="Completed"
            value="28"
            change="+6"
            trend="up"
            icon={<CheckCircle className="h-5 w-5" />}
            description="This month"
            color="green"
          />
          <AnalyticsWidget
            title="Avg Resolution"
            value="3.2 days"
            change="-0.8"
            trend="down"
            icon={<Activity className="h-5 w-5" />}
            description="Response time improving"
            color="blue"
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Maintenance Request Trends</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={400}>
              <AreaChart data={maintenanceData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Area type="monotone" dataKey="open" stackId="1" stroke="#ef4444" fill="#ef4444" />
                <Area type="monotone" dataKey="inProgress" stackId="1" stroke="#f59e0b" fill="#f59e0b" />
                <Area type="monotone" dataKey="completed" stackId="1" stroke="#10b981" fill="#10b981" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    );
  };

  switch (module) {
    case 'tenants': return renderTenantAnalytics();
    case 'properties': return renderPropertyAnalytics();
    case 'maintenance': return renderMaintenanceAnalytics();
    default: return <div>Analytics module not implemented</div>;
  }
}
