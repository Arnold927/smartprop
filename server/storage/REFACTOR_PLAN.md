# storage.ts Refactor Plan

## Current state
`server/storage.ts` is a 7,400-line god-object (`DatabaseStorage` class) with 404 async methods 
across 10+ domains. It implements `IStorage` interface (lines 1–389) and the class (lines 390–7429).

## Goal
Split into domain modules under `server/storage/` so each file is ≤800 lines and covers one domain.
**All 19 route files continue using `import { storage } from "../storage"` unchanged.**

## Approach: incremental mixin pattern

Each domain module exports a `mixin(Base)` function that adds domain methods to a base class.
The final `DatabaseStorage` in `storage.ts` is assembled from all mixins:

```typescript
// storage/payments.ts
export function PaymentsMixin<T extends Constructor>(Base: T) {
  return class extends Base {
    async createRentPayment(...) { ... }
    async getRentPayments(...) { ... }
    // ... all payment methods
  };
}

// storage.ts (after refactor)
import { PaymentsMixin }   from "./storage/payments";
import { MaintenanceMixin } from "./storage/maintenance";
// ...
export class DatabaseStorage extends
  PaymentsMixin(MaintenanceMixin(PropertiesMixin(BaseStorage))) {}
```

## Domain boundaries

| File | Methods | Line range (approx) |
|------|---------|---------------------|
| `storage/users.ts`          | ~29 | getUser, getUserByEmail, upsertUser, invite, session |
| `storage/properties.ts`     | ~36 | getProperties, createProperty, getUnits, createUnit |
| `storage/tenants.ts`        | ~26 | getTenants, createTenant, updateTenant, deposit ops |
| `storage/maintenance.ts`    | ~55 | getMR, createMR, workOrders, projects, photos |
| `storage/payments.ts`       | ~63 | rentPayments, invoices, mpesa, billing, arrears |
| `storage/finance.ts`        | ~31 | generalLedger, trialBalance, incomeStatement |
| `storage/utilities.ts`      | ~23 | utilityProviders, accounts, bills, meters |
| `storage/communications.ts` | ~20 | messages, notifications, broadcast |
| `storage/caretakers.ts`     | ~6  | caretaker CRUD |
| `storage/workforce.ts`      | ~25 | staffMembers, payroll, timeTracking |

## Migration order (safest first — least cross-domain dependencies)

1. `caretakers.ts` — 6 methods, no cross-domain deps
2. `communications.ts` — 20 methods, depends only on messages table  
3. `utilities.ts` — 23 methods, depends only on utility tables
4. `workforce.ts` — 25 methods, deps: staffMembers, payroll
5. `tenants.ts` — 26 methods, deps: tenants, deposits, leases
6. `properties.ts` — 36 methods, deps: properties, units
7. `users.ts` — 29 methods, deps: users, sessions, invites
8. `finance.ts` — 31 methods, deps: generalLedger, chartOfAccounts
9. `maintenance.ts` — 55 methods, deps: maintenanceRequests, workOrders, projects
10. `payments.ts` — 63 methods (largest, most complex, do last)

## How to migrate one domain at a time

1. Create `server/storage/<domain>.ts` with the mixin function
2. Move methods from `storage.ts` into the mixin (cut-paste, no logic changes)
3. Add `export function <Domain>Mixin` wrapping them
4. Update `DatabaseStorage` in `storage.ts` to extend the new mixin
5. Run `npm test` — all tests must pass before proceeding to the next domain
6. Commit with message `refactor(storage): extract <domain> domain`

## Current status

- [ ] caretakers.ts
- [ ] communications.ts  
- [ ] utilities.ts
- [ ] workforce.ts
- [ ] tenants.ts
- [ ] properties.ts
- [ ] users.ts
- [ ] finance.ts
- [ ] maintenance.ts
- [ ] payments.ts

The barrel file `server/storage/index.ts` is in place. Routes can be migrated 
to `import { storage } from "../storage/index"` at any time — both paths resolve 
to the same singleton.
