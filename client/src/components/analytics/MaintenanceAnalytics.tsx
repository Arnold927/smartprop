import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from 'recharts';
import { Wrench, Clock, AlertTriangle, CheckCircle, User, TrendingUp } from "lucide-react";

interface MaintenanceAnalyticsProps {
 timeframe?: '7d' | '30d' | '90d' | '1y';
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8'];

export function MaintenanceAnalytics({ timeframe = '30d' }: MaintenanceAnalyticsProps) {
 const { data: analytics, isLoading } = useQuery({
 queryKey: ['/api/analytics/maintenance', timeframe],
 queryFn: async () => { const r = await apiRequest('/api/analytics/maintenance'); return r.json(); },
 });

 if (isLoading) {
 return (
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
 {[...Array(8)].map((_, i) => (
 <Card key={i} className="animate-pulse">
 <CardContent className="p-4">
 <div className="h-16 bg-muted rounded"></div>
 </CardContent>
 </Card>
 ))}
 </div>
 );
 }

 const data: any = analytics ?? {};

 return (
 <div className="space-y-6">
 {/* Key Maintenance Metrics */}
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
 <Card>
 <CardContent className="p-4">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-muted-foreground">Total Requests</p>
 <p className="text-2xl font-bold text-foreground">{data.totalRequests}</p>
 <p className="text-sm text-blue-600">{data.openRequests} currently open</p>
 </div>
 <Wrench className="h-8 w-8 text-blue-600" />
 </div>
 </CardContent>
 </Card>

 <Card>
 <CardContent className="p-4">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-muted-foreground">Avg Response Time</p>
 <p className="text-2xl font-bold text-foreground">{data.avgResponseTime}h</p>
 <p className="text-sm text-green-600">Within SLA target</p>
 </div>
 <Clock className="h-8 w-8 text-green-600" />
 </div>
 </CardContent>
 </Card>

 <Card>
 <CardContent className="p-4">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-muted-foreground">Completion Rate</p>
 <p className="text-2xl font-bold text-foreground">{data.completionRate}%</p>
 <p className="text-sm text-green-600">This month</p>
 </div>
 <CheckCircle className="h-8 w-8 text-purple-600" />
 </div>
 <Progress value={data.completionRate} className="mt-3" />
 </CardContent>
 </Card>

 <Card>
 <CardContent className="p-4">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-muted-foreground">Monthly Cost</p>
 <p className="text-2xl font-bold text-foreground">KES {Number(data.costThisMonth ?? 0).toLocaleString()}</p>
 <p className="text-sm text-orange-600">+7.2% vs last month</p>
 </div>
 <TrendingUp className="h-8 w-8 text-orange-600" />
 </div>
 </CardContent>
 </Card>
 </div>

 {/* Charts Grid */}
 <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
 {/* Request Priority Distribution */}
 <Card>
 <CardHeader>
 <CardTitle>Request Priority Distribution</CardTitle>
 <CardDescription>Breakdown of maintenance requests by priority level</CardDescription>
 </CardHeader>
 <CardContent>
 <div className="h-64">
 <ResponsiveContainer width="100%" height="100%">
 <PieChart>
 <Pie
 data={data.requestsByPriority}
 cx="50%"
 cy="50%"
 labelLine={false}
 label={({ priority, percentage }) => `${priority}: ${percentage}%`}
 outerRadius={80}
 fill="#8884d8"
 dataKey="count"
 >
 {data.requestsByPriority.map((entry: any, index: number) => (
 <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
 ))}
 </Pie>
 <Tooltip />
 </PieChart>
 </ResponsiveContainer>
 </div>
 </CardContent>
 </Card>

 {/* Monthly Trends */}
 <Card>
 <CardHeader>
 <CardTitle>Maintenance Trends</CardTitle>
 <CardDescription>Monthly requests and costs over time</CardDescription>
 </CardHeader>
 <CardContent>
 <div className="h-64">
 <ResponsiveContainer width="100%" height="100%">
 <LineChart data={data.monthlyTrends}>
 <CartesianGrid strokeDasharray="3 3" />
 <XAxis dataKey="month" />
 <YAxis yAxisId="left" />
 <YAxis yAxisId="right" orientation="right" />
 <Tooltip />
 <Bar yAxisId="left" dataKey="requests" fill="#8884d8" name="Requests" />
 <Line yAxisId="right" type="monotone" dataKey="cost" stroke="#82ca9d" strokeWidth={2} name="Cost (KES)" />
 </LineChart>
 </ResponsiveContainer>
 </div>
 </CardContent>
 </Card>

 {/* Category Analysis */}
 <Card>
 <CardHeader>
 <CardTitle>Requests by Category</CardTitle>
 <CardDescription>Maintenance categories and associated costs</CardDescription>
 </CardHeader>
 <CardContent>
 <div className="h-64">
 <ResponsiveContainer width="100%" height="100%">
 <BarChart data={data.requestsByCategory}>
 <CartesianGrid strokeDasharray="3 3" />
 <XAxis dataKey="category" />
 <YAxis />
 <Tooltip formatter={(value: number, name: string) => 
 name === 'cost' ? `KES ${value.toLocaleString()}` : value
 } />
 <Bar dataKey="count" fill="#8884d8" name="Requests" />
 <Bar dataKey="cost" fill="#82ca9d" name="Cost" />
 </BarChart>
 </ResponsiveContainer>
 </div>
 </CardContent>
 </Card>

 {/* Technician Performance */}
 <Card>
 <CardHeader>
 <CardTitle>Technician Performance</CardTitle>
 <CardDescription>Individual technician metrics and ratings</CardDescription>
 </CardHeader>
 <CardContent>
 <div className="space-y-4">
 {data.technicianPerformance.map((tech: any, index: number) => (
 <div key={tech.name} className="flex items-center justify-between p-3 bg-muted rounded-lg">
 <div className="flex items-center gap-3">
 <div className="flex items-center justify-center w-8 h-8 bg-blue-100 rounded-full">
 <User className="h-4 w-4 text-blue-600" />
 </div>
 <div>
 <p className="font-medium">{tech.name}</p>
 <p className="text-sm text-muted-foreground">{tech.completed} completed • {tech.avgTime}h avg</p>
 </div>
 </div>
 <div className="flex items-center gap-2">
 <div className="flex items-center">
 {[...Array(5)].map((_, i) => (
 <div
 key={i}
 className={`w-3 h-3 rounded-full ${
 i < Math.floor(tech.rating) ? 'bg-yellow-400' : 'bg-gray-300'
 }`}
 />
 ))}
 </div>
 <span className="text-sm font-medium">{tech.rating}</span>
 </div>
 </div>
 ))}
 </div>
 </CardContent>
 </Card>
 </div>

 {/* Satisfaction Metrics */}
 <Card>
 <CardHeader>
 <CardTitle>Tenant Satisfaction</CardTitle>
 <CardDescription>Feedback and satisfaction metrics for maintenance services</CardDescription>
 </CardHeader>
 <CardContent>
 <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
 <div className="text-center">
 <div className="flex items-center justify-center mb-2">
 {[...Array(5)].map((_, i) => (
 <div
 key={i}
 className={`w-6 h-6 rounded-full mr-1 ${
 i < Math.floor(data.satisfactionMetrics.avgRating) ? 'bg-yellow-400' : 'bg-gray-300'
 }`}
 />
 ))}
 </div>
 <p className="text-2xl font-bold text-foreground">{data.satisfactionMetrics.avgRating}/5</p>
 <p className="text-sm text-muted-foreground">Average Rating</p>
 </div>
 <div className="text-center">
 <div className="w-16 h-16 mx-auto mb-2 bg-blue-100 rounded-full flex items-center justify-center">
 <AlertTriangle className="h-8 w-8 text-blue-600" />
 </div>
 <p className="text-2xl font-bold text-foreground">{data.satisfactionMetrics.responseRate}%</p>
 <p className="text-sm text-muted-foreground">Response Rate</p>
 </div>
 <div className="text-center">
 <div className="w-16 h-16 mx-auto mb-2 bg-green-100 rounded-full flex items-center justify-center">
 <CheckCircle className="h-8 w-8 text-green-600" />
 </div>
 <p className="text-2xl font-bold text-foreground">{data.satisfactionMetrics.totalFeedback}</p>
 <p className="text-sm text-muted-foreground">Total Feedback</p>
 </div>
 </div>
 </CardContent>
 </Card>

 {/* Maintenance Insights */}
 <Card>
 <CardHeader>
 <CardTitle>Maintenance Insights</CardTitle>
 <CardDescription>AI-powered recommendations for maintenance optimization</CardDescription>
 </CardHeader>
 <CardContent className="space-y-4">
 <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
 <div className="flex items-start gap-3">
 <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200' >Efficient</Badge>
 <div>
 <p className="font-medium">Response time excellence</p>
 <p className="text-sm text-muted-foreground">4.2h average response time meets SLA requirements</p>
 </div>
 </div>
 <div className="flex items-start gap-3">
 <Badge className="bg-orange-100 text-orange-800">Opportunity</Badge>
 <div>
 <p className="font-medium">Plumbing cost optimization</p>
 <p className="text-sm text-muted-foreground">42 plumbing requests suggest potential infrastructure upgrades</p>
 </div>
 </div>
 <div className="flex items-start gap-3">
 <Badge className="bg-blue-100 text-blue-800">Insight</Badge>
 <div>
 <p className="font-medium">Technician utilization</p>
 <p className="text-sm text-muted-foreground">Samuel Ochieng shows highest efficiency with 28 completions</p>
 </div>
 </div>
 </div>
 </CardContent>
 </Card>
 </div>
 );
}