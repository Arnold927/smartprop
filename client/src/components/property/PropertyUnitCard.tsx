import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BedDouble, Bath, Square, ToggleLeft, ToggleRight, User } from "lucide-react";
import { Unit } from "@/types/unit";
import { getPropertyGradient } from "@/lib/propertyGradient";
import { Tenant } from "@/types/tenant";

interface PropertyUnitCardProps {
  unit: Unit;
  propertyName: string;
  tenant?: Tenant | null;
  onClick: () => void;
  onToggleVacancy?: (unitId: number, isOccupied: boolean) => void;
  isTogglingVacancy?: boolean;
}

/** Mirrors the property card placeholder — keyed on the same property name */
function UnitPlaceholder({ unitNumber, propertyName }: { unitNumber: string | number; propertyName: string }) {
  const gradient = getPropertyGradient(propertyName);

  return (
    <div className={`w-full h-full bg-gradient-to-br ${gradient} flex flex-col items-center justify-center gap-1`}>
      <span className="text-4xl font-black text-white/80 tracking-tight leading-none">
        {unitNumber}
      </span>
      <span className="text-[10px] uppercase tracking-widest text-white/50 font-semibold">Unit</span>
    </div>
  );
}

export function PropertyUnitCard({ unit, propertyName, tenant, onClick, onToggleVacancy, isTogglingVacancy }: PropertyUnitCardProps) {
  return (
    <Card
      className="overflow-hidden hover:shadow-lg transition-all duration-200 border-border dark:border-gray-800 group"
    >
      <CardContent className="p-0">
        {/* Image / placeholder — clickable to view tenant */}
        <div className="aspect-video relative overflow-hidden cursor-pointer" onClick={onClick}>
          {unit.unitImages?.[0] ? (
            <img
              src={unit.unitImages[0]}
              alt={`Unit ${unit.unitNumber}`}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <UnitPlaceholder unitNumber={unit.unitNumber} propertyName={propertyName} />
          )}
          <div className="absolute top-2 right-2">
            <Badge
              className={
                unit.isOccupied
                  ? "bg-green-500 text-white border-0"
                  : "bg-white/90 text-gray-600 border-0"
              }
            >
              {unit.isOccupied ? "Occupied" : "Vacant"}
            </Badge>
          </div>
        </div>

        {/* Card body */}
        <div className="p-4">
          <div className="flex justify-between items-start mb-2">
            <h3 className="font-bold text-base text-foreground">Unit {unit.unitNumber}</h3>
            <p className="font-bold text-blue-600 dark:text-blue-400 text-sm">
              Ksh {Number(unit.monthlyRent ?? 0).toLocaleString()}
              <span className="text-[10px] font-normal text-muted-foreground">/mo</span>
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
            <span className="flex items-center gap-1">
              <BedDouble className="h-3 w-3" /> {unit.bedrooms ?? "—"} Bed
            </span>
            <span className="text-border">·</span>
            <span className="flex items-center gap-1">
              <Bath className="h-3 w-3" /> {unit.bathrooms ?? "—"} Bath
            </span>
            {unit.sqft ? (
              <>
                <span className="text-border">·</span>
                <span className="flex items-center gap-1">
                  <Square className="h-3 w-3" /> {unit.sqft} sqft
                </span>
              </>
            ) : null}
          </div>

          {/* Tenant row */}
          {tenant ? (
            <button
              className="w-full flex items-center gap-2 text-xs text-blue-600 hover:text-blue-700 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-950/70 rounded-lg px-3 py-2 transition-colors mb-2"
              onClick={onClick}
            >
              <User className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="font-medium truncate">{tenant.firstName} {tenant.lastName}</span>
            </button>
          ) : (
            <p className="text-xs text-muted-foreground italic mb-2">No tenant assigned</p>
          )}

          {/* Vacancy toggle */}
          {onToggleVacancy && (
            <Button
              variant="outline"
              size="sm"
              className={`w-full h-8 text-xs gap-1.5 ${unit.isOccupied ? "text-amber-600 border-amber-200 hover:bg-amber-50 dark:hover:bg-amber-950/40" : "text-green-600 border-green-200 hover:bg-green-50 dark:hover:bg-green-950/40"}`}
              disabled={isTogglingVacancy}
              onClick={e => { e.stopPropagation(); onToggleVacancy(unit.id, !unit.isOccupied); }}
            >
              {unit.isOccupied ? (
                <><ToggleRight className="h-3.5 w-3.5" /> Mark as Vacant</>
              ) : (
                <><ToggleLeft className="h-3.5 w-3.5" /> Mark as Occupied</>
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
