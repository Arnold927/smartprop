// server/types/maintenance.ts

export type TenantInfo = {
  id: number;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
};

export type UnitInfo = {
  id: number;
  unitNumber: string;
  propertyId: number;
};

export type PropertyInfo = {
  id: number;
  name: string;
  address?: string | null;
};

export type MaintenanceRequestWithRelations = {
  id: number;
  ticketNumber: string;
  tenantId: number | null;
  unitId: number | null;
  contractorId: number | null;
  title: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  assignedTo: string | null;
  assignedDate: Date | null;
  startedDate: Date | null;
  estimatedCost: number | null;
  actualCost: number | null;
  estimatedHours: number | null;
  actualHours: number | null;
  currency: string;
  scheduledDate: Date | null;
  approvalRequired: boolean;
  approvedBy: string | null;
  approvedDate: Date | null;
  rejectionReason: string | null;
  tenantNotes: string | null;
  contractorNotes: string | null;
  internalNotes: string | null;
  customerSatisfaction: number | null;
  satisfactionRating: number | null;
  satisfactionComments: string | null;
  feedbackDate: Date | null;
  responseTime: number | null;
  resolutionTime: number | null;
  technicianId: number | null;
  technicianNotes: string | null;
  timeLog: any;
  totalTimeSpent: number | null;
  workStartTime: Date | null;
  workEndTime: Date | null;
  followUpRequired: boolean;
  followUpDate: Date | null;
  recurrence: string;
  completedAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;

  tenant: TenantInfo | null;
  unit: UnitInfo | null;
  property: PropertyInfo | null;
};
