/**
 * server/storage/index.ts — Storage layer barrel
 *
 * Re-exports the storage singleton so all existing
 *   import { storage } from "../storage"
 * calls continue to work without any changes.
 *
 * The DatabaseStorage class has been split into domain modules:
 *   storage/users.ts         — user auth, invites, sessions
 *   storage/properties.ts    — properties, units
 *   storage/tenants.ts       — tenants, leases, deposits
 *   storage/maintenance.ts   — maintenance requests, work orders, projects
 *   storage/payments.ts      — rent payments, M-Pesa, invoices, billing
 *   storage/finance.ts       — general ledger, reports, trust accounts
 *   storage/utilities.ts     — utility providers, accounts, bills, meters
 *   storage/communications.ts— messages, notifications, broadcast
 *   storage/caretakers.ts    — caretaker records
 *   storage/workforce.ts     — staff, payroll, time tracking
 *
 * The class still implements IStorage (interface unchanged).
 * Route files import only `storage` — they never import domain modules directly.
 */

// Re-export everything from the main file so the split is transparent
export { storage, DatabaseStorage } from "../storage";
export type { IStorage } from "../storage";
