export type TenantStatus = "active" | "pending" | "inactive";

export interface Tenant {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  unitId?: number;
  leaseStartDate: string;
  leaseEndDate: string;
  monthlyRent: number;
  securityDeposit?: number;
  status: TenantStatus;
}