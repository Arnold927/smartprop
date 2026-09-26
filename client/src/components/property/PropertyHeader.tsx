import { Button } from "@/components/ui/button";
import { ArrowLeft, MapPin, Plus, Users, Home, TrendingUp, DollarSign, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useLocation } from "wouter";
import { getPropertyGradient } from "@/lib/propertyGradient";
import { getOrgIdFromSearch, withOrgParam } from "@/lib/platformOrgContext";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface PropertyHeaderProps {
  property: any;
  onAddUnit: () => void;
  onAddTenant: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  isManager?: boolean; // true for admin/manager/landlord — controls add-unit/add-tenant buttons; false hides them (e.g. staff, caretaker)
}

function fmt(n: number) {
  return `Ksh ${Number(n ?? 0).toLocaleString()}`;
}

export function PropertyHeader({ property, onAddUnit, onAddTenant, onEdit, onDelete, isManager = true }: PropertyHeaderProps) {
  const [, setLocation] = useLocation();
  // Preserve the platform_admin org context on the way back — previously
  // this was dropped entirely, landing on a bare /properties with no
  // organizationId, which for platform_admin (no fixed org of their own)
  // meant the properties list came back empty.
  const orgIdParam = getOrgIdFromSearch(window.location.search);

  const units   = property.units   ?? [];
  const tenants = property.tenants ?? [];
  const stats   = property.stats   ?? {};

  const occupiedUnits  = stats.occupiedUnits  ?? units.filter((u: any) => u.isOccupied).length;
  const totalUnits     = stats.totalUnits     ?? units.length;
  const occupancyRate  = stats.occupancyRate  ?? (totalUnits > 0 ? Math.round((occupiedUnits / totalUnits) * 100) : 0);
  const monthlyIncome  = units.filter((u: any) => u.isOccupied).reduce((s: number, u: any) => s + Number(u.monthlyRent ?? 0), 0);
  const activeTenants  = tenants.filter((t: any) => t.status === "active").length;

  const gradient = getPropertyGradient(property.name ?? "");

  // Initials for the avatar
  const initials = (property.name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w: string) => w[0].toUpperCase())
    .join("");

  const occupancyColor =
    occupancyRate >= 90 ? "text-green-600 dark:text-green-400" :
    occupancyRate >= 70 ? "text-amber-600 dark:text-amber-400" :
                          "text-red-500 dark:text-red-400";

  const occupancyBarColor =
    occupancyRate >= 90 ? "bg-green-500" :
    occupancyRate >= 70 ? "bg-amber-400" :
                          "bg-red-400";

  return (
    <div className="bg-card dark:bg-gray-900 border-b border-border dark:border-gray-800" >
      <div className="max-w-7xl mx-auto px-4 md:px-6">

        {/* Back nav */}
        <div className="pt-4 pb-1">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 text-muted-foreground hover:text-foreground h-8 text-xs"
            onClick={() => setLocation(withOrgParam("/properties", orgIdParam))}
          >
            <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
            Back to Properties
          </Button>
        </div>

        {/* Main header row */}
        <div className="py-5 flex flex-col md:flex-row md:items-start gap-5">

          {/* Avatar + name block */}
          <div className="flex items-center gap-4 flex-1 min-w-0">
            {/* Gradient avatar matching property card */}
            {property.imageUrl ? (
              <div className="w-16 h-16 rounded-2xl overflow-hidden shadow-md flex-shrink-0">
                <img src={property.imageUrl} alt={property.name} className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${gradient} flex flex-col items-center justify-center shadow-md flex-shrink-0`}>
                <span className="text-xl font-black text-white/90 leading-none">{initials}</span>
              </div>
            )}

            <div className="min-w-0">
              <h1 className="text-2xl md:text-3xl font-bold text-foreground leading-tight truncate">
                {property.name}
              </h1>
              <div className="flex items-center text-muted-foreground mt-1 gap-1">
                <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="text-sm truncate">{property.address}</span>
              </div>

              {/* Occupancy bar — inline under address */}
              <div className="flex items-center gap-2 mt-2.5">
                <div className="w-32 bg-muted dark:bg-gray-800 rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-1.5 rounded-full transition-all ${occupancyBarColor}`}
                    style={{ width: `${occupancyRate}%` }}
                  />
                </div>
                <span className={`text-xs font-semibold ${occupancyColor}`}>{occupancyRate}% occupied</span>
              </div>
            </div>
          </div>

          {/* Action buttons — admin/manager, and landlords who self-manage (isManager
              covers all three; see property-details.tsx for the exact role check) */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {isManager && (
              <Button
                size="sm"
                className="bg-blue-600 hover:bg-blue-700 text-white"
                onClick={onAddUnit}
              >
                <Plus className="h-4 w-4 mr-1.5" />
                Add Unit
              </Button>
            )}
            {isManager && (
              <Button
                size="sm"
                variant="outline"
                onClick={onAddTenant}
              >
                <Plus className="h-4 w-4 mr-1.5" />
                Add Tenant
              </Button>
            )}

            {/* Overflow menu for secondary actions */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="px-2">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {onEdit && (
                  <DropdownMenuItem onClick={onEdit}>
                    <Pencil className="h-4 w-4 mr-2" /> Edit Property
                  </DropdownMenuItem>
                )}
                {onDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-red-600" onClick={onDelete}>
                      <Trash2 className="h-4 w-4 mr-2" /> Delete Property
                    </DropdownMenuItem>
                  </>
                )}
                {!onEdit && !onDelete && (
                  <DropdownMenuItem disabled className="text-muted-foreground text-xs">
                    No actions available
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border dark:bg-gray-800 border-t border-border dark:border-gray-800 -mx-4 md:-mx-6">
          {[
            {
              icon: <Home className="h-4 w-4 text-blue-500" />,
              label: "Total Units",
              value: totalUnits,
              sub: `${occupiedUnits} occupied`,
            },
            {
              icon: <Users className="h-4 w-4 text-violet-500" />,
              label: "Active Tenants",
              value: activeTenants,
              sub: `${tenants.length} total`,
            },
            {
              icon: <TrendingUp className="h-4 w-4 text-green-500" />,
              label: "Occupancy",
              value: `${occupancyRate}%`,
              sub: `${totalUnits - occupiedUnits} vacant`,
            },
            {
              icon: <DollarSign className="h-4 w-4 text-amber-500" />,
              label: "Monthly Income",
              value: fmt(monthlyIncome),
              sub: "from occupied units",
              wide: true,
            },
          ].map((kpi, i) => (
            <div
              key={i}
              className="bg-card dark:bg-gray-900 px-4 md:px-6 py-3.5 flex items-center gap-3"
            >
              <div className="p-2 rounded-lg bg-muted dark:bg-gray-800 flex-shrink-0">
                {kpi.icon}
              </div>
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{kpi.label}</p>
                <p className="text-base font-bold text-foreground leading-tight truncate">{kpi.value}</p>
                <p className="text-[11px] text-muted-foreground">{kpi.sub}</p>
              </div>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}