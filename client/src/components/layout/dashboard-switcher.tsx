import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
 DropdownMenu,
 DropdownMenuContent,
 DropdownMenuItem,
 DropdownMenuLabel,
 DropdownMenuSeparator,
 DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { 
 ChevronDown, 
 LayoutDashboard, 
 Shield, 
 DollarSign, 
 Building, 
 Wrench, 
 Users,
 Monitor
} from "lucide-react";

// All available dashboard views with the roles that can access each one.
// Only roles listed in `allowedRoles` will see that option in the switcher.
const ALL_DASHBOARD_OPTIONS = [
  {
    value:        'senior_manager',
    label:        'Senior Manager',
    description:  'Executive overview, approvals and portfolio KPIs',
    icon:         Shield,
    color:        'bg-purple-500',
    path:         '/senior-manager-dashboard',
    allowedRoles: ['admin'],
  },
  {
    value:        'property_manager',
    label:        'Property Manager',
    description:  'Operations, tenants and day-to-day management',
    icon:         Building,
    color:        'bg-blue-500',
    path:         '/property-manager-dashboard',
    allowedRoles: ['admin', 'manager'],
  },
  {
    value:        'finance',
    label:        'Finance',
    description:  'Financial overview, budgets and collections',
    icon:         DollarSign,
    color:        'bg-green-500',
    path:         '/finance-dashboard',
    allowedRoles: ['admin', 'manager'],
  },
  {
    value:        'maintenance',
    label:        'Maintenance',
    description:  'Work orders, contractors and service providers',
    icon:         Wrench,
    color:        'bg-orange-500',
    path:         '/maintenance-dashboard',
    allowedRoles: ['admin', 'manager', 'staff', 'caretaker'],
  },
  {
    value:        'landlord',
    label:        'My Portfolio',
    description:  'Your properties, tenants and rental income',
    icon:         Building,
    color:        'bg-emerald-600',
    path:         '/landlord-portal',
    allowedRoles: ['landlord'],
  },
  {
    value:        'default',
    label:        'Dashboard',
    description:  'General overview',
    icon:         LayoutDashboard,
    color:        'bg-indigo-500',
    path:         '/dashboard',
    allowedRoles: ['admin', 'manager', 'staff', 'caretaker', 'contractor'],
  },
];

export default function DashboardSwitcher() {
  const [location, navigate] = useLocation();
  const { user } = useAuth();
  const role = user?.role ?? '';

  // Filter to only the options this role can see
  const dashboardOptions = ALL_DASHBOARD_OPTIONS.filter(d => d.allowedRoles.includes(role));

  // Determine current dashboard based on current path
  const getCurrentDashboardValue = () => {
    const currentOption = dashboardOptions.find(d => d.path === location);
    return currentOption?.value ?? (dashboardOptions[0]?.value ?? 'default');
  };

  const [selectedDashboard, setSelectedDashboard] = useState(getCurrentDashboardValue);

  useEffect(() => {
    setSelectedDashboard(getCurrentDashboardValue());
  }, [location, role]);

  const currentDashboard = dashboardOptions.find(d => d.value === selectedDashboard)
    ?? dashboardOptions[0];

  const handleDashboardSwitch = (dashboardValue: string) => {
    const dashboard = dashboardOptions.find(d => d.value === dashboardValue);
    if (dashboard) {
      setSelectedDashboard(dashboardValue);
      navigate(dashboard.path);
    }
  };

  // Don't render if user not loaded, or if there's only one option (nothing to switch to)
  if (!user || dashboardOptions.length <= 1) return null;

  const Icon = currentDashboard?.icon ?? LayoutDashboard;

 return (
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button 
 variant="outline" 
 className="flex items-center gap-2 bg-card hover:bg-muted border border-border"
 >
 <div className={`w-2 h-2 rounded-full ${currentDashboard?.color ?? "bg-emerald-600"}`}></div>
 <Icon className="h-4 w-4" />
 <span className="hidden md:inline-block">{currentDashboard?.label ?? "Dashboard"}</span>
 <span className="md:hidden">Dashboard</span>
 <ChevronDown className="h-4 w-4 ml-1" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-80">
 <DropdownMenuLabel className="flex items-center gap-2">
 <Monitor className="h-4 w-4" />
 Switch Dashboard View
 </DropdownMenuLabel>
 <DropdownMenuSeparator />
 
 {dashboardOptions.map((dashboard) => {
 const DashboardIcon = dashboard.icon;
 const isSelected = dashboard.value === selectedDashboard;
 
 return (
 <DropdownMenuItem 
 key={dashboard.value}
 onClick={() => handleDashboardSwitch(dashboard.value)}
 className="flex items-start gap-3 p-3 cursor-pointer hover:bg-muted"
 >
 <div className={`w-8 h-8 rounded-lg ${dashboard.color} flex items-center justify-center mt-0.5`}>
 <DashboardIcon className="h-4 w-4 text-white" />
 </div>
 <div className="flex-1">
 <div className="flex items-center gap-2">
 <span className="font-medium text-sm">{dashboard.label}</span>
 {isSelected && (
 <Badge variant="secondary" className="text-xs">Current</Badge>
 )}
 </div>
 <p className="text-xs text-muted-foreground mt-0.5">{dashboard.description}</p>
 </div>
 </DropdownMenuItem>
 );
 })}
 
 <DropdownMenuSeparator />
 <DropdownMenuItem className="text-xs text-muted-foreground justify-center">
 Dashboard views customize based on your role and permissions
 </DropdownMenuItem>
 </DropdownMenuContent>
 </DropdownMenu>
 );
}