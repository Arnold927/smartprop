# Compound Billing Fix — Change Log

## What was fixed

### 1. Currency default: USD → KES (`shared/schema.ts`)
- `serviceCharges.currency` default changed from `"USD"` to `"KES"`
- `rentPayments.currency` default changed from `"USD"` to `"KES"`
- Eliminates the silent data-bug where new records created without an explicit
  currency would be tagged USD and display incorrectly in reports.

### 2. Table disambiguation (`shared/schema.ts`)
- Added clear doc-comments above both `serviceCharges` and `recurringCharges`
  explaining exactly which table to use for what purpose:
  - **`recurring_charges`** — canonical table for scheduled levies (generator,
    water, service charges). The scheduler queries this. Use `autoGenerate=true`.
  - **`service_charges`** — legacy table for ad-hoc / one-off charges only.
- Prevents new managers from creating generator levies in the wrong table.

### 3. Itemized `lineItems` on `rentPayments` (`shared/schema.ts`)
- Added `lineItems: json("line_items")` column to `rentPayments`.
- Type: `Array<{ description: string; amount: number; type: string }>`.
- Allows the scheduler to store a full per-charge breakdown alongside the
  invoice total.

### 4. Compound invoice generation (`server/services/rentScheduler.ts`)
- `generateMonthlyRentInvoices()` now calls
  `storage.getRecurringChargesForUnit(unitId, propertyId)` for every tenant.
- Line items are assembled: `[{ Monthly Rent, baseRent }, ...recurringCharges]`.
- The invoice `amount` becomes the **sum** of all line items — rent + generator
  levy + water levy + service charges — rather than the flat rent figure.
- If a tenant has no recurring charges, behaviour is identical to before (one
  line item, same total).

### 5. Unit-scoped recurring charge query (`server/storage.ts`)
- New method `getRecurringChargesForUnit(unitId, propertyId)` on both
  `IStorage` interface and `DatabaseStorage` implementation.
- Returns charges where `unit_id = <unitId>` **OR** `unit_id IS NULL`
  (property-wide levies), filtered to `is_active = true`.
- Index `idx_recurring_charges_unit_property` added in migration for
  performance.

### 6. Tenant portal — itemized invoice display
  (`client/src/pages/tenant-portal.tsx`)
- **Payment history list**: each invoice card now shows a collapsible line-item
  table (e.g. "Monthly Rent KES 75,000 / Generator KES 3,000 / Water KES 2,000")
  when the invoice has more than one line item.
- **Next-due card** (dashboard home tab): expands to show a "Charge Breakdown"
  section with individual line items and a bold Total row, so tenants see the
  full picture before paying.

### 7. Migration (`migrations/fix_compound_billing.sql`)
- Alters `service_charges.currency` and `rent_payments.currency` defaults.
- Backfills existing NULL/USD rows to KES.
- Adds `line_items JSONB` column to `rent_payments`.
- Backfills existing invoices with a synthetic `[{ Monthly Rent, amount }]`
  line item so old records display consistently.
- Creates performance index on `recurring_charges`.

## How to deploy

```bash
# 1. Apply the migration
psql $DATABASE_URL -f migrations/fix_compound_billing.sql

# 2. Restart the server (scheduler picks up new logic on next 07:00 EAT run)
npm run build && npm start
```

## What is NOT changed
- The `invoices` table (separate from `rentPayments`) is unchanged — it already
  had a `lineItems` column; the scheduler change populates the equivalent field
  on `rentPayments` where rent invoices live.
- No UI changes to the manager-facing billing pages — recurring charges are
  already manageable there.
- No changes to M-Pesa payment flows — the `amount` field on an invoice still
  represents the full payable total.
