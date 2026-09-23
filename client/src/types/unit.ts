// types/unit.ts
export interface Unit {
  id: number;
  unitNumber: string;
  unitType?: "apartment" | "house" | "office" | "retail" | "kiosk" | "anchor_retail" | "warehouse" | "parking" | "storage" | "other";
  bedrooms?: number | null;
  bathrooms?: number | null;
  sqft: number;
  rentBasis?: "fixed" | "per_sqft" | "percentage_of_sales";
  ratePerSqft?: number | null;
  monthlyRent: number;
  currency: string;
  isOccupied: boolean;
  unitImages?: string[];
  propertyId?: number;
  organizationId?: number;
}