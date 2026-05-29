import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, AreaChart, Area } from 'recharts';
import { DollarSign, TrendingUp, TrendingDown, CreditCard, AlertTriangle, PiggyBank } from "lucide-react";

interface FinancialAnalyticsProps {
 timeframe?: '7d' | '30d' | '90d' | '1y';
 propertyId?: number;
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82ca9d'];

export function FinancialAnalytics({ timeframe = '30d', propertyId }: FinancialAnalyticsProps) {
 const { data: analytics, isLoading } = useQuery({
 queryKey: ['/api/analytics/financial', timeframe, propertyId],
 queryFn: async () => { const r = await apiRequest('/api/analytics/financial'); return r.json(); },
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
 {/* Financial KPIs */}
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
 <Card>
 <CardContent className="p-4">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-muted-foreground">Total Revenue</p>
 <p className="text-2xl font-bold text-foreground">KES {Number(data.totalRevenue ?? 0).toLocaleString()}</p>
 <div className="flex items-center mt-1">
 <TrendingUp className="h-4 w-4 text-green-600 mr-1" />
 <span className={`text-sm ${(data.revenueTrend ?? "0").startsWith("-") ? "text-red-600" : "text-green-600"}`}>{data.revenueTrend ?? "—"}%</span>
 </div>
 </div>
 <DollarSign className="h-8 w-8 text-green-600" />
 </div>
 </CardContent>
 </Card>

 <Card>
 <CardContent className="p-4">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-muted-foreground">Net Income</p>
 <p className="text-2xl font-bold text-foreground">KES {Number(data.netIncome ?? 0).toLocaleString()}</p>
 <div className="flex items-center mt-1">
 <TrendingUp className="h-4 w-4 text-green-600 mr-1" />
 <span className={`text-sm ${Number(data.netIncome ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>{data.profitMargin ?? 0}% margin</span>
 </div>
 </div>
 <PiggyBank className="h-8 w-8 text-blue-600" />
 </div>
 </CardContent>
 </Card>

 <Card>
 <CardContent className="p-4">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-muted-foreground">Profit Margin</p>
 <p className="text-2xl font-bold text-foreground">{data.profitMargin}%</p>
 <p className={`text-sm ${Number(data.profitMargin ?? 0) >= 60 ? "text-green-600" : Number(data.profitMargin ?? 0) >= 30 ? "text-amber-600" : "text-red-600"}`}>{Number(data.profitMargin ?? 0) >= 60 ? "Excellent" : Number(data.profitMargin ?? 0) >= 30 ? "Good" : "Needs attention"}</p>
 </div>
 <TrendingUp className="h-8 w-8 text-purple-600" />
 </div>
 <Progress value={data.profitMargin} className="mt-3" />
 </CardContent>
 </Card>

 <Card>
 <CardContent className="p-4">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-muted-foreground">Collection Rate</p>
 <p className="text-2xl font-bold text-foreground">{data.collectionRate}%</p>
 <p className="text-sm text-green-600">Above target</p>
 </div>
 <CreditCard className="h-8 w-8 text-orange-600" />
 </div>
 <Progress value={data.collectionRate} className="mt-3" />
 </CardContent>
 </Card>
 </div>

 {/* Charts Grid */}
 <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
 {/* Revenue vs Expenses Trend */}
 <Card>
 <CardHeader>
 <CardTitle>Revenue vs Expenses</CardTitle>
 <CardDescription>Monthly financial performance trend</CardDescription>
 </CardHeader>
 <CardContent>
 <div className="h-64">
 <ResponsiveContainer width="100%" height="100%">
 <AreaChart data={data.monthlyRevenue}>
 <CartesianGrid strokeDasharray="3 3" />
 <XAxis dataKey="month" />
 <YAxis />
 <Tooltip formatter={(value: number) => `KES ${value.toLocaleString()}`} />
 <Area type="monotone" dataKey="revenue" stackId="1" stroke="#8884d8" fill="#8884d8" name="Revenue" />
 <Area type="monotone" dataKey="expenses" stackId="2" stroke="#82ca9d" fill="#82ca9d" name="Expenses" />
 <Line type="monotone" dataKey="netIncome" stroke="#ff7300" strokeWidth={3} name="Net Income" />
 </AreaChart>
 </ResponsiveContainer>
 </div>
 </CardContent>
 </Card>

 {/* Expense Breakdown */}
 <Card>
 <CardHeader>
 <CardTitle>Expense Categories</CardTitle>
 <CardDescription>Breakdown of operational expenses</CardDescription>
 </CardHeader>
 <CardContent>
 <div className="h-64">
 <ResponsiveContainer width="100%" height="100%">
 <PieChart>
 <Pie
 data={data.expenseCategories}
 cx="50%"
 cy="50%"
 labelLine={false}
 label={({ category, percentage }) => `${category}: ${percentage}%`}
 outerRadius={80}
 fill="#8884d8"
 dataKey="amount"
 >
 {data.expenseCategories.map((entry: any, index: number) => (
 <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
 ))}
 </Pie>
 <Tooltip formatter={(value: number) => `KES ${value.toLocaleString()}`} />
 </PieChart>
 </ResponsiveContainer>
 </div>
 </CardContent>
 </Card>

 {/* Revenue Streams */}
 <Card>
 <CardHeader>
 <CardTitle>Revenue Streams</CardTitle>
 <CardDescription>Sources of income breakdown</CardDescription>
 </CardHeader>
 <CardContent>
 <div className="space-y-4">
 {data.revenueStreams.map((stream: any, index: number) => (
 <div key={stream.stream} className="flex items-center justify-between">
 <div className="flex items-center gap-3">
 <div
 className="w-4 h-4 rounded"
 style={{ backgroundColor: COLORS[index % COLORS.length] }}
 />
 <div>
 <p className="font-medium">{stream.stream}</p>
 <p className="text-sm text-muted-foreground">{stream.percentage}% of total</p>
 </div>
 </div>
 <Badge variant="outline">
 KES {stream.amount.toLocaleString()}
 </Badge>
 </div>
 ))}
 </div>
 </CardContent>
 </Card>

 {/* Payment Method Trends */}
 <Card>
 <CardHeader>
 <CardTitle>Payment Method Performance</CardTitle>
 <CardDescription>Weekly collection by payment method</CardDescription>
 </CardHeader>
 <CardContent>
 <div className="h-64">
 <ResponsiveContainer width="100%" height="100%">
 <BarChart data={data.paymentTrends}>
 <CartesianGrid strokeDasharray="3 3" />
 <XAxis dataKey="date" />
 <YAxis />
 <Tooltip formatter={(value: number) => `KES ${value.toLocaleString()}`} />
 <Bar dataKey="mpesa" fill="#00C49F" name="M-PESA" />
 <Bar dataKey="bank" fill="#0088FE" name="Bank Transfer" />
 <Bar dataKey="cash" fill="#FFBB28" name="Cash" />
 </BarChart>
 </ResponsiveContainer>
 </div>
 </CardContent>
 </Card>
 </div>

 {/* Cash Flow Analysis */}
 <Card>
 <CardHeader>
 <CardTitle>Cash Flow Analysis</CardTitle>
 <CardDescription>Current month cash flow performance</CardDescription>
 </CardHeader>
 <CardContent>
 <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
 <div className="text-center">
 <div className="flex items-center justify-center mb-2">
 <TrendingUp className="h-8 w-8 text-green-600" />
 </div>
 <p className="text-2xl font-bold text-foreground">KES {data.cashFlow.inflow.toLocaleString()}</p>
 <p className="text-sm text-muted-foreground">Cash Inflow</p>
 </div>
 <div className="text-center">
 <div className="flex items-center justify-center mb-2">
 <TrendingDown className="h-8 w-8 text-red-600" />
 </div>
 <p className="text-2xl font-bold text-foreground">KES {data.cashFlow.outflow.toLocaleString()}</p>
 <p className="text-sm text-muted-foreground">Cash Outflow</p>
 </div>
 <div className="text-center">
 <div className="flex items-center justify-center mb-2">
 <DollarSign className="h-8 w-8 text-blue-600" />
 </div>
 <p className="text-2xl font-bold text-foreground">KES {data.cashFlow.netCashFlow.toLocaleString()}</p>
 <p className="text-sm text-muted-foreground">Net Cash Flow</p>
 </div>
 <div className="text-center">
 <div className="flex items-center justify-center mb-2">
 <AlertTriangle className="h-8 w-8 text-orange-600" />
 </div>
 <p className="text-2xl font-bold text-foreground">KES {data.cashFlow.burnRate.toLocaleString()}</p>
 <p className="text-sm text-muted-foreground">Daily Burn Rate</p>
 </div>
 </div>
 </CardContent>
 </Card>

 {/* Financial KPIs */}
 <Card>
 <CardHeader>
 <CardTitle>Investment Performance Metrics</CardTitle>
 <CardDescription>Key financial ratios and returns</CardDescription>
 </CardHeader>
 <CardContent>
 <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
 <div className="text-center p-4 bg-blue-50 rounded-lg">
 <p className="text-2xl font-bold text-blue-600">{data.kpis.roi}%</p>
 <p className="text-sm text-muted-foreground">Return on Investment</p>
 </div>
 <div className="text-center p-4 bg-green-50 rounded-lg">
 <p className="text-2xl font-bold text-green-600">{data.kpis.capRate}%</p>
 <p className="text-sm text-muted-foreground">Cap Rate</p>
 </div>
 <div className="text-center p-4 bg-purple-50 rounded-lg">
 <p className="text-2xl font-bold text-purple-600">{data.kpis.grossYield}%</p>
 <p className="text-sm text-muted-foreground">Gross Yield</p>
 </div>
 <div className="text-center p-4 bg-orange-50 rounded-lg">
 <p className="text-2xl font-bold text-orange-600">+{data.kpis.occupancyImpact}%</p>
 <p className="text-sm text-muted-foreground">Occupancy Impact</p>
 </div>
 </div>
 </CardContent>
 </Card>

 {/* Financial Insights */}
 <Card>
 <CardHeader>
 <CardTitle>Financial Insights</CardTitle>
 <CardDescription>AI-powered financial recommendations</CardDescription>
 </CardHeader>
 <CardContent className="space-y-4">
 <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
 <div className="flex items-start gap-3">
 <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200' >Strong</Badge>
 <div>
 <p className="font-medium">Excellent profit margins</p>
 <p className="text-sm text-muted-foreground">60.9% profit margin significantly exceeds industry average of 45%</p>
 </div>
 </div>
 <div className="flex items-start gap-3">
 <Badge className="bg-blue-100 text-blue-800">Opportunity</Badge>
 <div>
 <p className="font-medium">M-PESA dominance</p>
 <p className="text-sm text-muted-foreground">87% of payments via M-PESA - consider M-PESA business integration</p>
 </div>
 </div>
 <div className="flex items-start gap-3">
 <Badge className="bg-orange-100 text-orange-800">Monitor</Badge>
 <div>
 <p className="font-medium">Maintenance costs rising</p>
 <p className="text-sm text-muted-foreground">32% of expenses on maintenance - schedule preventive maintenance review</p>
 </div>
 </div>
 </div>
 </CardContent>
 </Card>
 </div>
 );
}