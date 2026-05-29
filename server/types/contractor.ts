export interface ServiceContractor {
  id: number;
  organizationId?: number;
  categoryId?: number;
  companyName?: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  address?: string;
  hourlyRate?: number;
  dailyRate?: number;
  currency?: string;
  servicesOffered?: string[];
  coverageAreas?: string[]; 
  status?: string;
  vettingStatus?: string;
  overallRating?: number;
  totalJobsCompleted?: number;
  contractStartDate?: string;
  contractEndDate?: string;
  slaAdherenceScore?: number;
  category?: {
    name: string;
    description: string;
  };
}