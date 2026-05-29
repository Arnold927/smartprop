CREATE TYPE "public"."activity_type" AS ENUM('login', 'logout', 'property_view', 'tenant_action', 'payment_made', 'maintenance_request', 'document_upload', 'search', 'report_generated');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('draft', 'pending_l1', 'pending_l2', 'pending_md', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."asset_status" AS ENUM('active', 'maintenance', 'disposed', 'sold', 'written_off');--> statement-breakpoint
CREATE TYPE "public"."certificate_status" AS ENUM('not_issued', 'pending', 'issued', 'verified', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."construction_status" AS ENUM('planning', 'foundation', 'structure', 'roofing', 'finishing', 'completed');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('KES', 'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'CNY');--> statement-breakpoint
CREATE TYPE "public"."depreciation_method" AS ENUM('straight_line', 'declining_balance', 'units_of_production', 'sum_of_years');--> statement-breakpoint
CREATE TYPE "public"."expense_category" AS ENUM('maintenance', 'utilities', 'supplies', 'services', 'insurance', 'taxes', 'legal', 'marketing', 'other');--> statement-breakpoint
CREATE TYPE "public"."expense_status" AS ENUM('pending', 'approved', 'rejected', 'paid');--> statement-breakpoint
CREATE TYPE "public"."expense_type" AS ENUM('operational', 'capital', 'maintenance', 'utilities', 'travel', 'professional_services', 'marketing', 'insurance', 'other');--> statement-breakpoint
CREATE TYPE "public"."feature_status" AS ENUM('new', 'announced', 'beta', 'stable', 'deprecated');--> statement-breakpoint
CREATE TYPE "public"."feedback_status" AS ENUM('open', 'in_review', 'planned', 'in_progress', 'completed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."feedback_type" AS ENUM('bug_report', 'feature_request', 'improvement', 'general', 'complaint', 'compliment');--> statement-breakpoint
CREATE TYPE "public"."maintenance_status" AS ENUM('pending', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."message_channel" AS ENUM('app', 'sms', 'email', 'push');--> statement-breakpoint
CREATE TYPE "public"."message_type" AS ENUM('chat', 'invoice_reminder', 'maintenance_update', 'payment_confirmation', 'system_notification');--> statement-breakpoint
CREATE TYPE "public"."parking_status" AS ENUM('active', 'expired', 'suspended', 'terminated');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'processing', 'completed', 'failed', 'refunded', 'disputed');--> statement-breakpoint
CREATE TYPE "public"."payroll_status" AS ENUM('draft', 'pending_approval', 'approved', 'processed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('low', 'medium', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."procurement_status" AS ENUM('draft', 'rfq_sent', 'quotes_received', 'po_created', 'goods_received', 'invoice_matched', 'payment_approved', 'completed');--> statement-breakpoint
CREATE TYPE "public"."vehicle_status" AS ENUM('active', 'inactive', 'pending_approval', 'blacklisted');--> statement-breakpoint
CREATE TYPE "public"."visitor_status" AS ENUM('pending', 'approved', 'checked_in', 'checked_out', 'denied', 'expired');--> statement-breakpoint
CREATE TABLE "ai_conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"user_id" varchar NOT NULL,
	"conversation_type" varchar NOT NULL,
	"user_message" text NOT NULL,
	"assistant_response" text NOT NULL,
	"action_taken" jsonb,
	"language" varchar DEFAULT 'en',
	"confidence" numeric(5, 2),
	"timestamp" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ai_predictions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" varchar NOT NULL,
	"prediction_type" varchar NOT NULL,
	"target_entity" varchar NOT NULL,
	"target_entity_id" varchar NOT NULL,
	"title" varchar NOT NULL,
	"description" text NOT NULL,
	"confidence" numeric(5, 2) NOT NULL,
	"potential_impact" varchar NOT NULL,
	"recommended_action" text,
	"status" varchar DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "arrears" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"unit_id" integer NOT NULL,
	"property_id" integer NOT NULL,
	"outstanding_amount" numeric(10, 2) NOT NULL,
	"currency" "currency" DEFAULT 'USD' NOT NULL,
	"days_overdue" integer NOT NULL,
	"last_payment_date" timestamp,
	"next_due_date" timestamp NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"priority" varchar(10) DEFAULT 'medium' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "arrears_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"arrears_id" integer NOT NULL,
	"action_type" varchar(50) NOT NULL,
	"action_date" timestamp DEFAULT now(),
	"description" text NOT NULL,
	"amount" numeric(10, 2),
	"outcome" varchar(50),
	"follow_up_date" timestamp,
	"performed_by" varchar(50) NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" varchar NOT NULL,
	"action" varchar(20) NOT NULL,
	"old_values" jsonb,
	"new_values" jsonb,
	"ip_address" varchar(45),
	"user_agent" text,
	"session_id" varchar,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "automated_payment_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"rule_name" varchar(100) NOT NULL,
	"property_id" integer,
	"tenant_id" integer,
	"trigger_type" varchar(30) NOT NULL,
	"trigger_conditions" jsonb NOT NULL,
	"actions" jsonb NOT NULL,
	"schedule" varchar(50),
	"is_active" boolean DEFAULT true,
	"last_executed" timestamp,
	"execution_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" integer,
	"account_name" varchar(100) NOT NULL,
	"account_number" varchar(50) NOT NULL,
	"bank_code" varchar(20),
	"branch_code" varchar(20),
	"account_type" varchar(30) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"current_balance" numeric(15, 2) DEFAULT '0.00',
	"available_balance" numeric(15, 2) DEFAULT '0.00',
	"last_synced_at" timestamp,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "billing_cycles" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"name" varchar NOT NULL,
	"type" varchar NOT NULL,
	"frequency" varchar NOT NULL,
	"billing_day" integer NOT NULL,
	"due_day" integer NOT NULL,
	"grace_day" integer DEFAULT 5,
	"late_fee_amount" varchar,
	"late_fee_type" varchar,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "blockchain_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" varchar NOT NULL,
	"property_id" varchar NOT NULL,
	"transaction_type" varchar NOT NULL,
	"hash" varchar NOT NULL,
	"block_number" integer NOT NULL,
	"gas_used" integer NOT NULL,
	"transaction_fee" numeric(18, 8) NOT NULL,
	"participants" text[] NOT NULL,
	"data_hash" varchar NOT NULL,
	"verification_level" varchar DEFAULT 'basic' NOT NULL,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"timestamp" timestamp DEFAULT now(),
	CONSTRAINT "blockchain_transactions_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
CREATE TABLE "broadcast_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar NOT NULL,
	"content" text NOT NULL,
	"sender_user_id" varchar NOT NULL,
	"organization_id" integer NOT NULL,
	"audience_type" varchar NOT NULL,
	"audience_filter" jsonb,
	"broadcast_medium" varchar[] NOT NULL,
	"scheduled_for" timestamp,
	"status" varchar DEFAULT 'draft',
	"total_recipients" integer DEFAULT 0,
	"sent_count" integer DEFAULT 0,
	"failed_count" integer DEFAULT 0,
	"opened_count" integer DEFAULT 0,
	"clicked_count" integer DEFAULT 0,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "broadcast_recipients" (
	"id" serial PRIMARY KEY NOT NULL,
	"broadcast_id" integer NOT NULL,
	"recipient_user_id" varchar NOT NULL,
	"recipient_type" varchar NOT NULL,
	"phone_number" varchar,
	"email" varchar,
	"medium" varchar[] NOT NULL,
	"delivery_status" jsonb,
	"sent_at" timestamp,
	"delivered_at" timestamp,
	"opened_at" timestamp,
	"clicked_at" timestamp,
	"failure_reason" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "caretakers" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"employee_id" varchar,
	"property_id" integer,
	"caretaker_type" varchar(30) NOT NULL,
	"shift" varchar(20),
	"skills" text[],
	"contact_number" varchar(20),
	"emergency_contact" varchar(20),
	"salary" numeric(12, 2),
	"accommodation_provided" boolean DEFAULT false,
	"start_date" timestamp,
	"end_date" timestamp,
	"status" varchar(20) DEFAULT 'active',
	"performance_rating" numeric(3, 2),
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "caretakers_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "chart_of_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"account_code" varchar(20) NOT NULL,
	"account_name" varchar(255) NOT NULL,
	"account_type" varchar(50) NOT NULL,
	"parent_account_id" integer,
	"level" integer DEFAULT 1,
	"is_active" boolean DEFAULT true,
	"normal_balance" varchar(6) NOT NULL,
	"description" text,
	"cost_center_tracking" boolean DEFAULT false,
	"property_tracking" boolean DEFAULT false,
	"unit_tracking" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "communication_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" varchar NOT NULL,
	"category" varchar NOT NULL,
	"medium" varchar[] NOT NULL,
	"subject" varchar,
	"content" text NOT NULL,
	"variables" jsonb,
	"is_active" boolean DEFAULT true,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "complaints_photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"maintenance_request_id" integer,
	"file_name" varchar(255) NOT NULL,
	"original_name" varchar(255) NOT NULL,
	"mime_type" varchar(100),
	"size" integer,
	"url" text NOT NULL,
	"uploaded_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "compliance_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_type" varchar(50) NOT NULL,
	"report_period" varchar(20) NOT NULL,
	"generated_by" varchar NOT NULL,
	"report_data" jsonb NOT NULL,
	"file_hash" varchar(64),
	"status" varchar(20) DEFAULT 'draft',
	"submitted_at" timestamp,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "construction_updates" (
	"id" serial PRIMARY KEY NOT NULL,
	"diaspora_contract_id" integer NOT NULL,
	"update_title" varchar NOT NULL,
	"update_description" text NOT NULL,
	"construction_phase" "construction_status" NOT NULL,
	"progress_percentage" numeric(5, 2) NOT NULL,
	"photo_urls" json,
	"video_urls" json,
	"document_urls" json,
	"milestone_achieved" varchar,
	"next_milestone" varchar,
	"estimated_completion_date" timestamp,
	"notification_sent" boolean DEFAULT false,
	"client_notified" boolean DEFAULT false,
	"updated_by" varchar NOT NULL,
	"approved_by" varchar,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "contractor_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_name" varchar(50) NOT NULL,
	"description" text,
	"required_certifications" text[],
	"typical_services" text[],
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "contractor_categories_category_name_unique" UNIQUE("category_name")
);
--> statement-breakpoint
CREATE TABLE "contractor_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"payment_number" varchar NOT NULL,
	"contractor_id" integer NOT NULL,
	"work_order_id" integer,
	"expense_id" integer,
	"amount" numeric(15, 2) NOT NULL,
	"currency" "currency" DEFAULT 'KES',
	"payment_type" varchar NOT NULL,
	"payment_date" timestamp NOT NULL,
	"payment_method" varchar NOT NULL,
	"reference_number" varchar,
	"bank_account" varchar,
	"mpesa_number" varchar,
	"description" text,
	"tax_amount" numeric(10, 2),
	"net_amount" numeric(15, 2),
	"status" varchar DEFAULT 'pending',
	"processed_by" varchar,
	"processed_at" timestamp,
	"receipt_url" varchar,
	"notes" text,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "contractor_payments_payment_number_unique" UNIQUE("payment_number")
);
--> statement-breakpoint
CREATE TABLE "contractor_performance" (
	"id" serial PRIMARY KEY NOT NULL,
	"contractor_id" integer,
	"evaluation_period" varchar(20) NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"total_jobs_assigned" integer DEFAULT 0,
	"total_jobs_completed" integer DEFAULT 0,
	"total_jobs_cancelled" integer DEFAULT 0,
	"average_completion_time" numeric(8, 2),
	"average_quality_rating" numeric(3, 2),
	"average_timeliness_rating" numeric(3, 2),
	"total_revenue" numeric(12, 2),
	"average_job_value" numeric(12, 2),
	"complaint_count" integer DEFAULT 0,
	"compliment_count" integer DEFAULT 0,
	"safety_incidents" integer DEFAULT 0,
	"on_time_delivery_rate" numeric(5, 2),
	"customer_satisfaction_score" numeric(3, 2),
	"repeat_customer_rate" numeric(5, 2),
	"response_time_hours" numeric(6, 2),
	"cost_efficiency_rating" numeric(3, 2),
	"innovation_score" numeric(3, 2),
	"communication_rating" numeric(3, 2),
	"overall_score" numeric(3, 2),
	"recommendations" text,
	"improvement_areas" text[],
	"strengths" text[],
	"evaluated_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "contractor_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"contractor_id" integer,
	"work_order_id" integer,
	"reviewer_type" varchar(20) NOT NULL,
	"reviewer_id" varchar NOT NULL,
	"overall_rating" numeric(3, 2) NOT NULL,
	"quality_rating" numeric(3, 2),
	"timeliness_rating" numeric(3, 2),
	"communication_rating" numeric(3, 2),
	"professionalism_rating" numeric(3, 2),
	"value_for_money_rating" numeric(3, 2),
	"review_title" varchar(200),
	"review_text" text,
	"would_recommend" boolean,
	"would_hire_again" boolean,
	"review_photos" text[],
	"is_verified" boolean DEFAULT false,
	"is_public" boolean DEFAULT true,
	"contractor_response" text,
	"response_date" timestamp,
	"helpful_votes" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "contractor_services" (
	"id" serial PRIMARY KEY NOT NULL,
	"contractor_id" integer NOT NULL,
	"service_name" varchar NOT NULL,
	"service_category" varchar NOT NULL,
	"description" text,
	"base_rate" numeric(10, 2),
	"currency" "currency" DEFAULT 'KES',
	"rate_type" varchar NOT NULL,
	"minimum_charge" numeric(10, 2),
	"is_active" boolean DEFAULT true,
	"estimated_duration" varchar,
	"skill_level" varchar NOT NULL,
	"equipment_provided" boolean DEFAULT false,
	"materials_included" boolean DEFAULT false,
	"warranty_period" integer,
	"availability_hours" jsonb,
	"service_areas" jsonb,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "contractor_work_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_order_number" varchar(50) NOT NULL,
	"contract_id" integer,
	"contractor_id" integer,
	"property_id" integer,
	"requested_by" varchar NOT NULL,
	"urgency" varchar(20) DEFAULT 'medium',
	"work_type" varchar(50) NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text NOT NULL,
	"location" text,
	"estimated_hours" numeric(8, 2),
	"estimated_cost" numeric(12, 2),
	"actual_hours" numeric(8, 2),
	"actual_cost" numeric(12, 2),
	"currency" varchar(3) DEFAULT 'KES',
	"materials_cost" numeric(12, 2),
	"labor_cost" numeric(12, 2),
	"scheduled_date" timestamp,
	"started_at" timestamp,
	"completed_at" timestamp,
	"status" varchar(20) DEFAULT 'pending',
	"quality_rating" numeric(3, 2),
	"timeliness_rating" numeric(3, 2),
	"feedback" text,
	"work_photos" text[],
	"invoice_number" varchar(50),
	"payment_status" varchar(20) DEFAULT 'pending',
	"payment_date" timestamp,
	"warranty" varchar(100),
	"warranty_expires" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "contractor_work_orders_work_order_number_unique" UNIQUE("work_order_number")
);
--> statement-breakpoint
CREATE TABLE "contractors" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255),
	"phone" varchar(50) NOT NULL,
	"specialty" varchar(100) NOT NULL,
	"rate" numeric(10, 2),
	"currency" "currency" DEFAULT 'USD',
	"is_available" boolean DEFAULT true,
	"rating" numeric(3, 2) DEFAULT '0',
	"completed_jobs" integer DEFAULT 0,
	"address" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "contractors_registry" (
	"id" serial PRIMARY KEY NOT NULL,
	"contractor_name" varchar(100) NOT NULL,
	"company_name" varchar(100),
	"category_id" integer,
	"contractor_type" varchar(30) NOT NULL,
	"business_registration" varchar(50),
	"tax_number" varchar(50),
	"license_number" varchar(50),
	"contact_person" varchar(100),
	"phone_number" varchar(20) NOT NULL,
	"alternate_phone" varchar(20),
	"email" varchar(100),
	"address" text,
	"city" varchar(50),
	"state" varchar(50),
	"postal_code" varchar(20),
	"country" varchar(50) DEFAULT 'Kenya',
	"services" text[],
	"certifications" jsonb DEFAULT '[]',
	"insurance_details" jsonb DEFAULT '{}',
	"rating" numeric(3, 2) DEFAULT '0.00',
	"total_jobs" integer DEFAULT 0,
	"completed_jobs" integer DEFAULT 0,
	"average_response_time" integer,
	"price_range" varchar(50),
	"payment_terms" varchar(100),
	"emergency_available" boolean DEFAULT false,
	"working_hours" jsonb DEFAULT '{}',
	"service_areas" text[],
	"is_verified" boolean DEFAULT false,
	"verified_by" varchar,
	"verification_date" timestamp,
	"status" varchar(20) DEFAULT 'active',
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "cost_centers" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" varchar(50) NOT NULL,
	"property_id" integer,
	"unit_id" integer,
	"manager_id" varchar,
	"budget_amount" numeric(15, 2),
	"actual_spent" numeric(15, 2) DEFAULT '0.00',
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "data_encryption" (
	"id" serial PRIMARY KEY NOT NULL,
	"table_name" varchar(50) NOT NULL,
	"column_name" varchar(50) NOT NULL,
	"record_id" varchar NOT NULL,
	"encrypted_data" text NOT NULL,
	"key_id" varchar(50) NOT NULL,
	"algorithm" varchar(30) DEFAULT 'AES-256-GCM',
	"iv" varchar(32),
	"auth_tag" varchar(32),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "diaspora_certificates" (
	"id" serial PRIMARY KEY NOT NULL,
	"diaspora_contract_id" integer NOT NULL,
	"certificate_number" varchar NOT NULL,
	"certificate_type" varchar NOT NULL,
	"qr_code" varchar NOT NULL,
	"blockchain_hash" varchar NOT NULL,
	"blockchain_network" varchar DEFAULT 'ethereum',
	"transaction_hash" varchar,
	"block_number" integer,
	"certificate_data" jsonb NOT NULL,
	"verification_url" varchar NOT NULL,
	"download_url" varchar,
	"certificate_status" "certificate_status" DEFAULT 'pending',
	"issued_date" timestamp,
	"expiry_date" timestamp,
	"verified_at" timestamp,
	"issued_by" varchar NOT NULL,
	"verified_by" varchar,
	"revocation_reason" text,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "diaspora_certificates_certificate_number_unique" UNIQUE("certificate_number"),
	CONSTRAINT "diaspora_certificates_qr_code_unique" UNIQUE("qr_code"),
	CONSTRAINT "diaspora_certificates_blockchain_hash_unique" UNIQUE("blockchain_hash")
);
--> statement-breakpoint
CREATE TABLE "diaspora_contracts" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"property_id" integer NOT NULL,
	"client_name" varchar NOT NULL,
	"client_email" varchar NOT NULL,
	"client_phone" varchar NOT NULL,
	"client_whatsapp" varchar NOT NULL,
	"client_country" varchar NOT NULL,
	"client_address" text,
	"identification_number" varchar,
	"identification_type" varchar,
	"total_property_value" numeric(12, 2) NOT NULL,
	"down_payment" numeric(12, 2) NOT NULL,
	"monthly_installment" numeric(10, 2) NOT NULL,
	"currency" varchar DEFAULT 'KES' NOT NULL,
	"payment_frequency" varchar DEFAULT 'monthly' NOT NULL,
	"contract_duration_months" integer NOT NULL,
	"interest_rate" numeric(5, 2) DEFAULT '0.00',
	"payments_made" integer DEFAULT 0,
	"total_paid" numeric(12, 2) DEFAULT '0.00',
	"remaining_balance" numeric(12, 2) NOT NULL,
	"completion_percentage" numeric(5, 2) DEFAULT '0.00',
	"next_payment_due" timestamp NOT NULL,
	"construction_status" "construction_status" DEFAULT 'planning',
	"construction_start_date" timestamp,
	"expected_completion_date" timestamp,
	"actual_completion_date" timestamp,
	"payment_method" varchar NOT NULL,
	"international_provider" varchar NOT NULL,
	"local_bank_account" varchar,
	"contract_signed_at" timestamp,
	"legal_document_url" varchar,
	"digital_certificate_issued" boolean DEFAULT false,
	"certificate_qr_code" varchar,
	"certificate_status" "certificate_status" DEFAULT 'not_issued',
	"blockchain_hash" varchar,
	"registry_link" varchar,
	"status" varchar DEFAULT 'active',
	"assigned_manager" varchar,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "diaspora_payment_schedule" (
	"id" serial PRIMARY KEY NOT NULL,
	"diaspora_contract_id" integer NOT NULL,
	"payment_number" integer NOT NULL,
	"scheduled_date" timestamp NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"is_paid" boolean DEFAULT false,
	"paid_date" timestamp,
	"diaspora_payment_id" integer,
	"days_late" integer DEFAULT 0,
	"late_fee_applied" numeric(8, 2) DEFAULT '0.00',
	"notification_sent" boolean DEFAULT false,
	"reminders_sent" integer DEFAULT 0,
	"last_reminder_date" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "diaspora_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"diaspora_contract_id" integer NOT NULL,
	"payment_number" integer NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"currency" varchar NOT NULL,
	"exchange_rate" numeric(10, 6),
	"original_amount" numeric(10, 2),
	"original_currency" varchar,
	"payment_date" timestamp NOT NULL,
	"due_date" timestamp NOT NULL,
	"payment_method" varchar NOT NULL,
	"international_provider" varchar NOT NULL,
	"provider_transaction_id" varchar,
	"payment_status" "payment_status" DEFAULT 'pending',
	"processing_fee" numeric(8, 2) DEFAULT '0.00',
	"exchange_fee" numeric(8, 2) DEFAULT '0.00',
	"late_fee" numeric(8, 2) DEFAULT '0.00',
	"receipt_url" varchar,
	"confirmation_code" varchar,
	"notes" text,
	"processed_by" varchar,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar NOT NULL,
	"type" varchar NOT NULL,
	"url" varchar NOT NULL,
	"tenant_id" integer,
	"property_id" integer,
	"maintenance_request_id" integer,
	"uploaded_by" varchar NOT NULL,
	"size" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "encryption_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"key_id" varchar(50) NOT NULL,
	"key_type" varchar(30) NOT NULL,
	"purpose" varchar(50) NOT NULL,
	"encrypted_key" text NOT NULL,
	"key_version" integer DEFAULT 1,
	"is_active" boolean DEFAULT true,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"rotated_at" timestamp,
	CONSTRAINT "encryption_keys_key_id_unique" UNIQUE("key_id")
);
--> statement-breakpoint
CREATE TABLE "escrow_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer,
	"account_type" varchar(30) NOT NULL,
	"account_name" varchar(100) NOT NULL,
	"bank_account_id" integer,
	"current_balance" numeric(15, 2) DEFAULT '0.00',
	"minimum_balance" numeric(15, 2) DEFAULT '0.00',
	"maximum_balance" numeric(15, 2),
	"currency" varchar(3) NOT NULL,
	"auto_top_up" boolean DEFAULT false,
	"top_up_threshold" numeric(15, 2),
	"top_up_amount" numeric(15, 2),
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "expense_line_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"expense_report_id" integer NOT NULL,
	"expense_date" timestamp NOT NULL,
	"expense_type" "expense_type" NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'KES',
	"receipt_url" varchar(500),
	"ocr_data" jsonb,
	"account_code_id" integer,
	"cost_center_id" integer,
	"property_id" integer,
	"unit_id" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "expense_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"report_number" varchar(50) NOT NULL,
	"employee_id" varchar NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"total_amount" numeric(15, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'KES',
	"submitted_date" timestamp NOT NULL,
	"approval_status" "approval_status" DEFAULT 'draft',
	"l1_approver_id" varchar,
	"l1_approved_at" timestamp,
	"l1_comments" text,
	"l2_approver_id" varchar,
	"l2_approved_at" timestamp,
	"l2_comments" text,
	"md_approver_id" varchar,
	"md_approved_at" timestamp,
	"md_comments" text,
	"rejected_reason" text,
	"paid_date" timestamp,
	"payment_reference" varchar(100),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "expense_reports_report_number_unique" UNIQUE("report_number")
);
--> statement-breakpoint
CREATE TABLE "feature_announcements" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"title" varchar(255) NOT NULL,
	"description" text NOT NULL,
	"content" text,
	"feature_id" varchar,
	"category" varchar(100),
	"status" "feature_status" DEFAULT 'new',
	"priority" "priority" DEFAULT 'medium',
	"target_audience" varchar[],
	"release_date" timestamp,
	"announcement_date" timestamp,
	"image_url" varchar,
	"video_url" varchar,
	"demo_url" varchar,
	"documentation_url" varchar,
	"changelog_url" varchar,
	"is_active" boolean DEFAULT true,
	"show_as_tooltip" boolean DEFAULT false,
	"show_as_modal" boolean DEFAULT false,
	"show_as_banner" boolean DEFAULT false,
	"display_duration" integer DEFAULT 7,
	"views_count" integer DEFAULT 0,
	"clicks_count" integer DEFAULT 0,
	"dismissals_count" integer DEFAULT 0,
	"likes_count" integer DEFAULT 0,
	"metadata" jsonb DEFAULT '{}',
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "feature_announcements_feature_id_unique" UNIQUE("feature_id")
);
--> statement-breakpoint
CREATE TABLE "feedback_votes" (
	"id" serial PRIMARY KEY NOT NULL,
	"feedback_id" integer NOT NULL,
	"user_id" varchar NOT NULL,
	"vote_type" varchar NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "financial_reconciliation" (
	"id" serial PRIMARY KEY NOT NULL,
	"reconciliation_id" varchar(100) NOT NULL,
	"bank_account_id" integer,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"opening_balance" numeric(15, 2) NOT NULL,
	"closing_balance" numeric(15, 2) NOT NULL,
	"total_transactions" integer DEFAULT 0,
	"matched_transactions" integer DEFAULT 0,
	"unmatched_transactions" integer DEFAULT 0,
	"discrepancies" numeric(15, 2) DEFAULT '0.00',
	"status" varchar(30) NOT NULL,
	"reconciled_by" varchar(50),
	"reconciled_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "financial_reconciliation_reconciliation_id_unique" UNIQUE("reconciliation_id")
);
--> statement-breakpoint
CREATE TABLE "general_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"transaction_id" varchar(100) NOT NULL,
	"journal_entry_id" integer,
	"account_id" integer NOT NULL,
	"cost_center_id" integer,
	"property_id" integer,
	"unit_id" integer,
	"debit_amount" numeric(15, 2) DEFAULT '0.00',
	"credit_amount" numeric(15, 2) DEFAULT '0.00',
	"description" text NOT NULL,
	"reference" varchar(100),
	"transaction_date" timestamp NOT NULL,
	"fiscal_year" integer NOT NULL,
	"fiscal_period" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'KES',
	"exchange_rate" numeric(10, 6) DEFAULT '1.000000',
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "general_ledger_transaction_id_unique" UNIQUE("transaction_id")
);
--> statement-breakpoint
CREATE TABLE "invoice_reminders" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer,
	"type" varchar(50) NOT NULL,
	"reference_id" integer NOT NULL,
	"reminder_type" varchar(50) NOT NULL,
	"days_offset" integer NOT NULL,
	"channel" "message_channel" DEFAULT 'email',
	"is_active" boolean DEFAULT true,
	"last_sent" timestamp,
	"next_scheduled" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_number" varchar NOT NULL,
	"tenant_id" integer,
	"property_id" integer NOT NULL,
	"unit_id" integer,
	"type" varchar NOT NULL,
	"amount" varchar NOT NULL,
	"currency" varchar DEFAULT 'KES',
	"issue_date" timestamp DEFAULT now(),
	"due_date" timestamp NOT NULL,
	"status" varchar DEFAULT 'pending',
	"paid_date" timestamp,
	"payment_method" varchar,
	"description" text,
	"line_items" json,
	"tax_amount" varchar DEFAULT '0',
	"discount_amount" varchar DEFAULT '0',
	"total_amount" varchar NOT NULL,
	"reminders_sent" integer DEFAULT 0,
	"last_reminder_date" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "invoices_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
CREATE TABLE "iot_devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" varchar NOT NULL,
	"property_id" varchar NOT NULL,
	"unit_id" integer,
	"device_type" varchar NOT NULL,
	"device_name" varchar NOT NULL,
	"device_model" varchar,
	"mac_address" varchar,
	"ip_address" varchar,
	"status" varchar DEFAULT 'online' NOT NULL,
	"battery_level" integer,
	"firmware_version" varchar,
	"last_reading" jsonb,
	"last_update" timestamp DEFAULT now(),
	"alerts_count" integer DEFAULT 0,
	"monthly_savings" numeric(10, 2) DEFAULT '0',
	"installation_date" timestamp DEFAULT now(),
	"warranty_expiry" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "iot_devices_mac_address_unique" UNIQUE("mac_address")
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"entry_id" varchar(100) NOT NULL,
	"entry_date" timestamp NOT NULL,
	"description" text NOT NULL,
	"reference" varchar(100),
	"total_debit" numeric(15, 2) NOT NULL,
	"total_credit" numeric(15, 2) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"status" varchar(20) NOT NULL,
	"property_id" integer,
	"tenant_id" integer,
	"transaction_id" integer,
	"created_by" varchar(50) NOT NULL,
	"approved_by" varchar(50),
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "journal_entries_entry_id_unique" UNIQUE("entry_id")
);
--> statement-breakpoint
CREATE TABLE "journal_entry_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"journal_entry_id" integer,
	"line_number" integer NOT NULL,
	"account_id" integer,
	"description" text,
	"debit_amount" numeric(15, 2) DEFAULT '0.00',
	"credit_amount" numeric(15, 2) DEFAULT '0.00',
	"currency" varchar(3) NOT NULL,
	"property_id" integer,
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "landlord_portal_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"session_token" varchar NOT NULL,
	"expires_at" timestamp NOT NULL,
	"last_activity" timestamp DEFAULT now(),
	"ip_address" varchar,
	"user_agent" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "landlord_portal_sessions_session_token_unique" UNIQUE("session_token")
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_code" varchar(20) NOT NULL,
	"account_name" varchar(100) NOT NULL,
	"account_type" varchar(30) NOT NULL,
	"account_sub_type" varchar(50),
	"parent_account_id" integer,
	"is_active" boolean DEFAULT true,
	"current_balance" numeric(15, 2) DEFAULT '0.00',
	"currency" varchar(3) NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "ledger_accounts_account_code_unique" UNIQUE("account_code")
);
--> statement-breakpoint
CREATE TABLE "maintenance_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_number" varchar NOT NULL,
	"tenant_id" integer NOT NULL,
	"unit_id" integer NOT NULL,
	"contractor_id" integer,
	"title" varchar NOT NULL,
	"description" text NOT NULL,
	"category" varchar DEFAULT 'other',
	"priority" "priority" NOT NULL,
	"status" "maintenance_status" DEFAULT 'pending',
	"assigned_to" varchar,
	"assigned_date" timestamp,
	"started_date" timestamp,
	"estimated_cost" numeric(10, 2),
	"actual_cost" numeric(10, 2),
	"estimated_hours" integer,
	"actual_hours" integer,
	"currency" "currency" DEFAULT 'USD',
	"scheduled_date" timestamp,
	"approval_required" boolean DEFAULT false,
	"approved_by" varchar,
	"approved_date" timestamp,
	"rejection_reason" text,
	"tenant_notes" text,
	"contractor_notes" text,
	"internal_notes" text,
	"customer_satisfaction" integer,
	"satisfaction_rating" integer,
	"satisfaction_comments" text,
	"feedback_date" timestamp,
	"response_time" integer,
	"resolution_time" integer,
	"technician_id" integer,
	"technician_notes" text,
	"time_log" jsonb,
	"total_time_spent" integer,
	"work_start_time" timestamp,
	"work_end_time" timestamp,
	"follow_up_required" boolean DEFAULT false,
	"follow_up_date" timestamp,
	"recurrence" varchar DEFAULT 'none',
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "maintenance_requests_ticket_number_unique" UNIQUE("ticket_number")
);
--> statement-breakpoint
CREATE TABLE "managed_property_maintenance" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"management_agreement_id" integer,
	"maintenance_type" varchar(30) NOT NULL,
	"description" text NOT NULL,
	"priority" varchar(10) DEFAULT 'medium',
	"scheduled_date" timestamp,
	"completed_date" timestamp,
	"estimated_cost" numeric(10, 2),
	"actual_cost" numeric(10, 2),
	"approved_budget" numeric(10, 2),
	"requires_owner_approval" boolean DEFAULT false,
	"owner_approval_status" varchar(20) DEFAULT 'pending',
	"owner_approval_date" timestamp,
	"owner_notes" text,
	"service_provider" varchar(100),
	"contractor_id" integer,
	"affects_availability" boolean DEFAULT false,
	"blocked_dates" jsonb,
	"status" varchar(20) DEFAULT 'pending',
	"photos" jsonb,
	"documents" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_user_id" varchar NOT NULL,
	"to_user_id" varchar NOT NULL,
	"subject" varchar,
	"content" text NOT NULL,
	"channel" "message_channel" DEFAULT 'app',
	"type" "message_type" DEFAULT 'chat',
	"message_type" varchar DEFAULT 'direct',
	"is_read" boolean DEFAULT false,
	"is_scheduled" boolean DEFAULT false,
	"scheduled_at" timestamp,
	"sent_at" timestamp,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "mobile_money" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" integer,
	"business_short_code" varchar(20),
	"till_number" varchar(20),
	"phone_number" varchar(20) NOT NULL,
	"account_name" varchar(100) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"current_balance" numeric(15, 2) DEFAULT '0.00',
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "mpesa_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer,
	"rent_payment_id" integer,
	"service_charge_id" integer,
	"transaction_id" varchar(100),
	"phone_number" varchar(20) NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"currency" "currency" DEFAULT 'KES',
	"status" varchar(50) DEFAULT 'pending',
	"mpesa_receipt_number" varchar(100),
	"merchant_request_id" varchar(100),
	"checkout_request_id" varchar(100),
	"response_code" varchar(10),
	"response_description" text,
	"customer_message" text,
	"transaction_date" varchar(50),
	"result_code" varchar(10),
	"result_desc" text,
	"description" text,
	"callback_data" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "mpesa_transactions_transaction_id_unique" UNIQUE("transaction_id")
);
--> statement-breakpoint
CREATE TABLE "organization_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"timezone" varchar(50) DEFAULT 'Africa/Nairobi',
	"default_currency" varchar(3) DEFAULT 'KES',
	"date_format" varchar(20) DEFAULT 'DD/MM/YYYY',
	"language" varchar(10) DEFAULT 'en',
	"email_settings" jsonb DEFAULT '{}'::jsonb,
	"sms_settings" jsonb DEFAULT '{}'::jsonb,
	"whatsapp_settings" jsonb DEFAULT '{}'::jsonb,
	"payment_settings" jsonb DEFAULT '{}'::jsonb,
	"custom_fields" jsonb DEFAULT '{}'::jsonb,
	"integrations" jsonb DEFAULT '{}'::jsonb,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"domain" varchar(255),
	"logo" varchar,
	"primary_color" varchar(7) DEFAULT '#3B82F6',
	"secondary_color" varchar(7) DEFAULT '#EF4444',
	"white_label" jsonb DEFAULT '{}'::jsonb,
	"subscription_plan" varchar(50) DEFAULT 'basic',
	"subscription_status" varchar(20) DEFAULT 'trial',
	"max_properties" integer DEFAULT 5,
	"max_users" integer DEFAULT 10,
	"features" jsonb DEFAULT '{}'::jsonb,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug"),
	CONSTRAINT "organizations_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "owner_financial_statements" (
	"id" serial PRIMARY KEY NOT NULL,
	"statement_number" varchar(50) NOT NULL,
	"owner_id" integer NOT NULL,
	"property_id" integer,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"statement_type" varchar(20) NOT NULL,
	"total_revenue" numeric(12, 2) DEFAULT '0.00',
	"booking_revenue" numeric(12, 2) DEFAULT '0.00',
	"additional_fees" numeric(12, 2) DEFAULT '0.00',
	"total_expenses" numeric(12, 2) DEFAULT '0.00',
	"management_fees" numeric(12, 2) DEFAULT '0.00',
	"maintenance_costs" numeric(12, 2) DEFAULT '0.00',
	"cleaning_costs" numeric(12, 2) DEFAULT '0.00',
	"utility_costs" numeric(12, 2) DEFAULT '0.00',
	"insurance_costs" numeric(12, 2) DEFAULT '0.00',
	"taxes_paid" numeric(12, 2) DEFAULT '0.00',
	"net_income" numeric(12, 2) DEFAULT '0.00',
	"owner_payout" numeric(12, 2) DEFAULT '0.00',
	"occupancy_rate" numeric(5, 2),
	"average_daily_rate" numeric(10, 2),
	"total_nights_booked" integer DEFAULT 0,
	"status" varchar(20) DEFAULT 'draft',
	"sent_date" timestamp,
	"paid_date" timestamp,
	"revenue_breakdown" jsonb,
	"expense_breakdown" jsonb,
	"booking_details" jsonb,
	"currency" varchar(3) DEFAULT 'USD',
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "owner_financial_statements_statement_number_unique" UNIQUE("statement_number")
);
--> statement-breakpoint
CREATE TABLE "ownership_certificates" (
	"id" serial PRIMARY KEY NOT NULL,
	"certificate_number" varchar(50) NOT NULL,
	"property_id" integer NOT NULL,
	"owner_id" integer NOT NULL,
	"ownership_type" varchar(30) NOT NULL,
	"ownership_percentage" numeric(5, 2) DEFAULT '100.00',
	"acquisition_type" varchar(30) NOT NULL,
	"title_deed_number" varchar(100),
	"registration_number" varchar(100),
	"legal_description" text,
	"survey_details" jsonb,
	"acquisition_date" timestamp NOT NULL,
	"certificate_issue_date" timestamp DEFAULT now(),
	"expiry_date" timestamp,
	"documents" jsonb,
	"is_verified" boolean DEFAULT false,
	"verified_by" varchar(100),
	"verification_date" timestamp,
	"compliance_status" varchar(20) DEFAULT 'pending',
	"status" varchar(20) DEFAULT 'active',
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "ownership_certificates_certificate_number_unique" UNIQUE("certificate_number")
);
--> statement-breakpoint
CREATE TABLE "parking_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"parking_space_id" integer NOT NULL,
	"vehicle_id" integer NOT NULL,
	"tenant_id" integer,
	"assignment_type" varchar NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp,
	"monthly_fee" numeric(10, 2),
	"currency" "currency" DEFAULT 'KES',
	"status" "parking_status" DEFAULT 'active',
	"last_payment_date" timestamp,
	"next_payment_due" timestamp,
	"notes" text,
	"assigned_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "parking_spaces" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"space_number" varchar NOT NULL,
	"floor" varchar,
	"section" varchar,
	"space_type" varchar NOT NULL,
	"length" numeric(5, 2),
	"width" numeric(5, 2),
	"is_available" boolean DEFAULT true,
	"is_reserved" boolean DEFAULT false,
	"reserved_for" varchar,
	"monthly_rate" numeric(10, 2),
	"currency" "currency" DEFAULT 'KES',
	"has_electric_charging" boolean DEFAULT false,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payment_allocation_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer,
	"property_id" integer,
	"rule_name" varchar(100) NOT NULL,
	"allocation_type" varchar(30) NOT NULL,
	"allocations" jsonb NOT NULL,
	"is_default" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payment_providers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"type" varchar(50) NOT NULL,
	"api_endpoint" varchar(255),
	"api_key" text,
	"api_secret" text,
	"configuration" jsonb DEFAULT '{}',
	"is_active" boolean DEFAULT true,
	"supported_currencies" text[],
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payment_receipts" (
	"id" serial PRIMARY KEY NOT NULL,
	"payment_id" integer NOT NULL,
	"tenant_id" integer NOT NULL,
	"receipt_number" varchar NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"currency" varchar DEFAULT 'USD',
	"payment_method" varchar NOT NULL,
	"payment_date" date NOT NULL,
	"description" text,
	"pdf_path" varchar,
	"sent_via_email" boolean DEFAULT false,
	"sent_via_sms" boolean DEFAULT false,
	"email_sent_at" timestamp,
	"sms_sent_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "payment_receipts_receipt_number_unique" UNIQUE("receipt_number")
);
--> statement-breakpoint
CREATE TABLE "payment_reminders" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"arrears_id" integer,
	"reminder_type" varchar(20) NOT NULL,
	"channel" varchar(10) NOT NULL,
	"message" text NOT NULL,
	"scheduled_for" timestamp NOT NULL,
	"sent_at" timestamp,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"recipient_info" jsonb,
	"response_received" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payment_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"transaction_id" varchar(100) NOT NULL,
	"external_transaction_id" varchar(100),
	"tenant_id" integer,
	"property_id" integer,
	"unit_id" integer,
	"provider_id" integer,
	"payment_method" varchar(50) NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"fees" numeric(15, 2) DEFAULT '0.00',
	"net_amount" numeric(15, 2) NOT NULL,
	"status" varchar(30) NOT NULL,
	"payment_type" varchar(50) NOT NULL,
	"description" text,
	"received_at" timestamp,
	"processed_at" timestamp,
	"reconciled_at" timestamp,
	"metadata" jsonb DEFAULT '{}',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "payment_transactions_transaction_id_unique" UNIQUE("transaction_id")
);
--> statement-breakpoint
CREATE TABLE "payroll_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"payroll_period_id" integer NOT NULL,
	"employee_id" varchar NOT NULL,
	"basic_salary" numeric(12, 2) NOT NULL,
	"overtime_hours" numeric(8, 2) DEFAULT '0.00',
	"overtime_rate" numeric(10, 2) DEFAULT '0.00',
	"overtime_pay" numeric(12, 2) DEFAULT '0.00',
	"allowances" numeric(12, 2) DEFAULT '0.00',
	"bonuses" numeric(12, 2) DEFAULT '0.00',
	"gross_pay" numeric(12, 2) NOT NULL,
	"tax_deductions" numeric(12, 2) DEFAULT '0.00',
	"nhif_deductions" numeric(12, 2) DEFAULT '0.00',
	"nssf_deductions" numeric(12, 2) DEFAULT '0.00',
	"other_deductions" numeric(12, 2) DEFAULT '0.00',
	"total_deductions" numeric(12, 2) DEFAULT '0.00',
	"net_pay" numeric(12, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'KES',
	"payment_method" varchar(30) DEFAULT 'bank_transfer',
	"bank_account" varchar(50),
	"payment_reference" varchar(100),
	"status" varchar(20) DEFAULT 'pending',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payroll_periods" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"period_name" varchar(100) NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp NOT NULL,
	"pay_date" timestamp NOT NULL,
	"status" "payroll_status" DEFAULT 'draft',
	"total_gross_pay" numeric(15, 2) DEFAULT '0.00',
	"total_deductions" numeric(15, 2) DEFAULT '0.00',
	"total_net_pay" numeric(15, 2) DEFAULT '0.00',
	"approved_by" varchar,
	"approved_at" timestamp,
	"processed_by" varchar,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "po_line_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"po_id" integer NOT NULL,
	"pr_line_item_id" integer,
	"item_number" integer NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(10, 2) NOT NULL,
	"unit_cost" numeric(12, 2) NOT NULL,
	"total_cost" numeric(15, 2) NOT NULL,
	"received_quantity" numeric(10, 2) DEFAULT '0.00',
	"account_code_id" integer,
	"cost_center_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "portal_customization" (
	"id" serial PRIMARY KEY NOT NULL,
	"portal_type" varchar NOT NULL,
	"entity_id" varchar NOT NULL,
	"branding_config" jsonb,
	"layout_config" jsonb,
	"notification_preferences" jsonb,
	"features" jsonb,
	"custom_css" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "portfolio_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" varchar NOT NULL,
	"report_type" varchar NOT NULL,
	"report_period_start" date NOT NULL,
	"report_period_end" date NOT NULL,
	"properties_included" integer[],
	"total_revenue" numeric(15, 2) DEFAULT '0.00',
	"total_expenses" numeric(15, 2) DEFAULT '0.00',
	"net_income" numeric(15, 2) DEFAULT '0.00',
	"occupancy_rate" numeric(5, 2),
	"summary" jsonb,
	"report_data" jsonb,
	"pdf_path" varchar,
	"status" varchar DEFAULT 'generated',
	"created_at" timestamp DEFAULT now(),
	"downloaded_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "pr_line_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"pr_id" integer NOT NULL,
	"item_number" integer NOT NULL,
	"description" text NOT NULL,
	"specification" text,
	"quantity" numeric(10, 2) NOT NULL,
	"unit_of_measure" varchar(20) NOT NULL,
	"estimated_unit_cost" numeric(12, 2),
	"estimated_total_cost" numeric(15, 2),
	"account_code_id" integer,
	"cost_center_id" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "project_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"task_id" integer,
	"name" text NOT NULL,
	"type" varchar(50) NOT NULL,
	"file_path" text NOT NULL,
	"file_size" integer,
	"mime_type" text,
	"uploaded_by" varchar NOT NULL,
	"description" text,
	"tags" text[],
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "project_expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"task_id" integer,
	"category" varchar(50) NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"vendor" text,
	"invoice_number" text,
	"receipt_path" text,
	"paid_date" timestamp,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"payment_method" varchar(20),
	"approved_by" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "project_milestones" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"target_date" timestamp NOT NULL,
	"completed_date" timestamp,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"importance" varchar(20) DEFAULT 'normal' NOT NULL,
	"deliverables" text[],
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "project_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" varchar(50) DEFAULT 'todo' NOT NULL,
	"priority" varchar(20) DEFAULT 'medium' NOT NULL,
	"assigned_to" varchar,
	"estimated_hours" integer,
	"actual_hours" integer,
	"due_date" timestamp,
	"completed_date" timestamp,
	"dependencies" integer[],
	"materials" text[],
	"cost" numeric(10, 2),
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "project_team" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"member_id" varchar NOT NULL,
	"member_type" varchar(50) NOT NULL,
	"role" text,
	"hourly_rate" numeric(10, 2),
	"joined_date" timestamp DEFAULT now(),
	"left_date" timestamp,
	"is_active" boolean DEFAULT true
);
--> statement-breakpoint
CREATE TABLE "project_time_tracking" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"task_id" integer,
	"member_id" varchar NOT NULL,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp,
	"duration" integer,
	"description" text,
	"billable" boolean DEFAULT true,
	"approved" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" varchar(50) NOT NULL,
	"status" varchar(50) DEFAULT 'planning' NOT NULL,
	"priority" varchar(20) DEFAULT 'medium' NOT NULL,
	"property_id" integer,
	"unit_id" integer,
	"manager_id" varchar NOT NULL,
	"budget" numeric(10, 2),
	"actual_cost" numeric(10, 2),
	"start_date" timestamp,
	"end_date" timestamp,
	"estimated_duration" integer,
	"actual_duration" integer,
	"completion_percentage" integer DEFAULT 0,
	"materials" text[],
	"permits" text[],
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" varchar NOT NULL,
	"address" text NOT NULL,
	"total_units" integer NOT NULL,
	"owner_id" varchar NOT NULL,
	"description" text,
	"image_url" varchar,
	"custom_branding" jsonb DEFAULT '{}'::jsonb,
	"site_settings" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "property_availability" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"date" date NOT NULL,
	"is_available" boolean DEFAULT true,
	"availability_type" varchar(20) DEFAULT 'available',
	"base_rate" numeric(10, 2),
	"seasonal_rate" numeric(10, 2),
	"final_rate" numeric(10, 2),
	"booking_id" integer,
	"is_weekend" boolean DEFAULT false,
	"is_holiday" boolean DEFAULT false,
	"season_type" varchar(20),
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "property_blockchain_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" varchar NOT NULL,
	"blockchain_id" varchar NOT NULL,
	"verification_status" varchar DEFAULT 'pending' NOT NULL,
	"trust_score" numeric(5, 2) DEFAULT '0',
	"total_transactions" integer DEFAULT 0,
	"last_verified" timestamp,
	"ownership_chain" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "property_blockchain_records_blockchain_id_unique" UNIQUE("blockchain_id")
);
--> statement-breakpoint
CREATE TABLE "property_expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"expense_number" varchar NOT NULL,
	"property_id" integer NOT NULL,
	"contractor_id" integer,
	"vendor_name" varchar NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"currency" "currency" DEFAULT 'KES',
	"category" "expense_category" NOT NULL,
	"expense_date" timestamp NOT NULL,
	"due_date" timestamp,
	"payment_date" timestamp,
	"status" "expense_status" DEFAULT 'pending',
	"approved_by" varchar,
	"approved_at" timestamp,
	"payment_method" varchar,
	"receipt_url" varchar,
	"invoice_url" varchar,
	"is_recurring" boolean DEFAULT false,
	"recurring_frequency" varchar,
	"next_recurring_date" timestamp,
	"tags" jsonb,
	"notes" text,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "property_expenses_expense_number_unique" UNIQUE("expense_number")
);
--> statement-breakpoint
CREATE TABLE "property_management_agreements" (
	"id" serial PRIMARY KEY NOT NULL,
	"agreement_number" varchar(50) NOT NULL,
	"property_id" integer NOT NULL,
	"owner_id" integer NOT NULL,
	"management_type" varchar(30) NOT NULL,
	"management_fee_type" varchar(20) NOT NULL,
	"management_fee_rate" numeric(5, 2) NOT NULL,
	"minimum_stay" integer DEFAULT 1,
	"maximum_stay" integer DEFAULT 365,
	"services_included" jsonb,
	"cleaning_fee" numeric(10, 2) DEFAULT '0.00',
	"maintenance_budget" numeric(10, 2) DEFAULT '0.00',
	"start_date" timestamp NOT NULL,
	"end_date" timestamp,
	"auto_renewal" boolean DEFAULT true,
	"owner_payout" varchar(20) DEFAULT 'monthly',
	"currency" varchar(3) DEFAULT 'USD',
	"status" varchar(20) DEFAULT 'active',
	"terms" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "property_management_agreements_agreement_number_unique" UNIQUE("agreement_number")
);
--> statement-breakpoint
CREATE TABLE "property_managers" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"employee_id" varchar,
	"management_level" varchar(20) NOT NULL,
	"specializations" text[],
	"certifications" jsonb DEFAULT '[]',
	"contact_number" varchar(20),
	"emergency_contact" varchar(20),
	"salary" numeric(12, 2),
	"commission_rate" numeric(5, 2),
	"start_date" timestamp,
	"end_date" timestamp,
	"status" varchar(20) DEFAULT 'active',
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "property_managers_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"po_number" varchar(50) NOT NULL,
	"pr_id" integer,
	"vendor_id" integer NOT NULL,
	"buyer_id" varchar NOT NULL,
	"order_date" timestamp NOT NULL,
	"delivery_date" timestamp,
	"delivery_address" text,
	"payment_terms" varchar(100),
	"shipping_terms" varchar(100),
	"subtotal" numeric(15, 2) NOT NULL,
	"tax_amount" numeric(15, 2) DEFAULT '0.00',
	"total_amount" numeric(15, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'KES',
	"status" "procurement_status" DEFAULT 'draft',
	"notes" text,
	"attachments" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "purchase_orders_po_number_unique" UNIQUE("po_number")
);
--> statement-breakpoint
CREATE TABLE "purchase_requisitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"pr_number" varchar(50) NOT NULL,
	"requestor_id" varchar NOT NULL,
	"department_id" integer,
	"cost_center_id" integer,
	"title" varchar(255) NOT NULL,
	"description" text,
	"justification" text,
	"priority" varchar(20) DEFAULT 'medium',
	"requested_date" timestamp NOT NULL,
	"required_date" timestamp NOT NULL,
	"total_amount" numeric(15, 2),
	"currency" varchar(3) DEFAULT 'KES',
	"approval_status" "approval_status" DEFAULT 'draft',
	"l1_approver_id" varchar,
	"l1_approved_at" timestamp,
	"l1_comments" text,
	"l2_approver_id" varchar,
	"l2_approved_at" timestamp,
	"l2_comments" text,
	"md_approver_id" varchar,
	"md_approved_at" timestamp,
	"md_comments" text,
	"rejected_reason" text,
	"attachments" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "purchase_requisitions_pr_number_unique" UNIQUE("pr_number")
);
--> statement-breakpoint
CREATE TABLE "reconciliation_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"conditions" jsonb NOT NULL,
	"actions" jsonb NOT NULL,
	"priority" integer DEFAULT 1,
	"is_active" boolean DEFAULT true,
	"success_count" integer DEFAULT 0,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "recurring_charges" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"unit_id" integer,
	"name" varchar NOT NULL,
	"type" varchar NOT NULL,
	"amount" varchar NOT NULL,
	"currency" varchar DEFAULT 'KES',
	"frequency" varchar NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp,
	"next_bill_date" timestamp NOT NULL,
	"is_active" boolean DEFAULT true,
	"auto_generate" boolean DEFAULT true,
	"description" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "registered_vehicles" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"owner_id" varchar,
	"owner_type" varchar NOT NULL,
	"plate_number" varchar NOT NULL,
	"vehicle_type" varchar NOT NULL,
	"make" varchar NOT NULL,
	"model" varchar NOT NULL,
	"year" integer,
	"color" varchar NOT NULL,
	"status" "vehicle_status" DEFAULT 'pending_approval',
	"approved_by" varchar,
	"approved_at" timestamp,
	"expires_at" timestamp,
	"is_resident" boolean DEFAULT true,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "registered_vehicles_plate_number_unique" UNIQUE("plate_number")
);
--> statement-breakpoint
CREATE TABLE "rent_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"currency" varchar DEFAULT 'USD' NOT NULL,
	"due_date" date NOT NULL,
	"paid_date" date,
	"payment_method" varchar,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "rent_to_own_agreements" (
	"id" serial PRIMARY KEY NOT NULL,
	"agreement_number" varchar(50) NOT NULL,
	"property_id" integer NOT NULL,
	"tenant_id" integer NOT NULL,
	"agreement_type" varchar(30) NOT NULL,
	"total_property_value" numeric(12, 2) NOT NULL,
	"initial_deposit" numeric(12, 2) NOT NULL,
	"monthly_payment" numeric(12, 2) NOT NULL,
	"agreement_duration" integer NOT NULL,
	"interest_rate" numeric(5, 2),
	"total_paid" numeric(12, 2) DEFAULT '0.00',
	"remaining_balance" numeric(12, 2) NOT NULL,
	"next_payment_due" timestamp NOT NULL,
	"status" varchar(20) DEFAULT 'active',
	"agreement_date" timestamp DEFAULT now(),
	"completion_date" timestamp,
	"terms" text,
	"conditions" jsonb,
	"currency" varchar(3) DEFAULT 'USD',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "rent_to_own_agreements_agreement_number_unique" UNIQUE("agreement_number")
);
--> statement-breakpoint
CREATE TABLE "rent_to_own_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"agreement_id" integer NOT NULL,
	"payment_number" integer NOT NULL,
	"scheduled_amount" numeric(12, 2) NOT NULL,
	"paid_amount" numeric(12, 2) DEFAULT '0.00',
	"principal_amount" numeric(12, 2) NOT NULL,
	"interest_amount" numeric(12, 2) DEFAULT '0.00',
	"due_date" timestamp NOT NULL,
	"paid_date" timestamp,
	"status" varchar(20) DEFAULT 'pending',
	"payment_method" varchar(30),
	"transaction_id" varchar(100),
	"late_fees" numeric(10, 2) DEFAULT '0.00',
	"days_late" integer DEFAULT 0,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "rental_statements" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"property_id" integer NOT NULL,
	"unit_id" integer NOT NULL,
	"statement_period" varchar NOT NULL,
	"statement_date" date NOT NULL,
	"previous_balance" numeric(15, 2) DEFAULT '0.00',
	"rent_charged" numeric(15, 2) NOT NULL,
	"additional_charges" numeric(15, 2) DEFAULT '0.00',
	"payments_received" numeric(15, 2) DEFAULT '0.00',
	"current_balance" numeric(15, 2) NOT NULL,
	"due_date" date NOT NULL,
	"currency" varchar DEFAULT 'USD',
	"status" varchar DEFAULT 'generated',
	"pdf_path" varchar,
	"charge_breakdown" jsonb,
	"payment_history" jsonb,
	"created_at" timestamp DEFAULT now(),
	"sent_at" timestamp,
	"viewed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "risk_assessments" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"assessment_date" timestamp DEFAULT now(),
	"risk_score" integer NOT NULL,
	"risk_category" varchar(20) NOT NULL,
	"payment_history_score" integer NOT NULL,
	"income_stability_score" integer NOT NULL,
	"behavior_score" integer NOT NULL,
	"factors" jsonb NOT NULL,
	"recommendations" text,
	"assessed_by" varchar(50) NOT NULL,
	"next_review_date" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "scheduled_disbursements" (
	"id" serial PRIMARY KEY NOT NULL,
	"disbursement_id" varchar(100) NOT NULL,
	"property_id" integer,
	"payment_transaction_id" integer,
	"recipient_type" varchar(30) NOT NULL,
	"recipient_id" varchar(50) NOT NULL,
	"recipient_name" varchar(100) NOT NULL,
	"recipient_bank_account" varchar(50),
	"recipient_mobile_number" varchar(20),
	"amount" numeric(15, 2) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"disbursement_type" varchar(50) NOT NULL,
	"scheduled_for" timestamp NOT NULL,
	"status" varchar(30) NOT NULL,
	"processed_at" timestamp,
	"failure_reason" text,
	"retry_count" integer DEFAULT 0,
	"max_retries" integer DEFAULT 3,
	"metadata" jsonb DEFAULT '{}',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "scheduled_disbursements_disbursement_id_unique" UNIQUE("disbursement_id")
);
--> statement-breakpoint
CREATE TABLE "security_incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"incident_type" varchar(50) NOT NULL,
	"severity" varchar(20) NOT NULL,
	"description" text NOT NULL,
	"affected_user_id" varchar,
	"ip_address" varchar(45),
	"user_agent" text,
	"detected_at" timestamp DEFAULT now(),
	"resolved_at" timestamp,
	"status" varchar(20) DEFAULT 'open',
	"assigned_to" varchar,
	"resolution_notes" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "service_charges" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer,
	"unit_id" integer,
	"name" varchar(255) NOT NULL,
	"type" varchar(50) NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"currency" "currency" DEFAULT 'USD',
	"due_date" timestamp,
	"status" varchar(50) DEFAULT 'pending',
	"description" text,
	"is_recurring" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "service_contracts" (
	"id" serial PRIMARY KEY NOT NULL,
	"contract_number" varchar(50) NOT NULL,
	"contractor_id" integer,
	"property_id" integer,
	"contract_type" varchar(30) NOT NULL,
	"service_type" varchar(50) NOT NULL,
	"contract_title" varchar(200) NOT NULL,
	"description" text,
	"scope" text,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp,
	"contract_value" numeric(12, 2),
	"currency" varchar(3) DEFAULT 'KES',
	"payment_schedule" varchar(30),
	"payment_terms" text,
	"sla" jsonb DEFAULT '{}',
	"penalty_clause" text,
	"termination_clause" text,
	"auto_renewal" boolean DEFAULT false,
	"renewal_terms" text,
	"status" varchar(20) DEFAULT 'draft',
	"signed_by" varchar,
	"signed_date" timestamp,
	"contract_document" varchar,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "service_contracts_contract_number_unique" UNIQUE("contract_number")
);
--> statement-breakpoint
CREATE TABLE "service_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_number" varchar(50) NOT NULL,
	"contract_id" integer,
	"contractor_id" integer,
	"property_id" integer,
	"service_type" varchar(50) NOT NULL,
	"frequency" varchar(20) NOT NULL,
	"day_of_week" integer,
	"day_of_month" integer,
	"time_of_day" varchar(10),
	"next_scheduled_date" timestamp,
	"last_service_date" timestamp,
	"service_instructions" text,
	"access_instructions" text,
	"special_requirements" text[],
	"auto_schedule" boolean DEFAULT true,
	"notify_tenant" boolean DEFAULT true,
	"notify_manager" boolean DEFAULT true,
	"requires_access" boolean DEFAULT true,
	"estimated_duration" integer,
	"service_cost" numeric(10, 2),
	"currency" varchar(3) DEFAULT 'KES',
	"status" varchar(20) DEFAULT 'active',
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "service_schedules_schedule_number_unique" UNIQUE("schedule_number")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "short_term_bookings" (
	"id" serial PRIMARY KEY NOT NULL,
	"booking_number" varchar(50) NOT NULL,
	"property_id" integer NOT NULL,
	"management_agreement_id" integer,
	"guest_name" varchar(100) NOT NULL,
	"guest_email" varchar(100) NOT NULL,
	"guest_phone" varchar(20),
	"guest_count" integer NOT NULL,
	"check_in_date" timestamp NOT NULL,
	"check_out_date" timestamp NOT NULL,
	"number_of_nights" integer NOT NULL,
	"nightly_rate" numeric(10, 2) NOT NULL,
	"total_amount" numeric(12, 2) NOT NULL,
	"cleaning_fee" numeric(10, 2) DEFAULT '0.00',
	"service_fee" numeric(10, 2) DEFAULT '0.00',
	"taxes" numeric(10, 2) DEFAULT '0.00',
	"management_fee" numeric(10, 2) DEFAULT '0.00',
	"owner_payout" numeric(12, 2) NOT NULL,
	"status" varchar(20) DEFAULT 'confirmed',
	"payment_status" varchar(20) DEFAULT 'pending',
	"platform_source" varchar(30),
	"platform_booking_id" varchar(100),
	"special_requests" text,
	"guest_notes" text,
	"internal_notes" text,
	"check_in_instructions" text,
	"key_location" varchar(200),
	"currency" varchar(3) DEFAULT 'USD',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "short_term_bookings_booking_number_unique" UNIQUE("booking_number")
);
--> statement-breakpoint
CREATE TABLE "smart_automations" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" varchar NOT NULL,
	"property_id" varchar,
	"name" varchar NOT NULL,
	"trigger_device" varchar NOT NULL,
	"trigger_condition" varchar NOT NULL,
	"actions" jsonb NOT NULL,
	"is_active" boolean DEFAULT true,
	"execution_count" integer DEFAULT 0,
	"last_executed" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "smart_contracts" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" varchar NOT NULL,
	"contract_type" varchar NOT NULL,
	"contract_address" varchar NOT NULL,
	"property_id" varchar NOT NULL,
	"parties" text[] NOT NULL,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"execution_count" integer DEFAULT 0,
	"total_value" numeric(12, 2) NOT NULL,
	"auto_execution" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "smart_contracts_contract_address_unique" UNIQUE("contract_address")
);
--> statement-breakpoint
CREATE TABLE "tenant_behavior_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"event_category" varchar(20) NOT NULL,
	"description" text NOT NULL,
	"impact" varchar(10) NOT NULL,
	"related_entity_type" varchar(50),
	"related_entity_id" integer,
	"recorded_by" varchar(50) NOT NULL,
	"event_date" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tenant_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"document_type" varchar NOT NULL,
	"title" varchar NOT NULL,
	"description" text,
	"file_path" varchar NOT NULL,
	"file_size" integer,
	"mime_type" varchar,
	"is_public" boolean DEFAULT false,
	"download_count" integer DEFAULT 0,
	"last_downloaded" timestamp,
	"expires_at" timestamp,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tenant_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"notification_type" varchar NOT NULL,
	"title" varchar NOT NULL,
	"message" text NOT NULL,
	"channel" varchar NOT NULL,
	"scheduled_for" timestamp DEFAULT now(),
	"sent_at" timestamp,
	"delivered_at" timestamp,
	"read_at" timestamp,
	"status" varchar DEFAULT 'pending',
	"recipient_info" jsonb,
	"metadata" jsonb,
	"retry_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tenant_portal_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"session_token" varchar NOT NULL,
	"expires_at" timestamp NOT NULL,
	"last_activity" timestamp DEFAULT now(),
	"ip_address" varchar,
	"user_agent" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "tenant_portal_sessions_session_token_unique" UNIQUE("session_token")
);
--> statement-breakpoint
CREATE TABLE "tenant_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"property_id" integer,
	"unit_id" integer,
	"review_type" varchar NOT NULL,
	"rating" integer NOT NULL,
	"title" varchar,
	"comment" text,
	"status" varchar DEFAULT 'pending',
	"response" text,
	"response_by" varchar,
	"response_date" timestamp,
	"is_public" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"user_id" varchar,
	"first_name" varchar NOT NULL,
	"last_name" varchar NOT NULL,
	"email" varchar NOT NULL,
	"phone" varchar,
	"unit_id" integer,
	"lease_start_date" date,
	"lease_end_date" date,
	"monthly_rent" numeric(10, 2),
	"currency" varchar DEFAULT 'USD' NOT NULL,
	"security_deposit" numeric(10, 2),
	"status" varchar DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "trust_account_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"trust_account_id" integer NOT NULL,
	"transaction_id" varchar(50) NOT NULL,
	"type" varchar(30) NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'USD',
	"description" text,
	"reference" varchar(100),
	"related_entity_type" varchar(50),
	"related_entity_id" integer,
	"status" varchar(20) DEFAULT 'pending',
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"metadata" jsonb,
	CONSTRAINT "trust_account_transactions_transaction_id_unique" UNIQUE("transaction_id")
);
--> statement-breakpoint
CREATE TABLE "trust_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_number" varchar(50) NOT NULL,
	"account_name" varchar(100) NOT NULL,
	"bank_name" varchar(100) NOT NULL,
	"bank_code" varchar(20),
	"iban" varchar(34),
	"swift" varchar(11),
	"account_type" varchar(30) NOT NULL,
	"balance" numeric(15, 2) DEFAULT '0.00',
	"currency" varchar(3) DEFAULT 'USD',
	"is_active" boolean DEFAULT true,
	"fsca_compliant" boolean DEFAULT true,
	"regulatory_id" varchar(50),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "trust_accounts_account_number_unique" UNIQUE("account_number")
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"property_id" integer NOT NULL,
	"unit_number" varchar NOT NULL,
	"bedrooms" integer,
	"bathrooms" numeric(3, 1),
	"sqft" integer,
	"monthly_rent" numeric(10, 2) NOT NULL,
	"currency" varchar DEFAULT 'USD' NOT NULL,
	"is_occupied" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"organization_id" integer,
	"session_id" varchar,
	"activity_type" "activity_type" NOT NULL,
	"activity_data" jsonb,
	"page_url" varchar,
	"page_path" varchar,
	"referrer_url" varchar,
	"user_agent" text,
	"ip_address" varchar,
	"device_type" varchar,
	"browser_name" varchar,
	"browser_version" varchar,
	"os_name" varchar,
	"os_version" varchar,
	"screen_resolution" varchar,
	"duration" integer,
	"success" boolean DEFAULT true,
	"error_message" text,
	"metadata" jsonb DEFAULT '{}',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_feature_interactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"feature_announcement_id" integer NOT NULL,
	"interaction_type" varchar NOT NULL,
	"interaction_data" jsonb,
	"device_type" varchar,
	"session_id" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"organization_id" integer NOT NULL,
	"type" "feedback_type" NOT NULL,
	"category" varchar(100),
	"title" varchar(255) NOT NULL,
	"description" text NOT NULL,
	"priority" "priority" DEFAULT 'medium',
	"status" "feedback_status" DEFAULT 'open',
	"rating" integer,
	"screenshot_url" varchar,
	"browser_info" jsonb,
	"device_info" jsonb,
	"page_url" varchar,
	"reproduction_steps" text,
	"expected_behavior" text,
	"actual_behavior" text,
	"assigned_to" varchar,
	"assigned_date" timestamp,
	"response_message" text,
	"responded_by" varchar,
	"responded_at" timestamp,
	"internal_notes" text,
	"votes_count" integer DEFAULT 0,
	"implemented_in_version" varchar,
	"estimated_effort" varchar,
	"business_value" varchar,
	"metadata" jsonb DEFAULT '{}',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_notification_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"email_notifications" boolean DEFAULT true,
	"sms_notifications" boolean DEFAULT false,
	"push_notifications" boolean DEFAULT true,
	"in_app_notifications" boolean DEFAULT true,
	"feature_announcements" boolean DEFAULT true,
	"maintenance_updates" boolean DEFAULT true,
	"payment_reminders" boolean DEFAULT true,
	"marketing_emails" boolean DEFAULT false,
	"weekly_digest" boolean DEFAULT true,
	"security_alerts" boolean DEFAULT true,
	"frequency" varchar DEFAULT 'immediate',
	"quiet_hours" jsonb DEFAULT '{"enabled": false, "start": "22:00", "end": "08:00"}',
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_role_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"role_id" integer,
	"property_id" integer,
	"assigned_by" varchar NOT NULL,
	"assigned_at" timestamp DEFAULT now(),
	"expires_at" timestamp,
	"is_active" boolean DEFAULT true
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"role_name" varchar(50) NOT NULL,
	"role_description" text,
	"permissions" jsonb DEFAULT '{}' NOT NULL,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "user_roles_role_name_unique" UNIQUE("role_name")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"email" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"role" varchar DEFAULT 'manager' NOT NULL,
	"is_org_admin" boolean DEFAULT false,
	"preferred_currency" varchar DEFAULT 'KES' NOT NULL,
	"permissions" jsonb DEFAULT '{}'::jsonb,
	"password_hash" varchar,
	"phone_number" varchar,
	"email_verified" boolean DEFAULT false,
	"email_verification_token" varchar,
	"password_reset_token" varchar,
	"password_reset_expires_at" timestamp,
	"last_login_at" timestamp,
	"invited_at" timestamp,
	"invited_by" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "utility_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"unit_id" integer,
	"provider_id" integer NOT NULL,
	"account_number" varchar NOT NULL,
	"meter_number" varchar,
	"connection_date" timestamp,
	"is_active" boolean DEFAULT true,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "utility_bills" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"bill_number" varchar,
	"billing_period_start" timestamp NOT NULL,
	"billing_period_end" timestamp NOT NULL,
	"due_date" timestamp NOT NULL,
	"amount" varchar NOT NULL,
	"currency" varchar DEFAULT 'KES',
	"units_consumed" varchar,
	"unit_rate" varchar,
	"previous_reading" varchar,
	"current_reading" varchar,
	"status" varchar DEFAULT 'pending',
	"paid_date" timestamp,
	"payment_method" varchar,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "utility_meter_readings" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"reading_date" timestamp NOT NULL,
	"reading" varchar NOT NULL,
	"reading_type" varchar DEFAULT 'manual',
	"consumption" varchar,
	"read_by" varchar,
	"image_url" varchar,
	"notes" text,
	"verified" boolean DEFAULT false,
	"verified_by" varchar,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "utility_providers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar NOT NULL,
	"type" varchar NOT NULL,
	"contact_email" varchar,
	"contact_phone" varchar,
	"billing_cycle" varchar NOT NULL,
	"average_rate" varchar,
	"currency" varchar DEFAULT 'KES',
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "visitor_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"visitor_id" integer NOT NULL,
	"log_type" varchar NOT NULL,
	"timestamp" timestamp DEFAULT now(),
	"location" varchar,
	"security_guard" varchar,
	"notes" text,
	"photo_url" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "visitors" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"unit_id" integer,
	"tenant_id" integer,
	"visitor_name" varchar NOT NULL,
	"visitor_phone" varchar,
	"visitor_email" varchar,
	"id_number" varchar,
	"company" varchar,
	"purpose_of_visit" text NOT NULL,
	"expected_arrival" timestamp NOT NULL,
	"expected_departure" timestamp,
	"actual_arrival" timestamp,
	"actual_departure" timestamp,
	"status" "visitor_status" DEFAULT 'pending',
	"approved_by" varchar,
	"approved_at" timestamp,
	"checked_in_by" varchar,
	"checked_out_by" varchar,
	"vehicle_plate" varchar,
	"parking_spot" varchar,
	"access_code" varchar,
	"notes" text,
	"photo_url" varchar,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "voice_commands" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"command" text NOT NULL,
	"interpretation" text NOT NULL,
	"action" text NOT NULL,
	"confidence" numeric(5, 2) NOT NULL,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"timestamp" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "work_order_approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_order_id" integer NOT NULL,
	"approval_level" varchar NOT NULL,
	"status" varchar DEFAULT 'pending',
	"approver_user_id" varchar,
	"approved_date" timestamp,
	"rejection_reason" text,
	"escalated_to" varchar,
	"escalated_date" timestamp,
	"comments" text,
	"approved_budget" numeric(10, 2),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "work_order_expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_order_id" integer NOT NULL,
	"contractor_id" integer,
	"expense_type" varchar NOT NULL,
	"description" text NOT NULL,
	"category" varchar NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"currency" "currency" DEFAULT 'USD',
	"expense_date" timestamp NOT NULL,
	"receipt_url" varchar,
	"is_approved" boolean DEFAULT false,
	"approved_by" varchar,
	"approved_date" timestamp,
	"rejection_reason" text,
	"invoice_number" varchar,
	"vendor" varchar,
	"payment_status" varchar DEFAULT 'pending',
	"payment_date" timestamp,
	"notes" text,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "work_order_progress" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_order_id" integer NOT NULL,
	"task_id" integer,
	"progress_date" timestamp NOT NULL,
	"progress_percentage" integer NOT NULL,
	"status_update" text NOT NULL,
	"completed_work" text,
	"next_steps" text,
	"blockers" text,
	"hours_worked" numeric(5, 2),
	"photos_url" jsonb,
	"updated_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "work_order_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_order_id" integer NOT NULL,
	"task_number" varchar NOT NULL,
	"title" varchar NOT NULL,
	"description" text,
	"status" varchar DEFAULT 'pending',
	"assigned_to" varchar,
	"estimated_hours" integer,
	"actual_hours" integer,
	"started_at" timestamp,
	"completed_at" timestamp,
	"depends_on" integer[],
	"materials" jsonb,
	"tools" jsonb,
	"skills_required" jsonb,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_number" varchar NOT NULL,
	"maintenance_request_id" integer NOT NULL,
	"project_id" integer,
	"work_order_type" varchar NOT NULL,
	"title" varchar NOT NULL,
	"description" text NOT NULL,
	"priority" "priority" NOT NULL,
	"status" varchar DEFAULT 'draft',
	"assigned_to" varchar,
	"supervisor_id" varchar,
	"contractor_id" integer,
	"estimated_start_date" timestamp,
	"estimated_end_date" timestamp,
	"actual_start_date" timestamp,
	"actual_end_date" timestamp,
	"estimated_cost" numeric(10, 2),
	"approved_budget" numeric(10, 2),
	"actual_cost" numeric(10, 2),
	"currency" "currency" DEFAULT 'USD',
	"approval_required" boolean DEFAULT true,
	"approval_level" varchar DEFAULT 'supervisor',
	"approved_by" varchar,
	"approved_date" timestamp,
	"rejection_reason" text,
	"completion_notes" text,
	"quality_rating" integer,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "work_orders_ticket_number_unique" UNIQUE("ticket_number")
);
--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_predictions" ADD CONSTRAINT "ai_predictions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arrears" ADD CONSTRAINT "arrears_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arrears" ADD CONSTRAINT "arrears_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arrears" ADD CONSTRAINT "arrears_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arrears_actions" ADD CONSTRAINT "arrears_actions_arrears_id_arrears_id_fk" FOREIGN KEY ("arrears_id") REFERENCES "public"."arrears"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automated_payment_rules" ADD CONSTRAINT "automated_payment_rules_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automated_payment_rules" ADD CONSTRAINT "automated_payment_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_provider_id_payment_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."payment_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_cycles" ADD CONSTRAINT "billing_cycles_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blockchain_transactions" ADD CONSTRAINT "blockchain_transactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blockchain_transactions" ADD CONSTRAINT "blockchain_transactions_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_broadcast_id_broadcast_messages_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcast_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caretakers" ADD CONSTRAINT "caretakers_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_parent_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("parent_account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints_photos" ADD CONSTRAINT "complaints_photos_maintenance_request_id_maintenance_requests_id_fk" FOREIGN KEY ("maintenance_request_id") REFERENCES "public"."maintenance_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "construction_updates" ADD CONSTRAINT "construction_updates_diaspora_contract_id_diaspora_contracts_id_fk" FOREIGN KEY ("diaspora_contract_id") REFERENCES "public"."diaspora_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_payments" ADD CONSTRAINT "contractor_payments_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_payments" ADD CONSTRAINT "contractor_payments_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_payments" ADD CONSTRAINT "contractor_payments_expense_id_property_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."property_expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_performance" ADD CONSTRAINT "contractor_performance_contractor_id_contractors_registry_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors_registry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_reviews" ADD CONSTRAINT "contractor_reviews_contractor_id_contractors_registry_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors_registry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_reviews" ADD CONSTRAINT "contractor_reviews_work_order_id_contractor_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."contractor_work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_services" ADD CONSTRAINT "contractor_services_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_work_orders" ADD CONSTRAINT "contractor_work_orders_contract_id_service_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."service_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_work_orders" ADD CONSTRAINT "contractor_work_orders_contractor_id_contractors_registry_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors_registry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_work_orders" ADD CONSTRAINT "contractor_work_orders_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractors_registry" ADD CONSTRAINT "contractors_registry_category_id_contractor_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."contractor_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_encryption" ADD CONSTRAINT "data_encryption_key_id_encryption_keys_key_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."encryption_keys"("key_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diaspora_certificates" ADD CONSTRAINT "diaspora_certificates_diaspora_contract_id_diaspora_contracts_id_fk" FOREIGN KEY ("diaspora_contract_id") REFERENCES "public"."diaspora_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diaspora_contracts" ADD CONSTRAINT "diaspora_contracts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diaspora_contracts" ADD CONSTRAINT "diaspora_contracts_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diaspora_payment_schedule" ADD CONSTRAINT "diaspora_payment_schedule_diaspora_contract_id_diaspora_contracts_id_fk" FOREIGN KEY ("diaspora_contract_id") REFERENCES "public"."diaspora_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diaspora_payment_schedule" ADD CONSTRAINT "diaspora_payment_schedule_diaspora_payment_id_diaspora_payments_id_fk" FOREIGN KEY ("diaspora_payment_id") REFERENCES "public"."diaspora_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diaspora_payments" ADD CONSTRAINT "diaspora_payments_diaspora_contract_id_diaspora_contracts_id_fk" FOREIGN KEY ("diaspora_contract_id") REFERENCES "public"."diaspora_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_accounts" ADD CONSTRAINT "escrow_accounts_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_accounts" ADD CONSTRAINT "escrow_accounts_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_line_items" ADD CONSTRAINT "expense_line_items_expense_report_id_expense_reports_id_fk" FOREIGN KEY ("expense_report_id") REFERENCES "public"."expense_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_line_items" ADD CONSTRAINT "expense_line_items_account_code_id_chart_of_accounts_id_fk" FOREIGN KEY ("account_code_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_line_items" ADD CONSTRAINT "expense_line_items_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_line_items" ADD CONSTRAINT "expense_line_items_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_line_items" ADD CONSTRAINT "expense_line_items_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_reports" ADD CONSTRAINT "expense_reports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_reports" ADD CONSTRAINT "expense_reports_employee_id_users_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_reports" ADD CONSTRAINT "expense_reports_l1_approver_id_users_id_fk" FOREIGN KEY ("l1_approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_reports" ADD CONSTRAINT "expense_reports_l2_approver_id_users_id_fk" FOREIGN KEY ("l2_approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_reports" ADD CONSTRAINT "expense_reports_md_approver_id_users_id_fk" FOREIGN KEY ("md_approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_announcements" ADD CONSTRAINT "feature_announcements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_votes" ADD CONSTRAINT "feedback_votes_feedback_id_user_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."user_feedback"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_votes" ADD CONSTRAINT "feedback_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_reconciliation" ADD CONSTRAINT "financial_reconciliation_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "general_ledger" ADD CONSTRAINT "general_ledger_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "general_ledger" ADD CONSTRAINT "general_ledger_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "general_ledger" ADD CONSTRAINT "general_ledger_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "general_ledger" ADD CONSTRAINT "general_ledger_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "general_ledger" ADD CONSTRAINT "general_ledger_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "general_ledger" ADD CONSTRAINT "general_ledger_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "general_ledger" ADD CONSTRAINT "general_ledger_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_reminders" ADD CONSTRAINT "invoice_reminders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_devices" ADD CONSTRAINT "iot_devices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_devices" ADD CONSTRAINT "iot_devices_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iot_devices" ADD CONSTRAINT "iot_devices_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_transaction_id_payment_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."payment_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_parent_account_id_ledger_accounts_id_fk" FOREIGN KEY ("parent_account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_property_maintenance" ADD CONSTRAINT "managed_property_maintenance_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_property_maintenance" ADD CONSTRAINT "managed_property_maintenance_management_agreement_id_property_management_agreements_id_fk" FOREIGN KEY ("management_agreement_id") REFERENCES "public"."property_management_agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_property_maintenance" ADD CONSTRAINT "managed_property_maintenance_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_money" ADD CONSTRAINT "mobile_money_provider_id_payment_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."payment_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpesa_transactions" ADD CONSTRAINT "mpesa_transactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpesa_transactions" ADD CONSTRAINT "mpesa_transactions_rent_payment_id_rent_payments_id_fk" FOREIGN KEY ("rent_payment_id") REFERENCES "public"."rent_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpesa_transactions" ADD CONSTRAINT "mpesa_transactions_service_charge_id_service_charges_id_fk" FOREIGN KEY ("service_charge_id") REFERENCES "public"."service_charges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_financial_statements" ADD CONSTRAINT "owner_financial_statements_owner_id_tenants_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_financial_statements" ADD CONSTRAINT "owner_financial_statements_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_certificates" ADD CONSTRAINT "ownership_certificates_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_certificates" ADD CONSTRAINT "ownership_certificates_owner_id_tenants_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parking_assignments" ADD CONSTRAINT "parking_assignments_parking_space_id_parking_spaces_id_fk" FOREIGN KEY ("parking_space_id") REFERENCES "public"."parking_spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parking_assignments" ADD CONSTRAINT "parking_assignments_vehicle_id_registered_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."registered_vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parking_assignments" ADD CONSTRAINT "parking_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parking_spaces" ADD CONSTRAINT "parking_spaces_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocation_rules" ADD CONSTRAINT "payment_allocation_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocation_rules" ADD CONSTRAINT "payment_allocation_rules_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_arrears_id_arrears_id_fk" FOREIGN KEY ("arrears_id") REFERENCES "public"."arrears"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_provider_id_payment_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."payment_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_payroll_period_id_payroll_periods_id_fk" FOREIGN KEY ("payroll_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_employee_id_users_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_processed_by_users_id_fk" FOREIGN KEY ("processed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_line_items" ADD CONSTRAINT "po_line_items_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_line_items" ADD CONSTRAINT "po_line_items_pr_line_item_id_pr_line_items_id_fk" FOREIGN KEY ("pr_line_item_id") REFERENCES "public"."pr_line_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_line_items" ADD CONSTRAINT "po_line_items_account_code_id_chart_of_accounts_id_fk" FOREIGN KEY ("account_code_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_line_items" ADD CONSTRAINT "po_line_items_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr_line_items" ADD CONSTRAINT "pr_line_items_pr_id_purchase_requisitions_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."purchase_requisitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr_line_items" ADD CONSTRAINT "pr_line_items_account_code_id_chart_of_accounts_id_fk" FOREIGN KEY ("account_code_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr_line_items" ADD CONSTRAINT "pr_line_items_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_task_id_project_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."project_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_expenses" ADD CONSTRAINT "project_expenses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_expenses" ADD CONSTRAINT "project_expenses_task_id_project_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."project_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_team" ADD CONSTRAINT "project_team_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_time_tracking" ADD CONSTRAINT "project_time_tracking_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_time_tracking" ADD CONSTRAINT "project_time_tracking_task_id_project_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."project_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_availability" ADD CONSTRAINT "property_availability_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_availability" ADD CONSTRAINT "property_availability_booking_id_short_term_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."short_term_bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_blockchain_records" ADD CONSTRAINT "property_blockchain_records_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_expenses" ADD CONSTRAINT "property_expenses_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_expenses" ADD CONSTRAINT "property_expenses_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_management_agreements" ADD CONSTRAINT "property_management_agreements_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_management_agreements" ADD CONSTRAINT "property_management_agreements_owner_id_tenants_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_pr_id_purchase_requisitions_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."purchase_requisitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_requestor_id_users_id_fk" FOREIGN KEY ("requestor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_l1_approver_id_users_id_fk" FOREIGN KEY ("l1_approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_l2_approver_id_users_id_fk" FOREIGN KEY ("l2_approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_md_approver_id_users_id_fk" FOREIGN KEY ("md_approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_charges" ADD CONSTRAINT "recurring_charges_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_charges" ADD CONSTRAINT "recurring_charges_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registered_vehicles" ADD CONSTRAINT "registered_vehicles_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_to_own_agreements" ADD CONSTRAINT "rent_to_own_agreements_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_to_own_agreements" ADD CONSTRAINT "rent_to_own_agreements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_to_own_payments" ADD CONSTRAINT "rent_to_own_payments_agreement_id_rent_to_own_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."rent_to_own_agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_disbursements" ADD CONSTRAINT "scheduled_disbursements_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_disbursements" ADD CONSTRAINT "scheduled_disbursements_payment_transaction_id_payment_transactions_id_fk" FOREIGN KEY ("payment_transaction_id") REFERENCES "public"."payment_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_charges" ADD CONSTRAINT "service_charges_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_charges" ADD CONSTRAINT "service_charges_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_contracts" ADD CONSTRAINT "service_contracts_contractor_id_contractors_registry_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors_registry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_contracts" ADD CONSTRAINT "service_contracts_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_schedules" ADD CONSTRAINT "service_schedules_contract_id_service_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."service_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_schedules" ADD CONSTRAINT "service_schedules_contractor_id_contractors_registry_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors_registry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_schedules" ADD CONSTRAINT "service_schedules_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "short_term_bookings" ADD CONSTRAINT "short_term_bookings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "short_term_bookings" ADD CONSTRAINT "short_term_bookings_management_agreement_id_property_management_agreements_id_fk" FOREIGN KEY ("management_agreement_id") REFERENCES "public"."property_management_agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smart_automations" ADD CONSTRAINT "smart_automations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smart_automations" ADD CONSTRAINT "smart_automations_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smart_contracts" ADD CONSTRAINT "smart_contracts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smart_contracts" ADD CONSTRAINT "smart_contracts_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_behavior_logs" ADD CONSTRAINT "tenant_behavior_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_reviews" ADD CONSTRAINT "tenant_reviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_reviews" ADD CONSTRAINT "tenant_reviews_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_reviews" ADD CONSTRAINT "tenant_reviews_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_reviews" ADD CONSTRAINT "tenant_reviews_response_by_users_id_fk" FOREIGN KEY ("response_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_account_transactions" ADD CONSTRAINT "trust_account_transactions_trust_account_id_trust_accounts_id_fk" FOREIGN KEY ("trust_account_id") REFERENCES "public"."trust_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_activity" ADD CONSTRAINT "user_activity_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_activity" ADD CONSTRAINT "user_activity_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_feature_interactions" ADD CONSTRAINT "user_feature_interactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_feature_interactions" ADD CONSTRAINT "user_feature_interactions_feature_announcement_id_feature_announcements_id_fk" FOREIGN KEY ("feature_announcement_id") REFERENCES "public"."feature_announcements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_feedback" ADD CONSTRAINT "user_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_feedback" ADD CONSTRAINT "user_feedback_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ADD CONSTRAINT "user_notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_role_id_user_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."user_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_accounts" ADD CONSTRAINT "utility_accounts_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_accounts" ADD CONSTRAINT "utility_accounts_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_accounts" ADD CONSTRAINT "utility_accounts_provider_id_utility_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."utility_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_bills" ADD CONSTRAINT "utility_bills_account_id_utility_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."utility_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_meter_readings" ADD CONSTRAINT "utility_meter_readings_account_id_utility_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."utility_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_log" ADD CONSTRAINT "visitor_log_visitor_id_visitors_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "public"."visitors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitors" ADD CONSTRAINT "visitors_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitors" ADD CONSTRAINT "visitors_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitors" ADD CONSTRAINT "visitors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_commands" ADD CONSTRAINT "voice_commands_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_commands" ADD CONSTRAINT "voice_commands_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_approvals" ADD CONSTRAINT "work_order_approvals_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_expenses" ADD CONSTRAINT "work_order_expenses_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_expenses" ADD CONSTRAINT "work_order_expenses_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_progress" ADD CONSTRAINT "work_order_progress_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_progress" ADD CONSTRAINT "work_order_progress_task_id_work_order_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."work_order_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_tasks" ADD CONSTRAINT "work_order_tasks_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_maintenance_request_id_maintenance_requests_id_fk" FOREIGN KEY ("maintenance_request_id") REFERENCES "public"."maintenance_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");