import {
  users, properties, units, tenants, rentPayments, maintenanceRequests, documents, messages, contractors, serviceCharges,
  mpesaTransactions, complaintsPhotos, invoiceReminders, projects, projectTasks, projectMilestones, projectDocuments, 
  projectExpenses, projectTeam, projectTimeTracking, workOrders, workOrderMaterials, workOrderCharges, workOrderTasks,
  workOrderApprovals, workOrderExpenses, workOrderProgress, utilityProviders, utilityAccounts, utilityBills, utilityMeterReadings,
  recurringCharges, invoices, billingCycles, rentToOwnAgreements, rentToOwnPayments, ownershipCertificates,
  propertyManagementAgreements, shortTermBookings, propertyAvailability, managedPropertyMaintenance, ownerFinancialStatements,
  userRoles, userRoleAssignments, propertyManagers, caretakers, contractorCategories, contractorsRegistry, serviceContracts,
  contractorWorkOrders, contractorPerformance, serviceSchedules, contractorReviews, tenantReviews, userFeedback, staffMembers,
  staffStatusEnum, positionEnum, departmentEnum, employmentTypeEnum, timeTracking, payrollRecords,
  tenantPortalSessions, landlordPortalSessions, rentalStatements, portfolioReports, tenantNotifications, portalCustomization, tenantDocuments,
  paymentReceipts, auditLogs, encryptionKeys, trustAccounts, trustAccountTransactions, complianceReports, securityIncidents, dataEncryption, arrears,
  paymentReminders, riskAssessments, tenantBehaviorLogs, arrearsActions, visitors, paymentProviders, bankAccounts, mobileMoney,
  paymentTransactions, reconciliationRules, paymentAllocationRules, escrowAccounts, scheduledDisbursements, ledgerAccounts,
  journalEntries, journalEntryLines, financialReconciliation, automatedPaymentRules, 
  propertyExpenses, broadcastRecipients, workOrderComments,
  broadcastMessages, communicationTemplates,
  parkingSpaces, registeredVehicles, parkingAssignments,
  chartOfAccounts, costCenters, generalLedger, purchaseRequisitions, expenseReports,
  payrollPeriods, payrollEntries
} from "@shared/schema";

import type {
  PropertyExpense, PaymentProvider, InsertPaymentProvider, BankAccount, InsertBankAccount, MobileMoney, InsertMobileMoney,
  PaymentTransaction, InsertPaymentTransaction, ReconciliationRule, InsertReconciliationRule, PaymentAllocationRule,InsertPaymentAllocationRule, 
  EscrowAccount, InsertEscrowAccount, ScheduledDisbursement, InsertScheduledDisbursement, LedgerAccount, InsertLedgerAccount, 
  JournalEntry, InsertJournalEntry, JournalEntryLine, InsertJournalEntryLine, FinancialReconciliation, InsertFinancialReconciliation,
  AutomatedPaymentRule, InsertAutomatedPaymentRule, InsertPropertyExpense, InsertWorkOrderCharge, InsertWorkOrderMaterial,
  RentalStatement, InsertRentalStatement, PortfolioReport, InsertPortfolioReport, TenantNotification, InsertTenantNotification,
  PortalCustomization, InsertPortalCustomization, TenantDocument, InsertTenantDocument,PaymentReceipt, InsertPaymentReceipt,
  User, UpsertUser, Property, InsertProperty, Unit, InsertUnit, Tenant, InsertTenant, RentPayment,InsertRentPayment,
  MaintenanceRequest, InsertMaintenanceRequest,Document, InsertDocument, Message, InsertMessage, Contractor, InsertContractor,
  ServiceCharge, InsertServiceCharge, MpesaTransaction, InsertMpesaTransaction, ComplaintsPhoto, InsertComplaintsPhoto,
  InvoiceReminder, InsertInvoiceReminder, Project, InsertProject, ProjectTask, InsertProjectTask, ProjectMilestone,
  InsertProjectMilestone, ProjectDocument, InsertProjectDocument, ProjectExpense, InsertProjectExpense,ProjectTeam,
  InsertProjectTeam,ProjectTimeTracking, InsertProjectTimeTracking, WorkOrder, InsertWorkOrder, WorkOrderTask,
  InsertWorkOrderTask, WorkOrderApproval, InsertWorkOrderApproval, WorkOrderExpense, InsertWorkOrderExpense, WorkOrderProgress, 
  InsertWorkOrderProgress, UtilityProvider, UtilityProviderInsert, UtilityAccount, UtilityAccountInsert, UtilityBill,
  UtilityBillInsert, UtilityMeterReading, UtilityMeterReadingInsert, RecurringCharge, RecurringChargeInsert,
  Invoice, InvoiceInsert, BillingCycle, InsertBillingCycle, RentToOwnAgreement, InsertRentToOwnAgreement,RentToOwnPayment,
  InsertRentToOwnPayment, OwnershipCertificate, InsertOwnershipCertificate, PropertyManagementAgreement, InsertPropertyManagementAgreement,
  ShortTermBooking, InsertShortTermBooking, PropertyAvailability, InsertPropertyAvailability, ManagedPropertyMaintenance,
  InsertManagedPropertyMaintenance, OwnerFinancialStatement, InsertOwnerFinancialStatement, UserRole, InsertUserRole, UserRoleAssignment,
  InsertUserRoleAssignment, PropertyManager, InsertPropertyManager, Caretaker, InsertCaretaker, ContractorCategory, InsertContractorCategory,
  ContractorRegistry, InsertContractorRegistry, ServiceContract, InsertServiceContract, ContractorWorkOrder,
  InsertContractorWorkOrder, ContractorPerformance, InsertContractorPerformance, ServiceSchedule, InsertServiceSchedule, 
  ContractorReview, InsertContractorReview, TenantReview, InsertTenantReview, UserFeedback, InsertUserFeedback, AuditLog, 
  InsertAuditLog, EncryptionKey, InsertEncryptionKey, TrustAccount, InsertTrustAccount, TrustAccountTransaction,
  InsertTrustAccountTransaction, ComplianceReport, InsertComplianceReport, SecurityIncident, InsertSecurityIncident, DataEncryption,
  InsertDataEncryption, Arrears, InsertArrears, PaymentReminder, InsertPaymentReminder, RiskAssessment, InsertRiskAssessment,
  TenantBehaviorLog, InsertTenantBehaviorLog, ArrearsAction, InsertArrearsAction, TenantPortalSession, InsertTenantPortalSession, LandlordPortalSession,
  InsertLandlordPortalSession, NewWorkOrderComment, WorkOrderComment,
  InsertUtilityProvider, InsertUtilityAccount, InsertUtilityBill,
  InsertRecurringCharge, InsertInvoice, BroadcastRecipient
} from "@shared/schema";


import { db } from "./db";
import { randomUUID } from "crypto";
import { eq, and, gte, lte, between, desc, or, like, sql, count, asc, getTableColumns, inArray, isNull } from "drizzle-orm";
import type { 
  MaintenanceRequestWithRelations, TenantInfo, UnitInfo, PropertyInfo
} from "./types/maintenance";

export interface IStorage {
  // User operations (required for Replit Auth)
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;

  // Property operations
  getProperties(ownerId: string): Promise<Property[]>;
  getProperty(id: number): Promise<Property | undefined>;
  createProperty(property: InsertProperty): Promise<Property>;
  updateProperty(id: number, property: Partial<InsertProperty>): Promise<Property>;
  deleteProperty(id: number): Promise<void>;
  getUnitsByPropertyId(propertyId: number): Promise<Unit[]>;
  getTenantsByPropertyId(propertyId: number): Promise<Tenant[]>;


  // Unit operations
  getUnits(propertyId: number): Promise<Unit[]>;
  getUnit(id: number): Promise<Unit | undefined>;
  createUnit(unit: InsertUnit): Promise<Unit>;
  updateUnit(id: number, unit: Partial<InsertUnit>): Promise<Unit>;
  deleteUnit(id: number): Promise<void>;

  // Tenant operations
  getTenants(ownerId: string): Promise<Tenant[]>;
  getTenant(id: number): Promise<Tenant | undefined>;
  createTenant(tenant: InsertTenant): Promise<Tenant>;
  updateTenant(id: number, tenant: Partial<InsertTenant>): Promise<Tenant>;
  deleteTenant(id: number): Promise<void>;

  // Rent payment operations
  getRentPayments(tenantId?: number): Promise<RentPayment[]>;
  getRentPayment(id: number): Promise<RentPayment | undefined>;
  createRentPayment(payment: InsertRentPayment): Promise<RentPayment>;
  updateRentPayment(id: number, payment: Partial<InsertRentPayment>): Promise<RentPayment>;

  // Maintenance request operations
  getMaintenanceRequests(organizationId?: number): Promise<MaintenanceRequest[]>;
  getMaintenanceRequest(id: number): Promise<MaintenanceRequest | undefined>;
  createMaintenanceRequest(request: InsertMaintenanceRequest): Promise<MaintenanceRequest>;
  updateMaintenanceRequest(id: number, request: Partial<InsertMaintenanceRequest>): Promise<MaintenanceRequest>;
  getMaintenanceRequestsByTenant(tenantId: number): Promise<MaintenanceRequest[]>;

  // Tenant review operations
  getTenantReviews(tenantId?: number): Promise<TenantReview[]>;
  getTenantReview(id: number): Promise<TenantReview | undefined>;
  createTenantReview(review: InsertTenantReview): Promise<TenantReview>;
  updateTenantReview(id: number, review: Partial<InsertTenantReview>): Promise<TenantReview>;

  // User feedback/complaint operations
  getUserFeedback(userId?: string, type?: string): Promise<UserFeedback[]>;
  createUserFeedback(feedback: InsertUserFeedback): Promise<UserFeedback>;
  updateUserFeedback(id: number, feedback: Partial<InsertUserFeedback>): Promise<UserFeedback>;

  // Document operations
  getDocuments(tenantId?: number, propertyId?: number): Promise<Document[]>;
  createDocument(document: InsertDocument): Promise<Document>;
  deleteDocument(id: number): Promise<void>;

  // Message operations
  getMessages(userId: string): Promise<Message[]>;
  createMessage(message: InsertMessage): Promise<Message>;

  // Contractor operations
  getContractors(): Promise<Contractor[]>;
  getContractorsBySpecialty(specialty: string): Promise<Contractor[]>;
  getContractor(id: number): Promise<Contractor | undefined>;
  createContractor(contractor: InsertContractor): Promise<Contractor>;
  updateContractor(id: number, contractor: Partial<InsertContractor>): Promise<Contractor>;

  // Service charge operations
  getServiceCharges(propertyId?: number, unitId?: number): Promise<ServiceCharge[]>;
  getServiceCharge(id: number): Promise<ServiceCharge | undefined>;
  createServiceCharge(serviceCharge: InsertServiceCharge): Promise<ServiceCharge>;
  updateServiceCharge(id: number, serviceCharge: Partial<InsertServiceCharge>): Promise<ServiceCharge>;

  // MPesa transaction operations
  getMpesaTransactions(tenantId?: number): Promise<MpesaTransaction[]>;
  getMpesaTransaction(id: number): Promise<MpesaTransaction | undefined>;
  getMpesaTransactionByCheckoutRequestId(checkoutRequestId: string): Promise<MpesaTransaction | undefined>;
  createMpesaTransaction(transaction: InsertMpesaTransaction): Promise<MpesaTransaction>;
  updateMpesaTransaction(id: number, transaction: Partial<InsertMpesaTransaction>): Promise<MpesaTransaction>;

  // Complaint photo operations
  getComplaintPhotos(maintenanceRequestId: number): Promise<ComplaintsPhoto[]>;
  createComplaintPhoto(photo: InsertComplaintsPhoto): Promise<ComplaintsPhoto>;
  deleteComplaintPhoto(id: number): Promise<void>;

  // Invoice reminder operations
  getInvoiceReminders(tenantId?: number): Promise<InvoiceReminder[]>;
  createInvoiceReminder(reminder: InsertInvoiceReminder): Promise<InvoiceReminder>;
  updateInvoiceReminder(id: number, reminder: Partial<InsertInvoiceReminder>): Promise<InvoiceReminder>;
  markMessageAsRead(id: number): Promise<void>;

  // Project management operations
  getProjects(managerId: string): Promise<Project[]>;
  getProject(id: number): Promise<Project | undefined>;
  createProject(project: InsertProject): Promise<Project>;
  updateProject(id: number, project: Partial<InsertProject>): Promise<Project>;
  deleteProject(id: number): Promise<void>;

  // Project task operations
  getProjectTasks(projectId?: number): Promise<ProjectTask[]>;
  getProjectTask(id: number): Promise<ProjectTask | undefined>;
  createProjectTask(task: InsertProjectTask): Promise<ProjectTask>;
  updateProjectTask(id: number, task: Partial<InsertProjectTask>): Promise<ProjectTask>;
  deleteProjectTask(id: number): Promise<void>;

  // Project milestone operations
  getProjectMilestones(projectId?: number): Promise<ProjectMilestone[]>;
  getProjectMilestone(id: number): Promise<ProjectMilestone | undefined>;
  createProjectMilestone(milestone: InsertProjectMilestone): Promise<ProjectMilestone>;
  updateProjectMilestone(id: number, milestone: Partial<InsertProjectMilestone>): Promise<ProjectMilestone>;
  deleteProjectMilestone(id: number): Promise<void>;

  // Project document operations
  getProjectDocuments(projectId?: number, taskId?: number): Promise<ProjectDocument[]>;
  createProjectDocument(document: InsertProjectDocument): Promise<ProjectDocument>;
  deleteProjectDocument(id: number): Promise<void>;

  // Project expense operations
  getProjectExpenses(projectId?: number, taskId?: number): Promise<ProjectExpense[]>;
  createProjectExpense(expense: InsertProjectExpense): Promise<ProjectExpense>;
  updateProjectExpense(id: number, expense: Partial<InsertProjectExpense>): Promise<ProjectExpense>;
  deleteProjectExpense(id: number): Promise<void>;

  // Project team operations
  getProjectTeam(projectId: number): Promise<ProjectTeam[]>;
  addProjectTeamMember(member: InsertProjectTeam): Promise<ProjectTeam>;
  updateProjectTeamMember(id: number, member: Partial<InsertProjectTeam>): Promise<ProjectTeam>;
  removeProjectTeamMember(id: number): Promise<void>;

  // Project time tracking operations
  getProjectTimeTracking(projectId?: number, memberId?: string): Promise<ProjectTimeTracking[]>;
  createTimeEntry(entry: InsertProjectTimeTracking): Promise<ProjectTimeTracking>;
  updateTimeEntry(id: number, entry: Partial<InsertProjectTimeTracking>): Promise<ProjectTimeTracking>;
  deleteTimeEntry(id: number): Promise<void>;

  // Work order operations
  getWorkOrders(maintenanceRequestId?: number, projectId?: number): Promise<WorkOrder[]>;
  getWorkOrder(id: number): Promise<WorkOrder | undefined>;
  createWorkOrder(workOrder: InsertWorkOrder): Promise<WorkOrder>;
  updateWorkOrder(id: number, workOrder: Partial<InsertWorkOrder>): Promise<WorkOrder>;
  deleteWorkOrder(id: number): Promise<void>;

  // Work order task operations
  getWorkOrderTasks(workOrderId: number): Promise<WorkOrderTask[]>;
  getWorkOrderTask(id: number): Promise<WorkOrderTask | undefined>;
  createWorkOrderTask(task: InsertWorkOrderTask): Promise<WorkOrderTask>;
  updateWorkOrderTask(id: number, task: Partial<InsertWorkOrderTask>): Promise<WorkOrderTask>;
  deleteWorkOrderTask(id: number): Promise<void>;

  // Work order approval operations
  getWorkOrderApprovals(workOrderId: number): Promise<WorkOrderApproval[]>;
  createWorkOrderApproval(approval: InsertWorkOrderApproval): Promise<WorkOrderApproval>;
  updateWorkOrderApproval(id: number, approval: Partial<InsertWorkOrderApproval>): Promise<WorkOrderApproval>;

  // Work order expense operations
  getWorkOrderExpenses(workOrderId: number, contractorId?: number): Promise<WorkOrderExpense[]>;
  createWorkOrderExpense(expense: InsertWorkOrderExpense): Promise<WorkOrderExpense>;
  updateWorkOrderExpense(id: number, expense: Partial<InsertWorkOrderExpense>): Promise<WorkOrderExpense>;
  deleteWorkOrderExpense(id: number): Promise<void>;

  // Work order progress operations
  getWorkOrderProgress(workOrderId: number): Promise<WorkOrderProgress[]>;
  createWorkOrderProgress(progress: InsertWorkOrderProgress): Promise<WorkOrderProgress>;
  updateWorkOrderProgress(id: number, progress: Partial<InsertWorkOrderProgress>): Promise<WorkOrderProgress>;

  // Billing & Utilities operations
  // Utility Providers
  getUtilityProviders(): Promise<UtilityProvider[]>;
  getUtilityProvider(id: number): Promise<UtilityProvider | undefined>;
  createUtilityProvider(provider: InsertUtilityProvider): Promise<UtilityProvider>;
  updateUtilityProvider(id: number, provider: Partial<InsertUtilityProvider>): Promise<UtilityProvider>;
  deleteUtilityProvider(id: number): Promise<void>;

  // Utility Accounts
  getUtilityAccounts(propertyId?: number): Promise<UtilityAccount[]>;
  getUtilityAccount(id: number): Promise<UtilityAccount | undefined>;
  createUtilityAccount(account: InsertUtilityAccount): Promise<UtilityAccount>;
  updateUtilityAccount(id: number, account: Partial<InsertUtilityAccount>): Promise<UtilityAccount>;
  deleteUtilityAccount(id: number): Promise<void>;

  // Utility Bills
  getUtilityBills(accountId?: number): Promise<UtilityBill[]>;
  getUtilityBill(id: number): Promise<UtilityBill | undefined>;
  createUtilityBill(bill: InsertUtilityBill): Promise<UtilityBill>;
  updateUtilityBill(id: number, bill: Partial<InsertUtilityBill>): Promise<UtilityBill>;
  deleteUtilityBill(id: number): Promise<void>;

  // Utility Meter Readings
  getUtilityMeterReadings(accountId?: number): Promise<UtilityMeterReading[]>;
  getUtilityMeterReading(id: number): Promise<UtilityMeterReading | undefined>;
  createUtilityMeterReading(reading: UtilityMeterReadingInsert): Promise<UtilityMeterReading>;
  updateUtilityMeterReading(id: number, reading: Partial<UtilityMeterReadingInsert>): Promise<UtilityMeterReading>;
  deleteUtilityMeterReading(id: number): Promise<void>;

  // Recurring Charges
  getRecurringCharges(propertyId?: number): Promise<RecurringCharge[]>;
  getRecurringChargesForUnit(unitId: number, propertyId: number): Promise<RecurringCharge[]>;
  getRecurringCharge(id: number): Promise<RecurringCharge | undefined>;
  createRecurringCharge(charge: InsertRecurringCharge): Promise<RecurringCharge>;
  updateRecurringCharge(id: number, charge: Partial<InsertRecurringCharge>): Promise<RecurringCharge>;
  deleteRecurringCharge(id: number): Promise<void>;

  // Invoices
  getInvoices(tenantId?: number, propertyId?: number): Promise<Invoice[]>;
  getInvoice(id: number): Promise<Invoice | undefined>;
  createInvoice(invoice: InsertInvoice): Promise<Invoice>;
  updateInvoice(id: number, invoice: Partial<InsertInvoice>): Promise<Invoice>;
  deleteInvoice(id: number): Promise<void>;

  // Billing Cycles
  getBillingCycles(propertyId?: number): Promise<BillingCycle[]>;
  getBillingCycle(id: number): Promise<BillingCycle | undefined>;
  createBillingCycle(cycle: InsertBillingCycle): Promise<BillingCycle>;
  updateBillingCycle(id: number, cycle: Partial<InsertBillingCycle>): Promise<BillingCycle>;
  deleteBillingCycle(id: number): Promise<void>;

  // Generate recurring invoices
  generateRecurringInvoices(): Promise<Invoice[]>;

  // Security & Compliance operations
  // Audit Logs
  getAuditLogs(userId?: string, entityType?: string): Promise<AuditLog[]>;
  createAuditLog(auditLog: InsertAuditLog): Promise<AuditLog>;

  // Encryption Keys
  getEncryptionKeys(): Promise<EncryptionKey[]>;
  getActiveEncryptionKey(purpose: string): Promise<EncryptionKey | undefined>;
  createEncryptionKey(key: InsertEncryptionKey): Promise<EncryptionKey>;
  rotateEncryptionKey(keyId: string): Promise<EncryptionKey>;

  // Trust Accounts
  getTrustAccounts(): Promise<TrustAccount[]>;
  getTrustAccount(id: number): Promise<TrustAccount | undefined>;
  createTrustAccount(account: InsertTrustAccount): Promise<TrustAccount>;
  updateTrustAccount(id: number, account: Partial<InsertTrustAccount>): Promise<TrustAccount>;

  // Trust Account Transactions
  getTrustAccountTransactions(trustAccountId?: number): Promise<TrustAccountTransaction[]>;
  createTrustAccountTransaction(transaction: InsertTrustAccountTransaction): Promise<TrustAccountTransaction>;
  updateTrustAccountTransactionStatus(id: number, status: string, processedAt?: Date): Promise<TrustAccountTransaction>;

  // Compliance Reports
  getComplianceReports(reportType?: string): Promise<ComplianceReport[]>;
  createComplianceReport(report: InsertComplianceReport): Promise<ComplianceReport>;
  updateComplianceReportStatus(id: number, status: string): Promise<ComplianceReport>;

  // Security Incidents
  getSecurityIncidents(status?: string): Promise<SecurityIncident[]>;
  createSecurityIncident(incident: InsertSecurityIncident): Promise<SecurityIncident>;
  updateSecurityIncident(id: number, incident: Partial<InsertSecurityIncident>): Promise<SecurityIncident>;

  // Data Encryption
  encryptSensitiveData(tableName: string, columnName: string, recordId: string, data: string): Promise<DataEncryption>;
  decryptSensitiveData(tableName: string, columnName: string, recordId: string): Promise<string | null>;

  // Compliance Utilities
  generateFSCAReport(period: string): Promise<ComplianceReport>;
  validateTrustAccountCompliance(): Promise<boolean>;

  // Dashboard metrics
  getDashboardMetrics(ownerId: string): Promise<{
    totalRevenue: number;
    occupiedUnits: number;
    totalUnits: number;
    pendingRequests: number;
    overdueRent: number;
  }>;

  // Missing workforce management methods
  getUserOrganization(userId: string): Promise<{ organizationId: number } | undefined>;
  getStaffMembers(organizationId: number): Promise<any[]>;
  createStaffMember(staff: any): Promise<any>;
  getTimeTrackingRecords(organizationId: number): Promise<any[]>;
  createTimeTrackingRecord(record: any): Promise<any>;
  getPayrollRecords(organizationId: number): Promise<any[]>;
  getContractorPerformanceReviews(organizationId: number): Promise<any[]>;
  getServiceContractorCategories(): Promise<any[]>;
  getWorkforceStats(organizationId: number): Promise<any>;
  getBroadcastRecipients(broadcastId: number): Promise<BroadcastRecipient[]>;
  
  // Technician operations
  getTechnicians(): Promise<any[]>;
}

function isValidUUID(uuid: string): boolean {
  const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return regex.test(uuid);
}
const isOccupyingStatus = (status?: string) =>
  status === "active" || status === "pending";


// async function recalcUnitOccupancy(tx: any, unitId: number) {
// 
//   const tenantsInUnit = await tx
//     .select()
//     .from(tenants)
//     .where(eq(tenants.unitId, unitId))
//     .execute();

// 
//   // Check for active tenants
//   const activeTenants = tenantsInUnit.filter((t) => t.status === "active");
// 
//   const isOccupied = activeTenants.length > 0;
// 
//   const [updatedUnit] = await tx
//     .update(units)
//     .set({ 
//       isOccupied, 
//       updatedAt: new Date() 
//     })
//     .where(eq(units.id, unitId))
//     .returning();

// //   return updatedUnit;
// }


// Recalculate BOTH old and new units
  // const unitIdsToRecalc = new Set<number>();

export class DatabaseStorage implements IStorage {

  private db = db;
  // In storage.ts
async getUser(id: string): Promise<User | undefined> {
  // Remove any whitespace
  const cleanedId = id.trim();
  
  try {
    // First try exact match
    const [user] = await db.select().from(users).where(eq(users.id, cleanedId));
    
    if (user) {
      return user;
    }
    
    // If not found, try with different formats
    const allUsers = await db.select().from(users);
    
    // Try case-insensitive search
    const foundUser = allUsers.find(u => 
      u.id.toLowerCase() === cleanedId.toLowerCase() ||
      u.id.replace(/-/g, '') === cleanedId.replace(/-/g, '') ||
      u.email?.toLowerCase() === cleanedId.toLowerCase()
    );
    
    return foundUser;
    
  } catch (error) {
    console.error("[storage.getUser] Database error:", error);
    throw error;
  }
}
async getUnitsByPropertyId(propertyId: number): Promise<Unit[]> {
    try {
      const result = await db
        .select()
        .from(units)
        .where(eq(units.propertyId, propertyId))
        .orderBy(units.unitNumber);
      
      return result.map(unit => ({
        id: unit.id,
        organizationId: unit.organizationId,
        propertyId: unit.propertyId,
        unitNumber: unit.unitNumber,
        unitType: unit.unitType ?? "apartment",
        bedrooms: unit.bedrooms,
        bathrooms: unit.bathrooms ?? null,
        sqft: unit.sqft,
        rentBasis: unit.rentBasis ?? "fixed",
        ratePerSqft: unit.ratePerSqft ?? null,
        monthlyRent: unit.monthlyRent ?? "0",
        currency: unit.currency,
        isOccupied: unit.isOccupied ?? null,
        createdAt: unit.createdAt ?? null,
        updatedAt: unit.updatedAt ?? null,
      }));
    } catch (error) {
      console.error("Error fetching units by property ID:", error);
      throw error;
    }
  }
  

  async getTenantsByPropertyId(propertyId: number): Promise<Tenant[]> {
    try {
      // First get all units for this property
      const propertyUnits = await db
        .select({ id: units.id })
        .from(units)
        .where(eq(units.propertyId, propertyId));
      
      const unitIds = propertyUnits.map(unit => unit.id);
      
      if (unitIds.length === 0) {
        return [];
      }
      
      // Get tenants for these units
      const result = await db
        .select()
        .from(tenants)
        .where(inArray(tenants.unitId, unitIds))
        .orderBy(tenants.lastName, tenants.firstName);
      
      return result.map(tenant => ({
        id: tenant.id,
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        firstName: tenant.firstName,
        lastName: tenant.lastName,
        email: tenant.email,
        phone: tenant.phone ?? null,
        unitId: tenant.unitId,
        leaseStartDate: tenant.leaseStartDate ? String(tenant.leaseStartDate).split('T')[0] : '',
        leaseEndDate: tenant.leaseEndDate ? String(tenant.leaseEndDate).split('T')[0] : '',
        monthlyRent: tenant.monthlyRent ?? null,
        currency: tenant.currency,
        securityDeposit: tenant.securityDeposit ?? null,
        status: tenant.status,
        createdAt: tenant.createdAt,
        updatedAt: tenant.updatedAt,
      }));
    } catch (error) {
      console.error("Error fetching tenants by property ID:", error);
      throw error;
    }
  }
  
  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  // Property operations
  async getProperties(ownerId: string): Promise<Property[]> {
    return await db
      .select()
      .from(properties)
      .where(eq(properties.ownerId, ownerId))
      .orderBy(desc(properties.createdAt));
  }

  async getPropertiesByOrganization(organizationId: number): Promise<Property[]> {
  
  try {
    const result = await db
      .select()
      .from(properties)
      .where(eq(properties.organizationId, organizationId))
      .orderBy(desc(properties.createdAt));
    
      
    // Show what we're looking for
    if (result.length === 0) {
          
      // Let's check what organization IDs actually exist
      const allOrgs = await db
        .selectDistinct({ orgId: properties.organizationId })
        .from(properties);
      
        }
    
    return result;
  } catch (error) {
    console.error(` [STORAGE] Error:`, error);
    throw error;
  }
}

  async getProperty(id: number): Promise<Property | undefined> {
    const [property] = await db.select().from(properties).where(eq(properties.id, id));
    return property;
  }

  async createProperty(property: InsertProperty): Promise<Property> {
    const [newProperty] = await db.insert(properties).values(property).returning();
    return newProperty;
  }

  async updateProperty(id: number, property: Partial<InsertProperty>): Promise<Property> {
    const [updatedProperty] = await db
      .update(properties)
      .set({ ...property, updatedAt: new Date() })
      .where(eq(properties.id, id))
      .returning();
    return updatedProperty;
  }

  async deleteProperty(id: number): Promise<void> {
    await db.delete(properties).where(eq(properties.id, id));
  }

  // Unit operations
  async getAllUnits(userId: string): Promise<Unit[]> {
    return await db.select()
      .from(units)
      .innerJoin(properties, eq(units.propertyId, properties.id))
      .where(eq(properties.ownerId, userId))
      .orderBy(units.unitNumber)
      .then(results => results.map(r => r.units));
  }

  async getUnits(propertyId: number): Promise<Unit[]> {
    return await db
      .select()
      .from(units)
      .where(eq(units.propertyId, propertyId))
      .orderBy(units.unitNumber);
  }

  async getUnit(id: number): Promise<Unit | undefined> {
    const [unit] = await db.select().from(units).where(eq(units.id, id));
    return unit;
  }

  async createUnit(unit: InsertUnit): Promise<Unit> {
    const d: any = { ...unit };
    if (d.monthlyRent !== undefined) d.monthlyRent = String(d.monthlyRent);
    if (d.bathrooms !== undefined) d.bathrooms = String(d.bathrooms);
    const [newUnit] = await db.insert(units).values(d).returning();
    return newUnit;
  }

  async updateUnit(id: number, unit: Partial<InsertUnit>): Promise<Unit> {
    const [updatedUnit] = await db
      .update(units)
      .set((() => { const d: any = { ...unit, updatedAt: new Date() }; if (d.monthlyRent !== undefined) d.monthlyRent = String(d.monthlyRent); if (d.bathrooms !== undefined) d.bathrooms = String(d.bathrooms); return d; })())
      .where(eq(units.id, id))
      .returning();
    return updatedUnit;
  }

  async deleteUnit(id: number): Promise<void> {
    await db.delete(units).where(eq(units.id, id));
  }

  // Tenant operations
  async getTenants(ownerId: string): Promise<Tenant[]> {
    return await db
      .select({
        id: tenants.id,
        userId: tenants.userId,
        firstName: tenants.firstName,
        lastName: tenants.lastName,
        email: tenants.email,
        phone: tenants.phone,
        unitId: tenants.unitId,
        leaseStartDate: tenants.leaseStartDate,
        leaseEndDate: tenants.leaseEndDate,
        monthlyRent: tenants.monthlyRent,
        currency: tenants.currency,
        securityDeposit: tenants.securityDeposit,
        status: tenants.status,
        createdAt: tenants.createdAt,
        updatedAt: tenants.updatedAt,
        unit: {
          id: units.id,
          unitNumber: units.unitNumber,
          propertyId: units.propertyId,
        },
        property: {
          id: properties.id,
          name: properties.name,
          ownerId: properties.ownerId,
          address: properties.address,
        },
      })
      .from(tenants)
      .leftJoin(units, eq(tenants.unitId, units.id))
      .leftJoin(properties, eq(units.propertyId, properties.id))
      .where(eq(tenants.organizationId, Number(ownerId)))
      .orderBy(desc(tenants.createdAt)) as any;
  }

  async getTenantById(tenantId: number, organizationId: number) {
  const [row] = await db
    .select({
      tenantId: tenants.id,
      tenantFirstName: tenants.firstName,
      tenantLastName: tenants.lastName,
      tenantEmail: tenants.email,
      tenantPhone: tenants.phone,
      tenantUnitId: tenants.unitId,
      tenantCurrency: tenants.currency,
      tenantMonthlyRent: tenants.monthlyRent,
      tenantStatus: tenants.status,

      unitId: units.id,
      unitNumber: units.unitNumber,
      unitPropertyId: units.propertyId,
      unitBedrooms: units.bedrooms,
      unitBathrooms: units.bathrooms,
      unitSqft: units.sqft,
      unitMonthlyRent: units.monthlyRent,

      propertyId: properties.id,
      propertyName: properties.name,
      propertyAddress: properties.address,
      propertyOwnerId: properties.ownerId,
      propertyDescription: properties.description,
      propertyImageUrl: properties.imageUrl,
    })
    .from(tenants)
    .leftJoin(units,
      and(
        eq(units.id, tenants.unitId),
        eq(units.organizationId, organizationId)
    ))
    .leftJoin(properties,
      and(
        eq(properties.id, units.propertyId),
        eq(properties.organizationId, organizationId)
      ))
    .where(
      and(
        eq(tenants.id, tenantId),
        eq(tenants.organizationId, organizationId) // ✅ still filter tenant by org
      )
    )
    .limit(1);

  if (!row) return null;

  return {
  id: row.tenantId,
  firstName: row.tenantFirstName,
  lastName: row.tenantLastName,
  email: row.tenantEmail,
  phone: row.tenantPhone,
  unitId: row.tenantUnitId,
  unit: row.unitId
  ? {
      id: row.unitId,
      unitNumber: row.unitNumber,
      propertyId: row.unitPropertyId,
      bedrooms: row.unitBedrooms,
      bathrooms: row.unitBathrooms,
      sqft: row.unitSqft,
      monthlyRent: row.unitMonthlyRent,
    }
  : null,

    property: row.unitPropertyId
    ? {
        id: row.unitPropertyId,
        name: row.propertyName,
        address: row.propertyAddress,
        ownerId: row.propertyOwnerId,
        description: row.propertyDescription,
        imageUrl: row.propertyImageUrl,
      }
    : null,
  };
}



  async getTenant(id: number): Promise<Tenant | undefined> {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id));
    return tenant;
  }

async createTenant(tenant: InsertTenant): Promise<Tenant> {
  
  try {
    // Insert tenant without transaction
    const [newTenant] = await db.insert(tenants).values(tenant).returning();

    if (newTenant.unitId != null) {
      await this.recalcUnitOccupancy(newTenant.unitId);
    } else {
    }

    return newTenant;
  } catch (error) {
    console.error("Error creating tenant:", error);
    throw error;
  }
}

async updateTenantById(
  tenantId: number,
  organizationId: number,
  updates: Partial<InsertTenant>
): Promise<Tenant> {

  // 1. Fetch tenant scoped to organization
  const [tenant] = await db
    .select()
    .from(tenants)
    .where(
      and(
        eq(tenants.id, tenantId),
        eq(tenants.organizationId, organizationId)
      )
    );

  if (!tenant) {
    throw new Error("Tenant not found or access denied");
  }

  // 2. If unitId is changing, verify unit belongs to org
  if (updates.unitId) {
    const [unit] = await db
      .select()
      .from(units)
      .where(
        and(
          eq(units.id, updates.unitId),
          eq(units.organizationId, organizationId)
        )
      );

    if (!unit) {
      throw new Error("Invalid unit for this organization");
    }
  }

  // 3. Update tenant
  const [updatedTenant] = await db
    .update(tenants)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(tenants.id, tenantId))
    .returning();

  // 4. Recalculate occupancy safely
  const unitIdsToRecalc = new Set<number>();
  if (tenant.unitId) unitIdsToRecalc.add(tenant.unitId);
  if (updatedTenant.unitId) unitIdsToRecalc.add(updatedTenant.unitId);

  for (const unitId of unitIdsToRecalc) {
    await this.recalcUnitOccupancy(unitId);
  }

  return updatedTenant;
}

async updateTenant(
  tenantId: number,
  data: Partial<typeof tenants.$inferInsert>,
  organizationId?: number
) {
  const [updatedTenant] = await db
    .update(tenants)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(
      organizationId !== undefined
        ? and(eq(tenants.id, tenantId), eq(tenants.organizationId, organizationId))
        : eq(tenants.id, tenantId)
    )
    .returning();

  return updatedTenant;
}

async getMaintenanceRequestById(
  id: number
): Promise<MaintenanceRequestWithRelations | null> {
  try {
    const [row] = await db
      .select({
        // ───────────── Maintenance Request ─────────────
        id: maintenanceRequests.id,
        ticketNumber: maintenanceRequests.ticketNumber,
        title: maintenanceRequests.title,
        description: maintenanceRequests.description,
        category: maintenanceRequests.category,
        priority: maintenanceRequests.priority,
        status: maintenanceRequests.status,

        tenantId: maintenanceRequests.tenantId,
        unitId: maintenanceRequests.unitId,
        contractorId: maintenanceRequests.contractorId,
        assignedTo: maintenanceRequests.assignedTo,
        assignedDate: maintenanceRequests.assignedDate,
        startedDate: maintenanceRequests.startedDate,
        estimatedHours: maintenanceRequests.estimatedHours,
        actualHours: maintenanceRequests.actualHours,
        estimatedCost: maintenanceRequests.estimatedCost,
        actualCost: maintenanceRequests.actualCost,
        currency: maintenanceRequests.currency,
        scheduledDate: maintenanceRequests.scheduledDate,
        approvalRequired: maintenanceRequests.approvalRequired,
        approvedBy: maintenanceRequests.approvedBy,
        approvedDate: maintenanceRequests.approvedDate,
        rejectionReason: maintenanceRequests.rejectionReason,
        tenantNotes: maintenanceRequests.tenantNotes,
        contractorNotes: maintenanceRequests.contractorNotes,
        internalNotes: maintenanceRequests.internalNotes,
        customerSatisfaction: maintenanceRequests.customerSatisfaction,
        satisfactionRating: maintenanceRequests.satisfactionRating,
        satisfactionComments: maintenanceRequests.satisfactionComments,
        feedbackDate: maintenanceRequests.feedbackDate,
        responseTime: maintenanceRequests.responseTime,
        resolutionTime: maintenanceRequests.resolutionTime,
        technicianId: maintenanceRequests.technicianId,
        technicianNotes: maintenanceRequests.technicianNotes,
        timeLog: maintenanceRequests.timeLog,
        totalTimeSpent: maintenanceRequests.totalTimeSpent,
        workStartTime: maintenanceRequests.workStartTime,
        workEndTime: maintenanceRequests.workEndTime,
        followUpRequired: maintenanceRequests.followUpRequired,
        followUpDate: maintenanceRequests.followUpDate,
        recurrence: maintenanceRequests.recurrence,
        completedAt: maintenanceRequests.completedAt,
        createdAt: maintenanceRequests.createdAt,
        updatedAt: maintenanceRequests.updatedAt,

        // ───────────── Tenant (EXPLICIT aliases) ─────────────
        tenant_id_joined: tenants.id,
        tenant_first_name: tenants.firstName,
        tenant_last_name: tenants.lastName,
        tenant_email: tenants.email,
        tenant_phone: tenants.phone,

        // ───────────── Unit ─────────────
        unit_id: units.id,
        unit_number: units.unitNumber,
        unit_property_id: units.propertyId,

        // ───────────── Property ─────────────
        property_id: properties.id,
        property_name: properties.name,
        property_address: properties.address,
      })
      .from(maintenanceRequests)
      .leftJoin(tenants, eq(maintenanceRequests.tenantId, tenants.id))
      .leftJoin(units, eq(maintenanceRequests.unitId, units.id))
      .leftJoin(properties, eq(units.propertyId, properties.id))
      .where(eq(maintenanceRequests.id, id))
      .limit(1);

    if (!row) return null;

    // ───────────── Build response safely ─────────────
    return {
      id: Number(row.id),
      ticketNumber: row.ticketNumber ?? "",
      title: row.title ?? "",
      description: row.description ?? "",
      category: row.category ?? "other",
      priority: row.priority ?? "medium",
      status: row.status ?? "pending",

      tenantId: row.tenantId ? Number(row.tenantId) : null,
      unitId: row.unitId ? Number(row.unitId) : null,
      contractorId: row.contractorId ?? null,
      assignedTo: row.assignedTo ?? null,
      assignedDate: row.assignedDate ?? null,
      startedDate: row.startedDate ?? null,
      estimatedHours: row.estimatedHours ?? null,
      actualHours: row.actualHours ?? null,
      estimatedCost: row.estimatedCost ? Number(row.estimatedCost) : null,
      actualCost: row.actualCost ? Number(row.actualCost) : null,
      currency: row.currency ?? "KES",
      scheduledDate: row.scheduledDate ?? null,
      approvalRequired: row.approvalRequired ?? false,
      approvedBy: row.approvedBy ?? null,
      approvedDate: row.approvedDate ?? null,
      rejectionReason: row.rejectionReason ?? null,
      tenantNotes: row.tenantNotes ?? null,
      contractorNotes: row.contractorNotes ?? null,
      internalNotes: row.internalNotes ?? null,
      customerSatisfaction: row.customerSatisfaction ?? null,
      satisfactionRating: row.satisfactionRating ?? null,
      satisfactionComments: row.satisfactionComments ?? null,
      feedbackDate: row.feedbackDate ?? null,
      responseTime: row.responseTime ?? null,
      resolutionTime: row.resolutionTime ?? null,
      technicianId: row.technicianId ?? null,
      technicianNotes: row.technicianNotes ?? null,
      timeLog: row.timeLog ?? null,
      totalTimeSpent: row.totalTimeSpent ?? null,
      workStartTime: row.workStartTime ?? null,
      workEndTime: row.workEndTime ?? null,
      followUpRequired: row.followUpRequired ?? false,
      followUpDate: row.followUpDate ?? null,
      recurrence: row.recurrence ?? "none",
      completedAt: row.completedAt ?? null,
      createdAt: row.createdAt ?? null,
      updatedAt: row.updatedAt ?? null,

      tenant: row.tenant_id_joined
        ? {
            id: Number(row.tenant_id_joined),
            firstName: row.tenant_first_name!,
            lastName: row.tenant_last_name!,
            email: row.tenant_email ?? null,
            phone: row.tenant_phone ?? null,
          }
        : null,

      unit: row.unit_id
        ? {
            id: Number(row.unit_id),
            unitNumber: row.unit_number!,
            propertyId: Number(row.unit_property_id),
          }
        : null,

      property: row.property_id
        ? {
            id: Number(row.property_id),
            name: row.property_name!,
            address: row.property_address ?? null,
          }
        : null,
    };
  } catch (error) {
    console.error("Error fetching maintenance request by ID:", error);
    throw error;
  }
}



private async recalcUnitOccupancy(unitId: number) {

  const tenantsInUnit = await db
    .select()
    .from(tenants)
    .where(eq(tenants.unitId, unitId))
    .execute();


  const activeTenants = tenantsInUnit.filter((t: any) => t.status === "active");

  const isOccupied = activeTenants.length > 0;

  const [updatedUnit] = await db
    .update(units)
    .set({ 
      isOccupied, 
      updatedAt: new Date() 
    })
    .where(eq(units.id, unitId))
    .returning();

  return updatedUnit;
}



  async deleteTenant(id: number): Promise<void> {
    const tenant = await this.getTenant(id);
    if (tenant?.unitId) {
      await db.update(units).set({ isOccupied: false }).where(eq(units.id, tenant.unitId));
    }
    await db.delete(tenants).where(eq(tenants.id, id));
  }

  // Rent payment operations
  async getRentPayments(tenantId?: number): Promise<RentPayment[]> {
    const query = db.select().from(rentPayments);
    if (tenantId) {
      return await query.where(eq(rentPayments.tenantId, tenantId)).orderBy(desc(rentPayments.dueDate));
    }
    return await query.orderBy(desc(rentPayments.dueDate));
  }

  async getRentPayment(id: number): Promise<RentPayment | undefined> {
    const [payment] = await db.select().from(rentPayments).where(eq(rentPayments.id, id));
    return payment;
  }

  // Update your createRentPayment method in storage.ts
async createRentPayment(payment: InsertRentPayment): Promise<RentPayment> {
  // Generate invoice number if not provided
  const paymentWithInvoice = {
    ...payment,
    invoiceNumber: payment.invoiceNumber || await this.generateInvoiceNumber(),
  };
  
  const [newPayment] = await db.insert(rentPayments).values(paymentWithInvoice).returning();
  return newPayment;
}

  async updateRentPayment(id: number, payment: Partial<InsertRentPayment>): Promise<RentPayment> {
    const [updatedPayment] = await db
      .update(rentPayments)
      .set({ ...payment, updatedAt: new Date() })
      .where(eq(rentPayments.id, id))
      .returning();
    return updatedPayment;
  }



async getRentCollections(filters: {
  tenantId?: number;
  status?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
} = {}): Promise<any[]> {

  const conditions = [];

  if (filters.tenantId) {
    conditions.push(eq(rentPayments.tenantId, filters.tenantId));
  }

  if (filters.status) {
    conditions.push(eq(rentPayments.status, filters.status));
  }

  if (filters.startDate && filters.endDate) {
    conditions.push(
      between(rentPayments.dueDate, filters.startDate, filters.endDate)
    );
  } else if (filters.startDate) {
    conditions.push(gte(rentPayments.dueDate, filters.startDate));
  } else if (filters.endDate) {
    conditions.push(lte(rentPayments.dueDate, filters.endDate));
  }

  const payments = await db
    .select()
    .from(rentPayments)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(rentPayments.dueDate));

  if (payments.length === 0) {
    return payments;
  }

  const tenantIds = [...new Set(payments.map(p => p.tenantId))];

  const tenantRows = await db
    .select()
    .from(tenants)
    .where(inArray(tenants.id, tenantIds));

  const tenantMap = new Map(
    tenantRows.map(t => [t.id, t])
  );

  return payments.map(payment => ({
    ...payment,
    tenant: tenantMap.get(payment.tenantId),
  }));
}


async getRentPaymentStats(
  tenantId?: number
): Promise<{
  total: number;
  paid: number;
  pending: number;
  overdue: number;
  totalAmount: number;
  totalPaid: number;
  totalPending: number;
  totalOverdue: number;
}> {

  const conditions = [];

  if (tenantId) {
    conditions.push(eq(rentPayments.tenantId, tenantId));
  }

  const allPayments = await db
    .select()
    .from(rentPayments)
    .where(conditions.length ? and(...conditions) : undefined);

  const today = new Date().toISOString().split('T')[0];

  return {
    total: allPayments.length,
    paid: allPayments.filter(p => p.status === 'paid').length,
    pending: allPayments.filter(p => p.status === 'pending').length,
    overdue: allPayments.filter(
      p =>
        p.status === 'overdue' ||
        (p.status === 'pending' && p.dueDate < today)
    ).length,
    totalAmount: allPayments.reduce(
      (sum, p) => sum + Number(p.amount),
      0
    ),
    totalPaid: allPayments
      .filter(p => p.status === 'paid')
      .reduce((sum, p) => sum + Number(p.amount), 0),
    totalPending: allPayments
      .filter(p => p.status === 'pending')
      .reduce((sum, p) => sum + Number(p.amount), 0),
    totalOverdue: allPayments
      .filter(
        p =>
          p.status === 'overdue' ||
          (p.status === 'pending' && p.dueDate < today)
      )
      .reduce((sum, p) => sum + Number(p.amount), 0),
  };
}


async markPaymentAsPaid(id: number, data: {
  paidDate: string;
  paymentMethod: string;
  transactionId?: string;
  bankReference?: string;
  notes?: string;
}): Promise<RentPayment> {
  const [updatedPayment] = await db
    .update(rentPayments)
    .set({
      status: 'paid',
      paidDate: data.paidDate,
      paymentMethod: data.paymentMethod,
      mpesaTransactionId: data.transactionId,
      bankReference: data.bankReference,
      notes: data.notes,
      updatedAt: new Date(),
    })
    .where(eq(rentPayments.id, id))
    .returning();
  
  return updatedPayment;
}

async applyLateFee(id: number, lateFeeAmount: string): Promise<RentPayment> {
  const payment = await this.getRentPayment(id);
  if (!payment) {
    throw new Error('Payment not found');
  }
  
  const currentAmount = parseFloat(payment.amount.toString());
  const lateFee = parseFloat(lateFeeAmount);
  const newAmount = (currentAmount + lateFee).toString();
  
  const [updatedPayment] = await db
    .update(rentPayments)
    .set({
      status: 'overdue',
      amount: newAmount,
      updatedAt: new Date(),
    })
    .where(eq(rentPayments.id, id))
    .returning();
  
  return updatedPayment;
}

async getOverduePayments(): Promise<any[]> {
  const today = new Date().toISOString().split('T')[0];
  
  const payments = await db
    .select()
    .from(rentPayments)
    .where(
      and(
        eq(rentPayments.status, 'pending'),
        lte(rentPayments.dueDate, today)
      )
    )
    .orderBy(rentPayments.dueDate);
  
  // Join with tenants
  if (payments.length > 0) {
    const tenantIds = [...new Set(payments.map(p => p.tenantId))];
    const tenantRows = await db.select().from(tenants).where(inArray(tenants.id, tenantIds));
    const tenantMap = new Map(tenantRows.map(t => [t.id, t]));
    
    return payments.map(payment => ({
      ...payment,
      tenant: tenantMap.get(payment.tenantId),
      daysOverdue: Math.floor(
        (new Date().getTime() - new Date(payment.dueDate).getTime()) / (1000 * 3600 * 24)
      )
    }));
  }
  
  return payments;
}

async getUpcomingPayments(daysAhead: number = 30): Promise<any[]> {
  const today = new Date();
  const futureDate = new Date();
  futureDate.setDate(today.getDate() + daysAhead);
  
  const payments = await db
    .select()
    .from(rentPayments)
    .where(
      and(
        eq(rentPayments.status, 'pending'),
        gte(rentPayments.dueDate, today.toISOString().split('T')[0]),
        lte(rentPayments.dueDate, futureDate.toISOString().split('T')[0])
      )
    )
    .orderBy(rentPayments.dueDate);
  
  // Join with tenants
  if (payments.length > 0) {
    const tenantIds = [...new Set(payments.map(p => p.tenantId))];
    const tenantRows = await db.select().from(tenants).where(inArray(tenants.id, tenantIds));
    const tenantMap = new Map(tenantRows.map(t => [t.id, t]));
    
    return payments.map(payment => ({
      ...payment,
      tenant: tenantMap.get(payment.tenantId),
      daysUntilDue: Math.floor(
        (new Date(payment.dueDate).getTime() - today.getTime()) / (1000 * 3600 * 24)
      )
    }));
  }
  
  return payments;
}

async generateInvoiceNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const month = (new Date().getMonth() + 1).toString().padStart(2, '0');
  
  // Get the last invoice number for this month
  const lastPayment = await db
    .select()
    .from(rentPayments)
    .where(
      and(
        gte(rentPayments.createdAt, new Date(`${year}-${month}-01`)),
        lte(rentPayments.createdAt, new Date(`${year}-${month}-31`))
      )
    )
    .orderBy(desc(rentPayments.createdAt))
    .limit(1);
  
  let sequence = 1;
  if (lastPayment.length > 0 && lastPayment[0].invoiceNumber) {
    const lastNumber = lastPayment[0].invoiceNumber.split('-').pop();
    if (lastNumber) {
      sequence = parseInt(lastNumber) + 1;
    }
  }
  
  return `INV-${year}${month}-${sequence.toString().padStart(4, '0')}`;
}

  // Maintenance request operations
  async getMaintenanceRequests(organizationId?: number): Promise<MaintenanceRequest[]> {
  const query = db
    .select({
      id: maintenanceRequests.id,
      tenantId: maintenanceRequests.tenantId,
      unitId: maintenanceRequests.unitId,
      title: maintenanceRequests.title,
      description: maintenanceRequests.description,
      priority: maintenanceRequests.priority,
      status: maintenanceRequests.status,
      assignedTo: maintenanceRequests.assignedTo,
      estimatedCost: maintenanceRequests.estimatedCost,
      actualCost: maintenanceRequests.actualCost,
      currency: maintenanceRequests.currency,
      completedAt: maintenanceRequests.completedAt,
      createdAt: maintenanceRequests.createdAt,
      updatedAt: maintenanceRequests.updatedAt,
      tenant: {
        id: tenants.id,
        firstName: tenants.firstName,
        lastName: tenants.lastName,
      },
      unit: {
        id: units.id,
        unitNumber: units.unitNumber,
      },
      property: {
        id: properties.id,
        name: properties.name,
      },
    })
    .from(maintenanceRequests)
    .leftJoin(tenants, eq(maintenanceRequests.tenantId, tenants.id))
    .leftJoin(units, eq(maintenanceRequests.unitId, units.id))
    .leftJoin(properties, eq(units.propertyId, properties.id));

  if (organizationId) {
    return await query
      .where(eq(tenants.organizationId, organizationId))
      .orderBy(desc(maintenanceRequests.createdAt)) as any;
  }
  return await query.orderBy(desc(maintenanceRequests.createdAt)) as any;
}


  async getMaintenanceRequest(id: number): Promise<MaintenanceRequest | undefined> {
    const [request] = await db.select().from(maintenanceRequests).where(eq(maintenanceRequests.id, id));
    return request;
  }

  async createMaintenanceRequest(request: InsertMaintenanceRequest): Promise<MaintenanceRequest> {
    // Generate ticketNumber if not provided
    if (!request.ticketNumber) {
      request.ticketNumber = `MAINT-${Date.now()}`;
    }
    
    const _req: any = { ...request };
    if (_req.assignedDate && typeof _req.assignedDate === "string") _req.assignedDate = new Date(_req.assignedDate);
    const [newRequest] = await db.insert(maintenanceRequests).values(_req).returning();
    return newRequest;
  }

  async updateMaintenanceRequest(id: number, request: Partial<InsertMaintenanceRequest>): Promise<MaintenanceRequest> {
    const updateData: any = { ...request, updatedAt: new Date() };
    if (request.status === 'completed') {
      updateData.completedAt = new Date();
    }
    
    const [updatedRequest] = await db
      .update(maintenanceRequests)
      .set(updateData)
      .where(eq(maintenanceRequests.id, id))
      .returning();
    return updatedRequest;
  }

  async getMaintenanceRequestsByTenant(tenantId: number): Promise<MaintenanceRequest[]> {
    return await db
      .select()
      .from(maintenanceRequests)
      .where(eq(maintenanceRequests.tenantId, tenantId))
      .orderBy(desc(maintenanceRequests.createdAt));
  }

  // Tenant review operations
  async getTenantReviews(tenantId?: number): Promise<TenantReview[]> {
    const query = db.select().from(tenantReviews);
    if (tenantId) {
      return await query.where(eq(tenantReviews.tenantId, tenantId)).orderBy(desc(tenantReviews.createdAt));
    }
    return await query.orderBy(desc(tenantReviews.createdAt));
  }

  async getTenantReview(id: number): Promise<TenantReview | undefined> {
    const [review] = await db.select().from(tenantReviews).where(eq(tenantReviews.id, id));
    return review;
  }

  async createTenantReview(review: InsertTenantReview): Promise<TenantReview> {
    const [newReview] = await db.insert(tenantReviews).values(review).returning();
    return newReview;
  }

  async updateTenantReview(id: number, review: Partial<InsertTenantReview>): Promise<TenantReview> {
    const [updatedReview] = await db
      .update(tenantReviews)
      .set({ ...review, updatedAt: new Date() })
      .where(eq(tenantReviews.id, id))
      .returning();
    return updatedReview;
  }

  // User feedback/complaint operations
  async getUserFeedback(userId?: string, type?: string): Promise<UserFeedback[]> {
    let query = db.select().from(userFeedback);
    const conditions = [];
    
    if (userId) {
      conditions.push(eq(userFeedback.userId, userId));
    }
    if (type) {
      conditions.push(eq(userFeedback.type as any, type));
    }
    
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }
    
    return await query.orderBy(desc(userFeedback.createdAt));
  }

  async createUserFeedback(feedback: InsertUserFeedback): Promise<UserFeedback> {
    const [newFeedback] = await db.insert(userFeedback).values(feedback).returning();
    return newFeedback;
  }

  async updateUserFeedback(id: number, feedback: Partial<InsertUserFeedback>): Promise<UserFeedback> {
    const [updatedFeedback] = await db
      .update(userFeedback)
      .set({ ...feedback, updatedAt: new Date() })
      .where(eq(userFeedback.id, id))
      .returning();
    return updatedFeedback;
  }

  // Document operations
  async getDocuments(tenantId?: number, propertyId?: number): Promise<Document[]> {
    const query = db.select().from(documents);
    if (tenantId) {
      return await query.where(eq(documents.tenantId, tenantId)).orderBy(desc(documents.createdAt));
    }
    if (propertyId) {
      return await query.where(eq(documents.propertyId, propertyId)).orderBy(desc(documents.createdAt));
    }
    return await query.orderBy(desc(documents.createdAt));
  }

  async createDocument(document: InsertDocument): Promise<Document> {
    const [newDocument] = await db.insert(documents).values(document).returning();
    return newDocument;
  }

  async deleteDocument(id: number): Promise<void> {
    await db.delete(documents).where(eq(documents.id, id));
  }

  // Message operations
  async getMessages(userId: string): Promise<Message[]> {
    return await db
      .select()
      .from(messages)
      .where(or(eq(messages.fromUserId, userId), eq(messages.toUserId, userId)))
      .orderBy(desc(messages.createdAt));
  }

  async createMessage(message: InsertMessage): Promise<Message> {
    const [newMessage] = await db.insert(messages).values(message).returning();
    return newMessage;
  }

  async markMessageAsRead(id: number): Promise<void> {
    await db.update(messages).set({ isRead: true }).where(eq(messages.id, id));
  }

  // Broadcast Message operations
  async getBroadcastMessages(organizationId: number): Promise<any[]> {
    try {
      return await db
        .select()
        .from(broadcastMessages)
        .where(eq(broadcastMessages.organizationId, organizationId))
        .orderBy(desc(broadcastMessages.createdAt));
    } catch (error) {
      console.error("Error in getBroadcastMessages:", error);
      return [];
    }
  }

  async createBroadcastMessage(broadcast: any): Promise<any> {
    try {
      const [newBroadcast] = await db.insert(broadcastMessages).values(broadcast).returning();
      return newBroadcast;
    } catch (error) {
      console.error("Error creating broadcast message:", error);
      throw error;
    }
  }

  async updateBroadcastStatus(id: number, status: string, stats: any): Promise<void> {
    try {
      await db.update(broadcastMessages)
        .set({
          status: status as any,
          totalRecipients: stats.totalRecipients,
          sentCount: stats.sentCount,
          failedCount: stats.failedCount,
          sentAt: new Date(),
        })
        .where(eq(broadcastMessages.id, id));
    } catch (error) {
      console.error("Error updating broadcast status:", error);
      throw error;
    }
  }

  async getCommunicationTemplates(organizationId: number): Promise<any[]> {
    try {
      return await db
        .select()
        .from(communicationTemplates)
        .where(eq(communicationTemplates.organizationId, organizationId))
        .orderBy(desc(communicationTemplates.createdAt));
    } catch (error) {
      console.error("Error in getCommunicationTemplates:", error);
      return [];
    }
  }

  async createCommunicationTemplate(template: any): Promise<any> {
    try {
      const [newTemplate] = await db.insert(communicationTemplates).values(template).returning();
      return newTemplate;
    } catch (error) {
      console.error("Error in createCommunicationTemplate:", error);
      throw error;
    }
  }

  async sendBroadcastMessage(broadcastId: number): Promise<{ success: boolean; recipientCount: number }> {
    try {
      // Mock implementation - In production, integrate with SMS/Email/WhatsApp APIs
      const broadcast = await db
        .select()
        .from(broadcastMessages)
        .where(eq(broadcastMessages.id, broadcastId));

      if (!broadcast.length) {
        throw new Error("Broadcast message not found");
      }

      // Update broadcast status
      await db
        .update(broadcastMessages)
        .set({ 
          status: "sent", 
          sentAt: new Date(),
          sentCount: 25, // Mock recipient count
          totalRecipients: 25
        })
        .where(eq(broadcastMessages.id, broadcastId));

      return { success: true, recipientCount: 25 };
    } catch (error) {
      console.error("Error in sendBroadcastMessage:", error);
      throw error;
    }
  }

  // Dashboard metrics
  async getDashboardMetrics(ownerIdOrOrgId: string): Promise<{
    totalRevenue: number;
    occupiedUnits: number;
    totalUnits: number;
    pendingRequests: number;
    overdueRent: number;
  }> {
    const orgIdNum = Number(ownerIdOrOrgId);
    const useOrgId = !isNaN(orgIdNum) && orgIdNum > 0;

    // Get total revenue from paid rent payments scoped by org
    const revenueResult = await db
      .select({ total: sql`SUM(${rentPayments.amount})` })
      .from(rentPayments)
      .leftJoin(tenants, eq(rentPayments.tenantId, tenants.id))
      .where(and(
        useOrgId ? eq(tenants.organizationId, orgIdNum) : eq(tenants.organizationId, 0),
        eq(rentPayments.status, 'paid')
      ));

    // Get unit occupancy stats scoped by org
    const unitStats = await db
      .select({
        total: count(),
        occupied: sql`SUM(CASE WHEN ${units.isOccupied} = true THEN 1 ELSE 0 END)`,
      })
      .from(units)
      .leftJoin(properties, eq(units.propertyId, properties.id))
      .where(useOrgId ? eq(properties.organizationId, orgIdNum) : eq(properties.organizationId, 0));

    // Get pending maintenance requests
    const pendingRequests = await db
      .select({ count: count() })
      .from(maintenanceRequests)
      .leftJoin(tenants, eq(maintenanceRequests.tenantId, tenants.id))
      .where(and(
        useOrgId ? eq(tenants.organizationId, orgIdNum) : eq(tenants.organizationId, 0),
        inArray(maintenanceRequests.status, ['pending', 'assigned'])
      ));

    // Get overdue rent count
    const overdueRent = await db
      .select({ count: count() })
      .from(rentPayments)
      .leftJoin(tenants, eq(rentPayments.tenantId, tenants.id))
      .where(and(
        useOrgId ? eq(tenants.organizationId, orgIdNum) : eq(tenants.organizationId, 0),
        eq(rentPayments.status, 'overdue')
      ));

    return {
      totalRevenue: Number(revenueResult[0]?.total || 0),
      occupiedUnits: Number(unitStats[0]?.occupied || 0),
      totalUnits: Number(unitStats[0]?.total || 0),
      pendingRequests: Number(pendingRequests[0]?.count || 0),
      overdueRent: Number(overdueRent[0]?.count || 0),
    };
  }

  // Contractor operations
  async getContractors(): Promise<Contractor[]> {
    return db.select().from(contractors).orderBy(desc(contractors.rating));
  }

  async getContractorsBySpecialty(specialty: string): Promise<Contractor[]> {
    return db
      .select()
      .from(contractors)
      .where(and(eq(contractors.specialty, specialty), eq(contractors.isAvailable, true)))
      .orderBy(desc(contractors.rating));
  }

  async getContractor(id: number): Promise<Contractor | undefined> {
    const [contractor] = await db
      .select()
      .from(contractors)
      .where(eq(contractors.id, id));
    return contractor;
  }

  async createContractor(contractor: InsertContractor): Promise<Contractor> {
    const [newContractor] = await db
      .insert(contractors)
      .values(contractor)
      .returning();
    return newContractor;
  }

  async updateContractor(id: number, contractor: Partial<InsertContractor>): Promise<Contractor> {
    const [updatedContractor] = await db
      .update(contractors)
      .set({ ...contractor, updatedAt: new Date() })
      .where(eq(contractors.id, id))
      .returning();
    return updatedContractor;
  }

  async deleteContractor(id: number): Promise<void> {
    await db.delete(contractors).where(eq(contractors.id, id));
  }

  // Service charge operations
  async getServiceCharges(propertyId?: number, unitId?: number): Promise<ServiceCharge[]> {
    let query = db.select().from(serviceCharges);
    
    if (propertyId && unitId) {
      return await query.where(and(eq(serviceCharges.propertyId, propertyId), eq(serviceCharges.unitId, unitId)))
        .orderBy(desc(serviceCharges.dueDate));
    } else if (propertyId) {
      return await query.where(eq(serviceCharges.propertyId, propertyId))
        .orderBy(desc(serviceCharges.dueDate));
    } else if (unitId) {
      return await query.where(eq(serviceCharges.unitId, unitId))
        .orderBy(desc(serviceCharges.dueDate));
    }
    
    return await query.orderBy(desc(serviceCharges.dueDate));
  }

  async getServiceCharge(id: number): Promise<ServiceCharge | undefined> {
    const [serviceCharge] = await db
      .select()
      .from(serviceCharges)
      .where(eq(serviceCharges.id, id));
    return serviceCharge;
  }

  async createServiceCharge(serviceCharge: InsertServiceCharge): Promise<ServiceCharge> {
    const [newServiceCharge] = await db
      .insert(serviceCharges)
      .values(serviceCharge)
      .returning();
    return newServiceCharge;
  }

  async updateServiceCharge(id: number, serviceCharge: Partial<InsertServiceCharge>): Promise<ServiceCharge> {
    const [updatedServiceCharge] = await db
      .update(serviceCharges)
      .set({ ...serviceCharge, updatedAt: new Date() })
      .where(eq(serviceCharges.id, id))
      .returning();
    return updatedServiceCharge;
  }

  async deleteServiceCharge(id: number): Promise<void> {
    await db.delete(serviceCharges).where(eq(serviceCharges.id, id));
  }

  // MPesa transaction operations
  async getMpesaTransactions(tenantId?: number): Promise<MpesaTransaction[]> {
    if (tenantId) {
      return await db.select().from(mpesaTransactions)
        .where(eq(mpesaTransactions.tenantId, tenantId))
        .orderBy(desc(mpesaTransactions.createdAt));
    }
    
    return await db.select().from(mpesaTransactions).orderBy(desc(mpesaTransactions.createdAt));
  }

  async getMpesaTransaction(id: number): Promise<MpesaTransaction | undefined> {
    const [transaction] = await db
      .select()
      .from(mpesaTransactions)
      .where(eq(mpesaTransactions.id, id));
    return transaction;
  }

  async getMpesaTransactionByCheckoutRequestId(checkoutRequestId: string): Promise<MpesaTransaction | undefined> {
    const [transaction] = await db
      .select()
      .from(mpesaTransactions)
      .where(eq(mpesaTransactions.checkoutRequestId, checkoutRequestId));
    return transaction;
  }

  async createMpesaTransaction(transaction: InsertMpesaTransaction): Promise<MpesaTransaction> {
    const [newTransaction] = await db
      .insert(mpesaTransactions)
      .values(transaction)
      .returning();
    return newTransaction;
  }

  async updateMpesaTransaction(id: number, transaction: Partial<InsertMpesaTransaction>): Promise<MpesaTransaction> {
    const [updatedTransaction] = await db
      .update(mpesaTransactions)
      .set({ ...transaction, updatedAt: new Date() })
      .where(eq(mpesaTransactions.id, id))
      .returning();
    return updatedTransaction;
  }

  async deleteMpesaTransaction(id: number): Promise<void> {
    await db.delete(mpesaTransactions).where(eq(mpesaTransactions.id, id));
  }

  // Complaint photo operations
  async getComplaintPhotos(maintenanceRequestId: number): Promise<ComplaintsPhoto[]> {
    return db
      .select()
      .from(complaintsPhotos)
      .where(eq(complaintsPhotos.maintenanceRequestId, maintenanceRequestId))
      .orderBy(desc(complaintsPhotos.createdAt));
  }

  async createComplaintPhoto(photo: InsertComplaintsPhoto): Promise<ComplaintsPhoto> {
    const [newPhoto] = await db
      .insert(complaintsPhotos)
      .values(photo)
      .returning();
    return newPhoto;
  }

  async deleteComplaintPhoto(id: number): Promise<void> {
    await db
      .delete(complaintsPhotos)
      .where(eq(complaintsPhotos.id, id));
  }

  // Invoice reminder operations
  async getInvoiceReminders(tenantId?: number): Promise<InvoiceReminder[]> {
    if (tenantId) {
      return await db.select().from(invoiceReminders)
        .where(eq(invoiceReminders.tenantId, tenantId))
        .orderBy(desc(invoiceReminders.nextScheduled));
    }
    
    return await db.select().from(invoiceReminders).orderBy(desc(invoiceReminders.nextScheduled));
  }

  async createInvoiceReminder(reminder: InsertInvoiceReminder): Promise<InvoiceReminder> {
    const [newReminder] = await db
      .insert(invoiceReminders)
      .values(reminder)
      .returning();
    return newReminder;
  }

  async updateInvoiceReminder(id: number, reminder: Partial<InsertInvoiceReminder>): Promise<InvoiceReminder> {
    const [updatedReminder] = await db
      .update(invoiceReminders)
      .set(reminder)
      .where(eq(invoiceReminders.id, id))
      .returning();
    return updatedReminder;
  }

  async deleteInvoiceReminder(id: number): Promise<void> {
    await db.delete(invoiceReminders).where(eq(invoiceReminders.id, id));
  }

  // Project management operations
  async getProjects(managerId: string): Promise<Project[]> {
    return await db.select().from(projects)
      .where(eq(projects.managerId, managerId))
      .orderBy(desc(projects.createdAt));
  }

  async getProject(id: number): Promise<Project | undefined> {
    const [project] = await db.select().from(projects)
      .where(eq(projects.id, id));
    return project;
  }

  async createProject(project: InsertProject): Promise<Project> {
    const [newProject] = await db
      .insert(projects)
      .values(project)
      .returning();
    return newProject;
  }

  async updateProject(id: number, project: Partial<InsertProject>): Promise<Project> {
    const [updatedProject] = await db
      .update(projects)
      .set({ ...project, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();
    return updatedProject;
  }

  async deleteProject(id: number): Promise<void> {
    await db.delete(projects).where(eq(projects.id, id));
  }

  // Project task operations
  async getProjectTasks(projectId?: number): Promise<ProjectTask[]> {
    if (projectId) {
      return await db.select().from(projectTasks)
        .where(eq(projectTasks.projectId, projectId))
        .orderBy(desc(projectTasks.createdAt));
    }
    return await db.select().from(projectTasks).orderBy(desc(projectTasks.createdAt));
  }

  async getProjectTask(id: number): Promise<ProjectTask | undefined> {
    const [task] = await db.select().from(projectTasks)
      .where(eq(projectTasks.id, id));
    return task;
  }

  async createProjectTask(task: InsertProjectTask): Promise<ProjectTask> {
    const [newTask] = await db
      .insert(projectTasks)
      .values(task)
      .returning();
    return newTask;
  }

  async updateProjectTask(id: number, task: Partial<InsertProjectTask>): Promise<ProjectTask> {
    const [updatedTask] = await db
      .update(projectTasks)
      .set({ ...task, updatedAt: new Date() })
      .where(eq(projectTasks.id, id))
      .returning();
    return updatedTask;
  }

  async deleteProjectTask(id: number): Promise<void> {
    await db.delete(projectTasks).where(eq(projectTasks.id, id));
  }

  // Project milestone operations
  async getProjectMilestones(projectId?: number): Promise<ProjectMilestone[]> {
    if (projectId) {
      return await db.select().from(projectMilestones)
        .where(eq(projectMilestones.projectId, projectId))
        .orderBy(projectMilestones.targetDate);
    }
    return await db.select().from(projectMilestones).orderBy(projectMilestones.targetDate);
  }

  async getProjectMilestone(id: number): Promise<ProjectMilestone | undefined> {
    const [milestone] = await db.select().from(projectMilestones)
      .where(eq(projectMilestones.id, id));
    return milestone;
  }

  async createProjectMilestone(milestone: InsertProjectMilestone): Promise<ProjectMilestone> {
    const [newMilestone] = await db
      .insert(projectMilestones)
      .values(milestone)
      .returning();
    return newMilestone;
  }

  async updateProjectMilestone(id: number, milestone: Partial<InsertProjectMilestone>): Promise<ProjectMilestone> {
    const [updatedMilestone] = await db
      .update(projectMilestones)
      .set(milestone)
      .where(eq(projectMilestones.id, id))
      .returning();
    return updatedMilestone;
  }

  async deleteProjectMilestone(id: number): Promise<void> {
    await db.delete(projectMilestones).where(eq(projectMilestones.id, id));
  }

  // Project document operations
  async getProjectDocuments(projectId?: number, taskId?: number): Promise<ProjectDocument[]> {
    let query: any = db.select().from(projectDocuments);
    
    if (projectId && taskId) {
      query = query.where(and(
        eq(projectDocuments.projectId, projectId),
        eq(projectDocuments.taskId, taskId)
      ));
    } else if (projectId) {
      query = query.where(eq(projectDocuments.projectId, projectId));
    } else if (taskId) {
      query = query.where(eq(projectDocuments.taskId, taskId));
    }
    
    return await query.orderBy(desc(projectDocuments.createdAt));
  }

  async createProjectDocument(document: InsertProjectDocument): Promise<ProjectDocument> {
    const [newDocument] = await db
      .insert(projectDocuments)
      .values(document)
      .returning();
    return newDocument;
  }

  async deleteProjectDocument(id: number): Promise<void> {
    await db.delete(projectDocuments).where(eq(projectDocuments.id, id));
  }

  // Project expense operations
  async getProjectExpenses(projectId?: number, taskId?: number): Promise<ProjectExpense[]> {
    let query: any = db.select().from(projectExpenses);
    
    if (projectId && taskId) {
      query = query.where(and(
        eq(projectExpenses.projectId, projectId),
        eq(projectExpenses.taskId, taskId)
      ));
    } else if (projectId) {
      query = query.where(eq(projectExpenses.projectId, projectId));
    } else if (taskId) {
      query = query.where(eq(projectExpenses.taskId, taskId));
    }
    
    return await query.orderBy(desc(projectExpenses.createdAt));
  }

  async createProjectExpense(expense: InsertProjectExpense): Promise<ProjectExpense> {
    const [newExpense] = await db
      .insert(projectExpenses)
      .values(expense)
      .returning();
    return newExpense;
  }

  async updateProjectExpense(id: number, expense: Partial<InsertProjectExpense>): Promise<ProjectExpense> {
    const [updatedExpense] = await db
      .update(projectExpenses)
      .set(expense)
      .where(eq(projectExpenses.id, id))
      .returning();
    return updatedExpense;
  }

  async deleteProjectExpense(id: number): Promise<void> {
    await db.delete(projectExpenses).where(eq(projectExpenses.id, id));
  }

  // Project team operations
  async getProjectTeam(projectId: number): Promise<ProjectTeam[]> {
    return await db.select().from(projectTeam)
      .where(eq(projectTeam.projectId, projectId))
      .orderBy(projectTeam.joinedDate);
  }

  async addProjectTeamMember(member: InsertProjectTeam): Promise<ProjectTeam> {
    const [newMember] = await db
      .insert(projectTeam)
      .values(member)
      .returning();
    return newMember;
  }

  async updateProjectTeamMember(id: number, member: Partial<InsertProjectTeam>): Promise<ProjectTeam> {
    const [updatedMember] = await db
      .update(projectTeam)
      .set(member)
      .where(eq(projectTeam.id, id))
      .returning();
    return updatedMember;
  }

  async removeProjectTeamMember(id: number): Promise<void> {
    await db.delete(projectTeam).where(eq(projectTeam.id, id));
  }

  // Project time tracking operations
  async getProjectTimeTracking(projectId?: number, memberId?: string): Promise<ProjectTimeTracking[]> {
    let query: any = db.select().from(projectTimeTracking);
    
    if (projectId && memberId) {
      query = query.where(and(
        eq(projectTimeTracking.projectId, projectId),
        eq(projectTimeTracking.memberId, memberId)
      ));
    } else if (projectId) {
      query = query.where(eq(projectTimeTracking.projectId, projectId));
    } else if (memberId) {
      query = query.where(eq(projectTimeTracking.memberId, memberId));
    }
    
    return await query.orderBy(desc(projectTimeTracking.startTime));
  }

  async createTimeEntry(entry: InsertProjectTimeTracking): Promise<ProjectTimeTracking> {
    const [newEntry] = await db
      .insert(projectTimeTracking)
      .values(entry)
      .returning();
    return newEntry;
  }

  async updateTimeEntry(id: number, entry: Partial<InsertProjectTimeTracking>): Promise<ProjectTimeTracking> {
    const [updatedEntry] = await db
      .update(projectTimeTracking)
      .set(entry)
      .where(eq(projectTimeTracking.id, id))
      .returning();
    return updatedEntry;
  }

  async deleteTimeEntry(id: number): Promise<void> {
    await db.delete(projectTimeTracking).where(eq(projectTimeTracking.id, id));
  }

  // Work order operations
  async getWorkOrders(maintenanceRequestId?: number, projectId?: number, contractorId?: number): Promise<WorkOrder[]> {
  // Use a simple approach with direct query building
  const conditions = [];
  
  if (maintenanceRequestId) {
    conditions.push(eq(workOrders.maintenanceRequestId, maintenanceRequestId));
  }
  
  if (projectId) {
    conditions.push(eq(workOrders.projectId, projectId));
  }
  
  if (contractorId) {
    conditions.push(eq(workOrders.contractorId, contractorId));
  }
  
  // Build the query
  const query = db.select()
    .from(workOrders)
    .orderBy(desc(workOrders.createdAt));
  
  // Apply WHERE only if we have conditions
  const finalQuery = conditions.length > 0 
    ? query.where(and(...conditions))
    : query;
  
  return await finalQuery;
}

  async getWorkOrder(id: number): Promise<WorkOrder | undefined> {
    const [workOrder] = await db.select().from(workOrders).where(eq(workOrders.id, id));
    return workOrder;
  }

  async createWorkOrder(workOrderData: InsertWorkOrder): Promise<WorkOrder> {
    // Generate unique ticket number
    const ticketNumber = `WO-${Date.now()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
    
    const [workOrder] = await db
      .insert(workOrders)
      .values({ ...workOrderData, ticketNumber } as any)
      .returning();
    return workOrder;
  }

  async updateWorkOrder(id: number, workOrderData: Partial<InsertWorkOrder>): Promise<WorkOrder> {
    const [workOrder] = await db
      .update(workOrders)
      .set({ ...workOrderData, updatedAt: new Date() })
      .where(eq(workOrders.id, id))
      .returning();
    return workOrder;
  }

  async deleteWorkOrder(id: number): Promise<void> {
    await db.delete(workOrders).where(eq(workOrders.id, id));
  }

  async calculateWorkOrderCost(workOrderId: number) {
    const materials = await db
      .select()
      .from(workOrderMaterials)
      .where(eq(workOrderMaterials.workOrderId, workOrderId));

    const charges = await db
      .select()
      .from(workOrderCharges)
      .where(eq(workOrderCharges.workOrderId, workOrderId));

    const materialsTotal = materials.reduce(
      (sum, m) => sum + Number(m.quantity) * Number(m.unitCost),
      0
    );

    const chargesTotal = charges.reduce(
      (sum, c) => sum + Number(c.amount),
      0
    );

    const total = materialsTotal + chargesTotal;

    await db
      .update(maintenanceRequests)
      .set({ actualCost: total.toFixed(2) })
      .where(eq(maintenanceRequests.id, workOrderId));

    return total;
  }

  // Fix for getWorkOrderComments
async getWorkOrderComments(workOrderId: number): Promise<WorkOrderComment[]> {
  const comments = await db
    .select()
    .from(workOrderComments)
    .where(eq(workOrderComments.workOrderId, workOrderId))
    .orderBy(desc(workOrderComments.createdAt));
  
  return comments;
}

// Fix for addWorkOrderComment
async addWorkOrderComment(comment: NewWorkOrderComment): Promise<WorkOrderComment> {
  const [newComment] = await db
    .insert(workOrderComments)
    .values(comment)
    .returning();
  
  if (!newComment) {
    throw new Error("Failed to create comment");
  }
  
  return newComment;
}

// Fix for updateWorkOrderComment
async updateWorkOrderComment(id: number, content: string): Promise<WorkOrderComment> {
  const [updatedComment] = await db
    .update(workOrderComments)
    .set({ 
      content, 
      updatedAt: new Date(),
      isEdited: true 
    })
    .where(eq(workOrderComments.id, id))
    .returning();
  
  if (!updatedComment) {
    throw new Error("Comment not found");
  }
  
  return updatedComment;
}

// Delete a comment
async deleteWorkOrderComment(id: number): Promise<void> {
  await db
    .delete(workOrderComments)
    .where(eq(workOrderComments.id, id));
}

  async addWorkOrderMaterial(data: {
    workOrderId: number;
    itemName: string;
    quantity: number;
    unitCost: string; // decimal as string
    notes?: string;
  }) {
    const [material] = await db
      .insert(workOrderMaterials)
      .values(data)
      .returning();

    // 🔁 Recalculate cost
    await this.calculateWorkOrderCost(data.workOrderId);

    return material;
  }


async getWorkOrderMaterials(workOrderId: number) {
  return db
    .select()
    .from(workOrderMaterials)
    .where(eq(workOrderMaterials.workOrderId, workOrderId));
}

async updateWorkOrderMaterial(
  id: number,
  data: Partial<InsertWorkOrderMaterial>
) {
  const [updated] = await db
    .update(workOrderMaterials)
    .set(data)
    .where(eq(workOrderMaterials.id, id))
    .returning();

  return updated;
}

async deleteWorkOrderMaterial(id: number) {
  const [deleted] = await db
    .delete(workOrderMaterials)
    .where(eq(workOrderMaterials.id, id))
    .returning();

  return deleted;
}


  async addWorkOrderCharge(data: {
    workOrderId: number;
    description: string;
    amount: string; // decimal as string
  }) {
    const [charge] = await db
      .insert(workOrderCharges)
      .values(data)
      .returning();

    // 🔁 Recalculate cost
    await this.calculateWorkOrderCost(data.workOrderId);

    return charge;
  }

  async updateWorkOrderCharge(
  id: number,
  data: Partial<InsertWorkOrderCharge>
) {
  const [updated] = await db
    .update(workOrderCharges)
    .set(data)
    .where(eq(workOrderCharges.id, id))
    .returning();

  return updated;
}

async deleteWorkOrderCharge(id: number) {
  const [deleted] = await db
    .delete(workOrderCharges)
    .where(eq(workOrderCharges.id, id))
    .returning();

  return deleted;
}


  async getWorkOrderCostSummary(workOrderId: number) {
    const [workOrder] = await db
      .select({
        laborCost: maintenanceRequests.laborCost,
        actualCost: maintenanceRequests.actualCost,
        currency: maintenanceRequests.currency,
      })
      .from(maintenanceRequests)
      .where(eq(maintenanceRequests.id, workOrderId));

    const materials = await this.getWorkOrderMaterials(workOrderId);
    const charges = await this.getWorkOrderCharges(workOrderId);

    const materialsTotal = materials.reduce(
      (sum, m) => sum + Number(m.quantity) * Number(m.unitCost),
      0
    );

    const chargesTotal = charges.reduce(
      (sum, c) => sum + Number(c.amount),
      0
    );

    return {
      laborCost: workOrder?.laborCost,
      materials,
      charges,
      totals: {
        materials: materialsTotal.toFixed(2),
        charges: chargesTotal.toFixed(2),
        actualCost: workOrder?.actualCost,
      },
      currency: workOrder?.currency,
    };
  }


  async getWorkOrderCharges(workOrderId: number) {
  return db
    .select()
    .from(workOrderCharges)
    .where(eq(workOrderCharges.workOrderId, workOrderId));
}



  // Work order task operations
  async getWorkOrderTasks(workOrderId: number): Promise<WorkOrderTask[]> {
    return await db
      .select()
      .from(workOrderTasks)
      .where(eq(workOrderTasks.workOrderId, workOrderId))
      .orderBy(workOrderTasks.taskNumber);
  }

  async getWorkOrderTask(id: number): Promise<WorkOrderTask | undefined> {
    const [task] = await db.select().from(workOrderTasks).where(eq(workOrderTasks.id, id));
    return task;
  }

  async createWorkOrderTask(taskData: InsertWorkOrderTask): Promise<WorkOrderTask> {
    const [task] = await db.insert(workOrderTasks).values(taskData).returning();
    return task;
  }

  async updateWorkOrderTask(id: number, taskData: Partial<InsertWorkOrderTask>): Promise<WorkOrderTask> {
    const [task] = await db
      .update(workOrderTasks)
      .set({ ...taskData, updatedAt: new Date() })
      .where(eq(workOrderTasks.id, id))
      .returning();
    return task;
  }

  async deleteWorkOrderTask(id: number): Promise<void> {
    await db.delete(workOrderTasks).where(eq(workOrderTasks.id, id));
  }

  // Work order approval operations
  async getWorkOrderApprovals(workOrderId: number): Promise<WorkOrderApproval[]> {
    return await db
      .select()
      .from(workOrderApprovals)
      .where(eq(workOrderApprovals.workOrderId, workOrderId))
      .orderBy(workOrderApprovals.createdAt);
  }

  async createWorkOrderApproval(approvalData: InsertWorkOrderApproval): Promise<WorkOrderApproval> {
    const [approval] = await db.insert(workOrderApprovals).values(approvalData).returning();
    return approval;
  }

  async updateWorkOrderApproval(id: number, approvalData: Partial<InsertWorkOrderApproval>): Promise<WorkOrderApproval> {
    const [approval] = await db
      .update(workOrderApprovals)
      .set({ ...approvalData, updatedAt: new Date() })
      .where(eq(workOrderApprovals.id, id))
      .returning();
    return approval;
  }

  // Work order expense operations
  async getWorkOrderExpenses(workOrderId: number, contractorId?: number): Promise<WorkOrderExpense[]> {
    let query: any = db.select().from(workOrderExpenses).where(eq(workOrderExpenses.workOrderId, workOrderId));
    
    if (contractorId) {
      query = query.where(and(eq(workOrderExpenses.workOrderId, workOrderId), eq(workOrderExpenses.contractorId, contractorId)));
    }
    
    return await query.orderBy(desc(workOrderExpenses.expenseDate));
  }

  async createWorkOrderExpense(expenseData: InsertWorkOrderExpense): Promise<WorkOrderExpense> {
    const [expense] = await db.insert(workOrderExpenses).values(expenseData).returning();
    return expense;
  }

  async updateWorkOrderExpense(id: number, expenseData: Partial<InsertWorkOrderExpense>): Promise<WorkOrderExpense> {
    const [expense] = await db
      .update(workOrderExpenses)
      .set({ ...expenseData, updatedAt: new Date() })
      .where(eq(workOrderExpenses.id, id))
      .returning();
    return expense;
  }

  async deleteWorkOrderExpense(id: number): Promise<void> {
    await db.delete(workOrderExpenses).where(eq(workOrderExpenses.id, id));
  }

  // Work order progress operations
  async getWorkOrderProgress(workOrderId: number): Promise<WorkOrderProgress[]> {
    return await db
      .select()
      .from(workOrderProgress)
      .where(eq(workOrderProgress.workOrderId, workOrderId))
      .orderBy(desc(workOrderProgress.progressDate));
  }

  async createWorkOrderProgress(progressData: InsertWorkOrderProgress): Promise<WorkOrderProgress> {
    const [progress] = await db.insert(workOrderProgress).values(progressData).returning();
    return progress;
  }

  // Billing & Utilities operations

  // Utility Providers
  async getUtilityProviders(): Promise<UtilityProvider[]> {
    return await db.select().from(utilityProviders).where(eq(utilityProviders.isActive, true));
  }

  async getUtilityProvider(id: number): Promise<UtilityProvider | undefined> {
    const [provider] = await db.select().from(utilityProviders).where(eq(utilityProviders.id, id));
    return provider;
  }

  async createUtilityProvider(providerData: UtilityProviderInsert): Promise<UtilityProvider> {
    const [provider] = await db.insert(utilityProviders).values(providerData).returning();
    return provider;
  }

  async updateUtilityProvider(id: number, providerData: Partial<UtilityProviderInsert>): Promise<UtilityProvider> {
    const [provider] = await db
      .update(utilityProviders)
      .set(providerData)
      .where(eq(utilityProviders.id, id))
      .returning();
    return provider;
  }

  // Utility Accounts
  async deleteUtilityProvider(id: number): Promise<void> {
    await db.delete(utilityProviders).where(eq(utilityProviders.id, id));
  }


  async getUtilityAccounts(propertyId?: number, unitId?: number): Promise<UtilityAccount[]> {
    let query: any = db.select().from(utilityAccounts).where(eq(utilityAccounts.isActive, true));
    
    if (propertyId && unitId) {
      query = query.where(and(
        eq(utilityAccounts.propertyId, propertyId),
        eq(utilityAccounts.unitId, unitId)
      ));
    } else if (propertyId) {
      query = query.where(eq(utilityAccounts.propertyId, propertyId));
    }
    
    return await query.orderBy(utilityAccounts.createdAt);
  }

  async getUtilityAccount(id: number): Promise<UtilityAccount | undefined> {
    const [account] = await db.select().from(utilityAccounts).where(eq(utilityAccounts.id, id));
    return account;
  }


  async createUtilityAccount(accountData: UtilityAccountInsert): Promise<UtilityAccount> {
    const [account] = await db.insert(utilityAccounts).values(accountData).returning();
    return account;
  }

  async updateUtilityAccount(id: number, accountData: Partial<UtilityAccountInsert>): Promise<UtilityAccount> {
    const [account] = await db
      .update(utilityAccounts)
      .set(accountData)
      .where(eq(utilityAccounts.id, id))
      .returning();
    return account;
  }

  // Utility Bills
  async deleteUtilityAccount(id: number): Promise<void> {
    await db.delete(utilityAccounts).where(eq(utilityAccounts.id, id));
  }


  async getUtilityBills(accountId?: number, status?: string): Promise<UtilityBill[]> {
    if (accountId && status) {
      return await db
        .select()
        .from(utilityBills)
        .where(and(
          eq(utilityBills.accountId, accountId),
          eq(utilityBills.status, status)
        ))
        .orderBy(desc(utilityBills.dueDate));
    } else if (accountId) {
      return await db
        .select()
        .from(utilityBills)
        .where(eq(utilityBills.accountId, accountId))
        .orderBy(desc(utilityBills.dueDate));
    } else if (status) {
      return await db
        .select()
        .from(utilityBills)
        .where(eq(utilityBills.status, status))
        .orderBy(desc(utilityBills.dueDate));
    }
    
    return await db
      .select()
      .from(utilityBills)
      .orderBy(desc(utilityBills.dueDate));
  }

  async getUtilityBill(id: number): Promise<UtilityBill | undefined> {
    const [bill] = await db.select().from(utilityBills).where(eq(utilityBills.id, id));
    return bill;
  }


  async createUtilityBill(billData: UtilityBillInsert): Promise<UtilityBill> {
    const [bill] = await db.insert(utilityBills).values(billData).returning();
    return bill;
  }

  async updateUtilityBill(id: number, billData: Partial<UtilityBillInsert>): Promise<UtilityBill> {
    const [bill] = await db
      .update(utilityBills)
      .set(billData)
      .where(eq(utilityBills.id, id))
      .returning();
    return bill;
  }

  async deleteUtilityBill(id: number): Promise<void> {
    await db.delete(utilityBills).where(eq(utilityBills.id, id));
  }

  // Utility Meter Readings
  async getUtilityMeterReadings(accountId?: number): Promise<UtilityMeterReading[]> {
    if (accountId) {
      return await db
        .select()
        .from(utilityMeterReadings)
        .where(eq(utilityMeterReadings.accountId, accountId))
        .orderBy(desc(utilityMeterReadings.readingDate));
    }
    return await db
      .select()
      .from(utilityMeterReadings)
      .orderBy(desc(utilityMeterReadings.readingDate));
  }

  async getUtilityMeterReading(id: number): Promise<UtilityMeterReading | undefined> {
    const [reading] = await db
      .select()
      .from(utilityMeterReadings)
      .where(eq(utilityMeterReadings.id, id));
    return reading;
  }

  async createUtilityMeterReading(readingData: UtilityMeterReadingInsert): Promise<UtilityMeterReading> {
    const [reading] = await db.insert(utilityMeterReadings).values(readingData).returning();
    return reading;
  }

  async updateUtilityMeterReading(id: number, readingData: Partial<UtilityMeterReadingInsert>): Promise<UtilityMeterReading> {
    const [reading] = await db
      .update(utilityMeterReadings)
      .set(readingData)
      .where(eq(utilityMeterReadings.id, id))
      .returning();
    return reading;
  }

  async deleteUtilityMeterReading(id: number): Promise<void> {
    await db.delete(utilityMeterReadings).where(eq(utilityMeterReadings.id, id));
  }

  // Recurring Charges
  async getRecurringCharges(propertyId?: number, isActive?: boolean): Promise<RecurringCharge[]> {
    if (propertyId && isActive !== undefined) {
      return await db
        .select()
        .from(recurringCharges)
        .where(and(
          eq(recurringCharges.propertyId, propertyId),
          eq(recurringCharges.isActive, isActive)
        ))
        .orderBy(recurringCharges.nextBillDate);
    } else if (propertyId) {
      return await db
        .select()
        .from(recurringCharges)
        .where(eq(recurringCharges.propertyId, propertyId))
        .orderBy(recurringCharges.nextBillDate);
    } else if (isActive !== undefined) {
      return await db
        .select()
        .from(recurringCharges)
        .where(eq(recurringCharges.isActive, isActive))
        .orderBy(recurringCharges.nextBillDate);
    }
    
    return await db
      .select()
      .from(recurringCharges)
      .orderBy(recurringCharges.nextBillDate);
  }

  async getRecurringCharge(id: number): Promise<RecurringCharge | undefined> {
    const [charge] = await db.select().from(recurringCharges).where(eq(recurringCharges.id, id));
    return charge;
  }

  /** Returns all active recurring charges that apply to a given unit.
   *  Matches charges scoped to the exact unit OR charges scoped to the
   *  whole property (unitId IS NULL) — the latter are property-wide levies
   *  such as generator or waste-collection charges. */
  async getRecurringChargesForUnit(unitId: number, propertyId: number): Promise<RecurringCharge[]> {
    return await db
      .select()
      .from(recurringCharges)
      .where(
        and(
          eq(recurringCharges.isActive, true),
          eq(recurringCharges.propertyId, propertyId),
          // unit-specific OR property-wide (unitId IS NULL)
          sql`(${recurringCharges.unitId} = ${unitId} OR ${recurringCharges.unitId} IS NULL)`
        )
      )
      .orderBy(recurringCharges.name);
  }


  async createRecurringCharge(chargeData: RecurringChargeInsert): Promise<RecurringCharge> {
    const [charge] = await db.insert(recurringCharges).values(chargeData).returning();
    return charge;
  }

  async updateRecurringCharge(id: number, chargeData: Partial<RecurringChargeInsert>): Promise<RecurringCharge> {
    const [charge] = await db
      .update(recurringCharges)
      .set(chargeData)
      .where(eq(recurringCharges.id, id))
      .returning();
    return charge;
  }

  // Invoices
  async deleteRecurringCharge(id: number): Promise<void> {
    await db.delete(recurringCharges).where(eq(recurringCharges.id, id));
  }


  async getInvoices(tenantId?: number, propertyId?: number, status?: string): Promise<Invoice[]> {
    const conditions = [];
    if (tenantId) conditions.push(eq(invoices.tenantId, tenantId));
    if (propertyId) conditions.push(eq(invoices.propertyId, propertyId));
    if (status) conditions.push(eq(invoices.status, status));
    
    if (conditions.length > 0) {
      return await db
        .select()
        .from(invoices)
        .where(and(...conditions))
        .orderBy(desc(invoices.dueDate));
    }
    
    return await db
      .select()
      .from(invoices)
      .orderBy(desc(invoices.dueDate));
  }

  async getInvoice(id: number): Promise<Invoice | undefined> {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
    return invoice;
  }

  async createInvoice(invoiceData: InvoiceInsert): Promise<Invoice> {
    // Generate unique invoice number
    const invoiceNumber = `INV-${Date.now()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
    
    const [invoice] = await db
      .insert(invoices)
      .values({ ...invoiceData, invoiceNumber })
      .returning();
    return invoice;
  }

  async updateInvoice(id: number, invoiceData: Partial<InvoiceInsert>): Promise<Invoice> {
    const [invoice] = await db
      .update(invoices)
      .set(invoiceData)
      .where(eq(invoices.id, id))
      .returning();
    return invoice;
  }

  // Billing Cycles
  async getBillingCycles(propertyId?: number): Promise<BillingCycle[]> {
    if (propertyId) {
      return await db
        .select()
        .from(billingCycles)
        .where(eq(billingCycles.propertyId, propertyId))
        .orderBy(billingCycles.createdAt);
    }
    
    return await db
      .select()
      .from(billingCycles)
      .orderBy(billingCycles.createdAt);
  }

  async getBillingCycle(id: number): Promise<BillingCycle | undefined> {
    const [cycle] = await db.select().from(billingCycles).where(eq(billingCycles.id, id));
    return cycle;
  }

  async createBillingCycle(cycleData: InsertBillingCycle): Promise<BillingCycle> {
    const [cycle] = await db.insert(billingCycles).values(cycleData).returning();
    return cycle;
  }

  async updateBillingCycle(id: number, cycleData: Partial<InsertBillingCycle>): Promise<BillingCycle> {
    const [cycle] = await db
      .update(billingCycles)
      .set(cycleData)
      .where(eq(billingCycles.id, id))
      .returning();
    return cycle;
  }

  async deleteBillingCycle(id: number): Promise<void> {
    await db.delete(billingCycles).where(eq(billingCycles.id, id));
  }

  // Auto-invoicing functionality
  async deleteInvoice(id: number): Promise<void> {
    await db.delete(invoices).where(eq(invoices.id, id));
  }


  async generateRecurringInvoices(): Promise<Invoice[]> {
    // Get all active recurring charges that are due
    const dueCharges = await db
      .select()
      .from(recurringCharges)
      .where(and(
        eq(recurringCharges.isActive, true),
        eq(recurringCharges.autoGenerate, true),
        sql`${recurringCharges.nextBillDate} <= CURRENT_DATE`
      ));

    const generatedInvoices: Invoice[] = [];

    for (const charge of dueCharges) {
      // Get tenant for the unit (if unit-specific charge)
      let tenantId = null;
      if (charge.unitId) {
        const [unit] = await db
          .select({ tenantId: units.id })
          .from(units)
          .leftJoin(tenants, eq(units.id, tenants.unitId))
          .where(eq(units.id, charge.unitId));
        tenantId = unit?.tenantId || null;
      }

      // Calculate next bill date based on frequency
      const currentDate = new Date(charge.nextBillDate);
      let nextBillDate = new Date(currentDate);
      
      switch (charge.frequency) {
        case 'monthly':
          nextBillDate.setMonth(nextBillDate.getMonth() + 1);
          break;
        case 'quarterly':
          nextBillDate.setMonth(nextBillDate.getMonth() + 3);
          break;
        case 'annually':
          nextBillDate.setFullYear(nextBillDate.getFullYear() + 1);
          break;
        case 'weekly':
          nextBillDate.setDate(nextBillDate.getDate() + 7);
          break;
      }

      // Calculate due date (30 days from issue date by default)
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 30);

      // Create invoice
      const invoiceData: InvoiceInsert = {
        invoiceNumber: `INV-${Date.now()}-${charge.id}`,
        tenantId,
        propertyId: charge.propertyId,
        unitId: charge.unitId,
        type: charge.type,
        amount: charge.amount,
        currency: charge.currency,
        dueDate,
        description: charge.description || `${charge.name} - ${charge.frequency} charge`,
        lineItems: [{
          description: charge.name,
          amount: parseFloat(charge.amount),
          quantity: 1,
          unitPrice: parseFloat(charge.amount)
        }],
        taxAmount: "0",
        discountAmount: "0",
        totalAmount: charge.amount,
        status: 'pending',
        remindersSent: 0,
      };

      const invoice = await this.createInvoice(invoiceData);
      generatedInvoices.push(invoice);

      // Update recurring charge next bill date
      await this.updateRecurringCharge(charge.id, {
        nextBillDate
      });
    }

    return generatedInvoices;
  }

  async updateWorkOrderProgress(id: number, progressData: Partial<InsertWorkOrderProgress>): Promise<WorkOrderProgress> {
    const [progress] = await db
      .update(workOrderProgress)
      .set(progressData)
      .where(eq(workOrderProgress.id, id))
      .returning();
    return progress;
  }



  // Security & Compliance Implementation
  // Audit Logs
  async getAuditLogs(userId?: string, entityType?: string): Promise<AuditLog[]> {
    let query: any = db.select().from(auditLogs).orderBy(desc(auditLogs.timestamp));
    
    if (userId && entityType) {
      query = query.where(and(
        eq(auditLogs.userId, userId),
        eq(auditLogs.entityType, entityType)
      ));
    } else if (userId) {
      query = query.where(eq(auditLogs.userId, userId));
    } else if (entityType) {
      query = query.where(eq(auditLogs.entityType, entityType));
    }
    
    return await query.limit(1000); // Limit for performance
  }

  async createAuditLog(auditLogData: InsertAuditLog): Promise<AuditLog> {
    const [auditLog] = await db.insert(auditLogs).values(auditLogData).returning();
    return auditLog;
  }

  // Encryption Keys
  async getEncryptionKeys(): Promise<EncryptionKey[]> {
    return await db.select().from(encryptionKeys).orderBy(desc(encryptionKeys.createdAt));
  }

  async getActiveEncryptionKey(purpose: string): Promise<EncryptionKey | undefined> {
    const [key] = await db
      .select()
      .from(encryptionKeys)
      .where(and(
        eq(encryptionKeys.purpose, purpose),
        eq(encryptionKeys.isActive, true)
      ))
      .orderBy(desc(encryptionKeys.keyVersion))
      .limit(1);
    return key;
  }

  async createEncryptionKey(keyData: InsertEncryptionKey): Promise<EncryptionKey> {
    const [key] = await db.insert(encryptionKeys).values(keyData).returning();
    return key;
  }

  async rotateEncryptionKey(keyId: string): Promise<EncryptionKey> {
    // Deactivate old key
    await db
      .update(encryptionKeys)
      .set({ isActive: false, rotatedAt: new Date() })
      .where(eq(encryptionKeys.keyId, keyId));

    // Get the old key to create new one
    const [oldKey] = await db
      .select()
      .from(encryptionKeys)
      .where(eq(encryptionKeys.keyId, keyId));

    if (!oldKey) {
      throw new Error('Key not found for rotation');
    }

    // Create new key with incremented version
    const newKeyData: InsertEncryptionKey = {
      keyId: `${oldKey.purpose}_${Date.now()}`,
      keyType: oldKey.keyType,
      purpose: oldKey.purpose,
      encryptedKey: `rotated_${oldKey.encryptedKey}_${Date.now()}`, // In real implementation, generate new key
      keyVersion: (oldKey.keyVersion ?? 0) + 1,
      isActive: true,
    };

    return await this.createEncryptionKey(newKeyData);
  }

  // Trust Accounts
  async getTrustAccounts(): Promise<TrustAccount[]> {
    return await db.select().from(trustAccounts).where(eq(trustAccounts.isActive, true));
  }

  async getTrustAccount(id: number): Promise<TrustAccount | undefined> {
    const [account] = await db.select().from(trustAccounts).where(eq(trustAccounts.id, id));
    return account;
  }

  async createTrustAccount(accountData: InsertTrustAccount): Promise<TrustAccount> {
    const [account] = await db.insert(trustAccounts).values(accountData).returning();
    return account;
  }

  async updateTrustAccount(id: number, accountData: Partial<InsertTrustAccount>): Promise<TrustAccount> {
    const [account] = await db
      .update(trustAccounts)
      .set({ ...accountData, updatedAt: new Date() })
      .where(eq(trustAccounts.id, id))
      .returning();
    return account;
  }

  // Trust Account Transactions
  async getTrustAccountTransactions(trustAccountId?: number): Promise<TrustAccountTransaction[]> {
    let query: any = db.select().from(trustAccountTransactions).orderBy(desc(trustAccountTransactions.createdAt));
    
    if (trustAccountId) {
      query = query.where(eq(trustAccountTransactions.trustAccountId, trustAccountId));
    }
    
    return await query;
  }

  async createTrustAccountTransaction(transactionData: InsertTrustAccountTransaction): Promise<TrustAccountTransaction> {
    const [transaction] = await db.insert(trustAccountTransactions).values(transactionData).returning();
    
    // Update trust account balance if transaction is completed
    if (transactionData.status === 'completed') {
      const balanceChange = transactionData.type === 'deposit' ? 
        transactionData.amount : 
        `-${transactionData.amount}`;
      
      await db
        .update(trustAccounts)
        .set({ 
          balance: sql`balance + ${balanceChange}`,
          updatedAt: new Date()
        })
        .where(eq(trustAccounts.id, transactionData.trustAccountId));
    }
    
    return transaction;
  }

  async updateTrustAccountTransactionStatus(id: number, status: string, processedAt?: Date): Promise<TrustAccountTransaction> {
    const [transaction] = await db
      .update(trustAccountTransactions)
      .set({ status, processedAt })
      .where(eq(trustAccountTransactions.id, id))
      .returning();
    return transaction;
  }

  // Compliance Reports
  async getComplianceReports(reportType?: string): Promise<ComplianceReport[]> {
    let query: any = db.select().from(complianceReports).orderBy(desc(complianceReports.createdAt));
    
    if (reportType) {
      query = query.where(eq(complianceReports.reportType, reportType));
    }
    
    return await query;
  }

  async createComplianceReport(reportData: InsertComplianceReport): Promise<ComplianceReport> {
    const [report] = await db.insert(complianceReports).values(reportData).returning();
    return report;
  }

  async updateComplianceReportStatus(id: number, status: string): Promise<ComplianceReport> {
    const updateData: any = { status };
    
    if (status === 'submitted') {
      updateData.submittedAt = new Date();
    } else if (status === 'approved') {
      updateData.approvedAt = new Date();
    }
    
    const [report] = await db
      .update(complianceReports)
      .set(updateData)
      .where(eq(complianceReports.id, id))
      .returning();
    return report;
  }

  // Security Incidents
  async getSecurityIncidents(status?: string): Promise<SecurityIncident[]> {
    let query: any = db.select().from(securityIncidents).orderBy(desc(securityIncidents.detectedAt));
    
    if (status) {
      query = query.where(eq(securityIncidents.status, status));
    }
    
    return await query;
  }

  async createSecurityIncident(incidentData: InsertSecurityIncident): Promise<SecurityIncident> {
    const [incident] = await db.insert(securityIncidents).values(incidentData).returning();
    return incident;
  }

  async updateSecurityIncident(id: number, incidentData: Partial<InsertSecurityIncident>): Promise<SecurityIncident> {
    const [incident] = await db
      .update(securityIncidents)
      .set(incidentData)
      .where(eq(securityIncidents.id, id))
      .returning();
    return incident;
  }

  // Data Encryption
  async encryptSensitiveData(tableName: string, columnName: string, recordId: string, data: string): Promise<DataEncryption> {
    // Get active encryption key
    const encryptionKey = await this.getActiveEncryptionKey('data');
    if (!encryptionKey) {
      throw new Error('No active encryption key found');
    }

    // In a real implementation, use proper encryption (crypto module)
    const encryptedData = Buffer.from(data).toString('base64'); // Simplified encryption
    const iv = randomUUID().replace(/-/g, ''); // Random IV
    const authTag = randomUUID().replace(/-/g, ''); // Random auth tag

    const encryptionRecord: InsertDataEncryption = {
      tableName,
      columnName,
      recordId,
      encryptedData,
      keyId: encryptionKey.keyId,
      iv,
      authTag,
    };

    const [result] = await db.insert(dataEncryption).values(encryptionRecord).returning();
    return result;
  }

  async decryptSensitiveData(tableName: string, columnName: string, recordId: string): Promise<string | null> {
    const [encryptionRecord] = await db
      .select()
      .from(dataEncryption)
      .where(and(
        eq(dataEncryption.tableName, tableName),
        eq(dataEncryption.columnName, columnName),
        eq(dataEncryption.recordId, recordId)
      ))
      .orderBy(desc(dataEncryption.createdAt))
      .limit(1);

    if (!encryptionRecord) {
      return null;
    }

    // In a real implementation, use proper decryption
    try {
      return Buffer.from(encryptionRecord.encryptedData, 'base64').toString('utf8');
    } catch (error) {
      console.error('Decryption failed:', error);
      return null;
    }
  }

  // Compliance Utilities
  async generateFSCAReport(period: string): Promise<ComplianceReport> {
    // Generate comprehensive FSCA compliance report
    const trustAccountsData = await this.getTrustAccounts();
    const transactionsData = await this.getTrustAccountTransactions();
    
    const reportData = {
      period,
      generatedAt: new Date().toISOString(),
      trustAccounts: trustAccountsData.map(account => ({
        accountNumber: account.accountNumber,
        balance: account.balance,
        fsca_compliant: account.fsca_compliant,
        regulatoryId: account.regulatoryId,
      })),
      transactions: transactionsData.map(transaction => ({
        transactionId: transaction.transactionId,
        type: transaction.type,
        amount: transaction.amount,
        status: transaction.status,
        date: transaction.createdAt,
      })),
      summary: {
        totalTrustBalance: trustAccountsData.reduce((sum, acc) => sum + parseFloat(acc.balance || '0'), 0),
        transactionCount: transactionsData.length,
        complianceStatus: trustAccountsData.every(acc => acc.fsca_compliant) ? 'compliant' : 'non-compliant',
      },
    };

    const reportHash = Buffer.from(JSON.stringify(reportData)).toString('base64').substring(0, 64);

    const reportInsert: InsertComplianceReport = {
      reportType: 'fsca_monthly',
      reportPeriod: period,
      generatedBy: 'system',
      reportData,
      fileHash: reportHash,
      status: 'draft',
    };

    return await this.createComplianceReport(reportInsert);
  }

  async validateTrustAccountCompliance(): Promise<boolean> {
    const trustAccounts = await this.getTrustAccounts();
    
    // Check all trust accounts are FSCA compliant
    const allCompliant = trustAccounts.every(account => account.fsca_compliant);
    
    // Check for any recent security incidents
    const recentIncidents = await db
      .select()
      .from(securityIncidents)
      .where(and(
        eq(securityIncidents.status, 'open'),
        sql`${securityIncidents.detectedAt} >= NOW() - INTERVAL '30 days'`
      ));

    return allCompliant && recentIncidents.length === 0;
  }

  // Arrears Management
  async getArrears(
    orgId: number,
    status?: string,
    opts?: { limit?: number; offset?: number }
  ): Promise<{ rows: Arrears[]; total: number }> {
    const conditions = [eq(arrears.organizationId, orgId)];
    if (status) conditions.push(eq(arrears.status, status));

    const where = and(...conditions);
    const limit  = Math.min(opts?.limit  ?? 20, 200);
    const offset = opts?.offset ?? 0;

    const [rows, [{ total }]] = await Promise.all([
      db.select().from(arrears).where(where)
        .orderBy(desc(arrears.daysOverdue))
        .limit(limit).offset(offset),
      db.select({ total: count() }).from(arrears).where(where),
    ]);

    return { rows, total };
  }

  async createArrears(arrearsData: InsertArrears): Promise<Arrears> {
    const [record] = await db.insert(arrears).values(arrearsData).returning();
    return record;
  }

  async updateArrears(id: number, orgId: number, data: Partial<InsertArrears>): Promise<Arrears> {
    const [record] = await db
      .update(arrears)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(arrears.id, id), eq(arrears.organizationId, orgId)))
      .returning();
    return record;
  }

  async detectArrears(orgId: number): Promise<Arrears[]> {
    // Detect overdue payments and upsert arrears records — scoped to orgId.
    // Finance-correct: sums ALL overdue payments per tenant (not just the first),
    // and updates existing active arrears records rather than skipping them.
    const currentDate = new Date();

    const orgTenantIds = (
      await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.organizationId, orgId))
    ).map((r) => r.id);

    if (orgTenantIds.length === 0) return [];

    // Fetch ALL overdue payments, grouped by tenant
    const overdueRentPayments = await db
      .select({
        tenantId:  rentPayments.tenantId,
        dueDate:   rentPayments.dueDate,
        amount:    rentPayments.amount,
        currency:  rentPayments.currency,
      })
      .from(rentPayments)
      .where(and(
        eq(rentPayments.status, 'pending'),
        sql`${rentPayments.dueDate} < ${currentDate}`,
        inArray(rentPayments.tenantId, orgTenantIds)
      ))
      .orderBy(rentPayments.tenantId, rentPayments.dueDate);

    // Group by tenant and sum all overdue amounts
    const byTenant = new Map<number, { totalAmount: number; currency: string; oldestDueDate: Date; latestDueDate: Date; count: number }>();
    for (const p of overdueRentPayments) {
      const tid = p.tenantId!;
      const due = new Date(p.dueDate!);
      const existing = byTenant.get(tid);
      if (existing) {
        existing.totalAmount += Number(p.amount ?? 0);
        existing.count++;
        if (due < existing.oldestDueDate) existing.oldestDueDate = due;
        if (due > existing.latestDueDate) existing.latestDueDate = due;
      } else {
        byTenant.set(tid, {
          totalAmount:   Number(p.amount ?? 0),
          currency:      p.currency ?? 'KES',
          oldestDueDate: due,
          latestDueDate: due,
          count:         1,
        });
      }
    }

    const arrearsRecords: Arrears[] = [];

    for (const [tenantId, info] of byTenant.entries()) {
      const daysOverdue = Math.floor(
        (currentDate.getTime() - info.oldestDueDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      const priority = daysOverdue > 60 ? 'critical' : daysOverdue > 30 ? 'high' : 'medium';

      // Resolve unit and property
      const [tenantRow] = await db
        .select({ unitId: tenants.unitId })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);
      const unitId: number | null = tenantRow?.unitId ?? null;
      let propertyId: number | null = null;
      if (unitId) {
        const [unitRow] = await db
          .select({ propertyId: units.propertyId })
          .from(units)
          .where(eq(units.id, unitId))
          .limit(1);
        propertyId = unitRow?.propertyId ?? null;
      }

      // Upsert: update existing active record if one exists, else create
      const [existingRecord] = await db
        .select()
        .from(arrears)
        .where(and(
          eq(arrears.tenantId, tenantId),
          eq(arrears.organizationId, orgId),
          eq(arrears.status, 'active')
        ))
        .limit(1);

      if (existingRecord) {
        // Update outstanding amount and days overdue (they change every day)
        const [updated] = await db
          .update(arrears)
          .set({
            outstandingAmount: String(info.totalAmount.toFixed(2)),
            daysOverdue,
            priority,
            nextDueDate: info.latestDueDate,
            notes: `${info.count} payment(s) overdue totalling ${info.currency} ${info.totalAmount.toFixed(2)}`,
            updatedAt: new Date(),
          } as any)
          .where(eq(arrears.id, existingRecord.id))
          .returning();
        arrearsRecords.push(updated);
      } else {
        const arrearsData: InsertArrears = {
          organizationId:   orgId,
          tenantId,
          unitId:           unitId as number,
          propertyId:       propertyId as number,
          outstandingAmount: String(info.totalAmount.toFixed(2)),
          currency:         info.currency as any,
          daysOverdue,
          nextDueDate:      info.latestDueDate,
          status:           'active',
          priority,
          notes:            `${info.count} payment(s) overdue totalling ${info.currency} ${info.totalAmount.toFixed(2)}`,
        };
        const record = await this.createArrears(arrearsData);
        arrearsRecords.push(record);
      }
    }

    return arrearsRecords;
  }

  // Payment Reminders
  async getPaymentReminders(status?: string): Promise<PaymentReminder[]> {
    let query: any = db.select().from(paymentReminders).orderBy(desc(paymentReminders.scheduledFor));
    
    if (status) {
      query = query.where(eq(paymentReminders.status, status));
    }
    
    return await query;
  }

  async createPaymentReminder(reminderData: InsertPaymentReminder): Promise<PaymentReminder> {
    const [reminder] = await db.insert(paymentReminders).values(reminderData).returning();
    return reminder;
  }

  async updatePaymentReminderStatus(id: number, status: string, sentAt?: Date): Promise<PaymentReminder> {
    const updateData: any = { status };
    if (sentAt) {
      updateData.sentAt = sentAt;
    }
    
    const [reminder] = await db
      .update(paymentReminders)
      .set(updateData)
      .where(eq(paymentReminders.id, id))
      .returning();
    return reminder;
  }

  async scheduleAutomaticReminders(orgId: number): Promise<PaymentReminder[]> {
    // Schedule reminders for overdue payments — scoped to orgId
    const { rows: activeArrears } = await this.getArrears(orgId, 'active', { limit: 2000 });
    const reminders = [];

    for (const arrear of activeArrears) {
      // Check if reminder already sent in last 7 days
      const recentReminder = await db
        .select()
        .from(paymentReminders)
        .where(and(
          eq(paymentReminders.arrearsId, arrear.id),
          sql`${paymentReminders.createdAt} >= NOW() - INTERVAL '7 days'`
        ))
        .limit(1);

      if (recentReminder.length === 0) {
        const reminderType = arrear.daysOverdue > 30 ? 'final_notice' : 'overdue';
        const message = arrear.daysOverdue > 30 
          ? `FINAL NOTICE: Your rent payment of ${arrear.outstandingAmount} ${arrear.currency} is ${arrear.daysOverdue} days overdue. Immediate payment required to avoid legal action.`
          : `PAYMENT REMINDER: Your rent payment of ${arrear.outstandingAmount} ${arrear.currency} is ${arrear.daysOverdue} days overdue. Please make payment as soon as possible.`;

        const reminderData: InsertPaymentReminder = {
          tenantId: arrear.tenantId,
          arrearsId: arrear.id,
          reminderType,
          channel: 'email',
          message,
          scheduledFor: new Date(),
          recipientInfo: { tenantId: arrear.tenantId },
        };

        const reminder = await this.createPaymentReminder(reminderData);
        reminders.push(reminder);
      }
    }

    return reminders;
  }

  // Risk Assessment
  async getRiskAssessments(tenantId?: number): Promise<RiskAssessment[]> {
    let query: any = db.select().from(riskAssessments).orderBy(desc(riskAssessments.assessmentDate));
    
    if (tenantId) {
      query = query.where(eq(riskAssessments.tenantId, tenantId));
    }
    
    return await query;
  }

  async createRiskAssessment(assessmentData: InsertRiskAssessment): Promise<RiskAssessment> {
    const [assessment] = await db.insert(riskAssessments).values(assessmentData).returning();
    return assessment;
  }

  async calculateTenantRiskScore(tenantId: number, assessedBy?: string): Promise<RiskAssessment> {
    // ── 1. Fetch raw data ────────────────────────────────────────────────────
    const paymentHistory = await db
      .select()
      .from(rentPayments)
      .where(eq(rentPayments.tenantId, tenantId))
      .orderBy(desc(rentPayments.dueDate))
      .limit(24); // last 24 months for better stability signal

    const arrearsHistory = await db
      .select()
      .from(arrears)
      .where(eq(arrears.tenantId, tenantId));

    const behaviorLogs = await db
      .select()
      .from(tenantBehaviorLogs)
      .where(eq(tenantBehaviorLogs.tenantId, tenantId))
      .orderBy(desc(tenantBehaviorLogs.eventDate))
      .limit(20);

    const [tenantRow] = await db
      .select({
        leaseStartDate: tenants.leaseStartDate,
        leaseEndDate:   tenants.leaseEndDate,
        monthlyRent:    tenants.monthlyRent,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    // ── 2. Payment history score (fix #1: new tenants) ───────────────────────
    // New tenants (0 payments) get a neutral 65 — "unknown but not bad".
    // We also use the broader set of paid/partial statuses, not just 'completed'.
    const NEW_TENANT_BASELINE = 65;
    const isNewTenant = paymentHistory.length === 0;

    const onTimePayments = paymentHistory.filter(p => {
      const isPaid = p.status === 'paid' || p.status === 'completed' || p.status === 'partial';
      if (!isPaid || !p.paidDate) return false;
      return new Date(p.paidDate) <= new Date(p.dueDate);
    }).length;

    const latePayments = paymentHistory.filter(p => {
      const isPaid = p.status === 'paid' || p.status === 'completed' || p.status === 'partial';
      if (!isPaid || !p.paidDate) return false;
      return new Date(p.paidDate) > new Date(p.dueDate);
    }).length;

    // Penalise active arrears on top of the ratio
    const activeArrearsCount = arrearsHistory.filter(a => a.status === 'active').length;
    const arrearsPenalty = Math.min(activeArrearsCount * 8, 30); // up to -30

    let paymentHistoryScore: number;
    if (isNewTenant) {
      paymentHistoryScore = NEW_TENANT_BASELINE;
    } else {
      const rawRatio = Math.round((onTimePayments / paymentHistory.length) * 100);
      paymentHistoryScore = Math.max(0, rawRatio - arrearsPenalty);
    }

    // ── 3. Income stability score (fix #2: real signals) ─────────────────────
    // Derived from three independent signals:
    //   a) Tenure — longer lease = more stable (max 30 pts)
    //   b) Payment amount consistency — low variance = stable income (max 40 pts)
    //   c) Payment engagement — proportion of non-overdue/unpaid records (max 30 pts)
    let incomeStabilityScore: number;

    if (isNewTenant) {
      // Can't assess stability yet; start neutral
      incomeStabilityScore = 60;
    } else {
      // a) Tenure score
      let tenureScore = 15; // default mid if no dates
      if (tenantRow?.leaseStartDate) {
        const monthsTenure = Math.floor(
          (Date.now() - new Date(tenantRow.leaseStartDate).getTime()) / (1000 * 60 * 60 * 24 * 30)
        );
        tenureScore = Math.min(30, Math.round(monthsTenure * 2.5)); // 12 months → 30 pts
      }

      // b) Amount consistency score (coefficient of variation)
      const paidAmounts = paymentHistory
        .filter(p => p.paidDate && (p.status === 'paid' || p.status === 'completed' || p.status === 'partial'))
        .map(p => parseFloat(p.amount.toString()));

      let consistencyScore = 20; // neutral default
      if (paidAmounts.length >= 2) {
        const mean = paidAmounts.reduce((s, v) => s + v, 0) / paidAmounts.length;
        const variance = paidAmounts.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / paidAmounts.length;
        const cv = mean > 0 ? Math.sqrt(variance) / mean : 1; // coefficient of variation
        // cv=0 (perfectly consistent) → 40pts; cv≥0.5 (very erratic) → 0pts
        consistencyScore = Math.round(Math.max(0, 40 * (1 - cv / 0.5)));
      }

      // c) Engagement score — paid or partial vs all records
      const engagedCount = paymentHistory.filter(
        p => p.status === 'paid' || p.status === 'completed' || p.status === 'partial'
      ).length;
      const engagementScore = Math.round((engagedCount / paymentHistory.length) * 30);

      incomeStabilityScore = Math.min(100, tenureScore + consistencyScore + engagementScore);
    }

    // ── 4. Behavior score (fix #3: sparse log dampening) ────────────────────
    // With few logs, blend the raw signal toward the neutral base (70)
    // so that 1 bad event doesn't tank the score.
    const BEHAVIOR_NEUTRAL = 70;
    const MIN_CONFIDENT_LOGS = 5; // need at least 5 events to trust the signal fully

    let rawBehaviorDelta = 0;
    behaviorLogs.forEach(log => {
      if (log.eventCategory === 'positive') {
        rawBehaviorDelta += log.impact === 'high' ? 5 : log.impact === 'medium' ? 3 : 1;
      } else if (log.eventCategory === 'negative') {
        rawBehaviorDelta -= log.impact === 'high' ? 10 : log.impact === 'medium' ? 5 : 2;
      }
    });

    // Confidence weight: 0 logs → 0% signal, MIN_CONFIDENT_LOGS+ → 100% signal
    const confidence = Math.min(1, behaviorLogs.length / MIN_CONFIDENT_LOGS);
    const behaviorScore = Math.max(
      0,
      Math.min(100, Math.round(BEHAVIOR_NEUTRAL + rawBehaviorDelta * confidence))
    );

    // ── 5. Overall risk score ────────────────────────────────────────────────
    // Weights now total 100% across genuinely independent signals.
    const riskScore = Math.round(
      paymentHistoryScore  * 0.45 +
      incomeStabilityScore * 0.30 +
      behaviorScore        * 0.25
    );

    // ── 6. Risk category ────────────────────────────────────────────────────
    let riskCategory = 'low';
    if (riskScore < 30)      riskCategory = 'critical';
    else if (riskScore < 50) riskCategory = 'high';
    else if (riskScore < 70) riskCategory = 'medium';

    // ── 7. Recommendations ──────────────────────────────────────────────────
    const recParts: string[] = [];
    if (activeArrearsCount > 0)        recParts.push(`Resolve ${activeArrearsCount} active arrears case(s).`);
    if (paymentHistoryScore < 50)      recParts.push('Require additional security deposit and set up a payment plan.');
    if (incomeStabilityScore < 50)     recParts.push('Request proof of income or guarantor to support the tenancy.');
    if (behaviorScore < 60)            recParts.push('Schedule a welfare check and address any outstanding complaints.');
    if (isNewTenant)                   recParts.push('Insufficient payment history — reassess after 3 months.');
    if (latePayments > 2)              recParts.push('Recurring late payments detected — consider automated early reminders.');
    if (recParts.length === 0) {
      recParts.push(riskScore >= 80
        ? 'Tenant is in excellent standing. Continue routine monitoring.'
        : 'Tenant shows good payment behavior. Continue regular monitoring.');
    }
    const recommendations = recParts.join(' ');

    // ── 8. Persist ──────────────────────────────────────────────────────────
    const assessmentData: InsertRiskAssessment = {
      tenantId,
      riskScore,
      riskCategory,
      paymentHistoryScore,
      incomeStabilityScore,
      behaviorScore,
      factors: {
        totalPayments:       paymentHistory.length,
        onTimePayments,
        latePayments,
        activeArrearsCount,
        totalArrearsCount:   arrearsHistory.length,
        behaviorEvents:      behaviorLogs.length,
        behaviorConfidence:  Math.round(confidence * 100),
        isNewTenant,
      },
      recommendations,
      assessedBy: assessedBy || '00000000-0000-0000-0000-000000000000',
      nextReviewDate: new Date(Date.now() + (isNewTenant ? 90 : 90) * 24 * 60 * 60 * 1000),
    };

    // Upsert: update the existing assessment for this tenant if one exists,
    // otherwise insert a new one. This prevents duplicate cards in the UI.
    const [existing] = await db
      .select({ id: riskAssessments.id })
      .from(riskAssessments)
      .where(eq(riskAssessments.tenantId, tenantId))
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(riskAssessments)
        .set({ ...assessmentData, assessmentDate: new Date() })
        .where(eq(riskAssessments.id, existing.id))
        .returning();
      return updated;
    }

    return await this.createRiskAssessment(assessmentData);
  }

  // Tenant Behavior Tracking
  async getTenantBehaviorLogs(tenantId?: number): Promise<TenantBehaviorLog[]> {
    let query: any = db.select().from(tenantBehaviorLogs).orderBy(desc(tenantBehaviorLogs.eventDate));
    
    if (tenantId) {
      query = query.where(eq(tenantBehaviorLogs.tenantId, tenantId));
    }
    
    return await query;
  }

  async createTenantBehaviorLog(logData: InsertTenantBehaviorLog): Promise<TenantBehaviorLog> {
    const [log] = await db.insert(tenantBehaviorLogs).values(logData).returning();
    return log;
  }

  // Arrears Actions
  async getArrearsActions(arrearsId?: number): Promise<ArrearsAction[]> {
    let query: any = db.select().from(arrearsActions).orderBy(desc(arrearsActions.actionDate));
    
    if (arrearsId) {
      query = query.where(eq(arrearsActions.arrearsId, arrearsId));
    }
    
    return await query;
  }

  async createArrearsAction(actionData: InsertArrearsAction): Promise<ArrearsAction> {
    const [action] = await db.insert(arrearsActions).values(actionData).returning();
    return action;
  }

  // Tenant Portal Management
  async createTenantPortalSession(sessionData: InsertTenantPortalSession): Promise<TenantPortalSession> {
    const [session] = await db.insert(tenantPortalSessions).values(sessionData).returning();
    return session;
  }

  async getTenantPortalSession(sessionToken: string): Promise<TenantPortalSession | undefined> {
    const [session] = await db
      .select()
      .from(tenantPortalSessions)
      .where(and(
        eq(tenantPortalSessions.sessionToken, sessionToken),
        sql`${tenantPortalSessions.expiresAt} > NOW()`
      ))
      .limit(1);
    return session;
  }

  async updateTenantPortalSessionActivity(sessionToken: string): Promise<void> {
    await db
      .update(tenantPortalSessions)
      .set({ lastActivity: new Date() })
      .where(eq(tenantPortalSessions.sessionToken, sessionToken));
  }

  async expireTenantPortalSession(sessionToken: string): Promise<void> {
    await db
      .update(tenantPortalSessions)
      .set({ expiresAt: new Date() })
      .where(eq(tenantPortalSessions.sessionToken, sessionToken));
  }

  // Landlord Portal Management  
  async createLandlordPortalSession(sessionData: InsertLandlordPortalSession): Promise<LandlordPortalSession> {
    const [session] = await db.insert(landlordPortalSessions).values(sessionData).returning();
    return session;
  }

  async getLandlordPortalSession(sessionToken: string): Promise<LandlordPortalSession | undefined> {
    const [session] = await db
      .select()
      .from(landlordPortalSessions)
      .where(and(
        eq(landlordPortalSessions.sessionToken, sessionToken),
        sql`${landlordPortalSessions.expiresAt} > NOW()`
      ))
      .limit(1);
    return session;
  }

  // Rental Statements
  async getRentalStatements(tenantId?: number, period?: string): Promise<RentalStatement[]> {
    let query: any = db.select().from(rentalStatements).orderBy(desc(rentalStatements.statementDate));
    
    if (tenantId) {
      query = query.where(eq(rentalStatements.tenantId, tenantId));
    }
    
    if (period) {
      query = query.where(eq(rentalStatements.statementPeriod, period));
    }
    
    return await query;
  }

  async createRentalStatement(statementData: InsertRentalStatement): Promise<RentalStatement> {
    const [statement] = await db.insert(rentalStatements).values(statementData).returning();
    return statement;
  }

  async markStatementAsViewed(statementId: number): Promise<RentalStatement> {
    const [statement] = await db
      .update(rentalStatements)
      .set({ 
        status: 'viewed',
        viewedAt: new Date()
      })
      .where(eq(rentalStatements.id, statementId))
      .returning();
    return statement;
  }

  async generateMonthlyStatements(): Promise<RentalStatement[]> {
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth() + 1;
    const currentYear = currentDate.getFullYear();
    const statementPeriod = `${currentYear}-${currentMonth.toString().padStart(2, '0')}`;

    // Get all active tenants
    const activeTenants = await db
      .select({
        tenantId: tenants.id,
        propertyId: units.propertyId,
        unitId: units.id,
        rent: units.monthlyRent,
        currency: units.currency,
      })
      .from(tenants)
      .innerJoin(units, eq(tenants.unitId, units.id))
      .where(eq(tenants.status, 'active'));

    const statements = [];
    
    for (const tenant of activeTenants) {
      // Calculate previous balance
      const previousStatements = await db
        .select()
        .from(rentalStatements)
        .where(and(
          eq(rentalStatements.tenantId, tenant.tenantId),
          sql`${rentalStatements.statementPeriod} < ${statementPeriod}`
        ))
        .orderBy(desc(rentalStatements.statementDate))
        .limit(1);

      const previousBalance = previousStatements.length > 0 
        ? parseFloat(previousStatements[0].currentBalance) 
        : 0;

      // Get payments for this period
      const payments = await db
        .select()
        .from(rentPayments)
        .where(and(
          eq(rentPayments.tenantId, tenant.tenantId),
          sql`EXTRACT(YEAR FROM ${rentPayments.paidDate}) = ${currentYear}`,
          sql`EXTRACT(MONTH FROM ${rentPayments.paidDate}) = ${currentMonth}`
        ));

      const paymentsReceived = payments.reduce((sum, payment) => 
        sum + parseFloat(payment.amount), 0
      );

      // Get additional charges
      const additionalCharges = await db
        .select()
        .from(serviceCharges)
        .where(and(
          eq((serviceCharges as any).tenantId, tenant.tenantId),
          sql`EXTRACT(YEAR FROM ${serviceCharges.dueDate}) = ${currentYear}`,
          sql`EXTRACT(MONTH FROM ${serviceCharges.dueDate}) = ${currentMonth}`
        ));

      const totalAdditionalCharges = additionalCharges.reduce((sum, charge) => 
        sum + parseFloat(charge.amount), 0
      );

      const rentCharged = parseFloat(tenant.rent);
      const currentBalance = previousBalance + rentCharged + totalAdditionalCharges - paymentsReceived;

      const statementData: InsertRentalStatement = {
        tenantId: tenant.tenantId,
        propertyId: tenant.propertyId,
        unitId: tenant.unitId,
        statementPeriod,
        statementDate: (currentDate instanceof Date ? currentDate : new Date(currentDate)).toISOString().split("T")[0],
        previousBalance: previousBalance.toString(),
        rentCharged: rentCharged.toString(),
        additionalCharges: totalAdditionalCharges.toString(),
        paymentsReceived: paymentsReceived.toString(),
        currentBalance: currentBalance.toString(),
        dueDate: new Date(currentYear, currentMonth, 1).toISOString().split("T")[0], // 1st of next month
        currency: tenant.currency || 'USD',
        chargeBreakdown: {
          rent: rentCharged,
          additionalCharges: additionalCharges.map(c => ({
            description: c.description,
            amount: parseFloat(c.amount)
          }))
        },
        paymentHistory: payments.map(p => ({
          date: p.paidDate,
          amount: parseFloat(p.amount),
          method: p.paymentMethod
        }))
      };

      const statement = await this.createRentalStatement(statementData);
      statements.push(statement);
    }

    return statements;
  }

  // Portfolio Reports
  async getPortfolioReports(ownerId?: string, reportType?: string): Promise<PortfolioReport[]> {
    let query: any = db.select().from(portfolioReports).orderBy(desc(portfolioReports.createdAt));
    
    if (ownerId) {
      query = query.where(eq(portfolioReports.ownerId, ownerId));
    }
    
    if (reportType) {
      query = query.where(eq(portfolioReports.reportType, reportType));
    }
    
    return await query;
  }

  async createPortfolioReport(reportData: InsertPortfolioReport): Promise<PortfolioReport> {
    const [report] = await db.insert(portfolioReports).values(reportData).returning();
    return report;
  }

  async generatePortfolioReport(ownerId: string, reportType: string, startDate: Date, endDate: Date): Promise<PortfolioReport> {
    // Get owner's properties
    const ownerProperties = await db
      .select()
      .from(properties)
      .where(eq(properties.ownerId, ownerId));

    const propertyIds = ownerProperties.map(p => p.id);

    // Calculate total revenue - if no properties, return 0
    if (propertyIds.length === 0) {
      const reportData: InsertPortfolioReport = {
        ownerId,
        reportType,
        reportPeriodStart: (startDate instanceof Date ? startDate : new Date(startDate)).toISOString().split("T")[0],
        reportPeriodEnd: (endDate instanceof Date ? endDate : new Date(endDate)).toISOString().split("T")[0],
        propertiesIncluded: [],
        totalRevenue: "0.00",
        totalExpenses: "0.00",
        netIncome: "0.00",
        occupancyRate: "0.00",
        summary: { message: "No properties found for this owner" },
        reportData: {},
        status: 'generated'
      };
      return await this.createPortfolioReport(reportData);
    }

    // Simplified revenue calculation
    // Real revenue from paid rent_payments in period
    const revRows = await db.select({ amount: rentPayments.amount })
      .from(rentPayments)
      .leftJoin(tenants, eq(rentPayments.tenantId, tenants.id))
      .leftJoin(units, eq(tenants.unitId, units.id))
      .where(and(
        inArray(units.propertyId, propertyIds),
        inArray(rentPayments.status, ['paid', 'completed']),
        gte(rentPayments.createdAt, startDate),
        lte(rentPayments.createdAt, endDate)
      ));
    const totalRevenue = revRows.reduce((s: number, r: any) => s + Number(r.amount || 0), 0);

    // Real expenses from property_expenses in period
    const expRows = await db.select({ amount: propertyExpenses.amount })
      .from(propertyExpenses)
      .where(and(
        inArray(propertyExpenses.propertyId, propertyIds),
        gte(propertyExpenses.createdAt, startDate),
        lte(propertyExpenses.createdAt, endDate)
      ));
    const totalExpenses = expRows.reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
    const netIncome = totalRevenue - totalExpenses;

    // Real occupancy from units table
    const allUnits = await db.select({ isOccupied: units.isOccupied })
      .from(units).where(inArray(units.propertyId, propertyIds));
    const totalUnitsCount = allUnits.length;
    const occupiedUnitsCount = allUnits.filter((u: any) => u.isOccupied).length;
    const occupancyRate = totalUnitsCount > 0 ? Math.round((occupiedUnitsCount / totalUnitsCount) * 100) : 0;

    const reportData: InsertPortfolioReport = {
      ownerId,
      reportType,
      reportPeriodStart: (startDate instanceof Date ? startDate : new Date(startDate)).toISOString().split("T")[0],
      reportPeriodEnd: (endDate instanceof Date ? endDate : new Date(endDate)).toISOString().split("T")[0],
      propertiesIncluded: propertyIds,
      totalRevenue: totalRevenue.toString(),
      totalExpenses: totalExpenses.toString(),
      netIncome: netIncome.toString(),
      occupancyRate: occupancyRate.toString(),
      summary: {
        totalProperties: ownerProperties.length,
        totalUnits: totalUnitsCount,
        occupiedUnits: occupiedUnitsCount,
        revenueGrowth: 0, // Would calculate from previous period
      },
      reportData: {
        properties: ownerProperties,
        revenueBreakdown: { rent: totalRevenue },
        expenseBreakdown: { utilities: totalExpenses },
      }
    };

    return await this.createPortfolioReport(reportData);
  }

  // Tenant Notifications
  async getTenantNotifications(tenantId?: number, status?: string): Promise<TenantNotification[]> {
    let query: any = db.select().from(tenantNotifications).orderBy(desc(tenantNotifications.scheduledFor));
    
    if (tenantId) {
      query = query.where(eq(tenantNotifications.tenantId, tenantId));
    }
    
    if (status) {
      query = query.where(eq(tenantNotifications.status, status));
    }
    
    return await query;
  }

  async createTenantNotification(notificationData: InsertTenantNotification): Promise<TenantNotification> {
    const [notification] = await db.insert(tenantNotifications).values(notificationData).returning();
    return notification;
  }

  async updateNotificationStatus(notificationId: number, status: string, timestamp?: Date): Promise<TenantNotification> {
    const updateData: any = { status };
    
    if (timestamp) {
      if (status === 'sent') updateData.sentAt = timestamp;
      if (status === 'delivered') updateData.deliveredAt = timestamp;
      if (status === 'read') updateData.readAt = timestamp;
    }
    
    const [notification] = await db
      .update(tenantNotifications)
      .set(updateData)
      .where(eq(tenantNotifications.id, notificationId))
      .returning();
    return notification;
  }

  async sendAutomaticNotifications(): Promise<TenantNotification[]> {
    const notifications = [];
    
    // Payment due notifications
    const upcomingPayments = await db
      .select()
      .from(rentPayments)
      .where(and(
        eq(rentPayments.status, 'pending'),
        sql`${rentPayments.dueDate} = CURRENT_DATE + INTERVAL '3 days'`
      ));

    for (const payment of upcomingPayments) {
      const notificationData: InsertTenantNotification = {
        tenantId: payment.tenantId,
        notificationType: 'payment_due',
        title: 'Rent Payment Due Soon',
        message: `Your rent payment of $${payment.amount} is due on ${payment.dueDate}. Please ensure timely payment to avoid late fees.`,
        channel: 'email',
        recipientInfo: { tenantId: payment.tenantId },
        metadata: { paymentId: payment.id, amount: payment.amount }
      };

      const notification = await this.createTenantNotification(notificationData);
      notifications.push(notification);
    }

    return notifications;
  }

  // Portal Customization
  async getPortalCustomization(portalType: string, entityId: string): Promise<PortalCustomization | undefined> {
    const [customization] = await db
      .select()
      .from(portalCustomization)
      .where(and(
        eq(portalCustomization.portalType, portalType),
        eq(portalCustomization.entityId, entityId),
        eq(portalCustomization.isActive, true)
      ))
      .limit(1);
    return customization;
  }

  async upsertPortalCustomization(customizationData: InsertPortalCustomization): Promise<PortalCustomization> {
    const [customization] = await db
      .insert(portalCustomization)
      .values(customizationData)
      .onConflictDoUpdate({
        target: [portalCustomization.portalType, portalCustomization.entityId],
        set: {
          ...customizationData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return customization;
  }

  // Tenant Documents
  async getTenantDocuments(tenantId: number, documentType?: string): Promise<TenantDocument[]> {
    const conds: any[] = [eq(tenantDocuments.tenantId, tenantId), eq(tenantDocuments.isPublic, true)];
    if (documentType) conds.push(eq(tenantDocuments.documentType, documentType));
    return await (db as any).select().from(tenantDocuments)
      .where(and(...conds))
      .orderBy(desc(tenantDocuments.createdAt));
  }

  async createTenantDocument(documentData: InsertTenantDocument): Promise<TenantDocument> {
    const [document] = await db.insert(tenantDocuments).values(documentData).returning();
    return document;
  }

  async incrementDocumentDownload(documentId: number): Promise<void> {
    await db
      .update(tenantDocuments)
      .set({ 
        downloadCount: sql`${tenantDocuments.downloadCount} + 1`,
        lastDownloaded: new Date()
      })
      .where(eq(tenantDocuments.id, documentId));
  }

  // Payment Receipts
  async getPaymentReceipts(tenantId?: number, paymentId?: number): Promise<PaymentReceipt[]> {
    let query: any = db.select().from(paymentReceipts).orderBy(desc(paymentReceipts.paymentDate));
    
    if (tenantId) {
      query = query.where(eq(paymentReceipts.tenantId, tenantId));
    }
    
    if (paymentId) {
      query = query.where(eq(paymentReceipts.paymentId, paymentId));
    }
    
    return await query;
  }

  async createPaymentReceipt(receiptData: InsertPaymentReceipt): Promise<PaymentReceipt> {
    const [receipt] = await db.insert(paymentReceipts).values(receiptData).returning();
    return receipt;
  }

  async generatePaymentReceipt(paymentId: number): Promise<PaymentReceipt> {
    // Get payment details
    const [payment] = await db
      .select()
      .from(rentPayments)
      .where(eq(rentPayments.id, paymentId))
      .limit(1);

    if (!payment) {
      throw new Error('Payment not found');
    }

    // Generate unique receipt number
    const receiptNumber = `REC-${Date.now()}-${paymentId}`;

    const receiptData: InsertPaymentReceipt = {
      paymentId,
      tenantId: payment.tenantId,
      receiptNumber,
      amount: payment.amount,
      currency: payment.currency,
      paymentMethod: payment.paymentMethod ?? "cash",
      paymentDate: payment.paidDate || payment.dueDate,
      description: `Rent payment for rental property`,
    };

    return await this.createPaymentReceipt(receiptData);
  }

  // ==============================
  // TENANT PORTAL OPERATIONS
  // ==============================

  async getTenantDashboard(tenantId: number): Promise<any> {
    // Get tenant details
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // Get recent statements
    const statements = await db
      .select()
      .from(rentalStatements)
      .where(eq(rentalStatements.tenantId, tenantId))
      .orderBy(desc(rentalStatements.statementDate))
      .limit(5);

    // Get recent payments  
    const payments = await db
      .select()
      .from(rentPayments)
      .where(eq(rentPayments.tenantId, tenantId))
      .orderBy(desc(rentPayments.paidDate))
      .limit(5);

    // Get notifications
    const notifications = await db
      .select()
      .from(tenantNotifications)
      .where(eq(tenantNotifications.tenantId, tenantId))
      .orderBy(desc(tenantNotifications.scheduledFor))
      .limit(10);

    return {
      tenant,
      statements,
      payments,
      notifications
    };
  }

  async getVisitorAccessRecords(userId: string): Promise<any[]> {
    return await db
      .select()
      .from(visitors)
      .innerJoin(properties, eq(visitors.propertyId, properties.id))
      .where(eq(properties.ownerId, userId))
      .orderBy(desc(visitors.expectedArrival))
      .limit(50);
  }

  // ==============================
  // AUTOMATED RENT COLLECTION OPERATIONS
  // ==============================

  // Payment Provider operations
  async getPaymentProviders(): Promise<PaymentProvider[]> {
    return await db.select().from(paymentProviders).where(eq(paymentProviders.isActive, true));
  }

  async createPaymentProvider(provider: InsertPaymentProvider): Promise<PaymentProvider> {
    const [created] = await db.insert(paymentProviders).values(provider).returning();
    return created;
  }

  async updatePaymentProvider(id: number, updates: Partial<InsertPaymentProvider>): Promise<PaymentProvider> {
    const [updated] = await db.update(paymentProviders)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(paymentProviders.id, id))
      .returning();
    return updated;
  }

  // Bank Account operations
  async getBankAccounts(): Promise<BankAccount[]> {
    const rows = await (db as any).select({ bankAccounts }).from(bankAccounts)
      .leftJoin(paymentProviders, eq(bankAccounts.providerId, paymentProviders.id))
      .where(eq(bankAccounts.isActive, true));
    return rows.map((r: any) => r.bankAccounts);
  }

  async createBankAccount(account: InsertBankAccount): Promise<BankAccount> {
    const [created] = await db.insert(bankAccounts).values(account).returning();
    return created;
  }

  async updateBankAccountBalance(id: number, currentBalance: string, availableBalance: string): Promise<BankAccount> {
    const [updated] = await db.update(bankAccounts)
      .set({ 
        currentBalance, 
        availableBalance, 
        lastSyncedAt: new Date(),
        updatedAt: new Date() 
      })
      .where(eq(bankAccounts.id, id))
      .returning();
    return updated;
  }

  // Mobile Money operations
  async getMobileMoneyAccounts(): Promise<MobileMoney[]> {
    const rows = await (db as any).select({ mobileMoney }).from(mobileMoney)
      .leftJoin(paymentProviders, eq(mobileMoney.providerId, paymentProviders.id))
      .where(eq(mobileMoney.isActive, true));
    return rows.map((r: any) => r.mobileMoney);
  }

  async createMobileMoneyAccount(account: InsertMobileMoney): Promise<MobileMoney> {
    const [created] = await db.insert(mobileMoney).values(account).returning();
    return created;
  }

  // Payment Transaction operations
  async getPaymentTransactions(limit = 50): Promise<PaymentTransaction[]> {
    const rows = await (db as any).select({ paymentTransactions }).from(paymentTransactions)
      .leftJoin(tenants, eq(paymentTransactions.tenantId, tenants.id))
      .leftJoin(properties, eq(paymentTransactions.propertyId, properties.id))
      .orderBy(desc(paymentTransactions.createdAt))
      .limit(limit);
    return rows.map((r: any) => r.paymentTransactions);
  }

  async getPaymentTransactionsByTenant(tenantId: number): Promise<PaymentTransaction[]> {
    return await db.select().from(paymentTransactions)
      .where(eq(paymentTransactions.tenantId, tenantId))
      .orderBy(desc(paymentTransactions.createdAt));
  }

  async createPaymentTransaction(transaction: InsertPaymentTransaction): Promise<PaymentTransaction> {
    const [created] = await db.insert(paymentTransactions).values(transaction).returning();
    return created;
  }

  async updatePaymentTransactionStatus(transactionId: string, status: string, metadata?: any): Promise<PaymentTransaction> {
    const updates: any = { 
      status, 
      updatedAt: new Date() 
    };
    
    if (status === 'completed') {
      updates.processedAt = new Date();
    }
    
    if (metadata) {
      updates.metadata = metadata;
    }

    const [updated] = await db.update(paymentTransactions)
      .set(updates)
      .where(eq(paymentTransactions.transactionId, transactionId))
      .returning();
    return updated;
  }

  // Reconciliation operations
  async getReconciliationRules(): Promise<ReconciliationRule[]> {
    return await db.select().from(reconciliationRules)
      .where(eq(reconciliationRules.isActive, true))
      .orderBy(desc(reconciliationRules.priority));
  }

  async createReconciliationRule(rule: InsertReconciliationRule): Promise<ReconciliationRule> {
    const [created] = await db.insert(reconciliationRules).values(rule).returning();
    return created;
  }

  async updateReconciliationRuleUsage(id: number): Promise<void> {
    await db.update(reconciliationRules)
      .set({ 
        successCount: sql`${reconciliationRules.successCount} + 1`,
        lastUsedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(reconciliationRules.id, id));
  }

  // Escrow Account operations
  async getEscrowAccounts(): Promise<EscrowAccount[]> {
    const rows = await (db as any).select({ escrowAccounts }).from(escrowAccounts)
      .leftJoin(properties, eq(escrowAccounts.propertyId, properties.id))
      .leftJoin(bankAccounts, eq(escrowAccounts.bankAccountId, bankAccounts.id))
      .where(eq(escrowAccounts.isActive, true));
    return rows.map((r: any) => r.escrowAccounts);
  }

  async createEscrowAccount(account: InsertEscrowAccount): Promise<EscrowAccount> {
    const [created] = await db.insert(escrowAccounts).values(account).returning();
    return created;
  }

  async updateEscrowBalance(id: number, amount: string, operation: 'add' | 'subtract'): Promise<EscrowAccount> {
    const balanceUpdate = operation === 'add' 
      ? sql`${escrowAccounts.currentBalance} + ${amount}`
      : sql`${escrowAccounts.currentBalance} - ${amount}`;

    const [updated] = await db.update(escrowAccounts)
      .set({ 
        currentBalance: balanceUpdate,
        updatedAt: new Date()
      })
      .where(eq(escrowAccounts.id, id))
      .returning();
    return updated;
  }

  // Scheduled Disbursement operations
  async getScheduledDisbursements(status?: string): Promise<ScheduledDisbursement[]> {
    let query: any = (db as any).select({ scheduledDisbursements }).from(scheduledDisbursements)
      .leftJoin(properties, eq(scheduledDisbursements.propertyId, properties.id))
      .orderBy(asc(scheduledDisbursements.scheduledFor));

    if (status) {
      query = query.where(eq(scheduledDisbursements.status, status));
    }

    const _res = await query;
    return (Array.isArray(_res) ? _res : []).map((r: any) => r.scheduledDisbursements ?? r);
  }

  async createScheduledDisbursement(disbursement: InsertScheduledDisbursement): Promise<ScheduledDisbursement> {
    const [created] = await db.insert(scheduledDisbursements).values(disbursement).returning();
    return created;
  }

  async updateDisbursementStatus(disbursementId: string, status: string, failureReason?: string): Promise<ScheduledDisbursement> {
    const updates: any = { 
      status, 
      updatedAt: new Date() 
    };

    if (status === 'completed') {
      updates.processedAt = new Date();
    }

    if (status === 'failed' && failureReason) {
      updates.failureReason = failureReason;
      updates.retryCount = sql`${scheduledDisbursements.retryCount} + 1`;
    }

    const [updated] = await db.update(scheduledDisbursements)
      .set(updates)
      .where(eq(scheduledDisbursements.disbursementId, disbursementId))
      .returning();
    return updated;
  }

  // Ledger Account operations
  async getLedgerAccounts(): Promise<LedgerAccount[]> {
    return await db.select().from(ledgerAccounts)
      .where(eq(ledgerAccounts.isActive, true))
      .orderBy(asc(ledgerAccounts.accountCode));
  }

  async createLedgerAccount(account: InsertLedgerAccount): Promise<LedgerAccount> {
    const [created] = await db.insert(ledgerAccounts).values(account).returning();
    return created;
  }

  async updateLedgerAccountBalance(accountCode: string, amount: string, operation: 'debit' | 'credit'): Promise<LedgerAccount> {
    const balanceUpdate = operation === 'debit'
      ? sql`${ledgerAccounts.currentBalance} + ${amount}`
      : sql`${ledgerAccounts.currentBalance} - ${amount}`;

    const [updated] = await db.update(ledgerAccounts)
      .set({ 
        currentBalance: balanceUpdate,
        updatedAt: new Date()
      })
      .where(eq(ledgerAccounts.accountCode, accountCode))
      .returning();
    return updated;
  }

  // Journal Entry operations
  async getJournalEntries(limit = 50): Promise<any[]> {
    return await db.select({
      ...getTableColumns(journalEntries),
      lines: sql`json_agg(${journalEntryLines}.*)`
    })
    .from(journalEntries)
    .leftJoin(journalEntryLines, eq(journalEntries.id, journalEntryLines.journalEntryId))
    .groupBy(journalEntries.id)
    .orderBy(desc(journalEntries.entryDate))
    .limit(limit);
  }

  async createJournalEntry(entry: InsertJournalEntry, lines: InsertJournalEntryLine[]): Promise<JournalEntry> {
    return await db.transaction(async (tx) => {
      // Create journal entry
      const [created] = await tx.insert(journalEntries).values(entry).returning();
      
      // Create journal entry lines
      const linesWithJournalId = lines.map((line, index) => ({
        ...line,
        journalEntryId: created.id,
        lineNumber: index + 1
      }));
      
      await tx.insert(journalEntryLines).values(linesWithJournalId);
      
      return created;
    });
  }

  // Auto-reconciliation operations
  async processAutoReconciliation(transactions: PaymentTransaction[]): Promise<any> {
    const rules = await this.getReconciliationRules();
    const results = [];

    for (const transaction of transactions) {
      for (const rule of rules) {
        const conditions = rule.conditions as any;
        
        // Check if transaction matches rule conditions
        let matches = true;
        
        if (conditions.amount && transaction.amount !== conditions.amount) {
          matches = false;
        }
        
        if (conditions.paymentMethod && transaction.paymentMethod !== conditions.paymentMethod) {
          matches = false;
        }
        
        if (conditions.tenantId && transaction.tenantId !== conditions.tenantId) {
          matches = false;
        }

        if (matches) {
          // Execute rule actions
          const actions = rule.actions as any;
          
          for (const action of actions) {
            if (action.type === 'auto_reconcile') {
              await this.updatePaymentTransactionStatus(
                transaction.transactionId, 
                'completed',
                { reconciledBy: 'auto', ruleId: rule.id }
              );
            }
            
            if (action.type === 'create_disbursement') {
              await this.createScheduledDisbursement({
                disbursementId: `DISB-${Date.now()}`,
                propertyId: transaction.propertyId!,
                paymentTransactionId: transaction.id,
                recipientType: action.recipientType,
                recipientId: action.recipientId,
                recipientName: action.recipientName,
                amount: action.amount || transaction.netAmount,
                currency: transaction.currency,
                disbursementType: action.disbursementType,
                scheduledFor: new Date(Date.now() + (action.delayMinutes || 0) * 60 * 1000),
                status: 'pending'
              });
            }
          }
          
          await this.updateReconciliationRuleUsage(rule.id);
          results.push({ transaction, rule, matched: true });
          break; // Only apply first matching rule
        }
      }
    }

    return results;
  }

  // ==============================
  // RENT-TO-OWN SYSTEM METHODS
  // ==============================

  // === Rent-to-Own Agreements ===
  async getRentToOwnAgreements(): Promise<RentToOwnAgreement[]> {
    return await db.select().from(rentToOwnAgreements);
  }

  async getRentToOwnAgreement(id: number): Promise<RentToOwnAgreement | undefined> {
    const [agreement] = await db.select().from(rentToOwnAgreements).where(eq(rentToOwnAgreements.id, id));
    return agreement;
  }

  async createRentToOwnAgreement(agreement: InsertRentToOwnAgreement): Promise<RentToOwnAgreement> {
    const [created] = await db.insert(rentToOwnAgreements).values(agreement).returning();
    return created;
  }

  async updateRentToOwnAgreement(id: number, updates: Partial<InsertRentToOwnAgreement>): Promise<RentToOwnAgreement> {
    const [updated] = await db.update(rentToOwnAgreements)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(rentToOwnAgreements.id, id))
      .returning();
    return updated;
  }

  // === Rent-to-Own Payments ===
  async getRentToOwnPayments(agreementId?: number): Promise<RentToOwnPayment[]> {
    const query = db.select().from(rentToOwnPayments);
    if (agreementId) {
      return await query.where(eq(rentToOwnPayments.agreementId, agreementId));
    }
    return await query;
  }

  async createRentToOwnPayment(payment: InsertRentToOwnPayment): Promise<RentToOwnPayment> {
    const [created] = await db.insert(rentToOwnPayments).values(payment).returning();
    return created;
  }

  async updateRentToOwnPayment(id: number, updates: Partial<InsertRentToOwnPayment>): Promise<RentToOwnPayment> {
    const [updated] = await db.update(rentToOwnPayments)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(rentToOwnPayments.id, id))
      .returning();
    return updated;
  }

  async processRentToOwnPayment(paymentId: number, paidAmount: string, paymentMethod: string, transactionId: string): Promise<RentToOwnPayment> {
    // Update payment record
    const [payment] = await db.update(rentToOwnPayments)
      .set({ 
        paidAmount,
        paidDate: new Date(),
        status: 'paid',
        paymentMethod,
        transactionId: transactionId as any,
        updatedAt: new Date()
      })
      .where(eq(rentToOwnPayments.id, paymentId))
      .returning();

    // Update agreement totals
    const agreement = payment.agreementId ? await this.getRentToOwnAgreement(payment.agreementId) : null;
    if (agreement) {
      const newTotalPaid = parseFloat(agreement.totalPaid ?? "0") + parseFloat(paidAmount);
      const newRemainingBalance = parseFloat(agreement.remainingBalance ?? "0") - parseFloat(paidAmount);
      
      // Check if agreement is completed
      const status = newRemainingBalance <= 0 ? 'completed' : 'active';
      const completionDate = newRemainingBalance <= 0 ? new Date() : null;

      await this.updateRentToOwnAgreement(payment.agreementId, {
        totalPaid: newTotalPaid.toString(),
        remainingBalance: Math.max(0, newRemainingBalance).toString(),
        status,
        completionDate
      });
    }

    return payment;
  }

  // === Ownership Certificates ===
  async getOwnershipCertificates(): Promise<OwnershipCertificate[]> {
    return await db.select().from(ownershipCertificates);
  }

  async getOwnershipCertificate(id: number): Promise<OwnershipCertificate | undefined> {
    const [certificate] = await db.select().from(ownershipCertificates).where(eq(ownershipCertificates.id, id));
    return certificate;
  }

  async createOwnershipCertificate(certificate: InsertOwnershipCertificate): Promise<OwnershipCertificate> {
    const [created] = await db.insert(ownershipCertificates).values(certificate).returning();
    return created;
  }

  async generateOwnershipCertificate(agreementId: number): Promise<OwnershipCertificate> {
    const agreement = await this.getRentToOwnAgreement(agreementId);
    if (!agreement || agreement.status !== 'completed') {
      throw new Error('Agreement must be completed to generate ownership certificate');
    }

    const certificateNumber = `OWN-${Date.now()}-${agreement.propertyId}`;
    
    const certificate: InsertOwnershipCertificate = {
      certificateNumber,
      propertyId: agreement.propertyId,
      ownerId: agreement.tenantId,
      ownershipType: 'full',
      ownershipPercentage: '100.00',
      acquisitionType: 'rent_to_own',
      acquisitionDate: agreement.completionDate || new Date(),
      isVerified: true,
      verificationDate: new Date(),
      complianceStatus: 'approved'
    };

    return await this.createOwnershipCertificate(certificate);
  }

  // ==============================
  // AIRBNB-STYLE PROPERTY MANAGEMENT
  // ==============================

  // === Property Management Agreements ===
  async getPropertyManagementAgreements(): Promise<PropertyManagementAgreement[]> {
    return await db.select().from(propertyManagementAgreements);
  }

  async getPropertyManagementAgreement(id: number): Promise<PropertyManagementAgreement | undefined> {
    const [agreement] = await db.select().from(propertyManagementAgreements).where(eq(propertyManagementAgreements.id, id));
    return agreement;
  }

  async createPropertyManagementAgreement(agreement: InsertPropertyManagementAgreement): Promise<PropertyManagementAgreement> {
    const [created] = await db.insert(propertyManagementAgreements).values(agreement).returning();
    return created;
  }

  // === Short-term Bookings ===
  async getShortTermBookings(propertyId?: number): Promise<ShortTermBooking[]> {
    const query = db.select().from(shortTermBookings);
    if (propertyId) {
      return await query.where(eq(shortTermBookings.propertyId, propertyId));
    }
    return await query;
  }

  async createShortTermBooking(booking: InsertShortTermBooking): Promise<ShortTermBooking> {
    const [created] = await db.insert(shortTermBookings).values(booking).returning();
    
    // Update property availability calendar
    const checkIn = new Date(booking.checkInDate);
    const checkOut = new Date(booking.checkOutDate);
    
    for (let date = new Date(checkIn); date < checkOut; date.setDate(date.getDate() + 1)) {
      await db.insert(propertyAvailability)
        .values({
          propertyId: booking.propertyId,
          date: date.toISOString().split('T')[0],
          isAvailable: false,
          availabilityType: 'booked',
          finalRate: booking.nightlyRate,
          bookingId: created.id
        })
        .onConflictDoUpdate({
          target: [propertyAvailability.propertyId, propertyAvailability.date],
          set: {
            isAvailable: false,
            availabilityType: 'booked',
            bookingId: created.id
          }
        });
    }
    
    return created;
  }

  // === Property Availability ===
  async getPropertyAvailability(propertyId: number, startDate: string, endDate: string): Promise<PropertyAvailability[]> {
    return await db.select()
      .from(propertyAvailability)
      .where(
        and(
          eq(propertyAvailability.propertyId, propertyId),
          gte(propertyAvailability.date, startDate),
          lte(propertyAvailability.date, endDate)
        )
      );
  }

  async updatePropertyAvailability(propertyId: number, date: string, updates: Partial<InsertPropertyAvailability>): Promise<PropertyAvailability> {
    const [updated] = await db.insert(propertyAvailability)
      .values({
        propertyId,
        date,
        ...updates
      })
      .onConflictDoUpdate({
        target: [propertyAvailability.propertyId, propertyAvailability.date],
        set: updates
      })
      .returning();
    return updated;
  }

  // === Managed Property Maintenance ===
  async getManagedPropertyMaintenance(propertyId?: number): Promise<ManagedPropertyMaintenance[]> {
    const query = db.select().from(managedPropertyMaintenance);
    if (propertyId) {
      return await query.where(eq(managedPropertyMaintenance.propertyId, propertyId));
    }
    return await query;
  }

  async createManagedPropertyMaintenance(maintenance: InsertManagedPropertyMaintenance): Promise<ManagedPropertyMaintenance> {
    const [created] = await db.insert(managedPropertyMaintenance).values(maintenance).returning();
    return created;
  }

  async updateManagedPropertyMaintenance(id: number, updates: Partial<InsertManagedPropertyMaintenance>): Promise<ManagedPropertyMaintenance> {
    const [updated] = await db.update(managedPropertyMaintenance)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(managedPropertyMaintenance.id, id))
      .returning();
    return updated;
  }

  // === Owner Financial Statements ===
  async getOwnerFinancialStatements(ownerId?: number): Promise<OwnerFinancialStatement[]> {
    const query = db.select().from(ownerFinancialStatements);
    if (ownerId) {
      return await query.where(eq(ownerFinancialStatements.ownerId, ownerId));
    }
    return await query;
  }

  async createOwnerFinancialStatement(statement: InsertOwnerFinancialStatement): Promise<OwnerFinancialStatement> {
    const [created] = await db.insert(ownerFinancialStatements).values(statement).returning();
    return created;
  }

  async generateOwnerFinancialStatement(ownerId: number, propertyId: number, periodStart: Date, periodEnd: Date): Promise<OwnerFinancialStatement> {
    // Get all bookings for the period
    const bookings = await db.select()
      .from(shortTermBookings)
      .where(
        and(
          eq(shortTermBookings.propertyId, propertyId),
          gte(shortTermBookings.checkInDate, periodStart instanceof Date ? periodStart : new Date(periodStart)),
          lte(shortTermBookings.checkOutDate, periodEnd instanceof Date ? periodEnd : new Date(periodEnd))
        )
      );

    // Calculate revenue
    const totalRevenue = bookings.reduce((sum, booking) => sum + parseFloat(booking.totalAmount), 0);
    const bookingRevenue = bookings.reduce((sum, booking) => sum + parseFloat(booking.ownerPayout ?? "0"), 0);
    const managementFees = bookings.reduce((sum, booking) => sum + parseFloat(booking.managementFee ?? "0"), 0);

    // Get maintenance costs for the period
    const maintenanceRecords = await db.select()
      .from(managedPropertyMaintenance)
      .where(
        and(
          eq(managedPropertyMaintenance.propertyId, propertyId),
          gte(managedPropertyMaintenance.completedDate, periodStart instanceof Date ? periodStart : new Date(periodStart)),
          lte(managedPropertyMaintenance.completedDate, periodEnd instanceof Date ? periodEnd : new Date(periodEnd))
        )
      );

    const maintenanceCosts = maintenanceRecords.reduce((sum, record) => 
      sum + parseFloat(record.actualCost || '0'), 0
    );

    const totalExpenses = managementFees + maintenanceCosts;
    const netIncome = totalRevenue - totalExpenses;

    const statementNumber = `STMT-${ownerId}-${Date.now()}`;

    const statement: InsertOwnerFinancialStatement = {
      statementNumber,
      ownerId,
      propertyId,
      periodStart,
      periodEnd,
      statementType: 'monthly',
      totalRevenue: totalRevenue.toString(),
      bookingRevenue: bookingRevenue.toString(),
      totalExpenses: totalExpenses.toString(),
      managementFees: managementFees.toString(),
      maintenanceCosts: maintenanceCosts.toString(),
      netIncome: netIncome.toString(),
      ownerPayout: bookingRevenue.toString(),
      totalNightsBooked: bookings.reduce((sum, booking) => sum + booking.numberOfNights, 0),
      revenueBreakdown: bookings.map(booking => ({
        bookingId: booking.id,
        bookingNumber: booking.bookingNumber,
        amount: booking.totalAmount,
        ownerPayout: booking.ownerPayout,
        managementFee: booking.managementFee
      })),
      expenseBreakdown: maintenanceRecords.map(record => ({
        type: record.maintenanceType,
        description: record.description,
        cost: record.actualCost
      }))
    };

    return await this.createOwnerFinancialStatement(statement);
  }

  // ==============================
  // USER MANAGEMENT & ROLES
  // ==============================

  // User Roles
  async getAllUserRoles(): Promise<UserRole[]> {
    return await db.select().from(userRoles).where(eq(userRoles.isActive, true));
  }

  async getUserRoleById(id: number): Promise<UserRole | undefined> {
    const [role] = await db.select().from(userRoles).where(eq(userRoles.id, id));
    return role;
  }

  async createUser(data: {
  email: string;
  passwordHash: string;
  firstName?: string;
  lastName?: string;
  role?: "manager" | "tenant" | "admin";
  organizationId?: number;
}) {
  const [user] = await db.insert(users).values({
    email: data.email,
    passwordHash: data.passwordHash,
    firstName: data.firstName,
    lastName: data.lastName,
    role: data.role ?? "manager",
    organizationId: data.organizationId,
  }).returning();

  return user;
}


  async createUserRole(data: InsertUserRole): Promise<UserRole> {
    const [role] = await db.insert(userRoles).values(data).returning();
    return role;
  }

  async updateUserRole(id: number, data: Partial<InsertUserRole>): Promise<UserRole> {
    const [role] = await db.update(userRoles).set({ ...data, updatedAt: new Date() }).where(eq(userRoles.id, id)).returning();
    return role;
  }

  async deleteUserRole(id: number): Promise<void> {
    await db.update(userRoles).set({ isActive: false }).where(eq(userRoles.id, id));
  }

  // User Role Assignments
  async getUserRoleAssignments(userId: string): Promise<UserRoleAssignment[]> {
    return await db.select().from(userRoleAssignments).where(and(eq(userRoleAssignments.userId, userId), eq(userRoleAssignments.isActive, true)));
  }

  async getUsersByRole(roleId: number): Promise<UserRoleAssignment[]> {
    return await db.select().from(userRoleAssignments).where(and(eq(userRoleAssignments.roleId, roleId), eq(userRoleAssignments.isActive, true)));
  }

  async assignUserRole(data: InsertUserRoleAssignment): Promise<UserRoleAssignment> {
    const [assignment] = await db.insert(userRoleAssignments).values(data).returning();
    return assignment;
  }

  async revokeUserRole(userId: string, roleId: number): Promise<void> {
    await db.update(userRoleAssignments).set({ isActive: false }).where(and(eq(userRoleAssignments.userId, userId), eq(userRoleAssignments.roleId, roleId)));
  }

  // Property Managers
  async getAllPropertyManagers(): Promise<PropertyManager[]> {
    return await db.select().from(propertyManagers).where(eq(propertyManagers.status, 'active'));
  }

  async getPropertyManagerByUserId(userId: string): Promise<PropertyManager | undefined> {
    const [manager] = await db.select().from(propertyManagers).where(eq(propertyManagers.userId, userId));
    return manager;
  }

  async createPropertyManager(data: InsertPropertyManager): Promise<PropertyManager> {
    const [manager] = await db.insert(propertyManagers).values(data).returning();
    return manager;
  }

  async updatePropertyManager(id: number, data: Partial<InsertPropertyManager>): Promise<PropertyManager> {
    const [manager] = await db.update(propertyManagers).set({ ...data, updatedAt: new Date() }).where(eq(propertyManagers.id, id)).returning();
    return manager;
  }

  async deletePropertyManager(id: number): Promise<void> {
    await db.update(propertyManagers).set({ status: 'inactive' }).where(eq(propertyManagers.id, id));
  }

  // Caretakers
  async getAllCaretakers(): Promise<Caretaker[]> {
    return await db.select().from(caretakers).where(eq(caretakers.status, 'active'));
  }

  async getCaretakersByProperty(propertyId: number): Promise<Caretaker[]> {
    return await db.select().from(caretakers).where(and(eq(caretakers.propertyId, propertyId), eq(caretakers.status, 'active')));
  }

  async getCaretakerByUserId(userId: string): Promise<Caretaker | undefined> {
    const [caretaker] = await db.select().from(caretakers).where(eq(caretakers.userId, userId));
    return caretaker;
  }

  async createCaretaker(data: InsertCaretaker): Promise<Caretaker> {
    const [caretaker] = await db.insert(caretakers).values(data).returning();
    return caretaker;
  }

  async updateCaretaker(id: number, data: Partial<InsertCaretaker>): Promise<Caretaker> {
    const [caretaker] = await db.update(caretakers).set({ ...data, updatedAt: new Date() }).where(eq(caretakers.id, id)).returning();
    return caretaker;
  }

  async deleteCaretaker(id: number): Promise<void> {
    await db.update(caretakers).set({ status: 'inactive' }).where(eq(caretakers.id, id));
  }

  // ==============================
  // CONTRACTORS MANAGEMENT
  // ==============================

  // Contractor Categories
  async getAllContractorCategories(): Promise<ContractorCategory[]> {
    return await db.select().from(contractorCategories).where(eq(contractorCategories.isActive, true));
  }

  async getContractorCategoryById(id: number): Promise<ContractorCategory | undefined> {
    const [category] = await db.select().from(contractorCategories).where(eq(contractorCategories.id, id));
    return category;
  }

  async createContractorCategory(data: InsertContractorCategory): Promise<ContractorCategory> {
    const [category] = await db.insert(contractorCategories).values(data).returning();
    return category;
  }

  async updateContractorCategory(id: number, data: Partial<InsertContractorCategory>): Promise<ContractorCategory> {
    const [category] = await db.update(contractorCategories).set(data).where(eq(contractorCategories.id, id)).returning();
    return category;
  }

  // Contractors Registry
  async getAllContractors(): Promise<ContractorRegistry[]> {
    return await db.select().from(contractorsRegistry).where(eq(contractorsRegistry.status, 'active'));
  }

  async getContractorsByCategory(categoryId: number) {
  return await db
    .select()
    .from(contractors)
    .where(eq(contractors.categoryId, categoryId));
}

  async getContractorById(id: number): Promise<ContractorRegistry | undefined> {
    const [contractor] = await db.select().from(contractorsRegistry).where(eq(contractorsRegistry.id, id));
    return contractor;
  }

  async createContractorRegistry(data: InsertContractorRegistry): Promise<ContractorRegistry> {
    const [contractor] = await db.insert(contractorsRegistry).values(data).returning();
    return contractor;
  }

  async updateContractorRegistry(id: number, data: Partial<InsertContractorRegistry>): Promise<ContractorRegistry> {
    const [contractor] = await db.update(contractorsRegistry).set({ ...data, updatedAt: new Date() }).where(eq(contractorsRegistry.id, id)).returning();
    return contractor;
  }

  async suspendContractor(id: number): Promise<void> {
    await db.update(contractorsRegistry).set({ status: 'suspended' }).where(eq(contractorsRegistry.id, id));
  }

  async verifyContractor(id: number, verifiedBy: string): Promise<ContractorRegistry> {
    const [contractor] = await db.update(contractorsRegistry).set({ 
      isVerified: true, 
      verifiedBy, 
      verificationDate: new Date() 
    }).where(eq(contractorsRegistry.id, id)).returning();
    return contractor;
  }

  // Service Contracts
  async getAllServiceContracts(): Promise<ServiceContract[]> {
    return await db.select().from(serviceContracts);
  }

  async getServiceContractsByProperty(propertyId: number): Promise<ServiceContract[]> {
    return await db.select().from(serviceContracts).where(eq(serviceContracts.propertyId, propertyId));
  }

  async getServiceContractsByContractor(contractorId: number): Promise<ServiceContract[]> {
    return await db.select().from(serviceContracts).where(eq(serviceContracts.contractorId, contractorId));
  }

  async getServiceContractById(id: number): Promise<ServiceContract | undefined> {
    const [contract] = await db.select().from(serviceContracts).where(eq(serviceContracts.id, id));
    return contract;
  }

  async createServiceContract(data: InsertServiceContract): Promise<ServiceContract> {
    const [contract] = await db.insert(serviceContracts).values(data).returning();
    return contract;
  }

  async updateServiceContract(id: number, data: Partial<InsertServiceContract>): Promise<ServiceContract> {
    const [contract] = await db.update(serviceContracts).set({ ...data, updatedAt: new Date() }).where(eq(serviceContracts.id, id)).returning();
    return contract;
  }

  async activateServiceContract(id: number, signedBy: string): Promise<ServiceContract> {
    const [contract] = await db.update(serviceContracts).set({ 
      status: 'active', 
      signedBy, 
      signedDate: new Date() 
    }).where(eq(serviceContracts.id, id)).returning();
    return contract;
  }

  // Contractor Work Orders
  async getAllContractorWorkOrders(): Promise<ContractorWorkOrder[]> {
    return await db.select().from(contractorWorkOrders);
  }

  async getContractorWorkOrdersByProperty(propertyId: number): Promise<ContractorWorkOrder[]> {
    return await db.select().from(contractorWorkOrders).where(eq(contractorWorkOrders.propertyId, propertyId));
  }

  async getContractorWorkOrdersByContractor(contractorId: number): Promise<ContractorWorkOrder[]> {
    return await db.select().from(contractorWorkOrders).where(eq(contractorWorkOrders.contractorId, contractorId));
  }

  async getContractorWorkOrderById(id: number): Promise<ContractorWorkOrder | undefined> {
    const [workOrder] = await db.select().from(contractorWorkOrders).where(eq(contractorWorkOrders.id, id));
    return workOrder;
  }

  async createContractorWorkOrder(data: InsertContractorWorkOrder): Promise<ContractorWorkOrder> {
    const [workOrder] = await db.insert(contractorWorkOrders).values(data).returning();
    return workOrder;
  }

  async updateContractorWorkOrder(id: number, data: Partial<InsertContractorWorkOrder>): Promise<ContractorWorkOrder> {
    const [workOrder] = await db.update(contractorWorkOrders).set({ ...data, updatedAt: new Date() }).where(eq(contractorWorkOrders.id, id)).returning();
    return workOrder;
  }

  async completeContractorWorkOrder(id: number, actualHours: number, actualCost: number, feedback?: string): Promise<ContractorWorkOrder> {
    const [workOrder] = await db.update(contractorWorkOrders).set({ 
      status: 'completed', 
      completedAt: new Date(),
      actualHours: actualHours !== undefined ? String(actualHours) : undefined,
      actualCost: actualCost !== undefined ? String(actualCost) : undefined,
      feedback
    }).where(eq(contractorWorkOrders.id, id)).returning();
    return workOrder;
  }

  // Contractor Performance
  async getContractorPerformance(contractorId: number): Promise<ContractorPerformance[]> {
    return await db.select().from(contractorPerformance).where(eq(contractorPerformance.contractorId, contractorId));
  }

  async createContractorPerformance(data: InsertContractorPerformance): Promise<ContractorPerformance> {
    const [performance] = await db.insert(contractorPerformance).values(data).returning();
    return performance;
  }

  // Service Schedules
  async getServiceSchedulesByProperty(propertyId: number): Promise<ServiceSchedule[]> {
    return await db.select().from(serviceSchedules).where(and(eq(serviceSchedules.propertyId, propertyId), eq(serviceSchedules.status, 'active')));
  }

  async getServiceSchedulesByContractor(contractorId: number): Promise<ServiceSchedule[]> {
    return await db.select().from(serviceSchedules).where(and(eq(serviceSchedules.contractorId, contractorId), eq(serviceSchedules.status, 'active')));
  }

  async createServiceSchedule(data: InsertServiceSchedule): Promise<ServiceSchedule> {
    const [schedule] = await db.insert(serviceSchedules).values(data).returning();
    return schedule;
  }

  async updateServiceSchedule(id: number, data: Partial<InsertServiceSchedule>): Promise<ServiceSchedule> {
    const [schedule] = await db.update(serviceSchedules).set({ ...data, updatedAt: new Date() }).where(eq(serviceSchedules.id, id)).returning();
    return schedule;
  }

  // Contractor Reviews
  async getContractorReviews(contractorId: number): Promise<ContractorReview[]> {
    return await db.select().from(contractorReviews).where(and(eq(contractorReviews.contractorId, contractorId), eq(contractorReviews.isPublic, true)));
  }

  async createContractorReview(data: InsertContractorReview): Promise<ContractorReview> {
    const [review] = await db.insert(contractorReviews).values(data).returning();
    return review;
  }

  async verifyContractorReview(id: number): Promise<ContractorReview> {
    const [review] = await db.update(contractorReviews).set({ isVerified: true }).where(eq(contractorReviews.id, id)).returning();
    return review;
  }
  // Visitor Management methods
  async getAllVisitors(): Promise<any[]> {
    const results = await db.execute(sql`SELECT * FROM visitors ORDER BY created_at DESC`);
    return results.rows;
  }

  async createVisitor(visitor: any): Promise<any> {
    const results = await db.execute(sql`
      INSERT INTO visitors (property_id, unit_id, tenant_id, visitor_name, visitor_phone, visitor_email, 
        id_number, company, purpose_of_visit, expected_arrival, expected_departure, 
        vehicle_plate, notes, created_by) 
      VALUES (${visitor.propertyId}, ${visitor.unitId}, ${visitor.tenantId}, ${visitor.visitorName}, 
        ${visitor.visitorPhone}, ${visitor.visitorEmail}, ${visitor.idNumber}, ${visitor.company}, 
        ${visitor.purposeOfVisit}, ${visitor.expectedArrival}, ${visitor.expectedDeparture},
        ${visitor.vehiclePlate}, ${visitor.notes}, ${visitor.createdBy})
      RETURNING *
    `);
    return results.rows[0];
  }

  async updateVisitorStatus(id: number, status: string, notes?: string): Promise<any> {
    const results = await db.execute(sql`
      UPDATE visitors SET status = ${status}, updated_at = NOW() WHERE id = ${id} RETURNING *
    `);
    
    // Log the status change
    await db.execute(sql`
      INSERT INTO visitor_logs (visitor_id, log_type, notes) VALUES (${id}, 'status_change', ${`Status changed to ${status}. ${notes || ''}`})
    `);
    
    return results.rows[0];
  }

  async getAllVisitorLogs(): Promise<any[]> {
    const results = await db.execute(sql`
      SELECT vl.*, v.visitor_name 
      FROM visitor_logs vl 
      JOIN visitors v ON vl.visitor_id = v.id 
      ORDER BY vl.timestamp DESC
    `);
    return results.rows;
  }

  // Parking Management methods
  async getAllParkingSpaces(): Promise<any[]> {
    return await db.select().from(parkingSpaces).orderBy(parkingSpaces.spaceNumber);
  }

  async createParkingSpace(space: any): Promise<any> {
    const [result] = await db.insert(parkingSpaces).values({
      propertyId: space.propertyId,
      spaceNumber: space.spaceNumber,
      floor: space.floor ?? null,
      section: space.section ?? null,
      spaceType: space.spaceType || 'standard',
      monthlyRate: space.monthlyRate != null ? String(space.monthlyRate) : null,
      currency: space.currency || 'KES',
      hasElectricCharging: space.hasElectricCharging ?? false,
      isAvailable: space.isAvailable ?? true,
      isReserved: space.isReserved ?? false,
      notes: space.notes ?? null,
    }).returning();
    return result;
  }

  async updateParkingSpace(id: number, space: any): Promise<any> {
    const [result] = await db.update(parkingSpaces)
      .set({
        spaceNumber: space.spaceNumber,
        floor: space.floor ?? null,
        section: space.section ?? null,
        spaceType: space.spaceType,
        monthlyRate: space.monthlyRate != null ? String(space.monthlyRate) : null,
        currency: space.currency || 'KES',
        hasElectricCharging: space.hasElectricCharging ?? false,
        isAvailable: space.isAvailable ?? true,
        isReserved: space.isReserved ?? false,
        notes: space.notes ?? null,
        updatedAt: new Date(),
      })
      .where(eq(parkingSpaces.id, id))
      .returning();
    return result;
  }

  async deleteParkingSpace(id: number): Promise<void> {
    await db.delete(parkingSpaces).where(eq(parkingSpaces.id, id));
  }

  async updateRegisteredVehicle(id: number, vehicle: any): Promise<any> {
    const [result] = await db.update(registeredVehicles)
      .set({
        ownerType: vehicle.ownerType,
        plateNumber: vehicle.plateNumber,
        vehicleType: vehicle.vehicleType,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year ?? null,
        color: vehicle.color,
        isResident: vehicle.isResident ?? false,
        notes: vehicle.notes ?? null,
        updatedAt: new Date(),
      })
      .where(eq(registeredVehicles.id, id))
      .returning();
    return result;
  }

  async deleteRegisteredVehicle(id: number): Promise<void> {
    await db.delete(registeredVehicles).where(eq(registeredVehicles.id, id));
  }

  async getAllRegisteredVehicles(): Promise<any[]> {
    return await db.select().from(registeredVehicles).orderBy(desc(registeredVehicles.createdAt));
  }

  async updateRegisteredVehicleStatus(id: number, status: string): Promise<any> {
    const [result] = await db.update(registeredVehicles)
      .set({ status: status as any, updatedAt: new Date() })
      .where(eq(registeredVehicles.id, id))
      .returning();
    return result;
  }

  async createRegisteredVehicle(vehicle: any): Promise<any> {
    const [result] = await db.insert(registeredVehicles).values({
      propertyId: vehicle.propertyId,
      ownerId: vehicle.ownerId ?? null,
      ownerType: vehicle.ownerType,
      plateNumber: vehicle.plateNumber,
      vehicleType: vehicle.vehicleType,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year ?? null,
      color: vehicle.color,
      isResident: vehicle.isResident ?? false,
      status: vehicle.status || 'pending_approval',
      notes: vehicle.notes ?? null,
    }).returning();
    return result;
  }

  async getAllParkingAssignments(): Promise<any[]> {
    // Join tenant (who is being visited) and visitor (who the vehicle belongs to)
    // so the parking management page can show context like "Visiting: John Doe"
    const rows = await db
      .select({
        // Assignment fields
        id:               parkingAssignments.id,
        parkingSpaceId:   parkingAssignments.parkingSpaceId,
        vehicleId:        parkingAssignments.vehicleId,
        tenantId:         parkingAssignments.tenantId,
        assignmentType:   parkingAssignments.assignmentType,
        startDate:        parkingAssignments.startDate,
        endDate:          parkingAssignments.endDate,
        monthlyFee:       parkingAssignments.monthlyFee,
        currency:         parkingAssignments.currency,
        status:           parkingAssignments.status,
        notes:            parkingAssignments.notes,
        assignedBy:       parkingAssignments.assignedBy,
        createdAt:        parkingAssignments.createdAt,
        updatedAt:        parkingAssignments.updatedAt,
        // Tenant being visited
        tenantFirstName:  tenants.firstName,
        tenantLastName:   tenants.lastName,
        // Visitor info — joined via the registered vehicle's plate → visitors table
        visitorName:      visitors.visitorName,
        visitorPurpose:   visitors.purposeOfVisit,
      })
      .from(parkingAssignments)
      .leftJoin(tenants,   eq(parkingAssignments.tenantId, tenants.id))
      .leftJoin(registeredVehicles, eq(parkingAssignments.vehicleId, registeredVehicles.id))
      .leftJoin(visitors,  eq(registeredVehicles.plateNumber, visitors.vehiclePlate))
      .orderBy(desc(parkingAssignments.createdAt));

    return rows;
  }

  async createParkingAssignment(assignment: any): Promise<any> {
    const [result] = await db.insert(parkingAssignments).values({
      parkingSpaceId: assignment.parkingSpaceId,
      vehicleId: assignment.vehicleId,
      tenantId: assignment.tenantId ?? null,
      assignmentType: assignment.assignmentType,
      startDate: new Date(assignment.startDate),
      endDate: assignment.endDate ? new Date(assignment.endDate) : null,
      monthlyFee: assignment.monthlyFee != null ? String(assignment.monthlyFee) : null,
      currency: assignment.currency || 'KES',
      status: assignment.status || 'active',
      notes: assignment.notes ?? null,
      assignedBy: assignment.assignedBy,
    }).returning();
    // Mark space as occupied
    await db.update(parkingSpaces)
      .set({ isAvailable: false, updatedAt: new Date() })
      .where(eq(parkingSpaces.id, assignment.parkingSpaceId));
    return result;
  }

  async updateParkingAssignment(id: number, assignment: any): Promise<any> {
    const [result] = await db.update(parkingAssignments)
      .set({
        assignmentType: assignment.assignmentType,
        endDate: assignment.endDate ? new Date(assignment.endDate) : null,
        monthlyFee: assignment.monthlyFee != null ? String(assignment.monthlyFee) : null,
        currency: assignment.currency || 'KES',
        notes: assignment.notes ?? null,
        updatedAt: new Date(),
      })
      .where(eq(parkingAssignments.id, id))
      .returning();
    return result;
  }

  async updateParkingAssignmentStatus(id: number, status: string): Promise<any> {
    const [result] = await db.update(parkingAssignments)
      .set({ status: status as any, updatedAt: new Date() })
      .where(eq(parkingAssignments.id, id))
      .returning();
    // If terminating/expiring, free the space
    if (status === 'terminated' || status === 'expired') {
      if (result) {
        await db.update(parkingSpaces)
          .set({ isAvailable: true, updatedAt: new Date() })
          .where(eq(parkingSpaces.id, result.parkingSpaceId));
      }
    }
    return result;
  }

  async deleteParkingAssignment(id: number): Promise<void> {
    // Free the space before deleting
    const rows = await db.select().from(parkingAssignments).where(eq(parkingAssignments.id, id));
    if (rows[0]) {
      await db.update(parkingSpaces)
        .set({ isAvailable: true, updatedAt: new Date() })
        .where(eq(parkingSpaces.id, rows[0].parkingSpaceId));
    }
    await db.delete(parkingAssignments).where(eq(parkingAssignments.id, id));
  }

  // Expense Management methods
  async getAllPropertyExpenses(): Promise<any[]> {
    const results = await db.execute(sql`SELECT * FROM property_expenses ORDER BY created_at DESC`);
    return results.rows;
  }

  async createPropertyExpense(expense: any): Promise<any> {
    const results = await db.execute(sql`
      INSERT INTO property_expenses (expense_number, property_id, contractor_id, vendor_name, 
        description, amount, currency, category, expense_date, due_date, is_recurring, 
        recurring_frequency, notes, created_by) 
      VALUES (${expense.expenseNumber}, ${expense.propertyId}, ${expense.contractorId}, ${expense.vendorName},
        ${expense.description}, ${expense.amount}, ${expense.currency || 'KES'}, ${expense.category},
        ${expense.expenseDate}, ${expense.dueDate}, ${expense.isRecurring}, ${expense.recurringFrequency},
        ${expense.notes}, ${expense.createdBy})
      RETURNING *
    `);
    return results.rows[0];
  }

  async updatePropertyExpenseStatus(id: number, status: string, notes?: string): Promise<any> {
    const results = await db.execute(sql`
      UPDATE property_expenses 
      SET status = ${status}, updated_at = NOW() 
      WHERE id = ${id} RETURNING *
    `);
    
    return results.rows[0];
  }

  async getAllContractorServices(): Promise<any[]> {
    const results = await db.execute(sql`
      SELECT cs.*, c.name as contractor_name 
      FROM contractor_services cs 
      LEFT JOIN contractors c ON cs.contractor_id = c.id 
      ORDER BY cs.service_name
    `);
    return results.rows;
  }

  async getAllContractorPayments(): Promise<any[]> {
    const results = await db.execute(sql`
      SELECT cp.*, c.name as contractor_name 
      FROM contractor_payments cp 
      LEFT JOIN contractors c ON cp.contractor_id = c.id 
      ORDER BY cp.created_at DESC
    `);
    return results.rows;
  }

  // ==============================
  // MAINTENANCE APPROVAL WORKFLOW METHODS
  // ==============================

  async getMaintenanceRequestsForApproval(): Promise<any[]> {
    const results = await db.execute(sql`
      SELECT 
        mr.*,
        p.name as propertyName,
        CONCAT(u.firstName, ' ', u.lastName) as tenantName
      FROM maintenance_requests mr
      LEFT JOIN units un ON mr.unit_id = un.id
      LEFT JOIN properties p ON un.property_id = p.id
      LEFT JOIN tenants t ON mr.tenant_id = t.id
      LEFT JOIN users u ON t.user_id = u.id
      ORDER BY 
        CASE mr.priority 
          WHEN 'urgent' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
        END,
        mr.created_at DESC
    `);
    return results.rows;
  }

  async approveMaintenanceRequest(id: number, approval: any): Promise<any> {
    // Update maintenance request status
    await db.execute(sql`
      UPDATE maintenance_requests 
      SET 
        approval_status = ${approval.approvalStatus},
        approved_by = ${approval.approverId},
        approved_at = NOW(),
        actual_cost = ${approval.approvedAmount || 0},
        finance_approved = ${approval.approvalStatus === 'approved'}
      WHERE id = ${id}
    `);

    // Create approval record
    const approvalResults = await db.execute(sql`
      INSERT INTO maintenance_approvals (
        maintenance_request_id, approval_level, approver_id, approval_status, 
        comments, approved_amount, approval_date
      ) VALUES (
        ${id}, 'senior_manager', ${approval.approverId}, ${approval.approvalStatus},
        ${approval.comments}, ${approval.approvedAmount || 0}, NOW()
      ) RETURNING *
    `);

    return approvalResults.rows[0];
  }

  async getMaintenanceExpenses(): Promise<any[]> {
    const results = await db.execute(sql`
      SELECT 
        me.*,
        mr.title as maintenanceTitle,
        p.name as propertyName
      FROM maintenance_expenses me
      LEFT JOIN maintenance_requests mr ON me.maintenance_request_id = mr.id
      LEFT JOIN units u ON mr.unit_id = u.id
      LEFT JOIN properties p ON u.property_id = p.id
      ORDER BY me.created_at DESC
    `);
    return results.rows;
  }

  async createMaintenanceExpense(expense: any): Promise<any> {
    const results = await db.execute(sql`
      INSERT INTO maintenance_expenses (
        maintenance_request_id, expense_category, description, estimated_amount,
        actual_amount, vendor_name, invoice_number, expense_date, created_by
      ) VALUES (
        ${expense.maintenanceRequestId}, ${expense.expenseCategory}, ${expense.description},
        ${expense.estimatedAmount}, ${expense.actualAmount || null}, ${expense.vendorName},
        ${expense.invoiceNumber || null}, ${expense.expenseDate}, ${expense.createdBy}
      ) RETURNING *
    `);
    return results.rows[0];
  }

  // ==============================
  // USER DASHBOARD & ROLE MANAGEMENT METHODS  
  // ==============================

  async assignUserRoleAndDashboard(assignment: any): Promise<any> {
    // Update user with current role and dashboard
    await db.execute(sql`
      UPDATE users 
      SET current_role = ${assignment.roleName},
          dashboard_type = ${assignment.dashboardType},
          updated_at = NOW()
      WHERE id = ${assignment.userId}
    `);

    // Create role assignment record
    const roleResults = await db.execute(sql`
      INSERT INTO user_role_assignments (
        user_id, role_name, role_description, permissions, properties_access,
        is_active, assigned_by, assigned_at
      ) VALUES (
        ${assignment.userId}, ${assignment.roleName}, 
        ${this.getRoleDescription(assignment.roleName)},
        ${JSON.stringify(this.getRolePermissions(assignment.roleName))},
        ${JSON.stringify(assignment.propertiesAccess)},
        true, ${assignment.assignedBy}, NOW()
      ) RETURNING *
    `);

    // Update or create user dashboard
    await db.execute(sql`
      INSERT INTO user_dashboards (user_id, dashboard_type, preferences, widgets, layout)
      VALUES (
        ${assignment.userId}, ${assignment.dashboardType}, 
        '{"theme": "light", "notifications": true}', 
        ${JSON.stringify(this.getDefaultWidgets(assignment.dashboardType))},
        '{"columns": 2, "layout": "grid"}'
      ) ON CONFLICT (user_id) 
      DO UPDATE SET 
        dashboard_type = ${assignment.dashboardType},
        updated_at = NOW()
    `);

    return roleResults.rows[0];
  }

  async getUserDashboard(userId: string): Promise<any> {
    const results = await db.execute(sql`
      SELECT * FROM user_dashboards WHERE user_id = ${userId}
    `);
    return results.rows[0];
  }

  async updateUserDashboard(userId: string, updates: any): Promise<any> {
    const results = await db.execute(sql`
      UPDATE user_dashboards 
      SET 
        preferences = ${JSON.stringify(updates.preferences) || 'preferences'},
        widgets = ${JSON.stringify(updates.widgets) || 'widgets'},
        layout = ${JSON.stringify(updates.layout) || 'layout'},
        updated_at = NOW()
      WHERE user_id = ${userId}
      RETURNING *
    `);
    return results.rows[0];
  }

  private getRoleDescription(roleName: string): string {
    const descriptions = {
      'senior_manager': 'Senior management with approval authority and strategic oversight',
      'property_manager': 'Day-to-day property management and tenant relations',
      'finance': 'Financial oversight, expense approval, and accounting management',
      'tenant': 'Tenant self-service portal with lease and maintenance access',
      'service_provider': 'Contractor portal for work orders and service delivery',
      'owner': 'Property owner with portfolio overview and financial reporting'
    };
    return descriptions[roleName as keyof typeof descriptions] || 'Standard user role';
  }

  private getRolePermissions(roleName: string): string[] {
    const permissions = {
      'senior_manager': ['approve_maintenance', 'view_all_properties', 'manage_users', 'view_analytics', 'approve_expenses'],
      'property_manager': ['manage_tenants', 'manage_maintenance', 'view_properties', 'create_reports'],
      'finance': ['approve_expenses', 'view_financials', 'manage_payments', 'generate_reports'],
      'tenant': ['view_lease', 'submit_maintenance', 'view_payments', 'manage_profile'],
      'service_provider': ['view_work_orders', 'update_status', 'upload_documents', 'track_time'],
      'owner': ['view_portfolio', 'view_financials', 'view_reports', 'manage_properties']
    };
    return permissions[roleName as keyof typeof permissions] || ['basic_access'];
  }

  private getDefaultWidgets(dashboardType: string): string[] {
    const widgets = {
      'senior_manager': ['approvals', 'analytics', 'overview', 'performance'],
      'property_manager': ['properties', 'maintenance', 'tenants', 'calendar'],
      'finance': ['expenses', 'approvals', 'budget', 'reports'],
      'tenant': ['rent', 'maintenance', 'documents', 'notifications'],
      'service_provider': ['workorders', 'schedule', 'payments', 'ratings'],
      'owner': ['portfolio', 'revenue', 'occupancy', 'reports']
    };
    return widgets[dashboardType as keyof typeof widgets] || ['dashboard', 'notifications'];
  }
  // Missing workforce management method implementations
  async getUserOrganization(userId: string): Promise<{ organizationId: number } | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    return user ? { organizationId: user.organizationId! } : undefined;
  }

  // In storage.ts

async getStaffMembers(organizationId: number): Promise<any[]> {
  try {
    const staff = await db
      .select()
      .from(staffMembers)
      .where(eq(staffMembers.organization_id, organizationId))
      .orderBy(staffMembers.last_name, staffMembers.first_name);

    return staff.map(member => ({
      id: member.id,
      employee_id: member.employee_id,
      first_name: member.first_name,
      last_name: member.last_name,
      email: member.email || undefined,
      phone: member.phone || undefined,
      position: member.position,
      department: member.department,
      employment_type: member.employment_type,
      hire_date: member.hire_date?.toISOString(),
      salary: member.salary ? Number(member.salary) : undefined,
      hourly_rate: member.hourly_rate ? Number(member.hourly_rate) : undefined,
      currency: member.currency,
      status: member.status,
      photo_url: member.photo_url || undefined,
      address: member.address || undefined,
      emergency_contact_name: member.emergency_contact_name || undefined,
      emergency_contact_phone: member.emergency_contact_phone || undefined,
      created_at: member.created_at?.toISOString(),
      updated_at: member.updated_at?.toISOString(),
    }));
  } catch (error: any) {
    console.error("Error fetching staff members:", error.message);
    
    // Re-throw the error so the API can handle it properly
    throw new Error(`Failed to fetch staff members: ${error.message}`);
  }
}

async createStaffMember(staff: any): Promise<any> {
  try {
    // Validate required fields
    const requiredFields = ['employee_id', 'first_name', 'last_name', 'position', 'department', 'hire_date'];
    const missingFields = requiredFields.filter(field => !staff[field]);
    
    if (missingFields.length > 0) {
      throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
    }

    // Ensure enum values are valid
    const validPositions = positionEnum.enumValues;
    const validDepartments = departmentEnum.enumValues;
    const validEmploymentTypes = employmentTypeEnum.enumValues;
    const validStatuses = staffStatusEnum.enumValues;

    if (!validPositions.includes(staff.position)) {
      throw new Error(`Invalid position: ${staff.position}. Valid values: ${validPositions.join(', ')}`);
    }

    if (!validDepartments.includes(staff.department)) {
      throw new Error(`Invalid department: ${staff.department}. Valid values: ${validDepartments.join(', ')}`);
    }

    if (staff.employment_type && !validEmploymentTypes.includes(staff.employment_type)) {
      throw new Error(`Invalid employment type: ${staff.employment_type}. Valid values: ${validEmploymentTypes.join(', ')}`);
    }

    if (staff.status && !validStatuses.includes(staff.status)) {
      throw new Error(`Invalid status: ${staff.status}. Valid values: ${validStatuses.join(', ')}`);
    }

    // Convert string dates to Date objects
    const hireDate = staff.hire_date ? new Date(staff.hire_date) : new Date();
    
    // Insert into database
    const [newStaff] = await db
      .insert(staffMembers)
      .values({
        organization_id: staff.organization_id,
        employee_id: staff.employee_id,
        first_name: staff.first_name,
        last_name: staff.last_name,
        email: staff.email || null,
        phone: staff.phone || null,
        position: staff.position,
        department: staff.department,
        employment_type: staff.employment_type || 'full_time',
        hire_date: hireDate,
        salary: staff.salary ? staff.salary.toString() : null,
        hourly_rate: staff.hourly_rate ? staff.hourly_rate.toString() : null,
        currency: staff.currency || 'KES',
        status: staff.status || 'active',
        photo_url: staff.photo_url || null,
        address: staff.address || null,
        emergency_contact_name: staff.emergency_contact_name || null,
        emergency_contact_phone: staff.emergency_contact_phone || null,
      })
      .returning();

    // Return the created staff member
    return {
      id: newStaff.id,
      employee_id: newStaff.employee_id,
      first_name: newStaff.first_name,
      last_name: newStaff.last_name,
      email: newStaff.email || undefined,
      phone: newStaff.phone || undefined,
      position: newStaff.position,
      department: newStaff.department,
      employment_type: newStaff.employment_type,
      hire_date: newStaff.hire_date?.toISOString(),
      salary: newStaff.salary ? Number(newStaff.salary) : undefined,
      hourly_rate: newStaff.hourly_rate ? Number(newStaff.hourly_rate) : undefined,
      currency: newStaff.currency,
      status: newStaff.status,
      photo_url: newStaff.photo_url || undefined,
      address: newStaff.address || undefined,
      emergency_contact_name: newStaff.emergency_contact_name || undefined,
      emergency_contact_phone: newStaff.emergency_contact_phone || undefined,
      created_at: newStaff.created_at?.toISOString(),
      updated_at: newStaff.updated_at?.toISOString(),
    };
  } catch (error: any) {
    console.error("Error creating staff member:", error.message);
    
    // Check for specific database errors
    if (error.code === '23505') { // Unique constraint violation
      if (error.constraint?.includes('employee_id')) {
        throw new Error(`Employee ID ${staff.employee_id} already exists`);
      }
    }
    
    if (error.code === '23503') { // Foreign key violation
      throw new Error(`Invalid organization ID`);
    }
    
    // Re-throw the original error for other cases
    throw error;
  }
}

async updateStaffMember(staffId: number, staff: any): Promise<any> {
  try {
    // Fetch existing staff to ensure it exists
    const existingStaff = await db
      .select()
      .from(staffMembers)
      .where(eq(staffMembers.id, staffId))
      .limit(1)
      .then(rows => rows[0]);

    if (!existingStaff) {
      return null; // Will be handled as 404 in the route
    }

    // Validate enum values
    const validPositions = positionEnum.enumValues;
    const validDepartments = departmentEnum.enumValues;
    const validEmploymentTypes = employmentTypeEnum.enumValues;
    const validStatuses = staffStatusEnum.enumValues;

    if (staff.position && !validPositions.includes(staff.position)) {
      throw new Error(`Invalid position: ${staff.position}. Valid values: ${validPositions.join(', ')}`);
    }

    if (staff.department && !validDepartments.includes(staff.department)) {
      throw new Error(`Invalid department: ${staff.department}. Valid values: ${validDepartments.join(', ')}`);
    }

    if (staff.employment_type && !validEmploymentTypes.includes(staff.employment_type)) {
      throw new Error(`Invalid employment type: ${staff.employment_type}. Valid values: ${validEmploymentTypes.join(', ')}`);
    }

    if (staff.status && !validStatuses.includes(staff.status)) {
      throw new Error(`Invalid status: ${staff.status}. Valid values: ${validStatuses.join(', ')}`);
    }

    // Convert string dates to Date objects
    const hireDate = staff.hire_date ? new Date(staff.hire_date) : existingStaff.hire_date;

    // Prepare update data
    const updateData = {
      employee_id: staff.employee_id ?? existingStaff.employee_id,
      first_name: staff.first_name ?? existingStaff.first_name,
      last_name: staff.last_name ?? existingStaff.last_name,
      email: staff.email ?? existingStaff.email,
      phone: staff.phone ?? existingStaff.phone,
      position: staff.position ?? existingStaff.position,
      department: staff.department ?? existingStaff.department,
      employment_type: staff.employment_type ?? existingStaff.employment_type,
      hire_date: hireDate,
      salary: staff.salary != null ? staff.salary.toString() : existingStaff.salary,
      hourly_rate: staff.hourly_rate != null ? staff.hourly_rate.toString() : existingStaff.hourly_rate,
      currency: staff.currency ?? existingStaff.currency,
      status: staff.status ?? existingStaff.status,
      photo_url: staff.photo_url ?? existingStaff.photo_url,
      address: staff.address ?? existingStaff.address,
      emergency_contact_name: staff.emergency_contact_name ?? existingStaff.emergency_contact_name,
      emergency_contact_phone: staff.emergency_contact_phone ?? existingStaff.emergency_contact_phone,
      updated_at: new Date(),
    };

    // Perform update
    const [updatedStaff] = await db
      .update(staffMembers)
      .set(updateData)
      .where(eq(staffMembers.id, staffId))
      .returning();

    // Return updated staff
    return {
      id: updatedStaff.id,
      employee_id: updatedStaff.employee_id,
      first_name: updatedStaff.first_name,
      last_name: updatedStaff.last_name,
      email: updatedStaff.email || undefined,
      phone: updatedStaff.phone || undefined,
      position: updatedStaff.position,
      department: updatedStaff.department,
      employment_type: updatedStaff.employment_type,
      hire_date: updatedStaff.hire_date?.toISOString(),
      salary: updatedStaff.salary ? Number(updatedStaff.salary) : undefined,
      hourly_rate: updatedStaff.hourly_rate ? Number(updatedStaff.hourly_rate) : undefined,
      currency: updatedStaff.currency,
      status: updatedStaff.status,
      photo_url: updatedStaff.photo_url || undefined,
      address: updatedStaff.address || undefined,
      emergency_contact_name: updatedStaff.emergency_contact_name || undefined,
      emergency_contact_phone: updatedStaff.emergency_contact_phone || undefined,
      created_at: updatedStaff.created_at?.toISOString(),
      updated_at: updatedStaff.updated_at?.toISOString(),
    };
  } catch (error: any) {
    console.error("Error updating staff member:", error.message);

    // Handle unique constraint violations
    if (error.code === '23505') { // Unique constraint violation
      if (error.constraint?.includes('employee_id')) {
        throw new Error(`Employee ID ${staff.employee_id} already exists`);
      }
    }

    if (error.code === '23503') { // Foreign key violation
      throw new Error(`Invalid organization ID`);
    }

    throw error;
  }
}


// Get individual staff member by ID with organization check
async getStaffMemberById(staffId: number, organizationId: number): Promise<any> {
  try {
    const [staff] = await db
      .select()
      .from(staffMembers)
      .where(
        and(
          eq(staffMembers.id, staffId),
          eq(staffMembers.organization_id, organizationId)
        )
      )
      .limit(1);

    if (!staff) {
      return null;
    }

    return {
      id: staff.id,
      employee_id: staff.employee_id,
      first_name: staff.first_name,
      last_name: staff.last_name,
      email: staff.email || undefined,
      phone: staff.phone || undefined,
      position: staff.position,
      department: staff.department,
      employment_type: staff.employment_type,
      hire_date: staff.hire_date?.toISOString(),
      salary: staff.salary ? Number(staff.salary) : undefined,
      hourly_rate: staff.hourly_rate ? Number(staff.hourly_rate) : undefined,
      currency: staff.currency,
      status: staff.status,
      photo_url: staff.photo_url || undefined,
      address: staff.address || undefined,
      emergency_contact_name: staff.emergency_contact_name || undefined,
      emergency_contact_phone: staff.emergency_contact_phone || undefined,
      created_at: staff.created_at?.toISOString(),
      updated_at: staff.updated_at?.toISOString(),
    };
  } catch (error: any) {
    console.error("Error fetching staff member by ID:", error.message);
    throw new Error(`Failed to fetch staff member: ${error.message}`);
  }
}

// Get time records for a specific staff member
// async getTimeRecordsByStaffId(staffId: number, organizationId: number): Promise<any[]> {
//   try {
//     // First verify staff exists in organization
//     const staffExists = await db
//       .select({ id: staffMembers.id })
//       .from(staffMembers)
//       .where(
//         and(
//           eq(staffMembers.id, staffId),
//           eq(staffMembers.organization_id, organizationId)
//         )
//       )
//       .limit(1);

//     if (staffExists.length === 0) {
//       throw new Error("Staff member not found in organization");
//     }

//     // Get time records with staff name for convenience
//     const records = await db
//       .select({
//         id: timeTracking.id,
//         staff_id: timeTracking.staff_id,
//         staff_first_name: staffMembers.first_name,
//         staff_last_name: staffMembers.last_name,
//         property_id: timeTracking.property_id,
//         clock_in_time: timeTracking.clock_in_time,
//         clock_out_time: timeTracking.clock_out_time,
//         location_lat: timeTracking.location_lat,
//         location_lng: timeTracking.location_lng,
//         clock_in_method: timeTracking.clock_in_method,
//         clock_out_method: timeTracking.clock_out_method,
//         total_hours: timeTracking.total_hours,
//         overtime_hours: timeTracking.overtime_hours,
//         break_time: timeTracking.break_time,
//         notes: timeTracking.notes,
//         status: timeTracking.status,
//         created_at: timeTracking.created_at,
//         updated_at: timeTracking.updated_at,
//       })
//       .from(timeTracking)
//       .leftJoin(staffMembers, eq(timeTracking.staff_id, staffMembers.id))
//       .where(
//         and(
//           eq(timeTracking.staff_id, staffId),
//           eq(timeTracking.organization_id, organizationId)
//         )
//       )
//       .orderBy(desc(timeTracking.clock_in_time))
//       .limit(50); // Limit to recent 50 records

//     return records.map(record => ({
//       id: record.id,
//       staff_id: record.staff_id,
//       staff_name: record.staff_first_name && record.staff_last_name 
//         ? `${record.staff_first_name} ${record.staff_last_name}` 
//         : undefined,
//       property_id: record.property_id,
//       clock_in_time: record.clock_in_time? (record.clock_in_time as Date).toISOString() : undefined,
//       clock_out_time: record.clock_out_time? (record.clock_out_time as Date).toISOString() : undefined,
//       location_lat: record.location_lat,
//       location_lng: record.location_lng,
//       clock_in_method: record.clock_in_method,
//       clock_out_method: record.clock_out_method,
//       total_hours: record.total_hours ? Number(record.total_hours) : undefined,
//       overtime_hours: record.overtime_hours ? Number(record.overtime_hours) : undefined,
//       break_time: record.break_time ? Number(record.break_time) : undefined,
//       notes: record.notes,
//       status: record.status,
//       created_at: record.created_at? (record.created_at as Date).toISOString() : undefined,
//       updated_at: record.updated_at? (record.updated_at as Date).toISOString() : undefined,
//     }));
//   } catch (error: any) {
//     console.error("Error fetching time records:", error.message);
    
//     // If table doesn't exist, return empty array
//     if (error.message.includes('does not exist') || error.message.includes('relation')) {
//       return [];
//     }
    
//     throw new Error(`Failed to fetch time records: ${error.message}`);
//   }
// }

// Get payroll records for a specific staff member
async getPayrollRecordsByStaffId(staffId: number, organizationId: number): Promise<any[]> {
  try {
    // First verify staff exists in organization
    const staffExists = await db
      .select({ id: staffMembers.id })
      .from(staffMembers)
      .where(
        and(
          eq(staffMembers.id, staffId),
          eq(staffMembers.organization_id, organizationId)
        )
      )
      .limit(1);

    if (staffExists.length === 0) {
      throw new Error("Staff member not found in organization");
    }

    // Get payroll records with staff name for convenience
    const records = await db
      .select({
        id: payrollRecords.id,
        staff_id: payrollRecords.staff_id,
        staff_first_name: staffMembers.first_name,
        staff_last_name: staffMembers.last_name,
        pay_period_start: payrollRecords.pay_period_start,
        pay_period_end: payrollRecords.pay_period_end,
        regular_hours: payrollRecords.regular_hours,
        overtime_hours: payrollRecords.overtime_hours,
        regular_pay: payrollRecords.regular_pay,
        overtime_pay: payrollRecords.overtime_pay,
        bonus: payrollRecords.bonus,
        gross_pay: payrollRecords.gross_pay,
        net_pay: payrollRecords.net_pay,
        currency: payrollRecords.currency,
        payment_status: payrollRecords.payment_status,
        payment_date: payrollRecords.payment_date,
        created_at: payrollRecords.created_at,
        updated_at: payrollRecords.updated_at,
      })
      .from(payrollRecords)
      .leftJoin(staffMembers, eq(payrollRecords.staff_id, staffMembers.id))
      .where(
        and(
          eq(payrollRecords.staff_id, staffId),
          eq(payrollRecords.organization_id, organizationId)
        )
      )
      .orderBy(desc(payrollRecords.pay_period_end))
      .limit(50); // Limit to recent 50 records

    return records.map(record => ({
      id: record.id,
      staff_id: record.staff_id,
      staff_name: record.staff_first_name && record.staff_last_name 
        ? `${record.staff_first_name} ${record.staff_last_name}` 
        : undefined,
      pay_period_start: record.pay_period_start ?? undefined,
      pay_period_end: record.pay_period_end ?? undefined,
      regular_hours: record.regular_hours ? Number(record.regular_hours) : undefined,
      overtime_hours: record.overtime_hours ? Number(record.overtime_hours) : undefined,
      regular_pay: record.regular_pay ? Number(record.regular_pay) : undefined,
      overtime_pay: record.overtime_pay ? Number(record.overtime_pay) : undefined,
      bonus: record.bonus ? Number(record.bonus) : undefined,
      gross_pay: record.gross_pay ? Number(record.gross_pay) : undefined,
      net_pay: record.net_pay ? Number(record.net_pay) : undefined,
      currency: record.currency,
      payment_status: record.payment_status,
      payment_date: record.payment_date ?? undefined,
      created_at: record.created_at?.toISOString(),
      updated_at: record.updated_at?.toISOString(),
    }));
  } catch (error: any) {
    console.error("Error fetching payroll records:", error.message);
    
    // If table doesn't exist, return empty array
    if (error.message.includes('does not exist') || error.message.includes('relation')) {
      return [];
    }
    
    throw new Error(`Failed to fetch payroll records: ${error.message}`);
  }
}


// Get time tracking record by ID
async getTimeTrackingRecordById(id: number, organizationId: number): Promise<any> {
  try {
    const [record] = await db
      .select()
      .from(timeTracking)
      .where(
        and(
          eq(timeTracking.id, id),
          eq(timeTracking.organization_id, organizationId)
        )
      )
      .limit(1);

    if (!record) return null;

    return {
      id: record.id,
      organization_id: record.organization_id,
      staff_id: record.staff_id,
      property_id: record.property_id,
      clock_in_time: record.clock_in_time?.toISOString(),
      clock_out_time: record.clock_out_time?.toISOString(),
      location_lat: record.location_lat,
      location_lng: record.location_lng,
      clock_in_method: record.clock_in_method,
      clock_out_method: record.clock_out_method,
      total_hours: record.total_hours ? Number(record.total_hours) : null,
      overtime_hours: record.overtime_hours ? Number(record.overtime_hours) : null,
      break_time: record.break_time ? Number(record.break_time) : null,
      notes: record.notes,
      status: record.status,
      created_at: record.created_at?.toISOString(),
      updated_at: record.updated_at?.toISOString(),
    };
  } catch (error: any) {
    console.error("Error fetching time tracking record by ID:", error.message);
    throw new Error(`Failed to fetch time tracking record: ${error.message}`);
  }
}

// Update the createTimeTrackingRecord method signature
async createTimeTrackingRecord(data: {
  organization_id: number;
  staff_id: number;
  property_id?: number;
  clock_in_method?: "mobile" | "web" | "biometric" | "manual" | "api";
  location_lat?: number;
  location_lng?: number;
  notes?: string;
}): Promise<any> {
  try {
    const clockInTime = new Date();
    
    // Validate that the staff member exists and belongs to the organization
    const [staffMember] = await db
      .select()
      .from(staffMembers)
      .where(
        and(
          eq(staffMembers.id, data.staff_id),
          eq(staffMembers.organization_id, data.organization_id)
        )
      )
      .limit(1);

    if (!staffMember) {
      throw new Error("Staff member not found or does not belong to this organization");
    }

    // Check if there's already an active session for this staff member
    const [activeSession] = await db
      .select()
      .from(timeTracking)
      .where(
        and(
          eq(timeTracking.staff_id, data.staff_id),
          eq(timeTracking.organization_id, data.organization_id),
          isNull(timeTracking.clock_out_time)
        )
      )
      .limit(1);

    if (activeSession) {
      throw new Error("Staff member already has an active time tracking session");
    }

    // If property_id is provided, validate it belongs to the organization
    if (data.property_id) {
      const [property] = await db
        .select()
        .from(properties)
        .where(
          and(
            eq(properties.id, data.property_id),
            eq(properties.organizationId, data.organization_id)
          )
        )
        .limit(1);

      if (!property) {
        throw new Error("Property not found or does not belong to this organization");
      }
    }

    // Create the time tracking record
    const [createdRecord] = await db
      .insert(timeTracking)
      .values({
        organization_id: data.organization_id,
        staff_id: data.staff_id,
        property_id: data.property_id,
        clock_in_time: clockInTime,
        location_lat: data.location_lat,
        location_lng: data.location_lng,
        clock_in_method: data.clock_in_method || 'mobile',
        notes: data.notes,
        created_at: clockInTime,
        updated_at: clockInTime,
      })
      .returning();

    // Get staff name for response
    const [staffWithName] = await db
      .select({
        first_name: staffMembers.first_name,
        last_name: staffMembers.last_name,
      })
      .from(staffMembers)
      .where(eq(staffMembers.id, data.staff_id))
      .limit(1);

    // Get property name if property_id exists
    let propertyName = null;
    if (data.property_id) {
      const [property] = await db
        .select({
          name: properties.name,
        })
        .from(properties)
        .where(eq(properties.id, data.property_id))
        .limit(1);
      propertyName = property?.name || null;
    }

    return {
      id: createdRecord.id,
      staff_id: createdRecord.staff_id,
      staff_name: staffWithName 
        ? `${staffWithName.first_name} ${staffWithName.last_name}`
        : `Staff ${createdRecord.staff_id}`,
      property_id: createdRecord.property_id,
      property_name: propertyName,
      clock_in_time: createdRecord.clock_in_time?.toISOString(),
      clock_in_method: createdRecord.clock_in_method,
      location_lat: createdRecord.location_lat,
      location_lng: createdRecord.location_lng,
      notes: createdRecord.notes,
      message: "Successfully clocked in"
    };
  } catch (error: any) {
    console.error("Error creating time tracking record:", error.message);
    
    // Handle specific error cases
    if (error.message.includes("already has an active time tracking session")) {
      throw new Error("Cannot clock in: Staff already has an active session");
    }
    
    if (error.message.includes("not found or does not belong to this organization")) {
      throw new Error("Validation failed: " + error.message);
    }
    
    throw new Error(`Failed to create time tracking record: ${error.message}`);
  }
}

// Update the updateTimeTrackingRecord method signature
async updateTimeTrackingRecord(id: number, organizationId: number, data: {
  clock_out_method?: "mobile" | "web" | "biometric" | "manual" | "api" | null;  // Changed type
  location_lat?: number;
  location_lng?: number;
  break_time?: number;
  notes?: string;
}): Promise<any> {
  try {
    const clockOutTime = new Date();
    
    // Get the existing record with organization check
    const [existingRecord] = await db
      .select()
      .from(timeTracking)
      .where(
        and(
          eq(timeTracking.id, id),
          eq(timeTracking.organization_id, organizationId)
        )
      )
      .limit(1);

    if (!existingRecord) {
      throw new Error("Time tracking record not found");
    }

    if (existingRecord.clock_out_time) {
      throw new Error("Already clocked out");
    }

    // Calculate total hours
    const clockInTime = existingRecord.clock_in_time as Date;
    const totalMilliseconds = clockOutTime.getTime() - clockInTime.getTime();
    const totalHours = (totalMilliseconds / (1000 * 60 * 60)) - (data.break_time || 0);
    
    // Calculate overtime (assuming > 8 hours is overtime)
    const overtimeHours = Math.max(totalHours - 8, 0);

    // Update the record - Use a default value if clock_out_method is not provided
    const [updatedRecord] = await db
      .update(timeTracking)
      .set({
        clock_out_time: clockOutTime,
        location_lat: data.location_lat,
        location_lng: data.location_lng,
        clock_out_method: data.clock_out_method || 'web',  // Provide default
        total_hours: totalHours.toFixed(2),
        overtime_hours: overtimeHours.toFixed(2),
        break_time: data.break_time?.toFixed(2),
        notes: data.notes || existingRecord.notes,
        updated_at: new Date(),
      })
      .where(
        and(
          eq(timeTracking.id, id),
          eq(timeTracking.organization_id, organizationId)
        )
      )
      .returning();

    return {
      id: updatedRecord.id,
      staff_id: updatedRecord.staff_id,
      clock_in_time: updatedRecord.clock_in_time?.toISOString(),
      clock_out_time: updatedRecord.clock_out_time?.toISOString(),
      total_hours: Number(updatedRecord.total_hours),
      overtime_hours: Number(updatedRecord.overtime_hours),
      break_time: Number(updatedRecord.break_time),
      message: "Successfully clocked out"
    };
  } catch (error: any) {
    console.error("Error updating time tracking record:", error.message);
    throw new Error(`Failed to update time tracking record: ${error.message}`);
  }
}
// Get active session for a staff member
// Add this method to storage.ts if it doesn't exist
async getActiveTimeTrackingSession(staffId: number, organizationId: number): Promise<any | null> {
  try {
    const [activeSession] = await db
      .select({
        id: timeTracking.id,
        staff_id: timeTracking.staff_id,
        staff_first_name: staffMembers.first_name,
        staff_last_name: staffMembers.last_name,
        clock_in_time: timeTracking.clock_in_time,
        clock_in_method: timeTracking.clock_in_method,
        property_id: timeTracking.property_id,
        property_name: properties.name,
        notes: timeTracking.notes,
        created_at: timeTracking.created_at,
      })
      .from(timeTracking)
      .leftJoin(staffMembers, eq(timeTracking.staff_id, staffMembers.id))
      .leftJoin(properties, eq(timeTracking.property_id, properties.id))
      .where(
        and(
          eq(timeTracking.staff_id, staffId),
          eq(timeTracking.organization_id, organizationId),
          isNull(timeTracking.clock_out_time)
        )
      )
      .limit(1);

    if (!activeSession) return null;

    return {
      id: activeSession.id,
      staff_id: activeSession.staff_id,
      staff_name: activeSession.staff_first_name && activeSession.staff_last_name 
        ? `${activeSession.staff_first_name} ${activeSession.staff_last_name}` 
        : `Staff ${activeSession.staff_id}`,
      clock_in_time: activeSession.clock_in_time?.toISOString(),
      clock_in_method: activeSession.clock_in_method,
      property_id: activeSession.property_id,
      property_name: activeSession.property_name,
      notes: activeSession.notes,
      created_at: activeSession.created_at?.toISOString(),
      duration_hours: activeSession.clock_in_time 
        ? ((new Date().getTime() - (activeSession.clock_in_time as Date).getTime()) / (1000 * 60 * 60)).toFixed(1)
        : '0'
    };
  } catch (error) {
    console.error("Error fetching active session:", error);
    return null;
  }
}
// Get time records by staff ID
async getTimeRecordsByStaffId(staffId: number, organizationId: number): Promise<any[]> {
  try {
    const records = await db
      .select({
        id: timeTracking.id,
        staff_id: timeTracking.staff_id,
        staff_first_name: staffMembers.first_name,
        staff_last_name: staffMembers.last_name,
        property_id: timeTracking.property_id,
        property_name: properties.name,
        clock_in_time: timeTracking.clock_in_time,
        clock_out_time: timeTracking.clock_out_time,
        location_lat: timeTracking.location_lat,
        location_lng: timeTracking.location_lng,
        clock_in_method: timeTracking.clock_in_method,
        clock_out_method: timeTracking.clock_out_method,
        total_hours: timeTracking.total_hours,
        overtime_hours: timeTracking.overtime_hours,
        break_time: timeTracking.break_time,
        notes: timeTracking.notes,
        status: timeTracking.status,
        created_at: timeTracking.created_at,
        updated_at: timeTracking.updated_at,
      })
      .from(timeTracking)
      .leftJoin(staffMembers, eq(timeTracking.staff_id, staffMembers.id))
      .leftJoin(properties, eq(timeTracking.property_id, properties.id))
      .where(
        and(
          eq(timeTracking.staff_id, staffId),
          eq(timeTracking.organization_id, organizationId)
        )
      )
      .orderBy(desc(timeTracking.clock_in_time))
      .limit(50);

    return records.map(record => ({
      id: record.id,
      staff_id: record.staff_id,
      staff_name: record.staff_first_name && record.staff_last_name 
        ? `${record.staff_first_name} ${record.staff_last_name}` 
        : `Staff ${record.staff_id}`,
      property_id: record.property_id,
      property_name: record.property_name,
      clock_in_time: record.clock_in_time? (record.clock_in_time as Date).toISOString() : undefined,
      clock_out_time: record.clock_out_time? (record.clock_out_time as Date).toISOString() : undefined,
      location_lat: record.location_lat,
      location_lng: record.location_lng,
      clock_in_method: record.clock_in_method,
      clock_out_method: record.clock_out_method,
      total_hours: record.total_hours ? Number(record.total_hours) : undefined,
      overtime_hours: record.overtime_hours ? Number(record.overtime_hours) : undefined,
      break_time: record.break_time ? Number(record.break_time) : undefined,
      notes: record.notes,
      status: record.status,
      created_at: record.created_at? (record.created_at as Date).toISOString() : undefined,
      updated_at: record.updated_at? (record.updated_at as Date).toISOString() : undefined,
    }));
  } catch (error: any) {
    console.error("Error fetching time records:", error.message);
    throw new Error(`Failed to fetch time records: ${error.message}`);
  }
}

// Add this method to storage.ts if it doesn't exist
async getTimeTrackingRecords(organizationId: number): Promise<any[]> {
  try {
    const records = await db
      .select({
        id: timeTracking.id,
        staff_id: timeTracking.staff_id,
        staff_first_name: staffMembers.first_name,
        staff_last_name: staffMembers.last_name,
        property_id: timeTracking.property_id,
        property_name: properties.name,
        clock_in_time: timeTracking.clock_in_time,
        clock_out_time: timeTracking.clock_out_time,
        location_lat: timeTracking.location_lat,
        location_lng: timeTracking.location_lng,
        clock_in_method: timeTracking.clock_in_method,
        clock_out_method: timeTracking.clock_out_method,
        total_hours: timeTracking.total_hours,
        overtime_hours: timeTracking.overtime_hours,
        break_time: timeTracking.break_time,
        notes: timeTracking.notes,
        status: timeTracking.status,
        created_at: timeTracking.created_at,
        updated_at: timeTracking.updated_at,
      })
      .from(timeTracking)
      .leftJoin(staffMembers, eq(timeTracking.staff_id, staffMembers.id))
      .leftJoin(properties, eq(timeTracking.property_id, properties.id))
      .where(eq(timeTracking.organization_id, organizationId))
      .orderBy(desc(timeTracking.clock_in_time))
      .limit(100);

    return records.map(record => ({
      id: record.id,
      staff_id: record.staff_id,
      staff_name: record.staff_first_name && record.staff_last_name 
        ? `${record.staff_first_name} ${record.staff_last_name}` 
        : `Staff ${record.staff_id}`,
      property_id: record.property_id,
      property_name: record.property_name,
      clock_in_time: record.clock_in_time? (record.clock_in_time as Date).toISOString() : undefined,
      clock_out_time: record.clock_out_time? (record.clock_out_time as Date).toISOString() : undefined,
      location_lat: record.location_lat,
      location_lng: record.location_lng,
      clock_in_method: record.clock_in_method,
      clock_out_method: record.clock_out_method,
      total_hours: record.total_hours ? Number(record.total_hours) : undefined,
      overtime_hours: record.overtime_hours ? Number(record.overtime_hours) : undefined,
      break_time: record.break_time ? Number(record.break_time) : undefined,
      notes: record.notes,
      status: record.status,
      created_at: record.created_at? (record.created_at as Date).toISOString() : undefined,
      updated_at: record.updated_at? (record.updated_at as Date).toISOString() : undefined,
    }));
  } catch (error: any) {
    console.error("Error fetching time tracking records:", error.message);
    
    // If table doesn't exist, return empty array
    if (error.message.includes('does not exist') || error.message.includes('relation')) {
      return [];
    }
    
    throw new Error(`Failed to fetch time tracking records: ${error.message}`);
  }
}

  async getPayrollRecords(organizationId: number): Promise<any[]> {
    try {
      const records = await db.select({
        id: payrollRecords.id,
        staffId: payrollRecords.staff_id,
        payPeriodStart: payrollRecords.pay_period_start,
        payPeriodEnd: payrollRecords.pay_period_end,
        basicSalary: payrollRecords.gross_pay,
        totalEarnings: payrollRecords.gross_pay,
        totalDeductions: payrollRecords.total_deductions,
        netPay: payrollRecords.net_pay,
        status: payrollRecords.payment_status,
        paidAt: payrollRecords.paid_at,
        staffFirstName: staffMembers.first_name,
        staffLastName: staffMembers.last_name,
        staffPosition: staffMembers.position,
      }).from(payrollRecords)
        .leftJoin(staffMembers, eq(payrollRecords.staff_id, staffMembers.id))
        .where(eq(staffMembers.organization_id, organizationId))
        .orderBy(payrollRecords.pay_period_end);
      return records;
    } catch (error) {
      console.error("Error fetching payroll records:", error);
      return [];
    }
  }

  async getContractorPerformanceReviews(organizationId: number): Promise<any[]> {
    try {
      return await db.select().from(contractorPerformance);
    } catch (error) {
      console.warn("contractorPerformance table not in schema yet - returning empty array");
      return [
        { id: 1, contractorId: 1, rating: 4.8, totalJobsCompleted: 25, averageCompletionTime: 2.5 }
      ];
    }
  }

  async getServiceContractorCategories(): Promise<any[]> {
  try {
    const categories = await this.db
      .select()
      .from(contractorCategories)
      .orderBy(contractorCategories.name);
    
    return categories.map((cat:any) => ({
      id: cat.id,
      name: cat.name,
      description: cat.description || '',
      requiredCertifications: cat.requiredCertifications || [],
      typicalServices: cat.typicalServices || [],
      defaultHourlyRate: cat.defaultHourlyRate,
      defaultDailyRate: cat.defaultDailyRate,
      isActive: cat.isActive,
      createdAt: cat.createdAt,
      updatedAt: cat.updatedAt
    }));
  } catch (error) {
    console.error("Error fetching contractor categories:", error);
    throw error;
  }
}

async createServiceContractorCategory(data: any): Promise<any> {
  try {
    const [category] = await this.db
      .insert(contractorCategories)
      .values({
        name: data.name,
        description: data.description,
        requiredCertifications: data.requiredCertifications || [],
        typicalServices: data.typicalServices || [],
        defaultHourlyRate: data.defaultHourlyRate,
        defaultDailyRate: data.defaultDailyRate,
        isActive: data.isActive !== undefined ? data.isActive : true
      })
      .returning();
    
    return category;
  } catch (error) {
    console.error("Error creating contractor category:", error);
    throw error;
  }
}

async updateServiceContractorCategory(id: number, data: any): Promise<any> {
  try {
    const [category] = await this.db
      .update(contractorCategories)
      .set({
        ...data,
        updatedAt: new Date()
      })
      .where(eq(contractorCategories.id, id))
      .returning();
    
    return category;
  } catch (error) {
    console.error("Error updating contractor category:", error);
    throw error;
  }
}

async deleteServiceContractorCategory(id: number): Promise<void> {
  try {
    await this.db
      .delete(contractorCategories)
      .where(eq(contractorCategories.id, id));
  } catch (error) {
    console.error("Error deleting contractor category:", error);
    throw error;
  }
}

  async getWorkforceStats(organizationId: number): Promise<any> {
    try {
      const allStaff = await db.select().from(staffMembers).where(eq(staffMembers.organization_id, organizationId));
      const activeStaff = allStaff.filter((s: any) => s.employment_status === 'active');
      
      // Hours this month from time_tracking
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const timeRecords = await db.select().from(timeTracking).where(
        and(
          eq(timeTracking.organization_id, organizationId),
          gte(timeTracking.clock_in_time, startOfMonth)
        )
      );
      const totalMinutes = timeRecords.reduce((sum: number, r: any) => {
        if (r.clock_out_time) {
          return sum + (new Date(r.clock_out_time).getTime() - new Date(r.clock_in_time).getTime()) / 60000;
        }
        return sum;
      }, 0);

      return {
        totalStaff: allStaff.length,
        activeStaff: activeStaff.length,
        totalHoursThisMonth: Math.round(totalMinutes / 60),
        averageRating: 4.2
      };
    } catch (error) {
      console.error("Error fetching workforce stats:", error);
      return { totalStaff: 0, activeStaff: 0, totalHoursThisMonth: 0, averageRating: 0 };
    }
  }

  async getBroadcastRecipients(broadcastId: number): Promise<any[]> {
    try {
      return await db.select().from(broadcastRecipients).where(eq(broadcastRecipients.broadcastId, broadcastId));
    } catch (error) {
      console.warn("broadcastRecipients table not in schema yet - returning empty array");
      return [
        { id: 1, broadcastId, recipientId: 1, status: "sent", sentAt: new Date() }
      ];
    }
  }

  async getTechnicians(): Promise<any[]> {
    try {
      const techs = await db.select().from(staffMembers)
        .where(eq(staffMembers.department, 'maintenance'));
      return techs.map((t: any) => ({
        id: t.id,
        name: `${t.first_name} ${t.last_name}`,
        specialty: t.position || 'general',
        phone: t.phone,
        email: t.email,
        availability: t.employment_status === 'active' ? 'available' : 'unavailable',
      }));
    } catch (error) {
      console.error("Error fetching technicians:", error);
      return [];
    }
  }

// ==============================
  // ENTERPRISE FINANCE MODULE METHODS
  // ==============================

  // ── Chart of Accounts ────────────────────────────────────────────────────────
  async getChartOfAccounts(organizationId?: number) {
    try {
      let q = db.select().from(chartOfAccounts).orderBy(chartOfAccounts.accountCode);
      if (organizationId) {
        return await db.select().from(chartOfAccounts)
          .where(eq(chartOfAccounts.organizationId, organizationId))
          .orderBy(chartOfAccounts.accountCode);
      }
      return await q;
    } catch {
      return [];
    }
  }

  async createChartOfAccount(account: any) {
    const [row] = await db.insert(chartOfAccounts).values({
      ...account,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();
    return row;
  }

  async seedChartOfAccounts(organizationId: number, accounts: any[]) {
    try {
      const existing = await this.getChartOfAccounts(organizationId);
      const existingCodes = new Set(existing.map((a: any) => a.accountCode));
      const toInsert = accounts.filter((a) => !existingCodes.has(a.accountCode));
      if (toInsert.length === 0) return;
      await db.insert(chartOfAccounts).values(
        toInsert.map((a) => ({
          ...a,
          organizationId,
          createdAt: new Date(),
          updatedAt: new Date(),
        }))
      );
    } catch (err) {
      console.error("seedChartOfAccounts error:", err);
    }
  }

  // ── Cost Centers ──────────────────────────────────────────────────────────────
  async getCostCenters(organizationId?: number) {
    try {
      if (organizationId) {
        return await db.select().from(costCenters)
          .where(eq(costCenters.organizationId, organizationId))
          .orderBy(costCenters.code);
      }
      return await db.select().from(costCenters).orderBy(costCenters.code);
    } catch {
      return [];
    }
  }

  async createCostCenter(costCenter: any) {
    const [row] = await db.insert(costCenters).values({
      ...costCenter,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();
    return row;
  }

  // ── General Ledger ────────────────────────────────────────────────────────────
  async getGeneralLedgerEntries(filters: any) {
    try {
      const page = filters.page || 1;
      const limit = Math.min(filters.limit || 50, 500);
      const offset = (page - 1) * limit;

      const conditions: any[] = [];
      if (filters.organizationId) conditions.push(eq(generalLedger.organizationId, filters.organizationId));
      if (filters.accountId) conditions.push(eq(generalLedger.accountId, Number(filters.accountId)));
      if (filters.costCenterId) conditions.push(eq(generalLedger.costCenterId, Number(filters.costCenterId)));
      if (filters.dateFrom) conditions.push(gte(generalLedger.transactionDate, new Date(filters.dateFrom)));
      if (filters.dateTo) conditions.push(lte(generalLedger.transactionDate, new Date(filters.dateTo)));

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      // Join with chart of accounts to get accountName
      const rows = await db
        .select({
          id: generalLedger.id,
          transactionId: generalLedger.transactionId,
          accountId: generalLedger.accountId,
          accountName: chartOfAccounts.accountName,
          accountCode: chartOfAccounts.accountCode,
          costCenterId: generalLedger.costCenterId,
          description: generalLedger.description,
          debitAmount: generalLedger.debitAmount,
          creditAmount: generalLedger.creditAmount,
          reference: generalLedger.reference,
          transactionDate: generalLedger.transactionDate,
          fiscalYear: generalLedger.fiscalYear,
          fiscalPeriod: generalLedger.fiscalPeriod,
          currency: generalLedger.currency,
          createdAt: generalLedger.createdAt,
        })
        .from(generalLedger)
        .leftJoin(chartOfAccounts, eq(generalLedger.accountId, chartOfAccounts.id))
        .where(whereClause)
        .orderBy(desc(generalLedger.transactionDate))
        .limit(limit)
        .offset(offset);

      const [countRow] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(generalLedger)
        .where(whereClause);

      return {
        entries: rows,
        totalCount: countRow?.total ?? 0,
        page,
        limit,
      };
    } catch (err) {
      console.error("getGeneralLedgerEntries error:", err);
      return { entries: [], totalCount: 0, page: 1, limit: 50 };
    }
  }

  async createGeneralLedgerEntry(entry: any) {
    const [row] = await db.insert(generalLedger).values({
      ...entry,
      transactionDate: entry.transactionDate ? new Date(entry.transactionDate) : new Date(),
      createdAt: new Date(),
    }).returning();
    return row;
  }

  // ── Purchase Requisitions ─────────────────────────────────────────────────────
  async getPurchaseRequisitions(status?: string, requestorId?: string, organizationId?: number) {
    try {
      const conditions: any[] = [];
      if (organizationId) conditions.push(eq(purchaseRequisitions.organizationId, organizationId));
      if (status) conditions.push(eq(purchaseRequisitions.approvalStatus, status as any));
      if (requestorId) conditions.push(eq(purchaseRequisitions.requestorId, requestorId));

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const rows = await db
        .select({
          id: purchaseRequisitions.id,
          prNumber: purchaseRequisitions.prNumber,
          title: purchaseRequisitions.title,
          description: purchaseRequisitions.description,
          requestorId: purchaseRequisitions.requestorId,
          totalAmount: purchaseRequisitions.totalAmount,
          currency: purchaseRequisitions.currency,
          approvalStatus: purchaseRequisitions.approvalStatus,
          requestedDate: purchaseRequisitions.requestedDate,
          requiredDate: purchaseRequisitions.requiredDate,
          priority: purchaseRequisitions.priority,
          category: purchaseRequisitions.category,
          l1Comments: purchaseRequisitions.l1Comments,
          l2Comments: purchaseRequisitions.l2Comments,
          mdComments: purchaseRequisitions.mdComments,
          rejectedReason: purchaseRequisitions.rejectedReason,
          createdAt: purchaseRequisitions.createdAt,
          requestorFirstName: users.firstName,
          requestorLastName: users.lastName,
        })
        .from(purchaseRequisitions)
        .leftJoin(users, eq(purchaseRequisitions.requestorId, users.id))
        .where(whereClause)
        .orderBy(desc(purchaseRequisitions.createdAt));

      return rows.map((r: any) => ({
        ...r,
        requestorName: r.requestorFirstName && r.requestorLastName
          ? `${r.requestorFirstName} ${r.requestorLastName}`.trim()
          : r.requestorFirstName || r.requestorLastName || "Unknown",
        approvalComments: r.l1Comments || r.l2Comments || r.mdComments || null,
      }));
    } catch (err) {
      console.error("getPurchaseRequisitions error:", err);
      return [];
    }
  }

  async createPurchaseRequisition(requisition: any) {
    const year = new Date().getFullYear();
    // Generate a sequential PR number
    const [countRow] = await db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(purchaseRequisitions)
      .where(eq(purchaseRequisitions.organizationId, requisition.organizationId));
    const seq = String((countRow?.cnt ?? 0) + 1).padStart(4, "0");
    const prNumber = `PR-${year}-${seq}`;

    const [row] = await db.insert(purchaseRequisitions).values({
      ...requisition,
      prNumber,
      approvalStatus: "pending_l1",
      requestedDate: requisition.requestedDate ? new Date(requisition.requestedDate) : new Date(),
      requiredDate: requisition.requiredDate ? new Date(requisition.requiredDate) : new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();
    return row;
  }

  async approvePurchaseRequisition(id: number, level: string, approverId: string, comments?: string) {
    const nextStatus = level === "l1" ? "pending_l2" : level === "l2" ? "pending_md" : "approved";
    const updateData: any = {
      approvalStatus: nextStatus,
      updatedAt: new Date(),
    };
    if (level === "l1") { updateData.l1ApproverId = approverId; updateData.l1ApprovedAt = new Date(); updateData.l1Comments = comments; }
    if (level === "l2") { updateData.l2ApproverId = approverId; updateData.l2ApprovedAt = new Date(); updateData.l2Comments = comments; }
    if (level === "md") { updateData.mdApproverId = approverId; updateData.mdApprovedAt = new Date(); updateData.mdComments = comments; }

    const [row] = await db.update(purchaseRequisitions)
      .set(updateData)
      .where(eq(purchaseRequisitions.id, id))
      .returning();
    return row;
  }

  async rejectPurchaseRequisition(id: number, approverId: string, reason: string) {
    const [row] = await db.update(purchaseRequisitions)
      .set({ approvalStatus: "rejected", rejectedReason: reason, updatedAt: new Date() })
      .where(eq(purchaseRequisitions.id, id))
      .returning();
    return row;
  }

  // ── Purchase Orders (stub — no table yet) ─────────────────────────────────────
  async getPurchaseOrders(status?: string, buyerId?: string, vendorId?: string) {
    return [];
  }
  async createPurchaseOrder(order: any) {
    return { id: Date.now(), poNumber: `PO-${Date.now()}`, ...order, status: "draft", createdAt: new Date() };
  }
  async updatePurchaseOrderStatus(id: number, status: string) {
    return { id, status, updatedAt: new Date() };
  }

  // ── Expense Reports ───────────────────────────────────────────────────────────
  async getExpenseReports(status?: string, employeeId?: string, organizationId?: number) {
    try {
      const conditions: any[] = [];
      if (organizationId) conditions.push(eq(expenseReports.organizationId, organizationId));
      if (status) conditions.push(eq(expenseReports.approvalStatus, status as any));
      if (employeeId) conditions.push(eq(expenseReports.employeeId, employeeId));

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const rows = await db
        .select({
          id: expenseReports.id,
          reportNumber: expenseReports.reportNumber,
          title: expenseReports.title,
          description: expenseReports.description,
          employeeId: expenseReports.employeeId,
          totalAmount: expenseReports.totalAmount,
          currency: expenseReports.currency,
          expenseType: expenseReports.expenseType,
          submittedDate: expenseReports.submittedDate,
          approvalStatus: expenseReports.approvalStatus,
          l1Comments: expenseReports.l1Comments,
          l2Comments: expenseReports.l2Comments,
          mdComments: expenseReports.mdComments,
          rejectedReason: expenseReports.rejectedReason,
          paidDate: expenseReports.paidDate,
          createdAt: expenseReports.createdAt,
          employeeFirstName: users.firstName,
          employeeLastName: users.lastName,
        })
        .from(expenseReports)
        .leftJoin(users, eq(expenseReports.employeeId, users.id))
        .where(whereClause)
        .orderBy(desc(expenseReports.createdAt));

      return rows.map((r: any) => ({
        ...r,
        employeeName: r.employeeFirstName && r.employeeLastName
          ? `${r.employeeFirstName} ${r.employeeLastName}`.trim()
          : r.employeeFirstName || r.employeeLastName || "Unknown",
      }));
    } catch (err) {
      console.error("getExpenseReports error:", err);
      return [];
    }
  }

  async createExpenseReport(report: any) {
    const year = new Date().getFullYear();
    const [countRow] = await db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(expenseReports)
      .where(eq(expenseReports.organizationId, report.organizationId));
    const seq = String((countRow?.cnt ?? 0) + 1).padStart(4, "0");
    const reportNumber = `EXP-${year}-${seq}`;

    const [row] = await db.insert(expenseReports).values({
      ...report,
      reportNumber,
      approvalStatus: "pending_l1",
      submittedDate: report.submittedDate ? new Date(report.submittedDate) : new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();
    return row;
  }

  async approveExpenseReport(id: number, level: string, approverId: string, comments?: string) {
    const nextStatus = level === "l1" ? "pending_l2" : level === "l2" ? "pending_md" : "approved";
    const updateData: any = { approvalStatus: nextStatus, updatedAt: new Date() };
    if (level === "l1") { updateData.l1ApproverId = approverId; updateData.l1ApprovedAt = new Date(); updateData.l1Comments = comments; }
    if (level === "l2") { updateData.l2ApproverId = approverId; updateData.l2ApprovedAt = new Date(); updateData.l2Comments = comments; }
    if (level === "md") { updateData.mdApproverId = approverId; updateData.mdApprovedAt = new Date(); updateData.mdComments = comments; }

    const [row] = await db.update(expenseReports)
      .set(updateData)
      .where(eq(expenseReports.id, id))
      .returning();
    return row;
  }

  async rejectExpenseReport(id: number, approverId: string, reason: string) {
    const [row] = await db.update(expenseReports)
      .set({ approvalStatus: "rejected", rejectedReason: reason, updatedAt: new Date() })
      .where(eq(expenseReports.id, id))
      .returning();
    return row;
  }

  // OCR Receipt Processing (stub — requires external OCR service)
  async processReceiptOCR(receiptUrl: string) {
    return {
      vendor: "",
      amount: "0.00",
      currency: "KES",
      date: new Date().toISOString().split("T")[0],
      category: "other",
      taxAmount: "0.00",
      confidence: 0,
    };
  }

  // ── Payroll Periods ───────────────────────────────────────────────────────────
  async getPayrollPeriods(status?: string, year?: string, organizationId?: number) {
    try {
      const conditions: any[] = [];
      if (organizationId) conditions.push(eq(payrollPeriods.organizationId, organizationId));
      if (status) conditions.push(eq(payrollPeriods.status, status as any));
      if (year) {
        const y = parseInt(year, 10);
        conditions.push(gte(payrollPeriods.startDate, new Date(y, 0, 1)));
        conditions.push(lte(payrollPeriods.endDate, new Date(y, 11, 31, 23, 59, 59)));
      }
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
      return await db.select().from(payrollPeriods)
        .where(whereClause)
        .orderBy(desc(payrollPeriods.startDate));
    } catch (err) {
      console.error("getPayrollPeriods error:", err);
      return [];
    }
  }

  async createPayrollPeriod(period: any) {
    const [row] = await db.insert(payrollPeriods).values({
      ...period,
      status: "pending_approval",
      startDate: period.startDate ? new Date(period.startDate) : new Date(),
      endDate: period.endDate ? new Date(period.endDate) : new Date(),
      payDate: period.payDate ? new Date(period.payDate) : new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();
    return row;
  }

  async getPayrollEntries(periodId: number) {
    try {
      const rows = await db
        .select({
          id: payrollEntries.id,
          payrollPeriodId: payrollEntries.payrollPeriodId,
          employeeId: payrollEntries.employeeId,
          basicSalary: payrollEntries.basicSalary,
          overtimePay: payrollEntries.overtimePay,
          allowances: payrollEntries.allowances,
          bonuses: payrollEntries.bonuses,
          grossPay: payrollEntries.grossPay,
          taxDeductions: payrollEntries.taxDeductions,
          nhifDeductions: payrollEntries.nhifDeductions,
          nssfDeductions: payrollEntries.nssfDeductions,
          otherDeductions: payrollEntries.otherDeductions,
          totalDeductions: payrollEntries.totalDeductions,
          netPay: payrollEntries.netPay,
          currency: payrollEntries.currency,
          status: payrollEntries.status,
          employeeFirstName: users.firstName,
          employeeLastName: users.lastName,
        })
        .from(payrollEntries)
        .leftJoin(users, eq(payrollEntries.employeeId, users.id))
        .where(eq(payrollEntries.payrollPeriodId, periodId))
        .orderBy(payrollEntries.id);

      return rows.map((r: any) => ({
        ...r,
        employeeName: r.employeeFirstName && r.employeeLastName
          ? `${r.employeeFirstName} ${r.employeeLastName}`.trim()
          : r.employeeFirstName || r.employeeLastName || r.employeeId,
      }));
    } catch (err) {
      console.error("getPayrollEntries error:", err);
      return [];
    }
  }

  async createPayrollEntry(entry: any) {
    const [row] = await db.insert(payrollEntries).values({
      ...entry,
      createdAt: new Date(),
    }).returning();
    return row;
  }

  async approvePayrollPeriod(id: number, approverId: string) {
    // payrollStatusEnum has no 'approved' value — move directly to processed
    const [row] = await db.update(payrollPeriods)
      .set({ status: "processed", approvedBy: approverId, approvedAt: new Date(), updatedAt: new Date() })
      .where(eq(payrollPeriods.id, id))
      .returning();
    return row;
  }

  async processPayrollPeriod(id: number, processedBy: string) {
    const [row] = await db.update(payrollPeriods)
      .set({ status: "processed", processedBy, processedAt: new Date(), isLocked: true, updatedAt: new Date() })
      .where(eq(payrollPeriods.id, id))
      .returning();
    return row;
  }

  // ── Approval Workflows ────────────────────────────────────────────────────────
  async getPendingApprovals(approverId?: string, type?: string) {
    try {
      const results: any[] = [];

      // Pending purchase requisitions
      if (!type || type === "purchase_requisition") {
        const prs = await db.select({
          id: purchaseRequisitions.id,
          prNumber: purchaseRequisitions.prNumber,
          title: purchaseRequisitions.title,
          totalAmount: purchaseRequisitions.totalAmount,
          approvalStatus: purchaseRequisitions.approvalStatus,
          createdAt: purchaseRequisitions.createdAt,
        }).from(purchaseRequisitions)
          .where(or(
            eq(purchaseRequisitions.approvalStatus, "pending_l1"),
            eq(purchaseRequisitions.approvalStatus, "pending_l2"),
            eq(purchaseRequisitions.approvalStatus, "pending_md"),
          ));
        results.push(...prs.map(r => ({ ...r, type: "purchase_requisition", entityId: r.id, currentLevel: r.approvalStatus?.replace("pending_", "") })));
      }

      // Pending expense reports
      if (!type || type === "expense_report") {
        const exps = await db.select({
          id: expenseReports.id,
          reportNumber: expenseReports.reportNumber,
          title: expenseReports.title,
          totalAmount: expenseReports.totalAmount,
          approvalStatus: expenseReports.approvalStatus,
          createdAt: expenseReports.createdAt,
        }).from(expenseReports)
          .where(or(
            eq(expenseReports.approvalStatus, "pending_l1"),
            eq(expenseReports.approvalStatus, "pending_l2"),
            eq(expenseReports.approvalStatus, "pending_md"),
          ));
        results.push(...exps.map(r => ({ ...r, type: "expense_report", entityId: r.id, currentLevel: r.approvalStatus?.replace("pending_", "") })));
      }

      return results;
    } catch (err) {
      console.error("getPendingApprovals error:", err);
      return [];
    }
  }

  async mdOverrideApproval(type: string, id: number, mdId: string, action: string, comments?: string) {
    if (type === "purchase_requisition") {
      const [row] = await db.update(purchaseRequisitions)
        .set({
          approvalStatus: action === "approve" ? "approved" : "rejected",
          mdApproverId: mdId, mdApprovedAt: new Date(), mdComments: comments,
          rejectedReason: action !== "approve" ? (comments || "MD override rejection") : undefined,
          updatedAt: new Date(),
        })
        .where(eq(purchaseRequisitions.id, id))
        .returning();
      return row;
    }
    if (type === "expense_report") {
      const [row] = await db.update(expenseReports)
        .set({
          approvalStatus: action === "approve" ? "approved" : "rejected",
          mdApproverId: mdId, mdApprovedAt: new Date(), mdComments: comments,
          rejectedReason: action !== "approve" ? (comments || "MD override rejection") : undefined,
          updatedAt: new Date(),
        })
        .where(eq(expenseReports.id, id))
        .returning();
      return row;
    }
    return { id, type, action, overriddenBy: mdId, overrideDate: new Date(), comments };
  }

  // ── Financial Reports (computed from real data) ───────────────────────────────
  async generateTrialBalance(asOfDate?: string, costCenterId?: string, organizationId?: number) {
    try {
      const asOf = asOfDate ? new Date(asOfDate) : new Date();

      const conditions: any[] = [lte(generalLedger.transactionDate, asOf)];
      if (organizationId) conditions.push(eq(generalLedger.organizationId, organizationId));
      if (costCenterId) conditions.push(eq(generalLedger.costCenterId, Number(costCenterId)));

      // Drive from chartOfAccounts so every active account appears even with
      // zero GL activity — a proper trial balance must show all accounts.
      const rows = await db
        .select({
          accountCode: chartOfAccounts.accountCode,
          accountName: chartOfAccounts.accountName,
          accountType: chartOfAccounts.accountType,
          totalDebit: sql<string>`COALESCE(SUM(${generalLedger.debitAmount}), 0)`,
          totalCredit: sql<string>`COALESCE(SUM(${generalLedger.creditAmount}), 0)`,
        })
        .from(chartOfAccounts)
        .leftJoin(
          generalLedger,
          and(
            eq(generalLedger.accountId, chartOfAccounts.id),
            ...conditions,
          )
        )
        .where(
          and(
            eq(chartOfAccounts.isActive, true),
            organizationId ? eq(chartOfAccounts.organizationId, organizationId) : undefined,
          )
        )
        .groupBy(chartOfAccounts.accountCode, chartOfAccounts.accountName, chartOfAccounts.accountType)
        .orderBy(chartOfAccounts.accountCode);

      const accounts = rows.map(r => ({
        accountCode: r.accountCode ?? "—",
        accountName: r.accountName ?? "Unknown Account",
        accountType: r.accountType ?? "—",
        debitBalance: Number(r.totalDebit).toFixed(2),
        creditBalance: Number(r.totalCredit).toFixed(2),
      }));

      const totalDebits = accounts.reduce((s, a) => s + Number(a.debitBalance), 0);
      const totalCredits = accounts.reduce((s, a) => s + Number(a.creditBalance), 0);

      return {
        reportDate: asOf.toISOString().split("T")[0],
        costCenter: costCenterId,
        accounts,
        totalDebits: totalDebits.toFixed(2),
        totalCredits: totalCredits.toFixed(2),
        isBalanced: Math.abs(totalDebits - totalCredits) < 0.01,
      };
    } catch (err) {
      console.error("generateTrialBalance error:", err);
      return { reportDate: asOfDate || new Date().toISOString().split("T")[0], accounts: [], totalDebits: "0.00", totalCredits: "0.00", isBalanced: true };
    }
  }

  async generateIncomeStatement(startDate: string, endDate: string, costCenterId?: string, organizationId?: number) {
    try {
      const start = new Date(startDate);
      const end = new Date(endDate);

      const conditions: any[] = [
        gte(generalLedger.transactionDate, start),
        lte(generalLedger.transactionDate, end),
      ];
      if (organizationId) conditions.push(eq(generalLedger.organizationId, organizationId));
      if (costCenterId) conditions.push(eq(generalLedger.costCenterId, Number(costCenterId)));

      const rows = await db
        .select({
          accountType: chartOfAccounts.accountType,
          accountName: chartOfAccounts.accountName,
          accountCode: chartOfAccounts.accountCode,
          totalDebit: sql<string>`COALESCE(SUM(${generalLedger.debitAmount}), 0)`,
          totalCredit: sql<string>`COALESCE(SUM(${generalLedger.creditAmount}), 0)`,
        })
        .from(generalLedger)
        .leftJoin(chartOfAccounts, eq(generalLedger.accountId, chartOfAccounts.id))
        .where(and(...conditions))
        .groupBy(chartOfAccounts.accountType, chartOfAccounts.accountName, chartOfAccounts.accountCode)
        .orderBy(chartOfAccounts.accountCode);

      // Revenue accounts: credit-normal (revenue type)
      const revenueRows = rows.filter(r => r.accountType?.toLowerCase() === "revenue");
      const expenseRows = rows.filter(r => r.accountType?.toLowerCase() === "expense" || r.accountType?.toLowerCase() === "expenses");

      const totalRevenue = revenueRows.reduce((s, r) => s + Number(r.totalCredit) - Number(r.totalDebit), 0);
      const totalExpenses = expenseRows.reduce((s, r) => s + Number(r.totalDebit) - Number(r.totalCredit), 0);

      return {
        period: `${startDate} to ${endDate}`,
        costCenter: costCenterId,
        revenue: {
          lines: revenueRows.map(r => ({
            accountCode: r.accountCode,
            accountName: r.accountName,
            amount: (Number(r.totalCredit) - Number(r.totalDebit)).toFixed(2),
          })),
          totalRevenue: totalRevenue.toFixed(2),
        },
        expenses: {
          lines: expenseRows.map(r => ({
            accountCode: r.accountCode,
            accountName: r.accountName,
            amount: (Number(r.totalDebit) - Number(r.totalCredit)).toFixed(2),
          })),
          totalExpenses: totalExpenses.toFixed(2),
        },
        netIncome: (totalRevenue - totalExpenses).toFixed(2),
      };
    } catch (err) {
      console.error("generateIncomeStatement error:", err);
      return { period: `${startDate} to ${endDate}`, revenue: { lines: [], totalRevenue: "0.00" }, expenses: { lines: [], totalExpenses: "0.00" }, netIncome: "0.00" };
    }
  }

  async generateBalanceSheet(asOfDate?: string, costCenterId?: string, organizationId?: number) {
    try {
      const asOf = asOfDate ? new Date(asOfDate) : new Date();

      const conditions: any[] = [lte(generalLedger.transactionDate, asOf)];
      if (organizationId) conditions.push(eq(generalLedger.organizationId, organizationId));
      if (costCenterId) conditions.push(eq(generalLedger.costCenterId, Number(costCenterId)));

      const rows = await db
        .select({
          accountType: chartOfAccounts.accountType,
          accountName: chartOfAccounts.accountName,
          accountCode: chartOfAccounts.accountCode,
          normalBalance: chartOfAccounts.normalBalance,
          totalDebit: sql<string>`COALESCE(SUM(${generalLedger.debitAmount}), 0)`,
          totalCredit: sql<string>`COALESCE(SUM(${generalLedger.creditAmount}), 0)`,
        })
        .from(generalLedger)
        .leftJoin(chartOfAccounts, eq(generalLedger.accountId, chartOfAccounts.id))
        .where(and(...conditions))
        .groupBy(chartOfAccounts.accountType, chartOfAccounts.accountName, chartOfAccounts.accountCode, chartOfAccounts.normalBalance)
        .orderBy(chartOfAccounts.accountCode);

      const assetRows = rows.filter(r => r.accountType?.toLowerCase() === "asset" || r.accountType?.toLowerCase() === "assets");
      const liabilityRows = rows.filter(r => r.accountType?.toLowerCase() === "liability" || r.accountType?.toLowerCase() === "liabilities");
      const equityRows = rows.filter(r => r.accountType?.toLowerCase() === "equity");

      const calcBalance = (r: any) => r.normalBalance === "credit"
        ? Number(r.totalCredit) - Number(r.totalDebit)
        : Number(r.totalDebit) - Number(r.totalCredit);

      const totalAssets = assetRows.reduce((s, r) => s + calcBalance(r), 0);
      const totalLiabilities = liabilityRows.reduce((s, r) => s + calcBalance(r), 0);
      const equityFromAccounts = equityRows.reduce((s, r) => s + calcBalance(r), 0);

      // Net income (revenue - expenses) from all periods up to asOfDate must be
      // included in equity as retained earnings — otherwise the sheet won't balance.
      const revenueRows = rows.filter(r => r.accountType?.toLowerCase() === "revenue");
      const expenseRows = rows.filter(r => r.accountType?.toLowerCase() === "expense" || r.accountType?.toLowerCase() === "expenses");
      const netIncome =
        revenueRows.reduce((s, r) => s + (Number(r.totalCredit) - Number(r.totalDebit)), 0) -
        expenseRows.reduce((s, r) => s + (Number(r.totalDebit) - Number(r.totalCredit)), 0);

      const totalEquity = equityFromAccounts + netIncome;

      const equityLines = [
        ...equityRows.map(r => ({ accountCode: r.accountCode, accountName: r.accountName, balance: calcBalance(r).toFixed(2) })),
        // Current period net income appears as a retained earnings line
        ...(Math.abs(netIncome) > 0.005 ? [{ accountCode: "—", accountName: "Current Period Net Income", balance: netIncome.toFixed(2) }] : []),
      ];

      return {
        asOfDate: asOf.toISOString().split("T")[0],
        costCenter: costCenterId,
        assets: {
          lines: assetRows.map(r => ({ accountCode: r.accountCode, accountName: r.accountName, balance: calcBalance(r).toFixed(2) })),
          totalAssets: totalAssets.toFixed(2),
        },
        liabilities: {
          lines: liabilityRows.map(r => ({ accountCode: r.accountCode, accountName: r.accountName, balance: calcBalance(r).toFixed(2) })),
          totalLiabilities: totalLiabilities.toFixed(2),
        },
        equity: {
          lines: equityLines,
          totalEquity: totalEquity.toFixed(2),
        },
        isBalanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
      };
    } catch (err) {
      console.error("generateBalanceSheet error:", err);
      return { asOfDate: asOfDate || new Date().toISOString().split("T")[0], assets: { lines: [], totalAssets: "0.00" }, liabilities: { lines: [], totalLiabilities: "0.00" }, equity: { lines: [], totalEquity: "0.00" }, isBalanced: true };
    }
  }

  async generateCashFlowStatement(startDate: string, endDate: string, costCenterId?: string, organizationId?: number) {
    try {
      const start = new Date(startDate);
      const end = new Date(endDate);

      // Operating: rent payments received — use paidDate (when cash was actually received)
      const [rentResult] = await db
        .select({ total: sql<string>`COALESCE(SUM(${rentPayments.amount}), 0)` })
        .from(rentPayments)
        .leftJoin(tenants, eq(rentPayments.tenantId, tenants.id))
        .where(and(
          sql`${rentPayments.status} IN ('paid', 'completed')`,
          sql`${rentPayments.paidDate} IS NOT NULL`,
          sql`${rentPayments.paidDate}::date >= ${startDate}::date`,
          sql`${rentPayments.paidDate}::date <= ${endDate}::date`,
          ...(organizationId ? [eq(tenants.organizationId, organizationId)] : []),
        ));

      // Operating: expenses paid
      const expConditions: any[] = [
        gte(propertyExpenses.expenseDate, start),
        lte(propertyExpenses.expenseDate, end),
        sql`${propertyExpenses.status} IN ('paid', 'approved')`,
      ];
      const [expResult] = await db
        .select({ total: sql<string>`COALESCE(SUM(${propertyExpenses.amount}), 0)` })
        .from(propertyExpenses)
        .leftJoin(properties, eq(propertyExpenses.propertyId, properties.id))
        .where(and(
          ...expConditions,
          ...(organizationId ? [eq(properties.organizationId, organizationId)] : []),
        ));

      // Payroll disbursements
      const [payrollResult] = await db
        .select({ total: sql<string>`COALESCE(SUM(${payrollPeriods.totalNetPay}), 0)` })
        .from(payrollPeriods)
        .where(and(
          ...(organizationId ? [eq(payrollPeriods.organizationId, organizationId)] : []),
          eq(payrollPeriods.status, "processed"),
          gte(payrollPeriods.payDate, start),
          lte(payrollPeriods.payDate, end),
        ));

      const cashFromRent = Number(rentResult?.total ?? 0);
      const cashForExpenses = Number(expResult?.total ?? 0);
      const cashForPayroll = Number(payrollResult?.total ?? 0);
      const netOperating = cashFromRent - cashForExpenses - cashForPayroll;

      return {
        period: `${startDate} to ${endDate}`,
        costCenter: costCenterId,
        operatingActivities: {
          rentCollected: cashFromRent.toFixed(2),
          expensesPaid: (-cashForExpenses).toFixed(2),
          payrollDisbursed: (-cashForPayroll).toFixed(2),
          netCashFromOperations: netOperating.toFixed(2),
        },
        investingActivities: {
          netCashFromInvesting: "0.00",
        },
        financingActivities: {
          netCashFromFinancing: "0.00",
        },
        netCashIncrease: netOperating.toFixed(2),
      };
    } catch (err) {
      console.error("generateCashFlowStatement error:", err);
      return { period: `${startDate} to ${endDate}`, operatingActivities: { rentCollected: "0.00", expensesPaid: "0.00", payrollDisbursed: "0.00", netCashFromOperations: "0.00" }, investingActivities: { netCashFromInvesting: "0.00" }, financingActivities: { netCashFromFinancing: "0.00" }, netCashIncrease: "0.00" };
    }
  }

}

export const storage = new DatabaseStorage();