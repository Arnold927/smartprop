import { relations } from "drizzle-orm/relations";
import { tenants, tenantReviews, properties, units, users, tenantBehaviorLogs, userActivity, organizations, userFeatureInteractions, featureAnnouncements, userFeedback, utilityAccounts, utilityProviders, userNotificationPreferences, utilityBills, utilityMeterReadings, userRoleAssignments, userRoles, visitors, voiceCommands, workOrders, workOrderApprovals, workOrderExpenses, contractors, workOrderTasks, maintenanceRequests, projects, broadcastMessages, broadcastRecipients, contractorPayments, propertyExpenses, encryptionKeys, dataEncryption, parkingSpaces, parkingAssignments, registeredVehicles, payrollPeriods, payrollEntries, projectDocuments, projectTasks, trustAccounts, trustAccountTransactions, visitorLog, workOrderProgress, paymentMethods, rentCollections, rentCollectionReminders, staffMembers, payrollRecords, timeTracking, workOrderCharges, workOrderMaterials, workOrderComments, whatsappMessages, tenantShortRentals, tenantShortBookings, whatsappTemplates, aiConversations, aiPredictions, arrears, arrearsActions, auditLogs, automatedPaymentRules, paymentProviders, bankAccounts, billingCycles, blockchainTransactions, caretakers, chartOfAccounts, complaintsPhotos, diasporaContracts, constructionUpdates, contractorCategories, contractorsRegistry, contractorWorkOrders, contractorReviews, serviceContracts, costCenters, contractorServices, contractorPerformance, diasporaPaymentSchedule, diasporaPayments, escrowAccounts, diasporaCertificates, expenseReports, expenseLineItems, feedbackVotes, financialReconciliation, generalLedger, journalEntries, invoiceReminders, iotDevices, invoices, ledgerAccounts, managedPropertyMaintenance, propertyManagementAgreements, landlordPortalSessions, paymentTransactions, mobileMoney, journalEntryLines, ownerFinancialStatements, mpesaTransactions, rentPayments, serviceCharges, ownershipCertificates, paymentAllocationRules, organizationSettings, paymentReminders, purchaseOrders, poLineItems, prLineItems, projectMilestones, projectTeam, projectExpenses, projectTimeTracking, purchaseRequisitions, propertyManagers, propertyAvailability, shortTermBookings, propertyBlockchainRecords, recurringCharges, rentToOwnAgreements, rentToOwnPayments, riskAssessments, scheduledDisbursements, smartAutomations, serviceSchedules, smartContracts } from "./schema";

export const tenantReviewsRelations = relations(tenantReviews, ({one}) => ({
	tenant: one(tenants, {
		fields: [tenantReviews.tenantId],
		references: [tenants.id]
	}),
	property: one(properties, {
		fields: [tenantReviews.propertyId],
		references: [properties.id]
	}),
	unit: one(units, {
		fields: [tenantReviews.unitId],
		references: [units.id]
	}),
	user: one(users, {
		fields: [tenantReviews.responseBy],
		references: [users.id]
	}),
}));

export const tenantsRelations = relations(tenants, ({one, many}) => ({
	tenantReviews: many(tenantReviews),
	tenantBehaviorLogs: many(tenantBehaviorLogs),
	visitors: many(visitors),
	organization: one(organizations, {
		fields: [tenants.organizationId],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [tenants.userId],
		references: [users.id]
	}),
	parkingAssignments: many(parkingAssignments),
	paymentMethods: many(paymentMethods),
	rentCollections: many(rentCollections),
	tenantShortRentals: many(tenantShortRentals),
	arrears: many(arrears),
	automatedPaymentRules: many(automatedPaymentRules),
	invoiceReminders: many(invoiceReminders),
	invoices: many(invoices),
	journalEntries: many(journalEntries),
	journalEntryLines: many(journalEntryLines),
	ownerFinancialStatements: many(ownerFinancialStatements),
	mpesaTransactions: many(mpesaTransactions),
	ownershipCertificates: many(ownershipCertificates),
	paymentAllocationRules: many(paymentAllocationRules),
	paymentReminders: many(paymentReminders),
	paymentTransactions: many(paymentTransactions),
	propertyManagementAgreements: many(propertyManagementAgreements),
	riskAssessments: many(riskAssessments),
	rentToOwnAgreements: many(rentToOwnAgreements),
}));

export const propertiesRelations = relations(properties, ({one, many}) => ({
	tenantReviews: many(tenantReviews),
	units: many(units),
	utilityAccounts: many(utilityAccounts),
	userRoleAssignments: many(userRoleAssignments),
	visitors: many(visitors),
	arrears: many(arrears),
	automatedPaymentRules: many(automatedPaymentRules),
	billingCycles: many(billingCycles),
	blockchainTransactions: many(blockchainTransactions),
	caretakers: many(caretakers),
	contractorWorkOrders: many(contractorWorkOrders),
	costCenters: many(costCenters),
	escrowAccounts: many(escrowAccounts),
	diasporaContracts: many(diasporaContracts),
	expenseLineItems: many(expenseLineItems),
	generalLedgers: many(generalLedger),
	iotDevices: many(iotDevices),
	invoices: many(invoices),
	managedPropertyMaintenances: many(managedPropertyMaintenance),
	journalEntries: many(journalEntries),
	journalEntryLines: many(journalEntryLines),
	ownerFinancialStatements: many(ownerFinancialStatements),
	ownershipCertificates: many(ownershipCertificates),
	parkingSpaces: many(parkingSpaces),
	paymentAllocationRules: many(paymentAllocationRules),
	paymentTransactions: many(paymentTransactions),
	organization: one(organizations, {
		fields: [properties.organizationId],
		references: [organizations.id]
	}),
	projects: many(projects),
	propertyManagementAgreements: many(propertyManagementAgreements),
	propertyAvailabilities: many(propertyAvailability),
	propertyExpenses: many(propertyExpenses),
	propertyBlockchainRecords: many(propertyBlockchainRecords),
	recurringCharges: many(recurringCharges),
	registeredVehicles: many(registeredVehicles),
	scheduledDisbursements: many(scheduledDisbursements),
	rentToOwnAgreements: many(rentToOwnAgreements),
	shortTermBookings: many(shortTermBookings),
	serviceCharges: many(serviceCharges),
	smartAutomations: many(smartAutomations),
	serviceSchedules: many(serviceSchedules),
	smartContracts: many(smartContracts),
	serviceContracts: many(serviceContracts),
}));

export const unitsRelations = relations(units, ({one, many}) => ({
	tenantReviews: many(tenantReviews),
	organization: one(organizations, {
		fields: [units.organizationId],
		references: [organizations.id]
	}),
	property: one(properties, {
		fields: [units.propertyId],
		references: [properties.id]
	}),
	utilityAccounts: many(utilityAccounts),
	visitors: many(visitors),
	rentCollections: many(rentCollections),
	tenantShortRentals: many(tenantShortRentals),
	arrears: many(arrears),
	costCenters: many(costCenters),
	expenseLineItems: many(expenseLineItems),
	generalLedgers: many(generalLedger),
	iotDevices: many(iotDevices),
	invoices: many(invoices),
	paymentTransactions: many(paymentTransactions),
	projects: many(projects),
	recurringCharges: many(recurringCharges),
	serviceCharges: many(serviceCharges),
}));

export const usersRelations = relations(users, ({one, many}) => ({
	tenantReviews: many(tenantReviews),
	userActivities: many(userActivity),
	userFeatureInteractions: many(userFeatureInteractions),
	userFeedbacks: many(userFeedback),
	userNotificationPreferences: many(userNotificationPreferences),
	organization: one(organizations, {
		fields: [users.organizationId],
		references: [organizations.id]
	}),
	userRoleAssignments: many(userRoleAssignments),
	voiceCommands: many(voiceCommands),
	tenants: many(tenants),
	payrollEntries: many(payrollEntries),
	aiConversations: many(aiConversations),
	auditLogs: many(auditLogs),
	caretakers: many(caretakers),
	costCenters: many(costCenters),
	feedbackVotes: many(feedbackVotes),
	generalLedgers: many(generalLedger),
	expenseReports_employeeId: many(expenseReports, {
		relationName: "expenseReports_employeeId_users_id"
	}),
	expenseReports_l1ApproverId: many(expenseReports, {
		relationName: "expenseReports_l1ApproverId_users_id"
	}),
	expenseReports_l2ApproverId: many(expenseReports, {
		relationName: "expenseReports_l2ApproverId_users_id"
	}),
	expenseReports_mdApproverId: many(expenseReports, {
		relationName: "expenseReports_mdApproverId_users_id"
	}),
	landlordPortalSessions: many(landlordPortalSessions),
	payrollPeriods_approvedBy: many(payrollPeriods, {
		relationName: "payrollPeriods_approvedBy_users_id"
	}),
	payrollPeriods_processedBy: many(payrollPeriods, {
		relationName: "payrollPeriods_processedBy_users_id"
	}),
	projects: many(projects),
	propertyManagers: many(propertyManagers),
	purchaseOrders: many(purchaseOrders),
	purchaseRequisitions_requestorId: many(purchaseRequisitions, {
		relationName: "purchaseRequisitions_requestorId_users_id"
	}),
	purchaseRequisitions_l1ApproverId: many(purchaseRequisitions, {
		relationName: "purchaseRequisitions_l1ApproverId_users_id"
	}),
	purchaseRequisitions_l2ApproverId: many(purchaseRequisitions, {
		relationName: "purchaseRequisitions_l2ApproverId_users_id"
	}),
	purchaseRequisitions_mdApproverId: many(purchaseRequisitions, {
		relationName: "purchaseRequisitions_mdApproverId_users_id"
	}),
}));

export const tenantBehaviorLogsRelations = relations(tenantBehaviorLogs, ({one}) => ({
	tenant: one(tenants, {
		fields: [tenantBehaviorLogs.tenantId],
		references: [tenants.id]
	}),
}));

export const userActivityRelations = relations(userActivity, ({one}) => ({
	user: one(users, {
		fields: [userActivity.userId],
		references: [users.id]
	}),
	organization: one(organizations, {
		fields: [userActivity.organizationId],
		references: [organizations.id]
	}),
}));

export const organizationsRelations = relations(organizations, ({many}) => ({
	userActivities: many(userActivity),
	units: many(units),
	userFeedbacks: many(userFeedback),
	users: many(users),
	voiceCommands: many(voiceCommands),
	tenants: many(tenants),
	staffMembers: many(staffMembers),
	whatsappMessages: many(whatsappMessages),
	tenantShortRentals: many(tenantShortRentals),
	tenantShortBookings: many(tenantShortBookings),
	whatsappTemplates: many(whatsappTemplates),
	aiConversations: many(aiConversations),
	aiPredictions: many(aiPredictions),
	blockchainTransactions: many(blockchainTransactions),
	chartOfAccounts: many(chartOfAccounts),
	costCenters: many(costCenters),
	diasporaContracts: many(diasporaContracts),
	generalLedgers: many(generalLedger),
	iotDevices: many(iotDevices),
	expenseReports: many(expenseReports),
	featureAnnouncements: many(featureAnnouncements),
	organizationSettings: many(organizationSettings),
	payrollPeriods: many(payrollPeriods),
	properties: many(properties),
	purchaseOrders: many(purchaseOrders),
	purchaseRequisitions: many(purchaseRequisitions),
	smartAutomations: many(smartAutomations),
	smartContracts: many(smartContracts),
}));

export const userFeatureInteractionsRelations = relations(userFeatureInteractions, ({one}) => ({
	user: one(users, {
		fields: [userFeatureInteractions.userId],
		references: [users.id]
	}),
	featureAnnouncement: one(featureAnnouncements, {
		fields: [userFeatureInteractions.featureAnnouncementId],
		references: [featureAnnouncements.id]
	}),
}));

export const featureAnnouncementsRelations = relations(featureAnnouncements, ({one, many}) => ({
	userFeatureInteractions: many(userFeatureInteractions),
	organization: one(organizations, {
		fields: [featureAnnouncements.organizationId],
		references: [organizations.id]
	}),
}));

export const userFeedbackRelations = relations(userFeedback, ({one, many}) => ({
	user: one(users, {
		fields: [userFeedback.userId],
		references: [users.id]
	}),
	organization: one(organizations, {
		fields: [userFeedback.organizationId],
		references: [organizations.id]
	}),
	feedbackVotes: many(feedbackVotes),
}));

export const utilityAccountsRelations = relations(utilityAccounts, ({one, many}) => ({
	property: one(properties, {
		fields: [utilityAccounts.propertyId],
		references: [properties.id]
	}),
	unit: one(units, {
		fields: [utilityAccounts.unitId],
		references: [units.id]
	}),
	utilityProvider: one(utilityProviders, {
		fields: [utilityAccounts.providerId],
		references: [utilityProviders.id]
	}),
	utilityBills: many(utilityBills),
	utilityMeterReadings: many(utilityMeterReadings),
}));

export const utilityProvidersRelations = relations(utilityProviders, ({many}) => ({
	utilityAccounts: many(utilityAccounts),
}));

export const userNotificationPreferencesRelations = relations(userNotificationPreferences, ({one}) => ({
	user: one(users, {
		fields: [userNotificationPreferences.userId],
		references: [users.id]
	}),
}));

export const utilityBillsRelations = relations(utilityBills, ({one}) => ({
	utilityAccount: one(utilityAccounts, {
		fields: [utilityBills.accountId],
		references: [utilityAccounts.id]
	}),
}));

export const utilityMeterReadingsRelations = relations(utilityMeterReadings, ({one}) => ({
	utilityAccount: one(utilityAccounts, {
		fields: [utilityMeterReadings.accountId],
		references: [utilityAccounts.id]
	}),
}));

export const userRoleAssignmentsRelations = relations(userRoleAssignments, ({one}) => ({
	user: one(users, {
		fields: [userRoleAssignments.userId],
		references: [users.id]
	}),
	userRole: one(userRoles, {
		fields: [userRoleAssignments.roleId],
		references: [userRoles.id]
	}),
	property: one(properties, {
		fields: [userRoleAssignments.propertyId],
		references: [properties.id]
	}),
}));

export const userRolesRelations = relations(userRoles, ({many}) => ({
	userRoleAssignments: many(userRoleAssignments),
}));

export const visitorsRelations = relations(visitors, ({one, many}) => ({
	property: one(properties, {
		fields: [visitors.propertyId],
		references: [properties.id]
	}),
	unit: one(units, {
		fields: [visitors.unitId],
		references: [units.id]
	}),
	tenant: one(tenants, {
		fields: [visitors.tenantId],
		references: [tenants.id]
	}),
	visitorLogs: many(visitorLog),
}));

export const voiceCommandsRelations = relations(voiceCommands, ({one}) => ({
	organization: one(organizations, {
		fields: [voiceCommands.organizationId],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [voiceCommands.userId],
		references: [users.id]
	}),
}));

export const workOrderApprovalsRelations = relations(workOrderApprovals, ({one}) => ({
	workOrder: one(workOrders, {
		fields: [workOrderApprovals.workOrderId],
		references: [workOrders.id]
	}),
}));

export const workOrdersRelations = relations(workOrders, ({one, many}) => ({
	workOrderApprovals: many(workOrderApprovals),
	workOrderExpenses: many(workOrderExpenses),
	workOrderTasks: many(workOrderTasks),
	maintenanceRequest: one(maintenanceRequests, {
		fields: [workOrders.maintenanceRequestId],
		references: [maintenanceRequests.id]
	}),
	project: one(projects, {
		fields: [workOrders.projectId],
		references: [projects.id]
	}),
	contractor: one(contractors, {
		fields: [workOrders.contractorId],
		references: [contractors.id]
	}),
	contractorPayments: many(contractorPayments),
	workOrderProgresses: many(workOrderProgress),
	workOrderComments: many(workOrderComments),
}));

export const workOrderExpensesRelations = relations(workOrderExpenses, ({one}) => ({
	workOrder: one(workOrders, {
		fields: [workOrderExpenses.workOrderId],
		references: [workOrders.id]
	}),
	contractor: one(contractors, {
		fields: [workOrderExpenses.contractorId],
		references: [contractors.id]
	}),
}));

export const contractorsRelations = relations(contractors, ({one, many}) => ({
	workOrderExpenses: many(workOrderExpenses),
	workOrders: many(workOrders),
	contractorPayments: many(contractorPayments),
	contractorReviews: many(contractorReviews),
	contractorWorkOrders: many(contractorWorkOrders),
	contractorServices: many(contractorServices),
	contractorPerformances: many(contractorPerformance),
	contractorCategory: one(contractorCategories, {
		fields: [contractors.categoryId],
		references: [contractorCategories.id]
	}),
	managedPropertyMaintenances: many(managedPropertyMaintenance),
	maintenanceRequests: many(maintenanceRequests),
	propertyExpenses: many(propertyExpenses),
	serviceSchedules: many(serviceSchedules),
	serviceContracts: many(serviceContracts),
}));

export const workOrderTasksRelations = relations(workOrderTasks, ({one, many}) => ({
	workOrder: one(workOrders, {
		fields: [workOrderTasks.workOrderId],
		references: [workOrders.id]
	}),
	workOrderProgresses: many(workOrderProgress),
}));

export const maintenanceRequestsRelations = relations(maintenanceRequests, ({one, many}) => ({
	workOrders: many(workOrders),
	workOrderCharges: many(workOrderCharges),
	workOrderMaterials: many(workOrderMaterials),
	complaintsPhotos: many(complaintsPhotos),
	contractor: one(contractors, {
		fields: [maintenanceRequests.contractorId],
		references: [contractors.id]
	}),
}));

export const projectsRelations = relations(projects, ({one, many}) => ({
	workOrders: many(workOrders),
	projectDocuments: many(projectDocuments),
	projectTasks: many(projectTasks),
	projectMilestones: many(projectMilestones),
	projectTeams: many(projectTeam),
	projectExpenses: many(projectExpenses),
	projectTimeTrackings: many(projectTimeTracking),
	property: one(properties, {
		fields: [projects.propertyId],
		references: [properties.id]
	}),
	unit: one(units, {
		fields: [projects.unitId],
		references: [units.id]
	}),
	user: one(users, {
		fields: [projects.managerId],
		references: [users.id]
	}),
}));

export const broadcastRecipientsRelations = relations(broadcastRecipients, ({one}) => ({
	broadcastMessage: one(broadcastMessages, {
		fields: [broadcastRecipients.broadcastId],
		references: [broadcastMessages.id]
	}),
}));

export const broadcastMessagesRelations = relations(broadcastMessages, ({many}) => ({
	broadcastRecipients: many(broadcastRecipients),
}));

export const contractorPaymentsRelations = relations(contractorPayments, ({one}) => ({
	contractor: one(contractors, {
		fields: [contractorPayments.contractorId],
		references: [contractors.id]
	}),
	workOrder: one(workOrders, {
		fields: [contractorPayments.workOrderId],
		references: [workOrders.id]
	}),
	propertyExpense: one(propertyExpenses, {
		fields: [contractorPayments.expenseId],
		references: [propertyExpenses.id]
	}),
}));

export const propertyExpensesRelations = relations(propertyExpenses, ({one, many}) => ({
	contractorPayments: many(contractorPayments),
	property: one(properties, {
		fields: [propertyExpenses.propertyId],
		references: [properties.id]
	}),
	contractor: one(contractors, {
		fields: [propertyExpenses.contractorId],
		references: [contractors.id]
	}),
}));

export const dataEncryptionRelations = relations(dataEncryption, ({one}) => ({
	encryptionKey: one(encryptionKeys, {
		fields: [dataEncryption.keyId],
		references: [encryptionKeys.keyId]
	}),
}));

export const encryptionKeysRelations = relations(encryptionKeys, ({many}) => ({
	dataEncryptions: many(dataEncryption),
}));

export const parkingAssignmentsRelations = relations(parkingAssignments, ({one}) => ({
	parkingSpace: one(parkingSpaces, {
		fields: [parkingAssignments.parkingSpaceId],
		references: [parkingSpaces.id]
	}),
	registeredVehicle: one(registeredVehicles, {
		fields: [parkingAssignments.vehicleId],
		references: [registeredVehicles.id]
	}),
	tenant: one(tenants, {
		fields: [parkingAssignments.tenantId],
		references: [tenants.id]
	}),
}));

export const parkingSpacesRelations = relations(parkingSpaces, ({one, many}) => ({
	parkingAssignments: many(parkingAssignments),
	property: one(properties, {
		fields: [parkingSpaces.propertyId],
		references: [properties.id]
	}),
}));

export const registeredVehiclesRelations = relations(registeredVehicles, ({one, many}) => ({
	parkingAssignments: many(parkingAssignments),
	property: one(properties, {
		fields: [registeredVehicles.propertyId],
		references: [properties.id]
	}),
}));

export const payrollEntriesRelations = relations(payrollEntries, ({one}) => ({
	payrollPeriod: one(payrollPeriods, {
		fields: [payrollEntries.payrollPeriodId],
		references: [payrollPeriods.id]
	}),
	user: one(users, {
		fields: [payrollEntries.employeeId],
		references: [users.id]
	}),
}));

export const payrollPeriodsRelations = relations(payrollPeriods, ({one, many}) => ({
	payrollEntries: many(payrollEntries),
	organization: one(organizations, {
		fields: [payrollPeriods.organizationId],
		references: [organizations.id]
	}),
	user_approvedBy: one(users, {
		fields: [payrollPeriods.approvedBy],
		references: [users.id],
		relationName: "payrollPeriods_approvedBy_users_id"
	}),
	user_processedBy: one(users, {
		fields: [payrollPeriods.processedBy],
		references: [users.id],
		relationName: "payrollPeriods_processedBy_users_id"
	}),
}));

export const projectDocumentsRelations = relations(projectDocuments, ({one}) => ({
	project: one(projects, {
		fields: [projectDocuments.projectId],
		references: [projects.id]
	}),
	projectTask: one(projectTasks, {
		fields: [projectDocuments.taskId],
		references: [projectTasks.id]
	}),
}));

export const projectTasksRelations = relations(projectTasks, ({one, many}) => ({
	projectDocuments: many(projectDocuments),
	project: one(projects, {
		fields: [projectTasks.projectId],
		references: [projects.id]
	}),
	projectExpenses: many(projectExpenses),
	projectTimeTrackings: many(projectTimeTracking),
}));

export const trustAccountTransactionsRelations = relations(trustAccountTransactions, ({one}) => ({
	trustAccount: one(trustAccounts, {
		fields: [trustAccountTransactions.trustAccountId],
		references: [trustAccounts.id]
	}),
}));

export const trustAccountsRelations = relations(trustAccounts, ({many}) => ({
	trustAccountTransactions: many(trustAccountTransactions),
}));

export const visitorLogRelations = relations(visitorLog, ({one}) => ({
	visitor: one(visitors, {
		fields: [visitorLog.visitorId],
		references: [visitors.id]
	}),
}));

export const workOrderProgressRelations = relations(workOrderProgress, ({one}) => ({
	workOrder: one(workOrders, {
		fields: [workOrderProgress.workOrderId],
		references: [workOrders.id]
	}),
	workOrderTask: one(workOrderTasks, {
		fields: [workOrderProgress.taskId],
		references: [workOrderTasks.id]
	}),
}));

export const paymentMethodsRelations = relations(paymentMethods, ({one}) => ({
	tenant: one(tenants, {
		fields: [paymentMethods.tenantId],
		references: [tenants.id]
	}),
}));

export const rentCollectionsRelations = relations(rentCollections, ({one, many}) => ({
	tenant: one(tenants, {
		fields: [rentCollections.tenantId],
		references: [tenants.id]
	}),
	unit: one(units, {
		fields: [rentCollections.unitId],
		references: [units.id]
	}),
	rentCollectionReminders: many(rentCollectionReminders),
}));

export const rentCollectionRemindersRelations = relations(rentCollectionReminders, ({one}) => ({
	rentCollection: one(rentCollections, {
		fields: [rentCollectionReminders.rentCollectionId],
		references: [rentCollections.id]
	}),
}));

export const staffMembersRelations = relations(staffMembers, ({one, many}) => ({
	organization: one(organizations, {
		fields: [staffMembers.organizationId],
		references: [organizations.id]
	}),
	payrollRecords: many(payrollRecords),
	timeTrackings: many(timeTracking),
}));

export const payrollRecordsRelations = relations(payrollRecords, ({one}) => ({
	staffMember: one(staffMembers, {
		fields: [payrollRecords.staffId],
		references: [staffMembers.id]
	}),
}));

export const timeTrackingRelations = relations(timeTracking, ({one}) => ({
	staffMember: one(staffMembers, {
		fields: [timeTracking.staffId],
		references: [staffMembers.id]
	}),
}));

export const workOrderChargesRelations = relations(workOrderCharges, ({one}) => ({
	maintenanceRequest: one(maintenanceRequests, {
		fields: [workOrderCharges.workOrderId],
		references: [maintenanceRequests.id]
	}),
}));

export const workOrderMaterialsRelations = relations(workOrderMaterials, ({one}) => ({
	maintenanceRequest: one(maintenanceRequests, {
		fields: [workOrderMaterials.workOrderId],
		references: [maintenanceRequests.id]
	}),
}));

export const workOrderCommentsRelations = relations(workOrderComments, ({one, many}) => ({
	workOrder: one(workOrders, {
		fields: [workOrderComments.workOrderId],
		references: [workOrders.id]
	}),
	workOrderComment: one(workOrderComments, {
		fields: [workOrderComments.parentCommentId],
		references: [workOrderComments.id],
		relationName: "workOrderComments_parentCommentId_workOrderComments_id"
	}),
	workOrderComments: many(workOrderComments, {
		relationName: "workOrderComments_parentCommentId_workOrderComments_id"
	}),
}));

export const whatsappMessagesRelations = relations(whatsappMessages, ({one}) => ({
	organization: one(organizations, {
		fields: [whatsappMessages.organizationId],
		references: [organizations.id]
	}),
}));

export const tenantShortRentalsRelations = relations(tenantShortRentals, ({one, many}) => ({
	organization: one(organizations, {
		fields: [tenantShortRentals.organizationId],
		references: [organizations.id]
	}),
	unit: one(units, {
		fields: [tenantShortRentals.unitId],
		references: [units.id]
	}),
	tenant: one(tenants, {
		fields: [tenantShortRentals.tenantId],
		references: [tenants.id]
	}),
	tenantShortBookings: many(tenantShortBookings),
}));

export const tenantShortBookingsRelations = relations(tenantShortBookings, ({one}) => ({
	organization: one(organizations, {
		fields: [tenantShortBookings.organizationId],
		references: [organizations.id]
	}),
	tenantShortRental: one(tenantShortRentals, {
		fields: [tenantShortBookings.rentalListingId],
		references: [tenantShortRentals.id]
	}),
}));

export const whatsappTemplatesRelations = relations(whatsappTemplates, ({one}) => ({
	organization: one(organizations, {
		fields: [whatsappTemplates.organizationId],
		references: [organizations.id]
	}),
}));

export const aiConversationsRelations = relations(aiConversations, ({one}) => ({
	organization: one(organizations, {
		fields: [aiConversations.organizationId],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [aiConversations.userId],
		references: [users.id]
	}),
}));

export const aiPredictionsRelations = relations(aiPredictions, ({one}) => ({
	organization: one(organizations, {
		fields: [aiPredictions.organizationId],
		references: [organizations.id]
	}),
}));

export const arrearsRelations = relations(arrears, ({one, many}) => ({
	tenant: one(tenants, {
		fields: [arrears.tenantId],
		references: [tenants.id]
	}),
	unit: one(units, {
		fields: [arrears.unitId],
		references: [units.id]
	}),
	property: one(properties, {
		fields: [arrears.propertyId],
		references: [properties.id]
	}),
	arrearsActions: many(arrearsActions),
	paymentReminders: many(paymentReminders),
}));

export const arrearsActionsRelations = relations(arrearsActions, ({one}) => ({
	arrear: one(arrears, {
		fields: [arrearsActions.arrearsId],
		references: [arrears.id]
	}),
}));

export const auditLogsRelations = relations(auditLogs, ({one}) => ({
	user: one(users, {
		fields: [auditLogs.userId],
		references: [users.id]
	}),
}));

export const automatedPaymentRulesRelations = relations(automatedPaymentRules, ({one}) => ({
	property: one(properties, {
		fields: [automatedPaymentRules.propertyId],
		references: [properties.id]
	}),
	tenant: one(tenants, {
		fields: [automatedPaymentRules.tenantId],
		references: [tenants.id]
	}),
}));

export const bankAccountsRelations = relations(bankAccounts, ({one, many}) => ({
	paymentProvider: one(paymentProviders, {
		fields: [bankAccounts.providerId],
		references: [paymentProviders.id]
	}),
	escrowAccounts: many(escrowAccounts),
	financialReconciliations: many(financialReconciliation),
}));

export const paymentProvidersRelations = relations(paymentProviders, ({many}) => ({
	bankAccounts: many(bankAccounts),
	mobileMonies: many(mobileMoney),
	paymentTransactions: many(paymentTransactions),
}));

export const billingCyclesRelations = relations(billingCycles, ({one}) => ({
	property: one(properties, {
		fields: [billingCycles.propertyId],
		references: [properties.id]
	}),
}));

export const blockchainTransactionsRelations = relations(blockchainTransactions, ({one}) => ({
	organization: one(organizations, {
		fields: [blockchainTransactions.organizationId],
		references: [organizations.id]
	}),
	property: one(properties, {
		fields: [blockchainTransactions.propertyId],
		references: [properties.id]
	}),
}));

export const caretakersRelations = relations(caretakers, ({one}) => ({
	user: one(users, {
		fields: [caretakers.userId],
		references: [users.id]
	}),
	property: one(properties, {
		fields: [caretakers.propertyId],
		references: [properties.id]
	}),
}));

export const chartOfAccountsRelations = relations(chartOfAccounts, ({one, many}) => ({
	organization: one(organizations, {
		fields: [chartOfAccounts.organizationId],
		references: [organizations.id]
	}),
	chartOfAccount: one(chartOfAccounts, {
		fields: [chartOfAccounts.parentAccountId],
		references: [chartOfAccounts.id],
		relationName: "chartOfAccounts_parentAccountId_chartOfAccounts_id"
	}),
	chartOfAccounts: many(chartOfAccounts, {
		relationName: "chartOfAccounts_parentAccountId_chartOfAccounts_id"
	}),
	expenseLineItems: many(expenseLineItems),
	generalLedgers: many(generalLedger),
	poLineItems: many(poLineItems),
	prLineItems: many(prLineItems),
}));

export const complaintsPhotosRelations = relations(complaintsPhotos, ({one}) => ({
	maintenanceRequest: one(maintenanceRequests, {
		fields: [complaintsPhotos.maintenanceRequestId],
		references: [maintenanceRequests.id]
	}),
}));

export const constructionUpdatesRelations = relations(constructionUpdates, ({one}) => ({
	diasporaContract: one(diasporaContracts, {
		fields: [constructionUpdates.diasporaContractId],
		references: [diasporaContracts.id]
	}),
}));

export const diasporaContractsRelations = relations(diasporaContracts, ({one, many}) => ({
	constructionUpdates: many(constructionUpdates),
	diasporaPaymentSchedules: many(diasporaPaymentSchedule),
	diasporaCertificates: many(diasporaCertificates),
	organization: one(organizations, {
		fields: [diasporaContracts.organizationId],
		references: [organizations.id]
	}),
	property: one(properties, {
		fields: [diasporaContracts.propertyId],
		references: [properties.id]
	}),
	diasporaPayments: many(diasporaPayments),
}));

export const contractorsRegistryRelations = relations(contractorsRegistry, ({one}) => ({
	contractorCategory: one(contractorCategories, {
		fields: [contractorsRegistry.categoryId],
		references: [contractorCategories.id]
	}),
}));

export const contractorCategoriesRelations = relations(contractorCategories, ({many}) => ({
	contractorsRegistries: many(contractorsRegistry),
	contractors: many(contractors),
}));

export const contractorReviewsRelations = relations(contractorReviews, ({one}) => ({
	contractorWorkOrder: one(contractorWorkOrders, {
		fields: [contractorReviews.workOrderId],
		references: [contractorWorkOrders.id]
	}),
	contractor: one(contractors, {
		fields: [contractorReviews.contractorId],
		references: [contractors.id]
	}),
}));

export const contractorWorkOrdersRelations = relations(contractorWorkOrders, ({one, many}) => ({
	contractorReviews: many(contractorReviews),
	serviceContract: one(serviceContracts, {
		fields: [contractorWorkOrders.contractId],
		references: [serviceContracts.id]
	}),
	property: one(properties, {
		fields: [contractorWorkOrders.propertyId],
		references: [properties.id]
	}),
	contractor: one(contractors, {
		fields: [contractorWorkOrders.contractorId],
		references: [contractors.id]
	}),
}));

export const serviceContractsRelations = relations(serviceContracts, ({one, many}) => ({
	contractorWorkOrders: many(contractorWorkOrders),
	serviceSchedules: many(serviceSchedules),
	property: one(properties, {
		fields: [serviceContracts.propertyId],
		references: [properties.id]
	}),
	contractor: one(contractors, {
		fields: [serviceContracts.contractorId],
		references: [contractors.id]
	}),
}));

export const costCentersRelations = relations(costCenters, ({one, many}) => ({
	organization: one(organizations, {
		fields: [costCenters.organizationId],
		references: [organizations.id]
	}),
	property: one(properties, {
		fields: [costCenters.propertyId],
		references: [properties.id]
	}),
	unit: one(units, {
		fields: [costCenters.unitId],
		references: [units.id]
	}),
	user: one(users, {
		fields: [costCenters.managerId],
		references: [users.id]
	}),
	expenseLineItems: many(expenseLineItems),
	generalLedgers: many(generalLedger),
	poLineItems: many(poLineItems),
	prLineItems: many(prLineItems),
	purchaseRequisitions: many(purchaseRequisitions),
}));

export const contractorServicesRelations = relations(contractorServices, ({one}) => ({
	contractor: one(contractors, {
		fields: [contractorServices.contractorId],
		references: [contractors.id]
	}),
}));

export const contractorPerformanceRelations = relations(contractorPerformance, ({one}) => ({
	contractor: one(contractors, {
		fields: [contractorPerformance.contractorId],
		references: [contractors.id]
	}),
}));

export const diasporaPaymentScheduleRelations = relations(diasporaPaymentSchedule, ({one}) => ({
	diasporaContract: one(diasporaContracts, {
		fields: [diasporaPaymentSchedule.diasporaContractId],
		references: [diasporaContracts.id]
	}),
	diasporaPayment: one(diasporaPayments, {
		fields: [diasporaPaymentSchedule.diasporaPaymentId],
		references: [diasporaPayments.id]
	}),
}));

export const diasporaPaymentsRelations = relations(diasporaPayments, ({one, many}) => ({
	diasporaPaymentSchedules: many(diasporaPaymentSchedule),
	diasporaContract: one(diasporaContracts, {
		fields: [diasporaPayments.diasporaContractId],
		references: [diasporaContracts.id]
	}),
}));

export const escrowAccountsRelations = relations(escrowAccounts, ({one}) => ({
	property: one(properties, {
		fields: [escrowAccounts.propertyId],
		references: [properties.id]
	}),
	bankAccount: one(bankAccounts, {
		fields: [escrowAccounts.bankAccountId],
		references: [bankAccounts.id]
	}),
}));

export const diasporaCertificatesRelations = relations(diasporaCertificates, ({one}) => ({
	diasporaContract: one(diasporaContracts, {
		fields: [diasporaCertificates.diasporaContractId],
		references: [diasporaContracts.id]
	}),
}));

export const expenseLineItemsRelations = relations(expenseLineItems, ({one}) => ({
	expenseReport: one(expenseReports, {
		fields: [expenseLineItems.expenseReportId],
		references: [expenseReports.id]
	}),
	chartOfAccount: one(chartOfAccounts, {
		fields: [expenseLineItems.accountCodeId],
		references: [chartOfAccounts.id]
	}),
	costCenter: one(costCenters, {
		fields: [expenseLineItems.costCenterId],
		references: [costCenters.id]
	}),
	property: one(properties, {
		fields: [expenseLineItems.propertyId],
		references: [properties.id]
	}),
	unit: one(units, {
		fields: [expenseLineItems.unitId],
		references: [units.id]
	}),
}));

export const expenseReportsRelations = relations(expenseReports, ({one, many}) => ({
	expenseLineItems: many(expenseLineItems),
	organization: one(organizations, {
		fields: [expenseReports.organizationId],
		references: [organizations.id]
	}),
	user_employeeId: one(users, {
		fields: [expenseReports.employeeId],
		references: [users.id],
		relationName: "expenseReports_employeeId_users_id"
	}),
	user_l1ApproverId: one(users, {
		fields: [expenseReports.l1ApproverId],
		references: [users.id],
		relationName: "expenseReports_l1ApproverId_users_id"
	}),
	user_l2ApproverId: one(users, {
		fields: [expenseReports.l2ApproverId],
		references: [users.id],
		relationName: "expenseReports_l2ApproverId_users_id"
	}),
	user_mdApproverId: one(users, {
		fields: [expenseReports.mdApproverId],
		references: [users.id],
		relationName: "expenseReports_mdApproverId_users_id"
	}),
}));

export const feedbackVotesRelations = relations(feedbackVotes, ({one}) => ({
	userFeedback: one(userFeedback, {
		fields: [feedbackVotes.feedbackId],
		references: [userFeedback.id]
	}),
	user: one(users, {
		fields: [feedbackVotes.userId],
		references: [users.id]
	}),
}));

export const financialReconciliationRelations = relations(financialReconciliation, ({one}) => ({
	bankAccount: one(bankAccounts, {
		fields: [financialReconciliation.bankAccountId],
		references: [bankAccounts.id]
	}),
}));

export const generalLedgerRelations = relations(generalLedger, ({one}) => ({
	organization: one(organizations, {
		fields: [generalLedger.organizationId],
		references: [organizations.id]
	}),
	journalEntry: one(journalEntries, {
		fields: [generalLedger.journalEntryId],
		references: [journalEntries.id]
	}),
	chartOfAccount: one(chartOfAccounts, {
		fields: [generalLedger.accountId],
		references: [chartOfAccounts.id]
	}),
	costCenter: one(costCenters, {
		fields: [generalLedger.costCenterId],
		references: [costCenters.id]
	}),
	property: one(properties, {
		fields: [generalLedger.propertyId],
		references: [properties.id]
	}),
	unit: one(units, {
		fields: [generalLedger.unitId],
		references: [units.id]
	}),
	user: one(users, {
		fields: [generalLedger.createdBy],
		references: [users.id]
	}),
}));

export const journalEntriesRelations = relations(journalEntries, ({one, many}) => ({
	generalLedgers: many(generalLedger),
	property: one(properties, {
		fields: [journalEntries.propertyId],
		references: [properties.id]
	}),
	tenant: one(tenants, {
		fields: [journalEntries.tenantId],
		references: [tenants.id]
	}),
	paymentTransaction: one(paymentTransactions, {
		fields: [journalEntries.transactionId],
		references: [paymentTransactions.id]
	}),
	journalEntryLines: many(journalEntryLines),
}));

export const invoiceRemindersRelations = relations(invoiceReminders, ({one}) => ({
	tenant: one(tenants, {
		fields: [invoiceReminders.tenantId],
		references: [tenants.id]
	}),
}));

export const iotDevicesRelations = relations(iotDevices, ({one}) => ({
	organization: one(organizations, {
		fields: [iotDevices.organizationId],
		references: [organizations.id]
	}),
	property: one(properties, {
		fields: [iotDevices.propertyId],
		references: [properties.id]
	}),
	unit: one(units, {
		fields: [iotDevices.unitId],
		references: [units.id]
	}),
}));

export const invoicesRelations = relations(invoices, ({one}) => ({
	tenant: one(tenants, {
		fields: [invoices.tenantId],
		references: [tenants.id]
	}),
	property: one(properties, {
		fields: [invoices.propertyId],
		references: [properties.id]
	}),
	unit: one(units, {
		fields: [invoices.unitId],
		references: [units.id]
	}),
}));

export const ledgerAccountsRelations = relations(ledgerAccounts, ({one, many}) => ({
	ledgerAccount: one(ledgerAccounts, {
		fields: [ledgerAccounts.parentAccountId],
		references: [ledgerAccounts.id],
		relationName: "ledgerAccounts_parentAccountId_ledgerAccounts_id"
	}),
	ledgerAccounts: many(ledgerAccounts, {
		relationName: "ledgerAccounts_parentAccountId_ledgerAccounts_id"
	}),
	journalEntryLines: many(journalEntryLines),
}));

export const managedPropertyMaintenanceRelations = relations(managedPropertyMaintenance, ({one}) => ({
	property: one(properties, {
		fields: [managedPropertyMaintenance.propertyId],
		references: [properties.id]
	}),
	contractor: one(contractors, {
		fields: [managedPropertyMaintenance.contractorId],
		references: [contractors.id]
	}),
	propertyManagementAgreement: one(propertyManagementAgreements, {
		fields: [managedPropertyMaintenance.managementAgreementId],
		references: [propertyManagementAgreements.id]
	}),
}));

export const propertyManagementAgreementsRelations = relations(propertyManagementAgreements, ({one, many}) => ({
	managedPropertyMaintenances: many(managedPropertyMaintenance),
	property: one(properties, {
		fields: [propertyManagementAgreements.propertyId],
		references: [properties.id]
	}),
	tenant: one(tenants, {
		fields: [propertyManagementAgreements.ownerId],
		references: [tenants.id]
	}),
	shortTermBookings: many(shortTermBookings),
}));

export const landlordPortalSessionsRelations = relations(landlordPortalSessions, ({one}) => ({
	user: one(users, {
		fields: [landlordPortalSessions.userId],
		references: [users.id]
	}),
}));

export const paymentTransactionsRelations = relations(paymentTransactions, ({one, many}) => ({
	journalEntries: many(journalEntries),
	tenant: one(tenants, {
		fields: [paymentTransactions.tenantId],
		references: [tenants.id]
	}),
	property: one(properties, {
		fields: [paymentTransactions.propertyId],
		references: [properties.id]
	}),
	unit: one(units, {
		fields: [paymentTransactions.unitId],
		references: [units.id]
	}),
	paymentProvider: one(paymentProviders, {
		fields: [paymentTransactions.providerId],
		references: [paymentProviders.id]
	}),
	scheduledDisbursements: many(scheduledDisbursements),
}));

export const mobileMoneyRelations = relations(mobileMoney, ({one}) => ({
	paymentProvider: one(paymentProviders, {
		fields: [mobileMoney.providerId],
		references: [paymentProviders.id]
	}),
}));

export const journalEntryLinesRelations = relations(journalEntryLines, ({one}) => ({
	journalEntry: one(journalEntries, {
		fields: [journalEntryLines.journalEntryId],
		references: [journalEntries.id]
	}),
	ledgerAccount: one(ledgerAccounts, {
		fields: [journalEntryLines.accountId],
		references: [ledgerAccounts.id]
	}),
	property: one(properties, {
		fields: [journalEntryLines.propertyId],
		references: [properties.id]
	}),
	tenant: one(tenants, {
		fields: [journalEntryLines.tenantId],
		references: [tenants.id]
	}),
}));

export const ownerFinancialStatementsRelations = relations(ownerFinancialStatements, ({one}) => ({
	tenant: one(tenants, {
		fields: [ownerFinancialStatements.ownerId],
		references: [tenants.id]
	}),
	property: one(properties, {
		fields: [ownerFinancialStatements.propertyId],
		references: [properties.id]
	}),
}));

export const mpesaTransactionsRelations = relations(mpesaTransactions, ({one}) => ({
	tenant: one(tenants, {
		fields: [mpesaTransactions.tenantId],
		references: [tenants.id]
	}),
	rentPayment: one(rentPayments, {
		fields: [mpesaTransactions.rentPaymentId],
		references: [rentPayments.id]
	}),
	serviceCharge: one(serviceCharges, {
		fields: [mpesaTransactions.serviceChargeId],
		references: [serviceCharges.id]
	}),
}));

export const rentPaymentsRelations = relations(rentPayments, ({many}) => ({
	mpesaTransactions: many(mpesaTransactions),
}));

export const serviceChargesRelations = relations(serviceCharges, ({one, many}) => ({
	mpesaTransactions: many(mpesaTransactions),
	property: one(properties, {
		fields: [serviceCharges.propertyId],
		references: [properties.id]
	}),
	unit: one(units, {
		fields: [serviceCharges.unitId],
		references: [units.id]
	}),
}));

export const ownershipCertificatesRelations = relations(ownershipCertificates, ({one}) => ({
	property: one(properties, {
		fields: [ownershipCertificates.propertyId],
		references: [properties.id]
	}),
	tenant: one(tenants, {
		fields: [ownershipCertificates.ownerId],
		references: [tenants.id]
	}),
}));

export const paymentAllocationRulesRelations = relations(paymentAllocationRules, ({one}) => ({
	tenant: one(tenants, {
		fields: [paymentAllocationRules.tenantId],
		references: [tenants.id]
	}),
	property: one(properties, {
		fields: [paymentAllocationRules.propertyId],
		references: [properties.id]
	}),
}));

export const organizationSettingsRelations = relations(organizationSettings, ({one}) => ({
	organization: one(organizations, {
		fields: [organizationSettings.organizationId],
		references: [organizations.id]
	}),
}));

export const paymentRemindersRelations = relations(paymentReminders, ({one}) => ({
	tenant: one(tenants, {
		fields: [paymentReminders.tenantId],
		references: [tenants.id]
	}),
	arrear: one(arrears, {
		fields: [paymentReminders.arrearsId],
		references: [arrears.id]
	}),
}));

export const poLineItemsRelations = relations(poLineItems, ({one}) => ({
	purchaseOrder: one(purchaseOrders, {
		fields: [poLineItems.poId],
		references: [purchaseOrders.id]
	}),
	prLineItem: one(prLineItems, {
		fields: [poLineItems.prLineItemId],
		references: [prLineItems.id]
	}),
	chartOfAccount: one(chartOfAccounts, {
		fields: [poLineItems.accountCodeId],
		references: [chartOfAccounts.id]
	}),
	costCenter: one(costCenters, {
		fields: [poLineItems.costCenterId],
		references: [costCenters.id]
	}),
}));

export const purchaseOrdersRelations = relations(purchaseOrders, ({one, many}) => ({
	poLineItems: many(poLineItems),
	organization: one(organizations, {
		fields: [purchaseOrders.organizationId],
		references: [organizations.id]
	}),
	purchaseRequisition: one(purchaseRequisitions, {
		fields: [purchaseOrders.prId],
		references: [purchaseRequisitions.id]
	}),
	user: one(users, {
		fields: [purchaseOrders.buyerId],
		references: [users.id]
	}),
}));

export const prLineItemsRelations = relations(prLineItems, ({one, many}) => ({
	poLineItems: many(poLineItems),
	purchaseRequisition: one(purchaseRequisitions, {
		fields: [prLineItems.prId],
		references: [purchaseRequisitions.id]
	}),
	chartOfAccount: one(chartOfAccounts, {
		fields: [prLineItems.accountCodeId],
		references: [chartOfAccounts.id]
	}),
	costCenter: one(costCenters, {
		fields: [prLineItems.costCenterId],
		references: [costCenters.id]
	}),
}));

export const projectMilestonesRelations = relations(projectMilestones, ({one}) => ({
	project: one(projects, {
		fields: [projectMilestones.projectId],
		references: [projects.id]
	}),
}));

export const projectTeamRelations = relations(projectTeam, ({one}) => ({
	project: one(projects, {
		fields: [projectTeam.projectId],
		references: [projects.id]
	}),
}));

export const projectExpensesRelations = relations(projectExpenses, ({one}) => ({
	project: one(projects, {
		fields: [projectExpenses.projectId],
		references: [projects.id]
	}),
	projectTask: one(projectTasks, {
		fields: [projectExpenses.taskId],
		references: [projectTasks.id]
	}),
}));

export const projectTimeTrackingRelations = relations(projectTimeTracking, ({one}) => ({
	project: one(projects, {
		fields: [projectTimeTracking.projectId],
		references: [projects.id]
	}),
	projectTask: one(projectTasks, {
		fields: [projectTimeTracking.taskId],
		references: [projectTasks.id]
	}),
}));

export const purchaseRequisitionsRelations = relations(purchaseRequisitions, ({one, many}) => ({
	prLineItems: many(prLineItems),
	purchaseOrders: many(purchaseOrders),
	organization: one(organizations, {
		fields: [purchaseRequisitions.organizationId],
		references: [organizations.id]
	}),
	user_requestorId: one(users, {
		fields: [purchaseRequisitions.requestorId],
		references: [users.id],
		relationName: "purchaseRequisitions_requestorId_users_id"
	}),
	costCenter: one(costCenters, {
		fields: [purchaseRequisitions.costCenterId],
		references: [costCenters.id]
	}),
	user_l1ApproverId: one(users, {
		fields: [purchaseRequisitions.l1ApproverId],
		references: [users.id],
		relationName: "purchaseRequisitions_l1ApproverId_users_id"
	}),
	user_l2ApproverId: one(users, {
		fields: [purchaseRequisitions.l2ApproverId],
		references: [users.id],
		relationName: "purchaseRequisitions_l2ApproverId_users_id"
	}),
	user_mdApproverId: one(users, {
		fields: [purchaseRequisitions.mdApproverId],
		references: [users.id],
		relationName: "purchaseRequisitions_mdApproverId_users_id"
	}),
}));

export const propertyManagersRelations = relations(propertyManagers, ({one}) => ({
	user: one(users, {
		fields: [propertyManagers.userId],
		references: [users.id]
	}),
}));

export const propertyAvailabilityRelations = relations(propertyAvailability, ({one}) => ({
	property: one(properties, {
		fields: [propertyAvailability.propertyId],
		references: [properties.id]
	}),
	shortTermBooking: one(shortTermBookings, {
		fields: [propertyAvailability.bookingId],
		references: [shortTermBookings.id]
	}),
}));

export const shortTermBookingsRelations = relations(shortTermBookings, ({one, many}) => ({
	propertyAvailabilities: many(propertyAvailability),
	property: one(properties, {
		fields: [shortTermBookings.propertyId],
		references: [properties.id]
	}),
	propertyManagementAgreement: one(propertyManagementAgreements, {
		fields: [shortTermBookings.managementAgreementId],
		references: [propertyManagementAgreements.id]
	}),
}));

export const propertyBlockchainRecordsRelations = relations(propertyBlockchainRecords, ({one}) => ({
	property: one(properties, {
		fields: [propertyBlockchainRecords.propertyId],
		references: [properties.id]
	}),
}));

export const recurringChargesRelations = relations(recurringCharges, ({one}) => ({
	property: one(properties, {
		fields: [recurringCharges.propertyId],
		references: [properties.id]
	}),
	unit: one(units, {
		fields: [recurringCharges.unitId],
		references: [units.id]
	}),
}));

export const rentToOwnPaymentsRelations = relations(rentToOwnPayments, ({one}) => ({
	rentToOwnAgreement: one(rentToOwnAgreements, {
		fields: [rentToOwnPayments.agreementId],
		references: [rentToOwnAgreements.id]
	}),
}));

export const rentToOwnAgreementsRelations = relations(rentToOwnAgreements, ({one, many}) => ({
	rentToOwnPayments: many(rentToOwnPayments),
	property: one(properties, {
		fields: [rentToOwnAgreements.propertyId],
		references: [properties.id]
	}),
	tenant: one(tenants, {
		fields: [rentToOwnAgreements.tenantId],
		references: [tenants.id]
	}),
}));

export const riskAssessmentsRelations = relations(riskAssessments, ({one}) => ({
	tenant: one(tenants, {
		fields: [riskAssessments.tenantId],
		references: [tenants.id]
	}),
}));

export const scheduledDisbursementsRelations = relations(scheduledDisbursements, ({one}) => ({
	property: one(properties, {
		fields: [scheduledDisbursements.propertyId],
		references: [properties.id]
	}),
	paymentTransaction: one(paymentTransactions, {
		fields: [scheduledDisbursements.paymentTransactionId],
		references: [paymentTransactions.id]
	}),
}));

export const smartAutomationsRelations = relations(smartAutomations, ({one}) => ({
	organization: one(organizations, {
		fields: [smartAutomations.organizationId],
		references: [organizations.id]
	}),
	property: one(properties, {
		fields: [smartAutomations.propertyId],
		references: [properties.id]
	}),
}));

export const serviceSchedulesRelations = relations(serviceSchedules, ({one}) => ({
	serviceContract: one(serviceContracts, {
		fields: [serviceSchedules.contractId],
		references: [serviceContracts.id]
	}),
	property: one(properties, {
		fields: [serviceSchedules.propertyId],
		references: [properties.id]
	}),
	contractor: one(contractors, {
		fields: [serviceSchedules.contractorId],
		references: [contractors.id]
	}),
}));

export const smartContractsRelations = relations(smartContracts, ({one}) => ({
	organization: one(organizations, {
		fields: [smartContracts.organizationId],
		references: [organizations.id]
	}),
	property: one(properties, {
		fields: [smartContracts.propertyId],
		references: [properties.id]
	}),
}));