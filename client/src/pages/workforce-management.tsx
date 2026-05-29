import { apiRequest, ensureArray } from "@/lib/queryClient";
import React, { useState, useEffect } from "react";
import { useTimeTracking } from "@/hooks/use-time-tracking";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Users, Clock, DollarSign, UserPlus, Download, Search, Filter, ChevronRight, ChevronDown, X, Calendar, Building, MapPin, Smartphone, Eye, MoreVertical,
 Settings, Save, RefreshCw
 } from "lucide-react";
import { formatCurrency } from "@shared/currency";
import { format } from "date-fns";
import { Link } from "wouter";
import StaffFormModal from "@/components/staff-form-modal";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
 property_id?: number;
 clock_in_time?: string;
 clock_out_time?: string;
 location_lat?: number;
 location_lng?: number;
 clock_in_method: string;
 clock_out_method?: string;
 total_hours?: number;
 overtime_hours?: number;
 break_time?: number;
 notes?: string;
 status: string;
 created_at: string;
 staff_name?: string;
 property_name?: string;
}

interface PayrollRecord {
 id: number;
 staff_id: number;
 pay_period_start: string;
 pay_period_end: string;
 regular_hours?: number;
 overtime_hours?: number;
 regular_pay?: number;
 overtime_pay?: number;
 bonus?: number;
 deductions?: number;
 gross_pay?: number;
 net_pay?: number;
 currency: string;
 payment_status: string;
 payment_date?: string;
 staff_name?: string;
}

type Property = {
 id: number;
 name: string;
 organization_id: number;
};


const statusColors: Record<string, string> = {
 active: "bg-emerald-50 text-emerald-700 border border-emerald-200",
 inactive: "bg-muted text-foreground",
 terminated: "bg-red-100 text-red-800",
 on_leave: "bg-blue-100 text-blue-800"
};

const timeStatusColors: Record<string, string> = {
 pending: "bg-yellow-100 text-yellow-800",
 approved: "bg-emerald-50 text-emerald-700 border border-emerald-200",
 rejected: "bg-red-100 text-red-800"
};

const paymentStatusColors: Record<string, string> = {
 pending: "bg-yellow-100 text-yellow-800",
 processed: "bg-blue-100 text-blue-800",
 paid: "bg-emerald-50 text-emerald-700 border border-emerald-200",
 failed: "bg-red-100 text-red-800"
};

/** Drizzle returns numeric DB columns as strings; coerce safely to number. */
const toNum = (v: unknown): number => {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isFinite(n) ? n : 0;
};

/** Format a Date as local YYYY-MM-DD (avoids UTC shift from toISOString). */
const localDateStr = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function WorkforceManagement() {
 const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null);
 const [isStaffFormOpen, setIsStaffFormOpen] = useState(false);
 const [activeTab, setActiveTab] = useState("overview");
 const [searchQuery, setSearchQuery] = useState("");
 const [departmentFilter, setDepartmentFilter] = useState<string>("all");
 const [statusFilter, setStatusFilter] = useState<string>("all");
 const [isClockDialogOpen, setIsClockDialogOpen] = useState(false);
 const [clockAction, setClockAction] = useState<"in" | "out">("in");
 const [clockNotes, setClockNotes] = useState("");
 const [breakTime, setBreakTime] = useState(0);
 const [selectedClockStaffId, setSelectedClockStaffId] = useState<number | null>(null);
 const [selectedPropertyId, setSelectedPropertyId] = useState<number | undefined>(undefined);
 const [activeTimeRecordId, setActiveTimeRecordId] = useState<number | null>(null);
 const [currentStaffId, setCurrentStaffId] = useState<number | null>(null);
 const [selectedLocation, setSelectedLocation] = useState<{ lat: number; lng: number } | null>(null);
 const [isAdmin, setIsAdmin] = useState(false);
 const [showStaffSelection, setShowStaffSelection] = useState(false);
 const { data: propertiesRaw = [], isLoading: loadingProperties } = useQuery<any>({
 queryKey: ["/api/properties"],
 queryFn: async () => { const r = await apiRequest("/api/properties"); return ensureArray(await r.json()); },
 staleTime: 5 * 60 * 1000,
 });
 const properties: Property[] = Array.isArray(propertiesRaw) ? propertiesRaw : (propertiesRaw?.results ?? []);
 const [organizationId, setOrganizationId] = useState<number | null>(null);
 const [isGettingLocation, setIsGettingLocation] = useState(false);
 const [lateArrivalThreshold, setLateArrivalThreshold] = useState({ hours: 9, minutes: 0 });
 const [earlyDepartureThreshold, setEarlyDepartureThreshold] = useState({ hours: 17, minutes: 0 });
 const [showTimeSettings, setShowTimeSettings] = useState(false);

 // Pagination state
 const [staffPage, setStaffPage] = useState(1);
 const [staffPageSize, setStaffPageSize] = useState(10);
 const [timeRecordsPage, setTimeRecordsPage] = useState(1);
 const [timeRecordsPageSize, setTimeRecordsPageSize] = useState(10);

 // Attendance summary drill-down
 const [attendanceDrillDown, setAttendanceDrillDown] = useState<"present" | "late" | "early" | "overtime" | null>(null);

 // Reports date filters — always use local YYYY-MM-DD to avoid UTC shift
 const [reportDatePreset, setReportDatePreset] = useState<"today" | "week" | "month" | "custom">("today");
 const [reportDateFrom, setReportDateFrom] = useState<string>(() => localDateStr(new Date()));
 const [reportDateTo, setReportDateTo] = useState<string>(() => localDateStr(new Date()));

 const applyReportPreset = (preset: "today" | "week" | "month" | "custom") => {
   const now = new Date();
   if (preset === "today") {
     const today = localDateStr(now);
     setReportDateFrom(today);
     setReportDateTo(today);
   } else if (preset === "week") {
     const start = new Date(now);
     const day = now.getDay();
     start.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
     start.setHours(0, 0, 0, 0);
     setReportDateFrom(localDateStr(start));
     setReportDateTo(localDateStr(now));
   } else if (preset === "month") {
     const start = new Date(now.getFullYear(), now.getMonth(), 1);
     setReportDateFrom(localDateStr(start));
     setReportDateTo(localDateStr(now));
   }
   setReportDatePreset(preset);
 };

 const queryClient = useQueryClient();
 const { toast } = useToast();

 // Properties fetched via useQuery above

 const isOrgLoading = organizationId === null || loadingProperties;
 const hasProperties = !isOrgLoading && properties.length > 0;
 const availableProperties = properties;
 const { data: staffMembers = [], isLoading: staffLoading } = useQuery<StaffMember[]>({
 queryKey: ["/api/staff-members"],
 queryFn: async () => {
   try {
     const r = await apiRequest("/api/staff-members");
     if (!r.ok) return [];
     return ensureArray(await r.json());
   } catch { return []; }
 },
 retry: false,
 refetchOnWindowFocus: true,
 });

 const { data: timeRecords = [], isLoading: timeLoading } = useQuery<TimeTracking[]>({
 queryKey: ["/api/time-tracking"],
 queryFn: async () => {
   try {
     const r = await apiRequest("/api/time-tracking");
     if (!r.ok) return [];
     return ensureArray(await r.json());
   } catch { return []; }
 },
 retry: false,
 refetchOnWindowFocus: true,
 refetchInterval: 60000,
 gcTime: 5*60*1000
 });

 const { data: payrollRecords = [], isLoading: payrollLoading } = useQuery<PayrollRecord[]>({
 queryKey: ["/api/payroll"],
 queryFn: async () => {
   try {
     const r = await apiRequest("/api/payroll");
     if (!r.ok) return [];
     return ensureArray(await r.json());
   } catch { return []; }
 },
 retry: false
 });

 const { data: workforceStats = [] } = useQuery({
 queryKey: ["/api/workforce/stats"],
 queryFn: async () => {
   try {
     const r = await apiRequest("/api/workforce/stats");
     if (!r.ok) return {};
     return ensureArray(await r.json());
   } catch { return {}; }
 },
 retry: false
 });

 const handleAddStaffSuccess = () => {
 queryClient.invalidateQueries({ queryKey: ["/api/staff-members"] });
 };

 const calculateOvertime = (clockInTime: string, clockOutTime: string, breakTime: number = 0): { totalHours: number, overtimeHours: number } => {
 const start = new Date(clockInTime);
 const end = new Date(clockOutTime);
 const totalMilliseconds = end.getTime() - start.getTime();
 const totalHours = (totalMilliseconds / (1000 * 60 * 60)) - toNum(breakTime);
 const standardHours = 8;
 const overtimeHours = Math.max(0, totalHours - standardHours);
 return {
 totalHours: Math.max(0, totalHours),
 overtimeHours: overtimeHours
 };
 };

 const totalStaff = staffMembers.length;
 const activeStaff = staffMembers.filter(s => s.status === 'active').length;

 // Determine if any overview filter is active
 const isFiltered = searchQuery !== "" || departmentFilter !== "all" || statusFilter !== "all";

 const filteredStaff = staffMembers.filter(staff => {
 const matchesSearch = searchQuery === "" || 
 staff.first_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
 staff.last_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
 staff.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
 staff.employee_id.toLowerCase().includes(searchQuery.toLowerCase());
 
 const matchesDepartment = departmentFilter === "all" || staff.department === departmentFilter;
 const matchesStatus = statusFilter === "all" || staff.status === statusFilter;
 
 return matchesSearch && matchesDepartment && matchesStatus;
 });



 // When filters are active, scope cards to filtered staff
 const displayStaff = isFiltered ? filteredStaff : staffMembers;
 const displayStaffIds = new Set(displayStaff.map(s => s.id));
 const displayActiveStaff = displayStaff.filter(s => s.status === 'active').length;

 const today = new Date().toDateString();
 const todayHours = timeRecords.filter(t =>
   t.clock_in_time && new Date(t.clock_in_time).toDateString() === today &&
   (!isFiltered || displayStaffIds.has(t.staff_id))
 ).reduce((sum, t) => sum + toNum(t.total_hours), 0);

 const pendingPayroll = (Array.isArray(payrollRecords) ? payrollRecords : []).filter((p: any) => p.payment_status === 'pending' || p.status === 'pending').length;

 const activeSessionsCount = timeRecords.filter(tr =>
   !tr.clock_out_time && (!isFiltered || displayStaffIds.has(tr.staff_id))
 ).length;

 
 const departments = Array.from(new Set((Array.isArray(staffMembers) ? staffMembers : []).map(staff => staff.department))).filter(Boolean);

 // Paginated slices
 const staffTotalPages = Math.max(1, Math.ceil(filteredStaff.length / staffPageSize));
 const pagedStaff = filteredStaff.slice((staffPage - 1) * staffPageSize, staffPage * staffPageSize);

 const sortedTimeRecords = (Array.isArray(timeRecords) ? timeRecords : [])
   .slice()
   .sort((a, b) => new Date(b.clock_in_time ?? 0).getTime() - new Date(a.clock_in_time ?? 0).getTime());
 const timeRecordsTotalPages = Math.max(1, Math.ceil(sortedTimeRecords.length / timeRecordsPageSize));
 const pagedTimeRecords = sortedTimeRecords.slice((timeRecordsPage - 1) * timeRecordsPageSize, timeRecordsPage * timeRecordsPageSize);
 
 // Fixed: Use the correct properties from useTimeTracking
 const { 
   useActiveSession, 
   clockInMutation, 
   clockOutMutation 
 } = useTimeTracking();

 // Derive loading states from mutations
 const isClockingIn = clockInMutation.isPending;
 const isClockingOut = clockOutMutation.isPending;

 // Create wrapper functions for the mutations
 const clockIn = async (data: any) => {
   return clockInMutation.mutateAsync(data);
 };

 const clockOut = async (data: any) => {
   return clockOutMutation.mutateAsync(data);
 };

 const { data: activeSession, refetch: refetchActiveSession } = useActiveSession(currentStaffId || undefined);
 const metricCards = [
 {
 title: isFiltered ? "Filtered Staff" : "Total Staff",
 value: displayStaff.length.toString(),
 icon: <Users className="h-6 w-6 text-blue-600" />,
 description: isFiltered
   ? `${displayActiveStaff} active · ${displayStaff.length} of ${totalStaff} shown`
   : `${activeStaff} active`,
 color: "text-blue-600",
 bgColor: "bg-blue-50"
 },
 {
 title: activeSession ? "Active Session" : "Today's Hours",
 value: activeSession 
 ? `${toNum(activeSession.duration_hours).toFixed(1)}h`
 : `${todayHours.toFixed(1)}h`,
 icon: <Clock className="h-6 w-6 text-green-600" />,
 description: activeSession 
 ? `Since ${activeSession.clock_in_time ? format(new Date(activeSession.clock_in_time), 'HH:mm') : ''}` 
 : "Total today",
 color: activeSession ? "text-green-600" : "text-green-600",
 bgColor: activeSession ? "bg-green-50" : "bg-green-50"
 },
 {
 title: "Active Locations",
 value: activeSessionsCount.toString(),
 icon: <MapPin className="h-6 w-6 text-purple-600" />,
 description: "Properties with staff",
 color: "text-purple-600",
 bgColor: "bg-purple-50"
 }
 ];

 useEffect(() => {
 if (!currentStaffId) return;
 
 const interval = setInterval(() => {
 refetchActiveSession();
 }, 30000);
 
 return () => clearInterval(interval);
 }, [currentStaffId, refetchActiveSession]);
 
 const decodeJWT = (token: string) => {
 try {
 const base64Url = token.split('.')[1];
 const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
 const jsonPayload = decodeURIComponent(
 atob(base64)
 .split('')
 .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
 .join('')
 );
 return JSON.parse(jsonPayload);
 } catch (error) {
 console.error("Failed to decode JWT:", error);
 return null;
 }
 };

 useEffect(() => {
 const fetchCurrentUser = async () => {
 try {
 const token = localStorage.getItem("access_token");
 
 if (token) {
 const decoded = decodeJWT(token); 
 if (decoded) {
 Object.keys(decoded).forEach(key => {
 });
 
 const orgFields = Object.keys(decoded).filter(key => 
 key.toLowerCase().includes('org') || 
 key.toLowerCase().includes('organization')
 );
 
 
 if (orgFields.length > 0) {
 orgFields.forEach(field => {
 });
 } else {
 }
 if (decoded.organizationId) setOrganizationId(Number(decoded.organizationId));
 
 if (decoded.role === 'admin') {
 setIsAdmin(true);
 }
 
 if (decoded.staff_id || decoded.sub) {
 const staffId = decoded.staff_id || decoded.sub;
 setCurrentStaffId(staffId);
 }
 } else {
 }
 } else {
 }
 } catch (error) {
 console.error("Failed to fetch current user:", error);
 }
 };
 
 fetchCurrentUser();
 }, []);

 const handleGetLocation = async () => {
 if (!navigator.geolocation) {
 toast({
 title: "Geolocation not supported",
 description: "Your browser doesn't support geolocation",
 variant: "destructive",
 });
 return null;
 }

 setIsGettingLocation(true);
 
 return new Promise<{ lat: number; lng: number } | null>((resolve) => {
 navigator.geolocation.getCurrentPosition(
 (position) => {
 const location = {
 lat: position.coords.latitude,
 lng: position.coords.longitude,
 };
 setSelectedLocation(location);
 setIsGettingLocation(false);
 resolve(location);
 },
 (error) => {
 setIsGettingLocation(false);
 const errorMessage = 
 error.code === 1 ? "Permission denied. Please enable location services." :
 error.code === 2 ? "Location unavailable. Please check your connection." :
 error.code === 3 ? "Location request timed out." :
 "Failed to get location.";
 
 toast({
 title: "Location Error",
 description: errorMessage,
 variant: "destructive",
 });
 resolve(null);
 },
 { 
 timeout: 10000, 
 enableHighAccuracy: true,
 maximumAge: 0 
 }
 );
 });
 };
 useEffect(() => {
 if (!activeSession) return;

 const sessionStart = new Date(activeSession.clock_in_time).getTime();
 const now = Date.now();
 const hoursElapsed = (now - sessionStart) / (1000 * 60 * 60);

 if (hoursElapsed >= 12 && hoursElapsed < 12.5) {
 toast({
 title: "Long Session Alert",
 description: "Your session has exceeded 12 hours. Please consider clocking out.",
 variant: "destructive",
 duration: 10000,
 });
 }
 }, [activeSession, toast]);

 const getStaffActiveSession = (staffId: number) => {
 return timeRecords.find(record => 
 record.staff_id === staffId && 
 !record.clock_out_time
 );
 };

 const hasActiveSession = currentStaffId ? 
 timeRecords.some(record => 
 record.staff_id === currentStaffId && 
 !record.clock_out_time
 ) : false;
 
 const handleClockInClick = async (staffId?: number) => {
 const targetStaffId = staffId || currentStaffId;
 
 if (!targetStaffId) {
 toast({
 title: "Error",
 description: "No staff member selected",
 variant: "destructive",
 });
 return;
 }
 
 const staffActiveSession = getStaffActiveSession(targetStaffId);
 if (staffActiveSession) {
 toast({
 title: "Already Clocked In",
 description: `${staffMembers.find(s => s.id === targetStaffId)?.first_name} is already clocked in since ${format(new Date(staffActiveSession.clock_in_time!), 'HH:mm')}`,
 variant: "destructive",
 });
 return;
 }
 
 setClockAction("in");
 setSelectedClockStaffId(targetStaffId);
 setIsClockDialogOpen(true);
 setClockNotes("");
 setBreakTime(0);
 setSelectedLocation(null);

 handleGetLocation();
 };

 const handleClockOutClick = async (staffId?: number) => {
 const targetStaffId = staffId || currentStaffId;
 
 if (!targetStaffId) {
 toast({
 title: "Error",
 description: "No staff member selected",
 variant: "destructive",
 });
 return;
 }
 
 const staffActiveSession = getStaffActiveSession(targetStaffId);
 if (!staffActiveSession) {
 toast({
 title: "Not Clocked In",
 description: `${staffMembers.find(s => s.id === targetStaffId)?.first_name} is not currently clocked in`,
 variant: "destructive",
 });
 return;
 }
 
 if (staffId && staffId !== currentStaffId && !isAdmin) {
 toast({
 title: "Cannot Clock Out",
 description: "You can only clock out your own active session",
 variant: "destructive",
 });
 return;
 }
 
 setClockAction("out");
 setActiveTimeRecordId(staffActiveSession.id);
 setSelectedClockStaffId(targetStaffId);
 setIsClockDialogOpen(true);
 setClockNotes("");
 setBreakTime(0);
 setSelectedLocation(null);

 handleGetLocation();
 };

 const handleExportReport = () => {
 try {
 let dataToExport: any[] = [];
 let filename = '';

 switch (activeTab) {
 case 'overview':
 dataToExport = filteredStaff;
 filename = `staff-report-${format(new Date(), 'yyyy-MM-dd')}.csv`;
 break;
 case 'time-tracking':
 dataToExport = timeRecords;
 filename = `time-tracking-${format(new Date(), 'yyyy-MM-dd')}.csv`;
 break;
 case 'payroll':
 dataToExport = payrollRecords;
 filename = `payroll-${format(new Date(), 'yyyy-MM-dd')}.csv`;
 break;
 case 'reports':
 dataToExport = generateReportData();
 filename = `workforce-report-${format(new Date(), 'yyyy-MM-dd')}.csv`;
 break;
 default:
 dataToExport = staffMembers;
 filename = `workforce-${format(new Date(), 'yyyy-MM-dd')}.csv`;
 }
 const csvContent = convertToCSV(dataToExport);
 downloadCSV(csvContent, filename);
 toast({
 title: "Export Successful",
 description: `${dataToExport.length} records exported to ${filename}`,
 duration: 3000,
 });

 } catch (error) {
 console.error('Export failed:', error);
 toast({
 title: "Export Failed",
 description: "Unable to generate report. Please try again.",
 variant: "destructive",
 duration: 3000,
 });
 }
 };

 const downloadCSV = (content: string, filename: string) => {
 const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
 const url = URL.createObjectURL(blob);
 const link = document.createElement('a');
 link.href = url;
 link.download = filename;
 link.style.display = 'none';
 
 document.body.appendChild(link);
 link.click();
 
 document.body.removeChild(link);
 URL.revokeObjectURL(url);
 };

 const convertToCSV = (data: any[]) => {
 if (data.length === 0) return '';
 
 const headers = Object.keys(data[0]).join(',');
 const rows = data.map(row => 
 Object.values(row).map(value => {
 if (value === null || value === undefined) return '';
 const stringValue = String(value);
 const escapedValue = stringValue.replace(/"/g, '""');
 if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) {
 return `"${escapedValue}"`;
 }
 return escapedValue;
 }).join(',')
 );
 
 return [headers, ...rows].join('\n');
 };

 const generateReportData = () => {
 const today = new Date().toDateString();
 
 return (Array.isArray(staffMembers) ? staffMembers : []).map(staff => {
 const todayRecords = timeRecords.filter(record => 
 record.staff_id === staff.id && 
 record.clock_in_time && 
 new Date(record.clock_in_time).toDateString() === today
 );
 
 const totalHoursToday = todayRecords.reduce((sum, record) => 
 sum + toNum(record.total_hours), 0
 );
 
 return {
 employee_id: staff.employee_id,
 name: `${staff.first_name} ${staff.last_name}`,
 department: staff.department,
 position: staff.position,
 status: staff.status,
 hire_date: staff.hire_date,
 email: staff.email || '',
 phone: staff.phone || '',
 hours_today: totalHoursToday.toFixed(2),
 is_clocked_in: getStaffActiveSession(staff.id) ? 'Yes' : 'No',
 employment_type: staff.employment_type,
 location: staff.address || 'N/A'
 };
 });
 };

 const handleConfirmClock = async () => {
 try {
 if (!selectedClockStaffId) {
 toast({
 title: "Error",
 description: "No staff member selected",
 variant: "destructive",
 });
 return;
 }

 // Always fetch a fresh location at submission time
 const freshLocation = await handleGetLocation();

 if (clockAction === "in") {
 await clockIn({
 staff_id: selectedClockStaffId,
 property_id: selectedPropertyId,
 clock_in_method: "web",
 notes: clockNotes,
 location_lat: freshLocation?.lat ?? undefined,
 location_lng: freshLocation?.lng ?? undefined,
 });
 } else {
 if (!activeTimeRecordId) {
 toast({
 title: "Error",
 description: "No active session found",
 variant: "destructive",
 });
 return;
 }

 await clockOut({
 time_tracking_id: activeTimeRecordId,
 clock_out_method: "web",
 notes: clockNotes,
 break_time: breakTime || 0,
 location_lat: freshLocation?.lat ?? undefined,
 location_lng: freshLocation?.lng ?? undefined,
 });
 }
 
 setIsClockDialogOpen(false);
 setClockNotes("");
 setBreakTime(0);
 setSelectedClockStaffId(null);
 setSelectedPropertyId(undefined);
 setActiveTimeRecordId(null);
 setSelectedLocation(null);
 
 } catch (error: any) {
 console.error("Clock error:", error);
 }
 };



 useEffect(() => {
 const savedLateArrival = localStorage.getItem('lateArrivalThreshold');
 const savedEarlyDeparture = localStorage.getItem('earlyDepartureThreshold');
 
 if (savedLateArrival) {
 try {
 setLateArrivalThreshold(JSON.parse(savedLateArrival));
 } catch (e) {
 console.error('Failed to parse late arrival threshold', e);
 }
 }
 
 if (savedEarlyDeparture) {
 try {
 setEarlyDepartureThreshold(JSON.parse(savedEarlyDeparture));
 } catch (e) {
 console.error('Failed to parse early departure threshold', e);
 }
 }
 }, []);


 return (
 <div className="container mx-auto p-4 space-y-6 max-w-full overflow-x-hidden">
 {/* Header */}
 <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
 <div className="min-w-0 flex-1">
 <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1 flex-wrap">
 <span>Dashboard</span>
 <ChevronRight className="h-3 w-3 flex-shrink-0" />
 <span>Workforce</span>
 <ChevronRight className="h-3 w-3 flex-shrink-0" />
 <span className="text-foreground font-medium truncate">Management</span>
 </div>
 <div className="flex items-center gap-3 flex-wrap">
 <h1 className="text-3xl font-bold text-foreground">Workforce Management</h1>
 </div>
 <p className="text-muted-foreground mt-2">Manage staff, track time, and process payroll</p>
 </div>
 <div className="flex items-center gap-3 flex-shrink-0">
 {activeSession && (
 <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-50 border border-green-200" >
 <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
 <span className="text-sm font-medium text-green-700 whitespace-nowrap">
 Clocked In
 </span>
 <span className="text-xs text-green-600 whitespace-nowrap">
 {activeSession.clock_in_time ? format(new Date(activeSession.clock_in_time), 'HH:mm') : ''}
 </span>
 {toNum(activeSession.duration_hours) > 0 && (
 <span className="text-xs text-green-600 whitespace-nowrap">
 ({toNum(activeSession.duration_hours).toFixed(1)}h)
 </span>
 )}
 </div>
 )}
 <Button variant="outline" className="border-border hover:bg-muted whitespace-nowrap" onClick={handleExportReport}>
 <Download className="h-4 w-4 mr-2" />
 Export
 </Button>
 <Button 
 onClick={() => setIsStaffFormOpen(true)}
 className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-md whitespace-nowrap"
 >
 <UserPlus className="mr-2 h-4 w-4" />
 Add Staff
 </Button>
 </div>
 </div>

 {/* Quick Stats */}
 <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
 {metricCards.map((metric, index) => (
 <Card key={index} className={`border-0 shadow-sm hover:shadow-md transition-shadow duration-200 ${index === 0 && isFiltered ? 'ring-1 ring-blue-300' : ''}`}>
 <CardContent className="p-4">
 <div className="flex items-center justify-between">
 <div className="min-w-0">
   <div className="flex items-center gap-2 mb-1">
     <p className="text-sm font-medium text-muted-foreground truncate">{metric.title}</p>
     {index === 0 && isFiltered && (
       <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 whitespace-nowrap flex-shrink-0">
         <Filter className="h-2.5 w-2.5" />
         Filtered
       </span>
     )}
   </div>
 <div className="flex items-baseline gap-2">
 <span className="text-2xl font-semibold text-foreground">{metric.value}</span>
 </div>
 <p className="text-xs text-muted-foreground mt-1 truncate">{metric.description}</p>
 </div>
 <div className={`p-3 rounded-full ${metric.bgColor} flex-shrink-0`}>
 {metric.icon}
 </div>
 </div>
 </CardContent>
 </Card>
 ))}
 </div>

 {/* Tabs Section */}
 <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
 <div className="bg-card rounded-xl border border-slate-100 shadow-sm p-1 overflow-x-auto">
 <TabsList className="grid w-full grid-cols-3 bg-transparent min-w-[400px]">
 <TabsTrigger 
 value="overview" 
 className="data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700 data-[state=active]:border-blue-200 border-transparent"
 >
 <Users className="h-4 w-4 mr-2 flex-shrink-0" />
 <span className="truncate">Staff Overview</span>
 </TabsTrigger>
 <TabsTrigger 
 value="time-tracking" 
 className="data-[state=active]:bg-green-50 data-[state=active]:text-green-700 data-[state=active]:border-green-200 border-transparent"
 >
 <Clock className="h-4 w-4 mr-2 flex-shrink-0" />
 <span className="truncate">Time Tracking</span>
 </TabsTrigger>
 <TabsTrigger 
 value="reports" 
 className="data-[state=active]:bg-purple-50 data-[state=active]:text-purple-700 data-[state=active]:border-purple-200 border-transparent"
 >
 <Building className="h-4 w-4 mr-2 flex-shrink-0" />
 <span className="truncate">Reports</span>
 </TabsTrigger>
 </TabsList>
 </div>

 {/* Staff Overview Tab */}
 <TabsContent value="overview" className="space-y-6">
 <Card className="border border-border shadow-sm">
 <CardHeader className="pb-3">
 <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
 <div>
 <CardTitle className="text-xl text-foreground">Staff Members</CardTitle>
 <CardDescription>Manage employee profiles</CardDescription>
 </div>
 <div className="flex flex-col sm:flex-row gap-3">
 <div className="relative">
 <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
 <Input
 placeholder="Search staff..."
 value={searchQuery}
 onChange={(e) => { setSearchQuery(e.target.value); setStaffPage(1); }}
 className="pl-9 border-border w-full sm:w-64"
 />
 </div>
 <div className="flex gap-2">
 <Select value={departmentFilter} onValueChange={(v) => { setDepartmentFilter(v); setStaffPage(1); }}>
 <SelectTrigger className="w-[140px] border-border">
 <Filter className="h-4 w-4 mr-2 flex-shrink-0" />
 <SelectValue placeholder="Dept" />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="all">All Depts</SelectItem>
 {departments.map(dept => (
 <SelectItem key={dept} value={dept} className="truncate">
 {dept.replace('_', ' ')}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setStaffPage(1); }}>
 <SelectTrigger className="w-[120px] border-border">
 <SelectValue placeholder="Status" />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="all">All</SelectItem>
 <SelectItem value="active">Active</SelectItem>
 <SelectItem value="inactive">Inactive</SelectItem>
 <SelectItem value="terminated">Terminated</SelectItem>
 <SelectItem value="on_leave">On Leave</SelectItem>
 </SelectContent>
 </Select>
 </div>
 </div>
 </div>
 </CardHeader>
 <CardContent className="p-0">
 {staffLoading ? (
 <div className="flex flex-col items-center justify-center h-64 space-y-4">
 <div className="animate-spin w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full" />
 <p className="text-muted-foreground">Loading staff members...</p>
 </div>
 ) : filteredStaff.length === 0 ? (
 <div className="flex flex-col items-center justify-center h-64 space-y-4">
 <Users className="h-16 w-16 text-muted-foreground" />
 <div className="text-center">
 <p className="text-muted-foreground font-medium">No staff members found</p>
 <p className="text-muted-foreground text-sm">Try adjusting your search or filters</p>
 </div>
 </div>
 ) : (
 <div className="rounded-xl border border-slate-100 shadow-sm overflow-hidden">
 <div className="overflow-x-auto">
 <Table>
 <TableHeader className="bg-muted">
 <TableRow>
 <TableHead className="font-semibold text-foreground whitespace-nowrap">Employee</TableHead>
 <TableHead className="font-semibold text-foreground whitespace-nowrap">Position</TableHead>
 <TableHead className="font-semibold text-foreground whitespace-nowrap">Dept</TableHead>
 <TableHead className="font-semibold text-foreground whitespace-nowrap">Type</TableHead>
 <TableHead className="font-semibold text-foreground whitespace-nowrap">Compensation</TableHead>
 <TableHead className="font-semibold text-foreground whitespace-nowrap">Status</TableHead>
 <TableHead className="font-semibold text-foreground whitespace-nowrap text-right">Actions</TableHead>
 </TableRow>
 </TableHeader>
 <TableBody>
 {pagedStaff.map((staff) => (
 <TableRow key={staff.id} className="hover:bg-muted transition-colors">
 <TableCell className="max-w-[200px]">
 <div className="flex items-center gap-2">
 <div className="h-8 w-8 rounded-full bg-gradient-to-r from-blue-100 to-indigo-100 flex items-center justify-center relative flex-shrink-0">
 <span className="font-semibold text-blue-700 text-sm">
 {staff.first_name[0]}{staff.last_name[0]}
 </span>
 {getStaffActiveSession(staff.id) && (
 <div className="absolute -top-1 -right-1">
 <div className="h-3 w-3 rounded-full bg-green-500 border-2 border-white animate-pulse" />
 </div>
 )}
 </div>
 <div className="min-w-0">
 <div className="font-medium text-foreground flex items-center gap-1 text-sm truncate">
 {staff.first_name} {staff.last_name}
 </div>
 <div className="text-xs text-muted-foreground truncate">
 ID: {staff.employee_id}
 </div>
 </div>
 </div>
 </TableCell>
 <TableCell>
 <div className="font-medium text-foreground text-sm truncate max-w-[120px]">{staff.position}</div>
 </TableCell>
 <TableCell>
 <Badge variant="outline" className="border-border text-foreground text-xs whitespace-nowrap">
 {staff.department.replace('_', ' ')}
 </Badge>
 </TableCell>
 <TableCell>
 <Badge variant="outline" className={`text-xs whitespace-nowrap ${
 staff.employment_type === 'full_time' ? 'border-green-300 text-green-700 bg-green-50' :
 staff.employment_type === 'part_time' ? 'border-blue-300 text-blue-700 bg-blue-50' :
 'border-border text-foreground'
 }`}>
 {staff.employment_type === 'full_time' ? 'FT' : 
 staff.employment_type === 'part_time' ? 'PT' : 
 staff.employment_type.replace('_', ' ')}
 </Badge>
 </TableCell>
 <TableCell>
 <div className="text-sm">
 <div className="font-medium text-foreground text-xs whitespace-nowrap">
 {staff.salary 
 ? `${formatCurrency(staff.salary, staff.currency as any)}/mo`
 : staff.hourly_rate
 ? `${formatCurrency(staff.hourly_rate, staff.currency as any)}/hr`
 : 'Not set'}
 </div>
 </div>
 </TableCell>
 <TableCell>
 <Badge className={`text-xs whitespace-nowrap ${
 staff.status === 'active' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
 staff.status === 'inactive' ? 'bg-muted text-foreground' :
 staff.status === 'terminated' ? 'bg-red-100 text-red-800' :
 'bg-blue-100 text-blue-800'
 }`}>
 {staff.status.replace('_', ' ')}
 </Badge>
 </TableCell>
 <TableCell className="text-right">
 <div className="flex items-center justify-end">
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
 <span className="sr-only">Open menu</span>
 <MoreVertical className="h-4 w-4" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-48">
 <DropdownMenuLabel>Actions</DropdownMenuLabel>
 <DropdownMenuSeparator />
 <Link to={`/staff/${staff.id}`}>
 <DropdownMenuItem className="cursor-pointer">
 <Eye className="mr-2 h-4 w-4" />
 View Profile
 </DropdownMenuItem>
 </Link>
 <DropdownMenuSeparator />
 {getStaffActiveSession(staff.id) ? (
 <DropdownMenuItem 
 onClick={() => handleClockOutClick(staff.id)}
 className="cursor-pointer text-red-600 focus:text-red-600 focus:bg-red-50"
 >
 <Clock className="mr-2 h-4 w-4" />
 Clock Out
 </DropdownMenuItem>
 ) : (
 <DropdownMenuItem 
 onClick={() => handleClockInClick(staff.id)}
 disabled={!isAdmin && staff.id !== currentStaffId}
 className={`cursor-pointer ${!isAdmin && staff.id !== currentStaffId ? 'opacity-50 cursor-not-allowed' : 'text-green-600 focus:text-green-600 focus:bg-green-50'}`}
 >
 <Clock className="mr-2 h-4 w-4" />
 Clock In
 </DropdownMenuItem>
 )}
 </DropdownMenuContent>
 </DropdownMenu>
 </div>
 </TableCell>
 </TableRow>
 ))}
 </TableBody>
 </Table>
 </div>
 </div>
 )}
 <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground px-6 pb-4">
 <div className="flex items-center gap-2">
   <span className="text-xs">Rows per page:</span>
   <Select
     value={String(staffPageSize)}
     onValueChange={(v) => { setStaffPageSize(Number(v)); setStaffPage(1); }}
   >
     <SelectTrigger className="h-7 w-16 text-xs border-border">
       <SelectValue />
     </SelectTrigger>
     <SelectContent>
       {[5, 10, 25, 50].map(n => (
         <SelectItem key={n} value={String(n)} className="text-xs">{n}</SelectItem>
       ))}
     </SelectContent>
   </Select>
   <span className="text-xs">
     {filteredStaff.length === 0 ? "0" : `${(staffPage - 1) * staffPageSize + 1}–${Math.min(staffPage * staffPageSize, filteredStaff.length)}`} of {filteredStaff.length}
   </span>
 </div>
 <div className="flex items-center gap-2">
   <Button
     variant="outline" size="sm" className="border-border"
     disabled={staffPage <= 1}
     onClick={() => setStaffPage(p => Math.max(1, p - 1))}
   >
     Previous
   </Button>
   <span className="text-xs px-1">{staffPage} / {staffTotalPages}</span>
   <Button
     variant="outline" size="sm" className="border-border"
     disabled={staffPage >= staffTotalPages}
     onClick={() => setStaffPage(p => Math.min(staffTotalPages, p + 1))}
   >
     Next
   </Button>
 </div>
 </div>
 </CardContent>
 </Card>
 </TabsContent>

 {/* Time Tracking Tab */}
 <TabsContent value="time-tracking" className="space-y-6">
 <Card className="border border-border shadow-sm">
 <CardHeader className="pb-3">
 <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
 <div>
 <CardTitle className="text-xl text-foreground">Time Tracking Records</CardTitle>
 <CardDescription>Monitor attendance and work hours</CardDescription>
 </div>
 <div className="flex items-center gap-3">
 <div className="flex items-center gap-2 text-sm text-muted-foreground whitespace-nowrap">
 <Calendar className="h-4 w-4 flex-shrink-0" />
 <span>{format(new Date(), 'MMM d, yyyy')}</span>
 </div>
 <Button 
 variant="outline" 
 className={`border-border whitespace-nowrap ${activeSession ? 'hover:bg-red-50 hover:text-red-700 hover:border-red-300' : 'hover:bg-green-50 hover:text-green-700 hover:border-green-300'}`}
 onClick={() => {
 if (isAdmin) {
 setShowStaffSelection(true);
 } else {
 if (activeSession) {
 handleClockOutClick();
 } else {
 handleClockInClick();
 }
 }
 }}
 disabled={isClockingIn || isClockingOut || (!currentStaffId && !isAdmin)}
 >
 <Clock className={`h-4 w-4 mr-2 ${activeSession ? 'text-red-600' : 'text-green-600'}`} />
 {activeSession ? "Clock Out" : "Clock In"}
 {isClockingIn || isClockingOut ? (
 <span className="ml-2 animate-spin">⏳</span>
 ) : null}
 </Button>
 
 </div>
 </div>
 </CardHeader>
 <CardContent className="p-0">
 {timeLoading ? (
 <div className="flex flex-col items-center justify-center h-64 space-y-4">
 <div className="animate-spin w-10 h-10 border-4 border-green-600 border-t-transparent rounded-full" />
 <p className="text-muted-foreground">Loading time records...</p>
 </div>
 ) : (
 <div className="rounded-xl border border-border overflow-hidden">
 <div className="overflow-x-auto">
 <Table>
 <TableHeader className="bg-muted/60">
 <TableRow className="border-b border-border">
 <TableHead className="font-medium text-foreground py-3 whitespace-nowrap">Staff Member</TableHead>
 <TableHead className="font-medium text-foreground py-3 whitespace-nowrap">Property</TableHead>
 <TableHead className="font-medium text-foreground py-3 whitespace-nowrap">Time</TableHead>
 <TableHead className="font-medium text-foreground py-3 whitespace-nowrap">Hours</TableHead>
 <TableHead className="font-medium text-foreground py-3 whitespace-nowrap">Method</TableHead>
 <TableHead className="font-medium text-foreground py-3 whitespace-nowrap">Location</TableHead>
 </TableRow>
 </TableHeader>
 <TableBody>
 {pagedTimeRecords.map((record, index) => (
 <TableRow 
 key={record.id} 
 className={`hover:bg-muted/50 transition-colors duration-150 ${index !== pagedTimeRecords.length - 1 ? 'border-b border-border' : ''}`}
 >
 <TableCell className="py-3 max-w-[150px]">
 <div className="font-medium text-foreground text-sm truncate">{record.staff_name || `Staff ${record.staff_id}`}</div>
 </TableCell>
 <TableCell className="py-3 max-w-[120px]">
 <div className="flex items-center gap-1">
 <Building className="h-4 w-4 text-muted-foreground flex-shrink-0" />
 <span className="text-foreground text-sm truncate">{record.property_name || 'N/A'}</span>
 </div>
 </TableCell>
 <TableCell className="py-3">
 <div className="text-xs whitespace-nowrap">
 <div className="flex items-center gap-1">
 <span className="text-muted-foreground">In:</span>
 <span className="font-medium text-foreground">
 {record.clock_in_time ? format(new Date(record.clock_in_time), 'HH:mm') : '--:--'}
 </span>
 </div>
 <div className="flex items-center gap-1 mt-0.5">
 <span className="text-muted-foreground">Out:</span>
 <span className="font-medium text-foreground">
 {record.clock_out_time ? format(new Date(record.clock_out_time), 'HH:mm') : 'Active'}
 </span>
 </div>
 </div>
 </TableCell>
 <TableCell className="py-3">
 <div className="text-xs whitespace-nowrap">
 <div className="flex items-center gap-1">
 <span className="text-muted-foreground">Reg:</span>
 <span className="font-medium text-foreground">{toNum(record.total_hours).toFixed(1)}h</span>
 </div>
 {toNum(record.overtime_hours) > 0 && (
 <div className="flex items-center gap-1 mt-0.5">
 <span className="text-orange-600">OT:</span>
 <span className="font-medium text-orange-700">{toNum(record.overtime_hours).toFixed(1)}h</span>
 </div>
 )}
 </div>
 </TableCell>
 <TableCell className="py-3">
 <div className="flex items-center gap-1">
 <Smartphone className="h-4 w-4 text-blue-500 flex-shrink-0" />
 <span className="text-xs text-foreground capitalize">{record.clock_in_method}</span>
 </div>
 </TableCell>
 <TableCell className="py-3">
 {record.location_lat && record.location_lng ? (
 <Badge variant="outline" className="border-green-200 text-green-700 bg-green-50/80 text-xs whitespace-nowrap">
 <MapPin className="h-3 w-3 mr-1" />
 Geo
 </Badge>
 ) : (
 <Badge variant="outline" className="border-border text-muted-foreground bg-muted/80 text-xs whitespace-nowrap">
 No loc
 </Badge>
 )}
 </TableCell>
 </TableRow>
 ))}
 </TableBody>
 </Table>
 </div>
 </div>
 )}
 {sortedTimeRecords.length > 0 && (
   <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground px-6 pb-4">
     <div className="flex items-center gap-2">
       <span className="text-xs">Rows per page:</span>
       <Select
         value={String(timeRecordsPageSize)}
         onValueChange={(v) => { setTimeRecordsPageSize(Number(v)); setTimeRecordsPage(1); }}
       >
         <SelectTrigger className="h-7 w-16 text-xs border-border">
           <SelectValue />
         </SelectTrigger>
         <SelectContent>
           {[5, 10, 25, 50].map(n => (
             <SelectItem key={n} value={String(n)} className="text-xs">{n}</SelectItem>
           ))}
         </SelectContent>
       </Select>
       <span className="text-xs">
         {(timeRecordsPage - 1) * timeRecordsPageSize + 1}–{Math.min(timeRecordsPage * timeRecordsPageSize, sortedTimeRecords.length)} of {sortedTimeRecords.length}
       </span>
     </div>
     <div className="flex items-center gap-2">
       <Button variant="outline" size="sm" className="border-border" disabled={timeRecordsPage <= 1} onClick={() => setTimeRecordsPage(p => Math.max(1, p - 1))}>Previous</Button>
       <span className="text-xs px-1">{timeRecordsPage} / {timeRecordsTotalPages}</span>
       <Button variant="outline" size="sm" className="border-border" disabled={timeRecordsPage >= timeRecordsTotalPages} onClick={() => setTimeRecordsPage(p => Math.min(timeRecordsTotalPages, p + 1))}>Next</Button>
     </div>
   </div>
 )}
 </CardContent>
 </Card>
 </TabsContent>

 {/* Reports Tab */}
 <TabsContent value="reports" className="space-y-6">

 {/* Date Filter Bar */}
 <Card className="border border-border shadow-sm">
   <CardContent className="pt-4 pb-4">
     <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 flex-wrap">
       <div className="flex items-center gap-1.5 text-sm font-medium text-foreground shrink-0">
         <Calendar className="h-4 w-4 text-muted-foreground" />
         <span>Filter by date:</span>
       </div>
       <div className="flex items-center gap-1.5 flex-wrap">
         {(["today", "week", "month"] as const).map((preset) => (
           <Button
             key={preset}
             variant={reportDatePreset === preset ? "default" : "outline"}
             size="sm"
             className="h-8 text-xs"
             onClick={() => applyReportPreset(preset)}
           >
             {preset === "today" ? "Today" : preset === "week" ? "This Week" : "This Month"}
           </Button>
         ))}
         <Button
           variant={reportDatePreset === "custom" ? "default" : "outline"}
           size="sm"
           className="h-8 text-xs"
           onClick={() => setReportDatePreset("custom")}
         >
           Custom
         </Button>
       </div>
       {reportDatePreset === "custom" && (
         <div className="flex items-center gap-2 flex-wrap">
           <Input
             type="date"
             value={reportDateFrom}
             onChange={(e) => setReportDateFrom(e.target.value)}
             className="h-8 text-xs w-36 border-border"
           />
           <span className="text-xs text-muted-foreground">to</span>
           <Input
             type="date"
             value={reportDateTo}
             onChange={(e) => setReportDateTo(e.target.value)}
             className="h-8 text-xs w-36 border-border"
           />
         </div>
       )}
       {reportDatePreset !== "custom" && (
         <span className="text-xs text-muted-foreground ml-1">
           {reportDateFrom === reportDateTo
             ? format(new Date(reportDateFrom + "T00:00:00"), "MMM d, yyyy")
             : `${format(new Date(reportDateFrom + "T00:00:00"), "MMM d")} – ${format(new Date(reportDateTo + "T00:00:00"), "MMM d, yyyy")}`}
         </span>
       )}
     </div>
   </CardContent>
 </Card>

 <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
 <Card className="border border-border shadow-sm">
 <CardHeader className="pb-3">
 <div className="flex items-center justify-between">
 <CardTitle className="flex items-center gap-2 text-lg">
 <Users className="h-5 w-5 text-blue-600" />
 Attendance Summary
 </CardTitle>
 <Button
 variant="ghost"
 size="sm"
 className="h-8 w-8 p-0"
 onClick={() => setShowTimeSettings(true)}
 title="Configure time settings"
 >
 <Settings className="h-4 w-4" />
 </Button>
 </div>
 <div className="text-xs text-muted-foreground mb-2 flex items-center gap-2 flex-wrap">
 <div className="flex items-center gap-1">
 <span>Late after:</span>
 <Badge variant="outline" className="text-xs whitespace-nowrap">
 {String(lateArrivalThreshold.hours).padStart(2, '0')}:
 {String(lateArrivalThreshold.minutes).padStart(2, '0')} AM
 </Badge>
 </div>
 <div className="flex items-center gap-1">
 <span>Early before:</span>
 <Badge variant="outline" className="text-xs whitespace-nowrap">
 {String(earlyDepartureThreshold.hours).padStart(2, '0')}:
 {String(earlyDepartureThreshold.minutes).padStart(2, '0')} PM
 </Badge>
 </div>
 </div>
 </CardHeader>
 <CardContent>
 {(() => {
   const fromDate = new Date(reportDateFrom + "T00:00:00");
   const toDate = new Date(reportDateTo + "T23:59:59");

   const isInRange = (dateStr: string | undefined) => {
     if (!dateStr) return false;
     const d = new Date(dateStr);
     return d >= fromDate && d <= toDate;
   };

   const presentRecords = timeRecords.filter(record =>
     isInRange(record.clock_in_time)
   );
   const lateRecords = timeRecords.filter(record => {
     if (!record.clock_in_time || !isInRange(record.clock_in_time)) return false;
     const d = new Date(record.clock_in_time);
     return d.getHours() > lateArrivalThreshold.hours ||
       (d.getHours() === lateArrivalThreshold.hours && d.getMinutes() > lateArrivalThreshold.minutes);
   });
   const earlyRecords = timeRecords.filter(record => {
     if (!record.clock_out_time || !isInRange(record.clock_out_time)) return false;
     const d = new Date(record.clock_out_time);
     return d.getHours() < earlyDepartureThreshold.hours ||
       (d.getHours() === earlyDepartureThreshold.hours && d.getMinutes() < earlyDepartureThreshold.minutes);
   });
   const overtimeRecords = presentRecords.filter(record => toNum(record.overtime_hours) > 0);
   const totalOvertime = toNum(presentRecords.reduce((sum, r) => sum + toNum(r.overtime_hours), 0));

   const resolveStaff = (record: TimeTracking) => {
     if (record.staff_name) return record.staff_name;
     const s = staffMembers.find(m => m.id === record.staff_id);
     return s ? `${s.first_name} ${s.last_name}` : `Staff #${record.staff_id}`;
   };

   const rows: { key: "present"|"late"|"early"|"overtime"; label: string; value: string|number; color: string; bg: string; records: TimeTracking[] }[] = [
     { key: "present",  label: reportDateFrom === reportDateTo ? "Present Today" : "Present (Range)", value: presentRecords.length,          color: "text-green-600",  bg: "bg-green-50",  records: presentRecords },
     { key: "late",     label: "Late Arrivals",     value: lateRecords.length,             color: "text-orange-600", bg: "bg-orange-50", records: lateRecords },
     { key: "early",    label: "Early Departures",  value: earlyRecords.length,            color: "text-red-600",    bg: "bg-red-50",    records: earlyRecords },
     { key: "overtime", label: "Overtime Hours",    value: `${totalOvertime.toFixed(1)}h`, color: "text-blue-600",   bg: "bg-blue-50",   records: overtimeRecords },
   ];

   return (
     <div className="space-y-1">
       {rows.map(item => {
         const isOpen = attendanceDrillDown === item.key;
         const hasRecords = item.records.length > 0;
         return (
           <div key={item.key}>
             <button
               className={`w-full flex items-center justify-between p-3 rounded-lg transition-colors text-left ${hasRecords ? "cursor-pointer hover:bg-muted" : "cursor-default"} ${isOpen ? "bg-muted" : ""}`}
               onClick={() => hasRecords && setAttendanceDrillDown(isOpen ? null : item.key)}
             >
               <div className="flex items-center gap-2">
                 {hasRecords ? (
                   isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                 ) : (
                   <span className="w-3.5" />
                 )}
                 <span className="text-foreground text-sm">{item.label}</span>
               </div>
               <Badge className={`${item.bg} ${item.color} hover:${item.bg} text-sm`}>{item.value}</Badge>
             </button>

             {isOpen && (
               <div className="mx-3 mb-2 rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                 <div className="bg-muted/50 px-3 py-2 flex items-center justify-between border-b border-border">
                   <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{item.label}</span>
                   <button onClick={() => setAttendanceDrillDown(null)} className="text-muted-foreground hover:text-foreground">
                     <X className="h-3.5 w-3.5" />
                   </button>
                 </div>
                 <div className="divide-y divide-border max-h-56 overflow-y-auto">
                   {item.records.map(record => {
                     const name = resolveStaff(record);
                     const clockIn = record.clock_in_time ? format(new Date(record.clock_in_time), "HH:mm") : "--:--";
                     const clockOut = record.clock_out_time ? format(new Date(record.clock_out_time), "HH:mm") : "Active";
                     const initials = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
                     return (
                       <div key={record.id} className="flex items-center justify-between px-3 py-2 hover:bg-muted/40 transition-colors">
                         <div className="flex items-center gap-2 min-w-0">
                           <div className="h-7 w-7 rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 flex items-center justify-center flex-shrink-0">
                             <span className="text-xs font-semibold text-blue-700">{initials}</span>
                           </div>
                           <div className="min-w-0">
                             <div className="text-sm font-medium text-foreground truncate">{name}</div>
                             {record.property_name && (
                               <div className="text-xs text-muted-foreground truncate">{record.property_name}</div>
                             )}
                           </div>
                         </div>
                         <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                           {item.key === "overtime" && (
                             <Badge className="bg-orange-50 text-orange-600 hover:bg-orange-50 text-xs">
                               {toNum(record.overtime_hours).toFixed(1)}h OT
                             </Badge>
                           )}
                           <div className="text-xs text-muted-foreground whitespace-nowrap">
                             {clockIn} → {clockOut}
                           </div>
                         </div>
                       </div>
                     );
                   })}
                 </div>
               </div>
             )}
           </div>
         );
       })}
     </div>
   );
 })()}
 </CardContent>
 </Card>
 <Card className="border border-border shadow-sm">
 <CardHeader className="pb-3">
 <CardTitle className="flex items-center gap-2 text-lg">
 <Clock className="h-5 w-5 text-purple-600" />
 Hours Summary
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="space-y-3">
 {(() => {
 const fromDate = new Date(reportDateFrom + "T00:00:00");
 const toDate = new Date(reportDateTo + "T23:59:59");

 const filteredRecords = timeRecords.filter(record =>
   record.clock_in_time && new Date(record.clock_in_time) >= fromDate && new Date(record.clock_in_time) <= toDate
 );

const totalHours = toNum(filteredRecords.reduce((sum, record) => sum + toNum(record.total_hours), 0));
const totalOvertime = toNum(filteredRecords.reduce((sum, record) => sum + toNum(record.overtime_hours), 0));
const averageHours = filteredRecords.length > 0 ? toNum(totalHours / filteredRecords.length) : 0;

 return [
 { 
 label: "Total Hours", 
 value: `${totalHours.toFixed(1)}h`, 
 color: "text-purple-600", 
 bg: "bg-purple-50" 
 },
 { 
 label: "Total Overtime", 
 value: `${totalOvertime.toFixed(1)}h`, 
 color: "text-orange-600", 
 bg: "bg-orange-50" 
 },
 { 
 label: "Average Per Session", 
 value: `${averageHours.toFixed(1)}h`, 
 color: "text-blue-600", 
 bg: "bg-blue-50" 
 },
 { 
 label: "Staff w/ Overtime", 
 value: new Set(filteredRecords.filter(r => toNum(r.overtime_hours) > 0).map(r => r.staff_id)).size, 
 color: "text-red-600", 
 bg: "bg-red-50" 
 },
 ];
 })().map((item, index) => (
 <div key={index} className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors">
 <span className="text-foreground text-sm">{item.label}</span>
 <Badge className={`${item.bg} ${item.color} hover:${item.bg} text-sm`}>
 {item.value}
 </Badge>
 </div>
 ))}
 </div>
 </CardContent>
 </Card>
 </div>
 </TabsContent>
 </Tabs>

 <Dialog open={isClockDialogOpen} onOpenChange={setIsClockDialogOpen}>
 <DialogContent className="sm:max-w-xl bg-card border border-border shadow-xl rounded-xl">
 <DialogHeader>
 <DialogTitle className="text-lg font-semibold">
 {clockAction === "in" ? "Clock In" : "Clock Out"}
 </DialogTitle>
 <DialogDescription className="text-sm text-muted-foreground">
 {clockAction === "in"
 ? "Record your start time for the day"
 : "Record your end time for the day"}
 </DialogDescription>
 </DialogHeader>
 {clockAction === "in" && selectedClockStaffId && getStaffActiveSession(selectedClockStaffId) && (
 <div className="bg-red-50 border border-red-200 rounded-lg p-4">
 <div className="flex items-start gap-3">
 <div className="bg-red-100 p-2 rounded-full">
 <Clock className="h-4 w-4 text-red-600" />
 </div>
 <div>
 <p className="text-sm font-medium text-red-900">Already Clocked In</p>
 <p className="text-sm text-red-700 mt-1">
 This staff member is already clocked in. Please clock them out first.
 </p>
 </div>
 </div>
 </div>
 )}
 <div className="space-y-4 py-4">
 {isGettingLocation && (
 <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200" >
 <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full flex-shrink-0" />
 <p className="text-sm font-medium text-blue-700">Getting your location…</p>
 </div>
 )}

 {!isGettingLocation && selectedLocation && (
 <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 border border-green-200" >
 <MapPin className="h-4 w-4 text-green-600 flex-shrink-0" />
 <div className="text-sm min-w-0">
 <p className="font-medium text-green-700 truncate">Location captured</p>
 <p className="text-green-600 text-xs truncate">
 {selectedLocation.lat.toFixed(6)}, {selectedLocation.lng.toFixed(6)}
 </p>
 </div>
 <Button variant="ghost" size="sm" className="ml-auto text-xs flex-shrink-0"
 onClick={handleGetLocation} disabled={isGettingLocation}>
 Refresh
 </Button>
 </div>
 )}

 {!isGettingLocation && !selectedLocation && (
 <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-50 border border-yellow-200">
 <MapPin className="h-4 w-4 text-yellow-600 flex-shrink-0" />
 <div className="flex-1 min-w-0">
 <p className="text-sm font-medium text-yellow-700">Location not captured</p>
 <p className="text-xs text-yellow-600 truncate">
 {clockAction === "in" ? "Enable location for accurate attendance" : "Location will not be recorded for clock-out"}
 </p>
 </div>
 <Button variant="outline" size="sm"
 className="text-xs border-yellow-300 text-yellow-700 flex-shrink-0"
 onClick={handleGetLocation} disabled={isGettingLocation}>
 Get Location
 </Button>
 </div>
 )}

 {clockAction === "in" && (
 <div className="space-y-2">
 <Label className="text-sm text-foreground">
 Property (Optional)
 </Label>
 <Select
 value={selectedPropertyId?.toString()}
 onValueChange={(value) =>
 setSelectedPropertyId(value === "none" ? undefined : parseInt(value))
 }
 >
 <SelectTrigger className="border-border focus:ring-0 focus:border-border rounded-md">
 <SelectValue placeholder="Select property" />
 </SelectTrigger>
 <SelectContent className="border border-border shadow-lg rounded-lg bg-card mt-1 max-h-60 overflow-y-auto">
 {loadingProperties ? (
 <div className="px-4 py-3 text-sm text-muted-foreground flex items-center gap-2">
 <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
 Loading...
 </div>
 ) : hasProperties ? (
 <>
 <SelectItem value="none" className="px-4 py-3 hover:bg-muted cursor-pointer">
 <span className="text-muted-foreground">No property</span>
 </SelectItem>
 {availableProperties.map((property) => (
 <SelectItem
 key={property.id}
 value={String(property.id)}
 className="px-4 py-3 hover:bg-blue-50 cursor-pointer truncate"
 >
 {property.name}
 </SelectItem>
 ))}
 </>
 ) : (
 <div className="px-4 py-3 text-sm text-muted-foreground">
 No properties found
 </div>
 )}
 </SelectContent>
 </Select>
 </div>
 )}

 {clockAction === "in" ? (
 <div className="space-y-2">
 <Label className="text-sm text-foreground">
 Notes (Optional)
 </Label>
 <Textarea
 placeholder="Add any notes..."
 value={clockNotes}
 onChange={(e) => setClockNotes(e.target.value)}
 rows={2}
 className="border-border focus:ring-0 focus:border-border rounded-md"
 />
 </div>
 ) : (
 <>
 <div className="space-y-2">
 <Label className="text-sm text-foreground">
 Break Time (hours)
 </Label>
 <Input
 type="number"
 min="0"
 max="8"
 step="0.5"
 value={breakTime}
 onChange={(e) =>
 setBreakTime(parseFloat(e.target.value) || 0)
 }
 placeholder="Enter break time"
 className="border-border focus:ring-0 focus:border-border rounded-md"
 />
 </div>

 <div className="space-y-2">
 <Label className="text-sm text-foreground">
 Notes (Optional)
 </Label>
 <Textarea
 placeholder="Add any notes..."
 value={clockNotes}
 onChange={(e) => setClockNotes(e.target.value)}
 rows={2}
 className="border-border focus:ring-0 focus:border-border rounded-md"
 />
 </div>
 </>
 )}
 </div>

 <DialogFooter className="sm:justify-between">
 <Button variant="ghost" onClick={() => setIsClockDialogOpen(false)}>
 Cancel
 </Button>

 <Button
 onClick={handleConfirmClock}
 disabled={isClockingIn || isClockingOut || isGettingLocation}
 className={
 clockAction === "in"
 ? "bg-green-600 hover:bg-green-700"
 : "bg-blue-600 hover:bg-blue-700"
 }
 >
 {isClockingIn || isClockingOut ? (
 <>
 <span className="animate-spin mr-2">⏳</span>
 Processing...
 </>
 ) : isGettingLocation ? (
 <>
 <span className="animate-spin mr-2">⏳</span>
 Getting location...
 </>
 ) : (
 <>
 <Clock className="mr-2 h-4 w-4" />
 {clockAction === "in" ? "Clock In" : "Clock Out"}
 </>
 )}
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>


 <StaffFormModal
 isOpen={isStaffFormOpen}
 onOpenChange={setIsStaffFormOpen}
 mode="add"
 onSuccess={handleAddStaffSuccess}
 />

 <Dialog open={showStaffSelection} onOpenChange={setShowStaffSelection}>
 <DialogContent className="sm:max-w-xl bg-card rounded-xl shadow-xl border-0">
 <DialogHeader className="space-y-1 pb-2">
 <DialogTitle className="text-xl font-semibold text-foreground">
 Manage Staff Time
 </DialogTitle>
 <DialogDescription className="text-muted-foreground">
 Select a staff member to clock in or out
 </DialogDescription>
 </DialogHeader>
 
 <div className="space-y-6 py-4">
 <div className="space-y-3">
 <Label 
 htmlFor="staff-select" 
 className="text-sm font-medium text-foreground"
 >
 Staff Member
 </Label>
 <div className="relative">
 <Users className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
 <Select 
 onValueChange={(staffId) => {
 if (staffId) {
 const id = parseInt(staffId);
 const activeSession = getStaffActiveSession(id);
 
 setShowStaffSelection(false);
 
 setTimeout(() => {
 if (activeSession) {
 handleClockOutClick(id);
 } else {
 handleClockInClick(id);
 }
 }, 50);
 }
 }}
 >
 <SelectTrigger className="w-full pl-10 pr-4 h-11 border-2 border-border bg-muted hover:bg-card hover:border-blue-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 rounded-lg transition-all duration-200 shadow-sm">
 <SelectValue placeholder="Select staff member..." />
 </SelectTrigger>
 <SelectContent className="w-full border border-border shadow-lg rounded-lg bg-card mt-1 max-h-60 overflow-y-auto">
 {staffMembers
 .filter(staff => staff.status === 'active')
 .map(staff => {
 const activeSession = getStaffActiveSession(staff.id);
 const hasActiveSession = !!activeSession;
 
 return (
 <SelectItem 
 key={staff.id} 
 value={staff.id.toString()}
 className="px-4 py-3 hover:bg-blue-50 cursor-pointer transition-colors rounded-md focus:bg-blue-50 data-[state=checked]:bg-blue-50"
 >
 <div className="flex flex-col">
 <div className="flex items-center justify-between">
 <span className="font-medium text-foreground">
 {staff.first_name} {staff.last_name}
 </span>
 {hasActiveSession ? (
 <Badge className="bg-red-100 text-red-800 hover:bg-red-100 text-xs ml-2">
 Clock Out
 </Badge>
 ) : (
 <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200">
 Clock In
 </Badge>
 )}
 </div>
 <span className="text-sm text-muted-foreground">
 ID: {staff.employee_id}
 </span>
 {hasActiveSession && activeSession && (
 <span className="text-xs text-red-600 mt-1">
 Since {format(new Date(activeSession.clock_in_time!), 'HH:mm')}
 </span>
 )}
 </div>
 </SelectItem>
 );
 })}
 </SelectContent>
 </Select>
 </div>
 </div>
 
 <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
 <div className="flex items-start gap-3">
 <div className="bg-blue-100 p-2 rounded-full">
 <Users className="h-4 w-4 text-blue-600" />
 </div>
 <div>
 <p className="text-sm font-medium text-blue-900">Admin Permission</p>
 <p className="text-sm text-blue-700 mt-1">
 Administrators can clock in/out for staff members.
 </p>
 </div>
 </div>
 </div>
 </div>
 
 <DialogFooter className="pt-2">
 <Button
 variant="outline"
 className="h-10 px-6 border-border text-foreground hover:bg-muted hover:text-foreground hover:border-border rounded-lg transition-colors shadow-sm"
 onClick={() => setShowStaffSelection(false)}
 >
 Cancel
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>

 <Dialog open={showTimeSettings} onOpenChange={setShowTimeSettings}>
 <DialogContent className="max-w-2xl bg-card border border-border shadow-2xl rounded-xl flex flex-col max-h-[90vh]">
 <DialogHeader className="pb-4 flex-shrink-0">
 <div className="flex items-center gap-3">
 <div className="bg-gradient-to-r from-blue-100 to-indigo-100 p-3 rounded-lg shadow-sm">
 <Clock className="h-6 w-6 text-blue-600" />
 </div>
 <div>
 <DialogTitle className="text-xl font-semibold text-foreground">Attendance Time Settings</DialogTitle>
 <DialogDescription className="text-sm text-muted-foreground mt-1">
 Configure thresholds for late arrivals and early departures
 </DialogDescription>
 </div>
 </div>
 </DialogHeader>
 
 <div className="flex-1 overflow-y-auto px-1 pb-20 custom-scrollbar">
 <div className="space-y-6 py-1">
 <div className="space-y-4 p-5 bg-gradient-to-br from-blue-50/80 to-white rounded-xl border border-blue-100 shadow-sm">
 <div className="flex items-center justify-between mb-3">
 <div className="flex items-center gap-3">
 <div className="p-2 bg-blue-100 rounded-lg shadow-sm">
 <Clock className="h-5 w-5 text-blue-600" />
 </div>
 <div>
 <Label className="text-base font-semibold text-foreground">Late Arrival Time</Label>
 <p className="text-xs text-muted-foreground mt-1">
 Arrivals after this time will be marked as <span className="font-semibold text-orange-600">late</span>
 </p>
 </div>
 </div>
 <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-xs font-medium px-3 py-1">
 Morning
 </Badge>
 </div>
 
 <div className="space-y-3">
 <Label className="text-sm font-medium text-foreground block">Set Time</Label>
 <div className="flex items-center gap-4 bg-card p-4 rounded-xl border border-border shadow-sm">
 <div className="flex items-center gap-3 flex-1">
 <div className="text-center flex-1">
 <Label className="text-xs text-muted-foreground mb-2 block font-medium">Hours</Label>
 <div className="relative">
 <Input
 type="number"
 min="0"
 max="23"
 value={lateArrivalThreshold.hours}
 onChange={(e) => {
 const val = Math.min(23, Math.max(0, parseInt(e.target.value) || 0));
 setLateArrivalThreshold({
 ...lateArrivalThreshold,
 hours: val
 });
 }}
 className="w-full text-center font-semibold text-lg py-3 border-border focus:border-emerald-500 focus:ring-2 focus:ring-blue-200 rounded-lg"
 />
 </div>
 </div>
 
 <span className="text-muted-foreground text-2xl font-semibold mt-8">:</span>
 
 <div className="text-center flex-1">
 <Label className="text-xs text-muted-foreground mb-2 block font-medium">Minutes</Label>
 <div className="relative">
 <Input
 type="number"
 min="0"
 max="59"
 value={lateArrivalThreshold.minutes}
 onChange={(e) => {
 const val = Math.min(59, Math.max(0, parseInt(e.target.value) || 0));
 setLateArrivalThreshold({
 ...lateArrivalThreshold,
 minutes: val
 });
 }}
 className="w-full text-center font-semibold text-lg py-3 border-border focus:border-emerald-500 focus:ring-2 focus:ring-blue-200 rounded-lg"
 />
 </div>
 </div>
 
 <div className="text-center">
 <Label className="text-xs text-muted-foreground mb-2 block font-medium">Format</Label>
 <div className="px-4 py-3 bg-gradient-to-r from-blue-100 to-blue-50 text-blue-700 rounded-lg font-semibold text-sm border border-blue-200 shadow-sm">
 AM
 </div>
 </div>
 </div>
 </div>
 </div>
 
 <div className="mt-5 p-4 bg-card rounded-xl border border-border shadow-sm">
 <div className="flex items-center justify-between mb-3">
 <div className="flex items-center gap-2">
 <div className="h-2.5 w-2.5 rounded-full bg-blue-500 animate-pulse"></div>
 <span className="text-sm font-semibold text-foreground">Current Setting</span>
 </div>
 <Badge className="bg-gradient-to-r from-blue-100 to-blue-50 text-blue-800 border-blue-200 shadow-sm text-sm font-medium px-3 py-1.5">
 {String(lateArrivalThreshold.hours).padStart(2, '0')}:
 {String(lateArrivalThreshold.minutes).padStart(2, '0')} AM
 </Badge>
 </div>
 </div>
 </div>
 
 <div className="space-y-4 p-5 bg-gradient-to-br from-orange-50/80 to-white rounded-xl border border-orange-100 shadow-sm">
 <div className="flex items-center justify-between mb-3">
 <div className="flex items-center gap-3">
 <div className="p-2 bg-orange-100 rounded-lg shadow-sm">
 <Clock className="h-5 w-5 text-orange-600" />
 </div>
 <div>
 <Label className="text-base font-semibold text-foreground">Early Departure Time</Label>
 <p className="text-xs text-muted-foreground mt-1">
 Departures before this time will be marked as <span className="font-semibold text-red-600">early</span>
 </p>
 </div>
 </div>
 <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200 text-xs font-medium px-3 py-1">
 Evening
 </Badge>
 </div>
 
 <div className="space-y-3">
 <Label className="text-sm font-medium text-foreground block">Set Time</Label>
 <div className="flex items-center gap-4 bg-card p-4 rounded-xl border border-border shadow-sm">
 <div className="flex items-center gap-3 flex-1">
 <div className="text-center flex-1">
 <Label className="text-xs text-muted-foreground mb-2 block font-medium">Hours</Label>
 <div className="relative">
 <Input
 type="number"
 min="0"
 max="23"
 value={earlyDepartureThreshold.hours}
 onChange={(e) => {
 const val = Math.min(23, Math.max(0, parseInt(e.target.value) || 0));
 setEarlyDepartureThreshold({
 ...earlyDepartureThreshold,
 hours: val
 });
 }}
 className="w-full text-center font-semibold text-lg py-3 border-border focus:border-orange-500 focus:ring-2 focus:ring-orange-200 rounded-lg"
 />
 </div>
 </div>
 
 <span className="text-muted-foreground text-2xl font-semibold mt-8">:</span>
 
 <div className="text-center flex-1">
 <Label className="text-xs text-muted-foreground mb-2 block font-medium">Minutes</Label>
 <div className="relative">
 <Input
 type="number"
 min="0"
 max="59"
 value={earlyDepartureThreshold.minutes}
 onChange={(e) => {
 const val = Math.min(59, Math.max(0, parseInt(e.target.value) || 0));
 setEarlyDepartureThreshold({
 ...earlyDepartureThreshold,
 minutes: val
 });
 }}
 className="w-full text-center font-semibold text-lg py-3 border-border focus:border-orange-500 focus:ring-2 focus:ring-orange-200 rounded-lg"
 />
 </div>
 </div>
 
 <div className="text-center">
 <Label className="text-xs text-muted-foreground mb-2 block font-medium">Format</Label>
 <div className="px-4 py-3 bg-gradient-to-r from-orange-100 to-orange-50 text-orange-700 rounded-lg font-semibold text-sm border border-orange-200 shadow-sm">
 PM
 </div>
 </div>
 </div>
 </div>
 </div>
 
 <div className="mt-5 p-4 bg-card rounded-xl border border-border shadow-sm">
 <div className="flex items-center justify-between mb-3">
 <div className="flex items-center gap-2">
 <div className="h-2.5 w-2.5 rounded-full bg-orange-500 animate-pulse"></div>
 <span className="text-sm font-semibold text-foreground">Current Setting</span>
 </div>
 <Badge className="bg-gradient-to-r from-orange-100 to-orange-50 text-orange-800 border-orange-200 shadow-sm text-sm font-medium px-3 py-1.5">
 {String(earlyDepartureThreshold.hours).padStart(2, '0')}:
 {String(earlyDepartureThreshold.minutes).padStart(2, '0')} PM
 </Badge>
 </div>
 </div>
 </div>
 
 <div className="bg-gradient-to-r from-gray-50/80 to-white rounded-xl border border-border p-5 shadow-sm">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-3">
 <div className="p-2.5 bg-muted rounded-lg shadow-sm">
 <Settings className="h-5 w-5 text-muted-foreground" />
 </div>
 <div>
 <p className="text-base font-semibold text-foreground">Default Values</p>
 <p className="text-xs text-muted-foreground mt-1">
 Reset to standard working hours
 </p>
 </div>
 </div>
 <Button
 variant="outline"
 className="text-foreground border-border hover:bg-muted hover:border-border shadow-sm px-4"
 onClick={() => {
 setLateArrivalThreshold({ hours: 9, minutes: 0 });
 setEarlyDepartureThreshold({ hours: 17, minutes: 0 });
 toast({
 title: "Reset to Defaults",
 description: "Time thresholds have been reset to 9:00 AM and 5:00 PM",
 duration: 2000,
 });
 }}
 >
 <RefreshCw className="h-4 w-4 mr-2" />
 Reset
 </Button>
 </div>
 </div>
 </div>
 </div>
 
 <DialogFooter className="absolute bottom-0 left-0 right-0 bg-gradient-to-b from-white via-white to-white border-t border-border px-6 py-4">
 <div className="flex w-full gap-4">
 <Button
 variant="outline"
 onClick={() => setShowTimeSettings(false)}
 className="flex-1 h-12 text-base border-border hover:bg-muted hover:border-border text-foreground font-medium shadow-sm rounded-lg"
 >
 Cancel
 </Button>
 <Button
 onClick={() => {
 localStorage.setItem('lateArrivalThreshold', JSON.stringify(lateArrivalThreshold));
 localStorage.setItem('earlyDepartureThreshold', JSON.stringify(earlyDepartureThreshold));
 setShowTimeSettings(false);
 toast({
 title: "✅ Settings Saved",
 description: "Your time thresholds have been updated",
 duration: 3000,
 });
 }}
 className="flex-1 h-12 text-base bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-md font-medium rounded-lg"
 >
 <Save className="h-5 w-5 mr-2" />
 Save
 </Button>
 </div>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 </div>
 );
}