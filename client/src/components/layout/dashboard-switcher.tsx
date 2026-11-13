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
//
// Hidden on purpose: "Senior Manager" (/senior-manager-dashboard). It repeats the
// Overview's occupancy/revenue figures, its portfolio-value and ROI tiles are empty
// until properties carry valuations, and its "compliance score" is only a rescaled
// overdue-rent count. The page still exists at its URL; it is just not offered here.
//
// Staff and caretakers are not listed either: their home is their own portal, and the
// Maintenance/Overview dashboards are closed to them, so a switcher would only bounce
// them back to that portal.
const ALL_DASHBOARD_OPTIONS = [
  {
    value:        'default',
    label:        'Overview',
    description:  'Properties, tenants, rent and maintenance at a glance',
    icon:         LayoutDashboard,
    color:        'bg-indigo-500',
    path:         '/',
    allowedRoles: ['admin', 'manager'],
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
    allowedRoles: ['admin', 'manager'],
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
];

/** Dashboard views a role can switch between. The switcher (and the divider
 *  next to it in the top bar) only show when this has more than one entry. */
export function dashboardOptionsForRole(role: string) {
  return ALL_DASHBOARD_OPTIONS.filter(d => d.allowedRoles.includes(role));
}

export default function DashboardSwitcher({ compact = false }: { compact?: boolean } = {}) {
  const [location, navigate] = useLocation();
  const { user } = useAuth();
  const role = user?.role ?? '';

  // Filter to only the options this role can see
  const dashboardOptions = ALL_DASHBOARD_OPTIONS.filter(d => d.allowedRoles.includes(role));

  // Determine current dashboard based on current path
  const getCurrentDashboardValue = () => {
    // "/" and "/dashboard" are the same Overview page
    const path = location === '/dashboard' ? '/' : location;
    const currentOption = dashboardOptions.find(d => d.path === path);
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
 aria-label="Switch dashboard view"
 className={`flex items-center gap-2 bg-muted hover:bg-muted/70 border border-foreground/25 hover:border-foreground/40 text-foreground shadow-sm ${compact ? "h-9 px-2.5" : ""}`}
 >
 <div className={`w-2 h-2 rounded-full shrink-0 ${currentDashboard?.color ?? "bg-emerald-600"}`}></div>
 <Icon className="h-4 w-4 shrink-0" />
 {!compact && <span className="hidden md:inline-block">{currentDashboard?.label ?? "Dashboard"}</span>}
 {!compact && <span className="md:hidden">Dashboard</span>}
 <ChevronDown className="h-4 w-4 ml-0.5 shrink-0" />
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