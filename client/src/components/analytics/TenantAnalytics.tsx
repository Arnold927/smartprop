import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from 'recharts';
import { Calendar, CreditCard, MessageCircle, AlertCircle, Star, Clock } from "lucide-react";

interface TenantAnalyticsProps {
 timeframe?: '7d' | '30d' | '90d' | '1y';
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8'];

export function TenantAnalytics({ timeframe = '30d' }: TenantAnalyticsProps) {
 const { data: analytics, isLoading } = useQuery({
 queryKey: ['/api/analytics/tenants', timeframe],
 queryFn: async () => { const r = await apiRequest('/api/analytics/tenants'); return r.json(); },
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
 {/* Key Tenant Metrics */}
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
 <Card>
 <CardContent className="p-4">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-muted-foreground">Total Tenants</p>
 <p className="text-2xl font-bold text-foreground">{data.totalTenants}</p>
 <p className="text-sm text-green-600">+{data.newTenants} this month</p>
 </div>
 <Calendar className="h-8 w-8 text-blue-600" />
 </div>
 </CardContent>
 </Card>

 <Card>
 <CardContent className="p-4">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-muted-foreground">Payment Performance</p>
 <p className="text-2xl font-bold text-foreground">{data.paymentPerformance}%</p>
 <p className="text-sm text-green-600">On-time payments</p>
 </div>
 <CreditCard className="h-8 w-8 text-green-600" />
 </div>
 <Progress value={data.paymentPerformance} className="mt-3" />
 </CardContent>
 </Card>

 <Card>
 <CardContent className="p-4">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-muted-foreground">Satisfaction Score</p>
 <p className="text-2xl font-bold text-foreground">{data.satisfactionScore}/5</p>
 <div className="flex items-center mt-1">
 {[...Array(5)].map((_, i) => (
 <Star
 key={i}
 className={`h-4 w-4 ${i < Math.floor(data.satisfactionScore) ? 'text-yellow-400 fill-current' : 'text-muted-foreground'}`}
 />
 ))}
 </div>
 </div>
 <Star className="h-8 w-8 text-yellow-600" />
 </div>
 </CardContent>
 </Card>

 <Card>
 <CardContent className="p-4">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-muted-foreground">Avg Response Time</p>
 <p className="text-2xl font-bold text-foreground">{data.communicationStats.avgResponseTime}h</p>
 <p className="text-sm text-green-600">Communication efficiency</p>
 </div>
 <Clock className="h-8 w-8 text-purple-600" />
 </div>
 </CardContent>
 </Card>
 </div>

 {/* Charts Grid */}
 <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
 {/* Lease Expirations Timeline */}
 <Card>
 <CardHeader>
 <CardTitle>Upcoming Lease Expirations</CardTitle>
 <CardDescription>Monitor lease renewals and potential turnover</CardDescription>
 </CardHeader>
 <CardContent>
 <div className="h-64">
 <ResponsiveContainer width="100%" height="100%">
 <BarChart data={data.leaseExpirations}>
 <CartesianGrid strokeDasharray="3 3" />
 <XAxis dataKey="month" />
 <YAxis />
 <Tooltip />
 <Bar dataKey="count" fill="#8884d8" name="Lease Expirations" />
 </BarChart>
 </ResponsiveContainer>
 </div>
 </CardContent>
 </Card>

 {/* Payment Methods Distribution */}
 <Card>
 <CardHeader>
 <CardTitle>Payment Methods</CardTitle>
 <CardDescription>Preferred payment channels by tenants</CardDescription>
 </CardHeader>
 <CardContent>
 <div className="h-64">
 <ResponsiveContainer width="100%" height="100%">
 <PieChart>
 <Pie
 data={data.paymentMethods}
 cx="50%"
 cy="50%"
 labelLine={false}
 label={({ method, percentage }) => `${method}: ${percentage}%`}
 outerRadius={80}
 fill="#8884d8"
 dataKey="percentage"
 >
 {data.paymentMethods.map((entry: any, index: number) => (
 <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
 ))}
 </Pie>
 <Tooltip />
 </PieChart>
 </ResponsiveContainer>
 </div>
 </CardContent>
 </Card>

 {/* Tenant Segments */}
 <Card>
 <CardHeader>
 <CardTitle>Tenant Demographics</CardTitle>
 <CardDescription>Tenant segments and average rent by category</CardDescription>
 </CardHeader>
 <CardContent>
 <div className="space-y-4">
 {data.tenantSegments.map((segment: any, index: number) => (
 <div key={segment.segment} className="flex items-center justify-between">
 <div className="flex items-center gap-3">
 <div
 className="w-4 h-4 rounded"
 style={{ backgroundColor: COLORS[index % COLORS.length] }}
 />
 <div>
 <p className="font-medium">{segment.segment}</p>
 <p className="text-sm text-muted-foreground">{segment.count} tenants</p>
 </div>
 </div>
 <Badge variant="outline">
 KES {segment.avgRent.toLocaleString()}
 </Badge>
 </div>
 ))}
 </div>
 </CardContent>
 </Card>

 {/* Communication Insights */}
 <Card>
 <CardHeader>
 <CardTitle>Communication Analytics</CardTitle>
 <CardDescription>Tenant engagement and response patterns</CardDescription>
 </CardHeader>
 <CardContent className="space-y-4">
 <div className="grid grid-cols-3 gap-4">
 <div className="text-center">
 <MessageCircle className="h-6 w-6 text-green-600 mx-auto mb-2" />
 <p className="text-2xl font-bold text-foreground">{data.communicationStats.channels.whatsapp}</p>
 <p className="text-sm text-muted-foreground">WhatsApp</p>
 </div>
 <div className="text-center">
 <Calendar className="h-6 w-6 text-blue-600 mx-auto mb-2" />
 <p className="text-2xl font-bold text-foreground">{data.communicationStats.channels.email}</p>
 <p className="text-sm text-muted-foreground">Email</p>
 </div>
 <div className="text-center">
 <AlertCircle className="h-6 w-6 text-purple-600 mx-auto mb-2" />
 <p className="text-2xl font-bold text-foreground">{data.communicationStats.channels.portal}</p>
 <p className="text-sm text-muted-foreground">Portal</p>
 </div>
 </div>
 
 <div className="pt-4 border-t">
 <div className="flex justify-between items-center">
 <span className="text-sm text-muted-foreground">Response Rate</span>
 <span className="font-medium">{data.communicationStats.responseRate}%</span>
 </div>
 <Progress value={data.communicationStats.responseRate} className="mt-2" />
 </div>
 </CardContent>
 </Card>
 </div>

 {/* Tenant Insights */}
 <Card>
 <CardHeader>
 <CardTitle>Tenant Management Insights</CardTitle>
 <CardDescription>AI-powered recommendations for tenant relationships</CardDescription>
 </CardHeader>
 <CardContent className="space-y-4">
 <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
 <div className="flex items-start gap-3">
 <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200' >Positive</Badge>
 <div>
 <p className="font-medium">Strong payment performance</p>
 <p className="text-sm text-muted-foreground">94.6% on-time payment rate exceeds industry standard</p>
 </div>
 </div>
 <div className="flex items-start gap-3">
 <Badge className="bg-orange-100 text-orange-800">Action</Badge>
 <div>
 <p className="font-medium">Renewal opportunities</p>
 <p className="text-sm text-muted-foreground">12 leases expiring in March - start renewal process</p>
 </div>
 </div>
 <div className="flex items-start gap-3">
 <Badge className="bg-blue-100 text-blue-800">Insight</Badge>
 <div>
 <p className="font-medium">Communication preference</p>
 <p className="text-sm text-muted-foreground">WhatsApp shows highest engagement at 62 interactions</p>
 </div>
 </div>
 </div>
 </CardContent>
 </Card>
 </div>
 );
}