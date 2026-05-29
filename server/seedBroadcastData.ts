import { db } from "./db";
import { broadcastMessages, broadcastRecipients, communicationTemplates } from "@shared/schema";

export async function seedBroadcastData() {
  try {
    console.log("🚀 Seeding broadcast communication data...");

    // Communication templates
    // Literal types are asserted so string values satisfy the schema's enum columns
    const templateData = [
      {
        organizationId: 1,
        name: "Rent Reminder",
        category: "rent_reminder" as const,
        medium: ["sms", "email", "app_notification"],
        subject: "Rent Payment Reminder - {{property_name}}",
        content: "Dear {{tenant_name}}, this is a friendly reminder that your rent of {{amount}} KSh for {{property_name}} is due on {{due_date}}. Please make your payment via M-PESA to complete your transaction. Thank you!",
        variables: { tenant_name: "string", property_name: "string", amount: "number", due_date: "date" },
        isActive: true,
        createdBy: "system",
      },
      {
        organizationId: 1,
        name: "Maintenance Update",
        category: "maintenance_update" as const,
        medium: ["app_notification", "sms"],
        subject: "Maintenance Update - {{unit_number}}",
        content: "Hello {{tenant_name}}, we wanted to update you on the maintenance request for {{unit_number}}. Status: {{status}}. {{update_message}}. Thank you for your patience.",
        variables: { tenant_name: "string", unit_number: "string", status: "string", update_message: "string" },
        isActive: true,
        createdBy: "system",
      },
      {
        organizationId: 1,
        name: "Emergency Alert",
        category: "emergency" as const,
        medium: ["sms", "app_notification", "push_notification"],
        subject: "URGENT: Emergency Alert",
        content: "🚨 EMERGENCY ALERT: {{message}}. Please follow safety procedures and contact management immediately if needed. Stay safe!",
        variables: { message: "string" },
        isActive: true,
        createdBy: "system",
      },
      {
        organizationId: 1,
        name: "Welcome New Tenant",
        category: "welcome" as const,
        medium: ["email", "app_notification"],
        subject: "Welcome to {{property_name}}!",
        content: "Welcome {{tenant_name}}! We're excited to have you as our new tenant at {{property_name}}. Your move-in date is {{move_in_date}}. Here are some important details: {{details}}. Welcome home!",
        variables: { tenant_name: "string", property_name: "string", move_in_date: "date", details: "string" },
        isActive: true,
        createdBy: "system",
      },
    ];

    const insertedTemplates = await db.insert(communicationTemplates).values(templateData).returning();
    console.log(`✅ Inserted ${insertedTemplates.length} communication templates`);

    // Sample broadcast messages
    const broadcastData = [
      {
        title: "Monthly Community Newsletter - January 2025",
        content: "Dear Residents, Welcome to our January newsletter! 🏠\n\n📢 ANNOUNCEMENTS:\n• New fitness center opening Feb 1st\n• Parking policy updates effective Feb 15th\n• Community event planning meeting Jan 30th\n\n🔧 MAINTENANCE UPDATES:\n• Elevator maintenance completed\n• New security cameras installed\n• Landscaping improvements ongoing\n\n💰 PAYMENT REMINDERS:\n• February rent due by Feb 5th\n• M-PESA payments available 24/7\n• Contact office for payment plans\n\nThank you for being part of our community!",
        senderUserId: "ADMIN001",
        organizationId: 1,
        audienceType: "all_tenants" as const,
        audienceFilter: {},
        broadcastMedium: ["app_notification", "email"],
        status: "sent" as const,
        totalRecipients: 35,
        sentCount: 35,
        failedCount: 0,
        openedCount: 28,
        clickedCount: 12,
        sentAt: new Date('2025-01-22T08:00:00Z'),
      },
      {
        title: "Emergency Water Maintenance Notice",
        content: "🚨 URGENT NOTICE: Water Maintenance\n\nDear Residents,\n\nWe will be conducting emergency water system maintenance on Friday, January 24th from 9:00 AM to 3:00 PM.\n\n🔧 What to expect:\n• Water supply will be interrupted\n• Backup water tanks available in lobby\n• Estimated restoration: 3:00 PM\n\n📞 Emergency contact: +254-700-123-456\n\nWe apologize for the inconvenience. Thank you for your understanding.",
        senderUserId: "ADMIN001",
        organizationId: 1,
        audienceType: "specific_properties" as const,
        audienceFilter: { propertyIds: [10, 11] },
        broadcastMedium: ["sms", "app_notification", "push_notification"],
        status: "sent" as const,
        totalRecipients: 18,
        sentCount: 18,
        failedCount: 0,
        openedCount: 18,
        clickedCount: 3,
        sentAt: new Date('2025-01-23T06:30:00Z'),
      },
      {
        title: "Rent Payment Reminder - February 2025",
        content: "💰 Rent Payment Reminder\n\nDear Valued Tenants,\n\nThis is a friendly reminder that February rent is due by February 5th, 2025.\n\n📱 Pay via M-PESA:\n• Paybill: 400200\n• Account: Your unit number\n• Amount: As per lease agreement\n\n🏦 Bank Transfer:\n• Account: Kileleshwa Heights\n• Reference: Unit number + Name\n\n📞 Questions? Contact: +254-700-987-654\n\nThank you for your prompt payment!",
        senderUserId: "ADMIN001",
        organizationId: 1,
        audienceType: "all_tenants" as const,
        audienceFilter: {},
        broadcastMedium: ["sms", "app_notification"],
        scheduledFor: new Date('2025-02-01T07:00:00Z'),
        status: "scheduled" as const,
        totalRecipients: 35,
        sentCount: 0,
        failedCount: 0,
        openedCount: 0,
        clickedCount: 0,
      },
      {
        title: "New Security Features Available",
        content: "🛡️ Enhanced Security Features Now Live!\n\nWe're excited to announce new security enhancements:\n\n🔐 NEW FEATURES:\n• QR code visitor access system\n• 24/7 CCTV monitoring upgraded\n• Mobile app visitor management\n• Enhanced gate automation\n\n📱 How to use:\n1. Generate visitor QR codes in the app\n2. Share codes with your guests\n3. Real-time visitor tracking\n4. Automatic check-in/out\n\n🎯 Benefits:\n• Faster guest entry\n• Better security tracking\n• Contactless access\n• Peace of mind\n\nDownload the latest app update to access these features!",
        senderUserId: "ADMIN001",
        organizationId: 1,
        audienceType: "all_users" as const,
        audienceFilter: {},
        broadcastMedium: ["app_notification", "email"],
        status: "sent" as const,
        totalRecipients: 42,
        sentCount: 42,
        failedCount: 0,
        openedCount: 38,
        clickedCount: 25,
        sentAt: new Date('2025-01-20T10:00:00Z'),
      },
      {
        title: "Community Event: Rooftop BBQ Party",
        content: "🎉 You're Invited: Rooftop BBQ Party!\n\nJoin us for a community gathering:\n\n📅 Date: Saturday, February 8th\n⏰ Time: 5:00 PM - 9:00 PM\n📍 Location: Rooftop Garden Area\n\n🍖 What's included:\n• BBQ dinner (Nyama Choma special!)\n• Soft drinks and juices\n• Live DJ music\n• Games for kids\n• Amazing city views\n\n🎫 RSVP Required:\n• Adults: KSh 1,500 per person\n• Children (under 12): KSh 800\n• Payment via M-PESA: 400200\n\n📞 RSVP by Feb 5th: +254-700-555-123\n\nLet's build our community together! 🤝",
        senderUserId: "ADMIN001",
        organizationId: 1,
        audienceType: "all_tenants" as const,
        audienceFilter: {},
        broadcastMedium: ["app_notification", "email", "whatsapp"],
        status: "draft" as const,
        totalRecipients: 0,
        sentCount: 0,
        failedCount: 0,
        openedCount: 0,
        clickedCount: 0,
      }
    ];

    const insertedBroadcasts = await db.insert(broadcastMessages).values(broadcastData).returning();
    console.log(`✅ Inserted ${insertedBroadcasts.length} broadcast messages`);

    // Sample broadcast recipients (for sent messages)
    const recipientData = [];
    const sentBroadcasts = insertedBroadcasts.filter(b => b.status === 'sent');

    for (const broadcast of sentBroadcasts) {
      // Generate sample recipients for each sent broadcast
      // Guard against null — totalRecipients may be nullable per schema
      const recipientCount = broadcast.totalRecipients ?? 0;
      for (let i = 0; i < recipientCount; i++) {
        recipientData.push({
          broadcastId: broadcast.id,
          recipientUserId: `TENANT${String(i + 1).padStart(3, '0')}`,
          recipientType: (Math.random() > 0.8 ? "landlord" : "tenant") as "landlord" | "tenant",
          phoneNumber: `+254-70${Math.floor(Math.random() * 10)}${Math.floor(Math.random() * 1000000).toString().padStart(6, '0')}`,
          email: `tenant${i + 1}@example.com`,
          medium: broadcast.broadcastMedium,
          deliveryStatus: {
            sms: Math.random() > 0.1 ? "delivered" : "failed",
            email: Math.random() > 0.05 ? "opened" : "delivered",
            app_notification: "delivered",
            push_notification: Math.random() > 0.2 ? "delivered" : "failed"
          },
          sentAt: broadcast.sentAt,
          deliveredAt: new Date(broadcast.sentAt!.getTime() + Math.random() * 300000), // Within 5 minutes
          openedAt: Math.random() > 0.2 ? new Date(broadcast.sentAt!.getTime() + Math.random() * 3600000) : null, // Within 1 hour
        });
      }
    }

    if (recipientData.length > 0) {
      // Insert in batches to avoid overwhelming the database
      const batchSize = 50;
      for (let i = 0; i < recipientData.length; i += batchSize) {
        const batch = recipientData.slice(i, i + batchSize);
        await db.insert(broadcastRecipients).values(batch);
      }
      console.log(`✅ Inserted ${recipientData.length} broadcast recipients`);
    }

    console.log("🎉 Broadcast communication data seeded successfully!");
    return {
      templates: insertedTemplates.length,
      broadcasts: insertedBroadcasts.length,
      recipients: recipientData.length
    };

  } catch (error) {
    console.error("❌ Error seeding broadcast data:", error);
    throw error;
  }
}

// Run if called directly
// import.meta.main is Bun/Deno-specific; use require.main for Node.js
if (require.main === module) {
  seedBroadcastData()
    .then(result => {
      console.log("✅ Seeding completed:", result);
      process.exit(0);
    })
    .catch(error => {
      console.error("❌ Seeding failed:", error);
      process.exit(1);
    });
}