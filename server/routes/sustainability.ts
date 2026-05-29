/**
 * sustainability.ts — mounted at /api/sustainability
 *
 * Powers the sustainability-esg.tsx page. Provides all 5 GET endpoints
 * the page calls, plus write endpoints for metrics and reports.
 *
 *   GET  /api/sustainability/esg-metrics          org-level metrics list
 *   POST /api/sustainability/esg-metrics          record new monthly metrics
 *   PATCH /api/sustainability/esg-metrics/:id     update metrics
 *   GET  /api/sustainability/reports              ESG report documents
 *   POST /api/sustainability/reports              create report record
 *   GET  /api/sustainability/green-materials      approved green materials list
 *   POST /api/sustainability/green-materials      add material
 *   GET  /api/sustainability/supply-chain         expense-based supply chain view
 *   GET  /api/sustainability/data-integrations    integration status stubs
 */

import { Router }    from "express";
import { db, pool }  from "../db";
import {
  esgMetrics, esgReports, greenMaterials,
  propertyExpenses, properties,
} from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg }      from "../middleware/requireOrg";

const router = Router();
const auth   = [authenticateJWT as any, requireOrg as any];

// ── GET /api/sustainability/esg-metrics ───────────────────────────────────────
router.get("/esg-metrics", ...auth, async (req: any, res: any) => {
  try {
    const orgId      = req.user.organizationId;
    const propertyId = req.query.propertyId ? parseInt(req.query.propertyId as string) : null;
    const year       = req.query.year       ? parseInt(req.query.year       as string) : null;

    const conditions: any[] = [eq(esgMetrics.organizationId, orgId)];
    if (propertyId) conditions.push(eq(esgMetrics.propertyId, propertyId));
    if (year)       conditions.push(eq(esgMetrics.periodYear,  year));

    const rows = await db
      .select({
        id:              esgMetrics.id,
        propertyId:      esgMetrics.propertyId,
        periodYear:      esgMetrics.periodYear,
        periodMonth:     esgMetrics.periodMonth,
        electricityKwh:  esgMetrics.electricityKwh,
        solarKwh:        esgMetrics.solarKwh,
        generatorLitres: esgMetrics.generatorLitres,
        waterM3:         esgMetrics.waterM3,
        rainwaterM3:     esgMetrics.rainwaterM3,
        wasteKg:         esgMetrics.wasteKg,
        recycledKg:      esgMetrics.recycledKg,
        carbonKgco2e:    esgMetrics.carbonKgco2e,
        energyScore:     esgMetrics.energyScore,
        waterScore:      esgMetrics.waterScore,
        wasteScore:      esgMetrics.wasteScore,
        overallScore:    esgMetrics.overallScore,
        notes:           esgMetrics.notes,
        createdAt:       esgMetrics.createdAt,
        propertyName:    properties.name,
      })
      .from(esgMetrics)
      .leftJoin(properties, eq(esgMetrics.propertyId, properties.id))
      .where(and(...conditions))
      .orderBy(desc(esgMetrics.periodYear), desc(esgMetrics.periodMonth));

    // Compute portfolio aggregate for the dashboard summary
    const totals = rows.reduce((acc, r) => ({
      electricityKwh:  acc.electricityKwh  + Number(r.electricityKwh  ?? 0),
      solarKwh:        acc.solarKwh        + Number(r.solarKwh        ?? 0),
      waterM3:         acc.waterM3         + Number(r.waterM3         ?? 0),
      wasteKg:         acc.wasteKg         + Number(r.wasteKg         ?? 0),
      recycledKg:      acc.recycledKg      + Number(r.recycledKg      ?? 0),
      carbonKgco2e:    acc.carbonKgco2e    + Number(r.carbonKgco2e    ?? 0),
    }), { electricityKwh: 0, solarKwh: 0, waterM3: 0, wasteKg: 0, recycledKg: 0, carbonKgco2e: 0 });

    const avgScore = rows.length > 0
      ? Math.round(rows.reduce((s, r) => s + Number(r.overallScore ?? 0), 0) / rows.length)
      : null;

    res.json({ metrics: rows, totals, avgScore, count: rows.length });
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// ── POST /api/sustainability/esg-metrics ──────────────────────────────────────
router.post("/esg-metrics", ...auth, async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId;

    // Compute simple scores (0-100) from the input values
    const elec  = Number(req.body.electricityKwh  ?? 0);
    const solar = Number(req.body.solarKwh         ?? 0);
    const waste = Number(req.body.wasteKg          ?? 0);
    const recyc = Number(req.body.recycledKg        ?? 0);

    const solarRatio   = elec > 0 ? solar / (elec + solar) : 0;
    const recycleRatio = waste > 0 ? recyc / waste : 0;

    const energyScore = Math.round(Math.min(100, 40 + solarRatio * 60));
    const wasteScore  = Math.round(Math.min(100, recycleRatio * 100));
    const waterScore  = req.body.rainwaterM3 && req.body.waterM3 > 0
      ? Math.round(Math.min(100, 40 + (Number(req.body.rainwaterM3) / Number(req.body.waterM3)) * 60))
      : 50;

    const overallScore = Math.round((energyScore + waterScore + wasteScore) / 3);

    // Rough carbon estimate: grid electricity 0.4 kgCO2e/kWh, generator 2.7 kgCO2e/L
    const carbonKgco2e = elec * 0.4 + Number(req.body.generatorLitres ?? 0) * 2.7;

    const [created] = await db.insert(esgMetrics).values({
      ...req.body,
      organizationId: orgId,
      energyScore,
      waterScore,
      wasteScore,
      overallScore,
      carbonKgco2e: String(Math.round(carbonKgco2e * 100) / 100),
    } as any).returning();

    res.status(201).json(created);
  } catch (err: any) { res.status(400).json({ message: err.message }); }
});

// ── PATCH /api/sustainability/esg-metrics/:id ─────────────────────────────────
router.patch("/esg-metrics/:id", ...auth, async (req: any, res: any) => {
  try {
    const [updated] = await db
      .update(esgMetrics)
      .set({ ...req.body, updatedAt: new Date() })
      .where(and(
        eq(esgMetrics.id, parseInt(req.params.id)),
        eq(esgMetrics.organizationId, req.user.organizationId),
      ))
      .returning();
    if (!updated) return res.status(404).json({ message: "Metric not found" });
    res.json(updated);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// ── GET /api/sustainability/reports ───────────────────────────────────────────
router.get("/reports", ...auth, async (req: any, res: any) => {
  try {
    const result = await pool.query(
      `SELECT * FROM esg_reports
        WHERE organization_id = $1
        ORDER BY created_at DESC`,
      [req.user.organizationId]
    );
    // Normalise snake_case → camelCase for new columns
    const rows = result.rows.map((r: any) => ({
      ...r,
      reportType:     r.report_type,
      periodLabel:    r.period_label,
      reportUrl:      r.report_url,
      fileUrl:        r.file_url,
      createdAt:      r.created_at,
      organizationId: r.organization_id,
      createdBy:      r.created_by,
    }));
    res.json(rows);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// ── POST /api/sustainability/reports ─────────────────────────────────────────
router.post("/reports", ...auth, async (req: any, res: any) => {
  try {
    const [created] = await db.insert(esgReports).values({
      ...req.body,
      organizationId: req.user.organizationId,
      createdBy:      req.user.id,
    } as any).returning();
    res.status(201).json(created);
  } catch (err: any) { res.status(400).json({ message: err.message }); }
});

// ── GET /api/sustainability/green-materials ───────────────────────────────────
router.get("/green-materials", ...auth, async (req: any, res: any) => {
  try {
    const rows = await db
      .select()
      .from(greenMaterials)
      .where(eq(greenMaterials.organizationId, req.user.organizationId))
      .orderBy(desc(greenMaterials.createdAt));
    res.json(rows);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// ── POST /api/sustainability/green-materials ──────────────────────────────────
router.post("/green-materials", ...auth, async (req: any, res: any) => {
  try {
    const [created] = await db.insert(greenMaterials).values({
      ...req.body,
      organizationId: req.user.organizationId,
    } as any).returning();
    res.status(201).json(created);
  } catch (err: any) { res.status(400).json({ message: err.message }); }
});

// ── GET /api/sustainability/supply-chain ─────────────────────────────────────
// Derives supply chain data from property expenses — shows vendor spend,
// and flags vendors by category for sustainability review.
router.get("/supply-chain", ...auth, async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId;

    // Aggregate spend by vendor and category, scoped to this org via the properties join
    const spendRows = await db
      .select({
        vendorName:   propertyExpenses.vendorName,
        category:     propertyExpenses.category,
        totalSpend:   sql<string>`SUM(${propertyExpenses.amount})`,
        invoiceCount: sql<string>`COUNT(*)`,
        lastUsed:     sql<string>`MAX(${propertyExpenses.expenseDate})`,
      })
      .from(propertyExpenses)
      .innerJoin(properties, eq(propertyExpenses.propertyId, properties.id))
      .where(eq(properties.organizationId, orgId))
      .groupBy(propertyExpenses.vendorName, propertyExpenses.category)
      .orderBy(sql`SUM(${propertyExpenses.amount}) DESC`)
      .limit(50);

    // Group by category for the chart
    const byCategory = spendRows.reduce((acc: any, r) => {
      const cat = r.category ?? "other";
      if (!acc[cat]) acc[cat] = { category: cat, totalSpend: 0, vendorCount: 0 };
      acc[cat].totalSpend  += Number(r.totalSpend ?? 0);
      acc[cat].vendorCount += 1;
      return acc;
    }, {});

    res.json({
      vendors:    spendRows,
      byCategory: Object.values(byCategory),
      totalVendors: spendRows.length,
      totalSpend: spendRows.reduce((s, r) => s + Number(r.totalSpend ?? 0), 0),
    });
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// ── GET /api/sustainability/data-integrations ────────────────────────────────
// Returns integration status stubs. Actual integrations (smart meters, IoT)
// would be connected via webhooks; this endpoint reports their config status.
router.get("/data-integrations", ...auth, async (req: any, res: any) => {
  try {
    // Read integration flags from org settings if available; otherwise return stubs
    const integrations = [
      {
        id:          "smart_meter",
        name:        "Smart Electricity Meters",
        provider:    "Kenya Power Smart Grid",
        status:      "manual",        // connected | manual | not_configured
        description: "Automatic kWh readings from smart meters. Currently entering manually.",
        lastSync:    null,
        configUrl:   "/settings/integrations#smart-meter",
      },
      {
        id:          "water_meter",
        name:        "Water Meter Readings",
        provider:    "Nairobi City Water",
        status:      "manual",
        description: "Water consumption data. Currently entering manually from meter readings.",
        lastSync:    null,
        configUrl:   "/settings/integrations#water-meter",
      },
      {
        id:          "waste_contractor",
        name:        "Waste Contractor Reports",
        provider:    "Waste contractor",
        status:      "manual",
        description: "Monthly waste and recycling volumes from your waste contractor.",
        lastSync:    null,
        configUrl:   "/settings/integrations#waste",
      },
      {
        id:          "solar_inverter",
        name:        "Solar Inverter Monitoring",
        provider:    "SolarEdge / Fronius",
        status:      "not_configured",
        description: "Real-time solar generation data via inverter API.",
        lastSync:    null,
        configUrl:   "/settings/integrations#solar",
      },
    ];

    res.json(integrations);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// ── GET /api/sustainability/reports/:id ──────────────────────────────────────
// Raw pool query so content + file_url (added via ALTER TABLE) are returned.
router.get("/reports/:id", ...auth, async (req: any, res: any) => {
  try {
    const result = await pool.query(
      `SELECT * FROM esg_reports
        WHERE id = $1 AND organization_id = $2
        LIMIT 1`,
      [parseInt(req.params.id), req.user.organizationId]
    );
    const report = result.rows[0];
    if (!report) return res.status(404).json({ message: "Report not found" });
    // Snake_case → camelCase for the two new columns so frontend gets consistent shape
    res.json({
      ...report,
      reportType:  report.report_type,
      periodLabel: report.period_label,
      reportUrl:   report.report_url,
      fileUrl:     report.file_url,
      createdAt:   report.created_at,
      organizationId: report.organization_id,
      createdBy:   report.created_by,
    });
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// ── PATCH /api/sustainability/reports/:id ────────────────────────────────────
// Uses raw pool query so columns added via ALTER TABLE (content, file_url)
// are written even though they are not yet in the Drizzle schema definition.
router.patch("/reports/:id", ...auth, async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId as number;
    const id    = parseInt(req.params.id);

    // Map camelCase body fields → snake_case DB columns explicitly
    const colMap: Record<string, string> = {
      status:      "status",
      title:       "title",
      reportType:  "report_type",
      periodLabel: "period_label",
      reportUrl:   "report_url",
      highlights:  "highlights",
      content:     "content",
      fileUrl:     "file_url",
    };

    const setCols: string[] = [];
    const vals:    any[]    = [];

    for (const [bodyKey, colName] of Object.entries(colMap)) {
      if (req.body[bodyKey] !== undefined) {
        vals.push(req.body[bodyKey]);
        setCols.push(`"${colName}" = $${vals.length}`);
      }
    }

    if (setCols.length === 0) {
      return res.status(400).json({ message: "No valid fields to update" });
    }

    vals.push(id, orgId);
    const query = `
      UPDATE esg_reports
         SET ${setCols.join(", ")}
       WHERE id = $${vals.length - 1}
         AND organization_id = $${vals.length}
      RETURNING *`;

    const result = await pool.query(query, vals);
    const updated = result.rows[0];
    if (!updated) return res.status(404).json({ message: "Report not found" });
    res.json(updated);
  } catch (err: any) {
    console.error("PATCH /reports/:id error:", err);
    res.status(500).json({ message: err.message });
  }
});

// ── PATCH /api/sustainability/green-materials/:id ─────────────────────────────
router.patch("/green-materials/:id", ...auth, async (req: any, res: any) => {
  try {
    const [updated] = await db
      .update(greenMaterials)
      .set({ ...req.body })
      .where(and(
        eq(greenMaterials.id, parseInt(req.params.id)),
        eq(greenMaterials.organizationId, req.user.organizationId),
      ))
      .returning();
    if (!updated) return res.status(404).json({ message: "Material not found" });
    res.json(updated);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

export default router;