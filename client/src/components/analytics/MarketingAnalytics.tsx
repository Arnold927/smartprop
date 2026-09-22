import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from 'recharts';
import { Send, Eye, MousePointer, Users, MessageCircle, Mail, Target, TrendingUp } from "lucide-react";

interface MarketingAnalyticsProps {
 timeframe?: '7d' | '30d' | '90d' | '1y';
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82ca9d'];

export function MarketingAnalytics({ timeframe = '30d' }: MarketingAnalyticsProps) {
 const { data: analytics, isLoading } = useQuery({
 queryKey: ['/api/analytics/marketing', timeframe],
 queryFn: async () => { const r = await apiRequest('/api/analytics/marketing'); return r.json(); },
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
 {/* Marketing KPIs */}
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
 <Card>
 <CardContent className="p-4">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-muted-foreground">Campaigns Sent</p>
 <p className="text-2xl font-bold text-foreground">{data.campaignsSent}</p>
 <div className="flex items-center mt-1">
 <TrendingUp className="h-4 w-4 text-green-600 mr-1" />
 <span className="text-sm text-green-600">+23.7%</span>
 </div>
 </div>
 <Send className="h-8 w-8 text-blue-600" />
 </div>
 </CardContent>
 </Card>

 <Card>
 <CardContent className="p-4">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-muted-foreground">Average Open Rate</p>
 <p className="text-2xl font-bold text-foreground">{data.avgOpenRate}%</p>
 <p className="text-sm text-green-600">Above industry avg</p>
 </div>
 <Eye className="h-8 w-8 text-green-600" />
 </div>
 <Progress value={data.avgOpenRate} className="mt-3" />
 </CardContent>
 </Card>

 <Card>
 <CardContent className="p-4">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-muted-foreground">Click Rate</p>
 <p className="text-2xl font-bold text-foreground">{data.avgClickRate}%</p>
 <p className="text-sm text-blue-600">Strong engagement</p>
 </div>
 <MousePointer className="h-8 w-8 text-purple-600" />
 </div>
 <Progress value={data.avgClickRate * 10} className="mt-3" />
 </CardContent>
 </Card>

 <Card>
 <CardContent className="p-4">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-muted-foreground">New Leads</p>
 <p className="text-2xl font-bold text-foreground">{data.newLeads}</p>
 <div className="flex items-center mt-1">
 <TrendingUp className="h-4 w-4 text-green-600 mr-1" />
 <span className="text-sm text-green-600">+30.8%</span>
 </div>
 </div>
 <Target className="h-8 w-8 text-orange-600" />
 </div>
 </CardContent>
 </Card>
 </div>

 {/* Charts Grid */}
 <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
 {/* Campaign Performance */}
 <Card>
 <CardHeader>
 <CardTitle>Campaign Performance</CardTitle>
 <CardDescription>Conversion funnel by campaign type</CardDescription>
 </CardHeader>
 <CardContent>
 <div className="h-64">
 <ResponsiveContainer width="100%" height="100%">
 <BarChart data={data.campaignPerformance}>
 <CartesianGrid strokeDasharray="3 3" />
 <XAxis dataKey="campaign" angle={-45} textAnchor="end" height={100} />
 <YAxis />
 <Tooltip />
 <Bar dataKey="sent" fill="#8884d8" name="Sent" />
 <Bar dataKey="opened" fill="#82ca9d" name="Opened" />
 <Bar dataKey="clicked" fill="#ffc658" name="Clicked" />
 <Bar dataKey="converted" fill="#ff7300" name="Converted" />
 </BarChart>
 </ResponsiveContainer>
 </div>
 </CardContent>
 </Card>

 {/* Monthly Trends */}
 <Card>
 <CardHeader>
 <CardTitle>Marketing Trends</CardTitle>
 <CardDescription>Monthly campaign reach and lead generation</CardDescription>
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
 <Line yAxisId="left" type="monotone" dataKey="reach" stroke="#8884d8" strokeWidth={2} name="Reach" />
 <Line yAxisId="left" type="monotone" dataKey="leads" stroke="#82ca9d" strokeWidth={2} name="Leads" />
 <Line yAxisId="right" type="monotone" dataKey="conversions" stroke="#ff7300" strokeWidth={2} name="Conversions" />
 </LineChart>
 </ResponsiveContainer>
 </div>
 </CardContent>
 </Card>

 {/* Channel Performance */}
 <Card>
 <CardHeader>
 <CardTitle>Channel Performance</CardTitle>
 <CardDescription>Marketing channel effectiveness and ROI</CardDescription>
 </CardHeader>
 <CardContent>
 <div className="space-y-4">
 {data.channelPerformance.map((channel: any, index: number) => (
 <div key={channel.channel} className="flex items-center justify-between p-3 bg-muted rounded-lg">
 <div className="flex items-center gap-3">
 <div
 className="w-4 h-4 rounded"
 style={{ backgroundColor: COLORS[index % COLORS.length] }}
 />
 <div>
 <p className="font-medium">{channel.channel}</p>
 <p className="text-sm text-muted-foreground">{channel.campaigns} campaigns • Open: {channel.openRate}%</p>
 </div>
 </div>
 <div className="text-right">
 <p className="font-medium">KES {channel.cost.toLocaleString()}</p>
 <p className="text-sm text-muted-foreground">Click: {channel.clickRate}%</p>
 </div>
 </div>
 ))}
 </div>
 </CardContent>
 </Card>

 {/* Lead Sources */}
 <Card>
 <CardHeader>
 <CardTitle>Lead Sources</CardTitle>
 <CardDescription>Where your leads are coming from</CardDescription>
 </CardHeader>
 <CardContent>
 <div className="h-64">
 <ResponsiveContainer width="100%" height="100%">
 <PieChart>
 <Pie
 data={data.leadSources}
 cx="50%"
 cy="50%"
 labelLine={false}
 label={({ source, percentage }: any) => `${source}: ${percentage}%`}
 outerRadius={80}
 fill="#8884d8"
 dataKey="leads"
 >
 {data.leadSources.map((entry: any, index: number) => (
 <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
 ))}
 </Pie>
 <Tooltip />
 </PieChart>
 </ResponsiveContainer>
 </div>
 </CardContent>
 </Card>
 </div>

 {/* Audience Segments */}
 <Card>
 <CardHeader>
 <CardTitle>Audience Segments</CardTitle>
 <CardDescription>Segment performance and engagement metrics</CardDescription>
 </CardHeader>
 <CardContent>
 <div className="space-y-4">
 {data.audienceSegments.map((segment: any, index: number) => (
 <div key={segment.segment} className="flex items-center justify-between p-4 border rounded-lg">
 <div className="flex items-center gap-4">
 <div className="flex items-center justify-center w-12 h-12 bg-blue-100 rounded-full">
 <Users className="h-6 w-6 text-blue-600" />
 </div>
 <div>
 <p className="font-medium">{segment.segment}</p>
 <p className="text-sm text-muted-foreground">{segment.size} contacts</p>
 </div>
 </div>
 <div className="flex items-center gap-6">
 <div className="text-center">
 <p className="text-lg font-bold text-foreground">{segment.engagement}%</p>
 <p className="text-xs text-muted-foreground">Engagement</p>
 </div>
 <div className="text-center">
 <p className="text-lg font-bold text-foreground">{segment.conversion}%</p>
 <p className="text-xs text-muted-foreground">Conversion</p>
 </div>
 <div className="w-20">
 <Progress value={segment.engagement} className="h-2" />
 </div>
 </div>
 </div>
 ))}
 </div>
 </CardContent>
 </Card>

 {/* Marketing Insights */}
 <Card>
 <CardHeader>
 <CardTitle>Marketing Insights</CardTitle>
 <CardDescription>AI-powered recommendations for marketing optimization</CardDescription>
 </CardHeader>
 <CardContent className="space-y-4">
 <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
 <div className="flex items-start gap-3">
 <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200">Excellent</Badge>
 <div>
 <p className="font-medium">WhatsApp dominance</p>
 <p className="text-sm text-muted-foreground">95.2% open rate on WhatsApp campaigns - highest performing channel</p>
 </div>
 </div>
 <div className="flex items-start gap-3">
 <Badge className="bg-blue-100 text-blue-800">Opportunity</Badge>
 <div>
 <p className="font-medium">Diaspora segment potential</p>
 <p className="text-sm text-muted-foreground">8.9% conversion rate suggests expanding diaspora-focused campaigns</p>
 </div>
 </div>
 <div className="flex items-start gap-3">
 <Badge className="bg-orange-100 text-orange-800">Action</Badge>
 <div>
 <p className="font-medium">Email optimization needed</p>
 <p className="text-sm text-muted-foreground">24.5% open rate below WhatsApp - consider A/B testing subject lines</p>
 </div>
 </div>
 </div>
 </CardContent>
 </Card>
 </div>
 );
}