import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, ensureArray } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { 
 Shield, 
 QrCode, 
 Users, 
 Car, 
 FileText, 
 Clock, 
 AlertTriangle,
 CheckCircle,
 User,
 Calendar,
 Camera,
 Plus,
 Search,
 Filter,
 TrendingUp,
 Eye,
 UserCheck,
 MapPin,
 Phone,
 Mail,
 Building,
 Timer
} from "lucide-react";
import { SecurityKPIGrid } from "@/components/dashboard/SecurityKPIGrid";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";

interface SecurityMetrics {
 passesProcessedToday: number;
 currentlyOnSite: number;
 averageVisitDuration: number;
 securityAlerts: number;
 todayCheckIns: number;
 pendingApprovals: number;
 totalVisitors: number;
 averageApprovalTime: number;
}

interface Visitor {
 id: number;
 fullName: string;
 company: string;
 entryType: string;
 entryTime: string;
 status: "checked_in" | "checked_out" | "pending";
 hostName: string;
 duration: string;
 vehicleRegistration?: string;
 passType?: string;
}

interface GatePass {
 id: number;
 passType: string;
 fullName: string;
 company: string;
 validFrom: string;
 validTo: string;
 purpose: string;
 status: "active" | "expired" | "pending" | "approved";
 requestedBy: string;
 approvedBy?: string;
}

interface Vehicle {
 id: number;
 fullName: string;
 company: string;
 vehicleType: string;
 licensePlate: string;
 phoneNumber: string;
 purpose: string;
 status: "registered" | "pending" | "expired";
 registrationDate: string;
}

// Default metrics that satisfy the SecurityMetrics interface
const DEFAULT_METRICS: SecurityMetrics = {
 passesProcessedToday: 0,
 currentlyOnSite: 0,
 averageVisitDuration: 0,
 securityAlerts: 0,
 todayCheckIns: 0,
 pendingApprovals: 0,
 totalVisitors: 0,
 averageApprovalTime: 0,
};

// Helper function to safely get metrics from API response
const getMetricsFromResponse = (data: unknown): SecurityMetrics => {
 if (data && typeof data === 'object' && !Array.isArray(data)) {
   return {
     passesProcessedToday: (data as any).passesProcessedToday ?? 0,
     currentlyOnSite: (data as any).currentlyOnSite ?? 0,
     averageVisitDuration: (data as any).averageVisitDuration ?? 0,
     securityAlerts: (data as any).securityAlerts ?? 0,
     todayCheckIns: (data as any).todayCheckIns ?? 0,
     pendingApprovals: (data as any).pendingApprovals ?? 0,
     totalVisitors: (data as any).totalVisitors ?? 0,
     averageApprovalTime: (data as any).averageApprovalTime ?? 0,
   };
 }
 return DEFAULT_METRICS;
};

export default function SecurityOperations() {
 const { toast } = useToast();
 const [activeTab, setActiveTab] = useState("dashboard");
 const [qrScanMode, setQrScanMode] = useState("visitor");
 const [manualQrCode, setManualQrCode] = useState("");
 const [searchQuery, setSearchQuery] = useState("");
 
 // Form states for visitor registration
 const [visitorForm, setVisitorForm] = useState({
   fullName: "",
   idNumber: "",
   company: "",
   reason: "",
   hostName: "",
   mobile: "",
   email: ""
 });

 // Form states for gate pass creation
 const [gatePassForm, setGatePassForm] = useState({
   passType: "",
   fullName: "",
   company: "",
   validTo: "",
   purpose: ""
 });

 // Form states for vehicle registration
 const [vehicleForm, setVehicleForm] = useState({
   fullName: "",
   company: "",
   vehicleType: "",
   licensePlate: "",
   phoneNumber: "",
   idLicense: "",
   purpose: ""
 });

 // Fetch security metrics
 const { data: metricsRaw, isLoading: metricsLoading, isError } = useQuery({
   queryKey: ['/api/security/metrics'],
   queryFn: async () => {
     try {
       const r = await apiRequest("/api/security/metrics");
       const d = await r.json();
       return d;
     } catch (error) {
       console.error("Error fetching metrics:", error);
       return null;
     }
   },
   staleTime: 30000, // 30 seconds
 });

 // Fetch visitors
 const { data: visitorsRaw = [], isLoading: visitorsLoading } = useQuery({
   queryKey: ['/api/security/visitors'],
   queryFn: async () => {
     try {
       const r = await apiRequest("/api/security/visitors");
       const d = await r.json();
       return ensureArray(d);
     } catch (error) {
       console.error("Error fetching visitors:", error);
       return [];
     }
   },
 });

 // Fetch gate passes
 const { data: gatePassesRaw = [], isLoading: gatePassesLoading } = useQuery({
   queryKey: ['/api/security/gate-passes'],
   queryFn: async () => {
     try {
       const r = await apiRequest("/api/security/gate-passes");
       const d = await r.json();
       return ensureArray(d);
     } catch (error) {
       console.error("Error fetching gate passes:", error);
       return [];
     }
   },
 });

 // Fetch vehicles
 const { data: vehiclesRaw = [], isLoading: vehiclesLoading } = useQuery({
   queryKey: ['/api/security/vehicles'],
   queryFn: async () => {
     try {
       const r = await apiRequest("/api/security/vehicles");
       const d = await r.json();
       return ensureArray(d);
     } catch (error) {
       console.error("Error fetching vehicles:", error);
       return [];
     }
   },
 });

 // Ensure data is always an array
 const visitors = ensureArray(visitorsRaw);
 const gatePasses = ensureArray(gatePassesRaw);
 const vehicles = ensureArray(vehiclesRaw);

 // Safely extract metrics using the helper function
 const securityMetrics = getMetricsFromResponse(metricsRaw);

 // QR Code scanner simulation
 const handleQrScan = useMutation({
   mutationFn: async (data: { type: string; code?: string }) => {
     return await apiRequest("/api/security/qr-scan", { method: "POST", data: data });
   },
   onSuccess: (data: any) => {
     toast({
       title: `${data.type?.replace('_', ' ').toUpperCase() || 'QR Code'} Scanned`,
       description: `${data.message || 'Successfully scanned'} - ${data.data?.name || 'Visitor'} from ${data.data?.company || 'Unknown'}`,
     });
     queryClient.invalidateQueries({ queryKey: ['/api/security/visitors'] });
     queryClient.invalidateQueries({ queryKey: ['/api/security/metrics'] });
   },
   onError: (error: any) => {
     console.error("Error scanning QR:", error);
     toast({
       title: "Scan Failed",
       description: error?.message || "Failed to scan QR code",
       variant: "destructive",
     });
   },
 });

 // Create gate pass
 const createGatePass = useMutation({
   mutationFn: async (data: any) => {
     return await apiRequest("/api/security/gate-passes", { method: "POST", data: data });
   },
   onSuccess: (data: any) => {
     toast({
       title: "Gate Pass Generated Successfully",
       description: `Pass ID: ${data.passId || 'GP-' + Date.now()} created for ${data.fullName || 'Visitor'}. Valid until ${data.validTo || 'Today'}`,
     });
     queryClient.invalidateQueries({ queryKey: ['/api/security/gate-passes'] });
     queryClient.invalidateQueries({ queryKey: ['/api/security/metrics'] });
   },
   onError: (error: any) => {
     console.error("Error creating gate pass:", error);
     toast({
       title: "Error",
       description: error?.message || "Failed to create gate pass",
       variant: "destructive",
     });
   },
 });

 // Register vehicle
 const registerVehicle = useMutation({
   mutationFn: async (data: any) => {
     return await apiRequest("/api/security/vehicles", { method: "POST", data: data });
   },
   onSuccess: (data: any) => {
     toast({
       title: "Vehicle Registered Successfully",
       description: `${data.vehicleType || 'Vehicle'} ${data.licensePlate || 'Unknown'} registered for ${data.fullName || 'Driver'}. Access authorized.`,
     });
     queryClient.invalidateQueries({ queryKey: ['/api/security/vehicles'] });
     queryClient.invalidateQueries({ queryKey: ['/api/security/metrics'] });
   },
   onError: (error: any) => {
     console.error("Error registering vehicle:", error);
     toast({
       title: "Error",
       description: error?.message || "Failed to register vehicle",
       variant: "destructive",
     });
   },
 });

 // Pre-register visitor
 const preRegisterVisitor = useMutation({
   mutationFn: async (data: any) => {
     return await apiRequest("/api/security/pre-register", { method: "POST", data: data });
   },
   onSuccess: (data: any) => {
     toast({
       title: "Visitor Pre-registered Successfully",
       description: `QR Code: ${data.qrCode || 'QR-' + Date.now()} generated for ${data.fullName || 'Visitor'}. Mobile: ${data.mobile || 'N/A'}`,
     });
     queryClient.invalidateQueries({ queryKey: ['/api/security/visitors'] });
     queryClient.invalidateQueries({ queryKey: ['/api/security/metrics'] });
   },
   onError: (error: any) => {
     console.error("Error pre-registering visitor:", error);
     toast({
       title: "Error",
       description: error?.message || "Failed to pre-register visitor",
       variant: "destructive",
     });
   },
 });

 const mockVisitors: Visitor[] = visitors.length > 0 ? visitors : [];
 const mockGatePasses: GatePass[] = gatePasses.length > 0 ? gatePasses : [];
 const mockVehicles: Vehicle[] = vehicles.length > 0 ? vehicles : [];

 return (
   <div className="min-h-screen bg-background">
     {/* Header */}
     <div className="bg-card border-b border-border p-6">
       <div className="flex items-center justify-between">
         <div className="flex items-center space-x-4">
           <div className="bg-emerald-600 px-3 py-1 rounded text-sm font-medium text-white">
             Security Operations
           </div>
           <h1 className="text-2xl font-semibold text-foreground">Access Control & Monitoring</h1>
         </div>
         <div className="flex items-center space-x-2">
           <Button 
             variant="outline" 
             size="sm" 
             className="border-emerald-500 text-emerald-600 hover:bg-emerald-500 hover:text-white"
             onClick={() => {
               setActiveTab("visitors");
               toast({
                 title: "Live View Activated",
                 description: "Switched to real-time visitor monitoring",
               });
             }}
           >
             <Eye className="h-4 w-4 mr-2" />
             Live View
           </Button>
           <Dialog>
             <DialogTrigger asChild>
               <Button size="sm" className="bg-emerald-500 hover:bg-emerald-600 text-white">
                 <UserCheck className="h-4 w-4 mr-2" />
                 New Registration
               </Button>
             </DialogTrigger>
             <DialogContent className="bg-card border-border text-foreground max-w-2xl">
               <DialogHeader>
                 <DialogTitle className="text-foreground">Quick Registration</DialogTitle>
               </DialogHeader>
               <div className="space-y-4">
                 <div className="grid grid-cols-2 gap-4">
                   <div>
                     <Label className="text-foreground">Full Name *</Label>
                     <Input placeholder="e.g., Jane Doe" className="bg-card border-border" />
                   </div>
                   <div>
                     <Label className="text-foreground">ID Number *</Label>
                     <Input placeholder="e.g., 12345678" className="bg-card border-border" />
                   </div>
                 </div>
                 <div className="grid grid-cols-2 gap-4">
                   <div>
                     <Label className="text-foreground">Company/Visitor Type</Label>
                     <Input placeholder="e.g., Innovate Corp" className="bg-card border-border" />
                   </div>
                   <div>
                     <Label className="text-foreground">Your Host *</Label>
                     <Input placeholder="e.g., John Smith" className="bg-card border-border" />
                   </div>
                 </div>
                 <div className="grid grid-cols-2 gap-4">
                   <div>
                     <Label className="text-foreground">Mobile Number *</Label>
                     <Input placeholder="e.g., +254 712 345 678" className="bg-card border-border" />
                   </div>
                   <div>
                     <Label className="text-foreground">Email Address *</Label>
                     <Input placeholder="e.g., visitor@company.com" type="email" className="bg-card border-border" />
                   </div>
                 </div>
                 <div>
                   <Label className="text-foreground">Reason for Visit *</Label>
                   <Textarea
                     placeholder="e.g., Business meeting, delivery, maintenance..."
                     className="bg-card border-border"
                   />
                 </div>
                 <Button 
                   className="w-full bg-emerald-500 hover:bg-emerald-600 text-white"
                   onClick={() => {
                     preRegisterVisitor.mutate({
                       fullName: "Quick Registration",
                       idNumber: "12345678",
                       company: "Express Registration",
                       reason: "Quick access",
                       hostName: "Security",
                       mobile: "+254 712 345 678",
                       email: "quick@registration.com"
                     });
                   }}
                   disabled={preRegisterVisitor.isPending}
                 >
                   {preRegisterVisitor.isPending ? "Registering..." : "Complete Registration & Generate QR"}
                 </Button>
               </div>
             </DialogContent>
           </Dialog>
         </div>
       </div>
       
       {/* Enhanced KPI Grid */}
       <div className="mt-6">
         <SecurityKPIGrid 
           metrics={securityMetrics} 
           loading={metricsLoading}
         />
       </div>
     </div>

     <div className="p-6">
       <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
         <TabsList className="grid w-full grid-cols-5 mb-6 bg-card border border-border">
           <TabsTrigger value="dashboard" className="text-foreground data-[state=active]:text-emerald-600">Dashboard</TabsTrigger>
           <TabsTrigger value="qr-scanner" className="text-foreground data-[state=active]:text-emerald-600">QR Scanner</TabsTrigger>
           <TabsTrigger value="visitors" className="text-foreground data-[state=active]:text-emerald-600">Visitor Management</TabsTrigger>
           <TabsTrigger value="gate-pass" className="text-foreground data-[state=active]:text-emerald-600">Gate Pass</TabsTrigger>
           <TabsTrigger value="vehicles" className="text-foreground data-[state=active]:text-emerald-600">Vehicle Registration</TabsTrigger>
         </TabsList>

         {/* Dashboard Tab */}
         <TabsContent value="dashboard" className="space-y-6">
           {/* Security Metrics Overview */}
           <div className="mb-6">
             <h2 className="text-lg font-medium text-foreground mb-4">Security Overview</h2>
             <p className="text-sm text-muted-foreground">Real-time monitoring and access control metrics</p>
           </div>

           {/* Live Feed and Upcoming Arrivals */}
           <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
             {/* Live On-Site Feed */}
             <Card className="lg:col-span-2 bg-card border-border">
               <CardHeader>
                 <CardTitle className="flex items-center space-x-2">
                   <Users className="h-5 w-5 text-green-500" />
                   <span>Live On-Site Feed</span>
                 </CardTitle>
                 <p className="text-muted-foreground text-sm">A real-time log of all visitors, vehicles, and deliveries currently on-site.</p>
               </CardHeader>
               <CardContent>
                 <div className="space-y-4">
                   <div className="grid grid-cols-4 gap-4 text-sm font-medium text-muted-foreground border-b border-border pb-2">
                     <span>Entry Details</span>
                     <span>Host / Recipient</span>
                     <span>Check-in Time</span>
                     <span>Status</span>
                   </div>
                   {mockVisitors.filter(v => v.status === "checked_in").map((visitor) => (
                     <div key={visitor.id} className="grid grid-cols-4 gap-4 items-center py-2 border-b border-border">
                       <div className="flex items-center space-x-3">
                         <div className="w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center">
                           <User className="h-4 w-4 text-white" />
                         </div>
                         <div>
                           <p className="font-medium text-foreground">{visitor.fullName}</p>
                           <p className="text-sm text-muted-foreground">{visitor.company}</p>
                           <p className="text-xs text-muted-foreground">{visitor.duration}</p>
                         </div>
                       </div>
                       <span className="text-sm text-foreground">{visitor.hostName}</span>
                       <span className="text-sm text-foreground">{visitor.entryTime}</span>
                       <Badge className="bg-emerald-500 text-white w-fit">
                         <CheckCircle className="h-3 w-3 mr-1" />
                         {visitor.status.replace('_', ' ')}
                       </Badge>
                     </div>
                   ))}
                 </div>
               </CardContent>
             </Card>

             {/* Sidebar - Upcoming Arrivals and Alerts */}
             <div className="space-y-6">
               <Card className="bg-card border-border">
                 <CardHeader>
                   <CardTitle className="flex items-center space-x-2 text-foreground">
                     <Calendar className="h-5 w-5 text-blue-500" />
                     <span>Upcoming Arrivals</span>
                   </CardTitle>
                   <p className="text-muted-foreground text-sm">Pre-registered visits, deliveries, and casual staff.</p>
                 </CardHeader>
                 <CardContent className="space-y-3">
                   <div className="flex items-center justify-between p-2 bg-muted rounded border">
                     <div className="flex items-center space-x-2">
                       <User className="h-4 w-4 text-blue-500" />
                       <div>
                         <p className="text-sm font-medium text-foreground">Charlie Brown</p>
                         <p className="text-xs text-muted-foreground">with Agent Jones</p>
                       </div>
                     </div>
                     <span className="text-xs text-muted-foreground">7:18 AM</span>
                   </div>
                   <div className="flex items-center justify-between p-2 bg-muted rounded border">
                     <div className="flex items-center space-x-2">
                       <User className="h-4 w-4 text-emerald-500" />
                       <div>
                         <p className="text-sm font-medium text-foreground">John Prince</p>
                         <p className="text-xs text-muted-foreground">with Chris Green</p>
                       </div>
                     </div>
                     <span className="text-xs text-muted-foreground">9:18 AM</span>
                   </div>
                   <div className="flex items-center justify-between p-2 bg-muted rounded border">
                     <div className="flex items-center space-x-2">
                       <Car className="h-4 w-4 text-orange-500" />
                       <div>
                         <p className="text-sm font-medium text-foreground">Postman Pat</p>
                         <p className="text-xs text-muted-foreground">Royal Mail</p>
                       </div>
                     </div>
                     <span className="text-xs text-muted-foreground">8:18 AM</span>
                   </div>
                 </CardContent>
               </Card>

               <Card className="bg-card border-border">
                 <CardHeader>
                   <CardTitle className="flex items-center space-x-2 text-foreground">
                     <AlertTriangle className="h-5 w-5 text-red-500" />
                     <span>Security Alerts</span>
                   </CardTitle>
                   <p className="text-muted-foreground text-sm">Recent security-related events.</p>
                 </CardHeader>
                 <CardContent>
                   <div className="text-center py-8 text-muted-foreground">
                     No security alerts in this scope.
                   </div>
                 </CardContent>
               </Card>
             </div>
           </div>

           {/* Visitor Statistics Chart */}
           <Card className="bg-card border-border">
             <CardHeader>
               <CardTitle className="text-foreground">Visitor Statistics</CardTitle>
               <p className="text-muted-foreground text-sm">Daily visitor trends for the last week.</p>
             </CardHeader>
             <CardContent>
               <div className="h-64 flex items-end space-x-4 justify-center">
                 {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, index) => {
                   const heights = [60, 65, 80, 85, 55, 60, 45];
                   return (
                     <div key={day} className="flex flex-col items-center space-y-2">
                       <div 
                         className="bg-emerald-500 w-12 rounded-t" 
                         style={{ height: `${heights[index]}%` }}
                       />
                       <span className="text-xs text-muted-foreground">{day}</span>
                     </div>
                   );
                 })}
               </div>
             </CardContent>
           </Card>
         </TabsContent>

         {/* QR Scanner Tab */}
         <TabsContent value="qr-scanner" className="space-y-6">
           {/* QR Scanner Metrics */}
           <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
             <Card className="bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-700 border-blue-200 shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30 transition-all duration-300">
               <CardContent className="p-4">
                 <div className="flex items-center justify-between">
                   <div>
                     <p className="text-blue-100 text-sm">Passes Processed Today</p>
                     <p className="text-3xl font-bold text-white">{securityMetrics.passesProcessedToday}</p>
                   </div>
                   <div className="w-12 h-12 bg-card rounded-lg flex items-center justify-center backdrop-blur-sm">
                     <QrCode className="h-6 w-6 text-white" />
                   </div>
                 </div>
               </CardContent>
             </Card>

             <Card className="bg-gradient-to-br from-emerald-500 via-green-600 to-teal-700 border-emerald-200 shadow-lg shadow-emerald-500/25 hover:shadow-xl hover:shadow-emerald-500/30 transition-all duration-300">
               <CardContent className="p-4">
                 <div className="flex items-center justify-between">
                   <div>
                     <p className="text-green-100 text-sm">Currently On-Site</p>
                     <p className="text-3xl font-bold text-white">{securityMetrics.currentlyOnSite}</p>
                   </div>
                   <div className="w-12 h-12 bg-card rounded-lg flex items-center justify-center backdrop-blur-sm">
                     <Users className="h-6 w-6 text-white" />
                   </div>
                 </div>
               </CardContent>
             </Card>

             <Card className="bg-gradient-to-br from-orange-500 via-amber-600 to-yellow-600 border-orange-200 shadow-lg shadow-orange-500/25 hover:shadow-xl hover:shadow-orange-500/30 transition-all duration-300">
               <CardContent className="p-4">
                 <div className="flex items-center justify-between">
                   <div>
                     <p className="text-orange-100 text-sm">Average Visit Duration</p>
                     <p className="text-3xl font-bold text-white">{securityMetrics.averageVisitDuration} min</p>
                   </div>
                   <div className="w-12 h-12 bg-card rounded-lg flex items-center justify-center backdrop-blur-sm">
                     <Clock className="h-6 w-6 text-white" />
                   </div>
                 </div>
               </CardContent>
             </Card>
           </div>

           {/* QR Code Scanner Interface */}
           <Card className="bg-card border-border">
             <CardHeader>
               <CardTitle className="flex items-center space-x-2 text-foreground">
                 <QrCode className="h-5 w-5 text-emerald-500" />
                 <span>QR Code Scanner</span>
               </CardTitle>
               <p className="text-muted-foreground">Scan visitor passes, gate passes, or patrol checkpoints. You can also enter an ID manually.</p>
             </CardHeader>
             <CardContent className="space-y-6">
               {/* Scanner Buttons */}
               <div className="flex flex-wrap gap-2">
                 <Button 
                   variant="outline" 
                   className="border-border text-foreground hover:bg-muted"
                   onClick={() => {
                     const cameraQrCode = `CAM-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                     handleQrScan.mutate({ type: "camera", code: cameraQrCode });
                   }}
                   disabled={handleQrScan.isPending}
                 >
                   <Camera className="h-4 w-4 mr-2" />
                   {handleQrScan.isPending ? "Scanning..." : "Scan with Camera"}
                 </Button>
                 <Button 
                   className="bg-emerald-500 hover:bg-emerald-600 text-white"
                   onClick={() => {
                     const visitorQrCode = `VISITOR-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                     handleQrScan.mutate({ type: "visitor_scan", code: visitorQrCode });
                   }}
                   disabled={handleQrScan.isPending}
                 >
                   {handleQrScan.isPending ? "Processing..." : "Simulate Visitor Scan"}
                 </Button>
                 <Button 
                   variant="outline"
                   className="border-border text-foreground hover:bg-muted"
                   onClick={() => {
                     const gatePassQrCode = `GATE-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                     handleQrScan.mutate({ type: "gate_pass", code: gatePassQrCode });
                   }}
                   disabled={handleQrScan.isPending}
                 >
                   {handleQrScan.isPending ? "Processing..." : "Simulate Gate Pass"}
                 </Button>
                 <Button 
                   variant="outline"
                   className="border-border text-foreground hover:bg-muted"
                   onClick={() => {
                     const checkpointQrCode = `CHECKPOINT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                     handleQrScan.mutate({ type: "checkpoint", code: checkpointQrCode });
                   }}
                   disabled={handleQrScan.isPending}
                 >
                   {handleQrScan.isPending ? "Processing..." : "Simulate Checkpoint"}
                 </Button>
               </div>

               {/* Camera View Simulation */}
               <div className="bg-muted border-2 border-dashed border-border rounded-lg h-96 flex items-center justify-center">
                 <div className="text-center">
                   <Camera className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                   <p className="text-muted-foreground">Camera is off. Click "Scan with Camera" to begin.</p>
                 </div>
               </div>

               {/* Manual QR Code Entry */}
               <div className="space-y-4">
                 <Label className="text-sm font-medium text-foreground">Manual QR Code Entry</Label>
                 <div className="flex space-x-2">
                   <Input
                     placeholder="Enter QR Code ID or Gate Pass ID"
                     value={manualQrCode}
                     onChange={(e) => setManualQrCode(e.target.value)}
                     className="bg-card border-border"
                   />
                   <Button 
                     className="bg-emerald-500 hover:bg-emerald-600 text-white"
                     onClick={() => {
                       if (manualQrCode.trim()) {
                         handleQrScan.mutate({ type: "manual", code: manualQrCode });
                         setManualQrCode("");
                       } else {
                         toast({
                           title: "Invalid Input",
                           description: "Please enter a valid QR code or ID number",
                           variant: "destructive",
                         });
                       }
                     }}
                     disabled={handleQrScan.isPending || !manualQrCode.trim()}
                   >
                     {handleQrScan.isPending ? "Processing..." : "Submit"}
                   </Button>
                 </div>
               </div>
             </CardContent>
           </Card>
         </TabsContent>

         {/* Visitor Management Tab */}
         <TabsContent value="visitors" className="space-y-6">
           <div className="flex items-center justify-between">
             <h2 className="text-2xl font-semibold text-foreground">Visitor Dashboard</h2>
             <div className="flex items-center space-x-2">
               <div className="relative">
                 <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                 <Input
                   placeholder="Search visitors, hosts..."
                   className="pl-10 bg-card border-border"
                   value={searchQuery}
                   onChange={(e) => setSearchQuery(e.target.value)}
                 />
               </div>
               <Button 
                 className="bg-emerald-500 hover:bg-emerald-600 text-white"
                 onClick={() => handleQrScan.mutate({ type: "visitor_scan" })}
                 disabled={handleQrScan.isPending}
               >
                 <QrCode className="h-4 w-4 mr-2" />
                 Scan Pass
               </Button>
               <Dialog>
                 <DialogTrigger asChild>
                   <Button className="bg-emerald-500 hover:bg-emerald-600 text-white">
                     <Plus className="h-4 w-4 mr-2" />
                     Quick Register
                   </Button>
                 </DialogTrigger>
                 <DialogContent className="bg-card border-border text-foreground max-w-2xl">
                   <DialogHeader>
                     <DialogTitle className="text-foreground">Pre-register Visitor</DialogTitle>
                   </DialogHeader>
                   <div className="space-y-4">
                     <div className="grid grid-cols-2 gap-4">
                       <div>
                         <Label className="text-foreground">Full Name *</Label>
                         <Input 
                           placeholder="e.g., Jane Doe" 
                           className="bg-card border-border" 
                           value={visitorForm.fullName}
                           onChange={(e) => setVisitorForm({...visitorForm, fullName: e.target.value})}
                         />
                       </div>
                       <div>
                         <Label className="text-foreground">ID Number *</Label>
                         <Input 
                           placeholder="e.g., 12345678" 
                           className="bg-card border-border" 
                           value={visitorForm.idNumber}
                           onChange={(e) => setVisitorForm({...visitorForm, idNumber: e.target.value})}
                         />
                       </div>
                     </div>
                     <div className="grid grid-cols-2 gap-4">
                       <div>
                         <Label className="text-foreground">Visitor Company</Label>
                         <Input 
                           placeholder="e.g., Innovate Corp" 
                           className="bg-card border-border" 
                           value={visitorForm.company}
                           onChange={(e) => setVisitorForm({...visitorForm, company: e.target.value})}
                         />
                       </div>
                       <div>
                         <Label className="text-foreground">Reason for Visit *</Label>
                         <Select value={visitorForm.reason} onValueChange={(value) => setVisitorForm({...visitorForm, reason: value})}>
                           <SelectTrigger className="bg-card border-border">
                             <SelectValue placeholder="Select reason" />
                           </SelectTrigger>
                           <SelectContent>
                             <SelectItem value="business">Business Meeting</SelectItem>
                             <SelectItem value="delivery">Delivery</SelectItem>
                             <SelectItem value="maintenance">Maintenance</SelectItem>
                             <SelectItem value="service">Service Provider</SelectItem>
                             <SelectItem value="personal">Personal Visit</SelectItem>
                             <SelectItem value="other">Other</SelectItem>
                           </SelectContent>
                         </Select>
                       </div>
                     </div>
                     <div className="grid grid-cols-2 gap-4">
                       <div>
                         <Label className="text-foreground">Your Host *</Label>
                         <Input 
                           placeholder="e.g., John Smith" 
                           className="bg-card border-border" 
                           value={visitorForm.hostName}
                           onChange={(e) => setVisitorForm({...visitorForm, hostName: e.target.value})}
                         />
                       </div>
                       <div>
                         <Label className="text-foreground">Mobile Number *</Label>
                         <Input 
                           placeholder="e.g., +254 712 345 678" 
                           className="bg-card border-border" 
                           value={visitorForm.mobile}
                           onChange={(e) => setVisitorForm({...visitorForm, mobile: e.target.value})}
                         />
                       </div>
                     </div>
                     <div>
                       <Label className="text-foreground">Email Address *</Label>
                       <Input 
                         placeholder="e.g., visitor@company.com" 
                         type="email" 
                         className="bg-card border-border" 
                         value={visitorForm.email}
                         onChange={(e) => setVisitorForm({...visitorForm, email: e.target.value})}
                       />
                     </div>
                     <Button 
                       className="w-full bg-emerald-500 hover:bg-emerald-600 text-white"
                       onClick={() => {
                         if (visitorForm.fullName && visitorForm.hostName && visitorForm.mobile && visitorForm.email) {
                           preRegisterVisitor.mutate(visitorForm);
                           setVisitorForm({
                             fullName: "",
                             idNumber: "",
                             company: "",
                             reason: "",
                             hostName: "",
                             mobile: "",
                             email: ""
                           });
                         } else {
                           toast({
                             title: "Required Fields Missing",
                             description: "Please fill in Full Name, Host, Mobile Number, and Email Address",
                             variant: "destructive",
                           });
                         }
                       }}
                       disabled={preRegisterVisitor.isPending}
                     >
                       {preRegisterVisitor.isPending ? "Generating QR Code..." : "Submit Registration & Generate QR Code"}
                     </Button>
                   </div>
                 </DialogContent>
               </Dialog>
             </div>
           </div>

           <Card className="bg-card border-border">
             <CardHeader>
               <CardTitle className="flex items-center space-x-2 text-foreground">
                 <Users className="h-5 w-5 text-emerald-500" />
                 <span>Live On-Site Feed</span>
               </CardTitle>
             </CardHeader>
             <CardContent>
               <div className="space-y-4">
                 <div className="grid grid-cols-5 gap-4 text-sm font-medium text-muted-foreground border-b border-border pb-2">
                   <span>Entry Details</span>
                   <span>Host</span>
                   <span>Check-in Time</span>
                   <span>Status</span>
                   <span>Actions</span>
                 </div>
                 {mockVisitors.map((visitor) => (
                   <div key={visitor.id} className="grid grid-cols-5 gap-4 items-center py-2 border-b border-border">
                     <div className="flex items-center space-x-3">
                       <div className="w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center">
                         <User className="h-4 w-4 text-white" />
                       </div>
                       <div>
                         <p className="font-medium text-foreground">{visitor.fullName}</p>
                         <p className="text-sm text-muted-foreground">{visitor.company}</p>
                       </div>
                     </div>
                     <span className="text-sm text-foreground">{visitor.hostName}</span>
                     <span className="text-sm text-foreground">{visitor.entryTime}</span>
                     <Badge className={`w-fit ${
                       visitor.status === 'checked_in' ? 'bg-emerald-500 text-white' :
                       visitor.status === 'checked_out' ? 'bg-gray-500 text-white' :
                       'bg-yellow-500 text-white'
                     }`}>
                       {visitor.status.replace('_', ' ')}
                     </Badge>
                     <Button 
                       size="sm" 
                       variant="outline" 
                       className="border-border text-foreground hover:bg-muted"
                       onClick={() => {
                         toast({
                           title: "Visitor Details",
                           description: `Viewing details for ${visitor.fullName}`,
                         });
                       }}
                     >
                       <Eye className="h-3 w-3" />
                     </Button>
                   </div>
                 ))}
               </div>
             </CardContent>
           </Card>
         </TabsContent>

         {/* Gate Pass Tab */}
         <TabsContent value="gate-pass" className="space-y-6">
           <Card className="bg-card border-border">
             <CardHeader>
               <CardTitle className="flex items-center space-x-2 text-foreground">
                 <FileText className="h-5 w-5 text-blue-500" />
                 <span>Create Gate Pass</span>
               </CardTitle>
             </CardHeader>
             <CardContent className="space-y-6">
               <div className="space-y-4">
                 <div className="grid grid-cols-2 gap-4">
                   <div>
                     <Label className="text-foreground">Gate Pass Type *</Label>
                     <Select>
                       <SelectTrigger className="bg-card border-border">
                         <SelectValue placeholder="Select type" />
                       </SelectTrigger>
                       <SelectContent>
                         <SelectItem value="visitor">Visitor</SelectItem>
                         <SelectItem value="contractor">Contractor</SelectItem>
                         <SelectItem value="delivery">Delivery</SelectItem>
                         <SelectItem value="service">Service Provider</SelectItem>
                         <SelectItem value="emergency">Emergency</SelectItem>
                         <SelectItem value="vip">VIP Guest</SelectItem>
                       </SelectContent>
                     </Select>
                   </div>
                   <div>
                     <Label className="text-foreground">Full Name *</Label>
                     <Input placeholder="e.g., John Doe" className="bg-card border-border" />
                   </div>
                 </div>
                 <div className="grid grid-cols-2 gap-4">
                   <div>
                     <Label className="text-foreground">Company</Label>
                     <Input placeholder="e.g., ABC Corp" className="bg-card border-border" />
                   </div>
                   <div>
                     <Label className="text-foreground">Valid Until</Label>
                     <Input type="date" className="bg-card border-border" />
                   </div>
                 </div>
                 <div>
                   <Label className="text-foreground">Purpose *</Label>
                   <Textarea 
                     placeholder="e.g., Scheduled maintenance, Business meeting, Equipment delivery..."
                     className="bg-card border-border"
                   />
                 </div>
                 <Button 
                   className="w-full bg-emerald-500 hover:bg-emerald-600 text-white"
                   onClick={() => {
                     createGatePass.mutate({
                       passType: "visitor",
                       fullName: "John Doe",
                       company: "ABC Corp",
                       purpose: "Business meeting",
                       validTo: new Date().toISOString().split('T')[0]
                     });
                   }}
                   disabled={createGatePass.isPending}
                 >
                   {createGatePass.isPending ? "Generating..." : "Generate Gate Pass"}
                 </Button>
               </div>
             </CardContent>
           </Card>

           <Card className="bg-card border-border">
             <CardHeader>
               <CardTitle className="text-foreground">Recent Gate Passes</CardTitle>
             </CardHeader>
             <CardContent>
               <div className="space-y-4">
                 {mockGatePasses.map((pass) => (
                   <div key={pass.id} className="flex items-center justify-between p-3 border border-border rounded bg-muted">
                     <div>
                       <p className="font-medium text-foreground">{pass.fullName}</p>
                       <p className="text-sm text-muted-foreground">{pass.company}</p>
                       <p className="text-xs text-muted-foreground">{pass.purpose}</p>
                       <p className="text-xs text-muted-foreground">Valid: {pass.validFrom} to {pass.validTo}</p>
                     </div>
                     <div className="flex items-center space-x-2">
                       <Badge className={`${
                         pass.status === 'active' ? 'bg-emerald-500 text-white' :
                         pass.status === 'approved' ? 'bg-blue-500 text-white' :
                         pass.status === 'pending' ? 'bg-yellow-500 text-white' :
                         'bg-gray-500 text-white'
                       }`}>
                         {pass.status}
                       </Badge>
                       <Button 
                         size="sm" 
                         variant="outline" 
                         className="border-border text-foreground hover:bg-muted"
                         onClick={() => {
                           toast({
                             title: "Gate Pass Details",
                             description: `Viewing pass for ${pass.fullName} - ${pass.status}`,
                           });
                         }}
                       >
                         <Eye className="h-3 w-3" />
                       </Button>
                     </div>
                   </div>
                 ))}
               </div>
             </CardContent>
           </Card>
         </TabsContent>

         {/* Vehicle Registration Tab */}
         <TabsContent value="vehicles" className="space-y-6">
           <Card className="bg-card border-border">
             <CardHeader>
               <CardTitle className="flex items-center space-x-2 text-foreground">
                 <Car className="h-5 w-5 text-emerald-500" />
                 <span>Vehicle Registration</span>
               </CardTitle>
             </CardHeader>
             <CardContent className="space-y-6">
               <div className="space-y-4">
                 <div className="grid grid-cols-2 gap-4">
                   <div>
                     <Label className="text-foreground">Full Name *</Label>
                     <Input placeholder="e.g., John Doe" className="bg-card border-border" />
                   </div>
                   <div>
                     <Label className="text-foreground">Company</Label>
                     <Input placeholder="e.g., MetroCorp" className="bg-card border-border" />
                   </div>
                 </div>
                 <div className="grid grid-cols-2 gap-4">
                   <div>
                     <Label className="text-foreground">Vehicle Type *</Label>
                     <Select>
                       <SelectTrigger className="bg-card border-border">
                         <SelectValue placeholder="Select vehicle type" />
                       </SelectTrigger>
                       <SelectContent>
                         <SelectItem value="sedan">Sedan</SelectItem>
                         <SelectItem value="hatchback">Hatchback</SelectItem>
                         <SelectItem value="suv">SUV</SelectItem>
                         <SelectItem value="pickup">Pickup</SelectItem>
                         <SelectItem value="van">Van</SelectItem>
                         <SelectItem value="truck">Truck</SelectItem>
                         <SelectItem value="motorcycle">Motorcycle</SelectItem>
                       </SelectContent>
                     </Select>
                   </div>
                   <div>
                     <Label className="text-foreground">License Plate *</Label>
                     <Input placeholder="e.g., KCA 123B" className="bg-card border-border" />
                   </div>
                 </div>
                 <div className="grid grid-cols-2 gap-4">
                   <div>
                     <Label className="text-foreground">Phone Number *</Label>
                     <Input placeholder="e.g., +254 712 345 678" className="bg-card border-border" />
                   </div>
                   <div>
                     <Label className="text-foreground">ID/Driver License</Label>
                     <Input placeholder="e.g., 12345678" className="bg-card border-border" />
                   </div>
                 </div>
                 <div>
                   <Label className="text-foreground">Purpose of Visit *</Label>
                   <Textarea 
                     placeholder="e.g., Equipment delivery, Office supplies, Maintenance materials..."
                     className="bg-card border-border"
                   />
                 </div>
                 <Button 
                   className="w-full bg-emerald-500 hover:bg-emerald-600 text-white"
                   onClick={() => {
                     registerVehicle.mutate({
                       fullName: "John Doe",
                       company: "MetroCorp",
                       vehicleType: "van",
                       licensePlate: "KCA 123B",
                       phoneNumber: "+254 712 345 678",
                       purpose: "Equipment delivery"
                     });
                   }}
                   disabled={registerVehicle.isPending}
                 >
                   {registerVehicle.isPending ? "Registering..." : "Submit Registration"}
                 </Button>
               </div>
             </CardContent>
           </Card>

           <Card className="bg-card border-border">
             <CardHeader>
               <CardTitle className="text-foreground">Recently Registered Vehicles</CardTitle>
             </CardHeader>
             <CardContent>
               <div className="space-y-4">
                 {mockVehicles.map((vehicle) => (
                   <div key={vehicle.id} className="flex items-center justify-between p-3 border border-border rounded bg-muted">
                     <div>
                       <p className="font-medium text-foreground">{vehicle.fullName}</p>
                       <p className="text-sm text-muted-foreground">{vehicle.company}</p>
                       <p className="text-xs text-muted-foreground">{vehicle.vehicleType} - {vehicle.licensePlate}</p>
                       <p className="text-xs text-muted-foreground">Phone: {vehicle.phoneNumber}</p>
                       <p className="text-xs text-muted-foreground">Purpose: {vehicle.purpose}</p>
                     </div>
                     <div className="flex items-center space-x-2">
                       <Badge className={`${
                         vehicle.status === 'registered' ? 'bg-emerald-500 text-white' :
                         vehicle.status === 'pending' ? 'bg-yellow-500 text-white' :
                         'bg-red-500 text-white'
                       }`}>
                         {vehicle.status}
                       </Badge>
                       <Button 
                         size="sm" 
                         variant="outline" 
                         className="border-border text-foreground hover:bg-muted"
                         onClick={() => {
                           toast({
                             title: "Vehicle Details",
                             description: `Viewing registration for ${vehicle.fullName} - ${vehicle.licensePlate}`,
                           });
                         }}
                       >
                         <Eye className="h-3 w-3" />
                       </Button>
                     </div>
                   </div>
                 ))}
               </div>
             </CardContent>
           </Card>
         </TabsContent>
       </Tabs>
     </div>
   </div>
 );
}