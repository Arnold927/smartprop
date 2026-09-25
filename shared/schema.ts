import {
  pgTable, text, varchar, timestamp, jsonb, json, index, serial, integer, decimal, boolean,
  date, pgEnum, uuid, real, uniqueIndex, numeric, foreignKey,
  PgTable,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { InferSelectModel, is, relations, InferInsertModel } from "drizzle-orm";
import type { PgTableWithColumns } from "drizzle-orm/pg-core";


// Enums
export const currencyEnum = pgEnum("currency", ["KES", "USD", "EUR", "GBP", "CAD", "AUD", "JPY", "CHF", "CNY"]);
export const priorityEnum = pgEnum("priority", ["low", "medium", "high", "urgent"]);
export const maintenanceStatusEnum = pgEnum("maintenance_status", ["pending", "assigned", "in_progress", "completed", "cancelled"]);
export const messageChannelEnum = pgEnum("message_channel", ["app", "sms", "email", "push"]);
export const messageTypeEnum = pgEnum("message_type", ["chat", "invoice_reminder", "maintenance_update", "payment_confirmation", "system_notification"]);
export const visitorStatusEnum = pgEnum("visitor_status", ["pending", "approved", "checked_in", "checked_out", "denied", "expired"]);
export const feedbackTypeEnum = pgEnum("feedback_type", ["bug_report", "feature_request", "improvement", "general", "complaint", "compliment"]);
export const feedbackStatusEnum = pgEnum("feedback_status", ["open", "in_review", "planned", "in_progress", "completed", "rejected"]);
export const activityTypeEnum = pgEnum("activity_type", ["login", "logout", "property_view", "tenant_action", "payment_made", "maintenance_request", "document_upload", "search", "report_generated"]);
export const featureStatusEnum = pgEnum("feature_status", ["new", "announced", "beta", "stable", "deprecated"]);
export const parkingStatusEnum = pgEnum("parking_status", ["active", "expired", "suspended", "terminated"]);
export const vehicleStatusEnum = pgEnum("vehicle_status", ["active", "inactive", "pending_approval", "blacklisted"]);
export const expenseStatusEnum = pgEnum("expense_status", ["pending", "approved", "rejected", "paid"]);
export const expenseCategoryEnum = pgEnum("expense_category", ["maintenance", "utilities", "supplies", "services", "insurance", "taxes", "legal", "marketing", "other"]);

// User Feedback System
export const userFeedback = pgTable("user_feedback", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  type: feedbackTypeEnum("type").notNull(),
  category: varchar("category", { length: 100 }),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description").notNull(),
  priority: priorityEnum("priority").default("medium"),
  status: feedbackStatusEnum("status").default("open"),
  rating: integer("rating"), // 1-5 stars
  screenshotUrl: varchar("screenshot_url"),
  browserInfo: jsonb("browser_info"),
  deviceInfo: jsonb("device_info"),
  pageUrl: varchar("page_url"),
  reproductionSteps: text("reproduction_steps"),
  expectedBehavior: text("expected_behavior"),
  actualBehavior: text("actual_behavior"),
  assignedTo: varchar("assigned_to"),
  assignedDate: timestamp("assigned_date"),
  responseMessage: text("response_message"),
  respondedBy: uuid("responded_by"),
  respondedAt: timestamp("responded_at"),
  internalNotes: text("internal_notes"),
  votesCount: integer("votes_count").default(0),
  implementedInVersion: varchar("implemented_in_version"),
  estimatedEffort: varchar("estimated_effort"),
  businessValue: varchar("business_value"),
  metadata: jsonb("metadata").default('{}'),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// User Activity Monitoring
export const userActivity = pgTable("user_activity", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  organizationId: integer("organization_id").references(() => organizations.id),
  sessionId: varchar("session_id"),
  activityType: activityTypeEnum("activity_type").notNull(),
  activityData: jsonb("activity_data"),
  pageUrl: varchar("page_url"),
  pagePath: varchar("page_path"),
  referrerUrl: varchar("referrer_url"),
  userAgent: text("user_agent"),
  ipAddress: varchar("ip_address"),
  deviceType: varchar("device_type"), // desktop, mobile, tablet
  browserName: varchar("browser_name"),
  browserVersion: varchar("browser_version"),
  osName: varchar("os_name"),
  osVersion: varchar("os_version"),
  screenResolution: varchar("screen_resolution"),
  duration: integer("duration"), // Time spent in milliseconds
  success: boolean("success").default(true),
  errorMessage: text("error_message"),
  metadata: jsonb("metadata").default('{}'),
  createdAt: timestamp("created_at").defaultNow(),
});

// Feature Announcements & Showcase
export const featureAnnouncements = pgTable("feature_announcements", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description").notNull(),
  content: text("content"),
  featureId: varchar("feature_id").unique(),
  category: varchar("category", { length: 100 }),
  status: featureStatusEnum("status").default("new"),
  priority: priorityEnum("priority").default("medium"),
  targetAudience: varchar("target_audience").array(), // ["admin", "manager", "tenant", "all"]
  releaseDate: timestamp("release_date"),
  announcementDate: timestamp("announcement_date"),
  imageUrl: varchar("image_url"),
  videoUrl: varchar("video_url"),
  demoUrl: varchar("demo_url"),
  documentationUrl: varchar("documentation_url"),
  changelogUrl: varchar("changelog_url"),
  isActive: boolean("is_active").default(true),
  showAsTooltip: boolean("show_as_tooltip").default(false),
  showAsModal: boolean("show_as_modal").default(false),
  showAsBanner: boolean("show_as_banner").default(false),
  displayDuration: integer("display_duration").default(7), // Days to show
  viewsCount: integer("views_count").default(0),
  clicksCount: integer("clicks_count").default(0),
  dismissalsCount: integer("dismissals_count").default(0),
  likesCount: integer("likes_count").default(0),
  metadata: jsonb("metadata").default('{}'),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// User Feature Interactions
export const userFeatureInteractions = pgTable("user_feature_interactions", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  featureAnnouncementId: integer("feature_announcement_id").references(() => featureAnnouncements.id).notNull(),
  interactionType: varchar("interaction_type", { enum: ["viewed", "clicked", "dismissed", "liked", "shared", "feedback"] }).notNull(),
  interactionData: jsonb("interaction_data"),
  deviceType: varchar("device_type"),
  sessionId: varchar("session_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Feedback Votes (for community voting on feature requests)
export const feedbackVotes = pgTable("feedback_votes", {
  id: serial("id").primaryKey(),
  feedbackId: integer("feedback_id").references(() => userFeedback.id).notNull(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  voteType: varchar("vote_type", { enum: ["upvote", "downvote"] }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// User Notification Preferences
export const userNotificationPreferences = pgTable("user_notification_preferences", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  emailNotifications: boolean("email_notifications").default(true),
  whatsappNotifications: boolean("whatsapp_notifications").default(true),
  smsNotifications: boolean("sms_notifications").default(false),
  pushNotifications: boolean("push_notifications").default(true),
  inAppNotifications: boolean("in_app_notifications").default(true),
  featureAnnouncements: boolean("feature_announcements").default(true),
  maintenanceUpdates: boolean("maintenance_updates").default(true),
  paymentReminders: boolean("payment_reminders").default(true),
  rentDueWarningDays: integer("rent_due_warning_days").default(3), // how many days before due date to warn
  marketingEmails: boolean("marketing_emails").default(false),
  weeklyDigest: boolean("weekly_digest").default(true),
  securityAlerts: boolean("security_alerts").default(true),
  frequency: varchar("frequency", { enum: ["immediate", "daily", "weekly", "monthly"] }).default("immediate"),
  quietHours: jsonb("quiet_hours").default('{"enabled": false, "start": "22:00", "end": "08:00"}'),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Session storage table (required for Replit Auth)
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// Multi-tenant SaaS structure
export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).unique().notNull(),
  domain: varchar("domain", { length: 255 }).unique(),
  logo: varchar("logo"),
  primaryColor: varchar("primary_color", { length: 7 }).default("#3B82F6"),
  secondaryColor: varchar("secondary_color", { length: 7 }).default("#EF4444"),
  whiteLabel: jsonb("white_label").default({}),
  subscriptionPlan: varchar("subscription_plan", { length: 50 }).default("basic"),
  subscriptionStatus: varchar("subscription_status", { length: 20 }).default("trial"),
  maxProperties: integer("max_properties").default(5),
  maxUsers: integer("max_users").default(10),
  features: jsonb("features").default({}),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const organizationSettings = pgTable("organization_settings", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  timezone: varchar("timezone", { length: 50 }).default("Africa/Nairobi"),
  defaultCurrency: varchar("default_currency", { length: 3 }).default("KES"),
  dateFormat: varchar("date_format", { length: 20 }).default("DD/MM/YYYY"),
  language: varchar("language", { length: 10 }).default("en"),
  emailSettings: jsonb("email_settings").default({}),
  smsSettings: jsonb("sms_settings").default({}),
  // WhatsApp Business API credentials per organization.
  // Shape: { phoneNumberId: string; apiKey: string }
  // apiKey is the Meta Bearer token — treat it as a secret.
  // Falls back to WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_API_KEY env vars when null.
  whatsappSettings: jsonb("whatsapp_settings").default({}),
  paymentSettings: jsonb("payment_settings").default({}),
  // Org-level Daraja (Lipa Na M-Pesa Online) API credentials — the fallback
  // tier for the common case of a single-landlord (or landlord-less) org,
  // where there's no separate landlord account to attach per-landlord
  // credentials to (see landlordPaymentSettings for that case). Same
  // encryption approach: secrets never stored or returned in plaintext.
  mpesaConsumerKey: varchar("mpesa_consumer_key"),
  mpesaConsumerSecretEncrypted: text("mpesa_consumer_secret_encrypted"),
  mpesaPasskeyEncrypted: text("mpesa_passkey_encrypted"),
  mpesaEnvironment: varchar("mpesa_environment").default("production"),
  stkPushVerifiedAt: timestamp("stk_push_verified_at"),
  customFields: jsonb("custom_fields").default({}),
  integrations: jsonb("integrations").default({}),
  updatedAt: timestamp("updated_at").defaultNow(),
});

/**
 * Per-landlord payment routing override, for orgs with multiple landlords
 * sharing one organization account (a management company running several
 * distinct owners' portfolios). organizationSettings.paymentSettings above
 * remains the org-wide DEFAULT/fallback — used as-is for single-landlord
 * orgs, and for any property with no specific ownerId assigned.
 *
 * Resolution when a tenant needs to know where to pay: look up their unit's
 * property -> property.ownerId -> the matching row here (if any) -> else
 * fall back to the org-wide default. A landlord who never sets this up just
 * keeps using the org default, so single-landlord orgs need zero extra
 * setup — this table is additive, not a replacement.
 */
export const landlordPaymentSettings = pgTable(
  "landlord_payment_settings",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => organizations.id).notNull(),
    ownerId: uuid("owner_id").references(() => users.id).notNull(),
    rentPayment: jsonb("rent_payment").default({}),
    utilityPayment: jsonb("utility_payment").default({}),
    // Per-landlord Daraja (Lipa Na M-Pesa Online) API credentials — separate
    // from the freeform display-info JSONB above because these are secrets,
    // not display data. Different landlords (or the same management company
    // acting for different owners) very likely have independently-registered
    // Safaricom shortcodes, each requiring its own passkey and often its own
    // consumer key/secret — you cannot use one shortcode's passkey to
    // authenticate an STK Push against a different shortcode. Secret fields
    // are encrypted at rest (see server/utils/credentialEncryption.ts) and
    // never returned in plaintext by any API response.
    mpesaConsumerKey: varchar("mpesa_consumer_key"),
    mpesaConsumerSecretEncrypted: text("mpesa_consumer_secret_encrypted"),
    mpesaPasskeyEncrypted: text("mpesa_passkey_encrypted"),
    mpesaEnvironment: varchar("mpesa_environment").default("production"), // sandbox | production
    stkPushVerifiedAt: timestamp("stk_push_verified_at"), // set after a successful test push
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => ({
    orgOwnerUnique: uniqueIndex("landlord_payment_settings_org_owner_unique")
      .on(t.organizationId, t.ownerId),
  })
);

// User storage table (required for Replit Auth)
export const users = pgTable("users", {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: integer("organization_id").references(() => organizations.id),
    email: varchar("email").notNull(),
    firstName: varchar("first_name"),
    lastName: varchar("last_name"),
    profileImageUrl: varchar("profile_image_url"),
    role: varchar("role").notNull().default("manager"), // admin | manager | landlord | staff | caretaker | tenant | guard
    isOrgAdmin: boolean("is_org_admin").default(false),
    preferredCurrency: varchar("preferred_currency").notNull().default("KES"),
    permissions: jsonb("permissions").default({}),
    passwordHash: varchar("password_hash").notNull(),
    phoneNumber: varchar("phone_number"),
    emailVerified: boolean("email_verified").default(false),
    emailVerificationToken: varchar("email_verification_token"),
    emailVerificationExpiresAt: timestamp("email_verification_expires_at"),
    passwordResetToken: varchar("password_reset_token"),
    passwordResetExpiresAt: timestamp("password_reset_expires_at"),
    lastLoginAt: timestamp("last_login_at"),
    invitedAt: timestamp("invited_at"),
    invitedBy: uuid("invited_by"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
    pushToken: text("push_token"),
    pushPlatform: varchar("push_platform", { length: 10 }),
    failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until"),
    isActive: boolean("is_active").notNull().default(true), // admin/manager can deactivate
    deactivatedAt: timestamp("deactivated_at"),
    deactivatedBy: uuid("deactivated_by"),
  },
  (users) => ({
    usersOrgEmailUnique: uniqueIndex("users_org_email_unique")
      .on(users.organizationId, users.email),
  })
);


export const properties = pgTable("properties", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  name: varchar("name").notNull(),
  address: text("address").notNull(),
  totalUnits: integer("total_units").notNull(),
  // residential: apartments/houses (bedrooms/bathrooms apply).
  // commercial: retail/office/mall space (sqft-based, no bedrooms/bathrooms).
  // mixed_use: a property with both residential and commercial units — the
  // per-unit unitType (below) decides which rules apply to each unit.
  propertyType: varchar("property_type", { enum: ["residential", "commercial", "mixed_use"] }).notNull().default("residential"),
  ownerId: uuid("owner_id"),
  // For a landlord who doesn't (and may never) have a user account in the
  // system — a real-world common case, not an edge case. Set instead of
  // ownerId; resolvePaymentConfig checks ownerId first, then this. See
  // externalLandlords below for the payment/credential details this points to.
  externalLandlordId: integer("external_landlord_id").references(() => externalLandlords.id),
  description: text("description"),
  imageUrl: varchar("image_url"),
  galleryImages: jsonb('gallery_images').default([]),
  customBranding: jsonb("custom_branding").default({}),
  siteSettings: jsonb("site_settings").default({}),
  // Portfolio valuation — entered by the property manager, used in senior manager dashboard
  estimatedValue: decimal("estimated_value", { precision: 15, scale: 2 }),
  estimatedValueCurrency: varchar("estimated_value_currency", { length: 3 }).default("KES"),
  estimatedValueNote: varchar("estimated_value_note", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// A landlord who doesn't have (and may never have) a user account in the
// system — genuinely common: management companies often handle owners who
// never log into anything themselves. Properties link here via
// properties.externalLandlordId instead of ownerId. Mirrors
// landlordPaymentSettings' shape closely (same rentPayment/utilityPayment
// JSONB, same encrypted Daraja credential columns) so the resolution logic
// and the admin-facing UI can reuse the same patterns.
export const externalLandlords = pgTable("external_landlords", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  name: varchar("name").notNull(),
  phone: varchar("phone"),
  email: varchar("email"),
  notes: text("notes"),
  rentPayment: jsonb("rent_payment").default({}),
  utilityPayment: jsonb("utility_payment").default({}),
  mpesaConsumerKey: varchar("mpesa_consumer_key"),
  mpesaConsumerSecretEncrypted: text("mpesa_consumer_secret_encrypted"),
  mpesaPasskeyEncrypted: text("mpesa_passkey_encrypted"),
  mpesaEnvironment: varchar("mpesa_environment").default("production"),
  stkPushVerifiedAt: timestamp("stk_push_verified_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});


// ==================== GATE PIN AUTHENTICATION ====================

export const gatePins = pgTable("gate_pins", {
  id:          serial("id").primaryKey(),
  propertyId:  integer("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  label:       varchar("label", { length: 100 }).notNull(),   // e.g. "Main Gate", "Guard A"
  pinHash:     varchar("pin_hash", { length: 255 }).notNull(), // bcrypt hash
  isActive:    boolean("is_active").default(true),
  expiresAt:   timestamp("expires_at"),                        // null = never
  lastUsedAt:  timestamp("last_used_at"),
  createdBy:   uuid("created_by").notNull(),
  createdAt:   timestamp("created_at").defaultNow(),
  updatedAt:   timestamp("updated_at").defaultNow(),
});

export type GatePin = typeof gatePins.$inferSelect;
export type InsertGatePin = typeof gatePins.$inferInsert;

// ==================== GUARD SHIFT LOGS ====================

export const guardShifts = pgTable("guard_shifts", {
  id:           serial("id").primaryKey(),
  propertyId:   integer("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  pinId:        integer("pin_id").references(() => gatePins.id, { onDelete: "set null" }),
  label:        varchar("label", { length: 100 }).notNull(),  // guard label at time of login
  shiftStart:   timestamp("shift_start").notNull().defaultNow(),
  shiftEnd:     timestamp("shift_end"),                       // null = still on shift
  deviceHint:   varchar("device_hint", { length: 200 }),      // user-agent snippet
  createdAt:    timestamp("created_at").defaultNow(),
});

export type GuardShift = typeof guardShifts.$inferSelect;
export type InsertGuardShift = typeof guardShifts.$inferInsert;

// ==================== VEHICLE MOVEMENT LOG ====================
// Raw gate entry/exit log — separate from registered_vehicles (which is a registry).
// Every vehicle movement gets a row here regardless of registration status.

export const vehicleMovementLog = pgTable("vehicle_movement_log", {
  id:          serial("id").primaryKey(),
  propertyId:  integer("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  shiftId:     integer("shift_id").references(() => guardShifts.id, { onDelete: "set null" }),
  plateNumber: varchar("plate_number", { length: 20 }).notNull(),
  vehicleType: varchar("vehicle_type", { length: 30 }).default("car"),   // car, motorcycle, truck, van
  direction:   varchar("direction", { enum: ["in", "out"] }).notNull(),
  purpose:     varchar("purpose", { length: 200 }),                       // delivery, visit, contractor, etc.
  unitNumber:  varchar("unit_number", { length: 20 }),                    // destination unit if known
  driverName:  varchar("driver_name", { length: 100 }),
  notes:       text("notes"),
  loggedAt:    timestamp("logged_at").notNull().defaultNow(),
  loggedBy:    varchar("logged_by", { length: 200 }),                     // guard label
  createdAt:   timestamp("created_at").defaultNow(),
});

export type VehicleMovement = typeof vehicleMovementLog.$inferSelect;
export type InsertVehicleMovement = typeof vehicleMovementLog.$inferInsert;



export const units = pgTable("units", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  unitNumber: varchar("unit_number").notNull(),
  // What kind of space this unit is. Drives which fields apply in the UI:
  // apartment/house use bedrooms/bathrooms; the rest are sqft/rate-based.
  unitType: varchar("unit_type", {
    enum: ["apartment", "house", "office", "retail", "kiosk", "anchor_retail", "warehouse", "parking", "storage", "other"],
  }).notNull().default("apartment"),
  bedrooms: integer("bedrooms"),
  bathrooms: decimal("bathrooms", { precision: 3, scale: 1 }),
  sqft: integer("sqft"),
  // How this unit's rent is priced. "fixed" is the existing flat monthlyRent
  // behaviour (default, unchanged for residential). "per_sqft" derives the
  // effective monthly rent from sqft × ratePerSqft — common for offices and
  // retail space quoted by the square foot/metre. "percentage_of_sales" is
  // turnover rent — see leases.percentageRentRate for the lease-level rate.
  rentBasis: varchar("rent_basis", { enum: ["fixed", "per_sqft", "percentage_of_sales"] }).notNull().default("fixed"),
  ratePerSqft: decimal("rate_per_sqft", { precision: 10, scale: 2 }),
  monthlyRent: decimal("monthly_rent", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency").notNull().default("USD"),
  isOccupied: boolean("is_occupied").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const tenants = pgTable("tenants", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  userId: uuid("user_id").notNull().references(() => users.id),
  firstName: varchar("first_name").notNull(),
  lastName: varchar("last_name").notNull(),
  email: varchar("email").notNull(),
  phone: varchar("phone"),
  unitId: integer("unit_id"),
  leaseStartDate: date("lease_start_date"),
  leaseEndDate: date("lease_end_date"),
  monthlyRent: decimal("monthly_rent", { precision: 10, scale: 2 }),
  currency: varchar("currency").notNull().default("KES"),
  securityDeposit: decimal("security_deposit", { precision: 10, scale: 2 }),
  status: varchar("status").notNull().default("active"), // active, inactive, pending
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Update your rentPayments schema to include invoice number and MPESA fields
export const rentPayments = pgTable("rent_payments", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  invoiceNumber: varchar("invoice_number").unique(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency").notNull().default("KES"),
  dueDate: date("due_date").notNull(),
  paidDate: date("paid_date"),
  paymentMethod: varchar("payment_method"), // cash, check, bank_transfer, online, mpesa, ussd
  mpesaTransactionId: varchar("mpesa_transaction_id"),
  bankReference: varchar("bank_reference"),
  ussdSessionId: varchar("ussd_session_id"),
  status: varchar("status").notNull().default("pending"), // pending, paid, overdue, partial
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// schema.ts - Add these tables

export const rentCollections = pgTable("rent_collections", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  unitId: integer("unit_id").references(() => units.id),
  invoiceNumber: varchar("invoice_number").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency").notNull().default("KES"),
  dueDate: date("due_date").notNull(),
  paidDate: date("paid_date"),
  paymentMethod: varchar("payment_method"), // mpesa, bank_transfer, cash, cheque, ussd, card
  paymentStatus: varchar("payment_status").notNull().default("pending"), // pending, processing, completed, failed, overdue, partially_paid
  mpesaTransactionId: varchar("mpesa_transaction_id"),
  bankReference: varchar("bank_reference"),
  ussdSessionId: varchar("ussd_session_id"),
  cardTransactionId: varchar("card_transaction_id"),
  lateFeeApplied: decimal("late_fee_applied", { precision: 10, scale: 2 }).default("0"),
  lateFeeDate: date("late_fee_date"),
  autoDisbursementStatus: varchar("auto_disbursement_status").default("pending"), // pending, processed, failed
  disbursementReference: varchar("disbursement_reference"),
  invoiceSentAt: timestamp("invoice_sent_at"),
  paymentReceivedAt: timestamp("payment_received_at"),
  reminderCount: integer("reminder_count").default(0),
  lastReminderSent: timestamp("last_reminder_sent"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const paymentMethods = pgTable("payment_methods", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id),
  methodType: varchar("method_type").notNull(), // mpesa, bank, card
  details: jsonb("details").notNull(), // MPESA number, bank account details, card details
  isDefault: boolean("is_default").default(false),
  isVerified: boolean("is_verified").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const rentCollectionReminders = pgTable("rent_collection_reminders", {
  id: serial("id").primaryKey(),
  rentCollectionId: integer("rent_collection_id").notNull().references(() => rentCollections.id),
  reminderType: varchar("reminder_type").notNull(), // email, sms, whatsapp, push
  sentAt: timestamp("sent_at").notNull().defaultNow(),
  status: varchar("status").notNull().default("sent"), // sent, delivered, failed
  response: text("response"),
});

const generateTicketNumber = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.random().toString(36).substr(2, 6).toUpperCase();
  return `MT-${year}${month}${day}-${random}`;
};

export const maintenanceRequests = pgTable("maintenance_requests", {
  id: serial("id").primaryKey(),
  ticketNumber: varchar("ticket_number").unique().notNull(),
  tenantId: integer("tenant_id").notNull(),
  unitId: integer("unit_id").notNull(),
  contractorId: integer("contractor_id").references(() => contractors.id),
  title: varchar("title").notNull(),
  description: text("description").notNull(),
  category: varchar("category", { enum: ["plumbing", "electrical", "hvac", "carpentry", "painting", "cleaning", "landscaping", "appliance", "security", "other"] }).default("other"),
  priority: priorityEnum("priority").notNull(),
  status: maintenanceStatusEnum("status").default("pending"),
  assignedTo: varchar("assigned_to"),
  assignedDate: timestamp("assigned_date"),
  startedDate: timestamp("started_date"),
  estimatedCost: decimal("estimated_cost", { precision: 10, scale: 2 }),
  actualCost: decimal("actual_cost", { precision: 10, scale: 2 }),
  estimatedHours: integer("estimated_hours"),
  actualHours: integer("actual_hours"),
  currency: currencyEnum("currency").default("USD"),
  scheduledDate: timestamp("scheduled_date"),
  approvalRequired: boolean("approval_required").default(false),
  approvedBy: uuid("approved_by"),
  approvedDate: timestamp("approved_date"),
  rejectionReason: text("rejection_reason"),
  tenantNotes: text("tenant_notes"),
  contractorNotes: text("contractor_notes"),
  internalNotes: text("internal_notes"),
  customerSatisfaction: integer("customer_satisfaction"),
  satisfactionRating: integer("satisfaction_rating"), // 1-5 star rating
  satisfactionComments: text("satisfaction_comments"),
  feedbackDate: timestamp("feedback_date"),
  responseTime: integer("response_time"), // minutes from creation to assignment
  resolutionTime: integer("resolution_time"), // minutes from assignment to completion
  technicianId: integer("technician_id"),
  technicianNotes: text("technician_notes"),
  timeLog: jsonb("time_log"), // JSON array of time entries
  totalTimeSpent: integer("total_time_spent"), // total minutes spent
  workStartTime: timestamp("work_start_time"),
  workEndTime: timestamp("work_end_time"),
  followUpRequired: boolean("follow_up_required").default(false),
  followUpDate: timestamp("follow_up_date"),
  recurrence: varchar("recurrence", { enum: ["none", "weekly", "monthly", "quarterly", "annually"] }).default("none"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  laborCost: decimal("labor_cost", {precision: 10,scale: 2,}),

});

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  name: varchar("name").notNull(),
  type: varchar("type").notNull(), // lease, invoice, receipt, maintenance, other
  url: varchar("url").notNull(),
  tenantId: integer("tenant_id"),
  propertyId: integer("property_id"),
  maintenanceRequestId: integer("maintenance_request_id"),
  uploadedBy: uuid("uploaded_by").notNull(),
  size: integer("size"),
  createdAt: timestamp("created_at").defaultNow(),
});


export const positionEnum = pgEnum("position_enum", [
  "property_manager",
  "leasing_agent",
  "maintenance_supervisor",
  "technician",
  "groundskeeper",
  "janitor",
  "security_guard",
  "concierge",
  "administrative_assistant",
  "accountant",
  "accounts_receivable",
  "accounts_payable",
  "marketing_specialist",
  "it_specialist",
  "hr_manager",
  "facilities_manager",
  "portfolio_manager",
  "regional_manager",
  "compliance_officer",
  "customer_service",
  "other"
]);

export const departmentEnum = pgEnum("department_enum", [
  "property_management",
  "maintenance",
  "security",
  "finance",
  "hr",
  "administration",
  "marketing"
]);

export const employmentTypeEnum = pgEnum("employment_type_enum", [
  "full_time",
  "part_time",
  "contract",
  "casual",
  "intern"
]);

export const staffStatusEnum = pgEnum("staff_status_enum", [
  "active",
  "inactive",
  "terminated",
  "on_leave"
]);

export const staffMembers = pgTable("staff_members", {
  id: serial("id").primaryKey(),
  organization_id: integer("organization_id").notNull().references(() => organizations.id),
  employee_id: varchar("employee_id").unique().notNull(),
  first_name: varchar("first_name").notNull(),
  last_name: varchar("last_name").notNull(),
  email: varchar("email"),
  phone: varchar("phone"),
  position: positionEnum("position").notNull(),
  department: departmentEnum("department").notNull(),
  employment_type: employmentTypeEnum("employment_type").default("full_time"),
  hire_date: timestamp("hire_date").notNull(),
  salary: decimal("salary", { precision: 12, scale: 2 }),
  hourly_rate: decimal("hourly_rate", { precision: 8, scale: 2 }),
  currency: currencyEnum("currency").default("KES"),
  status: staffStatusEnum("status").default("active"),
  photo_url: varchar("photo_url"),
  address: text("address"),
  emergency_contact_name: varchar("emergency_contact_name"),
  emergency_contact_phone: varchar("emergency_contact_phone"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
});

export const timeTrackingStatusEnum = pgEnum('time_tracking_status', [
  'pending_approval',
  'approved',
  'rejected',
  'in_progress'
]);

export const clockMethodEnum = pgEnum('clock_method', [
  'mobile',
  'web',
  'biometric',
  'manual',
  'api'
]);

export const timeTracking = pgTable('time_tracking', {
  id: serial('id').primaryKey(),
  organization_id: integer('organization_id').notNull(),
  staff_id: integer('staff_id').notNull().references(() => staffMembers.id, { onDelete: 'cascade' }),
  property_id: integer('property_id'),
  clock_in_time: timestamp('clock_in_time').notNull(),
  clock_out_time: timestamp('clock_out_time'),
  location_lat: real('location_lat'),
  location_lng: real('location_lng'),
  clock_in_method: clockMethodEnum('clock_in_method').default('mobile'),
  clock_out_method: clockMethodEnum('clock_out_method'),
  total_hours: decimal('total_hours', { precision: 5, scale: 2 }),
  overtime_hours: decimal('overtime_hours', { precision: 5, scale: 2 }).default('0'),
  break_time: decimal('break_time', { precision: 5, scale: 2 }).default('0'),
  notes: text('notes'),
  status: timeTrackingStatusEnum('status').default('pending_approval'),
  metadata: json('metadata'),
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow(),
  created_by: integer('created_by'),
  approved_by: integer('approved_by'),
  approved_at: timestamp('approved_at'),
});


export const clockInSchema = z.object({
  staff_id: z.number().positive(),
  property_id: z.number().positive().optional(),
  clock_in_method: z.enum(['mobile', 'web', 'biometric', 'manual', 'api']).optional(),
  location_lat: z.number().min(-90).max(90).optional(),
  location_lng: z.number().min(-180).max(180).optional(),
  notes: z.string().optional(),
});

export const clockOutSchema = z.object({
  clock_out_method: z.enum(['mobile', 'web', 'biometric', 'manual', 'api']).optional(),
  location_lat: z.number().min(-90).max(90).optional(),
  location_lng: z.number().min(-180).max(180).optional(),
  break_time: z.number().min(0).max(24).optional(),
  notes: z.string().optional(),
});

// Payroll Status Enum
export const payrollStatusEnum = pgEnum('payroll_status', [
  'pending_approval',
  'processed',
  'paid',
  'failed',
  'cancelled'
]);

export const payrollRecords = pgTable('payroll_records', {
  id: serial('id').primaryKey(),
  organization_id: integer('organization_id').notNull(),
  staff_id: integer('staff_id').notNull().references(() => staffMembers.id, { onDelete: 'cascade' }),
  payroll_period_id: integer('payroll_period_id'),
  
  // Pay Period
  pay_period_start: date('pay_period_start').notNull(),
  pay_period_end: date('pay_period_end').notNull(),
  
  // Hours
  regular_hours: decimal('regular_hours', { precision: 8, scale: 2 }).default('0'),
  overtime_hours: decimal('overtime_hours', { precision: 8, scale: 2 }).default('0'),
  leave_hours: decimal('leave_hours', { precision: 8, scale: 2 }).default('0'),
  
  // Earnings
  regular_rate: decimal('regular_rate', { precision: 10, scale: 2 }),
  regular_pay: decimal('regular_pay', { precision: 12, scale: 2 }).default('0'),
  overtime_rate: decimal('overtime_rate', { precision: 10, scale: 2 }),
  overtime_pay: decimal('overtime_pay', { precision: 12, scale: 2 }).default('0'),
  bonus: decimal('bonus', { precision: 12, scale: 2 }).default('0'),
  allowances: decimal('allowances', { precision: 12, scale: 2 }).default('0'),
  other_earnings: decimal('other_earnings', { precision: 12, scale: 2 }).default('0'),
  gross_pay: decimal('gross_pay', { precision: 12, scale: 2 }).notNull().default('0'),
  
  // Deductions
  tax_amount: decimal('tax_amount', { precision: 12, scale: 2 }).default('0'),
  nhif_amount: decimal('nhif_amount', { precision: 12, scale: 2 }).default('0'),
  nssf_amount: decimal('nssf_amount', { precision: 12, scale: 2 }).default('0'),
  pension_amount: decimal('pension_amount', { precision: 12, scale: 2 }).default('0'),
  loan_deductions: decimal('loan_deductions', { precision: 12, scale: 2 }).default('0'),
  other_deductions: decimal('other_deductions', { precision: 12, scale: 2 }).default('0'),
  total_deductions: decimal('total_deductions', { precision: 12, scale: 2 }).default('0'),
  
  // Net Pay
  net_pay: decimal('net_pay', { precision: 12, scale: 2 }).notNull().default('0'),
  
  // Payment Info
  currency: varchar('currency', { length: 3 }).default('KES'),
  payment_status: payrollStatusEnum('payment_status').default('pending_approval'),
  payment_date: date('payment_date'),
  payment_method: varchar('payment_method', { length: 50 }),
  payment_reference: varchar('payment_reference', { length: 100 }),
  bank_account_number: varchar('bank_account_number', { length: 50 }),
  bank_name: varchar('bank_name', { length: 100 }),
  
  // Metadata
  notes: text('notes'),
  is_adjustment: boolean('is_adjustment').default(false),
  adjustment_reason: text('adjustment_reason'),
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow(),
  created_by: integer('created_by'),
  approved_by: integer('approved_by'),
  approved_at: timestamp('approved_at'),
  paid_by: integer('paid_by'),
  paid_at: timestamp('paid_at'),
});

// Contractors table
export const contractors = pgTable("contractors", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  categoryId: integer("category_id").references(() => contractorCategories.id),
  companyName: varchar("company_name", { length: 255 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 50 }).notNull(),
  specialty: varchar("specialty", { length: 100 }).notNull(), // plumber, electrician, cleaner, etc.
  rate: decimal("rate", { precision: 10, scale: 2 }),
  currency: currencyEnum("currency").default("KES"),
  isAvailable: boolean("is_available").default(true),
  rating: decimal("rating", { precision: 3, scale: 2 }).default("0"),
  completedJobs: integer("completed_jobs").default(0),
  address: text("address"),
  notes: text("notes"),
  isVerified: boolean("is_verified").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Service charges — LEGACY ad-hoc/one-off charges only.
// For scheduled recurring levies (generator, water, etc.) use recurring_charges instead.
export const serviceCharges = pgTable("service_charges", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").references(() => properties.id),
  unitId: integer("unit_id").references(() => units.id),
  name: varchar("name", { length: 255 }).notNull(), // Waste Collection, Water, Electricity, etc.
  type: varchar("type", { length: 50 }).notNull(), // monthly, quarterly, annual, one-time
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: currencyEnum("currency").default("KES"),
  dueDate: timestamp("due_date"),
  status: varchar("status", { length: 50 }).default("pending"), // pending, paid, overdue
  description: text("description"),
  isRecurring: boolean("is_recurring").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Enhanced messaging with multiple channels

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  fromUserId: varchar("from_user_id").notNull(),
  toUserId: varchar("to_user_id").notNull(),
  subject: varchar("subject"),
  content: text("content").notNull(),
  channel: messageChannelEnum("channel").default("app"),
  type: messageTypeEnum("type").default("chat"),
  messageType: varchar("message_type", { enum: ["direct", "broadcast"] }).default("direct"),
  isRead: boolean("is_read").default(false),
  isScheduled: boolean("is_scheduled").default(false),
  scheduledAt: timestamp("scheduled_at"),
  sentAt: timestamp("sent_at"),
  metadata: jsonb("metadata"), // Additional data like SMS status, email delivery, etc.
  createdAt: timestamp("created_at").defaultNow(),
});

// Broadcast Messages - Enhanced messaging with audience targeting and multi-channel communication
export const broadcastMessages = pgTable("broadcast_messages", {
  id: serial("id").primaryKey(),
  title: varchar("title").notNull(),
  content: text("content").notNull(),
  senderUserId: varchar("sender_user_id").notNull(),
  organizationId: integer("organization_id").notNull(),
  audienceType: varchar("audience_type", { 
    enum: ["all_tenants", "all_landlords", "all_users", "specific_properties", "specific_roles", "specific_users", "custom_filter"] 
  }).notNull(),
  audienceFilter: jsonb("audience_filter"), // JSON criteria for filtering recipients
  broadcastMedium: varchar("broadcast_medium").array().notNull(), // ["sms", "email", "app_notification", "whatsapp", "push_notification"]
  scheduledFor: timestamp("scheduled_for"),
  status: varchar("status", { enum: ["draft", "scheduled", "sending", "sent", "failed"] }).default("draft"),
  totalRecipients: integer("total_recipients").default(0),
  sentCount: integer("sent_count").default(0),
  failedCount: integer("failed_count").default(0),
  openedCount: integer("opened_count").default(0),
  clickedCount: integer("clicked_count").default(0),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const broadcastRecipients = pgTable("broadcast_recipients", {
  id: serial("id").primaryKey(),
  broadcastId: integer("broadcast_id").references(() => broadcastMessages.id).notNull(),
  recipientUserId: varchar("recipient_user_id").notNull(),
  recipientType: varchar("recipient_type", { enum: ["tenant", "landlord", "admin", "manager", "staff"] }).notNull(),
  phoneNumber: varchar("phone_number"),
  email: varchar("email"),
  medium: varchar("medium").array().notNull(), // Which mediums to use for this recipient
  deliveryStatus: jsonb("delivery_status"), // Status per medium: {"sms": "sent", "email": "delivered", "app": "opened"}
  sentAt: timestamp("sent_at"),
  deliveredAt: timestamp("delivered_at"),
  openedAt: timestamp("opened_at"),
  clickedAt: timestamp("clicked_at"),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const communicationTemplates = pgTable("communication_templates", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  name: varchar("name").notNull(),
  category: varchar("category", { 
    enum: ["rent_reminder", "maintenance_update", "announcement", "welcome", "marketing", "emergency", "custom"] 
  }).notNull(),
  medium: varchar("medium").array().notNull(), // Which mediums this template supports
  subject: varchar("subject"),
  content: text("content").notNull(),
  variables: jsonb("variables"), // Available template variables like {{tenant_name}}, {{property_name}}
  isActive: boolean("is_active").default(true),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Insert schemas for broadcast functionality
export const insertBroadcastMessageSchema = createInsertSchema(broadcastMessages).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertBroadcastRecipientSchema = createInsertSchema(broadcastRecipients).omit({
  id: true,
  createdAt: true,
});

export const insertCommunicationTemplateSchema = createInsertSchema(communicationTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// MPesa transactions
export const mpesaTransactions = pgTable("mpesa_transactions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id),
  rentPaymentId: integer("rent_payment_id").references(() => rentPayments.id),
  serviceChargeId: integer("service_charge_id").references(() => serviceCharges.id),
  utilityBillId: integer("utility_bill_id").references(() => utilityBills.id),
  shortTermBookingId: integer("short_term_booking_id").references(() => tenantShortBookings.id),
  transactionId: varchar("transaction_id", { length: 100 }).unique(), // MPesa transaction ID or CheckoutRequestID
  phoneNumber: varchar("phone_number", { length: 20 }).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: currencyEnum("currency").default("KES"),
  status: varchar("status", { length: 50 }).default("pending"), // pending, completed, failed, cancelled
  mpesaReceiptNumber: varchar("mpesa_receipt_number", { length: 100 }),
  merchantRequestId: varchar("merchant_request_id", { length: 100 }),
  checkoutRequestId: varchar("checkout_request_id", { length: 100 }),
  responseCode: varchar("response_code", { length: 10 }),
  responseDescription: text("response_description"),
  customerMessage: text("customer_message"),
  transactionDate: varchar("transaction_date", { length: 50 }),
  resultCode: varchar("result_code", { length: 10 }),
  resultDesc: text("result_desc"),
  description: text("description"),
  callbackData: jsonb("callback_data"), // MPesa callback response data
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Complaint photos and attachments
export const complaintsPhotos = pgTable("complaints_photos", {
  id: serial("id").primaryKey(),
  maintenanceRequestId: integer("maintenance_request_id").references(() => maintenanceRequests.id),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  originalName: varchar("original_name", { length: 255 }).notNull(),
  mimeType: varchar("mime_type", { length: 100 }),
  size: integer("size"),
  url: text("url").notNull(), // File storage URL
  uploadedBy: uuid("uploaded_by").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Invoice reminders schedule
export const invoiceReminders = pgTable("invoice_reminders", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id),
  type: varchar("type", { length: 50 }).notNull(), // rent, service_charge
  referenceId: integer("reference_id").notNull(), // ID of rent payment or service charge
  reminderType: varchar("reminder_type", { length: 50 }).notNull(), // before_due, on_due, after_due
  daysOffset: integer("days_offset").notNull(), // Days before/after due date
  channel: messageChannelEnum("channel").default("email"),
  isActive: boolean("is_active").default(true),
  lastSent: timestamp("last_sent"),
  nextScheduled: timestamp("next_scheduled"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Project Management for Construction and Renovations
export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  type: varchar("type", { length: 50 }).notNull(), // 'construction', 'renovation', 'maintenance'
  status: varchar("status", { length: 50 }).notNull().default('planning'), // 'planning', 'in_progress', 'completed', 'on_hold', 'cancelled'
  priority: varchar("priority", { length: 20 }).notNull().default('medium'), // 'low', 'medium', 'high', 'urgent'
  propertyId: integer("property_id").references(() => properties.id),
  unitId: integer("unit_id").references(() => units.id),
  managerId: uuid("manager_id").references(() => users.id), // User who manages this project
  budget: decimal("budget", { precision: 10, scale: 2 }),
  actualCost: decimal("actual_cost", { precision: 10, scale: 2 }),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  estimatedDuration: integer("estimated_duration"), // in days
  actualDuration: integer("actual_duration"), // in days
  completionPercentage: integer("completion_percentage").default(0),
  materials: text("materials").array(), // Array of materials needed
  permits: text("permits").array(), // Array of permits required
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const projectTasks = pgTable("project_tasks", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projects.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  status: varchar("status", { length: 50 }).notNull().default('todo'), // 'todo', 'in_progress', 'completed', 'blocked'
  priority: varchar("priority", { length: 20 }).notNull().default('medium'), // 'low', 'medium', 'high', 'urgent'
  assignedTo: varchar("assigned_to"), // Can be contractor ID or user ID
  estimatedHours: integer("estimated_hours"),
  actualHours: integer("actual_hours"),
  dueDate: timestamp("due_date"),
  completedDate: timestamp("completed_date"),
  dependencies: integer("dependencies").array(), // Array of task IDs this task depends on
  materials: text("materials").array(), // Materials needed for this specific task
  cost: decimal("cost", { precision: 10, scale: 2 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const projectMilestones = pgTable("project_milestones", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projects.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  targetDate: timestamp("target_date").notNull(),
  completedDate: timestamp("completed_date"),
  status: varchar("status", { length: 50 }).notNull().default('pending'), // 'pending', 'completed', 'overdue'
  importance: varchar("importance", { length: 20 }).notNull().default('normal'), // 'low', 'normal', 'high', 'critical'
  deliverables: text("deliverables").array(), // What should be delivered at this milestone
  createdAt: timestamp("created_at").defaultNow(),
});

export const projectDocuments = pgTable("project_documents", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projects.id).notNull(),
  taskId: integer("task_id").references(() => projectTasks.id), // Optional: link to specific task
  name: text("name").notNull(),
  type: varchar("type", { length: 50 }).notNull(), // 'blueprint', 'permit', 'invoice', 'photo', 'contract', 'report'
  filePath: text("file_path").notNull(),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  uploadedBy: uuid("uploaded_by").notNull(),
  description: text("description"),
  tags: text("tags").array(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const projectExpenses = pgTable("project_expenses", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projects.id).notNull(),
  taskId: integer("task_id").references(() => projectTasks.id), // Optional: link to specific task
  category: varchar("category", { length: 50 }).notNull(), // 'materials', 'labor', 'permits', 'equipment', 'other'
  description: text("description").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  vendor: text("vendor"),
  invoiceNumber: text("invoice_number"),
  receiptPath: text("receipt_path"), // Path to receipt/invoice file
  paidDate: timestamp("paid_date"),
  status: varchar("status", { length: 50 }).notNull().default('pending'), // 'pending', 'paid', 'overdue'
  paymentMethod: varchar("payment_method", { length: 20 }), // 'mpesa', 'eft', 'cash', 'card'
  approvedBy: uuid("approved_by"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const projectTeam = pgTable("project_team", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projects.id).notNull(),
  memberId: varchar("member_id").notNull(), // Can be contractor ID or user ID
  memberType: varchar("member_type", { length: 50 }).notNull(), // 'manager', 'contractor', 'supervisor', 'worker'
  role: text("role"), // Specific role within the project
  hourlyRate: decimal("hourly_rate", { precision: 10, scale: 2 }),
  joinedDate: timestamp("joined_date").defaultNow(),
  leftDate: timestamp("left_date"),
  isActive: boolean("is_active").default(true),
});

export const projectTimeTracking = pgTable("project_time_tracking", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projects.id).notNull(),
  taskId: integer("task_id").references(() => projectTasks.id),
  memberId: varchar("member_id").notNull(),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time"),
  duration: integer("duration"), // in minutes
  description: text("description"),
  billable: boolean("billable").default(true),
  approved: boolean("approved").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// Work Order Management Tables - Advanced maintenance & ticketing system

export const workOrders = pgTable("work_orders", {
  id: serial("id").primaryKey(),
  ticketNumber: varchar("ticket_number").unique().notNull(),
  maintenanceRequestId: integer("maintenance_request_id").references(() => maintenanceRequests.id),  // nullable: work orders may be standalone (project-type) or maintenance-linked
  projectId: integer("project_id").references(() => projects.id),
  workOrderType: varchar("work_order_type", { enum: ["maintenance", "project", "emergency", "preventive", "inspection"] }).notNull(),
  title: varchar("title").notNull(),
  description: text("description").notNull(),
  priority: priorityEnum("priority").notNull(),
  status: varchar("status", { enum: ["draft", "pending_approval", "approved", "assigned", "in_progress", "on_hold", "completed", "cancelled", "rejected"] }).default("draft"),
  assignedTo: varchar("assigned_to"),
  supervisorId: varchar("supervisor_id"),
  contractorId: integer("contractor_id").references(() => contractors.id),
  estimatedStartDate: timestamp("estimated_start_date"),
  estimatedEndDate: timestamp("estimated_end_date"),
  actualStartDate: timestamp("actual_start_date"),
  actualEndDate: timestamp("actual_end_date"),
  estimatedCost: decimal("estimated_cost", { precision: 10, scale: 2 }),
  approvedBudget: decimal("approved_budget", { precision: 10, scale: 2 }),
  actualCost: decimal("actual_cost", { precision: 10, scale: 2 }),
  currency: currencyEnum("currency").default("USD"),
  approvalRequired: boolean("approval_required").default(true),
  approvalLevel: varchar("approval_level", { enum: ["supervisor", "manager", "executive"] }).default("supervisor"),
  approvedBy: uuid("approved_by"),
  approvedDate: timestamp("approved_date"),
  rejectionReason: text("rejection_reason"),
  completionNotes: text("completion_notes"),
  qualityRating: integer("quality_rating"), // 1-5 rating
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Work Order Tasks - Individual tasks within a work order
export const workOrderTasks = pgTable("work_order_tasks", {
  id: serial("id").primaryKey(),
  workOrderId: integer("work_order_id").notNull().references(() => workOrders.id),
  taskNumber: varchar("task_number").notNull(),
  title: varchar("title").notNull(),
  description: text("description"),
  status: varchar("status", { enum: ["pending", "in_progress", "completed", "blocked", "cancelled"] }).default("pending"),
  assignedTo: varchar("assigned_to"),
  estimatedHours: integer("estimated_hours"),
  actualHours: integer("actual_hours"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  dependsOn: integer("depends_on").array(), // Array of task IDs this task depends on
  materials: jsonb("materials"), // JSON array of required materials
  tools: jsonb("tools"), // JSON array of required tools
  skillsRequired: jsonb("skills_required"), // JSON array of required skills
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const workOrderMaterials = pgTable("work_order_materials", {
  id: serial("id").primaryKey(),
  workOrderId: integer("work_order_id")
    .references(() => workOrders.id)  // was incorrectly referencing maintenanceRequests.id
    .notNull(),

  itemName: varchar("item_name").notNull(),
  quantity: integer("quantity").notNull(),
  unitCost: decimal("unit_cost", { precision: 10, scale: 2 }).notNull(),

  notes: text("notes"),

  createdAt: timestamp("created_at").defaultNow(),
});

export const workOrderCharges = pgTable("work_order_charges", {
  id: serial("id").primaryKey(),
  workOrderId: integer("work_order_id")
    .references(() => workOrders.id)  // was incorrectly referencing maintenanceRequests.id
    .notNull(),

  description: varchar("description").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),

  createdAt: timestamp("created_at").defaultNow(),
});



// Work Order Approvals - Approval workflow tracking
export const workOrderApprovals = pgTable("work_order_approvals", {
  id: serial("id").primaryKey(),
  workOrderId: integer("work_order_id").notNull().references(() => workOrders.id),
  approvalLevel: varchar("approval_level", { enum: ["supervisor", "manager", "executive"] }).notNull(),
  status: varchar("status", { enum: ["pending", "approved", "rejected", "escalated"] }).default("pending"),
  approverUserId: varchar("approver_user_id"),
  approvedDate: timestamp("approved_date"),
  rejectionReason: text("rejection_reason"),
  escalatedTo: varchar("escalated_to"),
  escalatedDate: timestamp("escalated_date"),
  comments: text("comments"),
  approvedBudget: decimal("approved_budget", { precision: 10, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Work Order Expenses - Linking expenses to work orders and contractors
export const workOrderExpenses = pgTable("work_order_expenses", {
  id: serial("id").primaryKey(),
  workOrderId: integer("work_order_id").notNull().references(() => workOrders.id),
  contractorId: integer("contractor_id").references(() => contractors.id),
  expenseType: varchar("expense_type", { enum: ["labor", "materials", "equipment", "transportation", "permits", "other"] }).notNull(),
  description: text("description").notNull(),
  category: varchar("category").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: currencyEnum("currency").default("USD"),
  expenseDate: timestamp("expense_date").notNull(),
  receiptUrl: varchar("receipt_url"),
  isApproved: boolean("is_approved").default(false),
  approvedBy: uuid("approved_by"),
  approvedDate: timestamp("approved_date"),
  rejectionReason: text("rejection_reason"),
  invoiceNumber: varchar("invoice_number"),
  vendor: varchar("vendor"),
  paymentStatus: varchar("payment_status", { enum: ["pending", "paid", "overdue", "cancelled"] }).default("pending"),
  paymentDate: timestamp("payment_date"),
  notes: text("notes"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Work Order Progress Tracking
export const workOrderProgress = pgTable("work_order_progress", {
  id: serial("id").primaryKey(),
  workOrderId: integer("work_order_id").notNull().references(() => workOrders.id),
  taskId: integer("task_id").references(() => workOrderTasks.id),
  progressDate: timestamp("progress_date").notNull(),
  progressPercentage: integer("progress_percentage").notNull(), // 0-100
  statusUpdate: text("status_update").notNull(),
  completedWork: text("completed_work"),
  nextSteps: text("next_steps"),
  blockers: text("blockers"),
  hoursWorked: decimal("hours_worked", { precision: 5, scale: 2 }),
  photosUrl: jsonb("photos_url"), // Array of photo URLs
  updatedBy: uuid("updated_by").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// In your schema file

export const workOrderComments = pgTable("work_order_comments", {
  id: serial("id").primaryKey(),
  workOrderId: integer("work_order_id").notNull()
    .references(() => workOrders.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull(),
  userName: varchar("user_name", { length: 255 }).notNull(),
  userAvatar: text("user_avatar"),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  isEdited: boolean("is_edited").default(false),
  parentCommentId: integer("parent_comment_id")
    .references((): any => workOrderComments.id, { onDelete: "cascade" }),
});

// Use createSelectSchema and createInsertSchema
export const selectWorkOrderCommentSchema = createSelectSchema(workOrderComments);
export const insertWorkOrderCommentSchema = createInsertSchema(workOrderComments);

export type WorkOrderComment = InferSelectModel<typeof workOrderComments>;
export type NewWorkOrderComment = InferInsertModel<typeof workOrderComments>;

// New table relations
export const contractorsRelations = relations(contractors, ({ many }) => ({
  maintenanceRequests: many(maintenanceRequests),
}));

export const serviceChargesRelations = relations(serviceCharges, ({ one, many }) => ({
  property: one(properties, {
    fields: [serviceCharges.propertyId],
    references: [properties.id],
  }),
  unit: one(units, {
    fields: [serviceCharges.unitId],
    references: [units.id],
  }),
  mpesaTransactions: many(mpesaTransactions),
}));

export const mpesaTransactionsRelations = relations(mpesaTransactions, ({ one }) => ({
  tenant: one(tenants, {
    fields: [mpesaTransactions.tenantId],
    references: [tenants.id],
  }),
  rentPayment: one(rentPayments, {
    fields: [mpesaTransactions.rentPaymentId],
    references: [rentPayments.id],
  }),
  serviceCharge: one(serviceCharges, {
    fields: [mpesaTransactions.serviceChargeId],
    references: [serviceCharges.id],
  }),
}));

export const complaintsPhotosRelations = relations(complaintsPhotos, ({ one }) => ({
  maintenanceRequest: one(maintenanceRequests, {
    fields: [complaintsPhotos.maintenanceRequestId],
    references: [maintenanceRequests.id],
  }),
}));

export const invoiceRemindersRelations = relations(invoiceReminders, ({ one }) => ({
  tenant: one(tenants, {
    fields: [invoiceReminders.tenantId],
    references: [tenants.id],
  }),
}));

// Project Management Relations
export const projectsRelations = relations(projects, ({ one, many }) => ({
  property: one(properties, {
    fields: [projects.propertyId],
    references: [properties.id],
  }),
  unit: one(units, {
    fields: [projects.unitId],
    references: [units.id],
  }),
  manager: one(users, {
    fields: [projects.managerId],
    references: [users.id],
  }),
  tasks: many(projectTasks),
  milestones: many(projectMilestones),
  documents: many(projectDocuments),
  expenses: many(projectExpenses),
  team: many(projectTeam),
  timeTracking: many(projectTimeTracking),
}));

export const projectTasksRelations = relations(projectTasks, ({ one, many }) => ({
  project: one(projects, {
    fields: [projectTasks.projectId],
    references: [projects.id],
  }),
  documents: many(projectDocuments),
  expenses: many(projectExpenses),
  timeTracking: many(projectTimeTracking),
}));

export const projectMilestonesRelations = relations(projectMilestones, ({ one }) => ({
  project: one(projects, {
    fields: [projectMilestones.projectId],
    references: [projects.id],
  }),
}));

export const projectDocumentsRelations = relations(projectDocuments, ({ one }) => ({
  project: one(projects, {
    fields: [projectDocuments.projectId],
    references: [projects.id],
  }),
  task: one(projectTasks, {
    fields: [projectDocuments.taskId],
    references: [projectTasks.id],
  }),
  uploader: one(users, {
    fields: [projectDocuments.uploadedBy],
    references: [users.id],
  }),
}));

export const projectExpensesRelations = relations(projectExpenses, ({ one }) => ({
  project: one(projects, {
    fields: [projectExpenses.projectId],
    references: [projects.id],
  }),
  task: one(projectTasks, {
    fields: [projectExpenses.taskId],
    references: [projectTasks.id],
  }),
  approver: one(users, {
    fields: [projectExpenses.approvedBy],
    references: [users.id],
  }),
}));

export const projectTeamRelations = relations(projectTeam, ({ one }) => ({
  project: one(projects, {
    fields: [projectTeam.projectId],
    references: [projects.id],
  }),
}));

export const projectTimeTrackingRelations = relations(projectTimeTracking, ({ one }) => ({
  project: one(projects, {
    fields: [projectTimeTracking.projectId],
    references: [projects.id],
  }),
  task: one(projectTasks, {
    fields: [projectTimeTracking.taskId],
    references: [projectTasks.id],
  }),
}));

// Work Order Management Relations
export const workOrdersRelations = relations(workOrders, ({ one, many }) => ({
  maintenanceRequest: one(maintenanceRequests, {
    fields: [workOrders.maintenanceRequestId],
    references: [maintenanceRequests.id],
  }),
  project: one(projects, {
    fields: [workOrders.projectId],
    references: [projects.id],
  }),
  contractor: one(contractors, {
    fields: [workOrders.contractorId],
    references: [contractors.id],
  }),
  tasks: many(workOrderTasks),
  approvals: many(workOrderApprovals),
  expenses: many(workOrderExpenses),
  progress: many(workOrderProgress),
}));

export const workOrderTasksRelations = relations(workOrderTasks, ({ one, many }) => ({
  workOrder: one(workOrders, {
    fields: [workOrderTasks.workOrderId],
    references: [workOrders.id],
  }),
  progress: many(workOrderProgress),
}));

export const workOrderApprovalsRelations = relations(workOrderApprovals, ({ one }) => ({
  workOrder: one(workOrders, {
    fields: [workOrderApprovals.workOrderId],
    references: [workOrders.id],
  }),
}));

export const workOrderExpensesRelations = relations(workOrderExpenses, ({ one }) => ({
  workOrder: one(workOrders, {
    fields: [workOrderExpenses.workOrderId],
    references: [workOrders.id],
  }),
  contractor: one(contractors, {
    fields: [workOrderExpenses.contractorId],
    references: [contractors.id],
  }),
}));

export const workOrderProgressRelations = relations(workOrderProgress, ({ one }) => ({
  workOrder: one(workOrders, {
    fields: [workOrderProgress.workOrderId],
    references: [workOrders.id],
  }),
  task: one(workOrderTasks, {
    fields: [workOrderProgress.taskId],
    references: [workOrderTasks.id],
  }),
}));

// Updated relations
export const usersRelations = relations(users, ({ many }) => ({
  properties: many(properties),
  tenants: many(tenants),
  sentMessages: many(messages, { relationName: "sender" }),
  receivedMessages: many(messages, { relationName: "receiver" }),
}));

export const propertiesRelations = relations(properties, ({ one, many }) => ({
  owner: one(users, {
    fields: [properties.ownerId],
    references: [users.id],
  }),
  units: many(units),
  documents: many(documents),
}));

export const unitsRelations = relations(units, ({ one, many }) => ({
  property: one(properties, {
    fields: [units.propertyId],
    references: [properties.id],
  }),
  tenant: one(tenants),
  maintenanceRequests: many(maintenanceRequests),
}));

export const tenantsRelations = relations(tenants, ({ one, many }) => ({
  user: one(users, {
    fields: [tenants.userId],
    references: [users.id],
  }),
  unit: one(units, {
    fields: [tenants.unitId],
    references: [units.id],
  }),
  rentPayments: many(rentPayments),
  maintenanceRequests: many(maintenanceRequests),
  documents: many(documents),
}));

export const rentPaymentsRelations = relations(rentPayments, ({ one }) => ({
  tenant: one(tenants, {
    fields: [rentPayments.tenantId],
    references: [tenants.id],
  }),
}));

export const maintenanceRequestsRelations = relations(maintenanceRequests, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [maintenanceRequests.tenantId],
    references: [tenants.id],
  }),
  unit: one(units, {
    fields: [maintenanceRequests.unitId],
    references: [units.id],
  }),
  contractor: one(contractors, {
    fields: [maintenanceRequests.contractorId],
    references: [contractors.id],
  }),
  assignee: one(users, {
    fields: [maintenanceRequests.assignedTo],
    references: [users.id],
  }),
  documents: many(documents),
  photos: many(complaintsPhotos),
}));

export const documentsRelations = relations(documents, ({ one }) => ({
  tenant: one(tenants, {
    fields: [documents.tenantId],
    references: [tenants.id],
  }),
  property: one(properties, {
    fields: [documents.propertyId],
    references: [properties.id],
  }),
  maintenanceRequest: one(maintenanceRequests, {
    fields: [documents.maintenanceRequestId],
    references: [maintenanceRequests.id],
  }),
  uploader: one(users, {
    fields: [documents.uploadedBy],
    references: [users.id],
  }),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  sender: one(users, {
    fields: [messages.fromUserId],
    references: [users.id],
    relationName: "sender",
  }),
  receiver: one(users, {
    fields: [messages.toUserId],
    references: [users.id],
    relationName: "receiver",
  }),
}));

// Insert schemas
export const insertPropertySchema = createInsertSchema(properties).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});


export const insertUnitSchema = createInsertSchema(units, {
  bathrooms: (schema) => schema.transform((val) => parseFloat(val)),
  monthlyRent: (schema) => schema.transform((val) => parseFloat(val)),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertTenantSchema = createInsertSchema(tenants).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Add these to your schemas.ts file

export const insertRentPaymentSchema = z.object({
  tenantId: z.number(),
  invoiceNumber: z.string().optional(),
  amount: z.string(),
  currency: z.string().default("USD"),
  dueDate: z.string(),
  paidDate: z.string().optional(),
  paymentMethod: z.string().optional(),
  mpesaTransactionId: z.string().optional(),
  bankReference: z.string().optional(),
  ussdSessionId: z.string().optional(),
  status: z.enum(["pending", "paid", "overdue", "partial"]).default("pending"),
  notes: z.string().optional(),
});

export const updateRentPaymentSchema = z.object({
  tenantId: z.number().optional(),
  invoiceNumber: z.string().optional(),
  amount: z.string().optional(),
  currency: z.string().optional(),
  dueDate: z.string().optional(),
  paidDate: z.string().optional(),
  paymentMethod: z.string().optional(),
  mpesaTransactionId: z.string().optional(),
  bankReference: z.string().optional(),
  ussdSessionId: z.string().optional(),
  status: z.enum(["pending", "paid", "overdue", "partial"]).optional(),
  notes: z.string().optional(),
});

// Update the insertMaintenanceRequestSchema
export const insertMaintenanceRequestSchema = z.object({
  // Make ticketNumber optional with a default value
  ticketNumber: z.string().optional().default(generateTicketNumber()),
  tenantId: z.number().min(1),
  unitId: z.number().min(1),
  contractorId: z.number().optional(),
  title: z.string().min(1),
  description: z.string().min(1),
  category: z.enum(["plumbing", "electrical", "hvac", "carpentry", "painting", "cleaning", "landscaping", "appliance", "security", "other"]).optional().default("other"),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  status: z.enum(["pending", "assigned", "in_progress", "completed", "cancelled"]).optional().default("pending"),
  assignedTo: z.string().optional(),
  assignedDate: z.string().optional(),
  startedDate: z.string().optional(),
  estimatedCost: z.string().optional(),
  actualCost: z.string().optional(),
  estimatedHours: z.number().optional(),
  actualHours: z.number().optional(),
  currency: z.enum(["USD", "EUR", "GBP", "KES"]).optional().default("KES"),
  scheduledDate: z.string().optional(),
  approvalRequired: z.boolean().optional().default(false),
  approvedBy: z.string().optional(),
  approvedDate: z.string().optional(),
  rejectionReason: z.string().optional(),
  tenantNotes: z.string().optional(),
  contractorNotes: z.string().optional(),
  internalNotes: z.string().optional(),
  customerSatisfaction: z.number().optional(),
  satisfactionRating: z.number().optional(),
  satisfactionComments: z.string().optional(),
  feedbackDate: z.string().optional(),
  responseTime: z.number().optional(),
  resolutionTime: z.number().optional(),
  technicianId: z.number().optional(),
  technicianNotes: z.string().optional(),
  timeLog: z.any().optional(),
  totalTimeSpent: z.number().optional(),
  workStartTime: z.string().optional(),
  workEndTime: z.string().optional(),
  followUpRequired: z.boolean().optional().default(false),
  followUpDate: z.string().optional(),
  recurrence: z.enum(["none", "weekly", "monthly", "quarterly", "annually"]).optional().default("none"),
  completedAt: z.string().optional(),
});

export const insertDocumentSchema = createInsertSchema(documents).omit({
  id: true,
  createdAt: true,
});

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
});

export const insertContractorSchema = createInsertSchema(contractors).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertServiceChargeSchema = createInsertSchema(serviceCharges).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertOrganizationSchema = createInsertSchema(organizations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertMpesaTransactionSchema = createInsertSchema(mpesaTransactions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertComplaintsPhotoSchema = createInsertSchema(complaintsPhotos).omit({
  id: true,
  createdAt: true,
});

export const insertInvoiceReminderSchema = createInsertSchema(invoiceReminders).omit({
  id: true,
  createdAt: true,
});

export const upsertUserSchema = createInsertSchema(users);

// Currency utilities
export const SUPPORTED_CURRENCIES = [
  { code: "KES", symbol: "KSh", name: "Kenya Shilling" },
  { code: "USD", symbol: "$", name: "US Dollar" },
  { code: "EUR", symbol: "€", name: "Euro" },
  { code: "GBP", symbol: "£", name: "British Pound" },
  { code: "CAD", symbol: "C$", name: "Canadian Dollar" },
  { code: "AUD", symbol: "A$", name: "Australian Dollar" },
  { code: "JPY", symbol: "¥", name: "Japanese Yen" },
  { code: "CHF", symbol: "Fr", name: "Swiss Franc" },
  { code: "CNY", symbol: "¥", name: "Chinese Yuan" },
] as const;

export type CurrencyCode = typeof SUPPORTED_CURRENCIES[number]["code"];

// Billing & Utilities schemas
export const utilityProviders = pgTable("utility_providers", {
  id: serial("id").primaryKey(),
  name: varchar("name").notNull(),
  type: varchar("type").notNull(), // water, electricity, gas, garbage, internet, etc.
  contactEmail: varchar("contact_email"),
  contactPhone: varchar("contact_phone"),
  billingCycle: varchar("billing_cycle").notNull(), // monthly, quarterly, annually
  averageRate: varchar("average_rate"), // average cost per unit
  currency: varchar("currency").default("KES"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const utilityAccounts = pgTable("utility_accounts", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  unitId: integer("unit_id").references(() => units.id),
  providerId: integer("provider_id").references(() => utilityProviders.id).notNull(),
  accountNumber: varchar("account_number").notNull(),
  meterNumber: varchar("meter_number"),
  connectionDate: timestamp("connection_date"),
  isActive: boolean("is_active").default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const utilityBills = pgTable("utility_bills", {
  id: serial("id").primaryKey(),
  // accountId is now optional — bills can be saved even when no utilityAccount
  // row exists for the unit (e.g. shared-meter high-rise buildings in Nairobi).
  accountId: integer("account_id").references(() => utilityAccounts.id),
  // Direct tenant link so /my-bills works even without a utility account
  tenantId: integer("tenant_id").references(() => tenants.id),
  utilityType: varchar("utility_type"), // water, electricity, gas, internet, other
  billNumber: varchar("bill_number"),
  billingPeriodStart: timestamp("billing_period_start").notNull(),
  billingPeriodEnd: timestamp("billing_period_end").notNull(),
  dueDate: timestamp("due_date").notNull(),
  amount: varchar("amount").notNull(),
  currency: varchar("currency").default("KES"),
  unitsConsumed: varchar("units_consumed"), // kWh, gallons, cubic meters, etc.
  unitRate: varchar("unit_rate"),
  previousReading: varchar("previous_reading"),
  currentReading: varchar("current_reading"),
  status: varchar("status").default("pending"), // pending, paid, overdue, disputed
  paidDate: timestamp("paid_date"),
  paymentMethod: varchar("payment_method"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const utilityMeterReadings = pgTable("utility_meter_readings", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").references(() => utilityAccounts.id).notNull(),
  readingDate: timestamp("reading_date").notNull(),
  reading: varchar("reading").notNull(),
  readingType: varchar("reading_type").default("manual"), // manual, auto, estimated
  consumption: varchar("consumption"), // calculated consumption since last reading
  readBy: uuid("read_by"), // user who recorded the reading
  imageUrl: varchar("image_url"), // photo of meter
  notes: text("notes"),
  verified: boolean("verified").default(false),
  verifiedBy: uuid("verified_by"),
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────────────
// BILLING NOTE: Two tables exist for charges — use the right one:
//
//   recurring_charges  ← CANONICAL for scheduled levies (generator, water,
//                         service charges, etc.). The rent scheduler queries
//                         THIS table to build itemised monthly invoices.
//                         autoGenerate=true charges are included automatically.
//
//   service_charges    ← LEGACY one-off or ad-hoc charges (e.g. a plumber
//                         call-out billed directly to a tenant). Do NOT use
//                         this for regular monthly levies — use recurring_charges.
// ─────────────────────────────────────────────────────────────────────────────
export const recurringCharges = pgTable("recurring_charges", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  unitId: integer("unit_id").references(() => units.id),
  name: varchar("name").notNull(),
  type: varchar("type").notNull(), // utility, service, maintenance, insurance, etc.
  amount: varchar("amount").notNull(),
  currency: varchar("currency").default("KES"),
  frequency: varchar("frequency").notNull(), // monthly, quarterly, annually, weekly
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date"),
  nextBillDate: timestamp("next_bill_date").notNull(),
  isActive: boolean("is_active").default(true),
  autoGenerate: boolean("auto_generate").default(true),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  invoiceNumber: varchar("invoice_number").notNull().unique(),
  tenantId: integer("tenant_id").references(() => tenants.id),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  unitId: integer("unit_id").references(() => units.id),
  type: varchar("type").notNull(), // rent, utility, service_charge, late_fee, etc.
  amount: varchar("amount").notNull(),
  currency: varchar("currency").default("KES"),
  issueDate: timestamp("issue_date").defaultNow(),
  dueDate: timestamp("due_date").notNull(),
  status: varchar("status").default("pending"), // pending, sent, paid, overdue, cancelled
  paidDate: timestamp("paid_date"),
  paymentMethod: varchar("payment_method"),
  description: text("description"),
  lineItems: json("line_items"), // Array of {description, amount, quantity, unitPrice}
  taxAmount: varchar("tax_amount").default("0"),
  discountAmount: varchar("discount_amount").default("0"),
  totalAmount: varchar("total_amount").notNull(),
  remindersSent: integer("reminders_sent").default(0),
  lastReminderDate: timestamp("last_reminder_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const billingCycles = pgTable("billing_cycles", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  name: varchar("name").notNull(),
  type: varchar("type").notNull(), // rent, utilities, services
  frequency: varchar("frequency").notNull(), // monthly, quarterly, annually
  billingDay: integer("billing_day").notNull(), // day of month (1-31)
  dueDay: integer("due_day").notNull(), // days after billing (e.g., 30 days)
  graceDay: integer("grace_day").default(5), // grace period days
  lateFeeAmount: varchar("late_fee_amount"),
  lateFeeType: varchar("late_fee_type"), // fixed, percentage
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// Relations for billing & utilities
export const utilityProvidersRelations = relations(utilityProviders, ({ many }) => ({
  accounts: many(utilityAccounts),
}));

export const utilityAccountsRelations = relations(utilityAccounts, ({ one, many }) => ({
  property: one(properties, {
    fields: [utilityAccounts.propertyId],
    references: [properties.id],
  }),
  unit: one(units, {
    fields: [utilityAccounts.unitId],
    references: [units.id],
  }),
  provider: one(utilityProviders, {
    fields: [utilityAccounts.providerId],
    references: [utilityProviders.id],
  }),
  bills: many(utilityBills),
  meterReadings: many(utilityMeterReadings),
}));

export const utilityBillsRelations = relations(utilityBills, ({ one }) => ({
  account: one(utilityAccounts, {
    fields: [utilityBills.accountId],
    references: [utilityAccounts.id],
  }),
}));

export const utilityMeterReadingsRelations = relations(utilityMeterReadings, ({ one }) => ({
  account: one(utilityAccounts, {
    fields: [utilityMeterReadings.accountId],
    references: [utilityAccounts.id],
  }),
}));

export const recurringChargesNewRelations = relations(recurringCharges, ({ one }) => ({
  property: one(properties, {
    fields: [recurringCharges.propertyId],
    references: [properties.id],
  }),
  unit: one(units, {
    fields: [recurringCharges.unitId],
    references: [units.id],
  }),
}));

export const invoicesRelations = relations(invoices, ({ one }) => ({
  tenant: one(tenants, {
    fields: [invoices.tenantId],
    references: [tenants.id],
  }),
  property: one(properties, {
    fields: [invoices.propertyId],
    references: [properties.id],
  }),
  unit: one(units, {
    fields: [invoices.unitId],
    references: [units.id],
  }),
}));

export const billingCyclesRelations = relations(billingCycles, ({ one }) => ({
  property: one(properties, {
    fields: [billingCycles.propertyId],
    references: [properties.id],
  }),
}));

// Billing & Utilities insert and select types
export const insertUtilityProviderSchema = createInsertSchema(utilityProviders).omit({
  id: true,
  createdAt: true,
});

export const insertUtilityAccountSchema = createInsertSchema(utilityAccounts).omit({
  id: true,
  createdAt: true,
});

export const insertUtilityBillSchema = createInsertSchema(utilityBills).omit({
  id: true,
  createdAt: true,
});

export const insertUtilityMeterReadingSchema = createInsertSchema(utilityMeterReadings).omit({
  id: true,
  createdAt: true,
});

export const insertRecurringChargeSchema = createInsertSchema(recurringCharges).omit({
  id: true,
  createdAt: true,
});

export const insertInvoiceSchema = createInsertSchema(invoices).omit({
  id: true,
  createdAt: true,
});

export const insertBillingCycleSchema = createInsertSchema(billingCycles).omit({
  id: true,
  createdAt: true,
});

export type UtilityProviderInsert = typeof utilityProviders.$inferInsert;
export type UtilityProvider = typeof utilityProviders.$inferSelect;
export type UtilityAccountInsert = typeof utilityAccounts.$inferInsert;
export type UtilityAccount = typeof utilityAccounts.$inferSelect;
export type UtilityBillInsert = typeof utilityBills.$inferInsert;
export type UtilityBill = typeof utilityBills.$inferSelect;
export type UtilityMeterReadingInsert = typeof utilityMeterReadings.$inferInsert;
export type UtilityMeterReading = typeof utilityMeterReadings.$inferSelect;
export type RecurringChargeInsert = typeof recurringCharges.$inferInsert;
export type RecurringCharge = typeof recurringCharges.$inferSelect;
export type InvoiceInsert = typeof invoices.$inferInsert;
export type Invoice = typeof invoices.$inferSelect;
export type BillingCycleInsert = typeof billingCycles.$inferInsert;
export type BillingCycle = typeof billingCycles.$inferSelect;

// Security & Compliance Tables
export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  // userId: varchar("user_id").notNull(), // User who performed the action
  userId: uuid("user_id").notNull().references(() => users.id),
  entityType: varchar("entity_type", { length: 50 }).notNull(), // table/entity affected
  entityId: varchar("entity_id").notNull(), // ID of the affected record
  action: varchar("action", { length: 20 }).notNull(), // CREATE, READ, UPDATE, DELETE
  oldValues: jsonb("old_values"), // Previous state (for updates/deletes)
  newValues: jsonb("new_values"), // New state (for creates/updates)
  ipAddress: varchar("ip_address", { length: 45 }), // IPv4/IPv6 address
  userAgent: text("user_agent"), // Browser/client info
  sessionId: varchar("session_id"), // Session identifier
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  metadata: jsonb("metadata"), // Additional context
});

export const encryptionKeys = pgTable("encryption_keys", {
  id: serial("id").primaryKey(),
  keyId: varchar("key_id", { length: 50 }).notNull().unique(), // Unique identifier for the key
  keyType: varchar("key_type", { length: 30 }).notNull(), // AES-256, RSA-2048, etc.
  purpose: varchar("purpose", { length: 50 }).notNull(), // data, communication, backup
  encryptedKey: text("encrypted_key").notNull(), // The actual encrypted key
  keyVersion: integer("key_version").default(1),
  isActive: boolean("is_active").default(true),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
  rotatedAt: timestamp("rotated_at"),
});

export const trustAccounts = pgTable("trust_accounts", {
  id: serial("id").primaryKey(),
  accountNumber: varchar("account_number", { length: 50 }).notNull().unique(),
  accountName: varchar("account_name", { length: 100 }).notNull(),
  bankName: varchar("bank_name", { length: 100 }).notNull(),
  bankCode: varchar("bank_code", { length: 20 }), // Sort code/routing number
  iban: varchar("iban", { length: 34 }), // International bank account number
  swift: varchar("swift", { length: 11 }), // SWIFT/BIC code
  accountType: varchar("account_type", { length: 30 }).notNull(), // trust, operating, escrow
  balance: decimal("balance", { precision: 15, scale: 2 }).default("0.00"),
  currency: varchar("currency", { length: 3 }).default("USD"),
  isActive: boolean("is_active").default(true),
  fsca_compliant: boolean("fsca_compliant").default(true),
  regulatoryId: varchar("regulatory_id", { length: 50 }), // FSCA registration number
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const trustAccountTransactions = pgTable("trust_account_transactions", {
  id: serial("id").primaryKey(),
  trustAccountId: integer("trust_account_id").references(() => trustAccounts.id).notNull(),
  transactionId: varchar("transaction_id", { length: 50 }).notNull().unique(),
  type: varchar("type", { length: 30 }).notNull(), // deposit, withdrawal, transfer, hold
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).default("USD"),
  description: text("description"),
  reference: varchar("reference", { length: 100 }), // External reference
  relatedEntityType: varchar("related_entity_type", { length: 50 }), // tenant, property, invoice
  relatedEntityId: integer("related_entity_id"),
  status: varchar("status", { length: 20 }).default("pending"), // pending, completed, failed, cancelled
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  metadata: jsonb("metadata"),
});

export const complianceReports = pgTable("compliance_reports", {
  id: serial("id").primaryKey(),
  reportType: varchar("report_type", { length: 50 }).notNull(), // fsca_monthly, audit_trail, financial_summary
  reportPeriod: varchar("report_period", { length: 20 }).notNull(), // YYYY-MM, YYYY-Q1, YYYY
  generatedBy: uuid("generated_by").notNull(),
  reportData: jsonb("report_data").notNull(), // Structured report content
  fileHash: varchar("file_hash", { length: 64 }), // SHA-256 hash for integrity
  status: varchar("status", { length: 20 }).default("draft"), // draft, submitted, approved, rejected
  submittedAt: timestamp("submitted_at"),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").defaultNow(),
  metadata: jsonb("metadata"),
});

export const securityIncidents = pgTable("security_incidents", {
  id: serial("id").primaryKey(),
  incidentType: varchar("incident_type", { length: 50 }).notNull(), // unauthorized_access, data_breach, fraud_attempt
  severity: varchar("severity", { length: 20 }).notNull(), // low, medium, high, critical
  description: text("description").notNull(),
  affectedUserId: varchar("affected_user_id"),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  detectedAt: timestamp("detected_at").defaultNow(),
  resolvedAt: timestamp("resolved_at"),
  status: varchar("status", { length: 20 }).default("open"), // open, investigating, resolved, closed
  assignedTo: varchar("assigned_to"), // Security team member
  resolutionNotes: text("resolution_notes"),
  metadata: jsonb("metadata"),
});

export const dataEncryption = pgTable("data_encryption", {
  id: serial("id").primaryKey(),
  tableName: varchar("table_name", { length: 50 }).notNull(),
  columnName: varchar("column_name", { length: 50 }).notNull(),
  recordId: varchar("record_id").notNull(),
  encryptedData: text("encrypted_data").notNull(),
  keyId: varchar("key_id", { length: 50 }).references(() => encryptionKeys.keyId).notNull(),
  algorithm: varchar("algorithm", { length: 30 }).default("AES-256-GCM"),
  iv: varchar("iv", { length: 32 }), // Initialization vector
  authTag: varchar("auth_tag", { length: 32 }), // Authentication tag for GCM
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Arrears tracking table
export const arrears = pgTable("arrears", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  unitId: integer("unit_id").references(() => units.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  outstandingAmount: decimal("outstanding_amount", { precision: 10, scale: 2 }).notNull(),
  currency: currencyEnum("currency").default("USD").notNull(),
  daysOverdue: integer("days_overdue").notNull(),
  lastPaymentDate: timestamp("last_payment_date"),
  nextDueDate: timestamp("next_due_date").notNull(),
  status: varchar("status", { length: 20 }).default("active").notNull(), // active, resolved, legal_action
  priority: varchar("priority", { length: 10 }).default("medium").notNull(), // low, medium, high, critical
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Payment reminders table
export const paymentReminders = pgTable("payment_reminders", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  arrearsId: integer("arrears_id").references(() => arrears.id),
  reminderType: varchar("reminder_type", { length: 20 }).notNull(), // 'pre_due', 'overdue', 'final_notice'
  channel: varchar("channel", { length: 10 }).notNull(), // 'sms', 'email', 'app'
  message: text("message").notNull(),
  scheduledFor: timestamp("scheduled_for").notNull(),
  sentAt: timestamp("sent_at"),
  status: varchar("status", { length: 20 }).default("pending").notNull(), // pending, sent, failed, cancelled
  recipientInfo: jsonb("recipient_info"), // Email/phone details
  responseReceived: boolean("response_received").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// Risk assessment table
export const riskAssessments = pgTable("risk_assessments", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  assessmentDate: timestamp("assessment_date").defaultNow(),
  riskScore: integer("risk_score").notNull(), // 1-100 scale
  riskCategory: varchar("risk_category", { length: 20 }).notNull(), // 'low', 'medium', 'high', 'critical'
  paymentHistoryScore: integer("payment_history_score").notNull(), // 1-100
  incomeStabilityScore: integer("income_stability_score").notNull(), // 1-100
  behaviorScore: integer("behavior_score").notNull(), // 1-100
  factors: jsonb("factors").notNull(), // Detailed risk factors
  recommendations: text("recommendations"),
  assessedBy: uuid("assessed_by").notNull(),
  nextReviewDate: timestamp("next_review_date").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Tenant behavior tracking table
export const tenantBehaviorLogs = pgTable("tenant_behavior_logs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  eventType: varchar("event_type", { length: 50 }).notNull(), // 'payment', 'maintenance_request', 'complaint', 'lease_violation'
  eventCategory: varchar("event_category", { length: 20 }).notNull(), // 'positive', 'negative', 'neutral'
  description: text("description").notNull(),
  impact: varchar("impact", { length: 10 }).notNull(), // 'low', 'medium', 'high'
  relatedEntityType: varchar("related_entity_type", { length: 50 }), // 'rent_payment', 'maintenance_request'
  relatedEntityId: integer("related_entity_id"),
  recordedBy: uuid("recorded_by").notNull(),
  eventDate: timestamp("event_date").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Arrears actions table
export const arrearsActions = pgTable("arrears_actions", {
  id: serial("id").primaryKey(),
  arrearsId: integer("arrears_id").references(() => arrears.id).notNull(),
  actionType: varchar("action_type", { length: 50 }).notNull(), // 'reminder_sent', 'payment_plan', 'legal_notice', 'eviction_notice'
  actionDate: timestamp("action_date").defaultNow(),
  description: text("description").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }), // If payment was made
  outcome: varchar("outcome", { length: 50 }), // 'successful', 'failed', 'pending'
  followUpDate: timestamp("follow_up_date"),
  performedBy: uuid("performed_by").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Security & Compliance Insert Schemas
export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({
  id: true,
  timestamp: true,
});

export const insertEncryptionKeySchema = createInsertSchema(encryptionKeys).omit({
  id: true,
  createdAt: true,
});

export const insertTrustAccountSchema = createInsertSchema(trustAccounts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertTrustAccountTransactionSchema = createInsertSchema(trustAccountTransactions).omit({
  id: true,
  createdAt: true,
});

export const insertComplianceReportSchema = createInsertSchema(complianceReports).omit({
  id: true,
  createdAt: true,
});

export const insertSecurityIncidentSchema = createInsertSchema(securityIncidents).omit({
  id: true,
  detectedAt: true,
});

export const insertDataEncryptionSchema = createInsertSchema(dataEncryption).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Arrears & Risk Management Insert Schemas
export const insertArrearsSchema = createInsertSchema(arrears).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPaymentReminderSchema = createInsertSchema(paymentReminders).omit({
  id: true,
  createdAt: true,
});

export const insertRiskAssessmentSchema = createInsertSchema(riskAssessments).omit({
  id: true,
  createdAt: true,
});

export const insertTenantBehaviorLogSchema = createInsertSchema(tenantBehaviorLogs).omit({
  id: true,
  createdAt: true,
});

export const insertArrearsActionSchema = createInsertSchema(arrearsActions).omit({
  id: true,
  createdAt: true,
});



// Security & Compliance Type exports
export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;

export type EncryptionKey = typeof encryptionKeys.$inferSelect;
export type InsertEncryptionKey = typeof encryptionKeys.$inferInsert;

export type TrustAccount = typeof trustAccounts.$inferSelect;
export type InsertTrustAccount = typeof trustAccounts.$inferInsert;

export type TrustAccountTransaction = typeof trustAccountTransactions.$inferSelect;
export type InsertTrustAccountTransaction = typeof trustAccountTransactions.$inferInsert;

export type ComplianceReport = typeof complianceReports.$inferSelect;
export type InsertComplianceReport = typeof complianceReports.$inferInsert;

export type SecurityIncident = typeof securityIncidents.$inferSelect;
export type InsertSecurityIncident = typeof securityIncidents.$inferInsert;

export type DataEncryption = typeof dataEncryption.$inferSelect;
export type InsertDataEncryption = typeof dataEncryption.$inferInsert;

// Arrears & Risk Management Type exports
export type Arrears = typeof arrears.$inferSelect;
export type InsertArrears = typeof arrears.$inferInsert;

export type PaymentReminder = typeof paymentReminders.$inferSelect;
export type InsertPaymentReminder = typeof paymentReminders.$inferInsert;

export type RiskAssessment = typeof riskAssessments.$inferSelect;
export type InsertRiskAssessment = typeof riskAssessments.$inferInsert;

export type TenantBehaviorLog = typeof tenantBehaviorLogs.$inferSelect;
export type InsertTenantBehaviorLog = typeof tenantBehaviorLogs.$inferInsert;

export type ArrearsAction = typeof arrearsActions.$inferSelect;
export type InsertArrearsAction = typeof arrearsActions.$inferInsert;

// Portal Type exports
export type TenantPortalSession = typeof tenantPortalSessions.$inferSelect;
export type InsertTenantPortalSession = typeof tenantPortalSessions.$inferInsert;

export type LandlordPortalSession = typeof landlordPortalSessions.$inferSelect;
export type InsertLandlordPortalSession = typeof landlordPortalSessions.$inferInsert;

export type RentalStatement = typeof rentalStatements.$inferSelect;
export type InsertRentalStatement = typeof rentalStatements.$inferInsert;

export type PortfolioReport = typeof portfolioReports.$inferSelect;
export type InsertPortfolioReport = typeof portfolioReports.$inferInsert;

export type TenantNotification = typeof tenantNotifications.$inferSelect;
export type InsertTenantNotification = typeof tenantNotifications.$inferInsert;

// ===============================
// DIASPORA RENT-TO-OWN SYSTEM
// ===============================

// Construction status enum for diaspora projects
export const constructionStatusEnum = pgEnum("construction_status", [
  "planning", "foundation", "structure", "roofing", "finishing", "completed"
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "pending", "processing", "completed", "failed", "refunded", "disputed"
]);

export const certificateStatusEnum = pgEnum("certificate_status", [
  "not_issued", "pending", "issued", "verified", "expired", "revoked"
]);

// Main diaspora rent-to-own contracts table
export const diasporaContracts = pgTable("diaspora_contracts", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  clientName: varchar("client_name").notNull(),
  clientEmail: varchar("client_email").notNull(),
  clientPhone: varchar("client_phone").notNull(),
  clientWhatsapp: varchar("client_whatsapp").notNull(),
  clientCountry: varchar("client_country").notNull(),
  clientAddress: text("client_address"),
  identificationNumber: varchar("identification_number"),
  identificationType: varchar("identification_type"), // passport, national_id, drivers_license
  
  // Financial details
  totalPropertyValue: decimal("total_property_value", { precision: 12, scale: 2 }).notNull(),
  downPayment: decimal("down_payment", { precision: 12, scale: 2 }).notNull(),
  monthlyInstallment: decimal("monthly_installment", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency").notNull().default("KES"),
  paymentFrequency: varchar("payment_frequency").notNull().default("monthly"), // monthly, quarterly, semi_annual
  contractDurationMonths: integer("contract_duration_months").notNull(),
  interestRate: decimal("interest_rate", { precision: 5, scale: 2 }).default("0.00"),
  
  // Payment tracking
  paymentsMade: integer("payments_made").default(0),
  totalPaid: decimal("total_paid", { precision: 12, scale: 2 }).default("0.00"),
  remainingBalance: decimal("remaining_balance", { precision: 12, scale: 2 }).notNull(),
  completionPercentage: decimal("completion_percentage", { precision: 5, scale: 2 }).default("0.00"),
  nextPaymentDue: timestamp("next_payment_due").notNull(),
  
  // Construction and status
  constructionStatus: constructionStatusEnum("construction_status").default("planning"),
  constructionStartDate: timestamp("construction_start_date"),
  expectedCompletionDate: timestamp("expected_completion_date"),
  actualCompletionDate: timestamp("actual_completion_date"),
  
  // Payment method and providers
  paymentMethod: varchar("payment_method").notNull(), // remitly, worldremit, wise, western_union, bank_transfer
  internationalProvider: varchar("international_provider").notNull(),
  localBankAccount: varchar("local_bank_account"),
  
  // Legal and certificates
  contractSignedAt: timestamp("contract_signed_at"),
  legalDocumentUrl: varchar("legal_document_url"),
  digitalCertificateIssued: boolean("digital_certificate_issued").default(false),
  certificateQrCode: varchar("certificate_qr_code"),
  certificateStatus: certificateStatusEnum("certificate_status").default("not_issued"),
  blockchainHash: varchar("blockchain_hash"),
  registryLink: varchar("registry_link"),
  
  // Management
  status: varchar("status").default("active"), // active, suspended, completed, cancelled
  assignedManager: varchar("assigned_manager"),
  // Buyer portal: links this contract to the buyer's user account so they
  // can log in and view their own contract, payments, and construction updates.
  // Set automatically on POST if a user with clientEmail already exists;
  // can also be set/updated via PATCH after inviting the buyer.
  buyerUserId: uuid("buyer_user_id").references(() => users.id),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Diaspora payments tracking
export const diasporaPayments = pgTable("diaspora_payments", {
  id: serial("id").primaryKey(),
  diasporaContractId: integer("diaspora_contract_id").references(() => diasporaContracts.id).notNull(),
  paymentNumber: integer("payment_number").notNull(),
  
  // Payment amounts
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency").notNull(),
  exchangeRate: decimal("exchange_rate", { precision: 10, scale: 6 }),
  originalAmount: decimal("original_amount", { precision: 10, scale: 2 }),
  originalCurrency: varchar("original_currency"),
  
  // Payment details
  paymentDate: timestamp("payment_date").notNull(),
  dueDate: timestamp("due_date").notNull(),
  paymentMethod: varchar("payment_method").notNull(),
  internationalProvider: varchar("international_provider").notNull(),
  providerTransactionId: varchar("provider_transaction_id"),
  
  // Status and fees
  status: paymentStatusEnum("payment_status").default("pending"),
  processingFee: decimal("processing_fee", { precision: 8, scale: 2 }).default("0.00"),
  exchangeFee: decimal("exchange_fee", { precision: 8, scale: 2 }).default("0.00"),
  lateFee: decimal("late_fee", { precision: 8, scale: 2 }).default("0.00"),
  
  // Confirmation and receipts
  receiptUrl: varchar("receipt_url"),
  confirmationCode: varchar("confirmation_code"),
  notes: text("notes"),
  processedBy: uuid("processed_by"),
  processedAt: timestamp("processed_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
});

// Construction progress documentation
export const constructionUpdates = pgTable("construction_updates", {
  id: serial("id").primaryKey(),
  diasporaContractId: integer("diaspora_contract_id").references(() => diasporaContracts.id).notNull(),
  
  // Update details
  updateTitle: varchar("update_title").notNull(),
  updateDescription: text("update_description").notNull(),
  constructionPhase: constructionStatusEnum("construction_phase").notNull(),
  progressPercentage: decimal("progress_percentage", { precision: 5, scale: 2 }).notNull(),
  
  // Media and documentation
  photoUrls: json("photo_urls"), // Array of photo URLs
  videoUrls: json("video_urls"), // Array of video URLs
  documentUrls: json("document_urls"), // Array of document URLs
  
  // Timeline and milestones
  milestoneAchieved: varchar("milestone_achieved"),
  nextMilestone: varchar("next_milestone"),
  estimatedCompletionDate: timestamp("estimated_completion_date"),
  
  // Communication
  notificationSent: boolean("notification_sent").default(false),
  clientNotified: boolean("client_notified").default(false),
  
  // Management
  updatedBy: uuid("updated_by").notNull(),
  approvedBy: uuid("approved_by"),
  approvedAt: timestamp("approved_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
});

// Digital certificates for blockchain verification
export const diasporaCertificates = pgTable("diaspora_certificates", {
  id: serial("id").primaryKey(),
  diasporaContractId: integer("diaspora_contract_id").references(() => diasporaContracts.id).notNull(),
  
  // Certificate details
  certificateNumber: varchar("certificate_number").unique().notNull(),
  certificateType: varchar("certificate_type").notNull(), // ownership, payment, completion
  qrCode: varchar("qr_code").unique().notNull(),
  
  // Blockchain information
  blockchainHash: varchar("blockchain_hash").unique().notNull(),
  blockchainNetwork: varchar("blockchain_network").default("ethereum"),
  transactionHash: varchar("transaction_hash"),
  blockNumber: integer("block_number"),
  
  // Certificate content
  certificateData: jsonb("certificate_data").notNull(), // All certificate information
  verificationUrl: varchar("verification_url").notNull(),
  downloadUrl: varchar("download_url"),
  
  // Status and validity
  status: certificateStatusEnum("certificate_status").default("pending"),
  issuedDate: timestamp("issued_date"),
  expiryDate: timestamp("expiry_date"),
  verifiedAt: timestamp("verified_at"),
  
  // Management
  issuedBy: uuid("issued_by").notNull(),
  verifiedBy: uuid("verified_by"),
  revocationReason: text("revocation_reason"),
  revokedAt: timestamp("revoked_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
});

// Payment schedule and projections
export const diasporaPaymentSchedule = pgTable("diaspora_payment_schedule", {
  id: serial("id").primaryKey(),
  diasporaContractId: integer("diaspora_contract_id").references(() => diasporaContracts.id).notNull(),
  
  // Schedule details
  paymentNumber: integer("payment_number").notNull(),
  scheduledDate: timestamp("scheduled_date").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  
  // Status tracking
  isPaid: boolean("is_paid").default(false),
  paidDate: timestamp("paid_date"),
  diasporaPaymentId: integer("diaspora_payment_id").references(() => diasporaPayments.id),
  
  // Late payment tracking
  daysLate: integer("days_late").default(0),
  lateFeeApplied: decimal("late_fee_applied", { precision: 8, scale: 2 }).default("0.00"),
  
  // Management
  notificationSent: boolean("notification_sent").default(false),
  remindersSent: integer("reminders_sent").default(0),
  lastReminderDate: timestamp("last_reminder_date"),
  
  createdAt: timestamp("created_at").defaultNow(),
});

// Relations for diaspora system
export const diasporaContractsRelations = relations(diasporaContracts, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [diasporaContracts.organizationId],
    references: [organizations.id],
  }),
  property: one(properties, {
    fields: [diasporaContracts.propertyId],
    references: [properties.id],
  }),
  payments: many(diasporaPayments),
  constructionUpdates: many(constructionUpdates),
  certificates: many(diasporaCertificates),
  paymentSchedule: many(diasporaPaymentSchedule),
}));

export const diasporaPaymentsRelations = relations(diasporaPayments, ({ one }) => ({
  contract: one(diasporaContracts, {
    fields: [diasporaPayments.diasporaContractId],
    references: [diasporaContracts.id],
  }),
}));

export const constructionUpdatesRelations = relations(constructionUpdates, ({ one }) => ({
  contract: one(diasporaContracts, {
    fields: [constructionUpdates.diasporaContractId],
    references: [diasporaContracts.id],
  }),
}));

export const diasporaCertificatesRelations = relations(diasporaCertificates, ({ one }) => ({
  contract: one(diasporaContracts, {
    fields: [diasporaCertificates.diasporaContractId],
    references: [diasporaContracts.id],
  }),
}));

export const diasporaPaymentScheduleRelations = relations(diasporaPaymentSchedule, ({ one }) => ({
  contract: one(diasporaContracts, {
    fields: [diasporaPaymentSchedule.diasporaContractId],
    references: [diasporaContracts.id],
  }),
  payment: one(diasporaPayments, {
    fields: [diasporaPaymentSchedule.diasporaPaymentId],
    references: [diasporaPayments.id],
  }),
}));

// Insert schemas for diaspora system
export const insertDiasporaContractSchema = createInsertSchema(diasporaContracts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertDiasporaPaymentSchema = createInsertSchema(diasporaPayments).omit({
  id: true,
  createdAt: true,
});

export const insertConstructionUpdateSchema = createInsertSchema(constructionUpdates).omit({
  id: true,
  createdAt: true,
});

export const insertDiasporaCertificateSchema = createInsertSchema(diasporaCertificates).omit({
  id: true,
  createdAt: true,
});

export const insertDiasporaPaymentScheduleSchema = createInsertSchema(diasporaPaymentSchedule).omit({
  id: true,
  createdAt: true,
});

// Type exports for diaspora system
export type DiasporaContract = typeof diasporaContracts.$inferSelect;
export type InsertDiasporaContract = typeof diasporaContracts.$inferInsert;

export type DiasporaPayment = typeof diasporaPayments.$inferSelect;
export type InsertDiasporaPayment = typeof diasporaPayments.$inferInsert;

export type ConstructionUpdate = typeof constructionUpdates.$inferSelect;
export type InsertConstructionUpdate = typeof constructionUpdates.$inferInsert;

export type DiasporaCertificate = typeof diasporaCertificates.$inferSelect;
export type InsertDiasporaCertificate = typeof diasporaCertificates.$inferInsert;

export type DiasporaPaymentSchedule = typeof diasporaPaymentSchedule.$inferSelect;
export type InsertDiasporaPaymentSchedule = typeof diasporaPaymentSchedule.$inferInsert;

export type PortalCustomization = typeof portalCustomization.$inferSelect;
export type InsertPortalCustomization = typeof portalCustomization.$inferInsert;

export type TenantDocument = typeof tenantDocuments.$inferSelect;
export type InsertTenantDocument = typeof tenantDocuments.$inferInsert;

export type PaymentReceipt = typeof paymentReceipts.$inferSelect;
export type InsertPaymentReceipt = typeof paymentReceipts.$inferInsert;

// Tenant & Landlord Portal Tables
export const tenantPortalSessions = pgTable("tenant_portal_sessions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  sessionToken: varchar("session_token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  lastActivity: timestamp("last_activity").defaultNow(),
  ipAddress: varchar("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const landlordPortalSessions = pgTable("landlord_portal_sessions", {
  id: serial("id").primaryKey(),
 userId: uuid("user_id").notNull().references(() => users.id),
  sessionToken: varchar("session_token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  lastActivity: timestamp("last_activity").defaultNow(),
  ipAddress: varchar("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const rentalStatements = pgTable("rental_statements", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  propertyId: integer("property_id").notNull(),
  unitId: integer("unit_id").notNull(),
  statementPeriod: varchar("statement_period").notNull(), // YYYY-MM format
  statementDate: date("statement_date").notNull(),
  previousBalance: decimal("previous_balance", { precision: 15, scale: 2 }).default("0.00"),
  rentCharged: decimal("rent_charged", { precision: 15, scale: 2 }).notNull(),
  additionalCharges: decimal("additional_charges", { precision: 15, scale: 2 }).default("0.00"),
  paymentsReceived: decimal("payments_received", { precision: 15, scale: 2 }).default("0.00"),
  currentBalance: decimal("current_balance", { precision: 15, scale: 2 }).notNull(),
  dueDate: date("due_date").notNull(),
  currency: varchar("currency").default("USD"),
  status: varchar("status").default("generated"), // generated, sent, viewed, paid
  pdfPath: varchar("pdf_path"),
  chargeBreakdown: jsonb("charge_breakdown"), // detailed breakdown of charges
  paymentHistory: jsonb("payment_history"), // payments made in this period
  createdAt: timestamp("created_at").defaultNow(),
  sentAt: timestamp("sent_at"),
  viewedAt: timestamp("viewed_at"),
});

export const portfolioReports = pgTable("portfolio_reports", {
  id: serial("id").primaryKey(),
  ownerId: uuid("owner_id").notNull(),
  reportType: varchar("report_type").notNull(), // monthly, quarterly, annual, custom
  reportPeriodStart: date("report_period_start").notNull(),
  reportPeriodEnd: date("report_period_end").notNull(),
  propertiesIncluded: integer("properties_included").array(),
  totalRevenue: decimal("total_revenue", { precision: 15, scale: 2 }).default("0.00"),
  totalExpenses: decimal("total_expenses", { precision: 15, scale: 2 }).default("0.00"),
  netIncome: decimal("net_income", { precision: 15, scale: 2 }).default("0.00"),
  occupancyRate: decimal("occupancy_rate", { precision: 5, scale: 2 }),
  summary: jsonb("summary"), // detailed summary data
  reportData: jsonb("report_data"), // full report data
  pdfPath: varchar("pdf_path"),
  status: varchar("status").default("generated"), // generated, downloaded, emailed
  createdAt: timestamp("created_at").defaultNow(),
  downloadedAt: timestamp("downloaded_at"),
});

export const tenantNotifications = pgTable("tenant_notifications", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  notificationType: varchar("notification_type").notNull(), // payment_due, payment_received, maintenance_update, statement_ready
  title: varchar("title").notNull(),
  message: text("message").notNull(),
  channel: varchar("channel").notNull(), // sms, email, portal, push
  scheduledFor: timestamp("scheduled_for").defaultNow(),
  sentAt: timestamp("sent_at"),
  deliveredAt: timestamp("delivered_at"),
  readAt: timestamp("read_at"),
  status: varchar("status").default("pending"), // pending, sent, delivered, read, failed
  recipientInfo: jsonb("recipient_info"), // phone, email, etc.
  metadata: jsonb("metadata"), // additional data like payment amount, etc.
  retryCount: integer("retry_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const portalCustomization = pgTable("portal_customization", {
  id: serial("id").primaryKey(),
  portalType: varchar("portal_type").notNull(), // tenant, landlord
  entityId: varchar("entity_id").notNull(), // tenant_id or user_id
  brandingConfig: jsonb("branding_config"), // colors, logo, theme
  layoutConfig: jsonb("layout_config"), // dashboard layout preferences
  notificationPreferences: jsonb("notification_preferences"), // communication preferences
  features: jsonb("features"), // enabled/disabled features
  customCss: text("custom_css"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const tenantDocuments = pgTable("tenant_documents", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  documentType: varchar("document_type").notNull(), // lease, statement, receipt, notice
  title: varchar("title").notNull(),
  description: text("description"),
  filePath: varchar("file_path").notNull(),
  fileSize: integer("file_size"),
  mimeType: varchar("mime_type"),
  isPublic: boolean("is_public").default(false), // can tenant access this?
  downloadCount: integer("download_count").default(0),
  lastDownloaded: timestamp("last_downloaded"),
  expiresAt: timestamp("expires_at"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const paymentReceipts = pgTable("payment_receipts", {
  id: serial("id").primaryKey(),
  paymentId: integer("payment_id").notNull(),
  tenantId: integer("tenant_id").notNull(),
  receiptNumber: varchar("receipt_number").notNull().unique(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  currency: varchar("currency").default("USD"),
  paymentMethod: varchar("payment_method").notNull(),
  paymentDate: date("payment_date").notNull(),
  description: text("description"),
  pdfPath: varchar("pdf_path"),
  sentViaEmail: boolean("sent_via_email").default(false),
  sentViaSms: boolean("sent_via_sms").default(false),
  emailSentAt: timestamp("email_sent_at"),
  smsSentAt: timestamp("sms_sent_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Types
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// ==================== VISITOR MANAGEMENT MODULE ====================

// Visitors - Guest registration and access management
export const visitors = pgTable("visitors", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").notNull().references(() => properties.id),
  unitId: integer("unit_id").references(() => units.id),
  tenantId: integer("tenant_id").references(() => tenants.id),
  visitorName: varchar("visitor_name").notNull(),
  visitorPhone: varchar("visitor_phone"),
  visitorEmail: varchar("visitor_email"),
  idNumber: varchar("id_number"), // National ID or passport
  company: varchar("company"), // If business visitor
  purposeOfVisit: text("purpose_of_visit").notNull(),
  expectedArrival: timestamp("expected_arrival").notNull(),
  expectedDeparture: timestamp("expected_departure"),
  actualArrival: timestamp("actual_arrival"),
  actualDeparture: timestamp("actual_departure"),
  status: visitorStatusEnum("status").default("pending"),
  approvedBy: uuid("approved_by"), // Security/tenant who approved
  approvedAt: timestamp("approved_at"),
  checkedInBy: uuid("checked_in_by"), // Security guard
  checkedOutBy: uuid("checked_out_by"),
  vehiclePlate: varchar("vehicle_plate"), // If visitor has vehicle
  parkingSpot: varchar("parking_spot"),
  accessCode: varchar("access_code").unique(), // Temporary access code
  notes: text("notes"),
  photoUrl: varchar("photo_url"), // Visitor photo
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Visitor Log - Detailed entry/exit tracking
export const visitorLog = pgTable("visitor_log", {
  id: serial("id").primaryKey(),
  visitorId: integer("visitor_id").notNull().references(() => visitors.id),
  logType: varchar("log_type", { enum: ["check_in", "check_out", "status_change", "approval"] }).notNull(),
  timestamp: timestamp("timestamp").defaultNow(),
  location: varchar("location"), // Gate/entrance used
  securityGuard: varchar("security_guard"), // Guard on duty
  notes: text("notes"),
  photoUrl: varchar("photo_url"), // Photo taken at entry/exit
  createdAt: timestamp("created_at").defaultNow(),
});

// ==================== VEHICLES AND PARKING MANAGEMENT MODULE ====================

// Registered Vehicles - Tenant/visitor vehicles
export const registeredVehicles = pgTable("registered_vehicles", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").notNull().references(() => properties.id),
  ownerId: varchar("owner_id"), // Can be tenant, visitor, or staff
  ownerType: varchar("owner_type", { enum: ["tenant", "visitor", "staff", "contractor", "guest"] }).notNull(),
  plateNumber: varchar("plate_number").unique().notNull(),
  vehicleType: varchar("vehicle_type").notNull(), // car, motorcycle, truck, van, bicycle
  make: varchar("make").notNull(),
  model: varchar("model").notNull(),
  year: integer("year"),
  color: varchar("color").notNull(),
  status: vehicleStatusEnum("status").default("pending_approval"),
  approvedBy: uuid("approved_by"),
  approvedAt: timestamp("approved_at"),
  expiresAt: timestamp("expires_at"), // Registration expiry
  isResident: boolean("is_resident").default(true), // Resident vs visitor vehicle
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Parking Spaces - Individual parking spot management
export const parkingSpaces = pgTable("parking_spaces", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").notNull().references(() => properties.id),
  spaceNumber: varchar("space_number").notNull(),
  floor: varchar("floor"), // Ground, B1, B2, etc.
  section: varchar("section"), // A, B, C zones
  spaceType: varchar("space_type", { enum: ["standard", "compact", "disabled", "electric", "visitor", "reserved"] }).notNull(),
  length: decimal("length", { precision: 5, scale: 2 }),
  width: decimal("width", { precision: 5, scale: 2 }),
  isAvailable: boolean("is_available").default(true),
  isReserved: boolean("is_reserved").default(false),
  reservedFor: varchar("reserved_for"), // Unit number or tenant ID
  monthlyRate: decimal("monthly_rate", { precision: 10, scale: 2 }),
  currency: currencyEnum("currency").default("KES"),
  hasElectricCharging: boolean("has_electric_charging").default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Parking Assignments - Vehicle-space assignments
export const parkingAssignments = pgTable("parking_assignments", {
  id: serial("id").primaryKey(),
  parkingSpaceId: integer("parking_space_id").notNull().references(() => parkingSpaces.id),
  vehicleId: integer("vehicle_id").notNull().references(() => registeredVehicles.id),
  tenantId: integer("tenant_id").references(() => tenants.id),
  assignmentType: varchar("assignment_type", { enum: ["permanent", "temporary", "visitor", "daily"] }).notNull(),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date"),
  monthlyFee: decimal("monthly_fee", { precision: 10, scale: 2 }),
  currency: currencyEnum("currency").default("KES"),
  status: parkingStatusEnum("status").default("active"),
  lastPaymentDate: timestamp("last_payment_date"),
  nextPaymentDue: timestamp("next_payment_due"),
  notes: text("notes"),
  assignedBy: uuid("assigned_by").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ==================== EXPENSE MANAGEMENT & CONTRACTOR MODULE ====================

// Enhanced Property Expenses
export const propertyExpenses = pgTable("property_expenses", {
  id: serial("id").primaryKey(),
  expenseNumber: varchar("expense_number").unique().notNull(),
  propertyId: integer("property_id").notNull().references(() => properties.id),
  contractorId: integer("contractor_id").references(() => contractors.id),
  vendorName: varchar("vendor_name").notNull(),
  description: text("description").notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  currency: currencyEnum("currency").default("KES"),
  category: expenseCategoryEnum("category").notNull(),
  expenseDate: timestamp("expense_date").notNull(),
  dueDate: timestamp("due_date"),
  paymentDate: timestamp("payment_date"),
  status: expenseStatusEnum("status").default("pending"),
  approvedBy: uuid("approved_by"),
  approvedAt: timestamp("approved_at"),
  paymentMethod: varchar("payment_method"), // cash, bank, mpesa, etc
  receiptUrl: varchar("receipt_url"),
  invoiceUrl: varchar("invoice_url"),
  isRecurring: boolean("is_recurring").default(false),
  recurringFrequency: varchar("recurring_frequency"), // monthly, quarterly, annually
  nextRecurringDate: timestamp("next_recurring_date"),
  tags: jsonb("tags"), // JSON array of tags for categorization
  notes: text("notes"),
  // Set automatically when this expense was auto-generated from marking a
  // utility bill paid (see PUT /api/utility-bills/:id) — lets that endpoint
  // check "has an expense already been created for this bill" idempotently,
  // and lets the UI trace an expense back to its source bill.
  utilityBillId: integer("utility_bill_id").references(() => utilityBills.id),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Contractor Services - Enhanced service provider management
export const contractorServices = pgTable("contractor_services", {
  id: serial("id").primaryKey(),
  contractorId: integer("contractor_id").notNull().references(() => contractors.id),
  serviceName: varchar("service_name").notNull(),
  serviceCategory: varchar("service_category").notNull(),
  description: text("description"),
  baseRate: decimal("base_rate", { precision: 10, scale: 2 }),
  currency: currencyEnum("currency").default("KES"),
  rateType: varchar("rate_type", { enum: ["hourly", "fixed", "per_unit", "monthly"] }).notNull(),
  minimumCharge: decimal("minimum_charge", { precision: 10, scale: 2 }),
  isActive: boolean("is_active").default(true),
  estimatedDuration: varchar("estimated_duration"), // e.g., "2-3 hours", "1 day"
  skillLevel: varchar("skill_level", { enum: ["basic", "intermediate", "expert", "specialist"] }).notNull(),
  equipmentProvided: boolean("equipment_provided").default(false),
  materialsIncluded: boolean("materials_included").default(false),
  warrantyPeriod: integer("warranty_period"), // Days
  availabilityHours: jsonb("availability_hours"), // JSON of available hours
  serviceAreas: jsonb("service_areas"), // JSON array of areas served
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Contractor Payments - Payment tracking for contractors
export const contractorPayments = pgTable("contractor_payments", {
  id: serial("id").primaryKey(),
  paymentNumber: varchar("payment_number").unique().notNull(),
  contractorId: integer("contractor_id").notNull().references(() => contractors.id),
  workOrderId: integer("work_order_id").references(() => workOrders.id),
  expenseId: integer("expense_id").references(() => propertyExpenses.id),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  currency: currencyEnum("currency").default("KES"),
  paymentType: varchar("payment_type", { enum: ["advance", "progress", "final", "retention", "bonus"] }).notNull(),
  paymentDate: timestamp("payment_date").notNull(),
  paymentMethod: varchar("payment_method").notNull(), // bank, mpesa, cash, check
  referenceNumber: varchar("reference_number"),
  bankAccount: varchar("bank_account"), // Contractor's bank details
  mpesaNumber: varchar("mpesa_number"),
  description: text("description"),
  taxAmount: decimal("tax_amount", { precision: 10, scale: 2 }),
  netAmount: decimal("net_amount", { precision: 15, scale: 2 }),
  status: varchar("status", { enum: ["pending", "processing", "completed", "failed", "cancelled"] }).default("pending"),
  processedBy: uuid("processed_by"),
  processedAt: timestamp("processed_at"),
  receiptUrl: varchar("receipt_url"),
  notes: text("notes"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Insert schemas for the new modules
export const insertVisitorSchema = createInsertSchema(visitors).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertRegisteredVehicleSchema = createInsertSchema(registeredVehicles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertParkingSpaceSchema = createInsertSchema(parkingSpaces).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertParkingAssignmentSchema = createInsertSchema(parkingAssignments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPropertyExpenseSchema = createInsertSchema(propertyExpenses).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertContractorServiceSchema = createInsertSchema(contractorServices).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertContractorPaymentSchema = createInsertSchema(contractorPayments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Types for the new modules
export type Visitor = typeof visitors.$inferSelect;
export type InsertVisitor = typeof visitors.$inferInsert;
export type RegisteredVehicle = typeof registeredVehicles.$inferSelect;
export type InsertRegisteredVehicle = typeof registeredVehicles.$inferInsert;
export type ParkingSpace = typeof parkingSpaces.$inferSelect;
export type InsertParkingSpace = typeof parkingSpaces.$inferInsert;
export type ParkingAssignment = typeof parkingAssignments.$inferSelect;
export type InsertParkingAssignment = typeof parkingAssignments.$inferInsert;
export type PropertyExpense = typeof propertyExpenses.$inferSelect;
export type InsertPropertyExpense = typeof propertyExpenses.$inferInsert;
export type ContractorService = typeof contractorServices.$inferSelect;
export type InsertContractorService = typeof contractorServices.$inferInsert;
export type ContractorPayment = typeof contractorPayments.$inferSelect;
export type InsertContractorPayment = typeof contractorPayments.$inferInsert;
export type Property = typeof properties.$inferSelect;
export type InsertProperty = typeof properties.$inferInsert;
export type Unit = typeof units.$inferSelect;
export type InsertUnit = typeof units.$inferInsert;
export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = typeof tenants.$inferInsert;
export type RentPayment = typeof rentPayments.$inferSelect;
export type InsertRentPayment = z.infer<typeof insertRentPaymentSchema>;
export type MaintenanceRequest = typeof maintenanceRequests.$inferSelect;
export type InsertMaintenanceRequest = z.infer<typeof insertMaintenanceRequestSchema>;
export type Document = typeof documents.$inferSelect;
export type InsertDocument = typeof documents.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = typeof messages.$inferInsert;
export type Contractor = typeof contractors.$inferSelect;
export type InsertContractor = typeof contractors.$inferInsert;
export type ServiceCharge = typeof serviceCharges.$inferSelect;
export type InsertServiceCharge = typeof serviceCharges.$inferInsert;
export type MpesaTransaction = typeof mpesaTransactions.$inferSelect;
export type InsertMpesaTransaction = typeof mpesaTransactions.$inferInsert;
export type ComplaintsPhoto = typeof complaintsPhotos.$inferSelect;
export type InsertComplaintsPhoto = typeof complaintsPhotos.$inferInsert;
export type InvoiceReminder = typeof invoiceReminders.$inferSelect;
export type InsertInvoiceReminder = typeof invoiceReminders.$inferInsert;

// Project Management Insert Schemas
export const insertProjectSchema = createInsertSchema(projects).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProjectTaskSchema = createInsertSchema(projectTasks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProjectMilestoneSchema = createInsertSchema(projectMilestones).omit({
  id: true,
  createdAt: true,
});

export const insertProjectDocumentSchema = createInsertSchema(projectDocuments).omit({
  id: true,
  createdAt: true,
});

export const insertProjectExpenseSchema = createInsertSchema(projectExpenses).omit({
  id: true,
  createdAt: true,
});

export const insertProjectTeamSchema = createInsertSchema(projectTeam).omit({
  id: true,
});

export const insertProjectTimeTrackingSchema = createInsertSchema(projectTimeTracking).omit({
  id: true,
  createdAt: true,
});

// Work Order Management Insert Schemas
export const insertWorkOrderSchema = createInsertSchema(workOrders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// insertWorkOrderSchemaFixed - use base schema with any cast for date fields
export const insertWorkOrderSchemaFixed = insertWorkOrderSchema as any;


export const insertWorkOrderTaskSchema = createInsertSchema(workOrderTasks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertWorkOrderApprovalSchema = createInsertSchema(workOrderApprovals).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertWorkOrderExpenseSchema = createInsertSchema(workOrderExpenses).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertWorkOrderProgressSchema = createInsertSchema(workOrderProgress).omit({
  id: true,
  createdAt: true,
});

// Project Management Types
export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;
export type ProjectTask = typeof projectTasks.$inferSelect;
export type InsertProjectTask = typeof projectTasks.$inferInsert;
export type ProjectMilestone = typeof projectMilestones.$inferSelect;
export type InsertProjectMilestone = typeof projectMilestones.$inferInsert;
export type ProjectDocument = typeof projectDocuments.$inferSelect;
export type InsertProjectDocument = typeof projectDocuments.$inferInsert;
export type ProjectExpense = typeof projectExpenses.$inferSelect;
export type InsertProjectExpense = typeof projectExpenses.$inferInsert;
export type ProjectTeam = typeof projectTeam.$inferSelect;
export type InsertProjectTeam = typeof projectTeam.$inferInsert;
export type ProjectTimeTracking = typeof projectTimeTracking.$inferSelect;
export type InsertProjectTimeTracking = typeof projectTimeTracking.$inferInsert;

// Work Order Management Types
export type WorkOrder = typeof workOrders.$inferSelect;
export type InsertWorkOrder = typeof workOrders.$inferInsert;
export type InsertWorkOrderCharge = typeof workOrderCharges.$inferInsert; 
export type WorkOrderCharge = typeof workOrderCharges.$inferSelect;
export type InsertWorkOrderMaterial = typeof workOrderMaterials.$inferInsert;
export type WorkOrderMaterial = typeof workOrderMaterials.$inferSelect;

export type InsertWorkOrderTask = typeof workOrderTasks.$inferInsert;
export type WorkOrderApproval = typeof workOrderApprovals.$inferSelect;
export type InsertWorkOrderApproval = typeof workOrderApprovals.$inferInsert;
export type WorkOrderExpense = typeof workOrderExpenses.$inferSelect;
export type InsertWorkOrderExpense = typeof workOrderExpenses.$inferInsert;
export type WorkOrderProgress = typeof workOrderProgress.$inferSelect;
export type InsertWorkOrderProgress = typeof workOrderProgress.$inferInsert;

// ==============================
// AUTOMATED RENT COLLECTION & FINANCIAL PROCESSING
// ==============================

// Payment Integration Providers
export const paymentProviders = pgTable("payment_providers", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  type: varchar("type", { length: 50 }).notNull(), // 'bank', 'mobile_money', 'payment_gateway'
  apiEndpoint: varchar("api_endpoint", { length: 255 }),
  apiKey: text("api_key"), // Encrypted
  apiSecret: text("api_secret"), // Encrypted
  configuration: jsonb("configuration").default('{}'), // Provider-specific config
  isActive: boolean("is_active").default(true),
  supportedCurrencies: text("supported_currencies").array(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Bank Account Integration
export const bankAccounts = pgTable("bank_accounts", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").references(() => paymentProviders.id),
  accountName: varchar("account_name", { length: 100 }).notNull(),
  accountNumber: varchar("account_number", { length: 50 }).notNull(),
  bankCode: varchar("bank_code", { length: 20 }),
  branchCode: varchar("branch_code", { length: 20 }),
  accountType: varchar("account_type", { length: 30 }).notNull(), // 'checking', 'savings', 'business'
  currency: varchar("currency", { length: 3 }).notNull(),
  currentBalance: decimal("current_balance", { precision: 15, scale: 2 }).default('0.00'),
  availableBalance: decimal("available_balance", { precision: 15, scale: 2 }).default('0.00'),
  lastSyncedAt: timestamp("last_synced_at"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Mobile Money Integration (M-PESA, etc.)
export const mobileMoney = pgTable("mobile_money", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").references(() => paymentProviders.id),
  businessShortCode: varchar("business_short_code", { length: 20 }),
  tillNumber: varchar("till_number", { length: 20 }),
  phoneNumber: varchar("phone_number", { length: 20 }).notNull(),
  accountName: varchar("account_name", { length: 100 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  currentBalance: decimal("current_balance", { precision: 15, scale: 2 }).default('0.00'),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Payment Transactions
export const paymentTransactions = pgTable("payment_transactions", {
  id: serial("id").primaryKey(),
  transactionId: varchar("transaction_id", { length: 100 }).unique().notNull(),
  externalTransactionId: varchar("external_transaction_id", { length: 100 }),
  tenantId: integer("tenant_id").references(() => tenants.id),
  propertyId: integer("property_id").references(() => properties.id),
  unitId: integer("unit_id").references(() => units.id),
  providerId: integer("provider_id").references(() => paymentProviders.id),
  paymentMethod: varchar("payment_method", { length: 50 }).notNull(), // 'bank_transfer', 'mpesa', 'card', 'cash'
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  fees: decimal("fees", { precision: 15, scale: 2 }).default('0.00'),
  netAmount: decimal("net_amount", { precision: 15, scale: 2 }).notNull(),
  status: varchar("status", { length: 30 }).notNull(), // 'pending', 'completed', 'failed', 'cancelled'
  paymentType: varchar("payment_type", { length: 50 }).notNull(), // 'rent', 'deposit', 'utilities', 'maintenance'
  description: text("description"),
  receivedAt: timestamp("received_at"),
  processedAt: timestamp("processed_at"),
  reconciledAt: timestamp("reconciled_at"),
  metadata: jsonb("metadata").default('{}'),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Auto-Reconciliation Rules
export const reconciliationRules = pgTable("reconciliation_rules", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  conditions: jsonb("conditions").notNull(), // Matching criteria
  actions: jsonb("actions").notNull(), // Auto-actions to take
  priority: integer("priority").default(1),
  isActive: boolean("is_active").default(true),
  successCount: integer("success_count").default(0),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Payment Allocation Rules
export const paymentAllocationRules = pgTable("payment_allocation_rules", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id),
  propertyId: integer("property_id").references(() => properties.id),
  ruleName: varchar("rule_name", { length: 100 }).notNull(),
  allocationType: varchar("allocation_type", { length: 30 }).notNull(), // 'percentage', 'fixed_amount', 'priority_order'
  allocations: jsonb("allocations").notNull(), // Array of allocation rules
  isDefault: boolean("is_default").default(false),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Escrow Accounts for Properties
export const escrowAccounts = pgTable("escrow_accounts", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").references(() => properties.id),
  accountType: varchar("account_type", { length: 30 }).notNull(), // 'maintenance', 'emergency', 'deposit', 'repairs'
  accountName: varchar("account_name", { length: 100 }).notNull(),
  bankAccountId: integer("bank_account_id").references(() => bankAccounts.id),
  currentBalance: decimal("current_balance", { precision: 15, scale: 2 }).default('0.00'),
  minimumBalance: decimal("minimum_balance", { precision: 15, scale: 2 }).default('0.00'),
  maximumBalance: decimal("maximum_balance", { precision: 15, scale: 2 }),
  currency: varchar("currency", { length: 3 }).notNull(),
  autoTopUp: boolean("auto_top_up").default(false),
  topUpThreshold: decimal("top_up_threshold", { precision: 15, scale: 2 }),
  topUpAmount: decimal("top_up_amount", { precision: 15, scale: 2 }),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Scheduled Disbursements
export const scheduledDisbursements = pgTable("scheduled_disbursements", {
  id: serial("id").primaryKey(),
  disbursementId: varchar("disbursement_id", { length: 100 }).unique().notNull(),
  propertyId: integer("property_id").references(() => properties.id),
  paymentTransactionId: integer("payment_transaction_id").references(() => paymentTransactions.id),
  recipientType: varchar("recipient_type", { length: 30 }).notNull(), // 'landlord', 'vendor', 'contractor', 'management'
  recipientId: varchar("recipient_id", { length: 50 }).notNull(),
  recipientName: varchar("recipient_name", { length: 100 }).notNull(),
  recipientBankAccount: varchar("recipient_bank_account", { length: 50 }),
  recipientMobileNumber: varchar("recipient_mobile_number", { length: 20 }),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  disbursementType: varchar("disbursement_type", { length: 50 }).notNull(), // 'rent_share', 'maintenance_payment', 'vendor_payment'
  scheduledFor: timestamp("scheduled_for").notNull(),
  status: varchar("status", { length: 30 }).notNull(), // 'pending', 'processing', 'completed', 'failed', 'cancelled'
  processedAt: timestamp("processed_at"),
  failureReason: text("failure_reason"),
  retryCount: integer("retry_count").default(0),
  maxRetries: integer("max_retries").default(3),
  metadata: jsonb("metadata").default('{}'),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});


export const ledgerAccounts = pgTable("ledger_accounts", {
  id: serial("id").primaryKey(),
  accountCode: varchar("account_code", { length: 20 }).unique().notNull(),
  accountName: varchar("account_name", { length: 100 }).notNull(),
  accountType: varchar("account_type", { length: 30 }).notNull(),
  accountSubType: varchar("account_sub_type", { length: 50 }),
  parentAccountId: integer("parent_account_id").references((): any => ledgerAccounts.id),
  isActive: boolean("is_active").default(true),
  currentBalance: decimal("current_balance", { precision: 15, scale: 2 }).default("0.00"),
  currency: varchar("currency", { length: 3 }).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});



// Journal Entries
export const journalEntries = pgTable("journal_entries", {
  id: serial("id").primaryKey(),
  entryId: varchar("entry_id", { length: 100 }).unique().notNull(),
  entryDate: timestamp("entry_date").notNull(),
  description: text("description").notNull(),
  reference: varchar("reference", { length: 100 }),
  totalDebit: decimal("total_debit", { precision: 15, scale: 2 }).notNull(),
  totalCredit: decimal("total_credit", { precision: 15, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  status: varchar("status", { length: 20 }).notNull(), // 'draft', 'posted', 'reversed'
  propertyId: integer("property_id").references(() => properties.id),
  tenantId: integer("tenant_id").references(() => tenants.id),
  transactionId: integer("transaction_id").references(() => paymentTransactions.id),
  createdBy: uuid("created_by").notNull(),
  approvedBy: uuid("approved_by"),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Journal Entry Lines
export const journalEntryLines = pgTable("journal_entry_lines", {
  id: serial("id").primaryKey(),
  journalEntryId: integer("journal_entry_id").references(() => journalEntries.id),
  lineNumber: integer("line_number").notNull(),
  accountId: integer("account_id").references(() => ledgerAccounts.id),
  description: text("description"),
  debitAmount: decimal("debit_amount", { precision: 15, scale: 2 }).default('0.00'),
  creditAmount: decimal("credit_amount", { precision: 15, scale: 2 }).default('0.00'),
  currency: varchar("currency", { length: 3 }).notNull(),
  propertyId: integer("property_id").references(() => properties.id),
  tenantId: integer("tenant_id").references(() => tenants.id),
  createdAt: timestamp("created_at").defaultNow(),
});

// Financial Reconciliation
export const financialReconciliation = pgTable("financial_reconciliation", {
  id: serial("id").primaryKey(),
  reconciliationId: varchar("reconciliation_id", { length: 100 }).unique().notNull(),
  bankAccountId: integer("bank_account_id").references(() => bankAccounts.id),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  openingBalance: decimal("opening_balance", { precision: 15, scale: 2 }).notNull(),
  closingBalance: decimal("closing_balance", { precision: 15, scale: 2 }).notNull(),
  totalTransactions: integer("total_transactions").default(0),
  matchedTransactions: integer("matched_transactions").default(0),
  unmatchedTransactions: integer("unmatched_transactions").default(0),
  discrepancies: decimal("discrepancies", { precision: 15, scale: 2 }).default('0.00'),
  status: varchar("status", { length: 30 }).notNull(), // 'in_progress', 'completed', 'failed'
  reconciledBy: uuid("reconciled_by"),
  reconciledAt: timestamp("reconciled_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Automated Payment Rules
export const automatedPaymentRules = pgTable("automated_payment_rules", {
  id: serial("id").primaryKey(),
  ruleName: varchar("rule_name", { length: 100 }).notNull(),
  propertyId: integer("property_id").references(() => properties.id),
  tenantId: integer("tenant_id").references(() => tenants.id),
  triggerType: varchar("trigger_type", { length: 30 }).notNull(), // 'scheduled', 'payment_received', 'amount_threshold'
  triggerConditions: jsonb("trigger_conditions").notNull(),
  actions: jsonb("actions").notNull(), // Array of actions to execute
  schedule: varchar("schedule", { length: 50 }), // Cron expression for scheduled rules
  isActive: boolean("is_active").default(true),
  lastExecuted: timestamp("last_executed"),
  executionCount: integer("execution_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ==============================
// RENT-TO-OWN & PROPERTY OWNERSHIP SYSTEM
// ==============================

// Rent-to-Own Agreements
export const rentToOwnAgreements = pgTable("rent_to_own_agreements", {
  id: serial("id").primaryKey(),
  agreementNumber: varchar("agreement_number", { length: 50 }).unique().notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  agreementType: varchar("agreement_type", { length: 30 }).notNull(), // 'rent_to_own', 'lease_purchase', 'installment_sale'
  
  // Financial Terms
  totalPropertyValue: decimal("total_property_value", { precision: 12, scale: 2 }).notNull(),
  initialDeposit: decimal("initial_deposit", { precision: 12, scale: 2 }).notNull(),
  monthlyPayment: decimal("monthly_payment", { precision: 12, scale: 2 }).notNull(),
  agreementDuration: integer("agreement_duration").notNull(), // months
  interestRate: decimal("interest_rate", { precision: 5, scale: 2 }), // annual percentage
  
  // Payment Tracking
  totalPaid: decimal("total_paid", { precision: 12, scale: 2 }).default("0.00"),
  remainingBalance: decimal("remaining_balance", { precision: 12, scale: 2 }).notNull(),
  nextPaymentDue: timestamp("next_payment_due").notNull(),
  
  // Agreement Status
  status: varchar("status", { length: 20 }).default("active"), // active, completed, defaulted, cancelled
  agreementDate: timestamp("agreement_date").defaultNow(),
  completionDate: timestamp("completion_date"),
  
  // Terms & Conditions
  terms: text("terms"),
  conditions: jsonb("conditions"), // Specific conditions and clauses
  currency: varchar("currency", { length: 3 }).default("USD"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Rent-to-Own Payment Schedule
export const rentToOwnPayments = pgTable("rent_to_own_payments", {
  id: serial("id").primaryKey(),
  agreementId: integer("agreement_id").references(() => rentToOwnAgreements.id).notNull(),
  paymentNumber: integer("payment_number").notNull(), // 1, 2, 3... sequential
  
  // Payment Details
  scheduledAmount: decimal("scheduled_amount", { precision: 12, scale: 2 }).notNull(),
  paidAmount: decimal("paid_amount", { precision: 12, scale: 2 }).default("0.00"),
  principalAmount: decimal("principal_amount", { precision: 12, scale: 2 }).notNull(),
  interestAmount: decimal("interest_amount", { precision: 12, scale: 2 }).default("0.00"),
  
  // Payment Tracking
  dueDate: timestamp("due_date").notNull(),
  paidDate: timestamp("paid_date"),
  status: varchar("status", { length: 20 }).default("pending"), // pending, paid, overdue, partial
  paymentMethod: varchar("payment_method", { length: 30 }),
  transactionId: varchar("transaction_id", { length: 100 }),
  
  // Late Payment Tracking
  lateFees: decimal("late_fees", { precision: 10, scale: 2 }).default("0.00"),
  daysLate: integer("days_late").default(0),
  
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Property Ownership Certificates
export const ownershipCertificates = pgTable("ownership_certificates", {
  id: serial("id").primaryKey(),
  certificateNumber: varchar("certificate_number", { length: 50 }).unique().notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  ownerId: integer("owner_id").references(() => tenants.id).notNull(), // Could be tenant or external owner
  
  // Certificate Details
  ownershipType: varchar("ownership_type", { length: 30 }).notNull(), // 'full', 'partial', 'shared'
  ownershipPercentage: decimal("ownership_percentage", { precision: 5, scale: 2 }).default("100.00"),
  acquisitionType: varchar("acquisition_type", { length: 30 }).notNull(), // 'rent_to_own', 'purchase', 'inheritance', 'transfer'
  
  // Legal Information
  titleDeedNumber: varchar("title_deed_number", { length: 100 }),
  registrationNumber: varchar("registration_number", { length: 100 }),
  legalDescription: text("legal_description"),
  surveyDetails: jsonb("survey_details"),
  
  // Dates
  acquisitionDate: timestamp("acquisition_date").notNull(),
  certificateIssueDate: timestamp("certificate_issue_date").defaultNow(),
  expiryDate: timestamp("expiry_date"), // For certain types of ownership
  
  // Associated Documents
  documents: jsonb("documents"), // Array of document references
  
  // Verification & Compliance
  isVerified: boolean("is_verified").default(false),
  verifiedBy: uuid("verified_by"),
  verificationDate: timestamp("verification_date"),
  complianceStatus: varchar("compliance_status", { length: 20 }).default("pending"),
  
  status: varchar("status", { length: 20 }).default("active"), // active, revoked, expired, transferred
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ==============================
// AIRBNB-STYLE PROPERTY MANAGEMENT
// ==============================

// Property Management Agreements
export const propertyManagementAgreements = pgTable("property_management_agreements", {
  id: serial("id").primaryKey(),
  agreementNumber: varchar("agreement_number", { length: 50 }).unique().notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  ownerId: integer("owner_id").references(() => tenants.id).notNull(), // Property owner
  
  // Management Terms
  managementType: varchar("management_type", { length: 30 }).notNull(), // 'full_service', 'listing_only', 'maintenance_only'
  managementFeeType: varchar("management_fee_type", { length: 20 }).notNull(), // 'percentage', 'fixed', 'per_booking'
  managementFeeRate: decimal("management_fee_rate", { precision: 5, scale: 2 }).notNull(),
  minimumStay: integer("minimum_stay").default(1), // nights
  maximumStay: integer("maximum_stay").default(365), // nights
  
  // Services Included
  servicesIncluded: jsonb("services_included"), // cleaning, maintenance, guest_communication, etc.
  cleaningFee: decimal("cleaning_fee", { precision: 10, scale: 2 }).default("0.00"),
  maintenanceBudget: decimal("maintenance_budget", { precision: 10, scale: 2 }).default("0.00"),
  
  // Agreement Terms
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date"),
  autoRenewal: boolean("auto_renewal").default(true),
  
  // Financial Terms
  ownerPayout: varchar("owner_payout", { length: 20 }).default("monthly"), // daily, weekly, monthly
  currency: varchar("currency", { length: 3 }).default("USD"),
  
  status: varchar("status", { length: 20 }).default("active"), // active, suspended, terminated
  terms: text("terms"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Short-term Rental Bookings
export const shortTermBookings = pgTable("short_term_bookings", {
  id: serial("id").primaryKey(),
  bookingNumber: varchar("booking_number", { length: 50 }).unique().notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  managementAgreementId: integer("management_agreement_id").references(() => propertyManagementAgreements.id),
  
  // Guest Information
  guestName: varchar("guest_name", { length: 100 }).notNull(),
  guestEmail: varchar("guest_email", { length: 100 }).notNull(),
  guestPhone: varchar("guest_phone", { length: 20 }),
  guestCount: integer("guest_count").notNull(),
  
  // Booking Details
  checkInDate: timestamp("check_in_date").notNull(),
  checkOutDate: timestamp("check_out_date").notNull(),
  numberOfNights: integer("number_of_nights").notNull(),
  
  // Pricing
  nightlyRate: decimal("nightly_rate", { precision: 10, scale: 2 }).notNull(),
  totalAmount: decimal("total_amount", { precision: 12, scale: 2 }).notNull(),
  cleaningFee: decimal("cleaning_fee", { precision: 10, scale: 2 }).default("0.00"),
  serviceFee: decimal("service_fee", { precision: 10, scale: 2 }).default("0.00"),
  taxes: decimal("taxes", { precision: 10, scale: 2 }).default("0.00"),
  
  // Management Fees
  managementFee: decimal("management_fee", { precision: 10, scale: 2 }).default("0.00"),
  ownerPayout: decimal("owner_payout", { precision: 12, scale: 2 }).notNull(),
  
  // Booking Status
  status: varchar("status", { length: 20 }).default("confirmed"), // pending, confirmed, checked_in, checked_out, cancelled
  paymentStatus: varchar("payment_status", { length: 20 }).default("pending"), // pending, paid, partial, refunded
  
  // Platform Integration
  platformSource: varchar("platform_source", { length: 30 }), // airbnb, booking.com, direct, etc.
  platformBookingId: varchar("platform_booking_id", { length: 100 }),
  
  // Special Requests & Notes
  specialRequests: text("special_requests"),
  guestNotes: text("guest_notes"),
  internalNotes: text("internal_notes"),
  
  // Check-in/out
  checkInInstructions: text("check_in_instructions"),
  keyLocation: varchar("key_location", { length: 200 }),
  
  currency: varchar("currency", { length: 3 }).default("USD"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Property Availability Calendar
export const propertyAvailability = pgTable("property_availability", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  date: date("date").notNull(),
  
  // Availability Status
  isAvailable: boolean("is_available").default(true),
  availabilityType: varchar("availability_type", { length: 20 }).default("available"), // available, booked, blocked, maintenance
  
  // Pricing
  baseRate: decimal("base_rate", { precision: 10, scale: 2 }),
  seasonalRate: decimal("seasonal_rate", { precision: 10, scale: 2 }),
  finalRate: decimal("final_rate", { precision: 10, scale: 2 }),
  
  // Booking Reference
  bookingId: integer("booking_id").references(() => shortTermBookings.id),
  
  // Special Pricing Rules
  isWeekend: boolean("is_weekend").default(false),
  isHoliday: boolean("is_holiday").default(false),
  seasonType: varchar("season_type", { length: 20 }), // high, low, peak, off
  
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Property Maintenance for Managed Properties
export const managedPropertyMaintenance = pgTable("managed_property_maintenance", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  managementAgreementId: integer("management_agreement_id").references(() => propertyManagementAgreements.id),
  
  // Maintenance Details
  maintenanceType: varchar("maintenance_type", { length: 30 }).notNull(), // routine, emergency, improvement, guest_damage
  description: text("description").notNull(),
  priority: varchar("priority", { length: 10 }).default("medium"), // low, medium, high, emergency
  
  // Scheduling
  scheduledDate: timestamp("scheduled_date"),
  completedDate: timestamp("completed_date"),
  
  // Cost Management
  estimatedCost: decimal("estimated_cost", { precision: 10, scale: 2 }),
  actualCost: decimal("actual_cost", { precision: 10, scale: 2 }),
  approvedBudget: decimal("approved_budget", { precision: 10, scale: 2 }),
  
  // Approval Process
  requiresOwnerApproval: boolean("requires_owner_approval").default(false),
  ownerApprovalStatus: varchar("owner_approval_status", { length: 20 }).default("pending"), // pending, approved, denied
  ownerApprovalDate: timestamp("owner_approval_date"),
  ownerNotes: text("owner_notes"),
  
  // Service Provider
  serviceProvider: varchar("service_provider", { length: 100 }),
  contractorId: integer("contractor_id").references(() => contractors.id),
  
  // Impact on Bookings
  affectsAvailability: boolean("affects_availability").default(false),
  blockedDates: jsonb("blocked_dates"), // Array of dates when property is unavailable
  
  status: varchar("status", { length: 20 }).default("pending"), // pending, scheduled, in_progress, completed, cancelled
  photos: jsonb("photos"), // Before/after photos
  documents: jsonb("documents"), // Invoices, receipts, warranties
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Owner Financial Statements
export const ownerFinancialStatements = pgTable("owner_financial_statements", {
  id: serial("id").primaryKey(),
  statementNumber: varchar("statement_number", { length: 50 }).unique().notNull(),
  ownerId: integer("owner_id").references(() => tenants.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id),
  
  // Statement Period
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  statementType: varchar("statement_type", { length: 20 }).notNull(), // monthly, quarterly, annual
  
  // Revenue Summary
  totalRevenue: decimal("total_revenue", { precision: 12, scale: 2 }).default("0.00"),
  bookingRevenue: decimal("booking_revenue", { precision: 12, scale: 2 }).default("0.00"),
  additionalFees: decimal("additional_fees", { precision: 12, scale: 2 }).default("0.00"),
  
  // Expenses Summary
  totalExpenses: decimal("total_expenses", { precision: 12, scale: 2 }).default("0.00"),
  managementFees: decimal("management_fees", { precision: 12, scale: 2 }).default("0.00"),
  maintenanceCosts: decimal("maintenance_costs", { precision: 12, scale: 2 }).default("0.00"),
  cleaningCosts: decimal("cleaning_costs", { precision: 12, scale: 2 }).default("0.00"),
  utilityCosts: decimal("utility_costs", { precision: 12, scale: 2 }).default("0.00"),
  insuranceCosts: decimal("insurance_costs", { precision: 12, scale: 2 }).default("0.00"),
  taxesPaid: decimal("taxes_paid", { precision: 12, scale: 2 }).default("0.00"),
  
  // Net Income
  netIncome: decimal("net_income", { precision: 12, scale: 2 }).default("0.00"),
  ownerPayout: decimal("owner_payout", { precision: 12, scale: 2 }).default("0.00"),
  
  // Performance Metrics
  occupancyRate: decimal("occupancy_rate", { precision: 5, scale: 2 }), // percentage
  averageDailyRate: decimal("average_daily_rate", { precision: 10, scale: 2 }),
  totalNightsBooked: integer("total_nights_booked").default(0),
  
  // Statement Status
  status: varchar("status", { length: 20 }).default("draft"), // draft, sent, paid
  sentDate: timestamp("sent_date"),
  paidDate: timestamp("paid_date"),
  
  // Detailed Breakdown
  revenueBreakdown: jsonb("revenue_breakdown"),
  expenseBreakdown: jsonb("expense_breakdown"),
  bookingDetails: jsonb("booking_details"),
  
  currency: varchar("currency", { length: 3 }).default("USD"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ==============================
// AUTOMATED RENT COLLECTION INSERT SCHEMAS
// ==============================

export const insertPaymentProviderSchema = createInsertSchema(paymentProviders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertBankAccountSchema = createInsertSchema(bankAccounts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertMobileMoneySchema = createInsertSchema(mobileMoney).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPaymentTransactionSchema = createInsertSchema(paymentTransactions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertReconciliationRuleSchema = createInsertSchema(reconciliationRules).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPaymentAllocationRuleSchema = createInsertSchema(paymentAllocationRules).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertEscrowAccountSchema = createInsertSchema(escrowAccounts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertScheduledDisbursementSchema = createInsertSchema(scheduledDisbursements).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertLedgerAccountSchema = createInsertSchema(ledgerAccounts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertJournalEntrySchema = createInsertSchema(journalEntries).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertJournalEntryLineSchema = createInsertSchema(journalEntryLines).omit({
  id: true,
  createdAt: true,
});

export const insertFinancialReconciliationSchema = createInsertSchema(financialReconciliation).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAutomatedPaymentRuleSchema = createInsertSchema(automatedPaymentRules).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// ==============================
// AUTOMATED RENT COLLECTION TYPES
// ==============================

export type PaymentProvider = typeof paymentProviders.$inferSelect;
export type InsertPaymentProvider = typeof paymentProviders.$inferInsert;
export type BankAccount = typeof bankAccounts.$inferSelect;
export type InsertBankAccount = typeof bankAccounts.$inferInsert;
export type MobileMoney = typeof mobileMoney.$inferSelect;
export type InsertMobileMoney = typeof mobileMoney.$inferInsert;
export type PaymentTransaction = typeof paymentTransactions.$inferSelect;
export type InsertPaymentTransaction = typeof paymentTransactions.$inferInsert;
export type ReconciliationRule = typeof reconciliationRules.$inferSelect;
export type InsertReconciliationRule = typeof reconciliationRules.$inferInsert;
export type PaymentAllocationRule = typeof paymentAllocationRules.$inferSelect;
export type InsertPaymentAllocationRule = typeof paymentAllocationRules.$inferInsert;
export type EscrowAccount = typeof escrowAccounts.$inferSelect;
export type InsertEscrowAccount = typeof escrowAccounts.$inferInsert;
export type ScheduledDisbursement = typeof scheduledDisbursements.$inferSelect;
export type InsertScheduledDisbursement = typeof scheduledDisbursements.$inferInsert;
export type LedgerAccount = typeof ledgerAccounts.$inferSelect;
export type InsertLedgerAccount = typeof ledgerAccounts.$inferInsert;
export type JournalEntry = typeof journalEntries.$inferSelect;
export type InsertJournalEntry = typeof journalEntries.$inferInsert;
export type JournalEntryLine = typeof journalEntryLines.$inferSelect;
export type InsertJournalEntryLine = typeof journalEntryLines.$inferInsert;
export type FinancialReconciliation = typeof financialReconciliation.$inferSelect;
export type InsertFinancialReconciliation = typeof financialReconciliation.$inferInsert;
export type AutomatedPaymentRule = typeof automatedPaymentRules.$inferSelect;
export type InsertAutomatedPaymentRule = typeof automatedPaymentRules.$inferInsert;

// ==============================
// ENTERPRISE FINANCE MODULE SCHEMAS
// ==============================

// Enterprise Finance Module Enums
export const approvalStatusEnum = pgEnum("approval_status", ["draft", "pending_l1", "pending_l2", "pending_md", "approved", "rejected", "cancelled"]);
export const procurementStatusEnum = pgEnum("procurement_status", ["draft", "rfq_sent", "quotes_received", "po_created", "goods_received", "invoice_matched", "payment_approved", "completed"]);
export const expenseTypeEnum = pgEnum("expense_type", ["operational", "capital", "maintenance", "utilities", "travel", "professional_services", "marketing", "insurance", "other"]);
// export const payrollStatusEnum = pgEnum("payroll_status", ["draft", "pending_approval", "approved", "processed", "failed", "cancelled"]);
export const depreciationMethodEnum = pgEnum("depreciation_method", ["straight_line", "declining_balance", "units_of_production", "sum_of_years"]);
export const assetStatusEnum = pgEnum("asset_status", ["active", "maintenance", "disposed", "sold", "written_off"]);

// Chart of Accounts for General Ledger
export const chartOfAccounts = pgTable("chart_of_accounts", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  accountCode: varchar("account_code", { length: 20 }).notNull(),
  accountName: varchar("account_name", { length: 255 }).notNull(),
  accountType: varchar("account_type", { length: 50 }).notNull(), // Assets, Liabilities, Equity, Revenue, Expenses
  parentAccountId: integer("parent_account_id").references((): any => chartOfAccounts.id),
  level: integer("level").default(1),
  isActive: boolean("is_active").default(true),
  normalBalance: varchar("normal_balance", { length: 6 }).notNull(), // 'debit' or 'credit'
  description: text("description"),
  costCenterTracking: boolean("cost_center_tracking").default(false),
  propertyTracking: boolean("property_tracking").default(false),
  unitTracking: boolean("unit_tracking").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow()
});

// Cost Centers for Property/Unit tracking
export const costCenters = pgTable("cost_centers", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  code: varchar("code", { length: 20 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  type: varchar("type", { length: 50 }).notNull(), // 'property', 'unit', 'department', 'project'
  propertyId: integer("property_id").references(() => properties.id),
  unitId: integer("unit_id").references(() => units.id),
  managerId: uuid("manager_id").references(() => users.id),
  budgetAmount: decimal("budget_amount", { precision: 15, scale: 2 }),
  actualSpent: decimal("actual_spent", { precision: 15, scale: 2 }).default('0.00'),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow()
});

// Enhanced General Ledger Entries
export const generalLedger = pgTable("general_ledger", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  transactionId: varchar("transaction_id", { length: 100 }).unique().notNull(),
  journalEntryId: integer("journal_entry_id").references(() => journalEntries.id),
  accountId: integer("account_id").references(() => chartOfAccounts.id).notNull(),
  costCenterId: integer("cost_center_id").references(() => costCenters.id),
  propertyId: integer("property_id").references(() => properties.id),
  unitId: integer("unit_id").references(() => units.id),
  debitAmount: decimal("debit_amount", { precision: 15, scale: 2 }).default('0.00'),
  creditAmount: decimal("credit_amount", { precision: 15, scale: 2 }).default('0.00'),
  description: text("description").notNull(),
  reference: varchar("reference", { length: 100 }),
  transactionDate: timestamp("transaction_date").notNull(),
  fiscalYear: integer("fiscal_year").notNull(),
  fiscalPeriod: integer("fiscal_period").notNull(),
  currency: varchar("currency", { length: 3 }).default("KES"),
  exchangeRate: decimal("exchange_rate", { precision: 10, scale: 6 }).default('1.000000'),
  createdBy: uuid("created_by").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow()
});

// Procurement Management
export const purchaseRequisitions = pgTable("purchase_requisitions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  prNumber: varchar("pr_number", { length: 50 }).unique().notNull(),
  category: varchar("category", { length: 100 }),
  requestorId: uuid("requestor_id").references(() => users.id).notNull(),
  departmentId: integer("department_id"),
  costCenterId: integer("cost_center_id").references(() => costCenters.id),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  justification: text("justification"),
  priority: varchar("priority", { length: 20 }).default("medium"),
  requestedDate: timestamp("requested_date").notNull(),
  requiredDate: timestamp("required_date").notNull(),
  totalAmount: decimal("total_amount", { precision: 15, scale: 2 }),
  currency: varchar("currency", { length: 3 }).default("KES"),
  approvalStatus: approvalStatusEnum("approval_status").default("draft"),
  l1ApproverId: uuid("l1_approver_id").references(() => users.id),
  l1ApprovedAt: timestamp("l1_approved_at"),
  l1Comments: text("l1_comments"),
  l2ApproverId: uuid("l2_approver_id").references(() => users.id),
  l2ApprovedAt: timestamp("l2_approved_at"),
  l2Comments: text("l2_comments"),
  mdApproverId: uuid("md_approver_id").references(() => users.id),
  mdApprovedAt: timestamp("md_approved_at"),
  mdComments: text("md_comments"),
  rejectedReason: text("rejected_reason"),
  attachments: jsonb("attachments").default([]),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow()
});

export const prLineItems = pgTable("pr_line_items", {
  id: serial("id").primaryKey(),
  prId: integer("pr_id").references(() => purchaseRequisitions.id).notNull(),
  itemNumber: integer("item_number").notNull(),
  description: text("description").notNull(),
  specification: text("specification"),
  quantity: decimal("quantity", { precision: 10, scale: 2 }).notNull(),
  unitOfMeasure: varchar("unit_of_measure", { length: 20 }).notNull(),
  estimatedUnitCost: decimal("estimated_unit_cost", { precision: 12, scale: 2 }),
  estimatedTotalCost: decimal("estimated_total_cost", { precision: 15, scale: 2 }),
  accountCodeId: integer("account_code_id").references(() => chartOfAccounts.id),
  costCenterId: integer("cost_center_id").references(() => costCenters.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow()
});

// Purchase Orders
export const purchaseOrders = pgTable("purchase_orders", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  poNumber: varchar("po_number", { length: 50 }).unique().notNull(),
  prId: integer("pr_id").references(() => purchaseRequisitions.id),
  vendorId: integer("vendor_id").notNull(),
  buyerId: uuid("buyer_id").references(() => users.id).notNull(),
  orderDate: timestamp("order_date").notNull(),
  deliveryDate: timestamp("delivery_date"),
  deliveryAddress: text("delivery_address"),
  paymentTerms: varchar("payment_terms", { length: 100 }),
  shippingTerms: varchar("shipping_terms", { length: 100 }),
  subtotal: decimal("subtotal", { precision: 15, scale: 2 }).notNull(),
  taxAmount: decimal("tax_amount", { precision: 15, scale: 2 }).default('0.00'),
  totalAmount: decimal("total_amount", { precision: 15, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).default("KES"),
  status: procurementStatusEnum("status").default("draft"),
  notes: text("notes"),
  attachments: jsonb("attachments").default([]),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow()
});

export const poLineItems = pgTable("po_line_items", {
  id: serial("id").primaryKey(),
  poId: integer("po_id").references(() => purchaseOrders.id).notNull(),
  prLineItemId: integer("pr_line_item_id").references(() => prLineItems.id),
  itemNumber: integer("item_number").notNull(),
  description: text("description").notNull(),
  quantity: decimal("quantity", { precision: 10, scale: 2 }).notNull(),
  unitCost: decimal("unit_cost", { precision: 12, scale: 2 }).notNull(),
  totalCost: decimal("total_cost", { precision: 15, scale: 2 }).notNull(),
  receivedQuantity: decimal("received_quantity", { precision: 10, scale: 2 }).default('0.00'),
  accountCodeId: integer("account_code_id").references(() => chartOfAccounts.id),
  costCenterId: integer("cost_center_id").references(() => costCenters.id),
  createdAt: timestamp("created_at").defaultNow()
});

// Expense Management with OCR
export const expenseReports = pgTable("expense_reports", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
   expenseType: varchar("expense_type", { length: 100 }),
  reportNumber: varchar("report_number", { length: 50 }).unique().notNull(),
  employeeId: uuid("employee_id").references(() => users.id).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  totalAmount: decimal("total_amount", { precision: 15, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).default("KES"),
  submittedDate: timestamp("submitted_date").notNull(),
  approvalStatus: approvalStatusEnum("approval_status").default("draft"),
  l1ApproverId: uuid("l1_approver_id").references(() => users.id),
  l1ApprovedAt: timestamp("l1_approved_at"),
  l1Comments: text("l1_comments"),
  l2ApproverId: uuid("l2_approver_id").references(() => users.id),
  l2ApprovedAt: timestamp("l2_approved_at"),
  l2Comments: text("l2_comments"),
  mdApproverId: uuid("md_approver_id").references(() => users.id),
  mdApprovedAt: timestamp("md_approved_at"),
  mdComments: text("md_comments"),
  rejectedReason: text("rejected_reason"),
  paidDate: timestamp("paid_date"),
  paymentReference: varchar("payment_reference", { length: 100 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow()
});

export const expenseLineItems = pgTable("expense_line_items", {
  id: serial("id").primaryKey(),
  expenseReportId: integer("expense_report_id").references(() => expenseReports.id).notNull(),
  expenseDate: timestamp("expense_date").notNull(),
  expenseType: expenseTypeEnum("expense_type").notNull(),
  description: text("description").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).default("KES"),
  receiptUrl: varchar("receipt_url", { length: 500 }),
  ocrData: jsonb("ocr_data"), // OCR extracted data from receipts
  accountCodeId: integer("account_code_id").references(() => chartOfAccounts.id),
  costCenterId: integer("cost_center_id").references(() => costCenters.id),
  propertyId: integer("property_id").references(() => properties.id),
  unitId: integer("unit_id").references(() => units.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow()
});

// Payroll Management
export const payrollPeriods = pgTable("payroll_periods", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  periodName: varchar("period_name", { length: 100 }).notNull(),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  payDate: timestamp("pay_date").notNull(),
  status: payrollStatusEnum("status").default("pending_approval"),
  totalGrossPay: decimal("total_gross_pay", { precision: 15, scale: 2 }).default('0.00'),
  totalDeductions: decimal("total_deductions", { precision: 15, scale: 2 }).default('0.00'),
  totalNetPay: decimal("total_net_pay", { precision: 15, scale: 2 }).default('0.00'),
  approvedBy: uuid("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  processedBy: uuid("processed_by").references(() => users.id),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  isActive: boolean("is_active").default(false),
  isLocked: boolean("is_locked").default(false),
});

export const payrollEntries = pgTable("payroll_entries", {
  id: serial("id").primaryKey(),
  payrollPeriodId: integer("payroll_period_id").references(() => payrollPeriods.id).notNull(),
  employeeId: uuid("employee_id").references(() => users.id).notNull(),
  basicSalary: decimal("basic_salary", { precision: 12, scale: 2 }).notNull(),
  overtimeHours: decimal("overtime_hours", { precision: 8, scale: 2 }).default('0.00'),
  overtimeRate: decimal("overtime_rate", { precision: 10, scale: 2 }).default('0.00'),
  overtimePay: decimal("overtime_pay", { precision: 12, scale: 2 }).default('0.00'),
  allowances: decimal("allowances", { precision: 12, scale: 2 }).default('0.00'),
  bonuses: decimal("bonuses", { precision: 12, scale: 2 }).default('0.00'),
  grossPay: decimal("gross_pay", { precision: 12, scale: 2 }).notNull(),
  taxDeductions: decimal("tax_deductions", { precision: 12, scale: 2 }).default('0.00'),
  nhifDeductions: decimal("nhif_deductions", { precision: 12, scale: 2 }).default('0.00'),
  nssfDeductions: decimal("nssf_deductions", { precision: 12, scale: 2 }).default('0.00'),
  otherDeductions: decimal("other_deductions", { precision: 12, scale: 2 }).default('0.00'),
  totalDeductions: decimal("total_deductions", { precision: 12, scale: 2 }).default('0.00'),
  netPay: decimal("net_pay", { precision: 12, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).default("KES"),
  paymentMethod: varchar("payment_method", { length: 30 }).default("bank_transfer"),
  bankAccount: varchar("bank_account", { length: 50 }),
  paymentReference: varchar("payment_reference", { length: 100 }),
  status: varchar("status", { length: 20 }).default("pending"),
  createdAt: timestamp("created_at").defaultNow()
});

// Enterprise Finance Insert Schemas
export const insertChartOfAccountsSchema = createInsertSchema(chartOfAccounts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCostCenterSchema = createInsertSchema(costCenters).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertGeneralLedgerSchema = createInsertSchema(generalLedger).omit({
  id: true,
  createdAt: true,
});

export const insertPurchaseRequisitionSchema = createInsertSchema(purchaseRequisitions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPrLineItemSchema = createInsertSchema(prLineItems).omit({
  id: true,
  createdAt: true,
});

export const insertPurchaseOrderSchema = createInsertSchema(purchaseOrders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPoLineItemSchema = createInsertSchema(poLineItems).omit({
  id: true,
  createdAt: true,
});

export const insertExpenseReportSchema = createInsertSchema(expenseReports).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertExpenseLineItemSchema = createInsertSchema(expenseLineItems).omit({
  id: true,
  createdAt: true,
});

export const insertPayrollPeriodSchema = createInsertSchema(payrollPeriods).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPayrollEntrySchema = createInsertSchema(payrollEntries).omit({
  id: true,
  createdAt: true,
});

// Enterprise Finance Types
export type ChartOfAccounts = typeof chartOfAccounts.$inferSelect;
export type InsertChartOfAccounts = typeof chartOfAccounts.$inferInsert;
export type CostCenter = typeof costCenters.$inferSelect;
export type InsertCostCenter = typeof costCenters.$inferInsert;
export type GeneralLedger = typeof generalLedger.$inferSelect;
export type InsertGeneralLedger = typeof generalLedger.$inferInsert;
export type PurchaseRequisition = typeof purchaseRequisitions.$inferSelect;
export type InsertPurchaseRequisition = typeof purchaseRequisitions.$inferInsert;
export type PrLineItem = typeof prLineItems.$inferSelect;
export type InsertPrLineItem = typeof prLineItems.$inferInsert;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type InsertPurchaseOrder = typeof purchaseOrders.$inferInsert;
export type PoLineItem = typeof poLineItems.$inferSelect;
export type InsertPoLineItem = typeof poLineItems.$inferInsert;
export type ExpenseReport = typeof expenseReports.$inferSelect;
export type InsertExpenseReport = typeof expenseReports.$inferInsert;
export type ExpenseLineItem = typeof expenseLineItems.$inferSelect;
export type InsertExpenseLineItem = typeof expenseLineItems.$inferInsert;
export type PayrollPeriod = typeof payrollPeriods.$inferSelect;
export type InsertPayrollPeriod = typeof payrollPeriods.$inferInsert;
export type PayrollEntry = typeof payrollEntries.$inferSelect;
export type InsertPayrollEntry = typeof payrollEntries.$inferInsert;

// ==============================
// RENT-TO-OWN & OWNERSHIP INSERT SCHEMAS
// ==============================

export const insertRentToOwnAgreementSchema = createInsertSchema(rentToOwnAgreements).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertRentToOwnPaymentSchema = createInsertSchema(rentToOwnPayments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertOwnershipCertificateSchema = createInsertSchema(ownershipCertificates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPropertyManagementAgreementSchema = createInsertSchema(propertyManagementAgreements).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertShortTermBookingSchema = createInsertSchema(shortTermBookings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPropertyAvailabilitySchema = createInsertSchema(propertyAvailability).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertManagedPropertyMaintenanceSchema = createInsertSchema(managedPropertyMaintenance).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertOwnerFinancialStatementSchema = createInsertSchema(ownerFinancialStatements).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// ==============================
// RENT-TO-OWN & OWNERSHIP TYPES
// ==============================

export type RentToOwnAgreement = typeof rentToOwnAgreements.$inferSelect;
export type InsertRentToOwnAgreement = typeof rentToOwnAgreements.$inferInsert;
export type RentToOwnPayment = typeof rentToOwnPayments.$inferSelect;
export type InsertRentToOwnPayment = typeof rentToOwnPayments.$inferInsert;
export type OwnershipCertificate = typeof ownershipCertificates.$inferSelect;
export type InsertOwnershipCertificate = typeof ownershipCertificates.$inferInsert;
export type PropertyManagementAgreement = typeof propertyManagementAgreements.$inferSelect;
export type InsertPropertyManagementAgreement = typeof propertyManagementAgreements.$inferInsert;
export type ShortTermBooking = typeof shortTermBookings.$inferSelect;
export type InsertShortTermBooking = typeof shortTermBookings.$inferInsert;
export type PropertyAvailability = typeof propertyAvailability.$inferSelect;
export type InsertPropertyAvailability = typeof propertyAvailability.$inferInsert;
export type ManagedPropertyMaintenance = typeof managedPropertyMaintenance.$inferSelect;
export type InsertManagedPropertyMaintenance = typeof managedPropertyMaintenance.$inferInsert;
export type OwnerFinancialStatement = typeof ownerFinancialStatements.$inferSelect;
export type InsertOwnerFinancialStatement = typeof ownerFinancialStatements.$inferInsert;

// ==============================
// USER MANAGEMENT & ROLES SYSTEM
// ==============================

// User Roles and Permissions
export const userRoles = pgTable("user_roles", {
  id: serial("id").primaryKey(),
  roleName: varchar("role_name", { length: 50 }).notNull().unique(),
  roleDescription: text("role_description"),
  permissions: jsonb("permissions").notNull().default('{}'),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// User Role Assignments
export const userRoleAssignments = pgTable("user_role_assignments", {
  id: serial("id").primaryKey(),
 userId: uuid("user_id").notNull().references(() => users.id),
  roleId: integer("role_id").references(() => userRoles.id),
  propertyId: integer("property_id").references(() => properties.id), // Role can be property-specific
  assignedBy: uuid("assigned_by").notNull(),
  assignedAt: timestamp("assigned_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
  isActive: boolean("is_active").default(true),
});

// Property Managers
export const propertyManagers = pgTable("property_managers", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  employeeId: uuid("employee_id"),
  managementLevel: varchar("management_level", { length: 20 }).notNull(), // 'senior', 'junior', 'regional'
  specializations: text("specializations").array(),
  certifications: jsonb("certifications").default('[]'),
  contactNumber: varchar("contact_number", { length: 20 }),
  emergencyContact: varchar("emergency_contact", { length: 20 }),
  salary: decimal("salary", { precision: 12, scale: 2 }),
  commissionRate: decimal("commission_rate", { precision: 5, scale: 2 }),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  status: varchar("status", { length: 20 }).default('active'),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Caretakers
export const caretakers = pgTable("caretakers", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  employeeId: uuid("employee_id"),
  propertyId: integer("property_id").references(() => properties.id),
  caretakerType: varchar("caretaker_type", { length: 30 }).notNull(), // 'resident', 'visiting', 'security'
  shift: varchar("shift", { length: 20 }), // 'day', 'night', 'rotating'
  skills: text("skills").array(),
  contactNumber: varchar("contact_number", { length: 20 }),
  emergencyContact: varchar("emergency_contact", { length: 20 }),
  salary: decimal("salary", { precision: 12, scale: 2 }),
  accommodationProvided: boolean("accommodation_provided").default(false),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  status: varchar("status", { length: 20 }).default('active'),
  performanceRating: decimal("performance_rating", { precision: 3, scale: 2 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ==============================
// CONTRACTORS MANAGEMENT SYSTEM
// ==============================

// Contractor Categories
export const contractorCategories = pgTable("contractor_categories", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  description: text("description"),
  requiredCertifications: text("required_certifications").array(),
  typicalServices: text("typical_services").array(),
  defaultHourlyRate: integer("default_hourly_rate"),
  defaultDailyRate: integer("default_daily_rate"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});


// Contractors Registry
export const contractorsRegistry = pgTable("contractors_registry", {
  id: serial("id").primaryKey(),
  contractorName: varchar("contractor_name", { length: 100 }).notNull(),
  companyName: varchar("company_name", { length: 100 }),
  categoryId: integer("category_id").references(() => contractorCategories.id),
  contractorType: varchar("contractor_type", { length: 30 }).notNull(), // 'individual', 'company'
  businessRegistration: varchar("business_registration", { length: 50 }),
  taxNumber: varchar("tax_number", { length: 50 }),
  licenseNumber: varchar("license_number", { length: 50 }),
  contactPerson: varchar("contact_person", { length: 100 }),
  phoneNumber: varchar("phone_number", { length: 20 }).notNull(),
  alternatePhone: varchar("alternate_phone", { length: 20 }),
  email: varchar("email", { length: 100 }),
  address: text("address"),
  city: varchar("city", { length: 50 }),
  state: varchar("state", { length: 50 }),
  postalCode: varchar("postal_code", { length: 20 }),
  country: varchar("country", { length: 50 }).default('Kenya'),
  services: text("services").array(),
  certifications: jsonb("certifications").default('[]'),
  insuranceDetails: jsonb("insurance_details").default('{}'),
  rating: decimal("rating", { precision: 3, scale: 2 }).default('0.00'),
  totalJobs: integer("total_jobs").default(0),
  completedJobs: integer("completed_jobs").default(0),
  averageResponseTime: integer("average_response_time"), // in hours
  priceRange: varchar("price_range", { length: 50 }),
  paymentTerms: varchar("payment_terms", { length: 100 }),
  emergencyAvailable: boolean("emergency_available").default(false),
  workingHours: jsonb("working_hours").default('{}'),
  serviceAreas: text("service_areas").array(),
  isVerified: boolean("is_verified").default(false),
  verifiedBy: uuid("verified_by"),
  verificationDate: timestamp("verification_date"),
  status: varchar("status", { length: 20 }).default('active'), // 'active', 'suspended', 'blacklisted'
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Service Contracts
export const serviceContracts = pgTable("service_contracts", {
  id: serial("id").primaryKey(),
  contractNumber: varchar("contract_number", { length: 50 }).notNull().unique(),
  contractorId: integer("contractor_id").references(() => contractors.id),
  propertyId: integer("property_id").references(() => properties.id),
  contractType: varchar("contract_type", { length: 30 }).notNull(), // 'one_time', 'recurring', 'retainer'
  serviceType: varchar("service_type", { length: 50 }).notNull(),
  contractTitle: varchar("contract_title", { length: 200 }).notNull(),
  description: text("description"),
  scope: text("scope"),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date"),
  contractValue: decimal("contract_value", { precision: 12, scale: 2 }),
  currency: varchar("currency", { length: 3 }).default('KES'),
  paymentSchedule: varchar("payment_schedule", { length: 30 }), // 'milestone', 'monthly', 'completion'
  paymentTerms: text("payment_terms"),
  sla: jsonb("sla").default('{}'), // Service Level Agreement
  penaltyClause: text("penalty_clause"),
  terminationClause: text("termination_clause"),
  autoRenewal: boolean("auto_renewal").default(false),
  renewalTerms: text("renewal_terms"),
  status: varchar("status", { length: 20 }).default('draft'), // 'draft', 'active', 'completed', 'terminated'
  signedBy: uuid("signed_by"),
  signedDate: timestamp("signed_date"),
  contractDocument: varchar("contract_document"), // File path
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});


export const bankStatementImports = pgTable("bank_statement_imports", {
  id:                   serial().primaryKey().notNull(),
  organizationId:       integer("organization_id").notNull(),
  bankName:             varchar("bank_name", { length: 60 }).notNull(),
  accountName:          varchar("account_name", { length: 120 }),
  accountNumber:        varchar("account_number", { length: 50 }),
  statementPeriodFrom:  date("statement_period_from"),
  statementPeriodTo:    date("statement_period_to"),
  importedBy:           uuid("imported_by").notNull(),
  rowCount:             integer("row_count").default(0).notNull(),
  matchedCount:         integer("matched_count").default(0).notNull(),
  unmatchedCount:       integer("unmatched_count").default(0).notNull(),
  fileName:             varchar("file_name", { length: 255 }),
  notes:                text(),
  status:               varchar({ length: 20 }).default("pending").notNull(),
  createdAt:            timestamp("created_at", { mode: "string" }).defaultNow(),
  updatedAt:            timestamp("updated_at", { mode: "string" }).defaultNow(),
});
 
export const bankStatementRows = pgTable("bank_statement_rows", {
  id:                    serial().primaryKey().notNull(),
  importId:              integer("import_id").notNull(),
  organizationId:        integer("organization_id").notNull(),
  bankName:              varchar("bank_name", { length: 60 }).notNull(),
  transactionDate:       date("transaction_date").notNull(),
  valueDate:             date("value_date"),
  description:           text(),
  debitAmount:           numeric("debit_amount", { precision: 12, scale: 2 }),
  creditAmount:          numeric("credit_amount", { precision: 12, scale: 2 }),
  amount:                numeric({ precision: 12, scale: 2 }).notNull(),
  currency:              varchar({ length: 3 }).default("KES").notNull(),
  runningBalance:        numeric("running_balance", { precision: 14, scale: 2 }),
  rawReference:          varchar("raw_reference", { length: 255 }),
  parsedReference:       varchar("parsed_reference", { length: 120 }),
  payerName:             varchar("payer_name", { length: 150 }),
  payerAccount:          varchar("payer_account", { length: 50 }),
  matchStatus:           varchar("match_status", { length: 20 }).default("unmatched").notNull(),
  matchedRentPaymentId:  integer("matched_rent_payment_id"),
  matchedBy:             uuid("matched_by"),
  matchedAt:             timestamp("matched_at", { mode: "string" }),
  matchConfidence:       integer("match_confidence"),
  matchMethod:           varchar("match_method", { length: 30 }),
  reconcileNotes:        text("reconcile_notes"),
  createdAt:             timestamp("created_at", { mode: "string" }).defaultNow(),
  updatedAt:             timestamp("updated_at", { mode: "string" }).defaultNow(),
}, (table) => [
  foreignKey({
    columns: [table.importId],
    foreignColumns: [bankStatementImports.id],
    name: "bank_statement_rows_import_id_fk",
  }),
  foreignKey({
    columns: [table.matchedRentPaymentId],
    foreignColumns: [rentPayments.id],
    name: "bank_statement_rows_rent_payment_id_fk",
  }),
]);

// Work Orders for Contractors
export const contractorWorkOrders = pgTable("contractor_work_orders", {
  id: serial("id").primaryKey(),
  workOrderNumber: varchar("work_order_number", { length: 50 }).notNull().unique(),
  contractId: integer("contract_id").references(() => serviceContracts.id),
  contractorId: integer("contractor_id").references(() => contractors.id),
  propertyId: integer("property_id").references(() => properties.id),
  requestedBy: uuid("requested_by").notNull(),
  urgency: varchar("urgency", { length: 20 }).default('medium'), // 'low', 'medium', 'high', 'emergency'
  workType: varchar("work_type", { length: 50 }).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description").notNull(),
  location: text("location"),
  estimatedHours: decimal("estimated_hours", { precision: 8, scale: 2 }),
  estimatedCost: decimal("estimated_cost", { precision: 12, scale: 2 }),
  actualHours: decimal("actual_hours", { precision: 8, scale: 2 }),
  actualCost: decimal("actual_cost", { precision: 12, scale: 2 }),
  currency: varchar("currency", { length: 3 }).default('KES'),
  materialsCost: decimal("materials_cost", { precision: 12, scale: 2 }),
  laborCost: decimal("labor_cost", { precision: 12, scale: 2 }),
  scheduledDate: timestamp("scheduled_date"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  status: varchar("status", { length: 20 }).default('pending'), // 'pending', 'assigned', 'in_progress', 'completed', 'cancelled'
  qualityRating: decimal("quality_rating", { precision: 3, scale: 2 }),
  timelinessRating: decimal("timeliness_rating", { precision: 3, scale: 2 }),
  feedback: text("feedback"),
  workPhotos: text("work_photos").array(),
  invoiceNumber: varchar("invoice_number", { length: 50 }),
  paymentStatus: varchar("payment_status", { length: 20 }).default('pending'),
  paymentDate: timestamp("payment_date"),
  warranty: varchar("warranty", { length: 100 }),
  warrantyExpires: timestamp("warranty_expires"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Contractor Performance Tracking
export const contractorPerformance = pgTable("contractor_performance", {
  id: serial("id").primaryKey(),
  contractorId: integer("contractor_id").references(() => contractors.id),
  evaluationPeriod: varchar("evaluation_period", { length: 20 }).notNull(), // 'monthly', 'quarterly', 'annual'
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  totalJobsAssigned: integer("total_jobs_assigned").default(0),
  totalJobsCompleted: integer("total_jobs_completed").default(0),
  totalJobsCancelled: integer("total_jobs_cancelled").default(0),
  averageCompletionTime: decimal("average_completion_time", { precision: 8, scale: 2 }),
  averageQualityRating: decimal("average_quality_rating", { precision: 3, scale: 2 }),
  averageTimelinessRating: decimal("average_timeliness_rating", { precision: 3, scale: 2 }),
  totalRevenue: decimal("total_revenue", { precision: 12, scale: 2 }),
  averageJobValue: decimal("average_job_value", { precision: 12, scale: 2 }),
  complaintCount: integer("complaint_count").default(0),
  complimentCount: integer("compliment_count").default(0),
  safetyIncidents: integer("safety_incidents").default(0),
  onTimeDeliveryRate: decimal("on_time_delivery_rate", { precision: 5, scale: 2 }),
  customerSatisfactionScore: decimal("customer_satisfaction_score", { precision: 3, scale: 2 }),
  repeatCustomerRate: decimal("repeat_customer_rate", { precision: 5, scale: 2 }),
  responseTimeHours: decimal("response_time_hours", { precision: 6, scale: 2 }),
  costEfficiencyRating: decimal("cost_efficiency_rating", { precision: 3, scale: 2 }),
  innovationScore: decimal("innovation_score", { precision: 3, scale: 2 }),
  communicationRating: decimal("communication_rating", { precision: 3, scale: 2 }),
  overallScore: decimal("overall_score", { precision: 3, scale: 2 }),
  recommendations: text("recommendations"),
  improvementAreas: text("improvement_areas").array(),
  strengths: text("strengths").array(),
  evaluatedBy: uuid("evaluated_by").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Service Schedules (for recurring services)
export const serviceSchedules = pgTable("service_schedules", {
  id: serial("id").primaryKey(),
  scheduleNumber: varchar("schedule_number", { length: 50 }).notNull().unique(),
  contractId: integer("contract_id").references(() => serviceContracts.id),
  contractorId: integer("contractor_id").references(() => contractors.id),
  propertyId: integer("property_id").references(() => properties.id),
  serviceType: varchar("service_type", { length: 50 }).notNull(),
  frequency: varchar("frequency", { length: 20 }).notNull(), // 'daily', 'weekly', 'monthly', 'quarterly'
  dayOfWeek: integer("day_of_week"), // 1-7 for weekly services
  dayOfMonth: integer("day_of_month"), // 1-31 for monthly services
  timeOfDay: varchar("time_of_day", { length: 10 }),
  nextScheduledDate: timestamp("next_scheduled_date"),
  lastServiceDate: timestamp("last_service_date"),
  serviceInstructions: text("service_instructions"),
  accessInstructions: text("access_instructions"),
  specialRequirements: text("special_requirements").array(),
  autoSchedule: boolean("auto_schedule").default(true),
  notifyTenant: boolean("notify_tenant").default(true),
  notifyManager: boolean("notify_manager").default(true),
  requiresAccess: boolean("requires_access").default(true),
  estimatedDuration: integer("estimated_duration"), // in minutes
  serviceCost: decimal("service_cost", { precision: 10, scale: 2 }),
  currency: varchar("currency", { length: 3 }).default('KES'),
  status: varchar("status", { length: 20 }).default('active'), // 'active', 'suspended', 'completed'
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Contractor Reviews and Ratings
export const contractorReviews = pgTable("contractor_reviews", {
  id: serial("id").primaryKey(),
  contractorId: integer("contractor_id").references(() => contractors.id),
  workOrderId: integer("work_order_id").references(() => contractorWorkOrders.id),
  reviewerType: varchar("reviewer_type", { length: 20 }).notNull(), // 'tenant', 'manager', 'owner'
  reviewerId: uuid("reviewer_id").notNull(),
  overallRating: decimal("overall_rating", { precision: 3, scale: 2 }).notNull(),
  qualityRating: decimal("quality_rating", { precision: 3, scale: 2 }),
  timelinessRating: decimal("timeliness_rating", { precision: 3, scale: 2 }),
  communicationRating: decimal("communication_rating", { precision: 3, scale: 2 }),
  professionalismRating: decimal("professionalism_rating", { precision: 3, scale: 2 }),
  valueForMoneyRating: decimal("value_for_money_rating", { precision: 3, scale: 2 }),
  reviewTitle: varchar("review_title", { length: 200 }),
  reviewText: text("review_text"),
  wouldRecommend: boolean("would_recommend"),
  wouldHireAgain: boolean("would_hire_again"),
  reviewPhotos: text("review_photos").array(),
  isVerified: boolean("is_verified").default(false),
  isPublic: boolean("is_public").default(true),
  contractorResponse: text("contractor_response"),
  responseDate: timestamp("response_date"),
  helpfulVotes: integer("helpful_votes").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

// Tenant Reviews and Ratings
export const tenantReviews = pgTable("tenant_reviews", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id),
  unitId: integer("unit_id").references(() => units.id),
  reviewType: varchar("review_type").notNull(), // property, service, maintenance, management
  rating: integer("rating").notNull(), // 1-5 stars
  title: varchar("title"),
  comment: text("comment"),
  status: varchar("status").default("pending"), // pending, approved, rejected
  response: text("response"), // Management response
  responseBy: uuid("response_by").references(() => users.id),
  responseDate: timestamp("response_date"),
  isPublic: boolean("is_public").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const tenantReviewsRelations = relations(tenantReviews, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tenantReviews.tenantId],
    references: [tenants.id],
  }),
  property: one(properties, {
    fields: [tenantReviews.propertyId],
    references: [properties.id],
  }),
  unit: one(units, {
    fields: [tenantReviews.unitId],
    references: [units.id],
  }),
}));

// Zod schemas for user management and contractors
export const insertUserRoleSchema = createInsertSchema(userRoles);
export const insertUserRoleAssignmentSchema = createInsertSchema(userRoleAssignments);
export const insertPropertyManagerSchema = createInsertSchema(propertyManagers);
export const insertCaretakerSchema = createInsertSchema(caretakers);
export const insertContractorCategorySchema = createInsertSchema(contractorCategories);
export const insertContractorsRegistrySchema = createInsertSchema(contractorsRegistry);
export const insertServiceContractSchema = createInsertSchema(serviceContracts);
export const insertContractorWorkOrderSchema = createInsertSchema(contractorWorkOrders);
export const insertContractorPerformanceSchema = createInsertSchema(contractorPerformance);
export const insertServiceScheduleSchema = createInsertSchema(serviceSchedules);
export const insertContractorReviewSchema = createInsertSchema(contractorReviews);
export const insertTenantReviewSchema = createInsertSchema(tenantReviews).omit({ id: true, createdAt: true, updatedAt: true });
export const insertUserFeedbackSchema = createInsertSchema(userFeedback).omit({ id: true, createdAt: true, updatedAt: true });

export type UserRole = typeof userRoles.$inferSelect;
export type InsertUserRole = typeof userRoles.$inferInsert;
export type UserRoleAssignment = typeof userRoleAssignments.$inferSelect;
export type InsertUserRoleAssignment = typeof userRoleAssignments.$inferInsert;
export type PropertyManager = typeof propertyManagers.$inferSelect;
export type InsertPropertyManager = typeof propertyManagers.$inferInsert;
export type Caretaker = typeof caretakers.$inferSelect;
export type InsertCaretaker = typeof caretakers.$inferInsert;
export type ContractorCategory = typeof contractorCategories.$inferSelect;
export type InsertContractorCategory = typeof contractorCategories.$inferInsert;
export type ContractorRegistry = typeof contractorsRegistry.$inferSelect;
export type InsertContractorRegistry = typeof contractorsRegistry.$inferInsert;
export type ServiceContract = typeof serviceContracts.$inferSelect;
export type InsertServiceContract = typeof serviceContracts.$inferInsert;
export type ContractorWorkOrder = typeof contractorWorkOrders.$inferSelect;
export type InsertContractorWorkOrder = typeof contractorWorkOrders.$inferInsert;
export type ContractorPerformance = typeof contractorPerformance.$inferSelect;
export type InsertContractorPerformance = typeof contractorPerformance.$inferInsert;
export type ServiceSchedule = typeof serviceSchedules.$inferSelect;
export type InsertServiceSchedule = typeof serviceSchedules.$inferInsert;
export type ContractorReview = typeof contractorReviews.$inferSelect;
export type InsertContractorReview = typeof contractorReviews.$inferInsert;
export type TenantReview = typeof tenantReviews.$inferSelect;
export type InsertTenantReview = typeof tenantReviews.$inferInsert;
export type ServiceCategory = typeof contractorCategories.$inferSelect;
export type NewServiceCategory = typeof contractorCategories.$inferInsert;



// IoT Devices table - NEW UNIQUE FEATURE
export const iotDevices = pgTable("iot_devices", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  propertyId: integer("property_id").notNull().references(() => properties.id),
  unitId: integer("unit_id").references(() => units.id),
  deviceType: varchar("device_type").notNull(), // smart_lock, thermostat, security_camera, leak_sensor, smart_meter, smoke_detector, motion_sensor
  deviceName: varchar("device_name").notNull(),
  deviceModel: varchar("device_model"),
  macAddress: varchar("mac_address").unique(),
  ipAddress: varchar("ip_address"),
  status: varchar("status").notNull().default("online"), // online, offline, maintenance
  batteryLevel: integer("battery_level"), // 0-100
  firmwareVersion: varchar("firmware_version"),
  lastReading: jsonb("last_reading"), // Device-specific readings
  lastUpdate: timestamp("last_update").defaultNow(),
  alertsCount: integer("alerts_count").default(0),
  monthlySavings: decimal("monthly_savings", { precision: 10, scale: 2 }).default('0'),
  installationDate: timestamp("installation_date").defaultNow(),
  warrantyExpiry: timestamp("warranty_expiry"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Smart Automations table - NEW UNIQUE FEATURE
export const smartAutomations = pgTable("smart_automations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  propertyId: integer("property_id").references(() => properties.id),
  name: varchar("name").notNull(),
  triggerDevice: varchar("trigger_device").notNull(),
  triggerCondition: varchar("trigger_condition").notNull(),
  actions: jsonb("actions").notNull(), // Array of actions to execute
  isActive: boolean("is_active").default(true),
  executionCount: integer("execution_count").default(0),
  lastExecuted: timestamp("last_executed"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Blockchain Transactions table - NEW UNIQUE FEATURE
export const blockchainTransactions = pgTable("blockchain_transactions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  propertyId: integer("property_id").notNull().references(() => properties.id),
  transactionType: varchar("transaction_type").notNull(), // lease_signing, payment, ownership_transfer, maintenance_record, inspection
  hash: varchar("hash").notNull().unique(),
  blockNumber: integer("block_number").notNull(),
  gasUsed: integer("gas_used").notNull(),
  transactionFee: decimal("transaction_fee", { precision: 18, scale: 8 }).notNull(),
  participants: text("participants").array().notNull(),
  dataHash: varchar("data_hash").notNull(),
  verificationLevel: varchar("verification_level").notNull().default("basic"), // basic, enhanced, premium
  status: varchar("status").notNull().default("pending"), // pending, confirmed, failed
  timestamp: timestamp("timestamp").defaultNow(),
});

// Property Blockchain Records table - NEW UNIQUE FEATURE
export const propertyBlockchainRecords = pgTable("property_blockchain_records", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").notNull().references(() => properties.id),
  blockchainId: varchar("blockchain_id").notNull().unique(),
  verificationStatus: varchar("verification_status").notNull().default("pending"), // verified, pending, unverified
  trustScore: decimal("trust_score", { precision: 5, scale: 2 }).default('0'),
  totalTransactions: integer("total_transactions").default(0),
  lastVerified: timestamp("last_verified"),
  ownershipChain: jsonb("ownership_chain"), // Array of ownership history
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Smart Contracts table - NEW UNIQUE FEATURE
export const smartContracts = pgTable("smart_contracts", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  contractType: varchar("contract_type").notNull(), // lease_agreement, payment_escrow, maintenance_sla, insurance_claim
  contractAddress: varchar("contract_address").notNull().unique(),
  propertyId: integer("property_id").notNull().references(() => properties.id),
  parties: text("parties").array().notNull(),
  status: varchar("status").notNull().default("pending"), // active, completed, terminated, pending
  executionCount: integer("execution_count").default(0),
  totalValue: decimal("total_value", { precision: 12, scale: 2 }).notNull(),
  autoExecution: boolean("auto_execution").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// AI Assistant Conversations table - NEW UNIQUE FEATURE
export const aiConversations = pgTable("ai_conversations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  conversationType: varchar("conversation_type").notNull(), // chat, voice, whatsapp
  userMessage: text("user_message").notNull(),
  assistantResponse: text("assistant_response").notNull(),
  actionTaken: jsonb("action_taken"), // JSON describing any actions performed
  language: varchar("language").default("en"),
  confidence: decimal("confidence", { precision: 5, scale: 2 }),
  timestamp: timestamp("timestamp").defaultNow(),
});

// Voice Commands table - NEW UNIQUE FEATURE
export const voiceCommands = pgTable("voice_commands", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  command: text("command").notNull(),
  interpretation: text("interpretation").notNull(),
  action: text("action").notNull(),
  confidence: decimal("confidence", { precision: 5, scale: 2 }).notNull(),
  status: varchar("status").notNull().default("pending"), // completed, pending, failed
  timestamp: timestamp("timestamp").defaultNow(),
});

// AI Predictions table - NEW UNIQUE FEATURE
export const aiPredictions = pgTable("ai_predictions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  predictionType: varchar("prediction_type").notNull(), // tenant_churn, maintenance_failure, revenue_optimization, market_opportunity
  targetEntity: varchar("target_entity").notNull(), // property_id, tenant_id, unit_id
  targetEntityId: varchar("target_entity_id").notNull(),
  title: varchar("title").notNull(),
  description: text("description").notNull(),
  confidence: decimal("confidence", { precision: 5, scale: 2 }).notNull(),
  potentialImpact: varchar("potential_impact").notNull(),
  recommendedAction: text("recommended_action"),
  status: varchar("status").notNull().default("active"), // active, resolved, dismissed
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Insert schemas for unique features
export const insertIoTDeviceSchema = createInsertSchema(iotDevices);
export const insertSmartAutomationSchema = createInsertSchema(smartAutomations);
export const insertBlockchainTransactionSchema = createInsertSchema(blockchainTransactions);
export const insertPropertyBlockchainRecordSchema = createInsertSchema(propertyBlockchainRecords);
export const insertSmartContractSchema = createInsertSchema(smartContracts);
export const insertAIConversationSchema = createInsertSchema(aiConversations);
export const insertVoiceCommandSchema = createInsertSchema(voiceCommands);
export const insertAIPredictionSchema = createInsertSchema(aiPredictions);

// Type exports for new unique features
export type InsertIoTDevice = typeof iotDevices.$inferInsert;
export type IoTDevice = typeof iotDevices.$inferSelect;
export type InsertSmartAutomation = typeof smartAutomations.$inferInsert;
export type SmartAutomation = typeof smartAutomations.$inferSelect;
export type InsertBlockchainTransaction = typeof blockchainTransactions.$inferInsert;
export type BlockchainTransaction = typeof blockchainTransactions.$inferSelect;
export type InsertPropertyBlockchainRecord = typeof propertyBlockchainRecords.$inferInsert;
export type PropertyBlockchainRecord = typeof propertyBlockchainRecords.$inferSelect;
export type InsertSmartContract = typeof smartContracts.$inferInsert;
export type SmartContract = typeof smartContracts.$inferSelect;
export type InsertAIConversation = typeof aiConversations.$inferInsert;
export type AIConversation = typeof aiConversations.$inferSelect;
export type InsertVoiceCommand = typeof voiceCommands.$inferInsert;
export type VoiceCommand = typeof voiceCommands.$inferSelect;
export type InsertAIPrediction = typeof aiPredictions.$inferInsert;
export type AIPrediction = typeof aiPredictions.$inferSelect;

// ── Missing type exports needed by storage.ts ──────────────────────────────
export type WorkOrderTask = typeof workOrderTasks.$inferSelect;
export type InsertBillingCycle = typeof billingCycles.$inferInsert;
export type UserFeedback = typeof userFeedback.$inferSelect;
export type InsertUserFeedback = typeof userFeedback.$inferInsert;
export type BroadcastRecipient = typeof broadcastRecipients.$inferSelect;
export type InsertBroadcastRecipient = typeof broadcastRecipients.$inferInsert;
export type InsertUtilityProvider = typeof utilityProviders.$inferInsert;
export type InsertUtilityAccount = typeof utilityAccounts.$inferInsert;
export type InsertUtilityBill = typeof utilityBills.$inferInsert;
export type InsertRecurringCharge = typeof recurringCharges.$inferInsert;
export type InsertInvoice = typeof invoices.$inferInsert;
// ── WhatsApp message log & templates ─────────────────────────────────────────

export const whatsappMessages = pgTable("whatsapp_messages", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  to: varchar("to", { length: 30 }).notNull(),
  type: varchar("type", { length: 20 }).notNull().default("text"), // text | template | media
  content: text("content").notNull(),
  templateName: varchar("template_name", { length: 100 }),
  status: varchar("status", { length: 20 }).notNull().default("sent"), // sent | delivered | read | failed | attended
  direction: varchar("direction", { length: 10 }).notNull().default("outbound"), // outbound | inbound
  metaMessageId: varchar("meta_message_id", { length: 100 }),
  errorDetail: text("error_detail"),
  sentAt: timestamp("sent_at").defaultNow(),
});

export const whatsappTemplates = pgTable("whatsapp_templates", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  name: varchar("name", { length: 100 }).notNull(),
  category: varchar("category", { length: 50 }).notNull().default("custom"),
  content: text("content").notNull(),
  variables: jsonb("variables").$type<string[]>().default([]),
  status: varchar("status", { length: 20 }).notNull().default("pending"), // pending | active | rejected
  metaTemplateId: varchar("meta_template_id", { length: 100 }),  // ID returned by Meta on submission
  rejectionReason: text("rejection_reason"),                      // populated from Meta webhook on rejection
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertWhatsappMessageSchema = createInsertSchema(whatsappMessages);
export const insertWhatsappTemplateSchema = createInsertSchema(whatsappTemplates);

export type WhatsappMessage = typeof whatsappMessages.$inferSelect;
export type InsertWhatsappMessage = typeof whatsappMessages.$inferInsert;
export type WhatsappTemplate = typeof whatsappTemplates.$inferSelect;
export type InsertWhatsappTemplate = typeof whatsappTemplates.$inferInsert;
// ── Tenant Short-Term Rentals ────────────────────────────────────────────────
// Host-blocked dates for a short-term listing — personal use, maintenance,
// etc. Deliberately keyed by rentalListingId (not propertyId, unlike the
// older propertyAvailability table) so blocking one listing's dates never
// accidentally affects a different listing on the same property.
export const listingBlockedDates = pgTable("listing_blocked_dates", {
  id: serial("id").primaryKey(),
  rentalListingId: integer("rental_listing_id").notNull(),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  reason: varchar("reason", { length: 200 }),
  createdBy: uuid("created_by").references(() => users.id),
  // "manual" (host blocked it directly) vs the external platform a synced
  // block came from — kept distinct so re-syncing can safely replace only
  // its own previously-synced blocks without touching ones the host added
  // by hand.
  source: varchar("source", { length: 20 }).notNull().default("manual"),
  // The external calendar feed this block came from, if synced — lets a
  // re-sync clean up only its own prior blocks, not another feed's.
  externalFeedId: integer("external_feed_id"),
  // The external event's own UID, for idempotent re-syncing — the same
  // Airbnb reservation shouldn't create a duplicate block every time the
  // feed is re-fetched.
  externalEventUid: varchar("external_event_uid", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertListingBlockedDateSchema = createInsertSchema(listingBlockedDates).omit({ id: true, createdAt: true });

// Tracks an external platform's calendar feed URL that a host has added so
// its bookings can be imported as blocked dates here — the other half of
// sync, alongside this listing's own exported feed that platforms read.
export const externalCalendarFeeds = pgTable("external_calendar_feeds", {
  id: serial("id").primaryKey(),
  rentalListingId: integer("rental_listing_id").notNull(),
  platform: varchar("platform", { length: 20 }).notNull(), // airbnb, vrbo, booking, google, other
  feedUrl: text("feed_url").notNull(),
  lastSyncedAt: timestamp("last_synced_at"),
  lastSyncStatus: varchar("last_sync_status", { length: 20 }), // success, error
  lastSyncError: text("last_sync_error"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertExternalCalendarFeedSchema = createInsertSchema(externalCalendarFeeds).omit({
  id: true, createdAt: true, lastSyncedAt: true, lastSyncStatus: true, lastSyncError: true,
});

export const tenantShortRentals = pgTable("tenant_short_rentals", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  unitId: integer("unit_id").references(() => units.id).notNull(),
  // Optional now — a tenant subletting their own leased unit sets this.
  // An owner/manager running a whole property as dedicated short-term
  // rental (no regular tenant at all) leaves this null and sets ownerId
  // instead. Exactly one of the two should be set in practice.
  tenantId: integer("tenant_id").references(() => tenants.id),
  // Set for owner-managed listings — the landlord/manager who created and
  // controls this listing, when there's no tenant behind it.
  ownerId: uuid("owner_id").references(() => users.id),
  listingTitle: varchar("listing_title", { length: 200 }).notNull(),
  description: text("description").notNull().default(""),
  nightlyRate: decimal("nightly_rate", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 10 }).notNull().default("KES"),
  minimumNights: integer("minimum_nights").notNull().default(1),
  maximumNights: integer("maximum_nights").notNull().default(30),
  amenities: jsonb("amenities").$type<string[]>().default([]),
  houseRules: text("house_rules").notNull().default(""),
  checkInTime: varchar("check_in_time", { length: 10 }).notNull().default("14:00"),
  checkOutTime: varchar("check_out_time", { length: 10 }).notNull().default("11:00"),
  listingPhotos: jsonb("listing_photos").$type<string[]>().default([]),
  // Genuine capacity, not cosmetic — used to validate the guest count a
  // booking can actually request, not just displayed. Defaults to a
  // reasonable studio/1BR size; hosts adjust it per listing.
  maxGuests: integer("max_guests").notNull().default(2),
  // Secret token embedded in this listing's public iCal export URL
  // (/api/ical/:listingId/:token.ics) — external platforms like Airbnb
  // fetch a plain URL on a schedule with no custom auth headers, so the
  // token itself is the access control, the same pattern Google Calendar
  // uses for its own "secret address in iCal format" sharing.
  icalExportToken: varchar("ical_export_token", { length: 64 }),
  isActive: boolean("is_active").notNull().default(true),
  // Separate from isActive — controls whether this listing appears in the
  // cross-organisation public marketplace search. A listing can be active
  // and bookable via its own direct link without opting into the shared
  // marketplace (e.g. a client who doesn't want to appear alongside
  // others'  listings for their own business reasons).
  isPubliclyListed: boolean("is_publicly_listed").notNull().default(false),
  // Unique, URL-safe identifier for this listing's dedicated public page
  // (e.g. /stay/kings-barini-westlands) — usable as a direct share link
  // whether or not isPubliclyListed is also true.
  slug: varchar("slug", { length: 120 }).unique(),
  approvalStatus: varchar("approval_status", { length: 20 }).notNull().default("pending"), // pending, approved, rejected
  approvedBy: varchar("approved_by", { length: 100 }),
  approvedAt: timestamp("approved_at"),
  // Relevant specifically for tenant-created sublets — the actual property
  // owner carries real liability for what happens in their unit and should
  // never find out about a sublet listing after the fact. landlordNotifiedAt
  // tracks when the automatic heads-up email actually went out; the
  // consent flag is a separate, explicit admin/manager confirmation during
  // approval — an email having been sent isn't the same as someone having
  // actually verified the landlord is aware and not objecting.
  landlordNotifiedAt: timestamp("landlord_notified_at"),
  landlordConsentConfirmed: boolean("landlord_consent_confirmed").notNull().default(false),
  calendarSyncEnabled: boolean("calendar_sync_enabled").notNull().default(false),
  autoPricingEnabled: boolean("auto_pricing_enabled").notNull().default(false),
  instantBookingEnabled: boolean("instant_booking_enabled").notNull().default(false),
  propertyManagerCommission: decimal("property_manager_commission", { precision: 5, scale: 2 }).notNull().default("10.00"),
  tenantEarningsShare: decimal("tenant_earnings_share", { precision: 5, scale: 2 }).notNull().default("80.00"),
  platformFees: decimal("platform_fees", { precision: 5, scale: 2 }).notNull().default("10.00"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertTenantShortRentalSchema = createInsertSchema(tenantShortRentals).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type TenantShortRental = typeof tenantShortRentals.$inferSelect;
export type InsertTenantShortRental = typeof tenantShortRentals.$inferInsert;

// ── Tenant Short-Term Bookings ───────────────────────────────────────────────
export const tenantShortBookings = pgTable("tenant_short_bookings", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  rentalListingId: integer("rental_listing_id").references(() => tenantShortRentals.id).notNull(),
  bookingReference: varchar("booking_reference", { length: 50 }).unique().notNull(),
  guestName: varchar("guest_name", { length: 100 }).notNull(),
  guestEmail: varchar("guest_email", { length: 100 }).notNull(),
  guestPhone: varchar("guest_phone", { length: 20 }).notNull().default(""),
  guestCount: integer("guest_count").notNull().default(1),
  checkInDate: timestamp("check_in_date").notNull(),
  checkOutDate: timestamp("check_out_date").notNull(),
  numberOfNights: integer("number_of_nights").notNull(),
  nightlyRate: decimal("nightly_rate", { precision: 10, scale: 2 }).notNull(),
  totalAmount: decimal("total_amount", { precision: 12, scale: 2 }).notNull(),
  cleaningFee: decimal("cleaning_fee", { precision: 10, scale: 2 }).notNull().default("0.00"),
  platformFees: decimal("platform_fees", { precision: 10, scale: 2 }).notNull().default("0.00"),
  propertyManagerCommission: decimal("property_manager_commission", { precision: 10, scale: 2 }).notNull().default("0.00"),
  tenantPayout: decimal("tenant_payout", { precision: 12, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 10 }).notNull().default("KES"),
  bookingStatus: varchar("booking_status", { length: 20 }).notNull().default("confirmed"), // pending, confirmed, checked_in, checked_out, cancelled
  paymentStatus: varchar("payment_status", { length: 20 }).notNull().default("pending"), // pending, paid, partial, refunded, failed
  // Real refund tracking, not fake automation — a genuine M-Pesa B2C refund
  // needs a security credential encrypted with Safaricom's own certificate,
  // which isn't something this system can generate or fabricate safely.
  // This tracks that a refund is owed, notifies the right people, and
  // records who actually sent it and when, rather than silently letting a
  // cancelled, paid booking's money just disappear with no trail at all.
  refundStatus: varchar("refund_status", { length: 20 }).notNull().default("none"), // none, owed, completed
  refundAmount: decimal("refund_amount", { precision: 10, scale: 2 }),
  refundedBy: uuid("refunded_by").references(() => users.id),
  refundedAt: timestamp("refunded_at"),
  refundNotes: text("refund_notes"),
  platformSource: varchar("platform_source", { length: 30 }).notNull().default("direct"), // airbnb, booking.com, direct
  specialRequests: text("special_requests"),
  checkInCode: varchar("check_in_code", { length: 20 }),
  securityDeposit: decimal("security_deposit", { precision: 10, scale: 2 }).notNull().default("0.00"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertTenantShortBookingSchema = createInsertSchema(tenantShortBookings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type TenantShortBooking = typeof tenantShortBookings.$inferSelect;
export type InsertTenantShortBooking = typeof tenantShortBookings.$inferInsert;

// ── WhatsApp thread read receipts ─────────────────────────────────────────────
// Tracks which operator (user) last read each conversation thread.
// One row per (userId, phone) pair — upserted on every thread open.
// Persists across refreshes and syncs across devices via WebSocket.
export const whatsappThreadReads = pgTable(
  "whatsapp_thread_reads",
  {
    id:          serial("id").primaryKey(),
    userId:      uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    orgId:       integer("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    phone:       varchar("phone", { length: 30 }).notNull(),
    lastReadAt:  timestamp("last_read_at").defaultNow().notNull(),
  },
  (t) => ({
    uniqUserPhone: uniqueIndex("whatsapp_thread_reads_user_phone_uniq").on(t.userId, t.phone),
  })
);

export type WhatsappThreadRead = typeof whatsappThreadReads.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════
// LEASE LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * leases — the canonical record for a tenancy agreement.
 *
 * One active lease per tenant at a time. Previous leases are retained for
 * the audit trail. Renewal creates a NEW lease row (leaseNumber increments)
 * and updates tenants.leaseStartDate / leaseEndDate as a denormalised cache.
 *
 * Status flow:
 *   draft → pending_signature → active → renewed | expired | terminated
 *
 * Escalation:
 *   escalationRate (e.g. 0.10 for 10%) applied annually on each renewal.
 *   newMonthlyRent = currentMonthlyRent × (1 + escalationRate)
 *   Kenyan market standard: 10 % p.a. — default reflects this.
 */
export const leases = pgTable("leases", {
  id:                serial("id").primaryKey(),
  organizationId:    integer("organization_id").notNull().references(() => organizations.id),
  tenantId:          integer("tenant_id").notNull().references(() => tenants.id),
  unitId:            integer("unit_id").references(() => units.id),
  propertyId:        integer("property_id").references(() => properties.id),

  leaseNumber:       varchar("lease_number", { length: 30 }).notNull().unique(), // LSE-2024-001
  previousLeaseId:   integer("previous_lease_id"),                               // FK to leases.id (set on renewal)

  // Term
  startDate:         date("start_date").notNull(),
  endDate:           date("end_date").notNull(),
  leaseDurationMonths: integer("lease_duration_months").notNull().default(12),

  // Financial
  monthlyRent:       decimal("monthly_rent",    { precision: 12, scale: 2 }).notNull(),
  currency:          varchar("currency",        { length: 3 }).notNull().default("KES"),
  securityDeposit:   decimal("security_deposit",{ precision: 12, scale: 2 }).notNull().default("0"),
  depositPaidDate:   date("deposit_paid_date"),

  // Commercial rent structure. "fixed" (default) is the existing flat
  // monthlyRent behaviour. "percentage_of_sales" and "base_plus_percentage"
  // are turnover rent, standard for mall anchor/specialty retail leases:
  // the tenant pays percentageRentRate × their reported monthly sales,
  // either instead of (percentage_of_sales) or on top of (base_plus_percentage)
  // the base monthlyRent above.
  rentStructure:      varchar("rent_structure", { enum: ["fixed", "percentage_of_sales", "base_plus_percentage"] }).notNull().default("fixed"),
  percentageRentRate: decimal("percentage_rent_rate", { precision: 5, scale: 4 }), // e.g. 0.0600 = 6% of sales

  // Escalation
  escalationRate:    decimal("escalation_rate", { precision: 5, scale: 4 }).notNull().default("0.1000"), // 10%
  escalationFrequencyMonths: integer("escalation_frequency_months").notNull().default(12),

  // Status & signing
  status:            varchar("status", { length: 30 }).notNull().default("draft"),
  // draft | pending_signature | active | renewed | expired | terminated

  // Digital signature fields
  signedByTenantAt:  timestamp("signed_by_tenant_at"),
  signedByManagerAt: timestamp("signed_by_manager_at"),
  tenantSignatureIp: varchar("tenant_signature_ip", { length: 45 }),
  managerSignatureIp:varchar("manager_signature_ip",{ length: 45 }),

  // Renewal tracking
  renewalNotice30Sent:  boolean("renewal_notice_30_sent").default(false),
  renewalNotice60Sent:  boolean("renewal_notice_60_sent").default(false),
  renewalNotice90Sent:  boolean("renewal_notice_90_sent").default(false),

  // Document reference
  documentUrl:       varchar("document_url"),        // uploaded signed PDF

  // Free-text terms
  specialConditions: text("special_conditions"),
  notes:             text("notes"),

  createdBy:         uuid("created_by").references(() => users.id),
  createdAt:         timestamp("created_at").defaultNow(),
  updatedAt:         timestamp("updated_at").defaultNow(),
});

export const insertLeaseSchema = createInsertSchema(leases).omit({
  id: true, createdAt: true, updatedAt: true,
  renewalNotice30Sent: true, renewalNotice60Sent: true, renewalNotice90Sent: true,
});
export type Lease = typeof leases.$inferSelect;
export type InsertLease = typeof leases.$inferInsert;

// ── Lease event log (immutable audit trail) ────────────────────────────────

/**
 * leaseEvents — append-only audit log for every significant lease action.
 *
 * Never updated or deleted. Rows are written by the server, not by the UI.
 * eventType values:
 *   created | sent_for_signing | signed_tenant | signed_manager | activated |
 *   renewed | escalation_applied | deposit_received | deposit_refunded |
 *   deposit_partial_refund | terminated | notice_sent | document_uploaded
 */
export const leaseEvents = pgTable("lease_events", {
  id:          serial("id").primaryKey(),
  leaseId:     integer("lease_id").notNull().references(() => leases.id),
  tenantId:    integer("tenant_id").notNull().references(() => tenants.id),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),

  eventType:   varchar("event_type", { length: 50 }).notNull(),
  description: text("description").notNull(),
  performedBy: uuid("performed_by").references(() => users.id),  // null = system
  metadata:    jsonb("metadata").default({}),                     // e.g. { oldRent, newRent, escalationRate }

  ipAddress:   varchar("ip_address", { length: 45 }),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});

export type LeaseEvent = typeof leaseEvents.$inferSelect;

// ── Deposit transactions (deposit ledger) ─────────────────────────────────

/**
 * depositTransactions — every movement of the security deposit.
 *
 * transactionType values:
 *   received | refunded | partial_refund | forfeited | adjustment
 *
 * A deposit ledger lets managers track:
 *   - When the deposit was received and how much
 *   - What was deducted (damage, unpaid rent) at move-out
 *   - What was refunded and when
 *   - The remaining balance at any point in time
 */
export const depositTransactions = pgTable("deposit_transactions", {
  id:              serial("id").primaryKey(),
  leaseId:         integer("lease_id").notNull().references(() => leases.id),
  tenantId:        integer("tenant_id").notNull().references(() => tenants.id),
  organizationId:  integer("organization_id").notNull().references(() => organizations.id),

  transactionType: varchar("transaction_type", { length: 30 }).notNull(),
  amount:          decimal("amount", { precision: 12, scale: 2 }).notNull(),
  currency:        varchar("currency", { length: 3 }).notNull().default("KES"),
  balanceAfter:    decimal("balance_after", { precision: 12, scale: 2 }).notNull(),

  reason:          text("reason"),                                // e.g. "Damage to bathroom tiles"
  reference:       varchar("reference", { length: 100 }),        // payment ref / receipt number
  performedBy:     uuid("performed_by").references(() => users.id),

  transactionDate: date("transaction_date").notNull(),
  createdAt:       timestamp("created_at").defaultNow(),
});

export const insertDepositTransactionSchema = createInsertSchema(depositTransactions).omit({
  id: true, createdAt: true,
});
export type DepositTransaction = typeof depositTransactions.$inferSelect;
export type InsertDepositTransaction = typeof depositTransactions.$inferInsert;


// ═══════════════════════════════════════════════════════════════════════════
// EXCHANGE RATE CACHE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * fxRateCache — stores the last fetched rate for each currency pair.
 *
 * We cache rates server-side for two reasons:
 *  1. Frankfurter (our free rate source) has a rate limit — we don't want
 *     every page load hitting it directly.
 *  2. Compliance: every diaspora payment must record the exact rate that was
 *     fetched at the time of recording, not a rate fetched later. The cache
 *     provides the "at time of recording" snapshot.
 *
 * Cache TTL: 4 hours in production, 15 minutes for stale-while-revalidate.
 * Rates are fetched from Frankfurter (ECB-backed) and supplemented with
 * CBK (Central Bank of Kenya) data for KES pairs when available.
 */
export const fxRateCache = pgTable("fx_rate_cache", {
  id:           serial("id").primaryKey(),
  fromCurrency: varchar("from_currency", { length: 3 }).notNull(),
  toCurrency:   varchar("to_currency",   { length: 3 }).notNull(),
  midMarketRate: decimal("mid_market_rate", { precision: 16, scale: 6 }).notNull(),
  source:       varchar("source", { length: 50 }).notNull().default("frankfurter"),
  fetchedAt:    timestamp("fetched_at").defaultNow().notNull(),
  expiresAt:    timestamp("expires_at").notNull(),
});

export type FxRateCache = typeof fxRateCache.$inferSelect;

// ─── Diaspora payment disbursement columns ───────────────────────────────────
// These fields are intentionally NOT on the base diasporaPayments table
// (which already exists in production). They are added by the migration below.
//
// Fields added:
//   mid_market_rate    — ECB/Frankfurter rate at time of recording (audit)
//   spread_pct         — (exchangeRate - midMarketRate) / midMarketRate × 100
//   kes_disbursed      — amount actually paid to property owner after all fees
//   disbursement_ref   — local bank transfer reference
//   disbursed_at       — timestamp of KES disbursement to owner
//   fx_source          — which rate provider was used (frankfurter / manual / cbk)
//
// The compliance receipt is computed from:
//   originalAmount (sent) → exchangeRate (applied) → amount (KES received)
//   → processingFee + exchangeFee → kesDisbursed (to owner)
//   Spread = (exchangeRate / midMarketRate - 1) × 100 %


// ═══════════════════════════════════════════════════════════════════════════
// NAIROBI COMPLIANCE MODULE
// Added for mid-to-high-end Nairobi market (ARMA, KRA, stamp duty, CGT,
// security deposit interest law).
// ═══════════════════════════════════════════════════════════════════════════

// ─── 1. SERVICE CHARGE ACCOUNTING (ARMA) ────────────────────────────────────

export const serviceChargeBudgets = pgTable("service_charge_budgets", {
  id:              serial("id").primaryKey(),
  organizationId:  integer("organization_id").notNull().references(() => organizations.id),
  propertyId:      integer("property_id").notNull().references(() => properties.id),
  financialYear:   integer("financial_year").notNull(),
  fyStartMonth:    integer("fy_start_month").notNull().default(1),  // 1=Jan, 4=Apr, etc.
  // How each demand run (below) splits the period's total across units:
  // "equal_split" (default, existing behaviour) — same amount per occupied
  // unit; fine when units are similarly sized (e.g. residential apartments).
  // "pro_rata_sqft" — each unit's share is proportional to its sqft ÷ total
  // occupied sqft on the property; the standard method for mall/commercial
  // common-area-maintenance (CAM) cost recovery where unit sizes vary a lot.
  allocationMethod: varchar("allocation_method", { enum: ["equal_split", "pro_rata_sqft"] }).notNull().default("equal_split"),
  totalBudget:     decimal("total_budget", { precision: 12, scale: 2 }).notNull().default("0"),
  fixedBudget:     decimal("fixed_budget",  { precision: 12, scale: 2 }).notNull().default("0"),
  variableBudget:  decimal("variable_budget",{ precision: 12, scale: 2 }).notNull().default("0"),
  sinkingFundBudget: decimal("sinking_fund_budget", { precision: 12, scale: 2 }).notNull().default("0"),
  fixedActual:     decimal("fixed_actual",  { precision: 12, scale: 2 }).notNull().default("0"),
  variableActual:  decimal("variable_actual",{ precision: 12, scale: 2 }).notNull().default("0"),
  sinkingFundActual: decimal("sinking_fund_actual", { precision: 12, scale: 2 }).notNull().default("0"),
  status:          varchar("status", { length: 20 }).default("draft"),
  approvedBy:      uuid("approved_by").references(() => users.id),
  approvedAt:      timestamp("approved_at"),
  notes:           text("notes"),
  createdAt:       timestamp("created_at").defaultNow(),
  updatedAt:       timestamp("updated_at").defaultNow(),
});

export const sinkingFundTransactions = pgTable("sinking_fund_transactions", {
  id:              serial("id").primaryKey(),
  organizationId:  integer("organization_id").notNull().references(() => organizations.id),
  propertyId:      integer("property_id").notNull().references(() => properties.id),
  transactionDate: date("transaction_date").notNull(),
  transactionType: varchar("transaction_type", { length: 30 }).notNull(),
  // contribution | expenditure | interest | adjustment
  amount:          decimal("amount", { precision: 12, scale: 2 }).notNull(),
  balanceAfter:    decimal("balance_after", { precision: 12, scale: 2 }).notNull(),
  description:     text("description").notNull(),
  reference:       varchar("reference", { length: 100 }),
  approvedBy:      uuid("approved_by").references(() => users.id),
  createdAt:       timestamp("created_at").defaultNow(),
});

export const serviceChargeDemands = pgTable("service_charge_demands", {
  id:              serial("id").primaryKey(),
  organizationId:  integer("organization_id").notNull().references(() => organizations.id),
  propertyId:      integer("property_id").notNull().references(() => properties.id),
  unitId:          integer("unit_id").references(() => units.id),
  tenantId:        integer("tenant_id").references(() => tenants.id),
  demandNumber:    varchar("demand_number", { length: 30 }).notNull().unique(),
  periodStart:     date("period_start").notNull(),
  periodEnd:       date("period_end").notNull(),
  // How this specific demand's share was calculated — carried over from the
  // budget's allocationMethod at generation time so it stays accurate even
  // if the budget's method is changed later. allocatedSqft/totalSqft are only
  // populated for pro_rata_sqft, kept for audit/dispute transparency.
  allocationMethod: varchar("allocation_method", { enum: ["equal_split", "pro_rata_sqft"] }).notNull().default("equal_split"),
  allocatedSqft:   integer("allocated_sqft"),
  totalSqft:       integer("total_sqft"),
  fixedAmount:     decimal("fixed_amount",   { precision: 12, scale: 2 }).notNull().default("0"),
  variableAmount:  decimal("variable_amount",{ precision: 12, scale: 2 }).notNull().default("0"),
  sinkingFundAmount: decimal("sinking_fund_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  totalAmount:     decimal("total_amount",   { precision: 12, scale: 2 }).notNull(),
  dueDate:         date("due_date").notNull(),
  status:          varchar("status", { length: 20 }).default("pending"),
  // pending | paid | partial | overdue
  paidAmount:      decimal("paid_amount", { precision: 12, scale: 2 }).default("0"),
  paidDate:        date("paid_date"),
  notes:           text("notes"),
  createdAt:       timestamp("created_at").defaultNow(),
});

export const insertServiceChargeBudgetSchema  = createInsertSchema(serviceChargeBudgets).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSinkingFundTxSchema        = createInsertSchema(sinkingFundTransactions).omit({ id: true, createdAt: true });
export const insertServiceChargeDemandSchema  = createInsertSchema(serviceChargeDemands).omit({ id: true, createdAt: true });

export type ServiceChargeBudget   = typeof serviceChargeBudgets.$inferSelect;
export type SinkingFundTransaction = typeof sinkingFundTransactions.$inferSelect;
export type ServiceChargeDemand   = typeof serviceChargeDemands.$inferSelect;

// ─── 2. KRA COMPLIANCE ──────────────────────────────────────────────────────

export const landlordKraProfiles = pgTable("landlord_kra_profiles", {
  id:                  serial("id").primaryKey(),
  organizationId:      integer("organization_id").notNull().references(() => organizations.id),
  userId:              uuid("user_id").notNull().references(() => users.id).unique(),
  kraPin:              varchar("kra_pin", { length: 20 }),
  pinCertificateUrl:   varchar("pin_certificate_url", { length: 500 }),
  pinVerifiedAt:       date("pin_verified_at"),
  whtRate:             decimal("wht_rate", { precision: 5, scale: 2 }).default("10.00"),
  // 10% resident individual, 30% non-resident
  isNonResident:       boolean("is_non_resident").default(false),
  isVatRegistered:     boolean("is_vat_registered").default(false),
  vatNumber:           varchar("vat_number", { length: 20 }),
  vatRegistrationDate: date("vat_registration_date"),
  annualIncomeThreshold: decimal("annual_income_threshold", { precision: 12, scale: 2 }).default("288000"),
  filingFrequency:     varchar("filing_frequency", { length: 10 }).default("monthly"),
  kraStatus:           varchar("kra_status", { length: 20 }).default("pending"),
  // pending | compliant | flagged
  lastFiledPeriod:     varchar("last_filed_period", { length: 7 }),   // YYYY-MM
  notes:               text("notes"),
  createdAt:           timestamp("created_at").defaultNow(),
  updatedAt:           timestamp("updated_at").defaultNow(),
});

export const kraRentalReturns = pgTable("kra_rental_returns", {
  id:              serial("id").primaryKey(),
  organizationId:  integer("organization_id").notNull().references(() => organizations.id),
  landlordUserId:  uuid("landlord_user_id").notNull().references(() => users.id),
  propertyId:      integer("property_id").references(() => properties.id),
  returnYear:      integer("return_year").notNull(),
  returnMonth:     integer("return_month").notNull(),
  grossRent:       decimal("gross_rent",   { precision: 12, scale: 2 }).notNull().default("0"),
  vatApplicable:   boolean("vat_applicable").default(false),
  vatAmount:       decimal("vat_amount",   { precision: 12, scale: 2 }).default("0"),
  whtRate:         decimal("wht_rate",     { precision: 5,  scale: 2 }).notNull().default("10.00"),
  whtAmount:       decimal("wht_amount",   { precision: 12, scale: 2 }).notNull().default("0"),
  netIncome:       decimal("net_income",   { precision: 12, scale: 2 }).notNull().default("0"),
  allowableDeductions: decimal("allowable_deductions", { precision: 12, scale: 2 }).default("0"),
  deductionNotes:  text("deduction_notes"),
  status:          varchar("status", { length: 20 }).default("draft"),
  // draft | filed | acknowledged
  filedAt:         timestamp("filed_at"),
  acknowledgementRef: varchar("acknowledgement_ref", { length: 100 }),
  notes:           text("notes"),
  createdAt:       timestamp("created_at").defaultNow(),
  updatedAt:       timestamp("updated_at").defaultNow(),
});

export const insertLandlordKraProfileSchema = createInsertSchema(landlordKraProfiles).omit({ id: true, createdAt: true, updatedAt: true });
export const insertKraRentalReturnSchema    = createInsertSchema(kraRentalReturns).omit({ id: true, createdAt: true, updatedAt: true });

export type LandlordKraProfile = typeof landlordKraProfiles.$inferSelect;
export type KraRentalReturn    = typeof kraRentalReturns.$inferSelect;

// ─── 4. PROPERTY VALUATION HISTORY ──────────────────────────────────────────

export const propertyValuations = pgTable("property_valuations", {
  id:               serial("id").primaryKey(),
  organizationId:   integer("organization_id").notNull().references(() => organizations.id),
  propertyId:       integer("property_id").notNull().references(() => properties.id),
  valuationDate:    date("valuation_date").notNull(),
  valuationType:    varchar("valuation_type", { length: 30 }).notNull(),
  // purchase | sale | mortgage | annual_review | cgt_assessment | insurance
  marketValue:      decimal("market_value", { precision: 15, scale: 2 }).notNull(),
  currency:         varchar("currency", { length: 3 }).default("KES"),
  valuerName:       varchar("valuer_name", { length: 200 }),
  valuerFirm:       varchar("valuer_firm", { length: 200 }),
  valuerLicence:    varchar("valuer_licence", { length: 50 }),  // ISK licence number
  valuationReportUrl: varchar("valuation_report_url", { length: 500 }),
  isAcquisition:    boolean("is_acquisition").default(false),
  isDisposal:       boolean("is_disposal").default(false),
  purchasePrice:    decimal("purchase_price",     { precision: 15, scale: 2 }),
  improvementCosts: decimal("improvement_costs",  { precision: 15, scale: 2 }).default("0"),
  cgtGain:          decimal("cgt_gain",           { precision: 15, scale: 2 }),
  cgtRate:          decimal("cgt_rate",           { precision: 5,  scale: 2 }).default("5.00"),
  cgtLiability:     decimal("cgt_liability",      { precision: 12, scale: 2 }),
  notes:            text("notes"),
  createdBy:        uuid("created_by").references(() => users.id),
  createdAt:        timestamp("created_at").defaultNow(),
  updatedAt:        timestamp("updated_at").defaultNow(),
});

export const insertPropertyValuationSchema = createInsertSchema(propertyValuations).omit({ id: true, createdAt: true, updatedAt: true });
export type PropertyValuation = typeof propertyValuations.$inferSelect;

// ─── 5. SECURITY DEPOSIT INTEREST ───────────────────────────────────────────

export const cbkRateHistory = pgTable("cbk_rate_history", {
  id:            serial("id").primaryKey(),
  effectiveDate: date("effective_date").notNull().unique(),
  rate:          decimal("rate", { precision: 6, scale: 4 }).notNull(),
  source:        varchar("source", { length: 50 }).default("CBK_MPC"),
  notes:         text("notes"),
  createdAt:     timestamp("created_at").defaultNow(),
});

export const depositInterestAccruals = pgTable("deposit_interest_accruals", {
  id:                serial("id").primaryKey(),
  organizationId:    integer("organization_id").notNull().references(() => organizations.id),
  leaseId:           integer("lease_id").notNull().references(() => leases.id),
  tenantId:          integer("tenant_id").notNull().references(() => tenants.id),
  accrualDate:       date("accrual_date").notNull(),
  periodStart:       date("period_start").notNull(),
  periodEnd:         date("period_end").notNull(),
  depositBalance:    decimal("deposit_balance",    { precision: 12, scale: 2 }).notNull(),
  cbkRate:           decimal("cbk_rate",           { precision: 6,  scale: 4 }).notNull(),
  daysInPeriod:      integer("days_in_period").notNull(),
  interestAmount:    decimal("interest_amount",    { precision: 12, scale: 2 }).notNull(),
  cumulativeInterest: decimal("cumulative_interest",{ precision: 12, scale: 2 }).notNull().default("0"),
  isSettled:         boolean("is_settled").default(false),
  settledAt:         date("settled_at"),
  settledAmount:     decimal("settled_amount",     { precision: 12, scale: 2 }),
  settlementRef:     varchar("settlement_ref",     { length: 100 }),
  notes:             text("notes"),
  createdAt:         timestamp("created_at").defaultNow(),
});

export const insertCbkRateSchema               = createInsertSchema(cbkRateHistory).omit({ id: true, createdAt: true });
export const insertDepositInterestAccrualSchema = createInsertSchema(depositInterestAccruals).omit({ id: true, createdAt: true });

export type CbkRate               = typeof cbkRateHistory.$inferSelect;
export type DepositInterestAccrual = typeof depositInterestAccruals.$inferSelect;


// ═══════════════════════════════════════════════════════════════════════════
// BUCKET 1 — REVENUE BLOCKERS
// 1. PM Fee / Owner Remittance
// 2. Property Inspections (move-in / move-out)
// 3. (rent roll + management pack are API-only, no new schema)
// 4. Vacancy / Letting Pipeline
// ═══════════════════════════════════════════════════════════════════════════

// ─── 1. PM AGREEMENTS & OWNER REMITTANCE ────────────────────────────────────

/**
 * pm_agreements — the contract between a PM company and a property owner
 * for LONG-TERM rental management (distinct from short-term Airbnb-style).
 *
 * One agreement per property. Drives:
 *   - Management fee deduction on owner statements
 *   - PM fee type: percentage of gross rent | fixed monthly | per-unit flat
 */
export const pmAgreements = pgTable("pm_agreements", {
  id:               serial("id").primaryKey(),
  organizationId:   integer("organization_id").notNull().references(() => organizations.id),
  propertyId:       integer("property_id").notNull().references(() => properties.id).unique(),
  ownerUserId:      uuid("owner_user_id").references(() => users.id),          // landlord's user account
  agreementNumber:  varchar("agreement_number", { length: 30 }).notNull().unique(),
  // Fee structure
  feeType:          varchar("fee_type", { length: 20 }).notNull().default("percentage"),
  // percentage | fixed_monthly | per_unit
  feeRate:          decimal("fee_rate", { precision: 6, scale: 2 }).notNull().default("10.00"),
  // percentage: rate as %; fixed_monthly: KES amount; per_unit: KES per occupied unit
  // Disbursement account (owner's bank / M-Pesa)
  disbursementMethod: varchar("disbursement_method", { length: 20 }),          // mpesa | bank | cheque
  disbursementAccount: varchar("disbursement_account", { length: 100 }),       // M-Pesa number or bank account
  disbursementName:   varchar("disbursement_name",    { length: 100 }),        // account holder name
  // Agreement dates
  startDate:        date("start_date").notNull(),
  endDate:          date("end_date"),
  autoRenew:        boolean("auto_renew").default(true),
  noticePeriodDays: integer("notice_period_days").default(30),
  // Deduction rules: which expense categories to deduct from gross rent
  deductMaintenanceCosts: boolean("deduct_maintenance_costs").default(true),
  deductUtilities:        boolean("deduct_utilities").default(false),
  deductInsurance:        boolean("deduct_insurance").default(false),
  // Approval limits
  maintenanceApprovalThreshold: decimal("maintenance_approval_threshold", { precision: 10, scale: 2 }).default("5000"),
  status:           varchar("status", { length: 20 }).default("active"),       // active | suspended | terminated
  notes:            text("notes"),
  createdBy:        uuid("created_by").references(() => users.id),
  createdAt:        timestamp("created_at").defaultNow(),
  updatedAt:        timestamp("updated_at").defaultNow(),
});

/**
 * owner_statements — one record per property per month.
 * Generated by POST /api/owner-statements/generate.
 * Immutable once status = 'sent'; only notes can be patched after that.
 */
export const ownerStatements = pgTable("owner_statements", {
  id:               serial("id").primaryKey(),
  organizationId:   integer("organization_id").notNull().references(() => organizations.id),
  pmAgreementId:    integer("pm_agreement_id").notNull().references(() => pmAgreements.id),
  propertyId:       integer("property_id").notNull().references(() => properties.id),
  ownerUserId:      uuid("owner_user_id").references(() => users.id),
  statementNumber:  varchar("statement_number", { length: 30 }).notNull().unique(),  // OWS-2025-001
  periodMonth:      integer("period_month").notNull(),                               // 1–12
  periodYear:       integer("period_year").notNull(),
  // Income
  grossRent:        decimal("gross_rent",       { precision: 12, scale: 2 }).notNull().default("0"),
  otherIncome:      decimal("other_income",     { precision: 12, scale: 2 }).notNull().default("0"),
  totalIncome:      decimal("total_income",     { precision: 12, scale: 2 }).notNull().default("0"),
  // Deductions
  pmFee:            decimal("pm_fee",           { precision: 12, scale: 2 }).notNull().default("0"),
  maintenanceCosts: decimal("maintenance_costs",{ precision: 12, scale: 2 }).notNull().default("0"),
  utilityCosts:     decimal("utility_costs",    { precision: 12, scale: 2 }).notNull().default("0"),
  insuranceCosts:   decimal("insurance_costs",  { precision: 12, scale: 2 }).notNull().default("0"),
  otherDeductions:  decimal("other_deductions", { precision: 12, scale: 2 }).notNull().default("0"),
  totalDeductions:  decimal("total_deductions", { precision: 12, scale: 2 }).notNull().default("0"),
  // Net
  netPayable:       decimal("net_payable",      { precision: 12, scale: 2 }).notNull().default("0"),
  currency:         varchar("currency", { length: 3 }).default("KES"),
  // Disbursement
  status:           varchar("status", { length: 20 }).default("draft"),
  // draft | approved | sent | paid
  disbursedAt:      timestamp("disbursed_at"),
  disbursementRef:  varchar("disbursement_ref", { length: 100 }),
  // Snapshot data (JSON — locked at generation time so future changes don't affect past statements)
  lineItems:        jsonb("line_items"),         // [{type, description, amount}]
  paymentDetails:   jsonb("payment_details"),    // [{tenantName, unit, amount, method, date}]
  expenseDetails:   jsonb("expense_details"),    // [{vendor, description, amount, category}]
  approvedBy:       uuid("approved_by").references(() => users.id),
  approvedAt:       timestamp("approved_at"),
  notes:            text("notes"),
  generatedBy:      uuid("generated_by").references(() => users.id),
  createdAt:        timestamp("created_at").defaultNow(),
  updatedAt:        timestamp("updated_at").defaultNow(),
}, (t) => [
  // One statement per property per month
  index("owner_statements_property_period_idx").on(t.propertyId, t.periodYear, t.periodMonth),
]);

export const insertPmAgreementSchema     = createInsertSchema(pmAgreements).omit({ id: true, createdAt: true, updatedAt: true });
export const insertOwnerStatementSchema  = createInsertSchema(ownerStatements).omit({ id: true, createdAt: true, updatedAt: true });

export type PmAgreement    = typeof pmAgreements.$inferSelect;
export type OwnerStatement = typeof ownerStatements.$inferSelect;

// ─── 2. PROPERTY INSPECTIONS ─────────────────────────────────────────────────

/**
 * property_inspections — move-in, move-out, periodic, and pre-letting reports.
 * Each room is a JSON object: { room, condition, notes, photoUrls[] }.
 * Both tenant and manager sign digitally (IP + timestamp captured).
 */
export const propertyInspections = pgTable("property_inspections", {
  id:               serial("id").primaryKey(),
  organizationId:   integer("organization_id").notNull().references(() => organizations.id),
  propertyId:       integer("property_id").notNull().references(() => properties.id),
  unitId:           integer("unit_id").references(() => units.id),
  leaseId:          integer("lease_id").references(() => leases.id),
  tenantId:         integer("tenant_id").references(() => tenants.id),
  inspectionNumber: varchar("inspection_number", { length: 30 }).notNull().unique(), // INS-2025-001
  inspectionType:   varchar("inspection_type", { length: 30 }).notNull(),
  // move_in | move_out | periodic | pre_letting | emergency
  scheduledDate:    date("scheduled_date"),
  conductedDate:    date("conducted_date"),
  conductedBy:      uuid("conducted_by").references(() => users.id),
  // Rooms: [{ room, condition, notes, photoUrls, issues }]
  // condition: excellent | good | fair | poor
  rooms:            jsonb("rooms").notNull().default([]),
  // Overall unit condition
  overallCondition: varchar("overall_condition", { length: 20 }),               // excellent|good|fair|poor
  // Issues found: [{ description, severity, estimatedCost, photoUrls }]
  issuesFound:      jsonb("issues_found").default([]),
  totalIssuesCost:  decimal("total_issues_cost", { precision: 10, scale: 2 }).default("0"),
  // Meter readings at time of inspection
  electricityReading: decimal("electricity_reading", { precision: 10, scale: 2 }),
  waterReading:       decimal("water_reading",       { precision: 10, scale: 2 }),
  // Signatures
  tenantSignedAt:     timestamp("tenant_signed_at"),
  tenantSignatureIp:  varchar("tenant_signature_ip", { length: 45 }),
  tenantSignatureName: varchar("tenant_signature_name", { length: 100 }),       // printed name at signing
  managerSignedAt:    timestamp("manager_signed_at"),
  managerSignatureIp: varchar("manager_signature_ip", { length: 45 }),
  managerSignatureName: varchar("manager_signature_name", { length: 100 }),
  // Previous inspection for diff comparison (move-out vs move-in)
  previousInspectionId: integer("previous_inspection_id"),                      // FK set post-insert
  // Deposit deduction recommendation (computed at move-out)
  recommendedDeduction: decimal("recommended_deduction", { precision: 10, scale: 2 }).default("0"),
  deductionNotes:       text("deduction_notes"),
  // PDF export
  reportUrl:        varchar("report_url", { length: 500 }),
  status:           varchar("status", { length: 20 }).default("draft"),
  // draft | in_progress | pending_signature | tenant_signed | completed
  notes:            text("notes"),
  createdAt:        timestamp("created_at").defaultNow(),
  updatedAt:        timestamp("updated_at").defaultNow(),
});

export const insertPropertyInspectionSchema = createInsertSchema(propertyInspections).omit({ id: true, createdAt: true, updatedAt: true });
export type PropertyInspection = typeof propertyInspections.$inferSelect;

// ─── NEMA / NCA Regulatory Certificates ──────────────────────────────────────
// Tracks property-level regulatory certificates: NEMA EIA approvals,
// NCA project registrations, county building permits, fire clearances, etc.
// Each cert has an expiry date; the daily scheduler sends reminder emails
// at 90 / 60 / 30 / 7 days before expiry.

// Note: authority and status use varchar to match the DB migration (no PG enum type created)
export const regulatoryAuthorityEnum = pgEnum("regulatory_authority", [
  "NEMA", "NCA", "COUNTY", "FIRE", "OTHER",
]);

export const regulatoryCertificateStatusEnum = pgEnum("regulatory_certificate_status", [
  "active", "expired", "pending", "suspended", "revoked", "under_review",
]);

export const regulatoryCertificates = pgTable("regulatory_certificates", {
  id:               serial("id").primaryKey(),
  organizationId:   integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  propertyId:       integer("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),

  // varchar to match the DB migration — no PG enum type was created
  authority:        varchar("authority", { length: 20 }).notNull().default("NEMA"),

  certificateType:  varchar("certificate_type", { length: 60 }).notNull(),
  certificateNumber: varchar("certificate_number", { length: 100 }),
  title:             varchar("title", { length: 255 }).notNull(),

  projectId:         integer("project_id").references(() => projects.id, { onDelete: "set null" }),

  issueDate:         date("issue_date"),
  expiryDate:        date("expiry_date"),
  renewalDate:       date("renewal_date"),

  // varchar to match the DB migration
  status:            varchar("status", { length: 30 }).notNull().default("active"),

  issuingOfficer:    varchar("issuing_officer", { length: 150 }),
  issuingOffice:     varchar("issuing_office", { length: 200 }),

  conditions:        text("conditions"),
  notes:             text("notes"),

  documentUrl:       varchar("document_url", { length: 500 }),

  alert90Sent:       boolean("alert_90_sent").default(false),
  alert60Sent:       boolean("alert_60_sent").default(false),
  alert30Sent:       boolean("alert_30_sent").default(false),
  alert7Sent:        boolean("alert_7_sent").default(false),

  createdBy:         uuid("created_by").references(() => users.id),
  createdAt:         timestamp("created_at").defaultNow(),
  updatedAt:         timestamp("updated_at").defaultNow(),
});

export const insertRegulatoryCertificateSchema = createInsertSchema(regulatoryCertificates).omit({
  id: true, createdAt: true, updatedAt: true,
  alert90Sent: true, alert60Sent: true, alert30Sent: true, alert7Sent: true,
});
export type RegulatoryCertificate = typeof regulatoryCertificates.$inferSelect;
export type InsertRegulatoryCertificate = typeof regulatoryCertificates.$inferInsert;

// ─── 4. VACANCY / LETTING PIPELINE ──────────────────────────────────────────

export const prospects = pgTable("prospects", {
  id:               serial("id").primaryKey(),
  organizationId:   integer("organization_id").notNull().references(() => organizations.id),
  propertyId:       integer("property_id").references(() => properties.id),
  unitId:           integer("unit_id").references(() => units.id),              // preferred unit
  // Personal details
  firstName:        varchar("first_name", { length: 100 }).notNull(),
  lastName:         varchar("last_name",  { length: 100 }).notNull(),
  email:            varchar("email",      { length: 255 }).notNull(),
  phone:            varchar("phone",      { length: 30 }),
  nationalId:       varchar("national_id",{ length: 30 }),
  nationality:      varchar("nationality",{ length: 50 }).default("Kenyan"),
  // Employment / income
  employer:         varchar("employer",   { length: 200 }),
  jobTitle:         varchar("job_title",  { length: 100 }),
  monthlyIncome:    decimal("monthly_income", { precision: 12, scale: 2 }),
  employmentType:   varchar("employment_type", { length: 30 }),                 // employed|self_employed|student|retired
  // References
  reference1Name:   varchar("reference1_name",  { length: 100 }),
  reference1Phone:  varchar("reference1_phone", { length: 30 }),
  reference1Relation: varchar("reference1_relation", { length: 50 }),
  reference2Name:   varchar("reference2_name",  { length: 100 }),
  reference2Phone:  varchar("reference2_phone", { length: 30 }),
  reference2Relation: varchar("reference2_relation", { length: 50 }),
  // Pipeline status
  status:           varchar("status", { length: 30 }).notNull().default("new"),
  // new | viewing_scheduled | viewed | application_submitted
  // | reference_checked | approved | rejected | lease_offered | converted
  source:           varchar("source", { length: 30 }),                          // walk_in|referral|website|portal|agent
  preferredMoveIn:  date("preferred_move_in"),
  budgetMin:        decimal("budget_min", { precision: 10, scale: 2 }),
  budgetMax:        decimal("budget_max", { precision: 10, scale: 2 }),
  // Viewing
  viewingDate:      timestamp("viewing_date"),
  viewingNotes:     text("viewing_notes"),
  viewingConductedBy: uuid("viewing_conducted_by").references(() => users.id),
  // Application
  applicationSubmittedAt: timestamp("application_submitted_at"),
  applicationNotes:   text("application_notes"),
  // Reference check
  referencesCheckedAt: timestamp("references_checked_at"),
  referencesCheckedBy: uuid("references_checked_by").references(() => users.id),
  referenceCheckNotes: text("reference_check_notes"),
  // Decision
  approvedAt:       timestamp("approved_at"),
  approvedBy:       uuid("approved_by").references(() => users.id),
  rejectedAt:       timestamp("rejected_at"),
  rejectionReason:  text("rejection_reason"),
  // Lease offer
  leaseOfferedAt:   timestamp("lease_offered_at"),
  offeredRent:      decimal("offered_rent", { precision: 10, scale: 2 }),
  // Conversion
  convertedToTenantId: integer("converted_to_tenant_id").references(() => tenants.id),
  convertedAt:      timestamp("converted_at"),
  // Internal
  assignedTo:       uuid("assigned_to").references(() => users.id),             // leasing agent
  internalNotes:    text("internal_notes"),
  createdAt:        timestamp("created_at").defaultNow(),
  updatedAt:        timestamp("updated_at").defaultNow(),
});

export const insertProspectSchema = createInsertSchema(prospects).omit({ id: true, createdAt: true, updatedAt: true });
export type Prospect = typeof prospects.$inferSelect;


// ═══════════════════════════════════════════════════════════════════════════
// BUCKET 2 — SECURITY FIXES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * refresh_tokens — server-side store for revocable refresh tokens.
 *
 * Why: previously refresh tokens were stateless JWTs — logging out or
 * terminating a session had no server-side effect. A stolen 7-day token
 * could not be invalidated. This table fixes that.
 *
 * On login:  insert a row with hash(token).
 * On refresh: look up the hash, reject if revokedAt IS NOT NULL.
 * On logout:  set revokedAt = now().
 * On password change: revoke all rows for this user.
 * Cleanup job: DELETE WHERE expiresAt < now() (run nightly).
 */
export const refreshTokens = pgTable("refresh_tokens", {
  id:           serial("id").primaryKey(),
  userId:       uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash:    varchar("token_hash", { length: 64 }).notNull().unique(), // SHA-256 hex of the raw token
  issuedAt:     timestamp("issued_at").notNull().defaultNow(),
  expiresAt:    timestamp("expires_at").notNull(),
  revokedAt:    timestamp("revoked_at"),
  deviceHint:   varchar("device_hint", { length: 200 }),  // User-Agent snippet for display
  ipAddress:    varchar("ip_address",   { length: 45 }),
});

export type RefreshToken = typeof refreshTokens.$inferSelect;


// ═══════════════════════════════════════════════════════════════════════════
// BUCKET 3 — ESG / SUSTAINABILITY
// ═══════════════════════════════════════════════════════════════════════════

export const esgMetrics = pgTable("esg_metrics", {
  id:             serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  propertyId:     integer("property_id").references(() => properties.id),
  periodYear:     integer("period_year").notNull(),
  periodMonth:    integer("period_month").notNull(),
  // Energy
  electricityKwh: decimal("electricity_kwh", { precision: 12, scale: 2 }).default("0"),
  solarKwh:       decimal("solar_kwh",       { precision: 12, scale: 2 }).default("0"),
  generatorLitres: decimal("generator_litres",{ precision: 10, scale: 2 }).default("0"),
  // Water
  waterM3:        decimal("water_m3",        { precision: 12, scale: 2 }).default("0"),
  rainwaterM3:    decimal("rainwater_m3",    { precision: 10, scale: 2 }).default("0"),
  // Waste
  wasteKg:        decimal("waste_kg",        { precision: 10, scale: 2 }).default("0"),
  recycledKg:     decimal("recycled_kg",     { precision: 10, scale: 2 }).default("0"),
  // Carbon (computed: kgCO2e)
  carbonKgco2e:   decimal("carbon_kgco2e",   { precision: 12, scale: 2 }).default("0"),
  // Scores
  energyScore:    integer("energy_score"),    // 0-100
  waterScore:     integer("water_score"),
  wasteScore:     integer("waste_score"),
  overallScore:   integer("overall_score"),
  notes:          text("notes"),
  createdAt:      timestamp("created_at").defaultNow(),
  updatedAt:      timestamp("updated_at").defaultNow(),
});

export const esgReports = pgTable("esg_reports", {
  id:             serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  reportType:     varchar("report_type", { length: 30 }).notNull(), // annual | quarterly | audit
  periodLabel:    varchar("period_label", { length: 30 }).notNull(), // "2025 Q1", "2024 Annual"
  title:          varchar("title", { length: 200 }).notNull(),
  status:         varchar("status", { length: 20 }).default("draft"),
  reportUrl:      varchar("report_url", { length: 500 }),
  highlights:     jsonb("highlights").default([]),
  createdBy:      uuid("created_by").references(() => users.id),
  createdAt:      timestamp("created_at").defaultNow(),
});

export const greenMaterials = pgTable("green_materials", {
  id:             serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  name:           varchar("name", { length: 200 }).notNull(),
  category:       varchar("category", { length: 50 }),  // insulation | solar | lighting | water | paint
  supplier:       varchar("supplier", { length: 200 }),
  certification:  varchar("certification", { length: 100 }), // e.g. Green Star, LEED
  carbonFootprint: decimal("carbon_footprint", { precision: 10, scale: 4 }),
  unitOfMeasure:  varchar("unit_of_measure", { length: 20 }),
  costPerUnit:    decimal("cost_per_unit", { precision: 10, scale: 2 }),
  currency:       varchar("currency", { length: 3 }).default("KES"),
  isApproved:     boolean("is_approved").default(false),
  notes:          text("notes"),
  createdAt:      timestamp("created_at").defaultNow(),
});

export type EsgMetric      = typeof esgMetrics.$inferSelect;
export type EsgReport      = typeof esgReports.$inferSelect;
export type GreenMaterial  = typeof greenMaterials.$inferSelect;

// ─── eTIMS Integration ────────────────────────────────────────────────────────

export const etimsDeviceInfo = pgTable("etims_device_info", {
  id:             serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  tin:            varchar("tin",           { length: 20  }).notNull(),
  bhfId:          varchar("bhf_id",        { length: 10  }).notNull(),
  deviceSerial:   varchar("device_serial", { length: 50  }),
  envDistCode:    varchar("env_dist_code", { length: 10  }),
  lastReqDt:      varchar("last_req_dt",   { length: 20  }),
  status:         varchar("status",        { length: 20  }).notNull().default("pending"),
  sandbox:        boolean("sandbox").notNull().default(true),
  initialisedAt:  timestamp("initialised_at"),
  createdAt:      timestamp("created_at").defaultNow(),
  updatedAt:      timestamp("updated_at").defaultNow(),
});

export const etimsCodeLookup = pgTable("etims_code_lookup", {
  id:             serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  cdClsCode:      varchar("cd_cls_code", { length: 20  }).notNull(),
  cdCode:         varchar("cd_code",     { length: 20  }).notNull(),
  cdNm:           varchar("cd_nm",       { length: 255 }).notNull(),
  cdDesc:         text("cd_desc"),
  useYn:          varchar("use_yn",      { length: 1   }).default("Y"),
  fetchedAt:      timestamp("fetched_at").defaultNow(),
});

export const etimsInvoices = pgTable("etims_invoices", {
  id:             serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  invoiceId:      integer("invoice_id").references(() => invoices.id),
  rentPaymentId:  integer("rent_payment_id").references(() => rentPayments.id),
  invcNo:         varchar("invc_no",      { length: 50  }).notNull(),
  tpin:           varchar("tpin",         { length: 20  }).notNull(),
  bhfId:          varchar("bhf_id",       { length: 10  }).notNull().default("00"),
  saleSttCd:      varchar("sale_stt_cd",  { length: 5   }).notNull().default("02"),
  rcptTyCd:       varchar("rcpt_ty_cd",   { length: 5   }).notNull().default("S"),
  pmntTyCd:       varchar("pmnt_ty_cd",   { length: 5   }),
  saleDt:         varchar("sale_dt",      { length: 20  }).notNull(),
  custNm:         varchar("cust_nm",      { length: 255 }),
  custTpin:       varchar("cust_tpin",    { length: 20  }),
  custAddr:       text("cust_addr"),
  taxblAmtA:      decimal("taxbl_amt_a",  { precision: 15, scale: 2 }).default("0"),
  taxRtA:         decimal("tax_rt_a",     { precision: 5,  scale: 2 }).default("16.00"),
  taxAmtA:        decimal("tax_amt_a",    { precision: 15, scale: 2 }).default("0"),
  taxblAmtB:      decimal("taxbl_amt_b",  { precision: 15, scale: 2 }).default("0"),
  totItemCnt:     integer("tot_item_cnt").default(1),
  totTaxblAmt:    decimal("tot_taxbl_amt",{ precision: 15, scale: 2 }).notNull(),
  totTaxAmt:      decimal("tot_tax_amt",  { precision: 15, scale: 2 }).notNull().default("0"),
  totAmt:         decimal("tot_amt",      { precision: 15, scale: 2 }).notNull(),
  rcptNo:         varchar("rcpt_no",      { length: 50  }),
  intDt:          varchar("int_dt",       { length: 20  }),
  qrCode:         text("qr_code"),
  rcptSign:       varchar("rcpt_sign",    { length: 255 }),
  status:         varchar("status",       { length: 20  }).notNull().default("pending"),
  kraResultCd:    varchar("kra_result_cd",{ length: 10  }),
  kraResultMsg:   text("kra_result_msg"),
  attempts:       integer("attempts").notNull().default(0),
  lastAttemptAt:  timestamp("last_attempt_at"),
  submittedAt:    timestamp("submitted_at"),
  acceptedAt:     timestamp("accepted_at"),
  createdAt:      timestamp("created_at").defaultNow(),
  updatedAt:      timestamp("updated_at").defaultNow(),
});

export type EtimsDeviceInfo  = typeof etimsDeviceInfo.$inferSelect;
export type EtimsInvoice     = typeof etimsInvoices.$inferSelect;