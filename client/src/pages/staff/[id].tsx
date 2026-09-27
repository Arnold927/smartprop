import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, Clock, DollarSign, MapPin, Phone, Mail, Calendar, Building, ArrowLeft, User, Briefcase, Home, AlertTriangle, Edit } from "lucide-react";
import { formatCurrency } from "../../../../shared/currency";
import { format } from "date-fns";
import { Link, useRoute, useLocation } from "wouter";
import StaffFormModal, { type StaffFormData } from "../../components/staff-form-modal";
import { Download } from "lucide-react";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";

interface StaffMember {
 id: number;
 employee_id: string;
 first_name: string;
 last_name: string;
 email?: string;
 phone?: string;
 position: string;
 department: string;
 employment_type: string;
 hire_date: string;
 salary?: number;
 hourly_rate?: number;
 currency: string;
 status: string;
 photo_url?: string;
 address?: string;
 emergency_contact_name?: string;
 emergency_contact_phone?: string;
 created_at: string;
}

interface TimeTracking {
 id: number;
 staff_id: number;
 clock_in_time?: string;
 clock_out_time?: string;
 total_hours?: number;
 overtime_hours?: number;
 status: string;
}

interface PayrollRecord {
 id: number;
 staff_id: number;
 pay_period_start: string;
 pay_period_end: string;
 gross_pay?: number;
 net_pay?: number;
 payment_status: string;
}

const statusColors: Record<string, string> = {
 active: "bg-emerald-50 text-emerald-700 border border-emerald-200",
 inactive: "bg-muted dark:bg-gray-800 text-foreground dark:text-muted-foreground",
 terminated: "bg-red-100 text-red-800",
 on_leave: "bg-blue-100 text-blue-800"
};

export default function StaffDetailsPage() {
 const [, params] = useRoute("/staff/:id");
 const staffId = params?.id;
 const [, setLocation] = useLocation();
 const queryClient = useQueryClient();
 
 // State for edit modal
 const [isEditModalOpen, setIsEditModalOpen] = useState(false);

 // Fetch staff details
 const { data: staff = null, isLoading: staffLoading, error } = useQuery<StaffMember | null>({
 queryKey: [`/api/staff-members/${staffId}`],
 enabled: !!staffId,
 });

 // Fetch time records for this staff
 const { data: timeRecordsData } = useQuery<{ results: TimeTracking[]; count: number } | TimeTracking[]>({
 queryKey: [`/api/time-tracking/staff/${staffId}`],
 enabled: !!staffId,
 queryFn: async () => {
   const r = await apiRequest(`/api/time-tracking/staff/${staffId}`);
   if (!r.ok) return [];
   return r.json();
 },
 });
 const timeRecords: TimeTracking[] = Array.isArray(timeRecordsData)
   ? timeRecordsData
   : (timeRecordsData as any)?.results ?? [];

 // Fetch payroll records for this staff
 const { data: payrollRecordsData = [] } = useQuery<PayrollRecord[]>({
 queryKey: [`/api/payroll/staff/${staffId}`],
 enabled: !!staffId,
 queryFn: async () => {
   const r = await apiRequest(`/api/payroll/staff/${staffId}`);
   if (!r.ok) return [];
   return ensureArray(await r.json());
 },
 });
 const payrollRecords: PayrollRecord[] = Array.isArray(payrollRecordsData) ? payrollRecordsData : [];

 // Prepare form default values for editing
 const getStaffFormData = (): StaffFormData => {
 if (!staff) {
 return {
 employee_id: "",
 first_name: "",
 last_name: "",
 position: "",
 department: "",
 employment_type: "full_time",
 hire_date: "",
 status: "active",
 currency: "KES",
 address: "",
 phone: "",
 email: "",
 salary: undefined,
 hourly_rate: undefined,
 emergency_contact_name: "",
 emergency_contact_phone: "",
 };
 }

 return {
 employee_id: staff.employee_id,
 first_name: staff.first_name,
 last_name: staff.last_name,
 position: staff.position,
 department: staff.department,
 employment_type: staff.employment_type,
 hire_date: format(new Date(staff.hire_date), "yyyy-MM-dd"),
 status: staff.status,
 currency: staff.currency,
 address: staff.address || "",
 phone: staff.phone || "",
 email: staff.email || "",
 salary: staff.salary,
 hourly_rate: staff.hourly_rate,
 emergency_contact_name: staff.emergency_contact_name || "",
 emergency_contact_phone: staff.emergency_contact_phone || "",
 };
 };

 // Handle successful update
 const handleUpdateSuccess = () => {
 // Invalidate both the specific staff query and the staff list
 queryClient.invalidateQueries({ queryKey: [`/api/staff-members/${staffId}`] });
 queryClient.invalidateQueries({ queryKey: ["/api/staff-members"] });
 };

 const handleDownloadProfile = () => {
 if (!staff) return;

 // Create a clean object with only the necessary data
 const profileData = {
 "Staff Profile": `${staff.first_name} ${staff.last_name}`,
 "Employee ID": staff.employee_id,
 "Position": staff.position,
 "Department": staff.department.replace('_', ' '),
 "Status": staff.status,
 "Email": staff.email || 'Not provided',
 "Phone": staff.phone || 'Not provided',
 "Address": staff.address || 'Not provided',
 "Employment Type": staff.employment_type.replace('_', ' '),
 "Hire Date": format(new Date(staff.hire_date), 'MMMM dd, yyyy'),
 "Salary/Hourly Rate": staff.salary 
 ? `${formatCurrency(staff.salary, staff.currency as any)}/month`
 : staff.hourly_rate
 ? `${formatCurrency(staff.hourly_rate, staff.currency as any)}/hour`
 : 'Not set',
 "Currency": staff.currency,
 "Emergency Contact": staff.emergency_contact_name 
 ? `${staff.emergency_contact_name} (${staff.emergency_contact_phone || 'No phone'})`
 : 'Not provided',
 "Member Since": format(new Date(staff.created_at), 'MMMM dd, yyyy'),
 "Last Updated": new Date().toLocaleDateString()
 };

 // Convert to JSON string
 const jsonString = JSON.stringify(profileData, null, 2);
 
 // Create a blob from the JSON string
 const blob = new Blob([jsonString], { type: 'application/json' });
 
 // Create a download link
 const url = URL.createObjectURL(blob);
 const a = document.createElement('a');
 a.href = url;
 a.download = `staff-profile-${staff.employee_id}-${new Date().toISOString().split('T')[0]}.json`;
 
 // Trigger download
 document.body.appendChild(a);
 a.click();
 
 // Clean up
 document.body.removeChild(a);
 URL.revokeObjectURL(url);
 
};

 if (staffLoading) {
 return (
 <div className="container mx-auto p-6 flex flex-col items-center justify-center h-96">
 <div className="animate-spin w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full" />
 <p className="text-muted-foreground mt-4">Loading staff details...</p>
 </div>
 );
 }

 if (error || !staff) {
 return (
 <div className="container mx-auto p-6">
 <div className="flex flex-col items-center justify-center h-96 space-y-4">
 <AlertTriangle className="h-16 w-16 text-red-500" />
 <div className="text-center">
 <h3 className="text-xl font-semibold text-foreground">Staff Member Not Found</h3>
 <p className="text-muted-foreground mt-2">The staff member you're looking for doesn't exist or has been removed.</p>
 <Button 
 onClick={() => setLocation('/workforce-management')}
 className="mt-6 bg-emerald-600 hover:bg-emerald-700"
 >
 <ArrowLeft className="mr-2 h-4 w-4" />
 Back to Workforce
 </Button>
 </div>
 </div>
 </div>
 );
 }

 // Calculate stats — DB returns numeric columns as strings, coerce first
 const toNum = (v: unknown): number => {
   if (v === null || v === undefined || v === "") return 0;
   const n = typeof v === "number" ? v : parseFloat(String(v));
   return isFinite(n) ? n : 0;
 };
 const totalHours = timeRecords.reduce((sum, record) => sum + toNum(record.total_hours), 0);
 const totalOvertime = timeRecords.reduce((sum, record) => sum + toNum(record.overtime_hours), 0);
 const recentTimeRecords = (Array.isArray(timeRecords) ? timeRecords : []).slice(0, 5);
 const recentPayroll = (Array.isArray(payrollRecords) ? payrollRecords : []).slice(0, 5);

 // Stats cards
 const stats = [
 {
 title: "Total Hours",
 value: totalHours.toFixed(1),
 description: "All time logged",
 icon: <Clock className="h-5 w-5 text-blue-600" />,
 color: "text-blue-600",
 bgColor: "bg-blue-500/10"
 },
 {
 title: "Overtime",
 value: totalOvertime.toFixed(1),
 description: "Hours overtime",
 icon: <Clock className="h-5 w-5 text-orange-600" />,
 color: "text-orange-600",
 bgColor: "bg-orange-500/10"
 },
 {
 title: "Payroll",
 value: payrollRecords.length,
//  icon: <DollarSign className="h-5 w-5 text-green-600" />,
 description: "Payment records",
 color: "text-green-600",
 bgColor: "bg-green-500/10"
 },
 {
 title: "Status",
 value: staff.status.charAt(0).toUpperCase() + staff.status.slice(1),
 description: "Employment status",
 icon: <User className="h-5 w-5 text-purple-600" />,
 color: "text-purple-600",
 bgColor: "bg-purple-500/10"
 }
 ];

 return (
 <div className="container mx-auto p-6 space-y-6">
 {/* Header */}
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-4">
 <Link to="/workforce-management">
 <Button variant="outline" size="sm" className="border-border dark:border-gray-700 hover:bg-muted dark:hover:bg-gray-800">
 <ArrowLeft className="h-4 w-4 mr-2" />
 Back
 </Button>
 </Link>
 <div>
 <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
 <span>Dashboard</span>
 <span>•</span>
 <Link to="/workforce-management" className="hover:text-blue-600">
 Workforce
 </Link>
 <span>•</span>
 <span className="text-foreground font-medium">Staff Details</span>
 </div>
 <h1 className="text-3xl font-bold text-foreground">{staff.first_name} {staff.last_name}</h1>
 <div className="flex items-center gap-2 mt-1">
 <span className="text-muted-foreground">Employee ID: {staff.employee_id}</span>
 <Badge className={statusColors[staff.status]}>
 {staff.status.toUpperCase()}
 </Badge>
 </div>
 </div>
 </div>
 </div>

 {/* Profile Header */}
 <Card className="border border-border shadow-sm overflow-hidden">
 <div className="bg-gradient-to-r from-blue-600/10 to-indigo-600/10 dark:from-blue-500/20 dark:to-indigo-500/20 p-6">
 <div className="flex flex-col md:flex-row md:items-start gap-6">
 <div className="h-24 w-24 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 flex items-center justify-center">
 <span className="text-3xl font-bold text-white">
 {staff.first_name[0]}{staff.last_name[0]}
 </span>
 </div>
 <div className="flex-1">
 <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
 <div>
 <h2 className="text-2xl font-semibold text-foreground">{staff.first_name} {staff.last_name}</h2>
 <p className="text-muted-foreground">{staff.position} • {staff.department.replace('_', ' ')}</p>
 </div>
 <div className="text-right">
 <p className="text-lg font-bold text-foreground">
 {staff.salary 
 ? `${formatCurrency(staff.salary, staff.currency as any)}/mo`
 : staff.hourly_rate
 ? `${formatCurrency(staff.hourly_rate, staff.currency as any)}/hr`
 : 'Compensation not set'}
 </p>
 <p className="text-sm text-muted-foreground">
 {staff.employment_type.replace('_', ' ').toUpperCase()} • Hired {format(new Date(staff.hire_date), 'MMM dd, yyyy')}
 </p>
 </div>
 </div>
 </div>
 </div>
 </div>
 </Card>

 {/* Quick Stats */}
 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
 {stats.map((stat, index) => (
 <Card key={index} className="border border-border shadow-sm hover:shadow-md transition-shadow">
 <CardContent className="p-4">
 <div className="flex items-center justify-between">
 <div>
 <p className="text-sm font-medium text-muted-foreground">{stat.title}</p>
 <div className="flex items-baseline gap-2 mt-1">
 <span className="text-2xl font-semibold text-foreground">{stat.value}</span>
 </div>
 <p className="text-xs text-muted-foreground mt-2">{stat.description}</p>
 </div>
 <div className={`p-2 rounded-full ${stat.bgColor}`}>
 {stat.icon}
 </div>
 </div>
 </CardContent>
 </Card>
 ))}
 </div>

 <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
 {/* Left Column - Personal Information */}
 <div className="lg:col-span-2 space-y-6">
 {/* Contact Information */}
 <Card className="border border-border shadow-sm">
 <CardHeader className="pb-3">
 <CardTitle className="flex items-center gap-2">
 <User className="h-5 w-5 text-blue-600" />
 Contact Information
 </CardTitle>
 </CardHeader>
 <CardContent className="space-y-4">
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 <div className="space-y-1">
 <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Email</Label>
 <div className="flex items-center gap-2">
 <Mail className="h-4 w-4 text-muted-foreground" />
 <span className="text-foreground ">{staff.email || 'Not provided'}</span>
 </div>
 </div>
 <div className="space-y-1">
 <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Phone</Label>
 <div className="flex items-center gap-2">
 <Phone className="h-4 w-4 text-muted-foreground" />
 <span className="text-foreground ">{staff.phone || 'Not provided'}</span>
 </div>
 </div>
 {staff.address && (
 <div className="md:col-span-2 space-y-1">
 <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Address</Label>
 <div className="flex items-start gap-2">
 <Home className="h-4 w-4 text-muted-foreground mt-0.5" />
 <span className="text-foreground ">{staff.address}</span>
 </div>
 </div>
 )}
 </div>
 </CardContent>
 </Card>

 {/* Employment Details */}
 <Card className="border border-border shadow-sm">
 <CardHeader className="pb-3">
 <CardTitle className="flex items-center gap-2">
 <Briefcase className="h-5 w-5 text-green-600" />
 Employment Details
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="grid grid-cols-2 gap-4">
 <div className="space-y-1">
 <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Position</Label>
 <p className="text-foreground  font-medium">{staff.position}</p>
 </div>
 <div className="space-y-1">
 <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Department</Label>
 <Badge variant="outline" className="border-border text-foreground">
 {staff.department.replace('_', ' ')}
 </Badge>
 </div>
 <div className="space-y-1">
 <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Type</Label>
 <Badge variant="outline" className={
 staff.employment_type === 'full_time' ? 'border-green-300 text-green-700 bg-green-50' :
 staff.employment_type === 'part_time' ? 'border-blue-300 text-blue-700 bg-blue-50' :
 'border-border text-foreground'
 }>
 {staff.employment_type.replace('_', ' ').toUpperCase()}
 </Badge>
 </div>
 <div className="space-y-1">
 <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Hire Date</Label>
 <div className="flex items-center gap-2">
 <Calendar className="h-4 w-4 text-muted-foreground" />
 <span className="text-foreground ">{format(new Date(staff.hire_date), 'MMM dd, yyyy')}</span>
 </div>
 </div>
 </div>
 </CardContent>
 </Card>

 {/* Recent Time Records */}
 <Card className="border border-border shadow-sm">
 <CardHeader className="pb-3">
 <CardTitle className="flex items-center gap-2">
 <Clock className="h-5 w-5 text-orange-600" />
 Recent Time Records
 </CardTitle>
 <CardDescription>Last 5 time entries</CardDescription>
 </CardHeader>
 <CardContent>
 {recentTimeRecords.length === 0 ? (
 <div className="text-center py-8 text-muted-foreground">
 No time records found
 </div>
 ) : (
 <div className="space-y-3">
 {recentTimeRecords.map((record) => (
 <div key={record.id} className="flex items-center justify-between p-3 rounded-xl border border-slate-100 shadow-sm dark:border-gray-800 hover:bg-muted dark:hover:bg-gray-800">
 <div>
 <p className="text-sm font-medium text-foreground ">
 {record.clock_in_time ? format(new Date(record.clock_in_time), 'MMM dd, yyyy') : 'No date'}
 </p>
 <p className="text-xs text-muted-foreground">
 {record.clock_in_time && format(new Date(record.clock_in_time), 'HH:mm')} - 
 {record.clock_out_time ? format(new Date(record.clock_out_time), 'HH:mm') : 'Active'}
 </p>
 </div>
 <div className="text-right">
 <p className="text-sm font-medium text-foreground ">
 {toNum(record.total_hours).toFixed(1)}h
 </p>
 {toNum(record.overtime_hours) > 0 && (
 <p className="text-xs text-orange-600">+{toNum(record.overtime_hours).toFixed(1)}h OT</p>
 )}
 </div>
 </div>
 ))}
 </div>
 )}
 <Button variant="outline" className="w-full mt-4 border-border dark:border-gray-700 hover:bg-muted dark:hover:bg-gray-800">
 View All Time Records
 </Button>
 </CardContent>
 </Card>
 </div>

 {/* Right Column - Additional Info */}
 <div className="space-y-6">
 {/* Compensation */}
 <Card className="border border-border shadow-sm">
 <CardHeader className="pb-3">
 <CardTitle className="flex items-center gap-2">
 Compensation
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="space-y-4">
 <div className="space-y-1">
 <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Type</Label>
 <p className="text-foreground ">
 {staff.salary ? 'Monthly Salary' : staff.hourly_rate ? 'Hourly Rate' : 'Not set'}
 </p>
 </div>
 <div className="space-y-1">
 <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Amount</Label>
 <p className="text-2xl font-semibold text-foreground">
 {staff.salary 
 ? formatCurrency(staff.salary, staff.currency as any)
 : staff.hourly_rate
 ? formatCurrency(staff.hourly_rate, staff.currency as any)
 : 'N/A'}
 </p>
 <p className="text-sm text-muted-foreground">
 {staff.salary ? '/month' : staff.hourly_rate ? '/hour' : ''}
 </p>
 </div>
 <div className="space-y-1">
 <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Currency</Label>
 <Badge variant="outline" className="border-border">
 {staff.currency}
 </Badge>
 </div>
 </div>
 </CardContent>
 </Card>

 {/* Emergency Contact */}
 <Card className="border border-border shadow-sm">
 <CardHeader className="pb-3">
 <CardTitle className="flex items-center gap-2">
 <AlertTriangle className="h-5 w-5 text-red-600" />
 Emergency Contact
 </CardTitle>
 </CardHeader>
 <CardContent>
 {staff.emergency_contact_name ? (
 <div className="space-y-3">
 <div className="space-y-1">
 <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Name</Label>
 <p className="text-foreground ">{staff.emergency_contact_name}</p>
 </div>
 <div className="space-y-1">
 <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Phone</Label>
 <div className="flex items-center gap-2">
 <Phone className="h-4 w-4 text-muted-foreground" />
 <span className="text-foreground ">{staff.emergency_contact_phone}</span>
 </div>
 </div>
 </div>
 ) : (
 <div className="text-center py-4 text-muted-foreground">
 No emergency contact provided
 </div>
 )}
 </CardContent>
 </Card>

 {/* Recent Payroll */}
 <Card className="border border-border shadow-sm">
 <CardHeader className="pb-3">
 <CardTitle className="flex items-center gap-2">
 Recent Payroll
 </CardTitle>
 <CardDescription>Last 5 payments</CardDescription>
 </CardHeader>
 <CardContent>
 {recentPayroll.length === 0 ? (
 <div className="text-center py-8 text-muted-foreground">
 No payroll records found
 </div>
 ) : (
 <div className="space-y-3">
 {recentPayroll.map((record) => (
 <div key={record.id} className="flex items-center justify-between p-3 rounded-xl border border-slate-100 shadow-sm dark:border-gray-800 hover:bg-muted dark:hover:bg-gray-800">
 <div>
 <p className="text-sm font-medium text-foreground ">
 {format(new Date(record.pay_period_end), 'MMM yyyy')}
 </p>
 <p className="text-xs text-muted-foreground">
 {format(new Date(record.pay_period_start), 'dd')}-{format(new Date(record.pay_period_end), 'dd')}
 </p>
 </div>
 <div className="text-right">
 <p className="text-sm font-bold text-foreground ">
 {toNum(record.net_pay) ? formatCurrency(toNum(record.net_pay), staff.currency as any) : 'N/A'}
 </p>
  <Badge className={
   record.payment_status === 'paid' 
     ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
     : record.payment_status === 'pending'
     ? 'bg-yellow-100 text-yellow-800'
     : 'bg-muted text-foreground'
 }>
 {record.payment_status || 'Pending'}
 </Badge>
 </div>
 </div>
 ))}
 </div>
 )}
 <Button variant="outline" className="w-full mt-4 border-border dark:border-gray-700 hover:bg-muted dark:hover:bg-gray-800">
 View All Payroll
 </Button>
 </CardContent>
 </Card>
 </div>
 </div>

 {/* Bottom Actions */}
 <div className="flex items-center justify-between pt-6 border-t border-border">
 <div className="text-sm text-muted-foreground">
 Member since {format(new Date(staff.created_at), 'MMMM dd, yyyy')}
 </div>
 <div className="flex flex-wrap items-center justify-center gap-3">
 <Button 
 variant="outline" 
 className="border-border dark:border-gray-700 hover:bg-muted dark:hover:bg-gray-800"
 size="sm"
 onClick={handleDownloadProfile}
 >
 <Download className="h-4 w-4 sm:mr-2" />
 <span className="hidden sm:inline">Download Profile</span>
 <span className="sm:hidden">Download</span>
 </Button>
 <Button 
 onClick={() => setIsEditModalOpen(true)}
 className="bg-emerald-600 hover:bg-emerald-700"
 size="sm"
 >
 <Edit className="h-4 w-4 mr-2" />
 <span className="hidden sm:inline">Edit Profile</span>
 <span className="sm:hidden">Edit</span>
 </Button>
 </div>
 </div>

 {/* Edit Staff Modal */}
 {staff && (
 <StaffFormModal
 isOpen={isEditModalOpen}
 onOpenChange={setIsEditModalOpen}
 mode="edit"
 staffId={staff.id}
 defaultValues={getStaffFormData()}
 onSuccess={handleUpdateSuccess}
 />
 )}
 </div>
 );
}

// Label component for consistency
function Label({ children, className }: { children: React.ReactNode; className?: string }) {
 return (
 <label className={`block text-sm font-medium ${className}`}>
 {children}
 </label>
 );
}