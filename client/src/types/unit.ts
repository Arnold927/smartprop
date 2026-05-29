// types/unit.ts
export interface Unit {
  id: number;
  unitNumber: string;
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  monthlyRent: number;
  currency: string;
  isOccupied: boolean;
  unitImages?: string[];
  propertyId?: number;
  organizationId?: number;
}