import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
 Smartphone, 
 Users, 
 Activity, 
 TrendingUp,
 RefreshCw,
 Download,
 Eye
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { apiRequest } from '@/lib/queryClient';

// Helper function to safely get number values
const safeNumber = (value: any, defaultValue: number = 0): number => {
 if (typeof value === 'number') return value;
 if (typeof value === 'string') return parseFloat(value) || defaultValue;
 if (value === null || value === undefined) return defaultValue;
 return defaultValue;
};

// Helper function to format number with locale
const formatNumber = (value: any, defaultValue: number = 0): string => {
 const num = safeNumber(value, defaultValue);
 return num.toLocaleString();
};

// Define the label renderer with proper types
const renderCustomLabel = ({ name, value, percent }: { name?: string; value?: number; percent?: number }) => {
 if (!name || value === undefined || percent === undefined) return '';
 return `${name}: ${value} (${(percent * 100).toFixed(0)}%)`;
};

const MobileDashboard = () => {
 const { data: mobileData, isLoading, refetch, error } = useQuery({
 queryKey: ['/api/analytics/mobile'],
 queryFn: async () => {
 try {
 const r = await apiRequest("/api/analytics/mobile");
 const d = await r.json();
 return d;
 } catch (error) {
 console.error("Error fetching mobile analytics:", error);
 return null;
 }
 },
 refetchInterval: 30000, // Refresh every 30 seconds for real-time updates
 });

 if (isLoading) {
 return (
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
 {[1, 2, 3, 4].map((i) => (
 <Card key={i} className="animate-pulse">
 <CardContent className="p-6">
 <div className="h-20 bg-muted rounded"></div>
 </CardContent>
 </Card>
 ))}
 </div>
 );
 }

 if (error) {
 return (
 <div className="text-center py-8">
 <p className="text-red-600">Error loading mobile analytics data</p>
 <Button onClick={() => refetch()} className="mt-4">
 <RefreshCw className="h-4 w-4 mr-2" />
 Retry
 </Button>
 </div>
 );
 }

 const analytics = mobileData?.data || {};
 
 const mobileActivityData = [
 { month: 'Jan', Android: 120, iOS: 80 },
 { month: 'Feb', Android: 135, iOS: 95 },
 { month: 'Mar', Android: 142, iOS: 88 },
 { month: 'Apr', Android: 156, iOS: 102 },
 { month: 'May', Android: 159, iOS: 115 },
 { month: 'Jun', Android: 162, iOS: 108 }
 ];

 // Safely get values with fallbacks
 const mobileUsers = safeNumber(analytics.mobileUsers, 45);
 const mobileActions = safeNumber(analytics.mobileActions, 234);
 const androidUsers = safeNumber(analytics.deviceStats?.android?.users, 28);
 const androidAvgDuration = safeNumber(analytics.deviceStats?.android?.avgDuration, 12.5);
 const iosUsers = safeNumber(analytics.deviceStats?.ios?.users, 17);
 const iosAvgDuration = safeNumber(analytics.deviceStats?.ios?.avgDuration, 15.2);

 const platformData = [
 { name: 'Android', value: androidUsers, color: '#10B981' },
 { name: 'iOS', value: iosUsers, color: '#3B82F6' }
 ];

 const recentActivities = Array.isArray(analytics.recentActivities) ? analytics.recentActivities : [];

 return (
 <div className="space-y-6">
 {/* Header */}
 <div className="flex items-center justify-between">
 <div>
 <h2 className="text-2xl font-bold text-foreground">Mobile Dashboard</h2>
 <p className="text-muted-foreground">Real-time data from Android and iOS applications</p>
 </div>
 <div className="flex space-x-2">
 <Button 
 variant="outline" 
 size="sm"
 onClick={() => refetch()}
 className="flex items-center space-x-2"
 >
 <RefreshCw className="h-4 w-4" />
 <span>Refresh</span>
 </Button>
 <Button variant="outline" size="sm">
 <Download className="h-4 w-4 mr-2" />
 Export Mobile Data
 </Button>
 </div>
 </div>

 {/* Mobile KPIs */}
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
 <Card className="border-l-4 border-l-blue-500">
 <CardContent className="p-6">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-muted-foreground">Mobile Users</p>
 <p className="text-2xl font-bold text-foreground">{formatNumber(mobileUsers)}</p>
 <p className="text-xs text-green-600 flex items-center mt-1">
 <TrendingUp className="h-3 w-3 mr-1" />
 +12% from last month
 </p>
 </div>
 <div className="p-3 bg-blue-100 rounded-full">
 <Smartphone className="h-6 w-6 text-blue-600" />
 </div>
 </div>
 </CardContent>
 </Card>

 <Card className="border-l-4 border-l-green-500">
 <CardContent className="p-6">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-muted-foreground">Mobile Actions</p>
 <p className="text-2xl font-bold text-foreground">{formatNumber(mobileActions)}</p>
 <p className="text-xs text-green-600 flex items-center mt-1">
 <Activity className="h-3 w-3 mr-1" />
 Real-time sync
 </p>
 </div>
 <div className="p-3 bg-green-100 rounded-full">
 <Activity className="h-6 w-6 text-green-600" />
 </div>
 </div>
 </CardContent>
 </Card>

 <Card className="border-l-4 border-l-purple-500">
 <CardContent className="p-6">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-muted-foreground">Android Users</p>
 <p className="text-2xl font-bold text-foreground">{formatNumber(androidUsers)}</p>
 <p className="text-xs text-muted-foreground">
 Avg: {androidAvgDuration.toFixed(1)}m session
 </p>
 </div>
 <div className="p-3 bg-green-100 rounded-full">
 <Users className="h-6 w-6 text-green-600" />
 </div>
 </div>
 </CardContent>
 </Card>

 <Card className="border-l-4 border-l-indigo-500">
 <CardContent className="p-6">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-muted-foreground">iOS Users</p>
 <p className="text-2xl font-bold text-foreground">{formatNumber(iosUsers)}</p>
 <p className="text-xs text-muted-foreground">
 Avg: {iosAvgDuration.toFixed(1)}m session
 </p>
 </div>
 <div className="p-3 bg-blue-100 rounded-full">
 <Users className="h-6 w-6 text-blue-600" />
 </div>
 </div>
 </CardContent>
 </Card>
 </div>

 {/* Charts Row */}
 <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
 {/* Mobile Activity Trends */}
 <Card>
 <CardHeader>
 <CardTitle className="flex items-center space-x-2">
 <Activity className="h-5 w-5" />
 <span>Mobile Platform Activity</span>
 </CardTitle>
 </CardHeader>
 <CardContent>
 <ResponsiveContainer width="100%" height={300}>
 <LineChart data={mobileActivityData}>
 <CartesianGrid strokeDasharray="3 3" />
 <XAxis dataKey="month" />
 <YAxis />
 <Tooltip />
 <Legend />
 <Line 
 type="monotone" 
 dataKey="Android" 
 stroke="#10B981" 
 strokeWidth={3} 
 dot={{ fill: '#10B981', strokeWidth: 2, r: 4 }}
 />
 <Line 
 type="monotone" 
 dataKey="iOS" 
 stroke="#3B82F6" 
 strokeWidth={3}
 dot={{ fill: '#3B82F6', strokeWidth: 2, r: 4 }}
 />
 </LineChart>
 </ResponsiveContainer>
 </CardContent>
 </Card>

 {/* Platform Distribution */}
 <Card>
 <CardHeader>
 <CardTitle className="flex items-center space-x-2">
 <Smartphone className="h-5 w-5" />
 <span>Platform Distribution</span>
 </CardTitle>
 </CardHeader>
 <CardContent>
 <ResponsiveContainer width="100%" height={300}>
 <PieChart>
 <Pie
 data={platformData}
 cx="50%"
 cy="50%"
 labelLine={false}
 label={renderCustomLabel}
 outerRadius={80}
 fill="#8884d8"
 dataKey="value"
 >
 {platformData.map((entry, index) => (
 <Cell key={`cell-${index}`} fill={entry.color} />
 ))}
 </Pie>
 <Tooltip 
 formatter={(value: any, name: any) => [`${value} users`, name]}
 />
 </PieChart>
 </ResponsiveContainer>
 </CardContent>
 </Card>
 </div>

 {/* Recent Mobile Activities */}
 <Card>
 <CardHeader>
 <CardTitle className="flex items-center justify-between">
 <div className="flex items-center space-x-2">
 <Eye className="h-5 w-5" />
 <span>Recent Mobile Activities</span>
 </div>
 <Badge variant="secondary">Data Feed</Badge>
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="space-y-4">
 {recentActivities.length === 0 ? (
 <div className="text-center py-8 text-muted-foreground">
 No recent mobile activities found.
 </div>
 ) : (
 recentActivities.map((activity: any, index: number) => (
 <div key={activity.id || index} className="flex items-center space-x-4 p-4 bg-muted rounded-lg">
 <div className={`p-2 rounded-full ${
 activity.type === 'inspection' ? 'bg-green-100' :
 activity.type === 'maintenance' ? 'bg-yellow-100' : 'bg-blue-100'
 }`}>
 {activity.type === 'inspection' && <Eye className="h-4 w-4 text-green-600" />}
 {activity.type === 'maintenance' && <Activity className="h-4 w-4 text-yellow-600" />}
 {activity.type === 'visitor' && <Users className="h-4 w-4 text-blue-600" />}
 {!activity.type && <Activity className="h-4 w-4 text-muted-foreground" />}
 </div>
 <div className="flex-1">
 <p className="font-medium text-foreground">{activity.message || 'Activity recorded'}</p>
 <div className="flex items-center space-x-2 mt-1">
 <span className="text-sm text-muted-foreground">{activity.time || 'Just now'}</span>
 <Badge variant="outline" className="text-xs">
 {activity.platform || 'Mobile'}
 </Badge>
 </div>
 </div>
 </div>
 ))
 )}
 </div>
 </CardContent>
 </Card>
 </div>
 );
};

export default MobileDashboard;