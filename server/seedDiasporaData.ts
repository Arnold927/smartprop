import { db } from "./db";
import { users, properties, units, tenants, rentPayments } from "@shared/schema";

export async function seedDiasporaData() {
  try {
    console.log("🌍 Seeding Diaspora Rent-to-Own data...");

    // Create Diaspora-specific users
    const diasporaUsers = [
      {
        id: "DIASPORA001",
        email: "james.mwangi@gmail.com",
        firstName: "James",
        lastName: "Mwangi",
        profileImageUrl: "https://api.dicebear.com/7.x/avatars/svg?seed=james",
        passwordHash: "",
      },
      {
        id: "DIASPORA002",
        email: "mary.wanjiku@hotmail.com",
        firstName: "Mary",
        lastName: "Wanjiku",
        profileImageUrl: "https://api.dicebear.com/7.x/avatars/svg?seed=mary",
        passwordHash: "",
      },
      {
        id: "DIASPORA003",
        email: "peter.kamau@yahoo.com",
        firstName: "Peter",
        lastName: "Kamau",
        profileImageUrl: "https://api.dicebear.com/7.x/avatars/svg?seed=peter",
        passwordHash: "",
      },
      {
        id: "DIASPORA004",
        email: "grace.njeri@outlook.com",
        firstName: "Grace",
        lastName: "Njeri",
        profileImageUrl: "https://api.dicebear.com/7.x/avatars/svg?seed=grace",
        passwordHash: "",
      },
      {
        id: "DIASPORA005",
        email: "david.kimani@gmail.com",
        firstName: "David",
        lastName: "Kimani",
        profileImageUrl: "https://api.dicebear.com/7.x/avatars/svg?seed=david",
        passwordHash: "",
      },
    ];

    await db.insert(users).values(diasporaUsers).onConflictDoNothing();
    console.log(`✅ Inserted ${diasporaUsers.length} diaspora users`);

    // Create Diaspora-focused properties
    const diasporaProperties = [
      {
        organizationId: 1,
        name: "Diaspora Gardens Nairobi",
        address: "Kilimani Road, Nairobi",
        totalUnits: 48,
        ownerId: "DIASPORA001",
        description: "Luxury apartments designed for diaspora professionals returning to Kenya. Premium finishes, modern amenities, and flexible payment plans.",
      },
      {
        organizationId: 1,
        name: "Global Heights Mombasa",
        address: "Nyali Beach Road, Mombasa",
        totalUnits: 36,
        ownerId: "DIASPORA002",
        description: "Oceanfront mixed-use development catering to diaspora investors. Commercial spaces on ground floor, residential units above.",
      },
      {
        organizationId: 1,
        name: "Heritage Court Kisumu",
        address: "Milimani Estate, Kisumu",
        totalUnits: 24,
        ownerId: "DIASPORA003",
        description: "Gated community of modern townhouses with diaspora-friendly financing and remote management systems.",
      },
    ];

    const insertedProperties = await db.insert(properties).values(diasporaProperties).returning();
    console.log(`✅ Inserted ${insertedProperties.length} diaspora properties`);

    // Create units for diaspora properties
    const diasporaUnits = [];

    for (const property of insertedProperties) {
      const unitsPerProperty = property.totalUnits;
      // Derive city from address string since schema has no city column
      const cityInAddress = property.address.toLowerCase();
      const baseRent = cityInAddress.includes("nairobi") ? 85000
        : cityInAddress.includes("mombasa") ? 75000
        : 65000;

      for (let i = 1; i <= unitsPerProperty; i++) {
        const unitType = i <= Math.floor(unitsPerProperty * 0.4) ? "1_bedroom" :
                        i <= Math.floor(unitsPerProperty * 0.8) ? "2_bedroom" : "3_bedroom";
        const multiplier = unitType === "1_bedroom" ? 1 : unitType === "2_bedroom" ? 1.4 : 1.8;

        diasporaUnits.push({
          organizationId: property.organizationId,
          propertyId: property.id,
          unitNumber: `${property.name.split(' ')[0].toUpperCase()}-${String(i).padStart(3, '0')}`,
          bedrooms: unitType === "1_bedroom" ? 1 : unitType === "2_bedroom" ? 2 : 3,
          bathrooms: unitType === "1_bedroom" ? "1" : "2",
          sqft: unitType === "1_bedroom" ? 650 : unitType === "2_bedroom" ? 900 : 1200,
          monthlyRent: String(Math.round(baseRent * multiplier)),
          currency: "KES",
          isOccupied: Math.random() > 0.25,
        });
      }
    }

    const insertedUnits = await db.insert(units).values(diasporaUnits).returning();
    console.log(`✅ Inserted ${insertedUnits.length} diaspora units`);

    // Create diaspora tenants
    const occupiedUnits = insertedUnits.filter(unit => unit.isOccupied);
    const diasporaTenants = [];

    for (let i = 0; i < occupiedUnits.length && i < diasporaUsers.length; i++) {
      const unit = occupiedUnits[i];
      const user = diasporaUsers[i % diasporaUsers.length];

      diasporaTenants.push({
        organizationId: unit.organizationId,
        userId: user.id,
        unitId: unit.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: `+254-70${Math.floor(Math.random() * 10)}-${Math.floor(Math.random() * 1000000).toString().padStart(6, '0')}`,
        leaseStartDate: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        leaseEndDate: new Date(Date.now() + (Math.random() * 730 + 365) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        monthlyRent: unit.monthlyRent,
        currency: "KES",
        securityDeposit: String(Number(unit.monthlyRent) * 2),
        status: "active",
      });
    }

    if (diasporaTenants.length > 0) {
      const insertedTenants = await db.insert(tenants).values(diasporaTenants).returning();
      console.log(`✅ Inserted ${insertedTenants.length} diaspora tenants`);

      // Create rent payment history for diaspora tenants
      const diasporaPayments = [];
      const currentDate = new Date();
      const rentDueDay = 5; // 5th of each month

      for (const tenant of insertedTenants) {
        const paymentMethod = Math.random() > 0.5 ? "mpesa" : "bank_transfer";

        // Create 6 months of payment history
        for (let month = 0; month < 6; month++) {
          const dueDateObj = new Date(currentDate.getFullYear(), currentDate.getMonth() - month, rentDueDay);
          const isLate = Math.random() > 0.9;
          const paidDateObj = new Date(dueDateObj);
          if (isLate) paidDateObj.setDate(paidDateObj.getDate() + Math.floor(Math.random() * 10) + 1);

          const status = month === 0 && Math.random() > 0.8 ? "pending" : "paid";

          diasporaPayments.push({
            tenantId: tenant.id,
            amount: tenant.monthlyRent ?? "0",
            currency: "KES",
            dueDate: dueDateObj.toISOString().split('T')[0],
            paidDate: status === "paid" ? paidDateObj.toISOString().split('T')[0] : null,
            paymentMethod,
            status,
            notes: status === "paid"
              ? (paymentMethod === "mpesa" ? "M-PESA payment confirmed" : "Bank transfer received")
              : "Payment pending",
          });
        }
      }

      if (diasporaPayments.length > 0) {
        await db.insert(rentPayments).values(diasporaPayments);
        console.log(`✅ Inserted ${diasporaPayments.length} diaspora rent payments`);
      }
    }

    console.log("🎉 Diaspora data seeded successfully!");
    return {
      users: diasporaUsers.length,
      properties: insertedProperties.length,
      units: insertedUnits.length,
      tenants: diasporaTenants.length,
      payments: diasporaTenants.length * 6
    };

  } catch (error) {
    console.error("❌ Error seeding diaspora data:", error);
    throw error;
  }
}

// Run if called directly
if (process.argv[1] && process.argv[1].endsWith("seedDiasporaData.ts")) {
  seedDiasporaData()
    .then(result => {
      console.log("✅ Diaspora seeding completed:", result);
      process.exit(0);
    })
    .catch(error => {
      console.error("❌ Diaspora seeding failed:", error);
      process.exit(1);
    });
}