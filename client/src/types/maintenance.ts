export interface MaintenanceRequest {
  id: number;
  ticketNumber: string;
  title: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: string;
  category: string;
  createdAt: string;
  tenant: {
    firstName: string;
    lastName: string;
  };
  unit: {
    unitNumber: string;
  };
  property: {
    name: string;
  };
  estimatedCost?: string;
}