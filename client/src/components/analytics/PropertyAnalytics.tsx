import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from 'recharts';
import { TrendingUp, TrendingDown, DollarSign, Users, Home, AlertTriangle } from "lucide-react";

interface PropertyAnalyticsProps {
 propertyId?: number;
 timeframe?: '7d' | '30d' | '90d' | '1y';
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042'];

export function PropertyAnalytics({ propertyId, timeframe = '30d' }: PropertyAnalyticsProps) {
 const { data: analytics, isLoading } = useQuery({
 queryKey: ['/api/analytics/property', propertyId, timeframe],
 queryFn: async () => { const r = await apiRequest('/api/analytics/property'); return r.json(); },
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
 {/* Key Performance Indicators */}
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
 <Card>
 <CardContent className="p-4">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-muted-foreground">Occupancy Rate</p>
 <p className="text-2xl font-bold text-foreground">{data.occupancyRate}%</p>
 <div className="flex items-center mt-1">
 <TrendingUp className="h-4 w-4 text-green-600 mr-1" />
 <span className="text-sm text-green-600">+{data.trends.occupancy}%</span>
 </div>
 </div>
 <Home className="h-8 w-8 text-blue-600" />
 </div>
 <Progress value={data.occupancyRate} className="mt-3" />
 </CardContent>
 </Card>

 <Card>
 <CardContent className="p-4">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-muted-foreground">Rent Collection</p>
 <p className="text-2xl font-bold text-foreground">{data.rentCollection}%</p>
 <div className="flex items-center mt-1">
 <TrendingUp className="h-4 w-4 text-green-600 mr-1" />
 <span className="text-sm text-green-600">On track</span>
 </div>
 </div>
 <DollarSign className="h-8 w-8 text-green-600" />
 </div>
 <Progress value={data.rentCollection} className="mt-3" />
 </CardContent>
 </Card>

 <Card>
 <CardContent className="p-4">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-muted-foreground">Monthly Revenue</p>
 <p className="text-2xl font-bold text-foreground">KES {Number(data.revenue ?? 0).toLocaleString()}</p>
 <div className="flex items-center mt-1">
 <TrendingUp className="h-4 w-4 text-green-600 mr-1" />
 <span className="text-sm text-green-600">+{data.trends.revenue}%</span>
 </div>
 </div>
 <TrendingUp className="h-8 w-8 text-purple-600" />
 </div>
 </CardContent>
 </Card>

 <Card>
 <CardContent className="p-4">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-muted-foreground">Maintenance Costs</p>
 <p className="text-2xl font-bold text-foreground">KES {Number(data.maintenanceCosts ?? 0).toLocaleString()}</p>
 <div className="flex items-center mt-1">
 <TrendingDown className="h-4 w-4 text-green-600 mr-1" />
 <span className="text-sm text-green-600">{data.trends.maintenance}%</span>
 </div>
 </div>
 <AlertTriangle className="h-8 w-8 text-orange-600" />
 </div>
 </CardContent>
 </Card>
 </div>

 {/* Charts Grid */}
 <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
 {/* Revenue vs Expenses Trend */}
 <Card>
 <CardHeader>
 <CardTitle>Revenue vs Expenses</CardTitle>
 <CardDescription>Monthly financial performance over time</CardDescription>
 </CardHeader>
 <CardContent>
 <div className="h-64">
 <ResponsiveContainer width="100%" height="100%">
 <LineChart data={data.monthlyRevenue}>
 <CartesianGrid strokeDasharray="3 3" />
 <XAxis dataKey="month" />
 <YAxis />
 <Tooltip formatter={(value: any) => `KES ${Number(value ?? 0).toLocaleString()}`} />
 <Line type="monotone" dataKey="revenue" stroke="#8884d8" strokeWidth={2} name="Revenue" />
 <Line type="monotone" dataKey="expenses" stroke="#82ca9d" strokeWidth={2} name="Expenses" />
 </LineChart>
 </ResponsiveContainer>
 </div>
 </CardContent>
 </Card>

 {/* Unit Type Distribution */}
 <Card>
 <CardHeader>
 <CardTitle>Unit Type Distribution</CardTitle>
 <CardDescription>Breakdown of unit types in the property</CardDescription>
 </CardHeader>
 <CardContent>
 <div className="h-64">
 <ResponsiveContainer width="100%" height="100%">
 <PieChart>
 <Pie
 data={data.unitTypes}
 cx="50%"
 cy="50%"
 labelLine={false}
 label={({ name, value }) => `${name}: ${value}%`}
 outerRadius={80}
 fill="#8884d8"
 dataKey="value"
 >
 {data.unitTypes.map((entry: any, index: number) => (
 <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
 ))}
 </Pie>
 <Tooltip />
 </PieChart>
 </ResponsiveContainer>
 </div>
 </CardContent>
 </Card>

 {/* Maintenance by Category */}
 <Card>
 <CardHeader>
 <CardTitle>Maintenance Costs by Category</CardTitle>
 <CardDescription>Breakdown of maintenance expenses</CardDescription>
 </CardHeader>
 <CardContent>
 <div className="h-64">
 <ResponsiveContainer width="100%" height="100%">
 <BarChart data={data.maintenanceByCategory}>
 <CartesianGrid strokeDasharray="3 3" />
 <XAxis dataKey="category" />
 <YAxis />
 <Tooltip formatter={(value: any) => `KES ${Number(value ?? 0).toLocaleString()}`} />
 <Bar dataKey="amount" fill="#8884d8" />
 </BarChart>
 </ResponsiveContainer>
 </div>
 </CardContent>
 </Card>

 {/* Key Insights */}
 <Card>
 <CardHeader>
 <CardTitle>Key Insights</CardTitle>
 <CardDescription>AI-powered property performance insights</CardDescription>
 </CardHeader>
 <CardContent className="space-y-4">
 <div className="flex items-start gap-3">
 <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200">Positive</Badge>
 <div>
 <p className="font-medium">Strong occupancy rate</p>
 <p className="text-sm text-muted-foreground">At 85.2%, your property is performing above market average of 78%</p>
 </div>
 </div>
 <div className="flex items-start gap-3">
 <Badge className="bg-blue-100 text-blue-800">Insight</Badge>
 <div>
 <p className="font-medium">Maintenance efficiency improving</p>
 <p className="text-sm text-muted-foreground">12.4% reduction in maintenance costs compared to last month</p>
 </div>
 </div>
 <div className="flex items-start gap-3">
 <Badge className="bg-orange-100 text-orange-800">Opportunity</Badge>
 <div>
 <p className="font-medium">Revenue growth potential</p>
 <p className="text-sm text-muted-foreground">Consider rent adjustment for 2-bedroom units based on market analysis</p>
 </div>
 </div>
 </CardContent>
 </Card>
 </div>
 </div>
 );
}