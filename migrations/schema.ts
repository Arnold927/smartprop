import { pgTable, foreignKey, serial, integer, varchar, text, uuid, timestamp, boolean, jsonb, unique, numeric, uniqueIndex, date, real, json, index, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const activityType = pgEnum("activity_type", ['login', 'logout', 'property_view', 'tenant_action', 'payment_made', 'maintenance_request', 'document_upload', 'search', 'report_generated'])
export const approvalStatus = pgEnum("approval_status", ['draft', 'pending_l1', 'pending_l2', 'pending_md', 'approved', 'rejected', 'cancelled'])
export const assetStatus = pgEnum("asset_status", ['active', 'maintenance', 'disposed', 'sold', 'written_off'])
export const certificateStatus = pgEnum("certificate_status", ['not_issued', 'pending', 'issued', 'verified', 'expired', 'revoked'])
export const clockMethod = pgEnum("clock_method", ['mobile', 'web', 'biometric', 'manual', 'api'])
export const constructionStatus = pgEnum("construction_status", ['planning', 'foundation', 'structure', 'roofing', 'finishing', 'completed'])
export const currency = pgEnum("currency", ['KES', 'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'CNY'])
export const departmentEnum = pgEnum("department_enum", ['property_management', 'maintenance', 'security', 'finance', 'hr', 'administration', 'marketing'])
export const depreciationMethod = pgEnum("depreciation_method", ['straight_line', 'declining_balance', 'units_of_production', 'sum_of_years'])
export const employmentTypeEnum = pgEnum("employment_type_enum", ['full_time', 'part_time', 'contract', 'casual', 'intern'])
export const expenseCategory = pgEnum("expense_category", ['maintenance', 'utilities', 'supplies', 'services', 'insurance', 'taxes', 'legal', 'marketing', 'other'])
export const expenseStatus = pgEnum("expense_status", ['pending', 'approved', 'rejected', 'paid'])
export const expenseType = pgEnum("expense_type", ['operational', 'capital', 'maintenance', 'utilities', 'travel', 'professional_services', 'marketing', 'insurance', 'other'])
export const featureStatus = pgEnum("feature_status", ['new', 'announced', 'beta', 'stable', 'deprecated'])
export const feedbackStatus = pgEnum("feedback_status", ['open', 'in_review', 'planned', 'in_progress', 'completed', 'rejected'])
export const feedbackType = pgEnum("feedback_type", ['bug_report', 'feature_request', 'improvement', 'general', 'complaint', 'compliment'])
export const maintenanceStatus = pgEnum("maintenance_status", ['pending', 'assigned', 'in_progress', 'completed', 'cancelled'])
export const messageChannel = pgEnum("message_channel", ['app', 'sms', 'email', 'push'])
export const messageType = pgEnum("message_type", ['chat', 'invoice_reminder', 'maintenance_update', 'payment_confirmation', 'system_notification'])
export const parkingStatus = pgEnum("parking_status", ['active', 'expired', 'suspended', 'terminated'])
export const paymentStatus = pgEnum("payment_status", ['pending', 'processing', 'completed', 'failed', 'refunded', 'disputed'])
export const payrollStatus = pgEnum("payroll_status", ['pending_approval', 'processed', 'paid', 'failed', 'cancelled'])
export const positionEnum = pgEnum("position_enum", ['property_manager', 'leasing_agent', 'maintenance_supervisor', 'technician', 'groundskeeper', 'janitor', 'security_guard', 'concierge', 'administrative_assistant', 'accountant', 'accounts_receivable', 'accounts_payable', 'marketing_specialist', 'it_specialist', 'hr_manager', 'facilities_manager', 'portfolio_manager', 'regional_manager', 'compliance_officer', 'customer_service', 'other'])
export const priority = pgEnum("priority", ['low', 'medium', 'high', 'urgent'])
export const procurementStatus = pgEnum("procurement_status", ['draft', 'rfq_sent', 'quotes_received', 'po_created', 'goods_received', 'invoice_matched', 'payment_approved', 'completed'])
export const staffStatusEnum = pgEnum("staff_status_enum", ['active', 'inactive', 'terminated', 'on_leave'])
export const timeTrackingStatus = pgEnum("time_tracking_status", ['pending_approval', 'approved', 'rejected', 'in_progress'])
export const vehicleStatus = pgEnum("vehicle_status", ['active', 'inactive', 'pending_approval', 'blacklisted'])
export const visitorStatus = pgEnum("visitor_status", ['pending', 'approved', 'checked_in', 'checked_out', 'denied', 'expired'])


export const tenantReviews = pgTable("tenant_reviews", {
	id: serial().primaryKey().notNull(),
	tenantId: integer("tenant_id").notNull(),
	propertyId: integer("property_id"),
	unitId: integer("unit_id"),
	reviewType: varchar("review_type").notNull(),
	rating: integer().notNull(),
	title: varchar(),
	comment: text(),
	status: varchar().default('pending'),
	response: text(),
	responseBy: uuid("response_by"),
	responseDate: timestamp("response_date", { mode: 'string' }),
	isPublic: boolean("is_public").default(false),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.tenantId],
			foreignColumns: [tenants.id],
			name: "tenant_reviews_tenant_id_tenants_id_fk"
		}),
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "tenant_reviews_property_id_properties_id_fk"
		}),
	foreignKey({
			columns: [table.unitId],
			foreignColumns: [units.id],
			name: "tenant_reviews_unit_id_units_id_fk"
		}),
	foreignKey({
			columns: [table.responseBy],
			foreignColumns: [users.id],
			name: "tenant_reviews_response_by_users_id_fk"
		}),
]);

export const tenantDocuments = pgTable("tenant_documents", {
	id: serial().primaryKey().notNull(),
	tenantId: integer("tenant_id").notNull(),
	documentType: varchar("document_type").notNull(),
	title: varchar().notNull(),
	description: text(),
	filePath: varchar("file_path").notNull(),
	fileSize: integer("file_size"),
	mimeType: varchar("mime_type"),
	isPublic: boolean("is_public").default(false),
	downloadCount: integer("download_count").default(0),
	lastDownloaded: timestamp("last_downloaded", { mode: 'string' }),
	expiresAt: timestamp("expires_at", { mode: 'string' }),
	metadata: jsonb(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
});

export const tenantNotifications = pgTable("tenant_notifications", {
	id: serial().primaryKey().notNull(),
	tenantId: integer("tenant_id").notNull(),
	notificationType: varchar("notification_type").notNull(),
	title: varchar().notNull(),
	message: text().notNull(),
	channel: varchar().notNull(),
	scheduledFor: timestamp("scheduled_for", { mode: 'string' }).defaultNow(),
	sentAt: timestamp("sent_at", { mode: 'string' }),
	deliveredAt: timestamp("delivered_at", { mode: 'string' }),
	readAt: timestamp("read_at", { mode: 'string' }),
	status: varchar().default('pending'),
	recipientInfo: jsonb("recipient_info"),
	metadata: jsonb(),
	retryCount: integer("retry_count").default(0),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
});

export const tenantPortalSessions = pgTable("tenant_portal_sessions", {
	id: serial().primaryKey().notNull(),
	tenantId: integer("tenant_id").notNull(),
	sessionToken: varchar("session_token").notNull(),
	expiresAt: timestamp("expires_at", { mode: 'string' }).notNull(),
	lastActivity: timestamp("last_activity", { mode: 'string' }).defaultNow(),
	ipAddress: varchar("ip_address"),
	userAgent: text("user_agent"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	unique("tenant_portal_sessions_session_token_unique").on(table.sessionToken),
]);

export const trustAccounts = pgTable("trust_accounts", {
	id: serial().primaryKey().notNull(),
	accountNumber: varchar("account_number", { length: 50 }).notNull(),
	accountName: varchar("account_name", { length: 100 }).notNull(),
	bankName: varchar("bank_name", { length: 100 }).notNull(),
	bankCode: varchar("bank_code", { length: 20 }),
	iban: varchar({ length: 34 }),
	swift: varchar({ length: 11 }),
	accountType: varchar("account_type", { length: 30 }).notNull(),
	balance: numeric({ precision: 15, scale:  2 }).default('0.00'),
	currency: varchar({ length: 3 }).default('USD'),
	isActive: boolean("is_active").default(true),
	fscaCompliant: boolean("fsca_compliant").default(true),
	regulatoryId: varchar("regulatory_id", { length: 50 }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	unique("trust_accounts_account_number_unique").on(table.accountNumber),
]);

export const tenantBehaviorLogs = pgTable("tenant_behavior_logs", {
	id: serial().primaryKey().notNull(),
	tenantId: integer("tenant_id").notNull(),
	eventType: varchar("event_type", { length: 50 }).notNull(),
	eventCategory: varchar("event_category", { length: 20 }).notNull(),
	description: text().notNull(),
	impact: varchar({ length: 10 }).notNull(),
	relatedEntityType: varchar("related_entity_type", { length: 50 }),
	relatedEntityId: integer("related_entity_id"),
	recordedBy: uuid("recorded_by").notNull(),
	eventDate: timestamp("event_date", { mode: 'string' }).defaultNow(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.tenantId],
			foreignColumns: [tenants.id],
			name: "tenant_behavior_logs_tenant_id_tenants_id_fk"
		}),
]);

export const userActivity = pgTable("user_activity", {
	id: serial().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	organizationId: integer("organization_id"),
	sessionId: varchar("session_id"),
	activityType: activityType("activity_type").notNull(),
	activityData: jsonb("activity_data"),
	pageUrl: varchar("page_url"),
	pagePath: varchar("page_path"),
	referrerUrl: varchar("referrer_url"),
	userAgent: text("user_agent"),
	ipAddress: varchar("ip_address"),
	deviceType: varchar("device_type"),
	browserName: varchar("browser_name"),
	browserVersion: varchar("browser_version"),
	osName: varchar("os_name"),
	osVersion: varchar("os_version"),
	screenResolution: varchar("screen_resolution"),
	duration: integer(),
	success: boolean().default(true),
	errorMessage: text("error_message"),
	metadata: jsonb().default({}),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_activity_user_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "user_activity_organization_id_organizations_id_fk"
		}),
]);

export const userFeatureInteractions = pgTable("user_feature_interactions", {
	id: serial().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	featureAnnouncementId: integer("feature_announcement_id").notNull(),
	interactionType: varchar("interaction_type").notNull(),
	interactionData: jsonb("interaction_data"),
	deviceType: varchar("device_type"),
	sessionId: varchar("session_id"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_feature_interactions_user_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.featureAnnouncementId],
			foreignColumns: [featureAnnouncements.id],
			name: "user_feature_interactions_feature_announcement_id_feature_annou"
		}),
]);

export const units = pgTable("units", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	propertyId: integer("property_id").notNull(),
	unitNumber: varchar("unit_number").notNull(),
	bedrooms: integer(),
	bathrooms: numeric({ precision: 3, scale:  1 }),
	sqft: integer(),
	monthlyRent: numeric("monthly_rent", { precision: 10, scale:  2 }).notNull(),
	currency: varchar().default('USD').notNull(),
	isOccupied: boolean("is_occupied").default(false),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "units_organization_id_organizations_id_fk"
		}),
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "units_property_id_properties_id_fk"
		}),
]);

export const userFeedback = pgTable("user_feedback", {
	id: serial().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	organizationId: integer("organization_id").notNull(),
	type: feedbackType().notNull(),
	category: varchar({ length: 100 }),
	title: varchar({ length: 255 }).notNull(),
	description: text().notNull(),
	priority: priority().default('medium'),
	status: feedbackStatus().default('open'),
	rating: integer(),
	screenshotUrl: varchar("screenshot_url"),
	browserInfo: jsonb("browser_info"),
	deviceInfo: jsonb("device_info"),
	pageUrl: varchar("page_url"),
	reproductionSteps: text("reproduction_steps"),
	expectedBehavior: text("expected_behavior"),
	actualBehavior: text("actual_behavior"),
	assignedTo: varchar("assigned_to"),
	assignedDate: timestamp("assigned_date", { mode: 'string' }),
	responseMessage: text("response_message"),
	respondedBy: uuid("responded_by"),
	respondedAt: timestamp("responded_at", { mode: 'string' }),
	internalNotes: text("internal_notes"),
	votesCount: integer("votes_count").default(0),
	implementedInVersion: varchar("implemented_in_version"),
	estimatedEffort: varchar("estimated_effort"),
	businessValue: varchar("business_value"),
	metadata: jsonb().default({}),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_feedback_user_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "user_feedback_organization_id_organizations_id_fk"
		}),
]);

export const utilityAccounts = pgTable("utility_accounts", {
	id: serial().primaryKey().notNull(),
	propertyId: integer("property_id").notNull(),
	unitId: integer("unit_id"),
	providerId: integer("provider_id").notNull(),
	accountNumber: varchar("account_number").notNull(),
	meterNumber: varchar("meter_number"),
	connectionDate: timestamp("connection_date", { mode: 'string' }),
	isActive: boolean("is_active").default(true),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "utility_accounts_property_id_properties_id_fk"
		}),
	foreignKey({
			columns: [table.unitId],
			foreignColumns: [units.id],
			name: "utility_accounts_unit_id_units_id_fk"
		}),
	foreignKey({
			columns: [table.providerId],
			foreignColumns: [utilityProviders.id],
			name: "utility_accounts_provider_id_utility_providers_id_fk"
		}),
]);

export const userNotificationPreferences = pgTable("user_notification_preferences", {
	id: serial().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	emailNotifications: boolean("email_notifications").default(true),
	smsNotifications: boolean("sms_notifications").default(false),
	pushNotifications: boolean("push_notifications").default(true),
	inAppNotifications: boolean("in_app_notifications").default(true),
	featureAnnouncements: boolean("feature_announcements").default(true),
	maintenanceUpdates: boolean("maintenance_updates").default(true),
	paymentReminders: boolean("payment_reminders").default(true),
	marketingEmails: boolean("marketing_emails").default(false),
	weeklyDigest: boolean("weekly_digest").default(true),
	securityAlerts: boolean("security_alerts").default(true),
	frequency: varchar().default('immediate'),
	quietHours: jsonb("quiet_hours").default({"end":"08:00","start":"22:00","enabled":false}),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_notification_preferences_user_id_users_id_fk"
		}),
]);

export const utilityBills = pgTable("utility_bills", {
	id: serial().primaryKey().notNull(),
	accountId: integer("account_id").notNull(),
	billNumber: varchar("bill_number"),
	billingPeriodStart: timestamp("billing_period_start", { mode: 'string' }).notNull(),
	billingPeriodEnd: timestamp("billing_period_end", { mode: 'string' }).notNull(),
	dueDate: timestamp("due_date", { mode: 'string' }).notNull(),
	amount: varchar().notNull(),
	currency: varchar().default('KES'),
	unitsConsumed: varchar("units_consumed"),
	unitRate: varchar("unit_rate"),
	previousReading: varchar("previous_reading"),
	currentReading: varchar("current_reading"),
	status: varchar().default('pending'),
	paidDate: timestamp("paid_date", { mode: 'string' }),
	paymentMethod: varchar("payment_method"),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [utilityAccounts.id],
			name: "utility_bills_account_id_utility_accounts_id_fk"
		}),
]);

export const utilityMeterReadings = pgTable("utility_meter_readings", {
	id: serial().primaryKey().notNull(),
	accountId: integer("account_id").notNull(),
	readingDate: timestamp("reading_date", { mode: 'string' }).notNull(),
	reading: varchar().notNull(),
	readingType: varchar("reading_type").default('manual'),
	consumption: varchar(),
	readBy: uuid("read_by"),
	imageUrl: varchar("image_url"),
	notes: text(),
	verified: boolean().default(false),
	verifiedBy: uuid("verified_by"),
	verifiedAt: timestamp("verified_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [utilityAccounts.id],
			name: "utility_meter_readings_account_id_utility_accounts_id_fk"
		}),
]);

export const users = pgTable("users", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organizationId: integer("organization_id"),
	email: varchar().notNull(),
	firstName: varchar("first_name"),
	lastName: varchar("last_name"),
	profileImageUrl: varchar("profile_image_url"),
	role: varchar().default('manager').notNull(),
	isOrgAdmin: boolean("is_org_admin").default(false),
	preferredCurrency: varchar("preferred_currency").default('KES').notNull(),
	permissions: jsonb().default({}),
	passwordHash: varchar("password_hash").notNull(),
	phoneNumber: varchar("phone_number"),
	emailVerified: boolean("email_verified").default(false),
	emailVerificationToken: varchar("email_verification_token"),
	emailVerificationExpiresAt: timestamp("email_verification_expires_at", { mode: 'string' }),
	passwordResetToken: varchar("password_reset_token"),
	passwordResetExpiresAt: timestamp("password_reset_expires_at", { mode: 'string' }),
	lastLoginAt: timestamp("last_login_at", { mode: 'string' }),
	invitedAt: timestamp("invited_at", { mode: 'string' }),
	invitedBy: uuid("invited_by"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	pushToken: text("push_token"),
	pushPlatform: varchar("push_platform", { length: 10 }),
}, (table) => [
	uniqueIndex("users_org_email_unique").using("btree", table.organizationId.asc().nullsLast().op("int4_ops"), table.email.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "users_organization_id_organizations_id_fk"
		}),
]);

export const userRoleAssignments = pgTable("user_role_assignments", {
	id: serial().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	roleId: integer("role_id"),
	propertyId: integer("property_id"),
	assignedBy: uuid("assigned_by").notNull(),
	assignedAt: timestamp("assigned_at", { mode: 'string' }).defaultNow(),
	expiresAt: timestamp("expires_at", { mode: 'string' }),
	isActive: boolean("is_active").default(true),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_role_assignments_user_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.roleId],
			foreignColumns: [userRoles.id],
			name: "user_role_assignments_role_id_user_roles_id_fk"
		}),
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "user_role_assignments_property_id_properties_id_fk"
		}),
]);

export const userRoles = pgTable("user_roles", {
	id: serial().primaryKey().notNull(),
	roleName: varchar("role_name", { length: 50 }).notNull(),
	roleDescription: text("role_description"),
	permissions: jsonb().default({}).notNull(),
	isActive: boolean("is_active").default(true),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	unique("user_roles_role_name_unique").on(table.roleName),
]);

export const visitors = pgTable("visitors", {
	id: serial().primaryKey().notNull(),
	propertyId: integer("property_id").notNull(),
	unitId: integer("unit_id"),
	tenantId: integer("tenant_id"),
	visitorName: varchar("visitor_name").notNull(),
	visitorPhone: varchar("visitor_phone"),
	visitorEmail: varchar("visitor_email"),
	idNumber: varchar("id_number"),
	company: varchar(),
	purposeOfVisit: text("purpose_of_visit").notNull(),
	expectedArrival: timestamp("expected_arrival", { mode: 'string' }).notNull(),
	expectedDeparture: timestamp("expected_departure", { mode: 'string' }),
	actualArrival: timestamp("actual_arrival", { mode: 'string' }),
	actualDeparture: timestamp("actual_departure", { mode: 'string' }),
	status: visitorStatus().default('pending'),
	approvedBy: uuid("approved_by"),
	approvedAt: timestamp("approved_at", { mode: 'string' }),
	checkedInBy: uuid("checked_in_by"),
	checkedOutBy: uuid("checked_out_by"),
	vehiclePlate: varchar("vehicle_plate"),
	parkingSpot: varchar("parking_spot"),
	accessCode: varchar("access_code"),
	notes: text(),
	photoUrl: varchar("photo_url"),
	createdBy: uuid("created_by").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "visitors_property_id_properties_id_fk"
		}),
	foreignKey({
			columns: [table.unitId],
			foreignColumns: [units.id],
			name: "visitors_unit_id_units_id_fk"
		}),
	foreignKey({
			columns: [table.tenantId],
			foreignColumns: [tenants.id],
			name: "visitors_tenant_id_tenants_id_fk"
		}),
]);

export const voiceCommands = pgTable("voice_commands", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	userId: uuid("user_id").notNull(),
	command: text().notNull(),
	interpretation: text().notNull(),
	action: text().notNull(),
	confidence: numeric({ precision: 5, scale:  2 }).notNull(),
	status: varchar().default('pending').notNull(),
	timestamp: timestamp({ mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "voice_commands_organization_id_organizations_id_fk"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "voice_commands_user_id_users_id_fk"
		}),
]);

export const workOrderApprovals = pgTable("work_order_approvals", {
	id: serial().primaryKey().notNull(),
	workOrderId: integer("work_order_id").notNull(),
	approvalLevel: varchar("approval_level").notNull(),
	status: varchar().default('pending'),
	approverUserId: varchar("approver_user_id"),
	approvedDate: timestamp("approved_date", { mode: 'string' }),
	rejectionReason: text("rejection_reason"),
	escalatedTo: varchar("escalated_to"),
	escalatedDate: timestamp("escalated_date", { mode: 'string' }),
	comments: text(),
	approvedBudget: numeric("approved_budget", { precision: 10, scale:  2 }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.workOrderId],
			foreignColumns: [workOrders.id],
			name: "work_order_approvals_work_order_id_work_orders_id_fk"
		}),
]);

export const workOrderExpenses = pgTable("work_order_expenses", {
	id: serial().primaryKey().notNull(),
	workOrderId: integer("work_order_id").notNull(),
	contractorId: integer("contractor_id"),
	expenseType: varchar("expense_type").notNull(),
	description: text().notNull(),
	category: varchar().notNull(),
	amount: numeric({ precision: 10, scale:  2 }).notNull(),
	currency: currency().default('USD'),
	expenseDate: timestamp("expense_date", { mode: 'string' }).notNull(),
	receiptUrl: varchar("receipt_url"),
	isApproved: boolean("is_approved").default(false),
	approvedBy: uuid("approved_by"),
	approvedDate: timestamp("approved_date", { mode: 'string' }),
	rejectionReason: text("rejection_reason"),
	invoiceNumber: varchar("invoice_number"),
	vendor: varchar(),
	paymentStatus: varchar("payment_status").default('pending'),
	paymentDate: timestamp("payment_date", { mode: 'string' }),
	notes: text(),
	createdBy: uuid("created_by").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.workOrderId],
			foreignColumns: [workOrders.id],
			name: "work_order_expenses_work_order_id_work_orders_id_fk"
		}),
	foreignKey({
			columns: [table.contractorId],
			foreignColumns: [contractors.id],
			name: "work_order_expenses_contractor_id_contractors_id_fk"
		}),
]);

export const utilityProviders = pgTable("utility_providers", {
	id: serial().primaryKey().notNull(),
	name: varchar().notNull(),
	type: varchar().notNull(),
	contactEmail: varchar("contact_email"),
	contactPhone: varchar("contact_phone"),
	billingCycle: varchar("billing_cycle").notNull(),
	averageRate: varchar("average_rate"),
	currency: varchar().default('KES'),
	isActive: boolean("is_active").default(true),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
});

export const workOrderTasks = pgTable("work_order_tasks", {
	id: serial().primaryKey().notNull(),
	workOrderId: integer("work_order_id").notNull(),
	taskNumber: varchar("task_number").notNull(),
	title: varchar().notNull(),
	description: text(),
	status: varchar().default('pending'),
	assignedTo: varchar("assigned_to"),
	estimatedHours: integer("estimated_hours"),
	actualHours: integer("actual_hours"),
	startedAt: timestamp("started_at", { mode: 'string' }),
	completedAt: timestamp("completed_at", { mode: 'string' }),
	dependsOn: integer("depends_on").array(),
	materials: jsonb(),
	tools: jsonb(),
	skillsRequired: jsonb("skills_required"),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.workOrderId],
			foreignColumns: [workOrders.id],
			name: "work_order_tasks_work_order_id_work_orders_id_fk"
		}),
]);

export const workOrders = pgTable("work_orders", {
	id: serial().primaryKey().notNull(),
	ticketNumber: varchar("ticket_number").notNull(),
	maintenanceRequestId: integer("maintenance_request_id").notNull(),
	projectId: integer("project_id"),
	workOrderType: varchar("work_order_type").notNull(),
	title: varchar().notNull(),
	description: text().notNull(),
	priority: priority().notNull(),
	status: varchar().default('draft'),
	assignedTo: varchar("assigned_to"),
	supervisorId: varchar("supervisor_id"),
	contractorId: integer("contractor_id"),
	estimatedStartDate: timestamp("estimated_start_date", { mode: 'string' }),
	estimatedEndDate: timestamp("estimated_end_date", { mode: 'string' }),
	actualStartDate: timestamp("actual_start_date", { mode: 'string' }),
	actualEndDate: timestamp("actual_end_date", { mode: 'string' }),
	estimatedCost: numeric("estimated_cost", { precision: 10, scale:  2 }),
	approvedBudget: numeric("approved_budget", { precision: 10, scale:  2 }),
	actualCost: numeric("actual_cost", { precision: 10, scale:  2 }),
	currency: currency().default('USD'),
	approvalRequired: boolean("approval_required").default(true),
	approvalLevel: varchar("approval_level").default('supervisor'),
	approvedBy: uuid("approved_by"),
	approvedDate: timestamp("approved_date", { mode: 'string' }),
	rejectionReason: text("rejection_reason"),
	completionNotes: text("completion_notes"),
	qualityRating: integer("quality_rating"),
	createdBy: uuid("created_by").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.maintenanceRequestId],
			foreignColumns: [maintenanceRequests.id],
			name: "work_orders_maintenance_request_id_maintenance_requests_id_fk"
		}),
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "work_orders_project_id_projects_id_fk"
		}),
	foreignKey({
			columns: [table.contractorId],
			foreignColumns: [contractors.id],
			name: "work_orders_contractor_id_contractors_id_fk"
		}),
	unique("work_orders_ticket_number_unique").on(table.ticketNumber),
]);

export const tenants = pgTable("tenants", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	userId: uuid("user_id").notNull(),
	firstName: varchar("first_name").notNull(),
	lastName: varchar("last_name").notNull(),
	email: varchar().notNull(),
	phone: varchar(),
	unitId: integer("unit_id"),
	leaseStartDate: date("lease_start_date"),
	leaseEndDate: date("lease_end_date"),
	monthlyRent: numeric("monthly_rent", { precision: 10, scale:  2 }),
	currency: varchar().default('KES').notNull(),
	securityDeposit: numeric("security_deposit", { precision: 10, scale:  2 }),
	status: varchar().default('active').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "tenants_organization_id_organizations_id_fk"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "tenants_user_id_users_id_fk"
		}),
]);

export const broadcastRecipients = pgTable("broadcast_recipients", {
	id: serial().primaryKey().notNull(),
	broadcastId: integer("broadcast_id").notNull(),
	recipientUserId: varchar("recipient_user_id").notNull(),
	recipientType: varchar("recipient_type").notNull(),
	phoneNumber: varchar("phone_number"),
	email: varchar(),
	medium: varchar().array().notNull(),
	deliveryStatus: jsonb("delivery_status"),
	sentAt: timestamp("sent_at", { mode: 'string' }),
	deliveredAt: timestamp("delivered_at", { mode: 'string' }),
	openedAt: timestamp("opened_at", { mode: 'string' }),
	clickedAt: timestamp("clicked_at", { mode: 'string' }),
	failureReason: text("failure_reason"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.broadcastId],
			foreignColumns: [broadcastMessages.id],
			name: "broadcast_recipients_broadcast_id_broadcast_messages_id_fk"
		}),
]);

export const contractorPayments = pgTable("contractor_payments", {
	id: serial().primaryKey().notNull(),
	paymentNumber: varchar("payment_number").notNull(),
	contractorId: integer("contractor_id").notNull(),
	workOrderId: integer("work_order_id"),
	expenseId: integer("expense_id"),
	amount: numeric({ precision: 15, scale:  2 }).notNull(),
	currency: currency().default('KES'),
	paymentType: varchar("payment_type").notNull(),
	paymentDate: timestamp("payment_date", { mode: 'string' }).notNull(),
	paymentMethod: varchar("payment_method").notNull(),
	referenceNumber: varchar("reference_number"),
	bankAccount: varchar("bank_account"),
	mpesaNumber: varchar("mpesa_number"),
	description: text(),
	taxAmount: numeric("tax_amount", { precision: 10, scale:  2 }),
	netAmount: numeric("net_amount", { precision: 15, scale:  2 }),
	status: varchar().default('pending'),
	processedBy: uuid("processed_by"),
	processedAt: timestamp("processed_at", { mode: 'string' }),
	receiptUrl: varchar("receipt_url"),
	notes: text(),
	createdBy: uuid("created_by").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.contractorId],
			foreignColumns: [contractors.id],
			name: "contractor_payments_contractor_id_contractors_id_fk"
		}),
	foreignKey({
			columns: [table.workOrderId],
			foreignColumns: [workOrders.id],
			name: "contractor_payments_work_order_id_work_orders_id_fk"
		}),
	foreignKey({
			columns: [table.expenseId],
			foreignColumns: [propertyExpenses.id],
			name: "contractor_payments_expense_id_property_expenses_id_fk"
		}),
	unique("contractor_payments_payment_number_unique").on(table.paymentNumber),
]);

export const dataEncryption = pgTable("data_encryption", {
	id: serial().primaryKey().notNull(),
	tableName: varchar("table_name", { length: 50 }).notNull(),
	columnName: varchar("column_name", { length: 50 }).notNull(),
	recordId: varchar("record_id").notNull(),
	encryptedData: text("encrypted_data").notNull(),
	keyId: varchar("key_id", { length: 50 }).notNull(),
	algorithm: varchar({ length: 30 }).default('AES-256-GCM'),
	iv: varchar({ length: 32 }),
	authTag: varchar("auth_tag", { length: 32 }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.keyId],
			foreignColumns: [encryptionKeys.keyId],
			name: "data_encryption_key_id_encryption_keys_key_id_fk"
		}),
]);

export const parkingAssignments = pgTable("parking_assignments", {
	id: serial().primaryKey().notNull(),
	parkingSpaceId: integer("parking_space_id").notNull(),
	vehicleId: integer("vehicle_id").notNull(),
	tenantId: integer("tenant_id"),
	assignmentType: varchar("assignment_type").notNull(),
	startDate: timestamp("start_date", { mode: 'string' }).notNull(),
	endDate: timestamp("end_date", { mode: 'string' }),
	monthlyFee: numeric("monthly_fee", { precision: 10, scale:  2 }),
	currency: currency().default('KES'),
	status: parkingStatus().default('active'),
	lastPaymentDate: timestamp("last_payment_date", { mode: 'string' }),
	nextPaymentDue: timestamp("next_payment_due", { mode: 'string' }),
	notes: text(),
	assignedBy: uuid("assigned_by").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.parkingSpaceId],
			foreignColumns: [parkingSpaces.id],
			name: "parking_assignments_parking_space_id_parking_spaces_id_fk"
		}),
	foreignKey({
			columns: [table.vehicleId],
			foreignColumns: [registeredVehicles.id],
			name: "parking_assignments_vehicle_id_registered_vehicles_id_fk"
		}),
	foreignKey({
			columns: [table.tenantId],
			foreignColumns: [tenants.id],
			name: "parking_assignments_tenant_id_tenants_id_fk"
		}),
]);

export const payrollEntries = pgTable("payroll_entries", {
	id: serial().primaryKey().notNull(),
	payrollPeriodId: integer("payroll_period_id").notNull(),
	employeeId: uuid("employee_id").notNull(),
	basicSalary: numeric("basic_salary", { precision: 12, scale:  2 }).notNull(),
	overtimeHours: numeric("overtime_hours", { precision: 8, scale:  2 }).default('0.00'),
	overtimeRate: numeric("overtime_rate", { precision: 10, scale:  2 }).default('0.00'),
	overtimePay: numeric("overtime_pay", { precision: 12, scale:  2 }).default('0.00'),
	allowances: numeric({ precision: 12, scale:  2 }).default('0.00'),
	bonuses: numeric({ precision: 12, scale:  2 }).default('0.00'),
	grossPay: numeric("gross_pay", { precision: 12, scale:  2 }).notNull(),
	taxDeductions: numeric("tax_deductions", { precision: 12, scale:  2 }).default('0.00'),
	nhifDeductions: numeric("nhif_deductions", { precision: 12, scale:  2 }).default('0.00'),
	nssfDeductions: numeric("nssf_deductions", { precision: 12, scale:  2 }).default('0.00'),
	otherDeductions: numeric("other_deductions", { precision: 12, scale:  2 }).default('0.00'),
	totalDeductions: numeric("total_deductions", { precision: 12, scale:  2 }).default('0.00'),
	netPay: numeric("net_pay", { precision: 12, scale:  2 }).notNull(),
	currency: varchar({ length: 3 }).default('KES'),
	paymentMethod: varchar("payment_method", { length: 30 }).default('bank_transfer'),
	bankAccount: varchar("bank_account", { length: 50 }),
	paymentReference: varchar("payment_reference", { length: 100 }),
	status: varchar({ length: 20 }).default('pending'),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.payrollPeriodId],
			foreignColumns: [payrollPeriods.id],
			name: "payroll_entries_payroll_period_id_payroll_periods_id_fk"
		}),
	foreignKey({
			columns: [table.employeeId],
			foreignColumns: [users.id],
			name: "payroll_entries_employee_id_users_id_fk"
		}),
]);

export const projectDocuments = pgTable("project_documents", {
	id: serial().primaryKey().notNull(),
	projectId: integer("project_id").notNull(),
	taskId: integer("task_id"),
	name: text().notNull(),
	type: varchar({ length: 50 }).notNull(),
	filePath: text("file_path").notNull(),
	fileSize: integer("file_size"),
	mimeType: text("mime_type"),
	uploadedBy: uuid("uploaded_by").notNull(),
	description: text(),
	tags: text().array(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "project_documents_project_id_projects_id_fk"
		}),
	foreignKey({
			columns: [table.taskId],
			foreignColumns: [projectTasks.id],
			name: "project_documents_task_id_project_tasks_id_fk"
		}),
]);

export const trustAccountTransactions = pgTable("trust_account_transactions", {
	id: serial().primaryKey().notNull(),
	trustAccountId: integer("trust_account_id").notNull(),
	transactionId: varchar("transaction_id", { length: 50 }).notNull(),
	type: varchar({ length: 30 }).notNull(),
	amount: numeric({ precision: 15, scale:  2 }).notNull(),
	currency: varchar({ length: 3 }).default('USD'),
	description: text(),
	reference: varchar({ length: 100 }),
	relatedEntityType: varchar("related_entity_type", { length: 50 }),
	relatedEntityId: integer("related_entity_id"),
	status: varchar({ length: 20 }).default('pending'),
	processedAt: timestamp("processed_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	metadata: jsonb(),
}, (table) => [
	foreignKey({
			columns: [table.trustAccountId],
			foreignColumns: [trustAccounts.id],
			name: "trust_account_transactions_trust_account_id_trust_accounts_id_f"
		}),
	unique("trust_account_transactions_transaction_id_unique").on(table.transactionId),
]);

export const visitorLog = pgTable("visitor_log", {
	id: serial().primaryKey().notNull(),
	visitorId: integer("visitor_id").notNull(),
	logType: varchar("log_type").notNull(),
	timestamp: timestamp({ mode: 'string' }).defaultNow(),
	location: varchar(),
	securityGuard: varchar("security_guard"),
	notes: text(),
	photoUrl: varchar("photo_url"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.visitorId],
			foreignColumns: [visitors.id],
			name: "visitor_log_visitor_id_visitors_id_fk"
		}),
]);

export const workOrderProgress = pgTable("work_order_progress", {
	id: serial().primaryKey().notNull(),
	workOrderId: integer("work_order_id").notNull(),
	taskId: integer("task_id"),
	progressDate: timestamp("progress_date", { mode: 'string' }).notNull(),
	progressPercentage: integer("progress_percentage").notNull(),
	statusUpdate: text("status_update").notNull(),
	completedWork: text("completed_work"),
	nextSteps: text("next_steps"),
	blockers: text(),
	hoursWorked: numeric("hours_worked", { precision: 5, scale:  2 }),
	photosUrl: jsonb("photos_url"),
	updatedBy: uuid("updated_by").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.workOrderId],
			foreignColumns: [workOrders.id],
			name: "work_order_progress_work_order_id_work_orders_id_fk"
		}),
	foreignKey({
			columns: [table.taskId],
			foreignColumns: [workOrderTasks.id],
			name: "work_order_progress_task_id_work_order_tasks_id_fk"
		}),
]);

export const paymentMethods = pgTable("payment_methods", {
	id: serial().primaryKey().notNull(),
	tenantId: integer("tenant_id"),
	methodType: varchar("method_type").notNull(),
	details: jsonb().notNull(),
	isDefault: boolean("is_default").default(false),
	isVerified: boolean("is_verified").default(false),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.tenantId],
			foreignColumns: [tenants.id],
			name: "payment_methods_tenant_id_tenants_id_fk"
		}),
]);

export const rentCollections = pgTable("rent_collections", {
	id: serial().primaryKey().notNull(),
	tenantId: integer("tenant_id").notNull(),
	unitId: integer("unit_id"),
	invoiceNumber: varchar("invoice_number").notNull(),
	amount: numeric({ precision: 10, scale:  2 }).notNull(),
	currency: varchar().default('KES').notNull(),
	dueDate: date("due_date").notNull(),
	paidDate: date("paid_date"),
	paymentMethod: varchar("payment_method"),
	paymentStatus: varchar("payment_status").default('pending').notNull(),
	mpesaTransactionId: varchar("mpesa_transaction_id"),
	bankReference: varchar("bank_reference"),
	ussdSessionId: varchar("ussd_session_id"),
	cardTransactionId: varchar("card_transaction_id"),
	lateFeeApplied: numeric("late_fee_applied", { precision: 10, scale:  2 }).default('0'),
	lateFeeDate: date("late_fee_date"),
	autoDisbursementStatus: varchar("auto_disbursement_status").default('pending'),
	disbursementReference: varchar("disbursement_reference"),
	invoiceSentAt: timestamp("invoice_sent_at", { mode: 'string' }),
	paymentReceivedAt: timestamp("payment_received_at", { mode: 'string' }),
	reminderCount: integer("reminder_count").default(0),
	lastReminderSent: timestamp("last_reminder_sent", { mode: 'string' }),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.tenantId],
			foreignColumns: [tenants.id],
			name: "rent_collections_tenant_id_tenants_id_fk"
		}),
	foreignKey({
			columns: [table.unitId],
			foreignColumns: [units.id],
			name: "rent_collections_unit_id_units_id_fk"
		}),
]);

export const rentCollectionReminders = pgTable("rent_collection_reminders", {
	id: serial().primaryKey().notNull(),
	rentCollectionId: integer("rent_collection_id").notNull(),
	reminderType: varchar("reminder_type").notNull(),
	sentAt: timestamp("sent_at", { mode: 'string' }).defaultNow().notNull(),
	status: varchar().default('sent').notNull(),
	response: text(),
}, (table) => [
	foreignKey({
			columns: [table.rentCollectionId],
			foreignColumns: [rentCollections.id],
			name: "rent_collection_reminders_rent_collection_id_rent_collections_i"
		}),
]);

export const staffMembers = pgTable("staff_members", {
	id: serial().primaryKey().notNull(),
	employeeId: varchar("employee_id").notNull(),
	firstName: varchar("first_name").notNull(),
	lastName: varchar("last_name").notNull(),
	email: varchar(),
	phone: varchar(),
	position: positionEnum().notNull(),
	department: departmentEnum().notNull(),
	employmentType: employmentTypeEnum("employment_type").default('full_time'),
	hireDate: timestamp("hire_date", { mode: 'string' }).notNull(),
	salary: numeric({ precision: 12, scale:  2 }),
	hourlyRate: numeric("hourly_rate", { precision: 8, scale:  2 }),
	currency: currency().default('KES'),
	status: staffStatusEnum().default('active'),
	photoUrl: varchar("photo_url"),
	address: text(),
	emergencyContactName: varchar("emergency_contact_name"),
	emergencyContactPhone: varchar("emergency_contact_phone"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	organizationId: integer("organization_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "staff_members_organization_id_organizations_id_fk"
		}),
	unique("staff_members_employee_id_unique").on(table.employeeId),
]);

export const payrollRecords = pgTable("payroll_records", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	staffId: integer("staff_id").notNull(),
	payrollPeriodId: integer("payroll_period_id"),
	payPeriodStart: date("pay_period_start").notNull(),
	payPeriodEnd: date("pay_period_end").notNull(),
	regularHours: numeric("regular_hours", { precision: 8, scale:  2 }).default('0'),
	overtimeHours: numeric("overtime_hours", { precision: 8, scale:  2 }).default('0'),
	leaveHours: numeric("leave_hours", { precision: 8, scale:  2 }).default('0'),
	regularRate: numeric("regular_rate", { precision: 10, scale:  2 }),
	regularPay: numeric("regular_pay", { precision: 12, scale:  2 }).default('0'),
	overtimeRate: numeric("overtime_rate", { precision: 10, scale:  2 }),
	overtimePay: numeric("overtime_pay", { precision: 12, scale:  2 }).default('0'),
	bonus: numeric({ precision: 12, scale:  2 }).default('0'),
	allowances: numeric({ precision: 12, scale:  2 }).default('0'),
	otherEarnings: numeric("other_earnings", { precision: 12, scale:  2 }).default('0'),
	grossPay: numeric("gross_pay", { precision: 12, scale:  2 }).default('0').notNull(),
	taxAmount: numeric("tax_amount", { precision: 12, scale:  2 }).default('0'),
	nhifAmount: numeric("nhif_amount", { precision: 12, scale:  2 }).default('0'),
	nssfAmount: numeric("nssf_amount", { precision: 12, scale:  2 }).default('0'),
	pensionAmount: numeric("pension_amount", { precision: 12, scale:  2 }).default('0'),
	loanDeductions: numeric("loan_deductions", { precision: 12, scale:  2 }).default('0'),
	otherDeductions: numeric("other_deductions", { precision: 12, scale:  2 }).default('0'),
	totalDeductions: numeric("total_deductions", { precision: 12, scale:  2 }).default('0'),
	netPay: numeric("net_pay", { precision: 12, scale:  2 }).default('0').notNull(),
	currency: varchar({ length: 3 }).default('KES'),
	paymentStatus: payrollStatus("payment_status").default('pending_approval'),
	paymentDate: date("payment_date"),
	paymentMethod: varchar("payment_method", { length: 50 }),
	paymentReference: varchar("payment_reference", { length: 100 }),
	bankAccountNumber: varchar("bank_account_number", { length: 50 }),
	bankName: varchar("bank_name", { length: 100 }),
	notes: text(),
	isAdjustment: boolean("is_adjustment").default(false),
	adjustmentReason: text("adjustment_reason"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	createdBy: integer("created_by"),
	approvedBy: integer("approved_by"),
	approvedAt: timestamp("approved_at", { mode: 'string' }),
	paidBy: integer("paid_by"),
	paidAt: timestamp("paid_at", { mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.staffId],
			foreignColumns: [staffMembers.id],
			name: "payroll_records_staff_id_staff_members_id_fk"
		}).onDelete("cascade"),
]);

export const timeTracking = pgTable("time_tracking", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	staffId: integer("staff_id").notNull(),
	propertyId: integer("property_id"),
	clockInTime: timestamp("clock_in_time", { mode: 'string' }).notNull(),
	clockOutTime: timestamp("clock_out_time", { mode: 'string' }),
	locationLat: real("location_lat"),
	locationLng: real("location_lng"),
	clockInMethod: clockMethod("clock_in_method").default('mobile'),
	clockOutMethod: clockMethod("clock_out_method"),
	totalHours: numeric("total_hours", { precision: 5, scale:  2 }),
	overtimeHours: numeric("overtime_hours", { precision: 5, scale:  2 }).default('0'),
	breakTime: numeric("break_time", { precision: 5, scale:  2 }).default('0'),
	notes: text(),
	status: timeTrackingStatus().default('pending_approval'),
	metadata: json(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	createdBy: integer("created_by"),
	approvedBy: integer("approved_by"),
	approvedAt: timestamp("approved_at", { mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.staffId],
			foreignColumns: [staffMembers.id],
			name: "time_tracking_staff_id_staff_members_id_fk"
		}).onDelete("cascade"),
]);

export const workOrderCharges = pgTable("work_order_charges", {
	id: serial().primaryKey().notNull(),
	workOrderId: integer("work_order_id").notNull(),
	description: varchar().notNull(),
	amount: numeric({ precision: 10, scale:  2 }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.workOrderId],
			foreignColumns: [maintenanceRequests.id],
			name: "work_order_charges_work_order_id_maintenance_requests_id_fk"
		}),
]);

export const workOrderMaterials = pgTable("work_order_materials", {
	id: serial().primaryKey().notNull(),
	workOrderId: integer("work_order_id").notNull(),
	itemName: varchar("item_name").notNull(),
	quantity: integer().notNull(),
	unitCost: numeric("unit_cost", { precision: 10, scale:  2 }).notNull(),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.workOrderId],
			foreignColumns: [maintenanceRequests.id],
			name: "work_order_materials_work_order_id_maintenance_requests_id_fk"
		}),
]);

export const workOrderComments = pgTable("work_order_comments", {
	id: serial().primaryKey().notNull(),
	workOrderId: integer("work_order_id").notNull(),
	userId: uuid("user_id").notNull(),
	userName: varchar("user_name", { length: 255 }).notNull(),
	userAvatar: text("user_avatar"),
	content: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	isEdited: boolean("is_edited").default(false),
	parentCommentId: integer("parent_comment_id"),
}, (table) => [
	foreignKey({
			columns: [table.workOrderId],
			foreignColumns: [workOrders.id],
			name: "work_order_comments_work_order_id_work_orders_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.parentCommentId],
			foreignColumns: [table.id],
			name: "work_order_comments_parent_comment_id_work_order_comments_id_fk"
		}).onDelete("cascade"),
]);

export const whatsappMessages = pgTable("whatsapp_messages", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id"),
	to: varchar({ length: 30 }).notNull(),
	type: varchar({ length: 20 }).default('text').notNull(),
	content: text().notNull(),
	templateName: varchar("template_name", { length: 100 }),
	status: varchar({ length: 20 }).default('sent').notNull(),
	metaMessageId: varchar("meta_message_id", { length: 100 }),
	errorDetail: text("error_detail"),
	sentAt: timestamp("sent_at", { mode: 'string' }).defaultNow(),
	direction: varchar({ length: 10 }).default('outbound').notNull(),
}, (table) => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "whatsapp_messages_organization_id_organizations_id_fk"
		}),
]);

export const tenantShortRentals = pgTable("tenant_short_rentals", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	unitId: integer("unit_id").notNull(),
	tenantId: integer("tenant_id").notNull(),
	listingTitle: varchar("listing_title", { length: 200 }).notNull(),
	description: text().default(').notNull(),
	nightlyRate: numeric("nightly_rate", { precision: 10, scale:  2 }).notNull(),
	currency: varchar({ length: 10 }).default('KES').notNull(),
	minimumNights: integer("minimum_nights").default(1).notNull(),
	maximumNights: integer("maximum_nights").default(30).notNull(),
	amenities: jsonb().default([]),
	houseRules: text("house_rules").default(').notNull(),
	checkInTime: varchar("check_in_time", { length: 10 }).default('14:00').notNull(),
	checkOutTime: varchar("check_out_time", { length: 10 }).default('11:00').notNull(),
	listingPhotos: jsonb("listing_photos").default([]),
	isActive: boolean("is_active").default(true).notNull(),
	approvalStatus: varchar("approval_status", { length: 20 }).default('pending').notNull(),
	approvedBy: varchar("approved_by", { length: 100 }),
	approvedAt: timestamp("approved_at", { mode: 'string' }),
	calendarSyncEnabled: boolean("calendar_sync_enabled").default(false).notNull(),
	autoPricingEnabled: boolean("auto_pricing_enabled").default(false).notNull(),
	instantBookingEnabled: boolean("instant_booking_enabled").default(false).notNull(),
	propertyManagerCommission: numeric("property_manager_commission", { precision: 5, scale:  2 }).default('10.00').notNull(),
	tenantEarningsShare: numeric("tenant_earnings_share", { precision: 5, scale:  2 }).default('80.00').notNull(),
	platformFees: numeric("platform_fees", { precision: 5, scale:  2 }).default('10.00').notNull(),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "tenant_short_rentals_organization_id_organizations_id_fk"
		}),
	foreignKey({
			columns: [table.unitId],
			foreignColumns: [units.id],
			name: "tenant_short_rentals_unit_id_units_id_fk"
		}),
	foreignKey({
			columns: [table.tenantId],
			foreignColumns: [tenants.id],
			name: "tenant_short_rentals_tenant_id_tenants_id_fk"
		}),
]);

export const tenantShortBookings = pgTable("tenant_short_bookings", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	rentalListingId: integer("rental_listing_id").notNull(),
	bookingReference: varchar("booking_reference", { length: 50 }).notNull(),
	guestName: varchar("guest_name", { length: 100 }).notNull(),
	guestEmail: varchar("guest_email", { length: 100 }).notNull(),
	guestPhone: varchar("guest_phone", { length: 20 }).default(').notNull(),
	guestCount: integer("guest_count").default(1).notNull(),
	checkInDate: timestamp("check_in_date", { mode: 'string' }).notNull(),
	checkOutDate: timestamp("check_out_date", { mode: 'string' }).notNull(),
	numberOfNights: integer("number_of_nights").notNull(),
	nightlyRate: numeric("nightly_rate", { precision: 10, scale:  2 }).notNull(),
	totalAmount: numeric("total_amount", { precision: 12, scale:  2 }).notNull(),
	cleaningFee: numeric("cleaning_fee", { precision: 10, scale:  2 }).default('0.00').notNull(),
	platformFees: numeric("platform_fees", { precision: 10, scale:  2 }).default('0.00').notNull(),
	propertyManagerCommission: numeric("property_manager_commission", { precision: 10, scale:  2 }).default('0.00').notNull(),
	tenantPayout: numeric("tenant_payout", { precision: 12, scale:  2 }).notNull(),
	currency: varchar({ length: 10 }).default('KES').notNull(),
	bookingStatus: varchar("booking_status", { length: 20 }).default('confirmed').notNull(),
	paymentStatus: varchar("payment_status", { length: 20 }).default('pending').notNull(),
	platformSource: varchar("platform_source", { length: 30 }).default('direct').notNull(),
	specialRequests: text("special_requests"),
	checkInCode: varchar("check_in_code", { length: 20 }),
	securityDeposit: numeric("security_deposit", { precision: 10, scale:  2 }).default('0.00').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "tenant_short_bookings_organization_id_organizations_id_fk"
		}),
	foreignKey({
			columns: [table.rentalListingId],
			foreignColumns: [tenantShortRentals.id],
			name: "tenant_short_bookings_rental_listing_id_tenant_short_rentals_id"
		}),
	unique("tenant_short_bookings_booking_reference_unique").on(table.bookingReference),
]);

export const whatsappTemplates = pgTable("whatsapp_templates", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id"),
	name: varchar({ length: 100 }).notNull(),
	category: varchar({ length: 50 }).default('custom').notNull(),
	content: text().notNull(),
	variables: jsonb().default([]),
	status: varchar({ length: 20 }).default('pending').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	metaTemplateId: varchar("meta_template_id", { length: 100 }),
	rejectionReason: text("rejection_reason"),
}, (table) => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "whatsapp_templates_organization_id_organizations_id_fk"
		}),
]);

export const aiConversations = pgTable("ai_conversations", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	userId: uuid("user_id").notNull(),
	conversationType: varchar("conversation_type").notNull(),
	userMessage: text("user_message").notNull(),
	assistantResponse: text("assistant_response").notNull(),
	actionTaken: jsonb("action_taken"),
	language: varchar().default('en'),
	confidence: numeric({ precision: 5, scale:  2 }),
	timestamp: timestamp({ mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "ai_conversations_organization_id_organizations_id_fk"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "ai_conversations_user_id_users_id_fk"
		}),
]);

export const aiPredictions = pgTable("ai_predictions", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	predictionType: varchar("prediction_type").notNull(),
	targetEntity: varchar("target_entity").notNull(),
	targetEntityId: varchar("target_entity_id").notNull(),
	title: varchar().notNull(),
	description: text().notNull(),
	confidence: numeric({ precision: 5, scale:  2 }).notNull(),
	potentialImpact: varchar("potential_impact").notNull(),
	recommendedAction: text("recommended_action"),
	status: varchar().default('active').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "ai_predictions_organization_id_organizations_id_fk"
		}),
]);

export const arrears = pgTable("arrears", {
	id: serial().primaryKey().notNull(),
	tenantId: integer("tenant_id").notNull(),
	unitId: integer("unit_id").notNull(),
	propertyId: integer("property_id").notNull(),
	outstandingAmount: numeric("outstanding_amount", { precision: 10, scale:  2 }).notNull(),
	currency: currency().default('USD').notNull(),
	daysOverdue: integer("days_overdue").notNull(),
	lastPaymentDate: timestamp("last_payment_date", { mode: 'string' }),
	nextDueDate: timestamp("next_due_date", { mode: 'string' }).notNull(),
	status: varchar({ length: 20 }).default('active').notNull(),
	priority: varchar({ length: 10 }).default('medium').notNull(),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.tenantId],
			foreignColumns: [tenants.id],
			name: "arrears_tenant_id_tenants_id_fk"
		}),
	foreignKey({
			columns: [table.unitId],
			foreignColumns: [units.id],
			name: "arrears_unit_id_units_id_fk"
		}),
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "arrears_property_id_properties_id_fk"
		}),
]);

export const arrearsActions = pgTable("arrears_actions", {
	id: serial().primaryKey().notNull(),
	arrearsId: integer("arrears_id").notNull(),
	actionType: varchar("action_type", { length: 50 }).notNull(),
	actionDate: timestamp("action_date", { mode: 'string' }).defaultNow(),
	description: text().notNull(),
	amount: numeric({ precision: 10, scale:  2 }),
	outcome: varchar({ length: 50 }),
	followUpDate: timestamp("follow_up_date", { mode: 'string' }),
	performedBy: uuid("performed_by").notNull(),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.arrearsId],
			foreignColumns: [arrears.id],
			name: "arrears_actions_arrears_id_arrears_id_fk"
		}),
]);

export const auditLogs = pgTable("audit_logs", {
	id: serial().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	entityType: varchar("entity_type", { length: 50 }).notNull(),
	entityId: varchar("entity_id").notNull(),
	action: varchar({ length: 20 }).notNull(),
	oldValues: jsonb("old_values"),
	newValues: jsonb("new_values"),
	ipAddress: varchar("ip_address", { length: 45 }),
	userAgent: text("user_agent"),
	sessionId: varchar("session_id"),
	timestamp: timestamp({ mode: 'string' }).defaultNow().notNull(),
	metadata: jsonb(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "audit_logs_user_id_users_id_fk"
		}),
]);

export const automatedPaymentRules = pgTable("automated_payment_rules", {
	id: serial().primaryKey().notNull(),
	ruleName: varchar("rule_name", { length: 100 }).notNull(),
	propertyId: integer("property_id"),
	tenantId: integer("tenant_id"),
	triggerType: varchar("trigger_type", { length: 30 }).notNull(),
	triggerConditions: jsonb("trigger_conditions").notNull(),
	actions: jsonb().notNull(),
	schedule: varchar({ length: 50 }),
	isActive: boolean("is_active").default(true),
	lastExecuted: timestamp("last_executed", { mode: 'string' }),
	executionCount: integer("execution_count").default(0),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "automated_payment_rules_property_id_properties_id_fk"
		}),
	foreignKey({
			columns: [table.tenantId],
			foreignColumns: [tenants.id],
			name: "automated_payment_rules_tenant_id_tenants_id_fk"
		}),
]);

export const bankAccounts = pgTable("bank_accounts", {
	id: serial().primaryKey().notNull(),
	providerId: integer("provider_id"),
	accountName: varchar("account_name", { length: 100 }).notNull(),
	accountNumber: varchar("account_number", { length: 50 }).notNull(),
	bankCode: varchar("bank_code", { length: 20 }),
	branchCode: varchar("branch_code", { length: 20 }),
	accountType: varchar("account_type", { length: 30 }).notNull(),
	currency: varchar({ length: 3 }).notNull(),
	currentBalance: numeric("current_balance", { precision: 15, scale:  2 }).default('0.00'),
	availableBalance: numeric("available_balance", { precision: 15, scale:  2 }).default('0.00'),
	lastSyncedAt: timestamp("last_synced_at", { mode: 'string' }),
	isActive: boolean("is_active").default(true),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.providerId],
			foreignColumns: [paymentProviders.id],
			name: "bank_accounts_provider_id_payment_providers_id_fk"
		}),
]);

export const billingCycles = pgTable("billing_cycles", {
	id: serial().primaryKey().notNull(),
	propertyId: integer("property_id").notNull(),
	name: varchar().notNull(),
	type: varchar().notNull(),
	frequency: varchar().notNull(),
	billingDay: integer("billing_day").notNull(),
	dueDay: integer("due_day").notNull(),
	graceDay: integer("grace_day").default(5),
	lateFeeAmount: varchar("late_fee_amount"),
	lateFeeType: varchar("late_fee_type"),
	isActive: boolean("is_active").default(true),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "billing_cycles_property_id_properties_id_fk"
		}),
]);

export const blockchainTransactions = pgTable("blockchain_transactions", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	propertyId: integer("property_id").notNull(),
	transactionType: varchar("transaction_type").notNull(),
	hash: varchar().notNull(),
	blockNumber: integer("block_number").notNull(),
	gasUsed: integer("gas_used").notNull(),
	transactionFee: numeric("transaction_fee", { precision: 18, scale:  8 }).notNull(),
	participants: text().array().notNull(),
	dataHash: varchar("data_hash").notNull(),
	verificationLevel: varchar("verification_level").default('basic').notNull(),
	status: varchar().default('pending').notNull(),
	timestamp: timestamp({ mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "blockchain_transactions_organization_id_organizations_id_fk"
		}),
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "blockchain_transactions_property_id_properties_id_fk"
		}),
	unique("blockchain_transactions_hash_unique").on(table.hash),
]);

export const caretakers = pgTable("caretakers", {
	id: serial().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	employeeId: uuid("employee_id"),
	propertyId: integer("property_id"),
	caretakerType: varchar("caretaker_type", { length: 30 }).notNull(),
	shift: varchar({ length: 20 }),
	skills: text().array(),
	contactNumber: varchar("contact_number", { length: 20 }),
	emergencyContact: varchar("emergency_contact", { length: 20 }),
	salary: numeric({ precision: 12, scale:  2 }),
	accommodationProvided: boolean("accommodation_provided").default(false),
	startDate: timestamp("start_date", { mode: 'string' }),
	endDate: timestamp("end_date", { mode: 'string' }),
	status: varchar({ length: 20 }).default('active'),
	performanceRating: numeric("performance_rating", { precision: 3, scale:  2 }),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "caretakers_user_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "caretakers_property_id_properties_id_fk"
		}),
]);

export const chartOfAccounts = pgTable("chart_of_accounts", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	accountCode: varchar("account_code", { length: 20 }).notNull(),
	accountName: varchar("account_name", { length: 255 }).notNull(),
	accountType: varchar("account_type", { length: 50 }).notNull(),
	parentAccountId: integer("parent_account_id"),
	level: integer().default(1),
	isActive: boolean("is_active").default(true),
	normalBalance: varchar("normal_balance", { length: 6 }).notNull(),
	description: text(),
	costCenterTracking: boolean("cost_center_tracking").default(false),
	propertyTracking: boolean("property_tracking").default(false),
	unitTracking: boolean("unit_tracking").default(false),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "chart_of_accounts_organization_id_organizations_id_fk"
		}),
	foreignKey({
			columns: [table.parentAccountId],
			foreignColumns: [table.id],
			name: "chart_of_accounts_parent_account_id_chart_of_accounts_id_fk"
		}),
]);

export const complaintsPhotos = pgTable("complaints_photos", {
	id: serial().primaryKey().notNull(),
	maintenanceRequestId: integer("maintenance_request_id"),
	fileName: varchar("file_name", { length: 255 }).notNull(),
	originalName: varchar("original_name", { length: 255 }).notNull(),
	mimeType: varchar("mime_type", { length: 100 }),
	size: integer(),
	url: text().notNull(),
	uploadedBy: uuid("uploaded_by").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.maintenanceRequestId],
			foreignColumns: [maintenanceRequests.id],
			name: "complaints_photos_maintenance_request_id_maintenance_requests_i"
		}),
]);

export const constructionUpdates = pgTable("construction_updates", {
	id: serial().primaryKey().notNull(),
	diasporaContractId: integer("diaspora_contract_id").notNull(),
	updateTitle: varchar("update_title").notNull(),
	updateDescription: text("update_description").notNull(),
	constructionPhase: constructionStatus("construction_phase").notNull(),
	progressPercentage: numeric("progress_percentage", { precision: 5, scale:  2 }).notNull(),
	photoUrls: json("photo_urls"),
	videoUrls: json("video_urls"),
	documentUrls: json("document_urls"),
	milestoneAchieved: varchar("milestone_achieved"),
	nextMilestone: varchar("next_milestone"),
	estimatedCompletionDate: timestamp("estimated_completion_date", { mode: 'string' }),
	notificationSent: boolean("notification_sent").default(false),
	clientNotified: boolean("client_notified").default(false),
	updatedBy: uuid("updated_by").notNull(),
	approvedBy: uuid("approved_by"),
	approvedAt: timestamp("approved_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.diasporaContractId],
			foreignColumns: [diasporaContracts.id],
			name: "construction_updates_diaspora_contract_id_diaspora_contracts_id"
		}),
]);

export const communicationTemplates = pgTable("communication_templates", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	name: varchar().notNull(),
	category: varchar().notNull(),
	medium: varchar().array().notNull(),
	subject: varchar(),
	content: text().notNull(),
	variables: jsonb(),
	isActive: boolean("is_active").default(true),
	createdBy: uuid("created_by").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
});

export const contractorCategories = pgTable("contractor_categories", {
	id: serial().primaryKey().notNull(),
	description: text(),
	requiredCertifications: text("required_certifications").array(),
	typicalServices: text("typical_services").array(),
	isActive: boolean("is_active").default(true),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	name: varchar({ length: 100 }).notNull(),
	defaultHourlyRate: integer("default_hourly_rate"),
	defaultDailyRate: integer("default_daily_rate"),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	unique("contractor_categories_name_unique").on(table.name),
]);

export const complianceReports = pgTable("compliance_reports", {
	id: serial().primaryKey().notNull(),
	reportType: varchar("report_type", { length: 50 }).notNull(),
	reportPeriod: varchar("report_period", { length: 20 }).notNull(),
	generatedBy: uuid("generated_by").notNull(),
	reportData: jsonb("report_data").notNull(),
	fileHash: varchar("file_hash", { length: 64 }),
	status: varchar({ length: 20 }).default('draft'),
	submittedAt: timestamp("submitted_at", { mode: 'string' }),
	approvedAt: timestamp("approved_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	metadata: jsonb(),
});

export const broadcastMessages = pgTable("broadcast_messages", {
	id: serial().primaryKey().notNull(),
	title: varchar().notNull(),
	content: text().notNull(),
	senderUserId: varchar("sender_user_id").notNull(),
	organizationId: integer("organization_id").notNull(),
	audienceType: varchar("audience_type").notNull(),
	audienceFilter: jsonb("audience_filter"),
	broadcastMedium: varchar("broadcast_medium").array().notNull(),
	scheduledFor: timestamp("scheduled_for", { mode: 'string' }),
	status: varchar().default('draft'),
	totalRecipients: integer("total_recipients").default(0),
	sentCount: integer("sent_count").default(0),
	failedCount: integer("failed_count").default(0),
	openedCount: integer("opened_count").default(0),
	clickedCount: integer("clicked_count").default(0),
	sentAt: timestamp("sent_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
});

export const contractorsRegistry = pgTable("contractors_registry", {
	id: serial().primaryKey().notNull(),
	contractorName: varchar("contractor_name", { length: 100 }).notNull(),
	companyName: varchar("company_name", { length: 100 }),
	categoryId: integer("category_id"),
	contractorType: varchar("contractor_type", { length: 30 }).notNull(),
	businessRegistration: varchar("business_registration", { length: 50 }),
	taxNumber: varchar("tax_number", { length: 50 }),
	licenseNumber: varchar("license_number", { length: 50 }),
	contactPerson: varchar("contact_person", { length: 100 }),
	phoneNumber: varchar("phone_number", { length: 20 }).notNull(),
	alternatePhone: varchar("alternate_phone", { length: 20 }),
	email: varchar({ length: 100 }),
	address: text(),
	city: varchar({ length: 50 }),
	state: varchar({ length: 50 }),
	postalCode: varchar("postal_code", { length: 20 }),
	country: varchar({ length: 50 }).default('Kenya'),
	services: text().array(),
	certifications: jsonb().default([]),
	insuranceDetails: jsonb("insurance_details").default({}),
	rating: numeric({ precision: 3, scale:  2 }).default('0.00'),
	totalJobs: integer("total_jobs").default(0),
	completedJobs: integer("completed_jobs").default(0),
	averageResponseTime: integer("average_response_time"),
	priceRange: varchar("price_range", { length: 50 }),
	paymentTerms: varchar("payment_terms", { length: 100 }),
	emergencyAvailable: boolean("emergency_available").default(false),
	workingHours: jsonb("working_hours").default({}),
	serviceAreas: text("service_areas").array(),
	isVerified: boolean("is_verified").default(false),
	verifiedBy: uuid("verified_by"),
	verificationDate: timestamp("verification_date", { mode: 'string' }),
	status: varchar({ length: 20 }).default('active'),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.categoryId],
			foreignColumns: [contractorCategories.id],
			name: "contractors_registry_category_id_contractor_categories_id_fk"
		}),
]);

export const contractorReviews = pgTable("contractor_reviews", {
	id: serial().primaryKey().notNull(),
	contractorId: integer("contractor_id"),
	workOrderId: integer("work_order_id"),
	reviewerType: varchar("reviewer_type", { length: 20 }).notNull(),
	reviewerId: uuid("reviewer_id").notNull(),
	overallRating: numeric("overall_rating", { precision: 3, scale:  2 }).notNull(),
	qualityRating: numeric("quality_rating", { precision: 3, scale:  2 }),
	timelinessRating: numeric("timeliness_rating", { precision: 3, scale:  2 }),
	communicationRating: numeric("communication_rating", { precision: 3, scale:  2 }),
	professionalismRating: numeric("professionalism_rating", { precision: 3, scale:  2 }),
	valueForMoneyRating: numeric("value_for_money_rating", { precision: 3, scale:  2 }),
	reviewTitle: varchar("review_title", { length: 200 }),
	reviewText: text("review_text"),
	wouldRecommend: boolean("would_recommend"),
	wouldHireAgain: boolean("would_hire_again"),
	reviewPhotos: text("review_photos").array(),
	isVerified: boolean("is_verified").default(false),
	isPublic: boolean("is_public").default(true),
	contractorResponse: text("contractor_response"),
	responseDate: timestamp("response_date", { mode: 'string' }),
	helpfulVotes: integer("helpful_votes").default(0),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.workOrderId],
			foreignColumns: [contractorWorkOrders.id],
			name: "contractor_reviews_work_order_id_contractor_work_orders_id_fk"
		}),
	foreignKey({
			columns: [table.contractorId],
			foreignColumns: [contractors.id],
			name: "contractor_reviews_contractor_id_contractors_id_fk"
		}),
]);

export const contractorWorkOrders = pgTable("contractor_work_orders", {
	id: serial().primaryKey().notNull(),
	workOrderNumber: varchar("work_order_number", { length: 50 }).notNull(),
	contractId: integer("contract_id"),
	contractorId: integer("contractor_id"),
	propertyId: integer("property_id"),
	requestedBy: uuid("requested_by").notNull(),
	urgency: varchar({ length: 20 }).default('medium'),
	workType: varchar("work_type", { length: 50 }).notNull(),
	title: varchar({ length: 200 }).notNull(),
	description: text().notNull(),
	location: text(),
	estimatedHours: numeric("estimated_hours", { precision: 8, scale:  2 }),
	estimatedCost: numeric("estimated_cost", { precision: 12, scale:  2 }),
	actualHours: numeric("actual_hours", { precision: 8, scale:  2 }),
	actualCost: numeric("actual_cost", { precision: 12, scale:  2 }),
	currency: varchar({ length: 3 }).default('KES'),
	materialsCost: numeric("materials_cost", { precision: 12, scale:  2 }),
	laborCost: numeric("labor_cost", { precision: 12, scale:  2 }),
	scheduledDate: timestamp("scheduled_date", { mode: 'string' }),
	startedAt: timestamp("started_at", { mode: 'string' }),
	completedAt: timestamp("completed_at", { mode: 'string' }),
	status: varchar({ length: 20 }).default('pending'),
	qualityRating: numeric("quality_rating", { precision: 3, scale:  2 }),
	timelinessRating: numeric("timeliness_rating", { precision: 3, scale:  2 }),
	feedback: text(),
	workPhotos: text("work_photos").array(),
	invoiceNumber: varchar("invoice_number", { length: 50 }),
	paymentStatus: varchar("payment_status", { length: 20 }).default('pending'),
	paymentDate: timestamp("payment_date", { mode: 'string' }),
	warranty: varchar({ length: 100 }),
	warrantyExpires: timestamp("warranty_expires", { mode: 'string' }),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.contractId],
			foreignColumns: [serviceContracts.id],
			name: "contractor_work_orders_contract_id_service_contracts_id_fk"
		}),
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "contractor_work_orders_property_id_properties_id_fk"
		}),
	foreignKey({
			columns: [table.contractorId],
			foreignColumns: [contractors.id],
			name: "contractor_work_orders_contractor_id_contractors_id_fk"
		}),
	unique("contractor_work_orders_work_order_number_unique").on(table.workOrderNumber),
]);

export const costCenters = pgTable("cost_centers", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	code: varchar({ length: 20 }).notNull(),
	name: varchar({ length: 255 }).notNull(),
	type: varchar({ length: 50 }).notNull(),
	propertyId: integer("property_id"),
	unitId: integer("unit_id"),
	managerId: uuid("manager_id"),
	budgetAmount: numeric("budget_amount", { precision: 15, scale:  2 }),
	actualSpent: numeric("actual_spent", { precision: 15, scale:  2 }).default('0.00'),
	isActive: boolean("is_active").default(true),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "cost_centers_organization_id_organizations_id_fk"
		}),
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "cost_centers_property_id_properties_id_fk"
		}),
	foreignKey({
			columns: [table.unitId],
			foreignColumns: [units.id],
			name: "cost_centers_unit_id_units_id_fk"
		}),
	foreignKey({
			columns: [table.managerId],
			foreignColumns: [users.id],
			name: "cost_centers_manager_id_users_id_fk"
		}),
]);

export const contractorServices = pgTable("contractor_services", {
	id: serial().primaryKey().notNull(),
	contractorId: integer("contractor_id").notNull(),
	serviceName: varchar("service_name").notNull(),
	serviceCategory: varchar("service_category").notNull(),
	description: text(),
	baseRate: numeric("base_rate", { precision: 10, scale:  2 }),
	currency: currency().default('KES'),
	rateType: varchar("rate_type").notNull(),
	minimumCharge: numeric("minimum_charge", { precision: 10, scale:  2 }),
	isActive: boolean("is_active").default(true),
	estimatedDuration: varchar("estimated_duration"),
	skillLevel: varchar("skill_level").notNull(),
	equipmentProvided: boolean("equipment_provided").default(false),
	materialsIncluded: boolean("materials_included").default(false),
	warrantyPeriod: integer("warranty_period"),
	availabilityHours: jsonb("availability_hours"),
	serviceAreas: jsonb("service_areas"),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.contractorId],
			foreignColumns: [contractors.id],
			name: "contractor_services_contractor_id_contractors_id_fk"
		}),
]);

export const contractorPerformance = pgTable("contractor_performance", {
	id: serial().primaryKey().notNull(),
	contractorId: integer("contractor_id"),
	evaluationPeriod: varchar("evaluation_period", { length: 20 }).notNull(),
	periodStart: timestamp("period_start", { mode: 'string' }).notNull(),
	periodEnd: timestamp("period_end", { mode: 'string' }).notNull(),
	totalJobsAssigned: integer("total_jobs_assigned").default(0),
	totalJobsCompleted: integer("total_jobs_completed").default(0),
	totalJobsCancelled: integer("total_jobs_cancelled").default(0),
	averageCompletionTime: numeric("average_completion_time", { precision: 8, scale:  2 }),
	averageQualityRating: numeric("average_quality_rating", { precision: 3, scale:  2 }),
	averageTimelinessRating: numeric("average_timeliness_rating", { precision: 3, scale:  2 }),
	totalRevenue: numeric("total_revenue", { precision: 12, scale:  2 }),
	averageJobValue: numeric("average_job_value", { precision: 12, scale:  2 }),
	complaintCount: integer("complaint_count").default(0),
	complimentCount: integer("compliment_count").default(0),
	safetyIncidents: integer("safety_incidents").default(0),
	onTimeDeliveryRate: numeric("on_time_delivery_rate", { precision: 5, scale:  2 }),
	customerSatisfactionScore: numeric("customer_satisfaction_score", { precision: 3, scale:  2 }),
	repeatCustomerRate: numeric("repeat_customer_rate", { precision: 5, scale:  2 }),
	responseTimeHours: numeric("response_time_hours", { precision: 6, scale:  2 }),
	costEfficiencyRating: numeric("cost_efficiency_rating", { precision: 3, scale:  2 }),
	innovationScore: numeric("innovation_score", { precision: 3, scale:  2 }),
	communicationRating: numeric("communication_rating", { precision: 3, scale:  2 }),
	overallScore: numeric("overall_score", { precision: 3, scale:  2 }),
	recommendations: text(),
	improvementAreas: text("improvement_areas").array(),
	strengths: text().array(),
	evaluatedBy: uuid("evaluated_by").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.contractorId],
			foreignColumns: [contractors.id],
			name: "contractor_performance_contractor_id_contractors_id_fk"
		}),
]);

export const contractors = pgTable("contractors", {
	id: serial().primaryKey().notNull(),
	name: varchar({ length: 255 }).notNull(),
	email: varchar({ length: 255 }),
	phone: varchar({ length: 50 }).notNull(),
	specialty: varchar({ length: 100 }).notNull(),
	rate: numeric({ precision: 10, scale:  2 }),
	currency: currency().default('KES'),
	isAvailable: boolean("is_available").default(true),
	rating: numeric({ precision: 3, scale:  2 }).default('0'),
	completedJobs: integer("completed_jobs").default(0),
	address: text(),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	organizationId: integer("organization_id").notNull(),
	categoryId: integer("category_id"),
	companyName: varchar("company_name", { length: 255 }).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.categoryId],
			foreignColumns: [contractorCategories.id],
			name: "contractors_category_id_contractor_categories_id_fk"
		}),
]);

export const diasporaPaymentSchedule = pgTable("diaspora_payment_schedule", {
	id: serial().primaryKey().notNull(),
	diasporaContractId: integer("diaspora_contract_id").notNull(),
	paymentNumber: integer("payment_number").notNull(),
	scheduledDate: timestamp("scheduled_date", { mode: 'string' }).notNull(),
	amount: numeric({ precision: 10, scale:  2 }).notNull(),
	isPaid: boolean("is_paid").default(false),
	paidDate: timestamp("paid_date", { mode: 'string' }),
	diasporaPaymentId: integer("diaspora_payment_id"),
	daysLate: integer("days_late").default(0),
	lateFeeApplied: numeric("late_fee_applied", { precision: 8, scale:  2 }).default('0.00'),
	notificationSent: boolean("notification_sent").default(false),
	remindersSent: integer("reminders_sent").default(0),
	lastReminderDate: timestamp("last_reminder_date", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.diasporaContractId],
			foreignColumns: [diasporaContracts.id],
			name: "diaspora_payment_schedule_diaspora_contract_id_diaspora_contrac"
		}),
	foreignKey({
			columns: [table.diasporaPaymentId],
			foreignColumns: [diasporaPayments.id],
			name: "diaspora_payment_schedule_diaspora_payment_id_diaspora_payments"
		}),
]);

export const encryptionKeys = pgTable("encryption_keys", {
	id: serial().primaryKey().notNull(),
	keyId: varchar("key_id", { length: 50 }).notNull(),
	keyType: varchar("key_type", { length: 30 }).notNull(),
	purpose: varchar({ length: 50 }).notNull(),
	encryptedKey: text("encrypted_key").notNull(),
	keyVersion: integer("key_version").default(1),
	isActive: boolean("is_active").default(true),
	expiresAt: timestamp("expires_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	rotatedAt: timestamp("rotated_at", { mode: 'string' }),
}, (table) => [
	unique("encryption_keys_key_id_unique").on(table.keyId),
]);

export const escrowAccounts = pgTable("escrow_accounts", {
	id: serial().primaryKey().notNull(),
	propertyId: integer("property_id"),
	accountType: varchar("account_type", { length: 30 }).notNull(),
	accountName: varchar("account_name", { length: 100 }).notNull(),
	bankAccountId: integer("bank_account_id"),
	currentBalance: numeric("current_balance", { precision: 15, scale:  2 }).default('0.00'),
	minimumBalance: numeric("minimum_balance", { precision: 15, scale:  2 }).default('0.00'),
	maximumBalance: numeric("maximum_balance", { precision: 15, scale:  2 }),
	currency: varchar({ length: 3 }).notNull(),
	autoTopUp: boolean("auto_top_up").default(false),
	topUpThreshold: numeric("top_up_threshold", { precision: 15, scale:  2 }),
	topUpAmount: numeric("top_up_amount", { precision: 15, scale:  2 }),
	isActive: boolean("is_active").default(true),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "escrow_accounts_property_id_properties_id_fk"
		}),
	foreignKey({
			columns: [table.bankAccountId],
			foreignColumns: [bankAccounts.id],
			name: "escrow_accounts_bank_account_id_bank_accounts_id_fk"
		}),
]);

export const documents = pgTable("documents", {
	id: serial().primaryKey().notNull(),
	name: varchar().notNull(),
	type: varchar().notNull(),
	url: varchar().notNull(),
	tenantId: integer("tenant_id"),
	propertyId: integer("property_id"),
	maintenanceRequestId: integer("maintenance_request_id"),
	uploadedBy: uuid("uploaded_by").notNull(),
	size: integer(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
});

export const diasporaCertificates = pgTable("diaspora_certificates", {
	id: serial().primaryKey().notNull(),
	diasporaContractId: integer("diaspora_contract_id").notNull(),
	certificateNumber: varchar("certificate_number").notNull(),
	certificateType: varchar("certificate_type").notNull(),
	qrCode: varchar("qr_code").notNull(),
	blockchainHash: varchar("blockchain_hash").notNull(),
	blockchainNetwork: varchar("blockchain_network").default('ethereum'),
	transactionHash: varchar("transaction_hash"),
	blockNumber: integer("block_number"),
	certificateData: jsonb("certificate_data").notNull(),
	verificationUrl: varchar("verification_url").notNull(),
	downloadUrl: varchar("download_url"),
	certificateStatus: certificateStatus("certificate_status").default('pending'),
	issuedDate: timestamp("issued_date", { mode: 'string' }),
	expiryDate: timestamp("expiry_date", { mode: 'string' }),
	verifiedAt: timestamp("verified_at", { mode: 'string' }),
	issuedBy: uuid("issued_by").notNull(),
	verifiedBy: uuid("verified_by"),
	revocationReason: text("revocation_reason"),
	revokedAt: timestamp("revoked_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.diasporaContractId],
			foreignColumns: [diasporaContracts.id],
			name: "diaspora_certificates_diaspora_contract_id_diaspora_contracts_i"
		}),
	unique("diaspora_certificates_certificate_number_unique").on(table.certificateNumber),
	unique("diaspora_certificates_qr_code_unique").on(table.qrCode),
	unique("diaspora_certificates_blockchain_hash_unique").on(table.blockchainHash),
]);

export const diasporaContracts = pgTable("diaspora_contracts", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	propertyId: integer("property_id").notNull(),
	clientName: varchar("client_name").notNull(),
	clientEmail: varchar("client_email").notNull(),
	clientPhone: varchar("client_phone").notNull(),
	clientWhatsapp: varchar("client_whatsapp").notNull(),
	clientCountry: varchar("client_country").notNull(),
	clientAddress: text("client_address"),
	identificationNumber: varchar("identification_number"),
	identificationType: varchar("identification_type"),
	totalPropertyValue: numeric("total_property_value", { precision: 12, scale:  2 }).notNull(),
	downPayment: numeric("down_payment", { precision: 12, scale:  2 }).notNull(),
	monthlyInstallment: numeric("monthly_installment", { precision: 10, scale:  2 }).notNull(),
	currency: varchar().default('KES').notNull(),
	paymentFrequency: varchar("payment_frequency").default('monthly').notNull(),
	contractDurationMonths: integer("contract_duration_months").notNull(),
	interestRate: numeric("interest_rate", { precision: 5, scale:  2 }).default('0.00'),
	paymentsMade: integer("payments_made").default(0),
	totalPaid: numeric("total_paid", { precision: 12, scale:  2 }).default('0.00'),
	remainingBalance: numeric("remaining_balance", { precision: 12, scale:  2 }).notNull(),
	completionPercentage: numeric("completion_percentage", { precision: 5, scale:  2 }).default('0.00'),
	nextPaymentDue: timestamp("next_payment_due", { mode: 'string' }).notNull(),
	constructionStatus: constructionStatus("construction_status").default('planning'),
	constructionStartDate: timestamp("construction_start_date", { mode: 'string' }),
	expectedCompletionDate: timestamp("expected_completion_date", { mode: 'string' }),
	actualCompletionDate: timestamp("actual_completion_date", { mode: 'string' }),
	paymentMethod: varchar("payment_method").notNull(),
	internationalProvider: varchar("international_provider").notNull(),
	localBankAccount: varchar("local_bank_account"),
	contractSignedAt: timestamp("contract_signed_at", { mode: 'string' }),
	legalDocumentUrl: varchar("legal_document_url"),
	digitalCertificateIssued: boolean("digital_certificate_issued").default(false),
	certificateQrCode: varchar("certificate_qr_code"),
	certificateStatus: certificateStatus("certificate_status").default('not_issued'),
	blockchainHash: varchar("blockchain_hash"),
	registryLink: varchar("registry_link"),
	status: varchar().default('active'),
	assignedManager: varchar("assigned_manager"),
	createdBy: uuid("created_by").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "diaspora_contracts_organization_id_organizations_id_fk"
		}),
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "diaspora_contracts_property_id_properties_id_fk"
		}),
]);

export const diasporaPayments = pgTable("diaspora_payments", {
	id: serial().primaryKey().notNull(),
	diasporaContractId: integer("diaspora_contract_id").notNull(),
	paymentNumber: integer("payment_number").notNull(),
	amount: numeric({ precision: 10, scale:  2 }).notNull(),
	currency: varchar().notNull(),
	exchangeRate: numeric("exchange_rate", { precision: 10, scale:  6 }),
	originalAmount: numeric("original_amount", { precision: 10, scale:  2 }),
	originalCurrency: varchar("original_currency"),
	paymentDate: timestamp("payment_date", { mode: 'string' }).notNull(),
	dueDate: timestamp("due_date", { mode: 'string' }).notNull(),
	paymentMethod: varchar("payment_method").notNull(),
	internationalProvider: varchar("international_provider").notNull(),
	providerTransactionId: varchar("provider_transaction_id"),
	paymentStatus: paymentStatus("payment_status").default('pending'),
	processingFee: numeric("processing_fee", { precision: 8, scale:  2 }).default('0.00'),
	exchangeFee: numeric("exchange_fee", { precision: 8, scale:  2 }).default('0.00'),
	lateFee: numeric("late_fee", { precision: 8, scale:  2 }).default('0.00'),
	receiptUrl: varchar("receipt_url"),
	confirmationCode: varchar("confirmation_code"),
	notes: text(),
	processedBy: uuid("processed_by"),
	processedAt: timestamp("processed_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.diasporaContractId],
			foreignColumns: [diasporaContracts.id],
			name: "diaspora_payments_diaspora_contract_id_diaspora_contracts_id_fk"
		}),
]);

export const expenseLineItems = pgTable("expense_line_items", {
	id: serial().primaryKey().notNull(),
	expenseReportId: integer("expense_report_id").notNull(),
	expenseDate: timestamp("expense_date", { mode: 'string' }).notNull(),
	expenseType: expenseType("expense_type").notNull(),
	description: text().notNull(),
	amount: numeric({ precision: 12, scale:  2 }).notNull(),
	currency: varchar({ length: 3 }).default('KES'),
	receiptUrl: varchar("receipt_url", { length: 500 }),
	ocrData: jsonb("ocr_data"),
	accountCodeId: integer("account_code_id"),
	costCenterId: integer("cost_center_id"),
	propertyId: integer("property_id"),
	unitId: integer("unit_id"),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.expenseReportId],
			foreignColumns: [expenseReports.id],
			name: "expense_line_items_expense_report_id_expense_reports_id_fk"
		}),
	foreignKey({
			columns: [table.accountCodeId],
			foreignColumns: [chartOfAccounts.id],
			name: "expense_line_items_account_code_id_chart_of_accounts_id_fk"
		}),
	foreignKey({
			columns: [table.costCenterId],
			foreignColumns: [costCenters.id],
			name: "expense_line_items_cost_center_id_cost_centers_id_fk"
		}),
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "expense_line_items_property_id_properties_id_fk"
		}),
	foreignKey({
			columns: [table.unitId],
			foreignColumns: [units.id],
			name: "expense_line_items_unit_id_units_id_fk"
		}),
]);

export const feedbackVotes = pgTable("feedback_votes", {
	id: serial().primaryKey().notNull(),
	feedbackId: integer("feedback_id").notNull(),
	userId: uuid("user_id").notNull(),
	voteType: varchar("vote_type").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.feedbackId],
			foreignColumns: [userFeedback.id],
			name: "feedback_votes_feedback_id_user_feedback_id_fk"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "feedback_votes_user_id_users_id_fk"
		}),
]);

export const financialReconciliation = pgTable("financial_reconciliation", {
	id: serial().primaryKey().notNull(),
	reconciliationId: varchar("reconciliation_id", { length: 100 }).notNull(),
	bankAccountId: integer("bank_account_id"),
	periodStart: timestamp("period_start", { mode: 'string' }).notNull(),
	periodEnd: timestamp("period_end", { mode: 'string' }).notNull(),
	openingBalance: numeric("opening_balance", { precision: 15, scale:  2 }).notNull(),
	closingBalance: numeric("closing_balance", { precision: 15, scale:  2 }).notNull(),
	totalTransactions: integer("total_transactions").default(0),
	matchedTransactions: integer("matched_transactions").default(0),
	unmatchedTransactions: integer("unmatched_transactions").default(0),
	discrepancies: numeric({ precision: 15, scale:  2 }).default('0.00'),
	status: varchar({ length: 30 }).notNull(),
	reconciledBy: uuid("reconciled_by"),
	reconciledAt: timestamp("reconciled_at", { mode: 'string' }),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.bankAccountId],
			foreignColumns: [bankAccounts.id],
			name: "financial_reconciliation_bank_account_id_bank_accounts_id_fk"
		}),
	unique("financial_reconciliation_reconciliation_id_unique").on(table.reconciliationId),
]);

export const generalLedger = pgTable("general_ledger", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	transactionId: varchar("transaction_id", { length: 100 }).notNull(),
	journalEntryId: integer("journal_entry_id"),
	accountId: integer("account_id").notNull(),
	costCenterId: integer("cost_center_id"),
	propertyId: integer("property_id"),
	unitId: integer("unit_id"),
	debitAmount: numeric("debit_amount", { precision: 15, scale:  2 }).default('0.00'),
	creditAmount: numeric("credit_amount", { precision: 15, scale:  2 }).default('0.00'),
	description: text().notNull(),
	reference: varchar({ length: 100 }),
	transactionDate: timestamp("transaction_date", { mode: 'string' }).notNull(),
	fiscalYear: integer("fiscal_year").notNull(),
	fiscalPeriod: integer("fiscal_period").notNull(),
	currency: varchar({ length: 3 }).default('KES'),
	exchangeRate: numeric("exchange_rate", { precision: 10, scale:  6 }).default('1.000000'),
	createdBy: uuid("created_by").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "general_ledger_organization_id_organizations_id_fk"
		}),
	foreignKey({
			columns: [table.journalEntryId],
			foreignColumns: [journalEntries.id],
			name: "general_ledger_journal_entry_id_journal_entries_id_fk"
		}),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [chartOfAccounts.id],
			name: "general_ledger_account_id_chart_of_accounts_id_fk"
		}),
	foreignKey({
			columns: [table.costCenterId],
			foreignColumns: [costCenters.id],
			name: "general_ledger_cost_center_id_cost_centers_id_fk"
		}),
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "general_ledger_property_id_properties_id_fk"
		}),
	foreignKey({
			columns: [table.unitId],
			foreignColumns: [units.id],
			name: "general_ledger_unit_id_units_id_fk"
		}),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "general_ledger_created_by_users_id_fk"
		}),
	unique("general_ledger_transaction_id_unique").on(table.transactionId),
]);

export const invoiceReminders = pgTable("invoice_reminders", {
	id: serial().primaryKey().notNull(),
	tenantId: integer("tenant_id"),
	type: varchar({ length: 50 }).notNull(),
	referenceId: integer("reference_id").notNull(),
	reminderType: varchar("reminder_type", { length: 50 }).notNull(),
	daysOffset: integer("days_offset").notNull(),
	channel: messageChannel().default('email'),
	isActive: boolean("is_active").default(true),
	lastSent: timestamp("last_sent", { mode: 'string' }),
	nextScheduled: timestamp("next_scheduled", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.tenantId],
			foreignColumns: [tenants.id],
			name: "invoice_reminders_tenant_id_tenants_id_fk"
		}),
]);

export const iotDevices = pgTable("iot_devices", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	propertyId: integer("property_id").notNull(),
	unitId: integer("unit_id"),
	deviceType: varchar("device_type").notNull(),
	deviceName: varchar("device_name").notNull(),
	deviceModel: varchar("device_model"),
	macAddress: varchar("mac_address"),
	ipAddress: varchar("ip_address"),
	status: varchar().default('online').notNull(),
	batteryLevel: integer("battery_level"),
	firmwareVersion: varchar("firmware_version"),
	lastReading: jsonb("last_reading"),
	lastUpdate: timestamp("last_update", { mode: 'string' }).defaultNow(),
	alertsCount: integer("alerts_count").default(0),
	monthlySavings: numeric("monthly_savings", { precision: 10, scale:  2 }).default('0'),
	installationDate: timestamp("installation_date", { mode: 'string' }).defaultNow(),
	warrantyExpiry: timestamp("warranty_expiry", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "iot_devices_organization_id_organizations_id_fk"
		}),
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "iot_devices_property_id_properties_id_fk"
		}),
	foreignKey({
			columns: [table.unitId],
			foreignColumns: [units.id],
			name: "iot_devices_unit_id_units_id_fk"
		}),
	unique("iot_devices_mac_address_unique").on(table.macAddress),
]);

export const expenseReports = pgTable("expense_reports", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	reportNumber: varchar("report_number", { length: 50 }).notNull(),
	employeeId: uuid("employee_id").notNull(),
	title: varchar({ length: 255 }).notNull(),
	description: text(),
	totalAmount: numeric("total_amount", { precision: 15, scale:  2 }).notNull(),
	currency: varchar({ length: 3 }).default('KES'),
	submittedDate: timestamp("submitted_date", { mode: 'string' }).notNull(),
	approvalStatus: approvalStatus("approval_status").default('draft'),
	l1ApproverId: uuid("l1_approver_id"),
	l1ApprovedAt: timestamp("l1_approved_at", { mode: 'string' }),
	l1Comments: text("l1_comments"),
	l2ApproverId: uuid("l2_approver_id"),
	l2ApprovedAt: timestamp("l2_approved_at", { mode: 'string' }),
	l2Comments: text("l2_comments"),
	mdApproverId: uuid("md_approver_id"),
	mdApprovedAt: timestamp("md_approved_at", { mode: 'string' }),
	mdComments: text("md_comments"),
	rejectedReason: text("rejected_reason"),
	paidDate: timestamp("paid_date", { mode: 'string' }),
	paymentReference: varchar("payment_reference", { length: 100 }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	expenseType: varchar("expense_type", { length: 100 }),
}, (table) => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "expense_reports_organization_id_organizations_id_fk"
		}),
	foreignKey({
			columns: [table.employeeId],
			foreignColumns: [users.id],
			name: "expense_reports_employee_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.l1ApproverId],
			foreignColumns: [users.id],
			name: "expense_reports_l1_approver_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.l2ApproverId],
			foreignColumns: [users.id],
			name: "expense_reports_l2_approver_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.mdApproverId],
			foreignColumns: [users.id],
			name: "expense_reports_md_approver_id_users_id_fk"
		}),
	unique("expense_reports_report_number_unique").on(table.reportNumber),
]);

export const featureAnnouncements = pgTable("feature_announcements", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id"),
	title: varchar({ length: 255 }).notNull(),
	description: text().notNull(),
	content: text(),
	featureId: varchar("feature_id"),
	category: varchar({ length: 100 }),
	status: featureStatus().default('new'),
	priority: priority().default('medium'),
	targetAudience: varchar("target_audience").array(),
	releaseDate: timestamp("release_date", { mode: 'string' }),
	announcementDate: timestamp("announcement_date", { mode: 'string' }),
	imageUrl: varchar("image_url"),
	videoUrl: varchar("video_url"),
	demoUrl: varchar("demo_url"),
	documentationUrl: varchar("documentation_url"),
	changelogUrl: varchar("changelog_url"),
	isActive: boolean("is_active").default(true),
	showAsTooltip: boolean("show_as_tooltip").default(false),
	showAsModal: boolean("show_as_modal").default(false),
	showAsBanner: boolean("show_as_banner").default(false),
	displayDuration: integer("display_duration").default(7),
	viewsCount: integer("views_count").default(0),
	clicksCount: integer("clicks_count").default(0),
	dismissalsCount: integer("dismissals_count").default(0),
	likesCount: integer("likes_count").default(0),
	metadata: jsonb().default({}),
	createdBy: uuid("created_by").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "feature_announcements_organization_id_organizations_id_fk"
		}),
	unique("feature_announcements_feature_id_unique").on(table.featureId),
]);

export const invoices = pgTable("invoices", {
	id: serial().primaryKey().notNull(),
	invoiceNumber: varchar("invoice_number").notNull(),
	tenantId: integer("tenant_id"),
	propertyId: integer("property_id").notNull(),
	unitId: integer("unit_id"),
	type: varchar().notNull(),
	amount: varchar().notNull(),
	currency: varchar().default('KES'),
	issueDate: timestamp("issue_date", { mode: 'string' }).defaultNow(),
	dueDate: timestamp("due_date", { mode: 'string' }).notNull(),
	status: varchar().default('pending'),
	paidDate: timestamp("paid_date", { mode: 'string' }),
	paymentMethod: varchar("payment_method"),
	description: text(),
	lineItems: json("line_items"),
	taxAmount: varchar("tax_amount").default('0'),
	discountAmount: varchar("discount_amount").default('0'),
	totalAmount: varchar("total_amount").notNull(),
	remindersSent: integer("reminders_sent").default(0),
	lastReminderDate: timestamp("last_reminder_date", { mode: 'string' }),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.tenantId],
			foreignColumns: [tenants.id],
			name: "invoices_tenant_id_tenants_id_fk"
		}),
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "invoices_property_id_properties_id_fk"
		}),
	foreignKey({
			columns: [table.unitId],
			foreignColumns: [units.id],
			name: "invoices_unit_id_units_id_fk"
		}),
	unique("invoices_invoice_number_unique").on(table.invoiceNumber),
]);

export const ledgerAccounts = pgTable("ledger_accounts", {
	id: serial().primaryKey().notNull(),
	accountCode: varchar("account_code", { length: 20 }).notNull(),
	accountName: varchar("account_name", { length: 100 }).notNull(),
	accountType: varchar("account_type", { length: 30 }).notNull(),
	accountSubType: varchar("account_sub_type", { length: 50 }),
	parentAccountId: integer("parent_account_id"),
	isActive: boolean("is_active").default(true),
	currentBalance: numeric("current_balance", { precision: 15, scale:  2 }).default('0.00'),
	currency: varchar({ length: 3 }).notNull(),
	description: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.parentAccountId],
			foreignColumns: [table.id],
			name: "ledger_accounts_parent_account_id_ledger_accounts_id_fk"
		}),
	unique("ledger_accounts_account_code_unique").on(table.accountCode),
]);

export const managedPropertyMaintenance = pgTable("managed_property_maintenance", {
	id: serial().primaryKey().notNull(),
	propertyId: integer("property_id").notNull(),
	managementAgreementId: integer("management_agreement_id"),
	maintenanceType: varchar("maintenance_type", { length: 30 }).notNull(),
	description: text().notNull(),
	priority: varchar({ length: 10 }).default('medium'),
	scheduledDate: timestamp("scheduled_date", { mode: 'string' }),
	completedDate: timestamp("completed_date", { mode: 'string' }),
	estimatedCost: numeric("estimated_cost", { precision: 10, scale:  2 }),
	actualCost: numeric("actual_cost", { precision: 10, scale:  2 }),
	approvedBudget: numeric("approved_budget", { precision: 10, scale:  2 }),
	requiresOwnerApproval: boolean("requires_owner_approval").default(false),
	ownerApprovalStatus: varchar("owner_approval_status", { length: 20 }).default('pending'),
	ownerApprovalDate: timestamp("owner_approval_date", { mode: 'string' }),
	ownerNotes: text("owner_notes"),
	serviceProvider: varchar("service_provider", { length: 100 }),
	contractorId: integer("contractor_id"),
	affectsAvailability: boolean("affects_availability").default(false),
	blockedDates: jsonb("blocked_dates"),
	status: varchar({ length: 20 }).default('pending'),
	photos: jsonb(),
	documents: jsonb(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "managed_property_maintenance_property_id_properties_id_fk"
		}),
	foreignKey({
			columns: [table.contractorId],
			foreignColumns: [contractors.id],
			name: "managed_property_maintenance_contractor_id_contractors_id_fk"
		}),
	foreignKey({
			columns: [table.managementAgreementId],
			foreignColumns: [propertyManagementAgreements.id],
			name: "managed_property_maintenance_management_agreement_id_property_m"
		}),
]);

export const landlordPortalSessions = pgTable("landlord_portal_sessions", {
	id: serial().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	sessionToken: varchar("session_token").notNull(),
	expiresAt: timestamp("expires_at", { mode: 'string' }).notNull(),
	lastActivity: timestamp("last_activity", { mode: 'string' }).defaultNow(),
	ipAddress: varchar("ip_address"),
	userAgent: text("user_agent"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "landlord_portal_sessions_user_id_users_id_fk"
		}),
	unique("landlord_portal_sessions_session_token_unique").on(table.sessionToken),
]);

export const journalEntries = pgTable("journal_entries", {
	id: serial().primaryKey().notNull(),
	entryId: varchar("entry_id", { length: 100 }).notNull(),
	entryDate: timestamp("entry_date", { mode: 'string' }).notNull(),
	description: text().notNull(),
	reference: varchar({ length: 100 }),
	totalDebit: numeric("total_debit", { precision: 15, scale:  2 }).notNull(),
	totalCredit: numeric("total_credit", { precision: 15, scale:  2 }).notNull(),
	currency: varchar({ length: 3 }).notNull(),
	status: varchar({ length: 20 }).notNull(),
	propertyId: integer("property_id"),
	tenantId: integer("tenant_id"),
	transactionId: integer("transaction_id"),
	createdBy: uuid("created_by").notNull(),
	approvedBy: uuid("approved_by"),
	approvedAt: timestamp("approved_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "journal_entries_property_id_properties_id_fk"
		}),
	foreignKey({
			columns: [table.tenantId],
			foreignColumns: [tenants.id],
			name: "journal_entries_tenant_id_tenants_id_fk"
		}),
	foreignKey({
			columns: [table.transactionId],
			foreignColumns: [paymentTransactions.id],
			name: "journal_entries_transaction_id_payment_transactions_id_fk"
		}),
	unique("journal_entries_entry_id_unique").on(table.entryId),
]);

export const mobileMoney = pgTable("mobile_money", {
	id: serial().primaryKey().notNull(),
	providerId: integer("provider_id"),
	businessShortCode: varchar("business_short_code", { length: 20 }),
	tillNumber: varchar("till_number", { length: 20 }),
	phoneNumber: varchar("phone_number", { length: 20 }).notNull(),
	accountName: varchar("account_name", { length: 100 }).notNull(),
	currency: varchar({ length: 3 }).notNull(),
	currentBalance: numeric("current_balance", { precision: 15, scale:  2 }).default('0.00'),
	isActive: boolean("is_active").default(true),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.providerId],
			foreignColumns: [paymentProviders.id],
			name: "mobile_money_provider_id_payment_providers_id_fk"
		}),
]);

export const messages = pgTable("messages", {
	id: serial().primaryKey().notNull(),
	fromUserId: varchar("from_user_id").notNull(),
	toUserId: varchar("to_user_id").notNull(),
	subject: varchar(),
	content: text().notNull(),
	channel: messageChannel().default('app'),
	type: messageType().default('chat'),
	messageType: varchar("message_type").default('direct'),
	isRead: boolean("is_read").default(false),
	isScheduled: boolean("is_scheduled").default(false),
	scheduledAt: timestamp("scheduled_at", { mode: 'string' }),
	sentAt: timestamp("sent_at", { mode: 'string' }),
	metadata: jsonb(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
});

export const journalEntryLines = pgTable("journal_entry_lines", {
	id: serial().primaryKey().notNull(),
	journalEntryId: integer("journal_entry_id"),
	lineNumber: integer("line_number").notNull(),
	accountId: integer("account_id"),
	description: text(),
	debitAmount: numeric("debit_amount", { precision: 15, scale:  2 }).default('0.00'),
	creditAmount: numeric("credit_amount", { precision: 15, scale:  2 }).default('0.00'),
	currency: varchar({ length: 3 }).notNull(),
	propertyId: integer("property_id"),
	tenantId: integer("tenant_id"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.journalEntryId],
			foreignColumns: [journalEntries.id],
			name: "journal_entry_lines_journal_entry_id_journal_entries_id_fk"
		}),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [ledgerAccounts.id],
			name: "journal_entry_lines_account_id_ledger_accounts_id_fk"
		}),
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "journal_entry_lines_property_id_properties_id_fk"
		}),
	foreignKey({
			columns: [table.tenantId],
			foreignColumns: [tenants.id],
			name: "journal_entry_lines_tenant_id_tenants_id_fk"
		}),
]);

export const maintenanceRequests = pgTable("maintenance_requests", {
	id: serial().primaryKey().notNull(),
	ticketNumber: varchar("ticket_number").notNull(),
	tenantId: integer("tenant_id").notNull(),
	unitId: integer("unit_id").notNull(),
	contractorId: integer("contractor_id"),
	title: varchar().notNull(),
	description: text().notNull(),
	category: varchar().default('other'),
	priority: priority().notNull(),
	status: maintenanceStatus().default('pending'),
	assignedTo: varchar("assigned_to"),
	assignedDate: timestamp("assigned_date", { mode: 'string' }),
	startedDate: timestamp("started_date", { mode: 'string' }),
	estimatedCost: numeric("estimated_cost", { precision: 10, scale:  2 }),
	actualCost: numeric("actual_cost", { precision: 10, scale:  2 }),
	estimatedHours: integer("estimated_hours"),
	actualHours: integer("actual_hours"),
	currency: currency().default('USD'),
	scheduledDate: timestamp("scheduled_date", { mode: 'string' }),
	approvalRequired: boolean("approval_required").default(false),
	approvedBy: uuid("approved_by"),
	approvedDate: timestamp("approved_date", { mode: 'string' }),
	rejectionReason: text("rejection_reason"),
	tenantNotes: text("tenant_notes"),
	contractorNotes: text("contractor_notes"),
	internalNotes: text("internal_notes"),
	customerSatisfaction: integer("customer_satisfaction"),
	satisfactionRating: integer("satisfaction_rating"),
	satisfactionComments: text("satisfaction_comments"),
	feedbackDate: timestamp("feedback_date", { mode: 'string' }),
	responseTime: integer("response_time"),
	resolutionTime: integer("resolution_time"),
	technicianId: integer("technician_id"),
	technicianNotes: text("technician_notes"),
	timeLog: jsonb("time_log"),
	totalTimeSpent: integer("total_time_spent"),
	workStartTime: timestamp("work_start_time", { mode: 'string' }),
	workEndTime: timestamp("work_end_time", { mode: 'string' }),
	followUpRequired: boolean("follow_up_required").default(false),
	followUpDate: timestamp("follow_up_date", { mode: 'string' }),
	recurrence: varchar().default('none'),
	completedAt: timestamp("completed_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	laborCost: numeric("labor_cost", { precision: 10, scale:  2 }),
}, (table) => [
	foreignKey({
			columns: [table.contractorId],
			foreignColumns: [contractors.id],
			name: "maintenance_requests_contractor_id_contractors_id_fk"
		}),
	unique("maintenance_requests_ticket_number_unique").on(table.ticketNumber),
]);

export const ownerFinancialStatements = pgTable("owner_financial_statements", {
	id: serial().primaryKey().notNull(),
	statementNumber: varchar("statement_number", { length: 50 }).notNull(),
	ownerId: integer("owner_id").notNull(),
	propertyId: integer("property_id"),
	periodStart: timestamp("period_start", { mode: 'string' }).notNull(),
	periodEnd: timestamp("period_end", { mode: 'string' }).notNull(),
	statementType: varchar("statement_type", { length: 20 }).notNull(),
	totalRevenue: numeric("total_revenue", { precision: 12, scale:  2 }).default('0.00'),
	bookingRevenue: numeric("booking_revenue", { precision: 12, scale:  2 }).default('0.00'),
	additionalFees: numeric("additional_fees", { precision: 12, scale:  2 }).default('0.00'),
	totalExpenses: numeric("total_expenses", { precision: 12, scale:  2 }).default('0.00'),
	managementFees: numeric("management_fees", { precision: 12, scale:  2 }).default('0.00'),
	maintenanceCosts: numeric("maintenance_costs", { precision: 12, scale:  2 }).default('0.00'),
	cleaningCosts: numeric("cleaning_costs", { precision: 12, scale:  2 }).default('0.00'),
	utilityCosts: numeric("utility_costs", { precision: 12, scale:  2 }).default('0.00'),
	insuranceCosts: numeric("insurance_costs", { precision: 12, scale:  2 }).default('0.00'),
	taxesPaid: numeric("taxes_paid", { precision: 12, scale:  2 }).default('0.00'),
	netIncome: numeric("net_income", { precision: 12, scale:  2 }).default('0.00'),
	ownerPayout: numeric("owner_payout", { precision: 12, scale:  2 }).default('0.00'),
	occupancyRate: numeric("occupancy_rate", { precision: 5, scale:  2 }),
	averageDailyRate: numeric("average_daily_rate", { precision: 10, scale:  2 }),
	totalNightsBooked: integer("total_nights_booked").default(0),
	status: varchar({ length: 20 }).default('draft'),
	sentDate: timestamp("sent_date", { mode: 'string' }),
	paidDate: timestamp("paid_date", { mode: 'string' }),
	revenueBreakdown: jsonb("revenue_breakdown"),
	expenseBreakdown: jsonb("expense_breakdown"),
	bookingDetails: jsonb("booking_details"),
	currency: varchar({ length: 3 }).default('USD'),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [tenants.id],
			name: "owner_financial_statements_owner_id_tenants_id_fk"
		}),
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "owner_financial_statements_property_id_properties_id_fk"
		}),
	unique("owner_financial_statements_statement_number_unique").on(table.statementNumber),
]);

export const mpesaTransactions = pgTable("mpesa_transactions", {
	id: serial().primaryKey().notNull(),
	tenantId: integer("tenant_id"),
	rentPaymentId: integer("rent_payment_id"),
	serviceChargeId: integer("service_charge_id"),
	transactionId: varchar("transaction_id", { length: 100 }),
	phoneNumber: varchar("phone_number", { length: 20 }).notNull(),
	amount: numeric({ precision: 10, scale:  2 }).notNull(),
	currency: currency().default('KES'),
	status: varchar({ length: 50 }).default('pending'),
	mpesaReceiptNumber: varchar("mpesa_receipt_number", { length: 100 }),
	merchantRequestId: varchar("merchant_request_id", { length: 100 }),
	checkoutRequestId: varchar("checkout_request_id", { length: 100 }),
	responseCode: varchar("response_code", { length: 10 }),
	responseDescription: text("response_description"),
	customerMessage: text("customer_message"),
	transactionDate: varchar("transaction_date", { length: 50 }),
	resultCode: varchar("result_code", { length: 10 }),
	resultDesc: text("result_desc"),
	description: text(),
	callbackData: jsonb("callback_data"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.tenantId],
			foreignColumns: [tenants.id],
			name: "mpesa_transactions_tenant_id_tenants_id_fk"
		}),
	foreignKey({
			columns: [table.rentPaymentId],
			foreignColumns: [rentPayments.id],
			name: "mpesa_transactions_rent_payment_id_rent_payments_id_fk"
		}),
	foreignKey({
			columns: [table.serviceChargeId],
			foreignColumns: [serviceCharges.id],
			name: "mpesa_transactions_service_charge_id_service_charges_id_fk"
		}),
	unique("mpesa_transactions_transaction_id_unique").on(table.transactionId),
]);

export const ownershipCertificates = pgTable("ownership_certificates", {
	id: serial().primaryKey().notNull(),
	certificateNumber: varchar("certificate_number", { length: 50 }).notNull(),
	propertyId: integer("property_id").notNull(),
	ownerId: integer("owner_id").notNull(),
	ownershipType: varchar("ownership_type", { length: 30 }).notNull(),
	ownershipPercentage: numeric("ownership_percentage", { precision: 5, scale:  2 }).default('100.00'),
	acquisitionType: varchar("acquisition_type", { length: 30 }).notNull(),
	titleDeedNumber: varchar("title_deed_number", { length: 100 }),
	registrationNumber: varchar("registration_number", { length: 100 }),
	legalDescription: text("legal_description"),
	surveyDetails: jsonb("survey_details"),
	acquisitionDate: timestamp("acquisition_date", { mode: 'string' }).notNull(),
	certificateIssueDate: timestamp("certificate_issue_date", { mode: 'string' }).defaultNow(),
	expiryDate: timestamp("expiry_date", { mode: 'string' }),
	documents: jsonb(),
	isVerified: boolean("is_verified").default(false),
	verifiedBy: uuid("verified_by"),
	verificationDate: timestamp("verification_date", { mode: 'string' }),
	complianceStatus: varchar("compliance_status", { length: 20 }).default('pending'),
	status: varchar({ length: 20 }).default('active'),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "ownership_certificates_property_id_properties_id_fk"
		}),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [tenants.id],
			name: "ownership_certificates_owner_id_tenants_id_fk"
		}),
	unique("ownership_certificates_certificate_number_unique").on(table.certificateNumber),
]);

export const parkingSpaces = pgTable("parking_spaces", {
	id: serial().primaryKey().notNull(),
	propertyId: integer("property_id").notNull(),
	spaceNumber: varchar("space_number").notNull(),
	floor: varchar(),
	section: varchar(),
	spaceType: varchar("space_type").notNull(),
	length: numeric({ precision: 5, scale:  2 }),
	width: numeric({ precision: 5, scale:  2 }),
	isAvailable: boolean("is_available").default(true),
	isReserved: boolean("is_reserved").default(false),
	reservedFor: varchar("reserved_for"),
	monthlyRate: numeric("monthly_rate", { precision: 10, scale:  2 }),
	currency: currency().default('KES'),
	hasElectricCharging: boolean("has_electric_charging").default(false),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "parking_spaces_property_id_properties_id_fk"
		}),
]);

export const paymentAllocationRules = pgTable("payment_allocation_rules", {
	id: serial().primaryKey().notNull(),
	tenantId: integer("tenant_id"),
	propertyId: integer("property_id"),
	ruleName: varchar("rule_name", { length: 100 }).notNull(),
	allocationType: varchar("allocation_type", { length: 30 }).notNull(),
	allocations: jsonb().notNull(),
	isDefault: boolean("is_default").default(false),
	isActive: boolean("is_active").default(true),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.tenantId],
			foreignColumns: [tenants.id],
			name: "payment_allocation_rules_tenant_id_tenants_id_fk"
		}),
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "payment_allocation_rules_property_id_properties_id_fk"
		}),
]);

export const organizations = pgTable("organizations", {
	id: serial().primaryKey().notNull(),
	name: varchar({ length: 255 }).notNull(),
	slug: varchar({ length: 100 }).notNull(),
	domain: varchar({ length: 255 }),
	logo: varchar(),
	primaryColor: varchar("primary_color", { length: 7 }).default('#3B82F6'),
	secondaryColor: varchar("secondary_color", { length: 7 }).default('#EF4444'),
	whiteLabel: jsonb("white_label").default({}),
	subscriptionPlan: varchar("subscription_plan", { length: 50 }).default('basic'),
	subscriptionStatus: varchar("subscription_status", { length: 20 }).default('trial'),
	maxProperties: integer("max_properties").default(5),
	maxUsers: integer("max_users").default(10),
	features: jsonb().default({}),
	isActive: boolean("is_active").default(true),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	unique("organizations_slug_unique").on(table.slug),
	unique("organizations_domain_unique").on(table.domain),
]);

export const organizationSettings = pgTable("organization_settings", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	timezone: varchar({ length: 50 }).default('Africa/Nairobi'),
	defaultCurrency: varchar("default_currency", { length: 3 }).default('KES'),
	dateFormat: varchar("date_format", { length: 20 }).default('DD/MM/YYYY'),
	language: varchar({ length: 10 }).default('en'),
	emailSettings: jsonb("email_settings").default({}),
	smsSettings: jsonb("sms_settings").default({}),
	paymentSettings: jsonb("payment_settings").default({}),
	customFields: jsonb("custom_fields").default({}),
	integrations: jsonb().default({}),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "organization_settings_organization_id_organizations_id_fk"
		}),
]);

export const paymentReceipts = pgTable("payment_receipts", {
	id: serial().primaryKey().notNull(),
	paymentId: integer("payment_id").notNull(),
	tenantId: integer("tenant_id").notNull(),
	receiptNumber: varchar("receipt_number").notNull(),
	amount: numeric({ precision: 15, scale:  2 }).notNull(),
	currency: varchar().default('USD'),
	paymentMethod: varchar("payment_method").notNull(),
	paymentDate: date("payment_date").notNull(),
	description: text(),
	pdfPath: varchar("pdf_path"),
	sentViaEmail: boolean("sent_via_email").default(false),
	sentViaSms: boolean("sent_via_sms").default(false),
	emailSentAt: timestamp("email_sent_at", { mode: 'string' }),
	smsSentAt: timestamp("sms_sent_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	unique("payment_receipts_receipt_number_unique").on(table.receiptNumber),
]);

export const paymentReminders = pgTable("payment_reminders", {
	id: serial().primaryKey().notNull(),
	tenantId: integer("tenant_id").notNull(),
	arrearsId: integer("arrears_id"),
	reminderType: varchar("reminder_type", { length: 20 }).notNull(),
	channel: varchar({ length: 10 }).notNull(),
	message: text().notNull(),
	scheduledFor: timestamp("scheduled_for", { mode: 'string' }).notNull(),
	sentAt: timestamp("sent_at", { mode: 'string' }),
	status: varchar({ length: 20 }).default('pending').notNull(),
	recipientInfo: jsonb("recipient_info"),
	responseReceived: boolean("response_received").default(false),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.tenantId],
			foreignColumns: [tenants.id],
			name: "payment_reminders_tenant_id_tenants_id_fk"
		}),
	foreignKey({
			columns: [table.arrearsId],
			foreignColumns: [arrears.id],
			name: "payment_reminders_arrears_id_arrears_id_fk"
		}),
]);

export const portalCustomization = pgTable("portal_customization", {
	id: serial().primaryKey().notNull(),
	portalType: varchar("portal_type").notNull(),
	entityId: varchar("entity_id").notNull(),
	brandingConfig: jsonb("branding_config"),
	layoutConfig: jsonb("layout_config"),
	notificationPreferences: jsonb("notification_preferences"),
	features: jsonb(),
	customCss: text("custom_css"),
	isActive: boolean("is_active").default(true),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
});

export const portfolioReports = pgTable("portfolio_reports", {
	id: serial().primaryKey().notNull(),
	ownerId: uuid("owner_id").notNull(),
	reportType: varchar("report_type").notNull(),
	reportPeriodStart: date("report_period_start").notNull(),
	reportPeriodEnd: date("report_period_end").notNull(),
	propertiesIncluded: integer("properties_included").array(),
	totalRevenue: numeric("total_revenue", { precision: 15, scale:  2 }).default('0.00'),
	totalExpenses: numeric("total_expenses", { precision: 15, scale:  2 }).default('0.00'),
	netIncome: numeric("net_income", { precision: 15, scale:  2 }).default('0.00'),
	occupancyRate: numeric("occupancy_rate", { precision: 5, scale:  2 }),
	summary: jsonb(),
	reportData: jsonb("report_data"),
	pdfPath: varchar("pdf_path"),
	status: varchar().default('generated'),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	downloadedAt: timestamp("downloaded_at", { mode: 'string' }),
});

export const paymentProviders = pgTable("payment_providers", {
	id: serial().primaryKey().notNull(),
	name: varchar({ length: 100 }).notNull(),
	type: varchar({ length: 50 }).notNull(),
	apiEndpoint: varchar("api_endpoint", { length: 255 }),
	apiKey: text("api_key"),
	apiSecret: text("api_secret"),
	configuration: jsonb().default({}),
	isActive: boolean("is_active").default(true),
	supportedCurrencies: text("supported_currencies").array(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
});

export const paymentTransactions = pgTable("payment_transactions", {
	id: serial().primaryKey().notNull(),
	transactionId: varchar("transaction_id", { length: 100 }).notNull(),
	externalTransactionId: varchar("external_transaction_id", { length: 100 }),
	tenantId: integer("tenant_id"),
	propertyId: integer("property_id"),
	unitId: integer("unit_id"),
	providerId: integer("provider_id"),
	paymentMethod: varchar("payment_method", { length: 50 }).notNull(),
	amount: numeric({ precision: 15, scale:  2 }).notNull(),
	currency: varchar({ length: 3 }).notNull(),
	fees: numeric({ precision: 15, scale:  2 }).default('0.00'),
	netAmount: numeric("net_amount", { precision: 15, scale:  2 }).notNull(),
	status: varchar({ length: 30 }).notNull(),
	paymentType: varchar("payment_type", { length: 50 }).notNull(),
	description: text(),
	receivedAt: timestamp("received_at", { mode: 'string' }),
	processedAt: timestamp("processed_at", { mode: 'string' }),
	reconciledAt: timestamp("reconciled_at", { mode: 'string' }),
	metadata: jsonb().default({}),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.tenantId],
			foreignColumns: [tenants.id],
			name: "payment_transactions_tenant_id_tenants_id_fk"
		}),
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "payment_transactions_property_id_properties_id_fk"
		}),
	foreignKey({
			columns: [table.unitId],
			foreignColumns: [units.id],
			name: "payment_transactions_unit_id_units_id_fk"
		}),
	foreignKey({
			columns: [table.providerId],
			foreignColumns: [paymentProviders.id],
			name: "payment_transactions_provider_id_payment_providers_id_fk"
		}),
	unique("payment_transactions_transaction_id_unique").on(table.transactionId),
]);

export const poLineItems = pgTable("po_line_items", {
	id: serial().primaryKey().notNull(),
	poId: integer("po_id").notNull(),
	prLineItemId: integer("pr_line_item_id"),
	itemNumber: integer("item_number").notNull(),
	description: text().notNull(),
	quantity: numeric({ precision: 10, scale:  2 }).notNull(),
	unitCost: numeric("unit_cost", { precision: 12, scale:  2 }).notNull(),
	totalCost: numeric("total_cost", { precision: 15, scale:  2 }).notNull(),
	receivedQuantity: numeric("received_quantity", { precision: 10, scale:  2 }).default('0.00'),
	accountCodeId: integer("account_code_id"),
	costCenterId: integer("cost_center_id"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.poId],
			foreignColumns: [purchaseOrders.id],
			name: "po_line_items_po_id_purchase_orders_id_fk"
		}),
	foreignKey({
			columns: [table.prLineItemId],
			foreignColumns: [prLineItems.id],
			name: "po_line_items_pr_line_item_id_pr_line_items_id_fk"
		}),
	foreignKey({
			columns: [table.accountCodeId],
			foreignColumns: [chartOfAccounts.id],
			name: "po_line_items_account_code_id_chart_of_accounts_id_fk"
		}),
	foreignKey({
			columns: [table.costCenterId],
			foreignColumns: [costCenters.id],
			name: "po_line_items_cost_center_id_cost_centers_id_fk"
		}),
]);

export const payrollPeriods = pgTable("payroll_periods", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	periodName: varchar("period_name", { length: 100 }).notNull(),
	startDate: timestamp("start_date", { mode: 'string' }).notNull(),
	endDate: timestamp("end_date", { mode: 'string' }).notNull(),
	payDate: timestamp("pay_date", { mode: 'string' }).notNull(),
	status: payrollStatus().default('pending_approval'),
	totalGrossPay: numeric("total_gross_pay", { precision: 15, scale:  2 }).default('0.00'),
	totalDeductions: numeric("total_deductions", { precision: 15, scale:  2 }).default('0.00'),
	totalNetPay: numeric("total_net_pay", { precision: 15, scale:  2 }).default('0.00'),
	approvedBy: uuid("approved_by"),
	approvedAt: timestamp("approved_at", { mode: 'string' }),
	processedBy: uuid("processed_by"),
	processedAt: timestamp("processed_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	isActive: boolean("is_active").default(false),
	isLocked: boolean("is_locked").default(false),
}, (table) => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "payroll_periods_organization_id_organizations_id_fk"
		}),
	foreignKey({
			columns: [table.approvedBy],
			foreignColumns: [users.id],
			name: "payroll_periods_approved_by_users_id_fk"
		}),
	foreignKey({
			columns: [table.processedBy],
			foreignColumns: [users.id],
			name: "payroll_periods_processed_by_users_id_fk"
		}),
]);

export const projectTasks = pgTable("project_tasks", {
	id: serial().primaryKey().notNull(),
	projectId: integer("project_id").notNull(),
	name: text().notNull(),
	description: text(),
	status: varchar({ length: 50 }).default('todo').notNull(),
	priority: varchar({ length: 20 }).default('medium').notNull(),
	assignedTo: varchar("assigned_to"),
	estimatedHours: integer("estimated_hours"),
	actualHours: integer("actual_hours"),
	dueDate: timestamp("due_date", { mode: 'string' }),
	completedDate: timestamp("completed_date", { mode: 'string' }),
	dependencies: integer().array(),
	materials: text().array(),
	cost: numeric({ precision: 10, scale:  2 }),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "project_tasks_project_id_projects_id_fk"
		}),
]);

export const projectMilestones = pgTable("project_milestones", {
	id: serial().primaryKey().notNull(),
	projectId: integer("project_id").notNull(),
	name: text().notNull(),
	description: text(),
	targetDate: timestamp("target_date", { mode: 'string' }).notNull(),
	completedDate: timestamp("completed_date", { mode: 'string' }),
	status: varchar({ length: 50 }).default('pending').notNull(),
	importance: varchar({ length: 20 }).default('normal').notNull(),
	deliverables: text().array(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "project_milestones_project_id_projects_id_fk"
		}),
]);

export const projectTeam = pgTable("project_team", {
	id: serial().primaryKey().notNull(),
	projectId: integer("project_id").notNull(),
	memberId: varchar("member_id").notNull(),
	memberType: varchar("member_type", { length: 50 }).notNull(),
	role: text(),
	hourlyRate: numeric("hourly_rate", { precision: 10, scale:  2 }),
	joinedDate: timestamp("joined_date", { mode: 'string' }).defaultNow(),
	leftDate: timestamp("left_date", { mode: 'string' }),
	isActive: boolean("is_active").default(true),
}, (table) => [
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "project_team_project_id_projects_id_fk"
		}),
]);

export const projectExpenses = pgTable("project_expenses", {
	id: serial().primaryKey().notNull(),
	projectId: integer("project_id").notNull(),
	taskId: integer("task_id"),
	category: varchar({ length: 50 }).notNull(),
	description: text().notNull(),
	amount: numeric({ precision: 10, scale:  2 }).notNull(),
	vendor: text(),
	invoiceNumber: text("invoice_number"),
	receiptPath: text("receipt_path"),
	paidDate: timestamp("paid_date", { mode: 'string' }),
	status: varchar({ length: 50 }).default('pending').notNull(),
	paymentMethod: varchar("payment_method", { length: 20 }),
	approvedBy: uuid("approved_by"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "project_expenses_project_id_projects_id_fk"
		}),
	foreignKey({
			columns: [table.taskId],
			foreignColumns: [projectTasks.id],
			name: "project_expenses_task_id_project_tasks_id_fk"
		}),
]);

export const projectTimeTracking = pgTable("project_time_tracking", {
	id: serial().primaryKey().notNull(),
	projectId: integer("project_id").notNull(),
	taskId: integer("task_id"),
	memberId: varchar("member_id").notNull(),
	startTime: timestamp("start_time", { mode: 'string' }).notNull(),
	endTime: timestamp("end_time", { mode: 'string' }),
	duration: integer(),
	description: text(),
	billable: boolean().default(true),
	approved: boolean().default(false),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "project_time_tracking_project_id_projects_id_fk"
		}),
	foreignKey({
			columns: [table.taskId],
			foreignColumns: [projectTasks.id],
			name: "project_time_tracking_task_id_project_tasks_id_fk"
		}),
]);

export const properties = pgTable("properties", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	name: varchar().notNull(),
	address: text().notNull(),
	totalUnits: integer("total_units").notNull(),
	ownerId: uuid("owner_id"),
	description: text(),
	imageUrl: varchar("image_url"),
	customBranding: jsonb("custom_branding").default({}),
	siteSettings: jsonb("site_settings").default({}),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	galleryImages: jsonb("gallery_images").default([]),
}, (table) => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "properties_organization_id_organizations_id_fk"
		}),
]);

export const prLineItems = pgTable("pr_line_items", {
	id: serial().primaryKey().notNull(),
	prId: integer("pr_id").notNull(),
	itemNumber: integer("item_number").notNull(),
	description: text().notNull(),
	specification: text(),
	quantity: numeric({ precision: 10, scale:  2 }).notNull(),
	unitOfMeasure: varchar("unit_of_measure", { length: 20 }).notNull(),
	estimatedUnitCost: numeric("estimated_unit_cost", { precision: 12, scale:  2 }),
	estimatedTotalCost: numeric("estimated_total_cost", { precision: 15, scale:  2 }),
	accountCodeId: integer("account_code_id"),
	costCenterId: integer("cost_center_id"),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.prId],
			foreignColumns: [purchaseRequisitions.id],
			name: "pr_line_items_pr_id_purchase_requisitions_id_fk"
		}),
	foreignKey({
			columns: [table.accountCodeId],
			foreignColumns: [chartOfAccounts.id],
			name: "pr_line_items_account_code_id_chart_of_accounts_id_fk"
		}),
	foreignKey({
			columns: [table.costCenterId],
			foreignColumns: [costCenters.id],
			name: "pr_line_items_cost_center_id_cost_centers_id_fk"
		}),
]);

export const projects = pgTable("projects", {
	id: serial().primaryKey().notNull(),
	name: text().notNull(),
	description: text(),
	type: varchar({ length: 50 }).notNull(),
	status: varchar({ length: 50 }).default('planning').notNull(),
	priority: varchar({ length: 20 }).default('medium').notNull(),
	propertyId: integer("property_id"),
	unitId: integer("unit_id"),
	managerId: uuid("manager_id"),
	budget: numeric({ precision: 10, scale:  2 }),
	actualCost: numeric("actual_cost", { precision: 10, scale:  2 }),
	startDate: timestamp("start_date", { mode: 'string' }),
	endDate: timestamp("end_date", { mode: 'string' }),
	estimatedDuration: integer("estimated_duration"),
	actualDuration: integer("actual_duration"),
	completionPercentage: integer("completion_percentage").default(0),
	materials: text().array(),
	permits: text().array(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "projects_property_id_properties_id_fk"
		}),
	foreignKey({
			columns: [table.unitId],
			foreignColumns: [units.id],
			name: "projects_unit_id_units_id_fk"
		}),
	foreignKey({
			columns: [table.managerId],
			foreignColumns: [users.id],
			name: "projects_manager_id_users_id_fk"
		}),
]);

export const propertyManagers = pgTable("property_managers", {
	id: serial().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	employeeId: uuid("employee_id"),
	managementLevel: varchar("management_level", { length: 20 }).notNull(),
	specializations: text().array(),
	certifications: jsonb().default([]),
	contactNumber: varchar("contact_number", { length: 20 }),
	emergencyContact: varchar("emergency_contact", { length: 20 }),
	salary: numeric({ precision: 12, scale:  2 }),
	commissionRate: numeric("commission_rate", { precision: 5, scale:  2 }),
	startDate: timestamp("start_date", { mode: 'string' }),
	endDate: timestamp("end_date", { mode: 'string' }),
	status: varchar({ length: 20 }).default('active'),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "property_managers_user_id_users_id_fk"
		}),
]);

export const propertyManagementAgreements = pgTable("property_management_agreements", {
	id: serial().primaryKey().notNull(),
	agreementNumber: varchar("agreement_number", { length: 50 }).notNull(),
	propertyId: integer("property_id").notNull(),
	ownerId: integer("owner_id").notNull(),
	managementType: varchar("management_type", { length: 30 }).notNull(),
	managementFeeType: varchar("management_fee_type", { length: 20 }).notNull(),
	managementFeeRate: numeric("management_fee_rate", { precision: 5, scale:  2 }).notNull(),
	minimumStay: integer("minimum_stay").default(1),
	maximumStay: integer("maximum_stay").default(365),
	servicesIncluded: jsonb("services_included"),
	cleaningFee: numeric("cleaning_fee", { precision: 10, scale:  2 }).default('0.00'),
	maintenanceBudget: numeric("maintenance_budget", { precision: 10, scale:  2 }).default('0.00'),
	startDate: timestamp("start_date", { mode: 'string' }).notNull(),
	endDate: timestamp("end_date", { mode: 'string' }),
	autoRenewal: boolean("auto_renewal").default(true),
	ownerPayout: varchar("owner_payout", { length: 20 }).default('monthly'),
	currency: varchar({ length: 3 }).default('USD'),
	status: varchar({ length: 20 }).default('active'),
	terms: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "property_management_agreements_property_id_properties_id_fk"
		}),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [tenants.id],
			name: "property_management_agreements_owner_id_tenants_id_fk"
		}),
	unique("property_management_agreements_agreement_number_unique").on(table.agreementNumber),
]);

export const purchaseOrders = pgTable("purchase_orders", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	poNumber: varchar("po_number", { length: 50 }).notNull(),
	prId: integer("pr_id"),
	vendorId: integer("vendor_id").notNull(),
	buyerId: uuid("buyer_id").notNull(),
	orderDate: timestamp("order_date", { mode: 'string' }).notNull(),
	deliveryDate: timestamp("delivery_date", { mode: 'string' }),
	deliveryAddress: text("delivery_address"),
	paymentTerms: varchar("payment_terms", { length: 100 }),
	shippingTerms: varchar("shipping_terms", { length: 100 }),
	subtotal: numeric({ precision: 15, scale:  2 }).notNull(),
	taxAmount: numeric("tax_amount", { precision: 15, scale:  2 }).default('0.00'),
	totalAmount: numeric("total_amount", { precision: 15, scale:  2 }).notNull(),
	currency: varchar({ length: 3 }).default('KES'),
	status: procurementStatus().default('draft'),
	notes: text(),
	attachments: jsonb().default([]),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "purchase_orders_organization_id_organizations_id_fk"
		}),
	foreignKey({
			columns: [table.prId],
			foreignColumns: [purchaseRequisitions.id],
			name: "purchase_orders_pr_id_purchase_requisitions_id_fk"
		}),
	foreignKey({
			columns: [table.buyerId],
			foreignColumns: [users.id],
			name: "purchase_orders_buyer_id_users_id_fk"
		}),
	unique("purchase_orders_po_number_unique").on(table.poNumber),
]);

export const purchaseRequisitions = pgTable("purchase_requisitions", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	prNumber: varchar("pr_number", { length: 50 }).notNull(),
	requestorId: uuid("requestor_id").notNull(),
	departmentId: integer("department_id"),
	costCenterId: integer("cost_center_id"),
	title: varchar({ length: 255 }).notNull(),
	description: text(),
	justification: text(),
	priority: varchar({ length: 20 }).default('medium'),
	requestedDate: timestamp("requested_date", { mode: 'string' }).notNull(),
	requiredDate: timestamp("required_date", { mode: 'string' }).notNull(),
	totalAmount: numeric("total_amount", { precision: 15, scale:  2 }),
	currency: varchar({ length: 3 }).default('KES'),
	approvalStatus: approvalStatus("approval_status").default('draft'),
	l1ApproverId: uuid("l1_approver_id"),
	l1ApprovedAt: timestamp("l1_approved_at", { mode: 'string' }),
	l1Comments: text("l1_comments"),
	l2ApproverId: uuid("l2_approver_id"),
	l2ApprovedAt: timestamp("l2_approved_at", { mode: 'string' }),
	l2Comments: text("l2_comments"),
	mdApproverId: uuid("md_approver_id"),
	mdApprovedAt: timestamp("md_approved_at", { mode: 'string' }),
	mdComments: text("md_comments"),
	rejectedReason: text("rejected_reason"),
	attachments: jsonb().default([]),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	category: varchar({ length: 100 }),
}, (table) => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "purchase_requisitions_organization_id_organizations_id_fk"
		}),
	foreignKey({
			columns: [table.requestorId],
			foreignColumns: [users.id],
			name: "purchase_requisitions_requestor_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.costCenterId],
			foreignColumns: [costCenters.id],
			name: "purchase_requisitions_cost_center_id_cost_centers_id_fk"
		}),
	foreignKey({
			columns: [table.l1ApproverId],
			foreignColumns: [users.id],
			name: "purchase_requisitions_l1_approver_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.l2ApproverId],
			foreignColumns: [users.id],
			name: "purchase_requisitions_l2_approver_id_users_id_fk"
		}),
	foreignKey({
			columns: [table.mdApproverId],
			foreignColumns: [users.id],
			name: "purchase_requisitions_md_approver_id_users_id_fk"
		}),
	unique("purchase_requisitions_pr_number_unique").on(table.prNumber),
]);

export const propertyAvailability = pgTable("property_availability", {
	id: serial().primaryKey().notNull(),
	propertyId: integer("property_id").notNull(),
	date: date().notNull(),
	isAvailable: boolean("is_available").default(true),
	availabilityType: varchar("availability_type", { length: 20 }).default('available'),
	baseRate: numeric("base_rate", { precision: 10, scale:  2 }),
	seasonalRate: numeric("seasonal_rate", { precision: 10, scale:  2 }),
	finalRate: numeric("final_rate", { precision: 10, scale:  2 }),
	bookingId: integer("booking_id"),
	isWeekend: boolean("is_weekend").default(false),
	isHoliday: boolean("is_holiday").default(false),
	seasonType: varchar("season_type", { length: 20 }),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "property_availability_property_id_properties_id_fk"
		}),
	foreignKey({
			columns: [table.bookingId],
			foreignColumns: [shortTermBookings.id],
			name: "property_availability_booking_id_short_term_bookings_id_fk"
		}),
]);

export const reconciliationRules = pgTable("reconciliation_rules", {
	id: serial().primaryKey().notNull(),
	name: varchar({ length: 100 }).notNull(),
	conditions: jsonb().notNull(),
	actions: jsonb().notNull(),
	priority: integer().default(1),
	isActive: boolean("is_active").default(true),
	successCount: integer("success_count").default(0),
	lastUsedAt: timestamp("last_used_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
});

export const propertyExpenses = pgTable("property_expenses", {
	id: serial().primaryKey().notNull(),
	expenseNumber: varchar("expense_number").notNull(),
	propertyId: integer("property_id").notNull(),
	contractorId: integer("contractor_id"),
	vendorName: varchar("vendor_name").notNull(),
	description: text().notNull(),
	amount: numeric({ precision: 15, scale:  2 }).notNull(),
	currency: currency().default('KES'),
	category: expenseCategory().notNull(),
	expenseDate: timestamp("expense_date", { mode: 'string' }).notNull(),
	dueDate: timestamp("due_date", { mode: 'string' }),
	paymentDate: timestamp("payment_date", { mode: 'string' }),
	status: expenseStatus().default('pending'),
	approvedBy: uuid("approved_by"),
	approvedAt: timestamp("approved_at", { mode: 'string' }),
	paymentMethod: varchar("payment_method"),
	receiptUrl: varchar("receipt_url"),
	invoiceUrl: varchar("invoice_url"),
	isRecurring: boolean("is_recurring").default(false),
	recurringFrequency: varchar("recurring_frequency"),
	nextRecurringDate: timestamp("next_recurring_date", { mode: 'string' }),
	tags: jsonb(),
	notes: text(),
	createdBy: uuid("created_by").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "property_expenses_property_id_properties_id_fk"
		}),
	foreignKey({
			columns: [table.contractorId],
			foreignColumns: [contractors.id],
			name: "property_expenses_contractor_id_contractors_id_fk"
		}),
	unique("property_expenses_expense_number_unique").on(table.expenseNumber),
]);

export const propertyBlockchainRecords = pgTable("property_blockchain_records", {
	id: serial().primaryKey().notNull(),
	propertyId: integer("property_id").notNull(),
	blockchainId: varchar("blockchain_id").notNull(),
	verificationStatus: varchar("verification_status").default('pending').notNull(),
	trustScore: numeric("trust_score", { precision: 5, scale:  2 }).default('0'),
	totalTransactions: integer("total_transactions").default(0),
	lastVerified: timestamp("last_verified", { mode: 'string' }),
	ownershipChain: jsonb("ownership_chain"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "property_blockchain_records_property_id_properties_id_fk"
		}),
	unique("property_blockchain_records_blockchain_id_unique").on(table.blockchainId),
]);

export const recurringCharges = pgTable("recurring_charges", {
	id: serial().primaryKey().notNull(),
	propertyId: integer("property_id").notNull(),
	unitId: integer("unit_id"),
	name: varchar().notNull(),
	type: varchar().notNull(),
	amount: varchar().notNull(),
	currency: varchar().default('KES'),
	frequency: varchar().notNull(),
	startDate: timestamp("start_date", { mode: 'string' }).notNull(),
	endDate: timestamp("end_date", { mode: 'string' }),
	nextBillDate: timestamp("next_bill_date", { mode: 'string' }).notNull(),
	isActive: boolean("is_active").default(true),
	autoGenerate: boolean("auto_generate").default(true),
	description: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "recurring_charges_property_id_properties_id_fk"
		}),
	foreignKey({
			columns: [table.unitId],
			foreignColumns: [units.id],
			name: "recurring_charges_unit_id_units_id_fk"
		}),
]);

export const registeredVehicles = pgTable("registered_vehicles", {
	id: serial().primaryKey().notNull(),
	propertyId: integer("property_id").notNull(),
	ownerId: varchar("owner_id"),
	ownerType: varchar("owner_type").notNull(),
	plateNumber: varchar("plate_number").notNull(),
	vehicleType: varchar("vehicle_type").notNull(),
	make: varchar().notNull(),
	model: varchar().notNull(),
	year: integer(),
	color: varchar().notNull(),
	status: vehicleStatus().default('pending_approval'),
	approvedBy: uuid("approved_by"),
	approvedAt: timestamp("approved_at", { mode: 'string' }),
	expiresAt: timestamp("expires_at", { mode: 'string' }),
	isResident: boolean("is_resident").default(true),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "registered_vehicles_property_id_properties_id_fk"
		}),
	unique("registered_vehicles_plate_number_unique").on(table.plateNumber),
]);

export const rentToOwnPayments = pgTable("rent_to_own_payments", {
	id: serial().primaryKey().notNull(),
	agreementId: integer("agreement_id").notNull(),
	paymentNumber: integer("payment_number").notNull(),
	scheduledAmount: numeric("scheduled_amount", { precision: 12, scale:  2 }).notNull(),
	paidAmount: numeric("paid_amount", { precision: 12, scale:  2 }).default('0.00'),
	principalAmount: numeric("principal_amount", { precision: 12, scale:  2 }).notNull(),
	interestAmount: numeric("interest_amount", { precision: 12, scale:  2 }).default('0.00'),
	dueDate: timestamp("due_date", { mode: 'string' }).notNull(),
	paidDate: timestamp("paid_date", { mode: 'string' }),
	status: varchar({ length: 20 }).default('pending'),
	paymentMethod: varchar("payment_method", { length: 30 }),
	transactionId: varchar("transaction_id", { length: 100 }),
	lateFees: numeric("late_fees", { precision: 10, scale:  2 }).default('0.00'),
	daysLate: integer("days_late").default(0),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.agreementId],
			foreignColumns: [rentToOwnAgreements.id],
			name: "rent_to_own_payments_agreement_id_rent_to_own_agreements_id_fk"
		}),
]);

export const riskAssessments = pgTable("risk_assessments", {
	id: serial().primaryKey().notNull(),
	tenantId: integer("tenant_id").notNull(),
	assessmentDate: timestamp("assessment_date", { mode: 'string' }).defaultNow(),
	riskScore: integer("risk_score").notNull(),
	riskCategory: varchar("risk_category", { length: 20 }).notNull(),
	paymentHistoryScore: integer("payment_history_score").notNull(),
	incomeStabilityScore: integer("income_stability_score").notNull(),
	behaviorScore: integer("behavior_score").notNull(),
	factors: jsonb().notNull(),
	recommendations: text(),
	assessedBy: uuid("assessed_by").notNull(),
	nextReviewDate: timestamp("next_review_date", { mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.tenantId],
			foreignColumns: [tenants.id],
			name: "risk_assessments_tenant_id_tenants_id_fk"
		}),
]);

export const rentalStatements = pgTable("rental_statements", {
	id: serial().primaryKey().notNull(),
	tenantId: integer("tenant_id").notNull(),
	propertyId: integer("property_id").notNull(),
	unitId: integer("unit_id").notNull(),
	statementPeriod: varchar("statement_period").notNull(),
	statementDate: date("statement_date").notNull(),
	previousBalance: numeric("previous_balance", { precision: 15, scale:  2 }).default('0.00'),
	rentCharged: numeric("rent_charged", { precision: 15, scale:  2 }).notNull(),
	additionalCharges: numeric("additional_charges", { precision: 15, scale:  2 }).default('0.00'),
	paymentsReceived: numeric("payments_received", { precision: 15, scale:  2 }).default('0.00'),
	currentBalance: numeric("current_balance", { precision: 15, scale:  2 }).notNull(),
	dueDate: date("due_date").notNull(),
	currency: varchar().default('USD'),
	status: varchar().default('generated'),
	pdfPath: varchar("pdf_path"),
	chargeBreakdown: jsonb("charge_breakdown"),
	paymentHistory: jsonb("payment_history"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	sentAt: timestamp("sent_at", { mode: 'string' }),
	viewedAt: timestamp("viewed_at", { mode: 'string' }),
});

export const scheduledDisbursements = pgTable("scheduled_disbursements", {
	id: serial().primaryKey().notNull(),
	disbursementId: varchar("disbursement_id", { length: 100 }).notNull(),
	propertyId: integer("property_id"),
	paymentTransactionId: integer("payment_transaction_id"),
	recipientType: varchar("recipient_type", { length: 30 }).notNull(),
	recipientId: varchar("recipient_id", { length: 50 }).notNull(),
	recipientName: varchar("recipient_name", { length: 100 }).notNull(),
	recipientBankAccount: varchar("recipient_bank_account", { length: 50 }),
	recipientMobileNumber: varchar("recipient_mobile_number", { length: 20 }),
	amount: numeric({ precision: 15, scale:  2 }).notNull(),
	currency: varchar({ length: 3 }).notNull(),
	disbursementType: varchar("disbursement_type", { length: 50 }).notNull(),
	scheduledFor: timestamp("scheduled_for", { mode: 'string' }).notNull(),
	status: varchar({ length: 30 }).notNull(),
	processedAt: timestamp("processed_at", { mode: 'string' }),
	failureReason: text("failure_reason"),
	retryCount: integer("retry_count").default(0),
	maxRetries: integer("max_retries").default(3),
	metadata: jsonb().default({}),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "scheduled_disbursements_property_id_properties_id_fk"
		}),
	foreignKey({
			columns: [table.paymentTransactionId],
			foreignColumns: [paymentTransactions.id],
			name: "scheduled_disbursements_payment_transaction_id_payment_transact"
		}),
	unique("scheduled_disbursements_disbursement_id_unique").on(table.disbursementId),
]);

export const rentPayments = pgTable("rent_payments", {
	id: serial().primaryKey().notNull(),
	tenantId: integer("tenant_id").notNull(),
	amount: numeric({ precision: 10, scale:  2 }).notNull(),
	currency: varchar().default('USD').notNull(),
	dueDate: date("due_date").notNull(),
	paidDate: date("paid_date"),
	paymentMethod: varchar("payment_method"),
	status: varchar().default('pending').notNull(),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	invoiceNumber: varchar("invoice_number"),
	mpesaTransactionId: varchar("mpesa_transaction_id"),
	bankReference: varchar("bank_reference"),
	ussdSessionId: varchar("ussd_session_id"),
}, (table) => [
	unique("rent_payments_invoice_number_unique").on(table.invoiceNumber),
]);

export const rentToOwnAgreements = pgTable("rent_to_own_agreements", {
	id: serial().primaryKey().notNull(),
	agreementNumber: varchar("agreement_number", { length: 50 }).notNull(),
	propertyId: integer("property_id").notNull(),
	tenantId: integer("tenant_id").notNull(),
	agreementType: varchar("agreement_type", { length: 30 }).notNull(),
	totalPropertyValue: numeric("total_property_value", { precision: 12, scale:  2 }).notNull(),
	initialDeposit: numeric("initial_deposit", { precision: 12, scale:  2 }).notNull(),
	monthlyPayment: numeric("monthly_payment", { precision: 12, scale:  2 }).notNull(),
	agreementDuration: integer("agreement_duration").notNull(),
	interestRate: numeric("interest_rate", { precision: 5, scale:  2 }),
	totalPaid: numeric("total_paid", { precision: 12, scale:  2 }).default('0.00'),
	remainingBalance: numeric("remaining_balance", { precision: 12, scale:  2 }).notNull(),
	nextPaymentDue: timestamp("next_payment_due", { mode: 'string' }).notNull(),
	status: varchar({ length: 20 }).default('active'),
	agreementDate: timestamp("agreement_date", { mode: 'string' }).defaultNow(),
	completionDate: timestamp("completion_date", { mode: 'string' }),
	terms: text(),
	conditions: jsonb(),
	currency: varchar({ length: 3 }).default('USD'),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "rent_to_own_agreements_property_id_properties_id_fk"
		}),
	foreignKey({
			columns: [table.tenantId],
			foreignColumns: [tenants.id],
			name: "rent_to_own_agreements_tenant_id_tenants_id_fk"
		}),
	unique("rent_to_own_agreements_agreement_number_unique").on(table.agreementNumber),
]);

export const securityIncidents = pgTable("security_incidents", {
	id: serial().primaryKey().notNull(),
	incidentType: varchar("incident_type", { length: 50 }).notNull(),
	severity: varchar({ length: 20 }).notNull(),
	description: text().notNull(),
	affectedUserId: varchar("affected_user_id"),
	ipAddress: varchar("ip_address", { length: 45 }),
	userAgent: text("user_agent"),
	detectedAt: timestamp("detected_at", { mode: 'string' }).defaultNow(),
	resolvedAt: timestamp("resolved_at", { mode: 'string' }),
	status: varchar({ length: 20 }).default('open'),
	assignedTo: varchar("assigned_to"),
	resolutionNotes: text("resolution_notes"),
	metadata: jsonb(),
});

export const shortTermBookings = pgTable("short_term_bookings", {
	id: serial().primaryKey().notNull(),
	bookingNumber: varchar("booking_number", { length: 50 }).notNull(),
	propertyId: integer("property_id").notNull(),
	managementAgreementId: integer("management_agreement_id"),
	guestName: varchar("guest_name", { length: 100 }).notNull(),
	guestEmail: varchar("guest_email", { length: 100 }).notNull(),
	guestPhone: varchar("guest_phone", { length: 20 }),
	guestCount: integer("guest_count").notNull(),
	checkInDate: timestamp("check_in_date", { mode: 'string' }).notNull(),
	checkOutDate: timestamp("check_out_date", { mode: 'string' }).notNull(),
	numberOfNights: integer("number_of_nights").notNull(),
	nightlyRate: numeric("nightly_rate", { precision: 10, scale:  2 }).notNull(),
	totalAmount: numeric("total_amount", { precision: 12, scale:  2 }).notNull(),
	cleaningFee: numeric("cleaning_fee", { precision: 10, scale:  2 }).default('0.00'),
	serviceFee: numeric("service_fee", { precision: 10, scale:  2 }).default('0.00'),
	taxes: numeric({ precision: 10, scale:  2 }).default('0.00'),
	managementFee: numeric("management_fee", { precision: 10, scale:  2 }).default('0.00'),
	ownerPayout: numeric("owner_payout", { precision: 12, scale:  2 }).notNull(),
	status: varchar({ length: 20 }).default('confirmed'),
	paymentStatus: varchar("payment_status", { length: 20 }).default('pending'),
	platformSource: varchar("platform_source", { length: 30 }),
	platformBookingId: varchar("platform_booking_id", { length: 100 }),
	specialRequests: text("special_requests"),
	guestNotes: text("guest_notes"),
	internalNotes: text("internal_notes"),
	checkInInstructions: text("check_in_instructions"),
	keyLocation: varchar("key_location", { length: 200 }),
	currency: varchar({ length: 3 }).default('USD'),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "short_term_bookings_property_id_properties_id_fk"
		}),
	foreignKey({
			columns: [table.managementAgreementId],
			foreignColumns: [propertyManagementAgreements.id],
			name: "short_term_bookings_management_agreement_id_property_management"
		}),
	unique("short_term_bookings_booking_number_unique").on(table.bookingNumber),
]);

export const serviceCharges = pgTable("service_charges", {
	id: serial().primaryKey().notNull(),
	propertyId: integer("property_id"),
	unitId: integer("unit_id"),
	name: varchar({ length: 255 }).notNull(),
	type: varchar({ length: 50 }).notNull(),
	amount: numeric({ precision: 10, scale:  2 }).notNull(),
	currency: currency().default('USD'),
	dueDate: timestamp("due_date", { mode: 'string' }),
	status: varchar({ length: 50 }).default('pending'),
	description: text(),
	isRecurring: boolean("is_recurring").default(true),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "service_charges_property_id_properties_id_fk"
		}),
	foreignKey({
			columns: [table.unitId],
			foreignColumns: [units.id],
			name: "service_charges_unit_id_units_id_fk"
		}),
]);

export const smartAutomations = pgTable("smart_automations", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	propertyId: integer("property_id"),
	name: varchar().notNull(),
	triggerDevice: varchar("trigger_device").notNull(),
	triggerCondition: varchar("trigger_condition").notNull(),
	actions: jsonb().notNull(),
	isActive: boolean("is_active").default(true),
	executionCount: integer("execution_count").default(0),
	lastExecuted: timestamp("last_executed", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "smart_automations_organization_id_organizations_id_fk"
		}),
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "smart_automations_property_id_properties_id_fk"
		}),
]);

export const sessions = pgTable("sessions", {
	sid: varchar().primaryKey().notNull(),
	sess: jsonb().notNull(),
	expire: timestamp({ mode: 'string' }).notNull(),
}, (table) => [
	index("IDX_session_expire").using("btree", table.expire.asc().nullsLast().op("timestamp_ops")),
]);

export const serviceSchedules = pgTable("service_schedules", {
	id: serial().primaryKey().notNull(),
	scheduleNumber: varchar("schedule_number", { length: 50 }).notNull(),
	contractId: integer("contract_id"),
	contractorId: integer("contractor_id"),
	propertyId: integer("property_id"),
	serviceType: varchar("service_type", { length: 50 }).notNull(),
	frequency: varchar({ length: 20 }).notNull(),
	dayOfWeek: integer("day_of_week"),
	dayOfMonth: integer("day_of_month"),
	timeOfDay: varchar("time_of_day", { length: 10 }),
	nextScheduledDate: timestamp("next_scheduled_date", { mode: 'string' }),
	lastServiceDate: timestamp("last_service_date", { mode: 'string' }),
	serviceInstructions: text("service_instructions"),
	accessInstructions: text("access_instructions"),
	specialRequirements: text("special_requirements").array(),
	autoSchedule: boolean("auto_schedule").default(true),
	notifyTenant: boolean("notify_tenant").default(true),
	notifyManager: boolean("notify_manager").default(true),
	requiresAccess: boolean("requires_access").default(true),
	estimatedDuration: integer("estimated_duration"),
	serviceCost: numeric("service_cost", { precision: 10, scale:  2 }),
	currency: varchar({ length: 3 }).default('KES'),
	status: varchar({ length: 20 }).default('active'),
	createdBy: uuid("created_by").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.contractId],
			foreignColumns: [serviceContracts.id],
			name: "service_schedules_contract_id_service_contracts_id_fk"
		}),
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "service_schedules_property_id_properties_id_fk"
		}),
	foreignKey({
			columns: [table.contractorId],
			foreignColumns: [contractors.id],
			name: "service_schedules_contractor_id_contractors_id_fk"
		}),
	unique("service_schedules_schedule_number_unique").on(table.scheduleNumber),
]);

export const smartContracts = pgTable("smart_contracts", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	contractType: varchar("contract_type").notNull(),
	contractAddress: varchar("contract_address").notNull(),
	propertyId: integer("property_id").notNull(),
	parties: text().array().notNull(),
	status: varchar().default('pending').notNull(),
	executionCount: integer("execution_count").default(0),
	totalValue: numeric("total_value", { precision: 12, scale:  2 }).notNull(),
	autoExecution: boolean("auto_execution").default(true),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "smart_contracts_organization_id_organizations_id_fk"
		}),
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "smart_contracts_property_id_properties_id_fk"
		}),
	unique("smart_contracts_contract_address_unique").on(table.contractAddress),
]);

export const serviceContracts = pgTable("service_contracts", {
	id: serial().primaryKey().notNull(),
	contractNumber: varchar("contract_number", { length: 50 }).notNull(),
	contractorId: integer("contractor_id"),
	propertyId: integer("property_id"),
	contractType: varchar("contract_type", { length: 30 }).notNull(),
	serviceType: varchar("service_type", { length: 50 }).notNull(),
	contractTitle: varchar("contract_title", { length: 200 }).notNull(),
	description: text(),
	scope: text(),
	startDate: timestamp("start_date", { mode: 'string' }).notNull(),
	endDate: timestamp("end_date", { mode: 'string' }),
	contractValue: numeric("contract_value", { precision: 12, scale:  2 }),
	currency: varchar({ length: 3 }).default('KES'),
	paymentSchedule: varchar("payment_schedule", { length: 30 }),
	paymentTerms: text("payment_terms"),
	sla: jsonb().default({}),
	penaltyClause: text("penalty_clause"),
	terminationClause: text("termination_clause"),
	autoRenewal: boolean("auto_renewal").default(false),
	renewalTerms: text("renewal_terms"),
	status: varchar({ length: 20 }).default('draft'),
	signedBy: uuid("signed_by"),
	signedDate: timestamp("signed_date", { mode: 'string' }),
	contractDocument: varchar("contract_document"),
	createdBy: uuid("created_by").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "service_contracts_property_id_properties_id_fk"
		}),
	foreignKey({
			columns: [table.contractorId],
			foreignColumns: [contractors.id],
			name: "service_contracts_contractor_id_contractors_id_fk"
		}),
	unique("service_contracts_contract_number_unique").on(table.contractNumber),
]);
