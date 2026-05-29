// server/seedUniqueFeatures.ts
import { db } from "./db";
import { eq, inArray } from "drizzle-orm";
import {
  organizations,
  properties,
  units,
  iotDevices, smartAutomations, blockchainTransactions, propertyBlockchainRecords,
  smartContracts, aiConversations, voiceCommands, aiPredictions
} from "../shared/schema";

export async function seedUniqueFeatures() {
  console.log("🚀 Seeding unique selling point features...");

  try {
    // Get organization IDs from database
    const existingOrganizations = await db.select().from(organizations);
    if (existingOrganizations.length === 0) {
      throw new Error("No organizations found. Please run the main seeder first.");
    }
    
    const primaryOrganization = existingOrganizations[0];
    const organizationId = primaryOrganization.id;

    // Get properties from database
    const existingProperties = await db.select().from(properties).where(
      eq(properties.organizationId, organizationId)
    );
    
    if (existingProperties.length === 0) {
      throw new Error("No properties found for this organization. Please run the main seeder first.");
    }

    // Get units from database
    const propertyIds = existingProperties.map(p => p.id);
    const existingUnits = await db.select().from(units).where(
      inArray(units.propertyId, propertyIds)
    );
    
    if (existingUnits.length === 0) {
      throw new Error("No units found for these properties. Please run the main seeder first.");
    }

    // Find specific properties
    const sunsetProperty = existingProperties.find(p => p.name.includes("Sunset"));
    const downtownProperty = existingProperties.find(p => p.name.includes("Downtown"));
    const riversideProperty = existingProperties.find(p => p.name.includes("Riverside"));

    if (!sunsetProperty || !downtownProperty || !riversideProperty) {
      throw new Error("Required properties not found. Please check property seeding.");
    }

    // Find units for each property
    const sunsetUnits = existingUnits.filter(u => u.propertyId === sunsetProperty.id);
    const downtownUnits = existingUnits.filter(u => u.propertyId === downtownProperty.id);
    const riversideUnits = existingUnits.filter(u => u.propertyId === riversideProperty.id);

    if (sunsetUnits.length === 0 || downtownUnits.length === 0 || riversideUnits.length === 0) {
      throw new Error("Required units not found. Please check unit seeding.");
    }

    // Clear existing data
    console.log("🧹 Clearing existing unique features data...");
    await db.delete(aiPredictions);
    await db.delete(voiceCommands);
    await db.delete(aiConversations);
    await db.delete(smartContracts);
    await db.delete(blockchainTransactions);
    await db.delete(propertyBlockchainRecords);
    await db.delete(smartAutomations);
    await db.delete(iotDevices);

    // ==================== IOT DEVICES ====================
    console.log("📡 Seeding IoT devices...");
    const iotDevicesData = [
      {
        organizationId: organizationId,
        propertyId: sunsetProperty.id,
        unitId: sunsetUnits[0]?.id,
        deviceType: "smart_lock",
        deviceName: "Front Door Smart Lock",
        deviceModel: "August WiFi Smart Lock Pro",
        macAddress: "00:1B:44:11:3A:B7",
        ipAddress: "192.168.1.101",
        status: "online",
        batteryLevel: 85,
        firmwareVersion: "v2.1.4",
        lastReading: JSON.stringify({ access_count: 12, last_access: "2024-01-22T07:30:00Z", battery_status: "good" }),
        lastUpdate: new Date("2024-01-22T08:15:00Z"),
        alertsCount: 0,
        monthlySavings: "0",
        installationDate: new Date("2024-01-10T10:00:00Z"),
        warrantyExpiry: new Date("2025-01-10T00:00:00Z"),
      },
      {
        organizationId: organizationId,
        propertyId: sunsetProperty.id,
        unitId: sunsetUnits[0]?.id,
        deviceType: "thermostat",
        deviceName: "Climate Control System",
        deviceModel: "Nest Learning Thermostat",
        macAddress: "00:1B:44:11:3A:B8",
        ipAddress: "192.168.1.102",
        status: "online",
        batteryLevel: null,
        firmwareVersion: "v5.9.3",
        lastReading: JSON.stringify({ temperature: 23.5, humidity: 65, target_temp: 24, mode: "auto" }),
        lastUpdate: new Date("2024-01-22T08:30:00Z"),
        alertsCount: 1,
        monthlySavings: "3500",
        installationDate: new Date("2024-01-10T10:00:00Z"),
        warrantyExpiry: new Date("2026-01-10T00:00:00Z"),
      },
      {
        organizationId: organizationId,
        propertyId: downtownProperty.id,
        unitId: downtownUnits[0]?.id,
        deviceType: "security_camera",
        deviceName: "Entrance Security Camera",
        deviceModel: "Ring Pro 2",
        macAddress: "00:1B:44:11:3A:B9",
        ipAddress: "192.168.1.103",
        status: "online",
        batteryLevel: null,
        firmwareVersion: "v1.12.7",
        lastReading: JSON.stringify({ motion_detected: false, recording: true, storage_used: "45%", last_motion: "2024-01-22T06:45:00Z" }),
        lastUpdate: new Date("2024-01-22T08:25:00Z"),
        alertsCount: 2,
        monthlySavings: "0",
        installationDate: new Date("2024-01-05T14:00:00Z"),
        warrantyExpiry: new Date("2025-01-05T00:00:00Z"),
      },
      {
        organizationId: organizationId,
        propertyId: sunsetProperty.id,
        unitId: sunsetUnits[1]?.id,
        deviceType: "leak_sensor",
        deviceName: "Bathroom Leak Detector",
        deviceModel: "Samsung SmartThings Water Leak Sensor",
        macAddress: "00:1B:44:11:3A:BA",
        ipAddress: "192.168.1.104",
        status: "offline",
        batteryLevel: 15,
        firmwareVersion: "v1.2.1",
        lastReading: JSON.stringify({ moisture_level: 0.2, leak_detected: false, temperature: 22.1 }),
        lastUpdate: new Date("2024-01-21T22:45:00Z"),
        alertsCount: 1,
        monthlySavings: "0",
        installationDate: new Date("2024-01-08T09:00:00Z"),
        warrantyExpiry: new Date("2025-01-08T00:00:00Z"),
      },
      {
        organizationId: organizationId,
        propertyId: riversideProperty.id,
        unitId: riversideUnits[0]?.id,
        deviceType: "smart_meter",
        deviceName: "Electricity Smart Meter",
        deviceModel: "Landis+Gyr E360",
        macAddress: "00:1B:44:11:3A:BB",
        ipAddress: "192.168.1.105",
        status: "online",
        batteryLevel: null,
        firmwareVersion: "v3.4.2",
        lastReading: JSON.stringify({ current_usage: 2.4, daily_kwh: 18.5, monthly_cost: 4200, peak_demand: 3.2 }),
        lastUpdate: new Date("2024-01-22T08:35:00Z"),
        alertsCount: 0,
        monthlySavings: "1200",
        installationDate: new Date("2024-01-01T08:00:00Z"),
        warrantyExpiry: new Date("2029-01-01T00:00:00Z"),
      },
      {
        organizationId: organizationId,
        propertyId: sunsetProperty.id,
        unitId: sunsetUnits[0]?.id,
        deviceType: "smoke_detector",
        deviceName: "Kitchen Smoke Detector",
        deviceModel: "Nest Protect",
        macAddress: "00:1B:44:11:3A:BC",
        ipAddress: "192.168.1.106",
        status: "online",
        batteryLevel: 92,
        firmwareVersion: "v2.8.1",
        lastReading: JSON.stringify({ smoke_level: 0.1, alarm_status: "normal", co_level: 0.0, battery_test: "passed" }),
        lastUpdate: new Date("2024-01-22T08:10:00Z"),
        alertsCount: 0,
        monthlySavings: "0",
        installationDate: new Date("2024-01-10T10:00:00Z"),
        warrantyExpiry: new Date("2034-01-10T00:00:00Z"),
      }
    ];

    // Filter out entries with missing references
    const validIotDevices = iotDevicesData.filter(device => 
      device.organizationId && device.propertyId && device.unitId
    );

    if (validIotDevices.length > 0) {
      const insertedIoTDevices = await db.insert(iotDevices).values(validIotDevices).returning();
      console.log(`✅ Inserted ${insertedIoTDevices.length} IoT devices`);
    }

    // ==================== SMART AUTOMATIONS ====================
    console.log("⚡ Seeding smart automations...");
    const smartAutomationsData = [
      {
        organizationId: organizationId,
        propertyId: sunsetProperty.id,
        name: "Energy Savings Mode",
        triggerDevice: "motion_sensor",
        triggerCondition: "no_motion_30min",
        actions: JSON.stringify([
          { device: "thermostat", action: "set_temperature", parameters: { temp: 26 } },
          { device: "smart_lights", action: "turn_off", parameters: {} }
        ]),
        isActive: true,
        executionCount: 47,
        lastExecuted: new Date("2024-01-22T06:30:00Z"),
      },
      {
        organizationId: organizationId,
        propertyId: downtownProperty.id,
        name: "Security Alert Chain",
        triggerDevice: "motion_sensor",
        triggerCondition: "motion_after_hours",
        actions: JSON.stringify([
          { device: "security_camera", action: "start_recording", parameters: { duration: 300 } },
          { device: "smart_lights", action: "turn_on", parameters: { brightness: 100 } },
          { device: "notification", action: "send_alert", parameters: { type: "security" } }
        ]),
        isActive: true,
        executionCount: 3,
        lastExecuted: new Date("2024-01-21T23:15:00Z"),
      },
      {
        organizationId: organizationId,
        propertyId: sunsetProperty.id,
        name: "Maintenance Prevention",
        triggerDevice: "leak_sensor",
        triggerCondition: "moisture_detected",
        actions: JSON.stringify([
          { device: "water_valve", action: "close_main_valve", parameters: {} },
          { device: "notification", action: "emergency_alert", parameters: { priority: "high" } }
        ]),
        isActive: true,
        executionCount: 0,
        lastExecuted: null,
      },
      {
        organizationId: organizationId,
        propertyId: riversideProperty.id,
        name: "Smart Climate Control",
        triggerDevice: "thermostat",
        triggerCondition: "temperature_deviation",
        actions: JSON.stringify([
          { device: "hvac_system", action: "adjust_climate", parameters: { mode: "eco" } },
          { device: "ventilation", action: "optimize_airflow", parameters: {} }
        ]),
        isActive: true,
        executionCount: 23,
        lastExecuted: new Date("2024-01-22T05:20:00Z"),
      }
    ];

    const insertedAutomations = await db.insert(smartAutomations).values(smartAutomationsData).returning();
    console.log(`✅ Inserted ${insertedAutomations.length} smart automations`);

    // ==================== PROPERTY BLOCKCHAIN RECORDS ====================
    console.log("🔗 Seeding blockchain records...");
    const blockchainRecordsData = [
      {
        organizationId: organizationId,
        propertyId: sunsetProperty.id,
        blockchainId: "0xA1B2C3D4E5F6789ABC123DEF456789ABC123DEF456",
        verificationStatus: "verified",
        trustScore: "98.5",
        totalTransactions: 47,
        lastVerified: new Date("2024-01-22T10:00:00Z"),
        ownershipChain: JSON.stringify([
          {
            owner: "Smart Property Management",
            from_date: "2023-01-15",
            transaction_hash: "0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2"
          }
        ]),
      },
      {
        organizationId: organizationId,
        propertyId: downtownProperty.id,
        blockchainId: "0xB2C3D4E5F6789ABC123DEF456789ABC123DEF4567",
        verificationStatus: "verified",
        trustScore: "95.2",
        totalTransactions: 32,
        lastVerified: new Date("2024-01-21T14:30:00Z"),
        ownershipChain: JSON.stringify([
          {
            owner: "Smart Property Management",
            from_date: "2022-08-20",
            transaction_hash: "0x2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3"
          }
        ]),
      },
      {
        organizationId: organizationId,
        propertyId: riversideProperty.id,
        blockchainId: "0xC3D4E5F6789ABC123DEF456789ABC123DEF456789",
        verificationStatus: "verified",
        trustScore: "96.8",
        totalTransactions: 28,
        lastVerified: new Date("2024-01-20T09:15:00Z"),
        ownershipChain: JSON.stringify([
          {
            owner: "Smart Property Management",
            from_date: "2023-03-10",
            transaction_hash: "0x4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5"
          }
        ]),
      }
    ];

    const insertedBlockchainRecords = await db.insert(propertyBlockchainRecords).values(blockchainRecordsData).returning();
    console.log(`✅ Inserted ${insertedBlockchainRecords.length} blockchain records`);

    // ==================== BLOCKCHAIN TRANSACTIONS ====================
    console.log("💱 Seeding blockchain transactions...");
    const blockchainTransactionsData = [
      {
        organizationId: organizationId,
        propertyId: sunsetProperty.id,
        transactionType: "lease_signing",
        hash: "0x8f2a7c3b9d4e5f6a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4",
        blockNumber: 15847392,
        gasUsed: 21000,
        transactionFee: "0.0012",
        participants: ["tenant_john_doe", "landlord_smart_prop"],
        dataHash: "QmX8f2a7c3b9d4e5f6a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4",
        verificationLevel: "premium",
        status: "confirmed",
        timestamp: new Date("2024-01-22T09:30:00Z"),
      },
      {
        organizationId: organizationId,
        propertyId: downtownProperty.id,
        transactionType: "payment",
        hash: "0x7e1a6b2c8d3e4f5a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3",
        blockNumber: 15847385,
        gasUsed: 18500,
        transactionFee: "0.0009",
        participants: ["tenant_corp_ltd", "smart_prop_escrow"],
        dataHash: "QmY7e1a6b2c8d3e4f5a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3",
        verificationLevel: "enhanced",
        status: "confirmed",
        timestamp: new Date("2024-01-22T08:45:00Z"),
      },
      {
        organizationId: organizationId,
        propertyId: riversideProperty.id,
        transactionType: "maintenance_record",
        hash: "0x6d0a5b1c7d2e3f4a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2",
        blockNumber: 15847378,
        gasUsed: 22000,
        transactionFee: "0.0015",
        participants: ["contractor_fix_all", "property_manager"],
        dataHash: "QmZ6d0a5b1c7d2e3f4a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2",
        verificationLevel: "basic",
        status: "confirmed",
        timestamp: new Date("2024-01-22T07:20:00Z"),
      }
    ];

    const insertedTransactions = await db.insert(blockchainTransactions).values(blockchainTransactionsData).returning();
    console.log(`✅ Inserted ${insertedTransactions.length} blockchain transactions`);

    // ==================== SMART CONTRACTS ====================
    console.log("📜 Seeding smart contracts...");
    const smartContractsData = [
      {
        organizationId: organizationId,
        contractType: "lease_agreement",
        contractAddress: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        propertyId: sunsetProperty.id,
        parties: ["Smart Property Management", "John Doe"],
        status: "active",
        executionCount: 3,
        totalValue: "255000",
        autoExecution: true,
      },
      {
        organizationId: organizationId,
        contractType: "payment_escrow",
        contractAddress: "0xA0b86a33E6417c1C78E882564b5C68F29Dc7A726",
        propertyId: downtownProperty.id,
        parties: ["Smart Property Management", "Corporate Tenant Ltd"],
        status: "active",
        executionCount: 8,
        totalValue: "480000",
        autoExecution: true,
      },
      {
        organizationId: organizationId,
        contractType: "maintenance_sla",
        contractAddress: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
        propertyId: riversideProperty.id,
        parties: ["Smart Property Management", "Fix All Contractors"],
        status: "active",
        executionCount: 12,
        totalValue: "180000",
        autoExecution: true,
      }
    ];

    const insertedContracts = await db.insert(smartContracts).values(smartContractsData).returning();
    console.log(`✅ Inserted ${insertedContracts.length} smart contracts`);

    // ==================== AI CONVERSATIONS ====================
    console.log("🤖 Seeding AI conversations...");
    const aiConversationsData = [
      {
        organizationId: organizationId,
        userId: "admin_user",
        conversationType: "chat",
        userMessage: "Show me overdue rent payments",
        assistantResponse: "I found 3 overdue payments totaling $147,000. Here are the details:\n\n• John Doe (Sunset Gardens A102) - $85,000 (7 days overdue)\n• Mary Smith (Downtown Lofts 203) - $42,000 (3 days overdue)\n• Tech Corp Ltd (Riverside Condos) - $20,000 (14 days overdue)\n\nWould you like me to send automated reminders?",
        actionTaken: JSON.stringify({
          type: "query",
          description: "Retrieved overdue rent payments",
          status: "completed"
        }),
        language: "en",
        confidence: "95.8",
        timestamp: new Date("2024-01-22T08:01:15Z"),
      },
      {
        organizationId: organizationId,
        userId: "admin_user",
        conversationType: "chat",
        userMessage: "Yes, send reminders and apply late fees where applicable",
        assistantResponse: "Perfect! I've completed the following actions:\n\n✓ Sent SMS reminders to John Doe and Mary Smith\n✓ Applied $2,500 late fee to John Doe (over 7 days)\n✓ Applied $5,000 late fee to Tech Corp Ltd (over 14 days)\n✓ Scheduled follow-up call for Tech Corp Ltd tomorrow at 10 AM\n\nTotal late fees applied: $7,500. All actions logged in the system.",
        actionTaken: JSON.stringify({
          type: "automation",
          description: "Sent reminders and applied late fees",
          status: "completed"
        }),
        language: "en",
        confidence: "98.2",
        timestamp: new Date("2024-01-22T08:02:30Z"),
      },
    ];

    const insertedConversations = await db.insert(aiConversations).values(aiConversationsData).returning();
    console.log(`✅ Inserted ${insertedConversations.length} AI conversations`);

    // ==================== VOICE COMMANDS ====================
    console.log("🎤 Seeding voice commands...");
    const voiceCommandsData = [
      {
        organizationId: organizationId,
        userId: "admin_user",
        command: "Show me this month's revenue",
        interpretation: "Display monthly revenue report",
        action: "Generated revenue report for January 2024",
        confidence: "95.0",
        status: "completed",
        timestamp: new Date("2024-01-22T07:45:00Z"),
      },
      {
        organizationId: organizationId,
        userId: "admin_user",
        command: "Schedule maintenance for unit A102",
        interpretation: "Create maintenance request for unit A102",
        action: "Created maintenance ticket and assigned contractor",
        confidence: "88.0",
        status: "completed",
        timestamp: new Date("2024-01-22T07:30:00Z"),
      },
    ];

    const insertedVoiceCommands = await db.insert(voiceCommands).values(voiceCommandsData).returning();
    console.log(`✅ Inserted ${insertedVoiceCommands.length} voice commands`);

    // ==================== AI PREDICTIONS ====================
    console.log("🔮 Seeding AI predictions...");
    const aiPredictionsData = [
      {
        organizationId: organizationId,
        predictionType: "revenue_optimization",
        targetEntity: "property_id",
        targetEntityId: sunsetProperty.id.toString(),
        title: "Rent Increase Opportunity",
        description: "Market analysis shows you can increase rent by 8% for 3 units based on current market rates",
        confidence: "87.0",
        potentialImpact: "+$24,000/month",
        recommendedAction: "Review market comparables and schedule tenant meetings to discuss rent adjustments starting next quarter",
        status: "active",
      },
      {
        organizationId: organizationId,
        predictionType: "maintenance_failure",
        targetEntity: "property_id",
        targetEntityId: sunsetProperty.id.toString(),
        title: "Maintenance Schedule Optimization",
        description: "Combine 4 pending maintenance requests to save 40% on contractor costs",
        confidence: "92.0",
        potentialImpact: "Save $18,000",
        recommendedAction: "Schedule all maintenance requests for the same day and negotiate bulk pricing with contractors",
        status: "active",
      },
    ];

    const insertedPredictions = await db.insert(aiPredictions).values(aiPredictionsData).returning();
    console.log(`✅ Inserted ${insertedPredictions.length} AI predictions`);

    // ==================== FINAL SUMMARY ====================
    console.log("\n🎉 Successfully seeded all unique selling point features!");
    console.log("📊 Unique Features Summary:");
    console.log(`  IoT Devices: ${validIotDevices.length}`);
    console.log(`  Smart Automations: ${insertedAutomations.length}`);
    console.log(`  Blockchain Records: ${insertedBlockchainRecords.length}`);
    console.log(`  Blockchain Transactions: ${insertedTransactions.length}`);
    console.log(`  Smart Contracts: ${insertedContracts.length}`);
    console.log(`  AI Conversations: ${insertedConversations.length}`);
    console.log(`  Voice Commands: ${insertedVoiceCommands.length}`);
    console.log(`  AI Predictions: ${insertedPredictions.length}`);
    console.log(`\n🏢 Organization ID used: ${organizationId}`);

    return {
      organizationId: organizationId,
      iotDevices: validIotDevices.length,
      smartAutomations: insertedAutomations.length,
      blockchainRecords: insertedBlockchainRecords.length,
      blockchainTransactions: insertedTransactions.length,
      smartContracts: insertedContracts.length,
      aiConversations: insertedConversations.length,
      voiceCommands: insertedVoiceCommands.length,
      aiPredictions: insertedPredictions.length,
    };

  } catch (error) {
    console.error("❌ Error seeding unique features:", error);
    throw error;
  }
}