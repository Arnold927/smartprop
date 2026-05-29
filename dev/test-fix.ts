// Temporary testing and debugging script
import { storage } from "../server/storage";

async function testCriticalFunctions() {
  console.log("=== SMART PROP SYSTEM DEBUG ===");
  
  try {
    // Test 1: Dashboard metrics
    console.log("\n1. Testing Dashboard Metrics...");
    const metrics = await storage.getDashboardMetrics("28530769");
    console.log("✓ Dashboard metrics:", JSON.stringify(metrics, null, 2));
    
    // Test 2: Tenant Portal Data
    console.log("\n2. Testing Tenant Portal...");
    try {
      const tenantDashboard = await storage.getTenantDashboard(1);
      console.log("✓ Tenant dashboard:", JSON.stringify(tenantDashboard, null, 2));
    } catch (error) {
      console.log("✗ Tenant dashboard error:", (error as Error).message);
    }
    
    // Test 3: Landlord Portfolio
    console.log("\n3. Testing Landlord Portfolio...");
    try {
      const portfolioReports = await storage.getPortfolioReports("user1");
      console.log("✓ Portfolio reports:", portfolioReports.length, "reports found");
    } catch (error) {
      console.log("✗ Portfolio reports error:", (error as Error).message);
    }
    
    // Test 4: Properties Data
    console.log("\n4. Testing Properties...");
    const properties = await storage.getProperties("28530769");
    console.log("✓ Properties found:", properties.length);
    
    // Test 5: Maintenance System
    console.log("\n5. Testing Maintenance...");
    const maintenance = await storage.getMaintenanceRequests(28530769);
    console.log("✓ Maintenance requests:", maintenance.length);
    
    // Test 6: Security Operations
    console.log("\n6. Testing Security...");
    try {
      const visitors = await storage.getVisitorAccessRecords("28530769");
      console.log("✓ Visitor records:", visitors.length);
    } catch (error) {
      console.log("✗ Visitor records error:", (error as Error).message);
    }
    
    console.log("\n=== DEBUG COMPLETE ===");
    
  } catch (error) {
    console.error("Critical system error:", error);
  }
}

testCriticalFunctions();