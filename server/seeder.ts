// server/seeder.ts
import { db } from './db';
import {
  organizations,
  properties,
  units,
  tenants,
  rentPayments,
  maintenanceRequests,
  contractors,
  serviceCharges,
  mpesaTransactions,
  invoiceReminders,
  utilityProviders,
  utilityAccounts,
  utilityBills,
  recurringCharges,
  invoices,
  billingCycles,
  auditLogs,
  encryptionKeys,
  trustAccounts,
  trustAccountTransactions,
  complianceReports,
  securityIncidents,
} from '@shared/schema';

export async function seedDatabase() {
  console.log('🌱 Starting database seeding...');

  try {
    // Clear existing data in CORRECT ORDER (respect foreign keys)
    console.log('🧹 Clearing existing data...');
    
    // Clear tables in reverse dependency order
    await db.delete(trustAccountTransactions);
    await db.delete(trustAccounts);
    await db.delete(complianceReports);
    await db.delete(securityIncidents);
    await db.delete(auditLogs);
    await db.delete(invoices);
    await db.delete(utilityBills);
    await db.delete(utilityAccounts);
    await db.delete(recurringCharges);
    await db.delete(billingCycles);
    await db.delete(utilityProviders);
    await db.delete(mpesaTransactions);
    await db.delete(serviceCharges);
    await db.delete(invoiceReminders);
    await db.delete(rentPayments);
    await db.delete(maintenanceRequests);
    await db.delete(tenants);
    await db.delete(units);
    await db.delete(properties);
    await db.delete(contractors);
    await db.delete(organizations);

    console.log('✅ Cleared all existing data');

    // ==================== SEED ORGANIZATIONS ====================
    console.log('🏢 Seeding organizations...');
    const organizationData = await db.insert(organizations).values([
      {
        name: 'Smart Property Management',
        email: 'admin@smartprop.com',
        phone: '+254712345678',
        address: '123 Management Ave, Nairobi, Kenya',
        registrationNumber: 'REG-2024-001',
        taxId: 'TAX-001-2024',
        subscriptionTier: 'premium',
        subscriptionStatus: 'active',
        subscriptionExpiry: new Date('2025-12-31'),
        settings: {
          currency: 'KES',
          timezone: 'Africa/Nairobi',
          language: 'en',
        }
      },
      {
        name: 'Premium Real Estate Ltd',
        email: 'info@premiumrealestate.com',
        phone: '+254787654321',
        address: '456 Business Park, Nairobi, Kenya',
        registrationNumber: 'REG-2024-002',
        taxId: 'TAX-002-2024',
        subscriptionTier: 'standard',
        subscriptionStatus: 'active',
        subscriptionExpiry: new Date('2025-06-30'),
        settings: {
          currency: 'USD',
          timezone: 'Africa/Nairobi',
          language: 'en',
        }
      }
    ]).returning();

    console.log(`✅ Seeded ${organizationData.length} organizations`);
    const primaryOrganization = organizationData[0];
    const secondaryOrganization = organizationData[1];

    // ==================== SEED PROPERTIES ====================
    console.log('🏠 Seeding properties...');
    const propertyData = await db.insert(properties).values([
      {
        organizationId: primaryOrganization.id,
        name: 'Sunset Gardens Apartments',
        address: '123 Sunset Blvd, Los Angeles, CA 90028',
        totalUnits: 12,
        ownerId: '28530769',
        description: 'Modern apartment complex with pool and gym',
        imageUrl: 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=800',
      },
      {
        organizationId: primaryOrganization.id,
        name: 'Downtown Lofts',
        address: '456 Main St, New York, NY 10001',
        totalUnits: 8,
        ownerId: '28530769',
        description: 'Contemporary lofts in the heart of downtown',
        imageUrl: 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=800',
      },
      {
        organizationId: primaryOrganization.id,
        name: 'Riverside Condos',
        address: '789 River Rd, Miami, FL 33101',
        totalUnits: 15,
        ownerId: '28530769',
        description: 'Luxury condos with waterfront views',
        imageUrl: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800',
      },
      {
        organizationId: secondaryOrganization.id,
        name: 'Corporate Towers',
        address: '101 Business District, Nairobi, Kenya',
        totalUnits: 20,
        ownerId: '28530769',
        description: 'Premium commercial office spaces',
        imageUrl: 'https://images.unsplash.com/photo-1487956382158-bb926046304a?w=800',
      }
    ]).returning();

    console.log(`✅ Seeded ${propertyData.length} properties`);

    // ==================== SEED UNITS ====================
    console.log('🏢 Seeding units...');
    const unitData = [];
    for (const property of propertyData) {
      for (let i = 1; i <= property.totalUnits; i++) {
        unitData.push({
          propertyId: property.id,
          unitNumber: `${property.name.substring(0, 3).toUpperCase()}-${i < 10 ? '0' : ''}${i}`,
          bedrooms: Math.floor(Math.random() * 3) + 1,
          bathrooms: Math.floor(Math.random() * 2) + 1,
          sqft: Math.floor(Math.random() * 1000) + 500,
          monthlyRent: (Math.floor(Math.random() * 1000) + 1200).toString(),
          currency: property.organizationId === primaryOrganization.id ? 'USD' : 'KES',
          isOccupied: Math.random() > 0.3,
        });
      }
    }

    const unitsResult = await db.insert(units).values(unitData).returning();
    console.log(`✅ Seeded ${unitsResult.length} units`);

    // ==================== SEED CONTRACTORS ====================
    console.log('👷 Seeding contractors...');
    const contractorData = await db.insert(contractors).values([
      {
        organizationId: primaryOrganization.id,
        name: 'John Smith',
        email: 'john@contractors.com',
        phone: '+1-555-0101',
        specialty: 'Plumber',
        rate: '85.00',
        currency: 'USD',
        isAvailable: true,
        rating: '4.8',
        completedJobs: 156,
        address: '123 Work St, Los Angeles, CA',
        notes: 'Experienced with residential plumbing, available weekends',
      },
      {
        organizationId: primaryOrganization.id,
        name: 'Maria Rodriguez',
        email: 'maria@electrical.com',
        phone: '+1-555-0102',
        specialty: 'Electrician',
        rate: '95.00',
        currency: 'USD',
        isAvailable: true,
        rating: '4.9',
        completedJobs: 203,
        address: '456 Electric Ave, Los Angeles, CA',
        notes: 'Licensed electrician, emergency service available',
      },
      {
        organizationId: primaryOrganization.id,
        name: 'David Wilson',
        email: 'david@hvac.com',
        phone: '+1-555-0103',
        specialty: 'HVAC Technician',
        rate: '75.00',
        currency: 'USD',
        isAvailable: false,
        rating: '4.6',
        completedJobs: 89,
        address: '789 Cool St, Los Angeles, CA',
        notes: 'HVAC specialist, certified in commercial systems',
      },
      {
        organizationId: secondaryOrganization.id,
        name: 'Kenya Maintenance Ltd',
        email: 'info@kenyamaintenance.co.ke',
        phone: '+254712345679',
        specialty: 'General Maintenance',
        rate: '2500.00',
        currency: 'KES',
        isAvailable: true,
        rating: '4.7',
        completedJobs: 312,
        address: 'Nairobi Industrial Area, Nairobi, Kenya',
        notes: 'Local maintenance company, 24/7 service',
      },
      {
        organizationId: secondaryOrganization.id,
        name: 'Eco Clean Services',
        email: 'clean@ecoclean.co.ke',
        phone: '+254712345680',
        specialty: 'Cleaner',
        rate: '1500.00',
        currency: 'KES',
        isAvailable: true,
        rating: '4.5',
        completedJobs: 178,
        address: 'Westlands, Nairobi, Kenya',
        notes: 'Professional cleaning services, eco-friendly products',
      },
    ]).returning();

    console.log(`✅ Seeded ${contractorData.length} contractors`);

    // ==================== SEED TENANTS ====================
    console.log('👥 Seeding tenants...');
    const occupiedUnits = unitsResult.filter(unit => unit.isOccupied);
    const tenantData = [];
    const names = [
      'Alice Johnson', 'Bob Smith', 'Carol Davis', 'David Brown',
      'Emma Wilson', 'Frank Miller', 'Grace Taylor', 'Henry Anderson',
      'Ivy Thomas', 'Jack Jackson', 'Kelly White', 'Liam Harris',
      'Mia Martin', 'Noah Thompson', 'Olivia Garcia', 'Paul Martinez',
      'John Kamau', 'Mary Wanjiku', 'James Odhiambo', 'Susan Akinyi',
      'Peter Mwangi', 'Jane Atieno', 'Joseph Omondi', 'Elizabeth Adhiambo',
    ];

    for (let i = 0; i < Math.min(occupiedUnits.length, names.length); i++) {
      const [firstName, lastName] = names[i].split(' ');
      const unit = occupiedUnits[i];
      const property = propertyData.find(p => p.id === unit.propertyId);
      
      tenantData.push({
        organizationId: property?.organizationId || primaryOrganization.id,
        firstName,
        lastName,
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@email.com`,
        phone: property?.organizationId === secondaryOrganization.id 
          ? `+2547${Math.floor(Math.random() * 10000000).toString().padStart(7, '0')}`
          : `+1-555-${(1000 + i).toString().padStart(4, '0')}`,
        unitId: unit.id,
        leaseStartDate: new Date('2024-01-01'),
        leaseEndDate: new Date('2025-01-01'),
        monthlyRent: unit.monthlyRent,
        currency: unit.currency,
        securityDeposit: (parseFloat(unit.monthlyRent) * 1.5).toString(),
        status: 'active',
      });
    }

    const tenantsResult = await db.insert(tenants).values(tenantData).returning();
    console.log(`✅ Seeded ${tenantsResult.length} tenants`);

    // ==================== SEED SERVICE CHARGES ====================
    console.log('💰 Seeding service charges...');
    const serviceChargeData = [];
    for (const property of propertyData) {
      // Property-wide charges
      serviceChargeData.push({
        organizationId: property.organizationId,
        propertyId: property.id,
        unitId: null,
        name: 'Waste Collection',
        type: 'monthly',
        amount: property.organizationId === primaryOrganization.id ? '25.00' : '3000.00',
        currency: property.organizationId === primaryOrganization.id ? 'USD' : 'KES',
        dueDate: new Date('2025-02-01'),
        status: 'pending',
        description: 'Monthly waste collection service',
        isRecurring: true,
      });

      // Unit-specific charges
      const propertyUnits = unitsResult.filter(unit => unit.propertyId === property.id);
      for (const unit of propertyUnits.slice(0, 3)) {
        serviceChargeData.push({
          organizationId: property.organizationId,
          propertyId: property.id,
          unitId: unit.id,
          name: 'Electricity',
          type: 'monthly',
          amount: property.organizationId === primaryOrganization.id 
            ? (Math.floor(Math.random() * 100) + 50).toString()
            : (Math.floor(Math.random() * 5000) + 2000).toString(),
          currency: property.organizationId === primaryOrganization.id ? 'USD' : 'KES',
          dueDate: new Date('2025-02-01'),
          status: 'pending',
          description: 'Monthly electricity bill',
          isRecurring: true,
        });
      }
    }

    const serviceChargesResult = await db.insert(serviceCharges).values(serviceChargeData).returning();
    console.log(`✅ Seeded ${serviceChargesResult.length} service charges`);

    // ==================== SEED RENT PAYMENTS ====================
    console.log('💵 Seeding rent payments...');
    const rentPaymentData = [];
    for (const tenant of tenantsResult) {
      // Current month payment (due)
      rentPaymentData.push({
        organizationId: tenant.organizationId,
        tenantId: tenant.id,
        amount: tenant.monthlyRent!,
        currency: tenant.currency,
        dueDate: new Date('2025-02-01'),
        paidDate: null,
        paymentMethod: null,
        status: 'pending',
        notes: 'February 2025 rent payment',
      });

      // Previous month payment (paid)
      rentPaymentData.push({
        organizationId: tenant.organizationId,
        tenantId: tenant.id,
        amount: tenant.monthlyRent!,
        currency: tenant.currency,
        dueDate: new Date('2025-01-01'),
        paidDate: new Date('2025-01-15'),
        paymentMethod: 'bank_transfer',
        status: 'paid',
        notes: 'January 2025 rent payment',
      });
    }

    const rentPaymentsResult = await db.insert(rentPayments).values(rentPaymentData).returning();
    console.log(`✅ Seeded ${rentPaymentsResult.length} rent payments`);

    // ==================== SEED MAINTENANCE REQUESTS ====================
    console.log('🔧 Seeding maintenance requests...');
    const maintenanceData = [];
    const issues = [
      'Leaking faucet in bathroom',
      'Air conditioning not working',
      'Broken window in living room',
      'Electrical outlet not working',
      'Refrigerator making noise',
      'Toilet won\'t flush properly',
      'Heating not working',
      'Door lock needs repair',
      'Water pump not working',
      'Generator maintenance required',
      'Fence repair needed',
      'Roof leak detected',
    ];

    for (let i = 0; i < Math.min(tenantsResult.length, issues.length); i++) {
      const tenant = tenantsResult[i];
      const contractor = contractorData.find(c => c.organizationId === tenant.organizationId) || contractorData[0];
      
      maintenanceData.push({
        organizationId: tenant.organizationId,
        tenantId: tenant.id,
        unitId: tenant.unitId!,
        contractorId: contractor.id,
        title: issues[i],
        description: `Detailed description of the issue: ${issues[i]}. Tenant reports this happened recently and needs immediate attention.`,
        priority: ['low', 'medium', 'high'][Math.floor(Math.random() * 3)] as any,
        status: ['pending', 'in_progress', 'completed'][Math.floor(Math.random() * 3)] as any,
        assignedTo: '28530769',
        estimatedCost: (Math.floor(Math.random() * 300) + 50).toString(),
        actualCost: Math.random() > 0.5 ? (Math.floor(Math.random() * 300) + 50).toString() : null,
        currency: tenant.currency,
        scheduledDate: new Date(Date.now() + Math.random() * 7 * 24 * 60 * 60 * 1000),
        tenantNotes: 'Please contact before visiting',
        contractorNotes: Math.random() > 0.5 ? 'Materials ordered, will complete by end of week' : null,
      });
    }

    await db.insert(maintenanceRequests).values(maintenanceData);
    console.log(`✅ Seeded ${maintenanceData.length} maintenance requests`);

    // ==================== SEED MPESA TRANSACTIONS ====================
    console.log('📱 Seeding MPesa transactions...');
    const mpesaData = [];
    const completedPayments = rentPaymentsResult.filter(payment => payment.status === 'paid');
    
    for (const payment of completedPayments.slice(0, 5)) {
      const tenant = tenantsResult.find(t => t.id === payment.tenantId);
      if (tenant && tenant.organizationId === secondaryOrganization.id) { // Only for Kenya org
        mpesaData.push({
          organizationId: tenant.organizationId,
          tenantId: tenant.id,
          rentPaymentId: payment.id,
          serviceChargeId: null,
          transactionId: `MP${Date.now()}${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
          phoneNumber: tenant.phone!,
          amount: payment.amount,
          currency: payment.currency,
          status: 'completed',
          mpesaReceiptNumber: `QR${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
          description: `Rent payment for ${tenant.firstName} ${tenant.lastName}`,
          callbackData: {
            ResultCode: 0,
            ResultDesc: 'The service request is processed successfully.',
            MpesaReceiptNumber: `QR${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
          },
        });
      }
    }

    if (mpesaData.length > 0) {
      await db.insert(mpesaTransactions).values(mpesaData);
      console.log(`✅ Seeded ${mpesaData.length} MPesa transactions`);
    }

    // ==================== SEED INVOICE REMINDERS ====================
    console.log('📧 Seeding invoice reminders...');
    const reminderData = [];
    const pendingPayments = rentPaymentsResult.filter(payment => payment.status === 'pending');
    
    for (const payment of pendingPayments.slice(0, 8)) {
      reminderData.push({
        organizationId: payment.organizationId,
        tenantId: payment.tenantId,
        type: 'rent',
        referenceId: payment.id,
        reminderType: 'before_due',
        daysOffset: -3,
        channel: 'email',
        isActive: true,
        lastSent: null,
        nextScheduled: new Date(new Date(payment.dueDate).getTime() - 3 * 24 * 60 * 60 * 1000),
      });
    }

    if (reminderData.length > 0) {
      await db.insert(invoiceReminders).values(reminderData);
      console.log(`✅ Seeded ${reminderData.length} invoice reminders`);
    }

    // ==================== SEED UTILITY PROVIDERS ====================
    console.log('⚡ Seeding utility providers...');
    const utilityProviderData = await db.insert(utilityProviders).values([
      {
        organizationId: primaryOrganization.id,
        name: 'City Power & Light',
        type: 'electricity',
        contactEmail: 'billing@citypower.com',
        contactPhone: '+1-555-0101',
        billingCycle: 'monthly',
        averageRate: '0.12',
        currency: 'USD',
        isActive: true,
      },
      {
        organizationId: primaryOrganization.id,
        name: 'Metro Water Works',
        type: 'water',
        contactEmail: 'service@metrowater.com',
        contactPhone: '+1-555-0102',
        billingCycle: 'monthly',
        averageRate: '3.50',
        currency: 'USD',
        isActive: true,
      },
      {
        organizationId: secondaryOrganization.id,
        name: 'Kenya Power',
        type: 'electricity',
        contactEmail: 'billing@kenyapower.co.ke',
        contactPhone: '+254703000000',
        billingCycle: 'monthly',
        averageRate: '20.50',
        currency: 'KES',
        isActive: true,
      },
      {
        organizationId: secondaryOrganization.id,
        name: 'Nairobi Water',
        type: 'water',
        contactEmail: 'billing@nairobiwater.co.ke',
        contactPhone: '+254703000001',
        billingCycle: 'monthly',
        averageRate: '45.00',
        currency: 'KES',
        isActive: true,
      },
    ]).returning();

    console.log(`✅ Seeded ${utilityProviderData.length} utility providers`);

    // ==================== SEED UTILITY ACCOUNTS ====================
    console.log('📝 Seeding utility accounts...');
    const utilityAccountData = [];
    for (const property of propertyData) {
      const providers = utilityProviderData.filter(p => p.organizationId === property.organizationId);
      for (const provider of providers) {
        utilityAccountData.push({
          organizationId: property.organizationId,
          propertyId: property.id,
          providerId: provider.id,
          accountNumber: `${property.id}${provider.id}${Math.floor(Math.random() * 10000)}`,
          meterNumber: provider.type === 'electricity' || provider.type === 'water' ? `MTR-${Math.floor(Math.random() * 100000)}` : null,
          connectionDate: new Date('2023-01-01'),
          isActive: true,
          notes: `${provider.type} service for ${property.name}`,
        });
      }
    }

    const insertedAccounts = await db.insert(utilityAccounts).values(utilityAccountData).returning();
    console.log(`✅ Seeded ${insertedAccounts.length} utility accounts`);

    // ==================== SEED UTILITY BILLS ====================
    console.log('🧾 Seeding utility bills...');
    const utilityBillData = [];
    for (const account of insertedAccounts) {
      const provider = utilityProviderData.find(p => p.id === account.providerId);
      if (provider) {
        // Generate 6 months of bills
        for (let i = 0; i < 6; i++) {
          const billDate = new Date();
          billDate.setMonth(billDate.getMonth() - i);
          const dueDate = new Date(billDate);
          dueDate.setDate(dueDate.getDate() + 30);

          const baseAmount = parseFloat(provider.averageRate || '50');
          const variation = (Math.random() - 0.5) * 0.4; // ±20% variation
          const amount = (baseAmount * (1 + variation)).toFixed(2);

          utilityBillData.push({
            organizationId: account.organizationId,
            accountId: account.id,
            billNumber: `BILL-${account.id}-${billDate.getFullYear()}${(billDate.getMonth() + 1).toString().padStart(2, '0')}`,
            billingPeriodStart: new Date(billDate.getFullYear(), billDate.getMonth(), 1),
            billingPeriodEnd: new Date(billDate.getFullYear(), billDate.getMonth() + 1, 0),
            dueDate,
            amount,
            currency: provider.currency,
            unitsConsumed: provider.type === 'electricity' ? (Math.random() * 500 + 200).toFixed(0) : 
                           provider.type === 'water' ? (Math.random() * 10000 + 5000).toFixed(0) : null,
            unitRate: provider.averageRate,
            status: i === 0 ? 'pending' : Math.random() > 0.2 ? 'paid' : 'overdue',
            paidDate: i === 0 ? null : Math.random() > 0.2 ? dueDate : null,
          });
        }
      }
    }

    await db.insert(utilityBills).values(utilityBillData);
    console.log(`✅ Seeded ${utilityBillData.length} utility bills`);

    // ==================== SEED BILLING CYCLES ====================
    console.log('📅 Seeding billing cycles...');
    const billingCycleData = [];
    for (const property of propertyData) {
      billingCycleData.push(
        {
          organizationId: property.organizationId,
          propertyId: property.id,
          name: 'Monthly Rent Cycle',
          type: 'rent',
          frequency: 'monthly',
          billingDay: 1,
          dueDay: 5,
          graceDay: 10,
          lateFeeAmount: property.organizationId === primaryOrganization.id ? '50.00' : '5000.00',
          lateFeeType: 'fixed',
          isActive: true,
        },
        {
          organizationId: property.organizationId,
          propertyId: property.id,
          name: 'Service Charges Cycle',
          type: 'service_charges',
          frequency: 'monthly',
          billingDay: 1,
          dueDay: 15,
          graceDay: 5,
          lateFeeAmount: property.organizationId === primaryOrganization.id ? '5.00' : '500.00',
          lateFeeType: 'percentage',
          isActive: true,
        }
      );
    }

    const insertedCycles = await db.insert(billingCycles).values(billingCycleData).returning();
    console.log(`✅ Seeded ${insertedCycles.length} billing cycles`);

    // ==================== SEED RECURRING CHARGES ====================
    console.log('🔄 Seeding recurring charges...');
    const recurringChargeData = [];
    for (const property of propertyData) {
      // Property-wide charges
      recurringChargeData.push(
        {
          organizationId: property.organizationId,
          propertyId: property.id,
          name: 'Property Management Fee',
          type: 'management',
          amount: property.organizationId === primaryOrganization.id ? '200.00' : '20000.00',
          currency: property.organizationId === primaryOrganization.id ? 'USD' : 'KES',
          frequency: 'monthly',
          startDate: new Date('2024-01-01'),
          nextBillDate: new Date('2025-02-01'),
          isActive: true,
          autoGenerate: true,
          description: 'Monthly property management service fee',
        },
        {
          organizationId: property.organizationId,
          propertyId: property.id,
          name: 'Common Area Maintenance',
          type: 'maintenance',
          amount: property.organizationId === primaryOrganization.id ? '150.00' : '15000.00',
          currency: property.organizationId === primaryOrganization.id ? 'USD' : 'KES',
          frequency: 'monthly',
          startDate: new Date('2024-01-01'),
          nextBillDate: new Date('2025-02-01'),
          isActive: true,
          autoGenerate: true,
          description: 'Monthly common area maintenance and cleaning',
        }
      );

      // Unit-specific charges
      const firstFewUnits = unitsResult.filter(u => u.propertyId === property.id).slice(0, 3);
      for (const unit of firstFewUnits) {
        recurringChargeData.push({
          organizationId: property.organizationId,
          propertyId: property.id,
          unitId: unit.id,
          name: 'Parking Fee',
          type: 'parking',
          amount: property.organizationId === primaryOrganization.id ? '75.00' : '7500.00',
          currency: property.organizationId === primaryOrganization.id ? 'USD' : 'KES',
          frequency: 'monthly',
          startDate: new Date('2024-01-01'),
          nextBillDate: new Date('2025-02-01'),
          isActive: true,
          autoGenerate: true,
          description: `Monthly parking fee for unit ${unit.unitNumber}`,
        });
      }
    }

    await db.insert(recurringCharges).values(recurringChargeData);
    console.log(`✅ Seeded ${recurringChargeData.length} recurring charges`);

    // ==================== SEED INVOICES ====================
    console.log('🧾 Seeding invoices...');
    const invoiceData = [];
    const invoiceStatuses = ['pending', 'paid', 'overdue', 'cancelled'];
    
    for (let i = 0; i < 20; i++) {
      const property = propertyData[Math.floor(Math.random() * propertyData.length)];
      const unit = unitsResult.find(u => u.propertyId === property.id);
      const tenant = tenantsResult.find(t => t.unitId === unit?.id);
      
      const issueDate = new Date();
      issueDate.setDate(issueDate.getDate() - Math.floor(Math.random() * 90));
      const dueDate = new Date(issueDate);
      dueDate.setDate(dueDate.getDate() + 30);
      
      const amount = (Math.random() * 1000 + 500).toFixed(2);
      const status = invoiceStatuses[Math.floor(Math.random() * invoiceStatuses.length)];
      
      invoiceData.push({
        organizationId: property.organizationId,
        invoiceNumber: `INV-${Date.now()}-${i}`,
        tenantId: tenant?.id || null,
        propertyId: property.id,
        unitId: unit?.id || null,
        type: Math.random() > 0.5 ? 'rent' : 'service_charges',
        amount,
        currency: property.organizationId === primaryOrganization.id ? 'USD' : 'KES',
        issueDate,
        dueDate,
        status,
        paidDate: status === 'paid' ? dueDate : null,
        description: `Invoice for ${Math.random() > 0.5 ? 'monthly rent' : 'service charges'}`,
        lineItems: [{
          description: 'Monthly charge',
          amount: parseFloat(amount),
          quantity: 1,
          unitPrice: parseFloat(amount)
        }],
        taxAmount: '0.00',
        discountAmount: '0.00',
        totalAmount: amount,
        remindersSent: Math.floor(Math.random() * 3),
      });
    }

    await db.insert(invoices).values(invoiceData);
    console.log(`✅ Seeded ${invoiceData.length} invoices`);

    // ==================== SEED SECURITY & COMPLIANCE ====================
    console.log('🔒 Seeding security & compliance data...');
    
    const encryptionKeyData = await db.insert(encryptionKeys).values([
      {
        organizationId: primaryOrganization.id,
        keyId: 'data_encryption_v1',
        keyType: 'AES-256-GCM',
        purpose: 'data',
        encryptedKey: 'encrypted_key_data_placeholder_1',
        keyVersion: 1,
        isActive: true,
      },
      {
        organizationId: secondaryOrganization.id,
        keyId: 'data_encryption_v1',
        keyType: 'AES-256-GCM',
        purpose: 'data',
        encryptedKey: 'encrypted_key_data_placeholder_2',
        keyVersion: 1,
        isActive: true,
      },
    ]).returning();

    const trustAccountData = await db.insert(trustAccounts).values([
      {
        organizationId: primaryOrganization.id,
        accountNumber: 'TR-001-2025',
        accountName: 'Smart Prop Trust Account',
        bankName: 'First National Bank',
        accountType: 'trust',
        balance: '285000.00',
        fsca_compliant: true,
        regulatoryId: 'FSCA-TR-2025-001',
      },
      {
        organizationId: secondaryOrganization.id,
        accountNumber: 'TR-002-2025',
        accountName: 'Premium Real Estate Escrow',
        bankName: 'Kenya Commercial Bank',
        accountType: 'trust',
        balance: '1250000.00',
        fsca_compliant: true,
        regulatoryId: 'CBK-TR-2025-002',
      },
    ]).returning();

    await db.insert(securityIncidents).values([
      {
        organizationId: primaryOrganization.id,
        incidentType: 'unauthorized_access',
        severity: 'medium',
        description: 'Multiple failed login attempts detected',
        status: 'resolved',
        assignedTo: '28530769',
        resolutionNotes: 'IP address blocked, user account secured',
        resolvedAt: new Date(),
      },
      {
        organizationId: secondaryOrganization.id,
        incidentType: 'data_breach_attempt',
        severity: 'low',
        description: 'Suspicious API calls detected',
        status: 'investigating',
        assignedTo: '28530769',
      },
    ]);

    await db.insert(auditLogs).values([
      {
        organizationId: primaryOrganization.id,
        userId: '28530769',
        entityType: 'properties',
        entityId: '1',
        action: 'CREATE',
        newValues: { name: 'Sunset Gardens Apartments' },
        ipAddress: '192.168.1.10',
        userAgent: 'Mozilla/5.0 Browser',
        sessionId: 'sess_123456',
      },
      {
        organizationId: secondaryOrganization.id,
        userId: '28530769',
        entityType: 'tenants',
        entityId: '1',
        action: 'CREATE',
        newValues: { firstName: 'John', lastName: 'Kamau' },
        ipAddress: '192.168.1.20',
        userAgent: 'Mozilla/5.0 Browser',
        sessionId: 'sess_789012',
      },
    ]);

    console.log('✅ Seeded security & compliance data');

    // ==================== FINAL SUMMARY ====================
    console.log('\n🎉 Database seeded successfully!');
    console.log('📊 Seeding Summary:');
    console.log(`  Organizations: ${organizationData.length}`);
    console.log(`  Properties: ${propertyData.length}`);
    console.log(`  Units: ${unitsResult.length}`);
    console.log(`  Tenants: ${tenantsResult.length}`);
    console.log(`  Contractors: ${contractorData.length}`);
    console.log(`  Service Charges: ${serviceChargesResult.length}`);
    console.log(`  Rent Payments: ${rentPaymentsResult.length}`);
    console.log(`  Maintenance Requests: ${maintenanceData.length}`);
    console.log(`  MPesa Transactions: ${mpesaData.length}`);
    console.log(`  Invoice Reminders: ${reminderData.length}`);
    console.log(`  Utility Providers: ${utilityProviderData.length}`);
    console.log(`  Utility Accounts: ${insertedAccounts.length}`);
    console.log(`  Utility Bills: ${utilityBillData.length}`);
    console.log(`  Billing Cycles: ${insertedCycles.length}`);
    console.log(`  Recurring Charges: ${recurringChargeData.length}`);
    console.log(`  Invoices: ${invoiceData.length}`);
    console.log(`\n🏢 Primary Organization ID: ${primaryOrganization.id}`);
    console.log(`🏢 Secondary Organization ID: ${secondaryOrganization.id}`);

  } catch (error) {
    console.error('❌ Error seeding database:', error);
    throw error;
  }
}

// Run seeding if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  seedDatabase()
    .then(() => {
      console.log('\n✅ Seeding completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Seeding failed:', error);
      process.exit(1);
    });
}